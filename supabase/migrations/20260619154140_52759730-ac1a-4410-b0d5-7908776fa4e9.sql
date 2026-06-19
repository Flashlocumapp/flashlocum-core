
-- =====================================================================
-- FlashLocum Pricing Engine v3
-- Locked rate at booking + per-day independent billing + auto day-advance
-- =====================================================================

ALTER TABLE public.shift_segments
  ADD COLUMN IF NOT EXISTS day_index integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS shift_segments_request_day_idx
  ON public.shift_segments(request_id, day_index, segment_index);

CREATE OR REPLACE FUNCTION public._build_locked_snapshot(
  _coverage_type text,
  _start_hhmm text,
  _end_hhmm text,
  _days int,
  _environment text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_id uuid := public._active_pricing_version_id();
  product text;
  booked_per_day_min int;
  booked_hr numeric;
  d_min int := 0; n_min int := 0;
  tier text := NULL;
  rates_row record;
  rate_day int := 0; rate_night int := 0;
  home_rate int := 0;
  straight_per_hour int;
  busy_mult_val numeric;
  home_busy numeric;
  busy_mult numeric;
BEGIN
  IF v_id IS NULL THEN RETURN NULL; END IF;
  product := public._classify_product(_coverage_type, COALESCE(_days, 1));
  booked_per_day_min := public._booked_per_day_min(_start_hhmm, _end_hhmm);
  booked_hr := booked_per_day_min::numeric / 60.0;
  SELECT day_min, night_min INTO d_min, n_min
    FROM public._window_day_night_min(_start_hhmm, _end_hhmm);
  busy_mult_val := COALESCE(public._pricing_modifier(v_id, 'busy_mult'), 1.25);
  home_busy     := COALESCE(public._pricing_modifier(v_id, 'home_busy_applies'), 0);
  straight_per_hour := COALESCE(public._pricing_modifier(v_id, 'straight_per_hour')::int, 1500);
  home_rate     := COALESCE(public._pricing_flat(v_id, 'home_hour'), 12000);
  IF product = 'standard' AND booked_per_day_min > 0 THEN
    tier := public._tier_for_per_day_hours(booked_hr);
    SELECT pr.rate_day, pr.rate_night INTO rates_row
      FROM public._pricing_rate(v_id, tier) pr;
    rate_day   := COALESCE(rates_row.rate_day, 2000);
    rate_night := COALESCE(rates_row.rate_night, 1500);
  END IF;
  IF _environment = 'busy' AND (product <> 'home' OR home_busy = 1) THEN
    busy_mult := busy_mult_val;
  ELSE
    busy_mult := 1.0;
  END IF;
  RETURN jsonb_build_object(
    'pricing_version_id', v_id,
    'product', product,
    'tier', tier,
    'booked_per_day_min', booked_per_day_min,
    'day_window_min', d_min,
    'night_window_min', n_min,
    'rate_day', rate_day,
    'rate_night', rate_night,
    'home_rate', home_rate,
    'straight_per_hour', straight_per_hour,
    'busy_mult', busy_mult,
    'environment', _environment,
    'flat_24h', COALESCE(public._pricing_flat(v_id, 'straight_24h'), 36000),
    'flat_48h', COALESCE(public._pricing_flat(v_id, 'straight_48h'), 72000),
    'tolerance_min',  COALESCE(public._pricing_modifier(v_id, 'tolerance_min')::int, 15),
    'block_min',      COALESCE(public._pricing_modifier(v_id, 'block_min')::int, 15),
    'first_hour_min', COALESCE(public._pricing_modifier(v_id, 'first_hour_min')::int, 60),
    'home_tolerance_min', COALESCE(public._pricing_modifier(v_id, 'home_tolerance_min')::int, 30),
    'home_block_min',     COALESCE(public._pricing_modifier(v_id, 'home_block_min')::int, 60),
    'straight24_lo_min',  COALESCE(public._pricing_modifier(v_id, 'straight24_lo_min')::int, 1320),
    'straight24_hi_min',  COALESCE(public._pricing_modifier(v_id, 'straight24_hi_min')::int, 1500),
    'straight48_lo_min',  COALESCE(public._pricing_modifier(v_id, 'straight48_lo_min')::int, 2760),
    'straight48_hi_min',  COALESCE(public._pricing_modifier(v_id, 'straight48_hi_min')::int, 2940),
    'locked_at', now()
  );
END $$;

GRANT EXECUTE ON FUNCTION public._build_locked_snapshot(text,text,text,int,text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._lock_rate_on_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE snap jsonb;
BEGIN
  IF NEW.pricing_version_id IS NULL OR NEW.rate_snapshot IS NULL THEN
    snap := public._build_locked_snapshot(
      NEW.coverage_type, NEW.start_time, NEW.end_time,
      COALESCE(NEW.days, 1), COALESCE(NEW.environment, 'normal'));
    IF snap IS NOT NULL THEN
      NEW.pricing_version_id := (snap->>'pricing_version_id')::uuid;
      NEW.rate_snapshot      := snap;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lock_rate_on_insert ON public.coverage_requests;
CREATE TRIGGER trg_lock_rate_on_insert
  BEFORE INSERT ON public.coverage_requests
  FOR EACH ROW EXECUTE FUNCTION public._lock_rate_on_insert();

-- (Backfill of pre-existing rows is intentionally skipped to avoid colliding
-- with the realtime publication's column list on coverage_requests. Pause/End
-- Shift below populate rate_snapshot lazily for any row that lacks one.)

CREATE OR REPLACE FUNCTION public._price_segment_locked(
  _snapshot jsonb, _worked_min int
) RETURNS TABLE(billable_min int, amount numeric, tolerance_fired boolean)
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  product text := COALESCE(_snapshot->>'product', 'standard');
  booked_per_day int := COALESCE((_snapshot->>'booked_per_day_min')::int, 0);
  d_win int := COALESCE((_snapshot->>'day_window_min')::int, 0);
  n_win int := COALESCE((_snapshot->>'night_window_min')::int, 0);
  rate_day int := COALESCE((_snapshot->>'rate_day')::int, 2000);
  rate_night int := COALESCE((_snapshot->>'rate_night')::int, 1500);
  home_rate int := COALESCE((_snapshot->>'home_rate')::int, 12000);
  busy_mult numeric := COALESCE((_snapshot->>'busy_mult')::numeric, 1.0);
  tol int := COALESCE((_snapshot->>'tolerance_min')::int, 15);
  blk int := COALESCE((_snapshot->>'block_min')::int, 15);
  fhm int := COALESCE((_snapshot->>'first_hour_min')::int, 60);
  home_tol int := COALESCE((_snapshot->>'home_tolerance_min')::int, 30);
  home_blk int := COALESCE((_snapshot->>'home_block_min')::int, 60);
  working int; bill int := 0; fired boolean := false;
  win_total int; d_bill int := 0; n_bill int := 0; amt numeric := 0;
BEGIN
  working := GREATEST(0, COALESCE(_worked_min, 0));
  IF product = 'home' THEN
    IF working < fhm THEN working := fhm; END IF;
    IF booked_per_day > 0 AND abs(working - booked_per_day) <= home_tol THEN
      bill := booked_per_day; fired := true;
    ELSE
      bill := ((working + home_blk - 1) / home_blk) * home_blk;
    END IF;
    amt := ROUND((bill::numeric / 60.0) * home_rate * busy_mult);
    billable_min := bill; amount := amt; tolerance_fired := fired;
    RETURN NEXT; RETURN;
  END IF;
  IF working < fhm THEN working := fhm; END IF;
  IF booked_per_day > 0 AND abs(working - booked_per_day) <= tol THEN
    bill := booked_per_day; fired := true;
  ELSE
    bill := ((working + blk - 1) / blk) * blk;
  END IF;
  win_total := d_win + n_win;
  IF win_total > 0 THEN
    d_bill := ROUND(bill::numeric * d_win / win_total)::int;
    n_bill := bill - d_bill;
  ELSE
    d_bill := bill; n_bill := 0;
  END IF;
  amt := ROUND(((d_bill::numeric / 60.0) * rate_day
              + (n_bill::numeric / 60.0) * rate_night) * busy_mult);
  billable_min := bill; amount := amt; tolerance_fired := fired;
  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public._price_segment_locked(jsonb, int)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.start_shift(_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.coverage_requests;
  now_ms bigint := (EXTRACT(EPOCH FROM now())*1000)::bigint;
  di int;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can start this shift'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND account_restricted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Account restricted';
  END IF;
  IF r.started_at IS NOT NULL THEN RAISE EXCEPTION 'Shift already started'; END IF;
  di := GREATEST(1, COALESCE(r.day_index, 1));
  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET started_at       = now_ms,
         status           = 'active',
         accumulated_ms   = 0,
         day_index        = di,
         first_started_at = COALESCE(first_started_at, now())
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);
  INSERT INTO public.shift_segments(request_id, segment_index, started_at, day_index)
  VALUES (_request_id, 1, now(), di);
  RETURN jsonb_build_object('started_at', now(), 'startedAtMs', now_ms, 'day_index', di);
END $$;

CREATE OR REPLACE FUNCTION public.pause_shift(_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.coverage_requests;
  seg public.shift_segments;
  delta_ms bigint := 0;
  seg_worked_min int;
  per record;
  snap jsonb;
  new_day_index int;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can pause this shift'; END IF;
  IF r.status <> 'active' THEN RAISE EXCEPTION 'Shift is not active'; END IF;
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
         accumulated_ms = COALESCE(accumulated_ms, 0) + delta_ms,
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
END $$;

CREATE OR REPLACE FUNCTION public.resume_shift(_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.coverage_requests;
  next_idx int;
  di int;
  now_ms bigint := (EXTRACT(EPOCH FROM now())*1000)::bigint;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can resume this shift'; END IF;
  IF r.status <> 'paused' THEN
    IF r.status = 'active' THEN
      RETURN jsonb_build_object('already_active', true);
    END IF;
    RAISE EXCEPTION 'Shift is not paused';
  END IF;
  SELECT COALESCE(MAX(segment_index), 0) + 1 INTO next_idx
    FROM public.shift_segments WHERE request_id = _request_id;
  di := GREATEST(1, LEAST(COALESCE(r.days,1), COALESCE(r.day_index,1)));
  INSERT INTO public.shift_segments(request_id, segment_index, started_at, day_index)
  VALUES (_request_id, next_idx, now(), di);
  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status     = 'active',
         started_at = now_ms
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);
  RETURN jsonb_build_object('resumed_at', now(), 'startedAtMs', now_ms,
                            'segment_index', next_idx, 'day_index', di);
END $$;

CREATE OR REPLACE FUNCTION public._auto_advance_day_boundary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec record;
  seg public.shift_segments;
  booked_per_day int;
  per record;
  next_di int;
  processed int := 0;
BEGIN
  FOR rec IN
    SELECT cr.id, cr.days, cr.day_index, cr.rate_snapshot,
           cr.start_time, cr.end_time
      FROM public.coverage_requests cr
     WHERE cr.status = 'active'
       AND COALESCE(cr.days,1) > 1
       AND COALESCE(cr.day_index,1) < COALESCE(cr.days,1)
  LOOP
    SELECT * INTO seg FROM public.shift_segments
     WHERE request_id = rec.id AND ended_at IS NULL
     ORDER BY segment_index DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    booked_per_day := COALESCE(
      (rec.rate_snapshot->>'booked_per_day_min')::int,
      public._booked_per_day_min(rec.start_time, rec.end_time));
    IF booked_per_day <= 0 THEN CONTINUE; END IF;

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
END $$;

GRANT EXECUTE ON FUNCTION public._auto_advance_day_boundary() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flashlocum-auto-advance-day') THEN
      PERFORM cron.unschedule('flashlocum-auto-advance-day');
    END IF;
    PERFORM cron.schedule(
      'flashlocum-auto-advance-day', '* * * * *',
      $cron$ SELECT public._auto_advance_day_boundary(); $cron$
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.end_shift(_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.coverage_requests;
  snap jsonb;
  product text;
  busy_mult numeric;
  st24_lo int; st24_hi int; st48_lo int; st48_hi int; st_ph int;
  flat_amount int;
  v_total_ms bigint := 0;
  sum_worked_min int := 0;
  v_total numeric := 0;
  billable_total int := 0;
  days_breakdown jsonb := '[]'::jsonb;
  due timestamptz := now() + interval '15 minutes';
  hr_used int; extra_hr int;
  seg public.shift_segments;
  per record;
  seg_worked int;
  booked_per_day int;
  remaining int;
  piece int;
  cur_day int;
  daily_worked int;
  daily_amount numeric;
  daily_bill int;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can end this shift'; END IF;
  IF r.status NOT IN ('active','paused') THEN RAISE EXCEPTION 'Shift is not in progress'; END IF;

  snap := r.rate_snapshot;
  IF snap IS NULL THEN
    snap := public._build_locked_snapshot(r.coverage_type, r.start_time, r.end_time,
                                          COALESCE(r.days,1), COALESCE(r.environment,'normal'));
    IF snap IS NULL THEN RAISE EXCEPTION 'No active pricing version'; END IF;
  END IF;

  product   := COALESCE(snap->>'product', 'standard');
  busy_mult := COALESCE((snap->>'busy_mult')::numeric, 1.0);
  st_ph     := COALESCE((snap->>'straight_per_hour')::int, 1500);
  st24_lo   := COALESCE((snap->>'straight24_lo_min')::int, 1320);
  st24_hi   := COALESCE((snap->>'straight24_hi_min')::int, 1500);
  st48_lo   := COALESCE((snap->>'straight48_lo_min')::int, 2760);
  st48_hi   := COALESCE((snap->>'straight48_hi_min')::int, 2940);
  booked_per_day := COALESCE((snap->>'booked_per_day_min')::int, 0);

  UPDATE public.shift_segments SET ended_at = now()
   WHERE request_id = _request_id AND ended_at IS NULL;

  SELECT
    COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)), 0)::bigint,
    COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at))::int / 60)), 0)
  INTO v_total_ms, sum_worked_min
  FROM public.shift_segments
  WHERE request_id = _request_id AND ended_at IS NOT NULL;

  IF product = 'straight_24h' THEN
    flat_amount := COALESCE((snap->>'flat_24h')::int, 36000);
    IF sum_worked_min >= st24_lo AND sum_worked_min <= st24_hi THEN
      v_total := ROUND(flat_amount * busy_mult);
    ELSIF sum_worked_min < st24_lo THEN
      hr_used := CEIL(sum_worked_min::numeric / 60.0)::int;
      v_total := ROUND(hr_used * st_ph * busy_mult);
    ELSE
      extra_hr := CEIL((sum_worked_min - st24_hi)::numeric / 60.0)::int;
      v_total := ROUND((flat_amount + extra_hr * st_ph) * busy_mult);
    END IF;
    billable_total := sum_worked_min;
  ELSIF product = 'straight_48h' THEN
    flat_amount := COALESCE((snap->>'flat_48h')::int, 72000);
    IF sum_worked_min >= st48_lo AND sum_worked_min <= st48_hi THEN
      v_total := ROUND(flat_amount * busy_mult);
    ELSIF sum_worked_min < st48_lo THEN
      hr_used := CEIL(sum_worked_min::numeric / 60.0)::int;
      v_total := ROUND(hr_used * st_ph * busy_mult);
    ELSE
      extra_hr := CEIL((sum_worked_min - st48_hi)::numeric / 60.0)::int;
      v_total := ROUND((flat_amount + extra_hr * st_ph) * busy_mult);
    END IF;
    billable_total := sum_worked_min;
  ELSE
    -- Auto-split any segment that ran past the booked daily duration into
    -- per-day pieces, so per-day grace + rounding apply cleanly.
    FOR seg IN
      SELECT * FROM public.shift_segments
       WHERE request_id = _request_id AND ended_at IS NOT NULL
       ORDER BY segment_index
    LOOP
      seg_worked := GREATEST(0, EXTRACT(EPOCH FROM (seg.ended_at - seg.started_at))::int / 60);
      IF booked_per_day > 0 AND seg_worked > booked_per_day
         AND seg.day_index < COALESCE(r.days, 1)
      THEN
        cur_day := seg.day_index;
        remaining := seg_worked;
        piece := booked_per_day;
        UPDATE public.shift_segments
           SET ended_at = seg.started_at + make_interval(mins => piece)
         WHERE id = seg.id;
        remaining := remaining - piece;
        WHILE remaining > 0 AND cur_day < COALESCE(r.days, 1) LOOP
          cur_day := cur_day + 1;
          piece := LEAST(remaining, booked_per_day);
          INSERT INTO public.shift_segments(
            request_id, segment_index, started_at, ended_at, day_index
          )
          SELECT _request_id,
                 COALESCE(MAX(segment_index),0) + 1,
                 seg.started_at + make_interval(mins => seg_worked - remaining),
                 seg.started_at + make_interval(mins => seg_worked - remaining + piece),
                 cur_day
            FROM public.shift_segments WHERE request_id = _request_id;
          remaining := remaining - piece;
        END LOOP;
      END IF;
    END LOOP;

    -- Sum per-day totals across all segments grouped by day_index.
    FOR cur_day, daily_worked IN
      SELECT s.day_index,
             SUM(GREATEST(0, EXTRACT(EPOCH FROM (s.ended_at - s.started_at))::int / 60))::int
        FROM public.shift_segments s
       WHERE s.request_id = _request_id AND s.ended_at IS NOT NULL
       GROUP BY s.day_index
       ORDER BY s.day_index
    LOOP
      SELECT * INTO per FROM public._price_segment_locked(snap, daily_worked);
      daily_amount := per.amount;
      daily_bill   := per.billable_min;
      v_total := v_total + daily_amount;
      billable_total := billable_total + daily_bill;
      days_breakdown := days_breakdown || jsonb_build_object(
        'day_index', cur_day,
        'worked_min', daily_worked,
        'billable_min', daily_bill,
        'amount', daily_amount,
        'tolerance_fired', per.tolerance_fired);

      -- Distribute the day's bill across its segments proportionally so the
      -- ledger stays consistent for audits / disputes.
      UPDATE public.shift_segments s
         SET billed_minutes = CASE WHEN daily_worked > 0
              THEN ROUND(daily_bill::numeric
                * GREATEST(0, EXTRACT(EPOCH FROM (s.ended_at - s.started_at))::int / 60)
                / daily_worked)::int
              ELSE daily_bill END,
             billed_amount  = CASE WHEN daily_worked > 0
              THEN ROUND(daily_amount
                * GREATEST(0, EXTRACT(EPOCH FROM (s.ended_at - s.started_at))::int / 60)
                / daily_worked)
              ELSE daily_amount END
       WHERE s.request_id = _request_id
         AND s.day_index = cur_day
         AND s.ended_at IS NOT NULL;
    END LOOP;
  END IF;

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status              = 'awaiting_payment',
         started_at          = NULL,
         accumulated_ms      = v_total_ms,
         billing_locked_at   = now(),
         total_billed_amount = v_total,
         base_amount         = v_total,
         surcharge_amount    = 0,
         payment_due_at      = due,
         settled_amount      = v_total,
         payment_status      = 'pending',
         payment_reference   = NULL,
         payment_url         = NULL,
         rate_snapshot       = snap || jsonb_build_object(
                                 'sum_worked_min', sum_worked_min,
                                 'billable_total', billable_total,
                                 'days_breakdown', days_breakdown,
                                 'final_total', v_total),
         pricing_version_id  = COALESCE(r.pricing_version_id, (snap->>'pricing_version_id')::uuid)
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object(
    'request_id', _request_id,
    'product', product,
    'total_billed_amount', v_total,
    'billable_min', billable_total,
    'sum_worked_min', sum_worked_min,
    'days_breakdown', days_breakdown,
    'payment_due_at', due
  );
END $$;

CREATE OR REPLACE FUNCTION public.compute_quote(
  _start timestamptz, _end timestamptz,
  _environment text DEFAULT 'normal',
  _coverage_kind text DEFAULT 'standard'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_id uuid := public._active_pricing_version_id();
  busy_mult numeric; home_busy numeric;
  total_min int; d_min int; n_min int;
  ck text := lower(coalesce(_coverage_kind, 'standard'));
  product text;
  total_days int;
  per_day_min int;
  per_day_d int; per_day_n int;
  tier text; rates_row record;
  rate_day int := 0; rate_night int := 0;
  per_day_amount numeric;
  flat_amount int; home_rate int;
  amount numeric := 0;
BEGIN
  IF _end <= _start THEN
    RETURN jsonb_build_object('amount', 0,
      'breakdown', jsonb_build_object('error','end_before_start'));
  END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'No active pricing version'; END IF;

  SELECT day_min, night_min INTO d_min, n_min
    FROM public._split_day_night_minutes(_start, _end);
  total_min := d_min + n_min;

  home_busy := COALESCE(public._pricing_modifier(v_id, 'home_busy_applies'), 0);
  busy_mult := CASE WHEN _environment = 'busy'
                    THEN COALESCE(public._pricing_modifier(v_id, 'busy_mult'), 1.25)
                    ELSE 1.0 END;

  product := CASE
    WHEN ck IN ('home','home_care')           THEN 'home'
    WHEN ck LIKE '24%' OR ck = 'straight_24h' THEN 'straight_24h'
    WHEN ck LIKE '48%' OR ck LIKE 'weekend%' OR ck = 'straight_48h' THEN 'straight_48h'
    ELSE 'standard'
  END;

  IF product = 'straight_24h' THEN
    flat_amount := COALESCE(public._pricing_flat(v_id, 'straight_24h'), 36000);
    amount := ROUND(flat_amount * busy_mult);
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object('product','straight_24h','flat',flat_amount,
        'multiplier',busy_mult,'pricing_version_id', v_id));
  END IF;

  IF product = 'straight_48h' THEN
    flat_amount := COALESCE(public._pricing_flat(v_id, 'straight_48h'), 72000);
    amount := ROUND(flat_amount * busy_mult);
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object('product','straight_48h','flat',flat_amount,
        'multiplier',busy_mult,'pricing_version_id', v_id));
  END IF;

  total_days := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_end - _start)) / 86400.0)::int);
  per_day_min := CASE WHEN total_days > 0 THEN total_min / total_days ELSE total_min END;
  per_day_d := CASE WHEN total_days > 0 THEN d_min / total_days ELSE d_min END;
  per_day_n := per_day_min - per_day_d;

  IF product = 'home' THEN
    home_rate := COALESCE(public._pricing_flat(v_id, 'home_hour'), 12000);
    per_day_amount := ROUND((per_day_min::numeric / 60.0) * home_rate
                       * CASE WHEN home_busy = 1 THEN busy_mult ELSE 1.0 END);
    amount := per_day_amount * total_days;
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object('product','home',
        'per_day_min', per_day_min,'days', total_days,
        'rate', home_rate,
        'multiplier', CASE WHEN home_busy = 1 THEN busy_mult ELSE 1.0 END,
        'pricing_version_id', v_id));
  END IF;

  tier := public._tier_for_per_day_hours(per_day_min::numeric / 60.0);
  SELECT pr.rate_day, pr.rate_night INTO rates_row FROM public._pricing_rate(v_id, tier) pr;
  rate_day := COALESCE(rates_row.rate_day, 2000);
  rate_night := COALESCE(rates_row.rate_night, 1500);
  per_day_amount := ROUND(((per_day_d::numeric / 60.0) * rate_day
                         + (per_day_n::numeric / 60.0) * rate_night) * busy_mult);
  amount := per_day_amount * total_days;

  RETURN jsonb_build_object('amount', amount,
    'breakdown', jsonb_build_object(
      'product','standard','tier',tier,
      'per_day_min', per_day_min,'days', total_days,
      'per_day_day_min', per_day_d,'per_day_night_min', per_day_n,
      'rate_day',rate_day,'rate_night',rate_night,
      'multiplier',busy_mult,'environment',_environment,
      'pricing_version_id', v_id));
END $$;

CREATE OR REPLACE FUNCTION public.get_request_billing_state(_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.coverage_requests; BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() AND r.accepted_by <> auth.uid()
     AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN jsonb_build_object(
    'status', r.status,
    'environment', r.environment,
    'total_billed_amount', r.total_billed_amount,
    'base_amount', r.base_amount,
    'surcharge_amount', r.surcharge_amount,
    'payment_status', r.payment_status,
    'payment_due_at', r.payment_due_at,
    'payment_extension_count', r.payment_extension_count,
    'billing_locked_at', r.billing_locked_at,
    'server_now', now(),
    'day_index', r.day_index,
    'days', r.days,
    'rate_snapshot', r.rate_snapshot,
    'segments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'segment_index', s.segment_index,
        'day_index', s.day_index,
        'started_at', s.started_at, 'ended_at', s.ended_at,
        'billed_minutes', s.billed_minutes,
        'billed_amount', s.billed_amount,
        'settled_at', s.settled_at
      ) ORDER BY s.segment_index)
      FROM public.shift_segments s WHERE s.request_id = _request_id
    ), '[]'::jsonb),
    'days_breakdown', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'day_index', d.day_index,
        'worked_min', d.worked_min,
        'billable_min', d.billable_min,
        'amount', d.amount
      ) ORDER BY d.day_index)
      FROM (
        SELECT s.day_index,
               SUM(GREATEST(0, EXTRACT(EPOCH FROM (s.ended_at - s.started_at))::int / 60))::int AS worked_min,
               SUM(s.billed_minutes)::int AS billable_min,
               SUM(s.billed_amount)       AS amount
          FROM public.shift_segments s
         WHERE s.request_id = _request_id AND s.ended_at IS NOT NULL
         GROUP BY s.day_index
      ) d
    ), '[]'::jsonb)
  );
END $$;
