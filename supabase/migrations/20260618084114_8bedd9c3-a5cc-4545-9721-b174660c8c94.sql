-- Multi-day shift: persistent accumulator + monotonic everStarted flag.
-- Note: coverage_requests.started_at is bigint (epoch ms); shift_segments.started_at is timestamptz.

ALTER TABLE public.coverage_requests
  ADD COLUMN IF NOT EXISTS first_started_at timestamptz;

-- Backfill from earliest segment for any row that has ever been started.
UPDATE public.coverage_requests cr
   SET first_started_at = COALESCE(
     (SELECT MIN(s.started_at) FROM public.shift_segments s WHERE s.request_id = cr.id),
     cr.updated_at
   )
 WHERE cr.first_started_at IS NULL
   AND cr.status IN ('active','paused','awaiting_payment','completed');

-- ---------------------------------------------------------------------------
-- start_shift: first activation sets first_started_at; starts segment 1.
-- (Existing semantics already gate on started_at IS NULL.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_shift(_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.coverage_requests;
  now_ms bigint := (EXTRACT(EPOCH FROM now())*1000)::bigint;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the requester can start this shift';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND account_restricted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Account restricted';
  END IF;
  IF r.started_at IS NOT NULL THEN RAISE EXCEPTION 'Shift already started'; END IF;

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET started_at       = now_ms,
         status           = 'active',
         accumulated_ms   = 0,
         first_started_at = COALESCE(first_started_at, now())
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  INSERT INTO public.shift_segments(request_id, segment_index, started_at)
  VALUES (_request_id, 1, now());

  RETURN jsonb_build_object('started_at', now(), 'startedAtMs', now_ms);
END $function$;

GRANT EXECUTE ON FUNCTION public.start_shift(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- pause_shift: close open segment, fold delta into accumulated_ms, clear started_at.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pause_shift(_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.coverage_requests;
  seg public.shift_segments;
  delta_ms bigint := 0;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can pause this shift'; END IF;
  IF r.status <> 'active' THEN RAISE EXCEPTION 'Shift is not active'; END IF;

  SELECT * INTO seg FROM public.shift_segments
   WHERE request_id = _request_id AND ended_at IS NULL
   ORDER BY segment_index DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No open segment'; END IF;

  UPDATE public.shift_segments SET ended_at = now() WHERE id = seg.id;
  delta_ms := GREATEST(0, (EXTRACT(EPOCH FROM (now() - seg.started_at)) * 1000)::bigint);

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status         = 'paused',
         started_at     = NULL,
         accumulated_ms = COALESCE(accumulated_ms, 0) + delta_ms
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object('segment_id', seg.id, 'paused_at', now(), 'delta_ms', delta_ms);
END $function$;

GRANT EXECUTE ON FUNCTION public.pause_shift(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- resume_shift: insert new segment, set started_at = now_ms; accumulated_ms untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resume_shift(_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.coverage_requests;
  next_idx int;
  now_ms bigint := (EXTRACT(EPOCH FROM now())*1000)::bigint;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the requester can resume';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND account_restricted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Account restricted';
  END IF;
  IF r.status <> 'paused' THEN RAISE EXCEPTION 'Shift is not paused'; END IF;

  SELECT COALESCE(MAX(segment_index),0)+1 INTO next_idx
    FROM public.shift_segments WHERE request_id = _request_id;
  INSERT INTO public.shift_segments(request_id, segment_index, started_at)
  VALUES (_request_id, next_idx, now());

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status         = 'active',
         started_at     = now_ms,
         payment_due_at = NULL
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object('segment_index', next_idx, 'startedAtMs', now_ms);
END $function$;

GRANT EXECUTE ON FUNCTION public.resume_shift(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- end_shift wrapper: invoke existing billing logic by recreating it almost
-- verbatim, but add accumulated_ms ledger write + clear started_at in the
-- final UPDATE. Sum every closed segment into accumulated_ms post-fold.
-- ---------------------------------------------------------------------------
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
  v_total_ms bigint := 0;
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

  -- Total ms across every closed segment — written into the accumulator ledger.
  SELECT COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)), 0)::bigint
    INTO v_total_ms
    FROM public.shift_segments
   WHERE request_id = _request_id AND ended_at IS NOT NULL;

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
    v_total := ROUND(COALESCE(flat_amount, 60000) * busy_mult);
    billable_total := 2880;
    tier := 'straight_48h';
  ELSIF product = 'home' THEN
    home_rate := public._pricing_flat(v_id, 'home_per_hour');
    booked_hr := COALESCE(r.duration_hrs, GREATEST(1, ROUND(booked_min::numeric / 60)));
    v_total := ROUND(COALESCE(home_rate, 5000) * booked_hr * busy_mult);
    billable_total := COALESCE(booked_min, (booked_hr * 60)::int);
    tier := 'home';
  ELSE
    -- standard (day/night split, tolerance, block rounding) — preserved verbatim.
    SELECT * INTO rates_row
      FROM public.pricing_rates
     WHERE version_id = v_id AND tier = 'standard'
     LIMIT 1;
    rate_day   := COALESCE(rates_row.day_rate, 4500);
    rate_night := COALESCE(rates_row.night_rate, 6500);
    working_min := sum_worked;
    IF booked_per_day_min > 0
       AND working_min >= (booked_per_day_min - tolerance_min)
       AND working_min <  booked_per_day_min THEN
      working_min := booked_per_day_min;
      tolerance_fired := true;
    END IF;
    IF working_min < first_hour_min THEN
      working_min := first_hour_min;
    ELSE
      working_min := ((working_min + block_min - 1) / block_min) * block_min;
    END IF;
    IF sum_worked > 0 THEN
      d_billable := ROUND(working_min::numeric * sum_d / sum_worked)::int;
      n_billable := working_min - d_billable;
    ELSE
      d_billable := working_min;
      n_billable := 0;
    END IF;
    v_total := ROUND(((d_billable::numeric/60) * rate_day + (n_billable::numeric/60) * rate_night) * busy_mult);
    billable_total := working_min;
    tier := 'standard';
  END IF;

  IF last_seg_id IS NOT NULL THEN
    UPDATE public.shift_segments
       SET billed_minutes = billable_total, billed_amount = v_total
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
     SET status              = 'awaiting_payment',
         started_at          = NULL,
         accumulated_ms      = v_total_ms,
         billing_locked_at   = now(),
         total_billed_amount = v_total,
         payment_due_at      = due,
         settled_amount      = v_total,
         payment_status      = 'pending',
         payment_reference   = NULL,
         payment_url         = NULL,
         paid_at             = NULL,
         pricing_version_id  = v_id,
         rate_snapshot       = snapshot
   WHERE id = _request_id
   RETURNING * INTO r;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object(
    'total_billed_amount', r.total_billed_amount,
    'payment_due_at', due,
    'billable_minutes', billable_total,
    'tier', tier,
    'product', product,
    'pricing_version_id', v_id,
    'accumulated_ms', v_total_ms
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.end_shift(uuid) TO authenticated;