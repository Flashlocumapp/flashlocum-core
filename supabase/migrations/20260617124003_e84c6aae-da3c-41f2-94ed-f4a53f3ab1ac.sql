CREATE OR REPLACE FUNCTION public.end_shift(_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.coverage_requests;
  seg public.shift_segments;
  ct text;
  product text;
  sum_worked int := 0;
  sum_d int := 0;
  sum_n int := 0;
  seg_d int;
  seg_n int;
  seg_worked int;
  working_min int;
  billable_total int := 0;
  d_billable int := 0;
  n_billable int := 0;
  booked_min int := 0;
  booked_per_day_min int := 0;
  booked_d int := 0;
  booked_n int := 0;
  total_days int;
  booked_hr numeric;
  tier text;
  rate_day int := 0;
  rate_night int := 0;
  busy_mult numeric := 1.0;
  home_busy numeric;
  tolerance_min int;
  first_hour_min int;
  block_min int;
  v_total numeric := 0;
  base numeric;
  due timestamptz := now() + interval '15 minutes';
  last_seg_id uuid;
  first_seg_started_at timestamptz;
  tolerance_fired boolean := false;
  win_start timestamptz;
  win_end timestamptz;
  v_id uuid := public._active_pricing_version_id();
  rates_row record;
  flat_amount int;
  home_rate int;
  snapshot jsonb;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can end this shift'; END IF;
  IF r.status NOT IN ('active','paused') THEN RAISE EXCEPTION 'Shift is not in progress'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'No active pricing version'; END IF;

  ct := lower(coalesce(r.coverage_type,''));
  total_days := GREATEST(1, COALESCE(r.days, 1));

  IF ct LIKE 'home%' THEN
    product := 'home';
  ELSIF ct LIKE '24%' AND total_days = 1 THEN
    product := 'straight_24h';
  ELSIF ct LIKE 'weekend%' AND total_days = 1 THEN
    product := 'straight_48h';
  ELSE
    product := 'standard';
  END IF;

  home_busy := COALESCE(public._pricing_modifier(v_id, 'home_busy_applies'), 0);
  busy_mult := CASE WHEN r.environment = 'busy'
                      AND (product <> 'home' OR home_busy = 1)
                    THEN COALESCE(public._pricing_modifier(v_id, 'busy_mult'), 1.0)
                    ELSE 1.0 END;
  tolerance_min  := COALESCE(public._pricing_modifier(v_id, 'tolerance_min')::int, 15);
  first_hour_min := COALESCE(public._pricing_modifier(v_id, 'first_hour_min')::int, 60);
  block_min      := COALESCE(public._pricing_modifier(v_id, 'block_min')::int, 15);

  FOR seg IN
    SELECT * FROM public.shift_segments
     WHERE request_id = _request_id AND ended_at IS NULL
     FOR UPDATE
  LOOP
    UPDATE public.shift_segments SET ended_at = now() WHERE id = seg.id;
  END LOOP;

  UPDATE public.shift_segments
     SET billed_minutes = NULL, billed_amount = NULL
   WHERE request_id = _request_id;

  SELECT started_at INTO first_seg_started_at
    FROM public.shift_segments
   WHERE request_id = _request_id
   ORDER BY segment_index
   LIMIT 1;

  FOR seg IN
    SELECT * FROM public.shift_segments
     WHERE request_id = _request_id AND ended_at IS NOT NULL
     ORDER BY segment_index
  LOOP
    seg_worked := GREATEST(0, EXTRACT(EPOCH FROM (seg.ended_at - seg.started_at))::int / 60);
    sum_worked := sum_worked + seg_worked;
    IF seg_worked > 0 THEN
      SELECT day_min, night_min INTO seg_d, seg_n
        FROM public._split_day_night_minutes(seg.started_at, seg.ended_at);
      sum_d := sum_d + seg_d;
      sum_n := sum_n + seg_n;
    END IF;
    last_seg_id := seg.id;
  END LOOP;

  IF r.start_ts IS NOT NULL AND r.end_ts IS NOT NULL AND r.end_ts > r.start_ts THEN
    booked_min := ((r.end_ts - r.start_ts) / 1000 / 60)::int;
    booked_per_day_min := GREATEST(0, booked_min / total_days);
    win_start := to_timestamp(r.start_ts::double precision / 1000.0);
    win_end := win_start + make_interval(mins => booked_per_day_min);
    SELECT day_min, night_min INTO booked_d, booked_n
      FROM public._split_day_night_minutes(win_start, win_end);
  END IF;

  IF product = 'straight_24h' THEN
    flat_amount := public._pricing_flat(v_id, 'straight_24h');
    v_total := ROUND(COALESCE(flat_amount, 36000) * busy_mult);
    billable_total := 1440;
    tier := 'straight_24h';
  ELSIF product = 'straight_48h' THEN
    flat_amount := public._pricing_flat(v_id, 'straight_48h');
    v_total := ROUND(COALESCE(flat_amount, 72000) * busy_mult);
    billable_total := 2880;
    tier := 'straight_48h';
  ELSE
    IF product = 'home' THEN
      tier := 'home_flat';
      SELECT pr.rate_day INTO home_rate FROM public._pricing_rate(v_id, 'home_flat') pr;
    ELSE
      booked_hr := CASE
        WHEN booked_per_day_min > 0 THEN booked_per_day_min::numeric / 60.0
        ELSE GREATEST(sum_worked, first_hour_min)::numeric / 60.0
      END;
      IF booked_hr > 6 THEN tier := '>6h';
      ELSIF booked_hr >= 4 THEN tier := '4-6h';
      ELSE tier := '<4h';
      END IF;
      SELECT pr.rate_day, pr.rate_night INTO rates_row
        FROM public._pricing_rate(v_id, tier) pr;
      rate_day := rates_row.rate_day;
      rate_night := rates_row.rate_night;
    END IF;

    -- HARD 1-HOUR MINIMUM: any started shift bills at least first_hour_min
    working_min := GREATEST(sum_worked, first_hour_min);

    IF booked_per_day_min > 0 AND working_min > 0
       AND abs(working_min - booked_per_day_min) <= tolerance_min THEN
      billable_total := booked_per_day_min;
      tolerance_fired := true;
    ELSE
      billable_total := CEIL(working_min::numeric / block_min)::int * block_min;
    END IF;

    -- Day/night split for short shifts: if no measurable worked minutes,
    -- derive the floor split from the first segment's start time.
    IF (sum_d + sum_n) = 0 AND first_seg_started_at IS NOT NULL THEN
      SELECT day_min, night_min INTO sum_d, sum_n
        FROM public._split_day_night_minutes(
          first_seg_started_at,
          first_seg_started_at + make_interval(mins => first_hour_min)
        );
    END IF;

    IF product = 'home' THEN
      d_billable := billable_total;
      n_billable := 0;
    ELSIF tolerance_fired THEN
      d_billable := booked_d;
      n_billable := booked_n;
    ELSIF (sum_d + sum_n) > 0 THEN
      d_billable := ROUND(sum_d::numeric * billable_total / (sum_d + sum_n))::int;
      n_billable := billable_total - d_billable;
    ELSE
      d_billable := billable_total;
      n_billable := 0;
    END IF;

    IF billable_total > 0 THEN
      IF product = 'home' THEN
        v_total := ROUND((billable_total::numeric / 60.0) * COALESCE(home_rate, 15000) * busy_mult);
      ELSE
        base := (d_billable::numeric / 60.0) * rate_day
              + (n_billable::numeric / 60.0) * rate_night;
        v_total := ROUND(base * busy_mult);
      END IF;
    END IF;
  END IF;

  IF last_seg_id IS NOT NULL THEN
    UPDATE public.shift_segments
       SET billed_minutes = billable_total,
           billed_amount  = v_total
     WHERE id = last_seg_id;
  END IF;

  snapshot := jsonb_build_object(
    'tier', tier,
    'product', product,
    'rate_day', rate_day,
    'rate_night', rate_night,
    'home_rate', home_rate,
    'busy_mult', busy_mult,
    'billable_min', billable_total,
    'booked_per_day_min', booked_per_day_min,
    'd_billable', d_billable,
    'n_billable', n_billable,
    'tolerance_fired', tolerance_fired,
    'sum_worked_min', sum_worked
  );

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status = 'awaiting_payment',
         billing_locked_at = now(),
         total_billed_amount = v_total,
         payment_due_at = due,
         settled_amount = v_total,
         payment_status = 'pending',
         payment_reference = NULL,
         payment_url = NULL,
         paid_at = NULL,
         pricing_version_id = v_id,
         rate_snapshot = snapshot
   WHERE id = _request_id
   RETURNING * INTO r;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object(
    'total_billed_amount', r.total_billed_amount,
    'payment_due_at', due,
    'billable_minutes', billable_total,
    'tier', tier,
    'product', product,
    'pricing_version_id', v_id
  );
END $function$;