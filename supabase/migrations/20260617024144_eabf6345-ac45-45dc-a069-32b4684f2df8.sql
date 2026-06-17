-- Pricing Engine: Strict Ordered Pipeline
-- STEP 1: inputs
-- STEP 2: coverage product early-exit (24h/48h/home)
-- STEP 3: TIER from booked_min ONLY
-- STEP 4: RATE from tier + environment
-- STEP 5a: First-Hour Rule; 5b: ±15 tolerance (before rounding); 5c: 15-min ceiling
-- STEP 6: day/night split of billable
-- STEP 7: amount from frozen rate
-- New <4h and 4-6h night rates per spec.

CREATE OR REPLACE FUNCTION public.compute_quote(
  _start timestamptz,
  _end timestamptz,
  _environment text DEFAULT 'normal',
  _coverage_kind text DEFAULT 'standard'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  total_min int;
  d_min int;
  n_min int;
  booked_hr numeric;
  rate_day int;
  rate_night int;
  busy_mult numeric;
  base numeric := 0;
  amount numeric;
  tier text;
  ck text := lower(coalesce(_coverage_kind,'standard'));
BEGIN
  IF _end <= _start THEN
    RETURN jsonb_build_object('amount', 0, 'breakdown',
      jsonb_build_object('error','end_before_start'));
  END IF;

  SELECT day_min, night_min INTO d_min, n_min
    FROM public._split_day_night_minutes(_start, _end);
  total_min := d_min + n_min;
  booked_hr := total_min::numeric / 60.0;
  busy_mult := CASE WHEN _environment = 'busy' THEN 1.25 ELSE 1.0 END;

  -- STEP 2: coverage product early-exit. compute_quote is used for booked
  -- previews; treat exact 24h/48h windows as the Straight products.
  IF ck IN ('home','home_care') THEN
    amount := ROUND(booked_hr * 15000);
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object('tier','home_flat','hours',booked_hr,'rate',15000,'multiplier',1.0));
  END IF;

  IF total_min = 1440 THEN
    amount := ROUND(36000 * busy_mult);
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object('tier','straight_24h','multiplier',busy_mult));
  END IF;
  IF total_min = 2880 THEN
    amount := ROUND(72000 * busy_mult);
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object('tier','straight_48h','multiplier',busy_mult));
  END IF;

  -- STEP 3: TIER from booked hours ONLY.
  IF booked_hr > 6 THEN
    tier := '>6h';   rate_day := 2000; rate_night := 1500;
  ELSIF booked_hr >= 4 THEN
    tier := '4-6h';  rate_day := 2500; rate_night := 2000;
  ELSE
    tier := '<4h';   rate_day := 3000; rate_night := 2500;
  END IF;

  -- STEPS 5–7 (no worked input for a booked quote: billable == booked).
  base := (d_min::numeric / 60.0) * rate_day
        + (n_min::numeric / 60.0) * rate_night;
  amount := ROUND(base * busy_mult);

  RETURN jsonb_build_object(
    'amount', amount,
    'breakdown', jsonb_build_object(
      'tier',tier,'day_min',d_min,'night_min',n_min,
      'rate_day',rate_day,'rate_night',rate_night,
      'multiplier',busy_mult,'environment',_environment
    )
  );
END $function$;


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
  v_total numeric := 0;
  base numeric;
  due timestamptz := now() + interval '15 minutes';
  last_seg_id uuid;
  tolerance_fired boolean := false;
  win_start timestamptz;
  win_end timestamptz;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can end this shift'; END IF;
  IF r.status NOT IN ('active','paused') THEN RAISE EXCEPTION 'Shift is not in progress'; END IF;

  ct := lower(coalesce(r.coverage_type,''));
  total_days := GREATEST(1, COALESCE(r.days, 1));

  -- STEP 2: product classification.
  IF ct LIKE 'home%' THEN
    product := 'home';
  ELSIF ct LIKE '24%' AND total_days = 1 THEN
    product := 'straight_24h';
  ELSIF ct LIKE 'weekend%' AND total_days = 1 THEN
    product := 'straight_48h';
  ELSE
    product := 'standard';
  END IF;

  busy_mult := CASE WHEN r.environment = 'busy' AND product <> 'home' THEN 1.25 ELSE 1.0 END;

  -- Close any still-open segment.
  FOR seg IN
    SELECT * FROM public.shift_segments
     WHERE request_id = _request_id AND ended_at IS NULL
     FOR UPDATE
  LOOP
    UPDATE public.shift_segments SET ended_at = now() WHERE id = seg.id;
  END LOOP;

  -- Per-assignment billing: clear any prior per-segment amounts.
  UPDATE public.shift_segments
     SET billed_minutes = NULL, billed_amount = NULL
   WHERE request_id = _request_id;

  -- Aggregate worked minutes + day/night split across all segments.
  FOR seg IN
    SELECT * FROM public.shift_segments
     WHERE request_id = _request_id
       AND ended_at IS NOT NULL
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

  -- Booked per-day window from start_ts/end_ts (epoch ms) when present.
  IF r.start_ts IS NOT NULL AND r.end_ts IS NOT NULL AND r.end_ts > r.start_ts THEN
    booked_min := ((r.end_ts - r.start_ts) / 1000 / 60)::int;
    booked_per_day_min := GREATEST(0, booked_min / total_days);
    -- Compute day/night split for ONE booked day (anchor window) for STEP 6.
    win_start := to_timestamp(r.start_ts::double precision / 1000.0);
    win_end := win_start + make_interval(mins => booked_per_day_min);
    SELECT day_min, night_min INTO booked_d, booked_n
      FROM public._split_day_night_minutes(win_start, win_end);
  ELSE
    booked_per_day_min := 0;
    booked_d := 0;
    booked_n := 0;
  END IF;

  -- STEP 2: early exits for straight products.
  IF product = 'straight_24h' THEN
    v_total := ROUND(36000 * busy_mult);
    billable_total := 1440;
  ELSIF product = 'straight_48h' THEN
    v_total := ROUND(72000 * busy_mult);
    billable_total := 2880;
  ELSE
    -- STEP 3: TIER from booked_per_day_min ONLY (or worked fallback if booked missing).
    IF product = 'home' THEN
      tier := 'home_flat';
    ELSE
      booked_hr := CASE
        WHEN booked_per_day_min > 0 THEN booked_per_day_min::numeric / 60.0
        ELSE sum_worked::numeric / 60.0
      END;
      IF booked_hr > 6 THEN
        tier := '>6h';   rate_day := 2000; rate_night := 1500;
      ELSIF booked_hr >= 4 THEN
        tier := '4-6h'; rate_day := 2500; rate_night := 2000;
      ELSE
        tier := '<4h';   rate_day := 3000; rate_night := 2500;
      END IF;
    END IF;

    -- STEP 5a: First-Hour Rule
    IF sum_worked > 0 AND sum_worked < 60 THEN
      working_min := 60;
    ELSE
      working_min := sum_worked;
    END IF;

    -- STEP 5b: tolerance (before rounding)
    IF booked_per_day_min > 0 AND working_min > 0
       AND abs(working_min - booked_per_day_min) <= 15 THEN
      billable_total := booked_per_day_min;
      tolerance_fired := true;
    ELSE
      -- STEP 5c: 15-min ceiling
      billable_total := CASE WHEN working_min > 0
        THEN CEIL(working_min::numeric / 15.0)::int * 15
        ELSE 0
      END;
    END IF;

    -- STEP 6: day/night split of billable
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

    -- STEP 7: amount from frozen rate
    IF billable_total > 0 THEN
      IF product = 'home' THEN
        v_total := ROUND((billable_total::numeric / 60.0) * 15000);
      ELSE
        base := (d_billable::numeric / 60.0) * rate_day
              + (n_billable::numeric / 60.0) * rate_night;
        v_total := ROUND(base * busy_mult);
      END IF;
    END IF;
  END IF;

  -- Stamp last segment with aggregate billing for display.
  IF last_seg_id IS NOT NULL THEN
    UPDATE public.shift_segments
       SET billed_minutes = billable_total,
           billed_amount  = v_total
     WHERE id = last_seg_id;
  END IF;

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status = 'completed',
         billing_locked_at = now(),
         total_billed_amount = v_total,
         payment_due_at = due,
         settled_amount = v_total,
         payment_status = 'pending',
         payment_reference = NULL,
         payment_url = NULL,
         paid_at = NULL
   WHERE id = _request_id
   RETURNING * INTO r;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object(
    'total_billed_amount', r.total_billed_amount,
    'payment_due_at', due,
    'billable_minutes', billable_total,
    'tier', tier,
    'product', product
  );
END $function$;