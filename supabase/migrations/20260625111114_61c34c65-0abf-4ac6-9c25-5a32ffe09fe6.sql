
-- Straight Coverage as One Continuous Shift + Straight Billing Floor

-- 1) PAUSE_SHIFT: reject for straight products
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
  seg_worked_min int;
  per record;
  snap jsonb;
  new_day_index int;
  v_product text;
  v_booked_per_day int;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can pause this shift'; END IF;
  IF r.status <> 'active' THEN RAISE EXCEPTION 'Shift is not active'; END IF;

  -- Straight 24h / 48h shifts are continuous; pause is not a valid operation.
  v_booked_per_day := public._booked_per_day_min(r.start_time, r.end_time);
  v_product := public._effective_product(r.coverage_type, v_booked_per_day, COALESCE(r.days, 1));
  IF v_product IN ('straight_24h', 'straight_48h') THEN
    RAISE EXCEPTION 'Straight % shifts are continuous — use End Shift to complete.', v_product
      USING HINT = 'straight_no_pause';
  END IF;

  IF COALESCE(r.day_index, 1) >= COALESCE(r.days, 1) THEN
    RAISE EXCEPTION 'Final day - use End Shift to complete this booking';
  END IF;

  SELECT * INTO seg FROM public.shift_segments
   WHERE request_id = _request_id AND ended_at IS NULL
   ORDER BY segment_index DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No open segment'; END IF;

  UPDATE public.shift_segments SET ended_at = now() WHERE id = seg.id;
  delta_ms := GREATEST(0, (EXTRACT(EPOCH FROM (now() - seg.started_at)) * 1000)::bigint);
  seg_worked_min := GREATEST(0, EXTRACT(EPOCH FROM (now() - seg.started_at))::int / 60);

  snap := r.rate_snapshot;
  IF snap IS NULL THEN
    snap := public._build_locked_snapshot(r.coverage_type, r.start_time, r.end_time,
                                          COALESCE(r.days,1), COALESCE(r.environment,'normal'));
    IF snap IS NOT NULL THEN
      PERFORM set_config('app.lifecycle_bypass', 'on', true);
      UPDATE public.coverage_requests
         SET rate_snapshot = snap,
             pricing_version_id = (snap->>'pricing_version_id')::uuid
       WHERE id = _request_id;
      PERFORM set_config('app.lifecycle_bypass', '', true);
    END IF;
  END IF;

  IF snap IS NOT NULL AND COALESCE(snap->>'product','standard') IN ('standard','home') THEN
    SELECT * INTO per FROM public._price_segment_locked(snap, seg_worked_min);
    UPDATE public.shift_segments
       SET billed_minutes = per.billable_min,
           billed_amount  = per.amount
     WHERE id = seg.id;
  END IF;

  new_day_index := LEAST(COALESCE(r.days,1), COALESCE(r.day_index,1) + 1);

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status         = 'paused',
         started_at     = NULL,
         accumulated_ms = 0,
         day_index      = new_day_index
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object(
    'segment_id', seg.id,
    'paused_at', now(),
    'delta_ms', delta_ms,
    'day_index', new_day_index,
    'day_billed_amount',  (SELECT billed_amount  FROM public.shift_segments WHERE id = seg.id),
    'day_billed_minutes', (SELECT billed_minutes FROM public.shift_segments WHERE id = seg.id)
  );
END $function$;

-- 2) RESUME_SHIFT: also reject straight products (defensive — shouldn't be reachable)
CREATE OR REPLACE FUNCTION public.resume_shift(_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.coverage_requests;
  next_idx int;
  di int;
  now_ms bigint := (EXTRACT(EPOCH FROM now())*1000)::bigint;
  v_product text;
  v_booked_per_day int;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can resume this shift'; END IF;
  IF r.status NOT IN ('paused','upcoming') THEN RAISE EXCEPTION 'Shift cannot be resumed from %', r.status; END IF;

  v_booked_per_day := public._booked_per_day_min(r.start_time, r.end_time);
  v_product := public._effective_product(r.coverage_type, v_booked_per_day, COALESCE(r.days, 1));
  IF v_product IN ('straight_24h', 'straight_48h') AND r.status = 'paused' THEN
    RAISE EXCEPTION 'Straight % shifts cannot be paused or resumed.', v_product
      USING HINT = 'straight_no_pause';
  END IF;

  di := COALESCE(r.day_index, 1);

  SELECT COALESCE(MAX(segment_index),0) + 1 INTO next_idx
    FROM public.shift_segments WHERE request_id = _request_id;

  INSERT INTO public.shift_segments (request_id, segment_index, day_index, started_at)
  VALUES (_request_id, next_idx, di, now());

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status     = 'active',
         started_at = now(),
         accumulated_ms = 0
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object(
    'segment_index', next_idx,
    'day_index', di,
    'resumed_at', now()
  );
END $function$;

-- 3) AUTO-ADVANCE: skip straight products entirely
CREATE OR REPLACE FUNCTION public._auto_advance_day_boundary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec record;
  seg public.shift_segments;
  booked_per_day int;
  per record;
  next_di int;
  processed int := 0;
  v_product text;
BEGIN
  FOR rec IN
    SELECT cr.id, cr.days, cr.day_index, cr.rate_snapshot,
           cr.start_time, cr.end_time, cr.coverage_type
      FROM public.coverage_requests cr
     WHERE cr.status = 'active'
       AND COALESCE(cr.days,1) > 1
       AND COALESCE(cr.day_index,1) < COALESCE(cr.days,1)
  LOOP
    booked_per_day := COALESCE(
      (rec.rate_snapshot->>'booked_per_day_min')::int,
      public._booked_per_day_min(rec.start_time, rec.end_time));
    IF booked_per_day <= 0 THEN CONTINUE; END IF;

    -- Skip straight products: they are continuous and should never auto-segment.
    v_product := COALESCE(rec.rate_snapshot->>'product',
                          public._effective_product(rec.coverage_type, booked_per_day, COALESCE(rec.days, 1)));
    IF v_product IN ('straight_24h', 'straight_48h') THEN
      CONTINUE;
    END IF;

    SELECT * INTO seg FROM public.shift_segments
     WHERE request_id = rec.id AND ended_at IS NULL
     ORDER BY segment_index DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF EXTRACT(EPOCH FROM (now() - seg.started_at))::int / 60 < booked_per_day THEN
      CONTINUE;
    END IF;

    UPDATE public.shift_segments
       SET ended_at = seg.started_at + make_interval(mins => booked_per_day)
     WHERE id = seg.id;

    IF rec.rate_snapshot IS NOT NULL
       AND COALESCE(rec.rate_snapshot->>'product','standard') IN ('standard','home')
    THEN
      SELECT * INTO per FROM public._price_segment_locked(rec.rate_snapshot, booked_per_day);
      UPDATE public.shift_segments
         SET billed_minutes = per.billable_min,
             billed_amount  = per.amount
       WHERE id = seg.id;
    END IF;

    next_di := LEAST(COALESCE(rec.days,1), COALESCE(rec.day_index,1) + 1);

    PERFORM set_config('app.lifecycle_bypass', 'on', true);
    UPDATE public.coverage_requests
       SET status     = 'paused',
           started_at = NULL,
           day_index  = next_di
     WHERE id = rec.id;
    PERFORM set_config('app.lifecycle_bypass', '', true);

    processed := processed + 1;
  END LOOP;
  RETURN jsonb_build_object('processed', processed);
END $function$;

-- 4) END_SHIFT: enforce 1-hour minimum on straight products so a fast-ended
-- 24h/48h shift bills at least one hour × straight_per_hour × busy_mult,
-- never ₦0.
CREATE OR REPLACE FUNCTION public.end_shift(_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.coverage_requests;
  v_id uuid := public._active_pricing_version_id();
  product text;
  total_days int;
  busy_mult numeric; home_busy numeric;
  tolerance_min int; block_min int; first_hour_min int;
  home_tol int; home_block int;
  st24_lo int; st24_hi int; st48_lo int; st48_hi int; st_ph int;
  v_total_ms bigint := 0;
  sum_worked_min int := 0;
  booked_per_day_min int := 0;
  d_win int := 0; n_win int := 0;
  booked_hr numeric;
  tier text;
  rates_row record;
  rate_day int := 0; rate_night int := 0;
  per_day record; day_amount numeric; day_bill int;
  flat_amount int; extra_hr int; hr_used int;
  home_rate int; bill int; remaining int;
  v_total numeric := 0;
  billable_total int := 0;
  snapshot jsonb;
  days_breakdown jsonb := '[]'::jsonb;
  due timestamptz := now() + interval '15 minutes';
  last_seg_id uuid;
  day_rec record;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can end this shift'; END IF;
  IF r.status NOT IN ('active','paused') THEN RAISE EXCEPTION 'Shift is not in progress'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'No active pricing version'; END IF;

  total_days := GREATEST(1, COALESCE(r.days, 1));
  booked_per_day_min := public._booked_per_day_min(r.start_time, r.end_time);
  SELECT day_min, night_min INTO d_win, n_win
    FROM public._window_day_night_min(r.start_time, r.end_time);

  product := public._effective_product(r.coverage_type, booked_per_day_min, total_days);

  busy_mult      := COALESCE(public._pricing_modifier(v_id, 'busy_mult'), 1.25);
  home_busy      := COALESCE(public._pricing_modifier(v_id, 'home_busy_applies'), 0);
  tolerance_min  := COALESCE(public._pricing_modifier(v_id, 'tolerance_min')::int, 15);
  block_min      := COALESCE(public._pricing_modifier(v_id, 'block_min')::int, 15);
  first_hour_min := COALESCE(public._pricing_modifier(v_id, 'first_hour_min')::int, 60);
  home_tol       := COALESCE(public._pricing_modifier(v_id, 'home_tolerance_min')::int, 30);
  home_block     := COALESCE(public._pricing_modifier(v_id, 'home_block_min')::int, 60);
  st24_lo        := COALESCE(public._pricing_modifier(v_id, 'straight24_lo_min')::int, 1320);
  st24_hi        := COALESCE(public._pricing_modifier(v_id, 'straight24_hi_min')::int, 1500);
  st48_lo        := COALESCE(public._pricing_modifier(v_id, 'straight48_lo_min')::int, 2760);
  st48_hi        := COALESCE(public._pricing_modifier(v_id, 'straight48_hi_min')::int, 2940);
  st_ph          := COALESCE(public._pricing_modifier(v_id, 'straight_per_hour')::int, 1500);

  IF NOT (r.environment = 'busy' AND (product <> 'home' OR home_busy = 1)) THEN
    busy_mult := 1.0;
  END IF;

  UPDATE public.shift_segments SET ended_at = now()
   WHERE request_id = _request_id AND ended_at IS NULL;

  UPDATE public.shift_segments
     SET billed_minutes = NULL, billed_amount = NULL
   WHERE request_id = _request_id;

  SELECT
    COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)), 0)::bigint,
    COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at))::int / 60)), 0)
  INTO v_total_ms, sum_worked_min
  FROM public.shift_segments
  WHERE request_id = _request_id AND ended_at IS NOT NULL;

  SELECT id INTO last_seg_id FROM public.shift_segments
   WHERE request_id = _request_id AND ended_at IS NOT NULL
   ORDER BY segment_index DESC LIMIT 1;

  IF product = 'straight_24h' THEN
    flat_amount := COALESCE(public._pricing_flat(v_id, 'straight_24h'), 36000);
    IF sum_worked_min >= st24_lo AND sum_worked_min <= st24_hi THEN
      v_total := ROUND(flat_amount * busy_mult);
    ELSIF sum_worked_min < st24_lo THEN
      -- Enforce 1-hour minimum so a near-instant end bills 1h × straight_per_hour, never ₦0.
      hr_used := GREATEST(1, CEIL(sum_worked_min::numeric / 60.0)::int);
      v_total := ROUND(hr_used * st_ph * busy_mult);
    ELSE
      extra_hr := CEIL((sum_worked_min - st24_hi)::numeric / 60.0)::int;
      v_total := ROUND((flat_amount + extra_hr * st_ph) * busy_mult);
    END IF;
    billable_total := GREATEST(sum_worked_min, 60);
    tier := 'straight_24h';

  ELSIF product = 'straight_48h' THEN
    flat_amount := COALESCE(public._pricing_flat(v_id, 'straight_48h'), 72000);
    IF sum_worked_min >= st48_lo AND sum_worked_min <= st48_hi THEN
      v_total := ROUND(flat_amount * busy_mult);
    ELSIF sum_worked_min < st48_lo THEN
      -- Enforce 1-hour minimum so a near-instant end bills 1h × straight_per_hour, never ₦0.
      hr_used := GREATEST(1, CEIL(sum_worked_min::numeric / 60.0)::int);
      v_total := ROUND(hr_used * st_ph * busy_mult);
    ELSE
      extra_hr := CEIL((sum_worked_min - st48_hi)::numeric / 60.0)::int;
      v_total := ROUND((flat_amount + extra_hr * st_ph) * busy_mult);
    END IF;
    billable_total := GREATEST(sum_worked_min, 60);
    tier := 'straight_48h';

  ELSIF product = 'home' THEN
    home_rate := COALESCE(public._pricing_flat(v_id, 'home_hour'), 12000);
    tier := 'home';
    rate_day := home_rate; rate_night := home_rate;

    FOR day_rec IN
      WITH per_day_w AS (
        SELECT COALESCE(day_index, 1) AS day_index,
               COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at))::int / 60)), 0)::int AS worked_min,
               MAX(segment_index) AS last_seg_index
          FROM public.shift_segments
         WHERE request_id = _request_id AND ended_at IS NOT NULL
         GROUP BY day_index
      ),
      booked_days AS (
        SELECT generate_series(1, total_days) AS day_index
      )
      SELECT bd.day_index,
             COALESCE(pdw.worked_min, 0) AS worked_min,
             pdw.last_seg_index
        FROM booked_days bd
        LEFT JOIN per_day_w pdw ON pdw.day_index = bd.day_index
       ORDER BY bd.day_index
    LOOP
      remaining := GREATEST(day_rec.worked_min, first_hour_min);
      IF booked_per_day_min > 0
         AND abs(remaining - booked_per_day_min) <= home_tol THEN
        bill := booked_per_day_min;
      ELSE
        bill := ((remaining + home_block - 1) / home_block) * home_block;
      END IF;
      day_amount := ROUND((bill::numeric / 60.0) * home_rate * busy_mult);
      day_bill := bill;

      v_total := v_total + day_amount;
      billable_total := billable_total + day_bill;
      days_breakdown := days_breakdown || jsonb_build_object(
        'day_index', day_rec.day_index,
        'worked_min', day_rec.worked_min,
        'billable_min', day_bill,
        'amount', day_amount,
        'tolerance_fired', booked_per_day_min > 0
          AND abs(GREATEST(day_rec.worked_min, first_hour_min) - booked_per_day_min) <= home_tol
      );

      IF day_rec.last_seg_index IS NOT NULL THEN
        UPDATE public.shift_segments
           SET billed_minutes = day_bill, billed_amount = day_amount
         WHERE request_id = _request_id
           AND segment_index = day_rec.last_seg_index;
      END IF;
    END LOOP;

  ELSE
    -- standard
    tier := 'standard';
    SELECT * INTO rates_row FROM public.pricing_rates
     WHERE pricing_version_id = v_id AND coverage_type = 'standard' LIMIT 1;
    rate_day := COALESCE(rates_row.rate_day, 2000);
    rate_night := COALESCE(rates_row.rate_night, 1500);

    FOR day_rec IN
      WITH per_day_w AS (
        SELECT COALESCE(day_index, 1) AS day_index,
               COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at))::int / 60)), 0)::int AS worked_min,
               MAX(segment_index) AS last_seg_index
          FROM public.shift_segments
         WHERE request_id = _request_id AND ended_at IS NOT NULL
         GROUP BY day_index
      ),
      booked_days AS (
        SELECT generate_series(1, total_days) AS day_index
      )
      SELECT bd.day_index,
             COALESCE(pdw.worked_min, 0) AS worked_min,
             pdw.last_seg_index
        FROM booked_days bd
        LEFT JOIN per_day_w pdw ON pdw.day_index = bd.day_index
       ORDER BY bd.day_index
    LOOP
      SELECT * INTO per_day FROM public._price_standard_day(
        booked_per_day_min, day_rec.worked_min, d_win, n_win,
        rate_day, rate_night, busy_mult,
        tolerance_min, block_min, first_hour_min);
      day_amount := per_day.amount;
      day_bill := per_day.billable_min;

      v_total := v_total + day_amount;
      billable_total := billable_total + day_bill;
      days_breakdown := days_breakdown || jsonb_build_object(
        'day_index', day_rec.day_index,
        'worked_min', day_rec.worked_min,
        'billable_min', day_bill,
        'amount', day_amount,
        'tolerance_fired', per_day.tolerance_fired);

      IF day_rec.last_seg_index IS NOT NULL THEN
        UPDATE public.shift_segments
           SET billed_minutes = day_bill, billed_amount = day_amount
         WHERE request_id = _request_id
           AND segment_index = day_rec.last_seg_index;
      END IF;
    END LOOP;
  END IF;

  IF product IN ('straight_24h','straight_48h') AND last_seg_id IS NOT NULL THEN
    UPDATE public.shift_segments
       SET billed_minutes = billable_total, billed_amount = v_total
     WHERE id = last_seg_id;
  END IF;

  snapshot := jsonb_build_object(
    'product', product, 'tier', tier,
    'rate_day', rate_day, 'rate_night', rate_night,
    'busy_mult', busy_mult,
    'billable_min', billable_total,
    'booked_per_day_min', booked_per_day_min,
    'day_window_min', d_win,
    'night_window_min', n_win,
    'sum_worked_min', sum_worked_min,
    'days', total_days,
    'days_breakdown', days_breakdown,
    'straight_per_hour', st_ph,
    'home_hour', COALESCE(public._pricing_flat(v_id, 'home_hour'), 12000),
    'block_min', block_min
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
         rate_snapshot       = snapshot,
         pricing_version_id  = v_id
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object(
    'ended_at', now(),
    'total_billed_amount', v_total,
    'billing_locked_at', now(),
    'payment_due_at', due,
    'billable_minutes', billable_total,
    'tier', tier,
    'product', product,
    'pricing_version_id', v_id,
    'accumulated_ms', v_total_ms,
    'snapshot', snapshot
  );
END $function$;
