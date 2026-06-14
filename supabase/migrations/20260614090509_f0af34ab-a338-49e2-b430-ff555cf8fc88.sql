
-- ============================================================
-- FlashLocum: backend authority for time, pricing, billing
-- ============================================================

-- 1. coverage_requests new columns -----------------------------
ALTER TABLE public.coverage_requests
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS payment_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_extension_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_extended_at timestamptz,
  ADD COLUMN IF NOT EXISTS total_billed_amount numeric,
  ADD COLUMN IF NOT EXISTS billing_locked_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coverage_requests_environment_check'
  ) THEN
    ALTER TABLE public.coverage_requests
      ADD CONSTRAINT coverage_requests_environment_check
      CHECK (environment IN ('normal','busy'));
  END IF;
END $$;

-- 2. profiles restriction --------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS payment_restricted_at timestamptz;

-- 3. shift_segments table --------------------------------------
CREATE TABLE IF NOT EXISTS public.shift_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.coverage_requests(id) ON DELETE CASCADE,
  segment_index int NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  billed_minutes int,
  billed_amount numeric,
  payment_reference text,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, segment_index)
);

GRANT SELECT ON public.shift_segments TO authenticated;
GRANT ALL    ON public.shift_segments TO service_role;

ALTER TABLE public.shift_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Segments visible to requester or assigned doctor" ON public.shift_segments;
CREATE POLICY "Segments visible to requester or assigned doctor"
  ON public.shift_segments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.coverage_requests cr
       WHERE cr.id = shift_segments.request_id
         AND (cr.requester_id = auth.uid() OR cr.accepted_by = auth.uid())
    )
  );

-- ============================================================
-- 4. Pricing engine (SQL, server-authoritative)
-- ============================================================

-- Day band 06:00–22:00, Night 22:00–06:00. Returns split minutes
-- of a single window.
CREATE OR REPLACE FUNCTION public._split_day_night_minutes(
  _start timestamptz, _end timestamptz
) RETURNS TABLE(day_min int, night_min int)
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  cur timestamptz;
  step interval := interval '1 minute';
  h int;
  d int := 0;
  n int := 0;
BEGIN
  IF _end <= _start THEN
    day_min := 0; night_min := 0; RETURN NEXT; RETURN;
  END IF;
  -- Cap iterations at 48h for safety
  cur := _start;
  WHILE cur < _end AND cur < _start + interval '48 hours' LOOP
    h := EXTRACT(HOUR FROM (cur AT TIME ZONE 'Africa/Lagos'))::int;
    IF h >= 6 AND h < 22 THEN d := d + 1; ELSE n := n + 1; END IF;
    cur := cur + step;
  END LOOP;
  day_min := d; night_min := n;
  RETURN NEXT;
END $$;

-- Round worked minutes up to 15-min blocks, min 60.
CREATE OR REPLACE FUNCTION public._round_billable_minutes(_worked int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(60, CEIL(GREATEST(_worked,0)::numeric / 15.0)::int * 15)
$$;

-- Core pricing. _coverage_kind: 'standard'|'home'. _environment: 'normal'|'busy'.
CREATE OR REPLACE FUNCTION public.compute_quote(
  _start timestamptz,
  _end timestamptz,
  _environment text DEFAULT 'normal',
  _coverage_kind text DEFAULT 'standard'
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  total_min int;
  d_min int;
  n_min int;
  hours numeric;
  rate_day int;
  rate_night int;
  base numeric := 0;
  mult numeric := CASE WHEN _environment = 'busy' THEN 1.25 ELSE 1.0 END;
  amount numeric;
  bucket text;
  breakdown jsonb;
BEGIN
  IF _end <= _start THEN
    RETURN jsonb_build_object('amount', 0, 'breakdown',
      jsonb_build_object('error','end_before_start'));
  END IF;

  SELECT day_min, night_min INTO d_min, n_min
    FROM public._split_day_night_minutes(_start, _end);
  total_min := d_min + n_min;
  hours := total_min::numeric / 60.0;

  -- Home Care: flat rate
  IF _coverage_kind = 'home' THEN
    base := hours * 15000;
    amount := ROUND(base * mult);
    RETURN jsonb_build_object(
      'amount', amount,
      'breakdown', jsonb_build_object(
        'kind','home','hours',hours,'rate',15000,
        'multiplier',mult,'environment',_environment
      )
    );
  END IF;

  -- Fixed 24h / 48h flats
  IF total_min = 1440 THEN
    amount := ROUND(36000 * mult);
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object('kind','flat_24h','multiplier',mult));
  END IF;
  IF total_min = 2880 THEN
    amount := ROUND(72000 * mult);
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object('kind','flat_48h','multiplier',mult));
  END IF;

  -- Pick bucket from per-shift hours
  IF hours >= 6 THEN
    rate_day := 2000; rate_night := 1500; bucket := '6h+';
  ELSIF hours >= 4 THEN
    rate_day := 2500; rate_night := 2000; bucket := '4-6h';
  ELSE
    rate_day := 3000; rate_night := 2500; bucket := '<4h';
  END IF;

  base := (d_min::numeric / 60.0) * rate_day
        + (n_min::numeric / 60.0) * rate_night;
  amount := ROUND(base * mult);

  RETURN jsonb_build_object(
    'amount', amount,
    'breakdown', jsonb_build_object(
      'kind','standard','bucket',bucket,
      'day_min',d_min,'night_min',n_min,
      'rate_day',rate_day,'rate_night',rate_night,
      'multiplier',mult,'environment',_environment
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.compute_quote(timestamptz,timestamptz,text,text) TO authenticated, anon;

-- ============================================================
-- 5. Scheduling + clock RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.server_now()
RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() $$;
GRANT EXECUTE ON FUNCTION public.server_now() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.validate_shift_schedule(
  _start timestamptz, _end timestamptz
) RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
BEGIN
  IF _start IS NULL OR _end IS NULL THEN
    RAISE EXCEPTION 'Start and end required';
  END IF;
  IF _end <= _start THEN
    RAISE EXCEPTION 'End time must be after start time';
  END IF;
  IF _start < now() + interval '30 minutes' THEN
    RAISE EXCEPTION 'Booking lead time must be at least 30 minutes';
  END IF;
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION public.validate_shift_schedule(timestamptz,timestamptz) TO authenticated;

-- ============================================================
-- 6. Shift lifecycle (requester-only)
-- ============================================================

CREATE OR REPLACE FUNCTION public.start_shift(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.coverage_requests; BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can start this shift'; END IF;
  IF r.started_at IS NOT NULL THEN RAISE EXCEPTION 'Shift already started'; END IF;
  UPDATE public.coverage_requests
     SET started_at = now(), status = 'active'
   WHERE id = _request_id;
  INSERT INTO public.shift_segments(request_id, segment_index, started_at)
  VALUES (_request_id, 1, now());
  RETURN jsonb_build_object('started_at', now());
END $$;
GRANT EXECUTE ON FUNCTION public.start_shift(uuid) TO authenticated;

-- helper: bill a single segment using its own start/end
CREATE OR REPLACE FUNCTION public._bill_segment(
  _seg_id uuid, _env text, _kind text
) RETURNS numeric
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  seg public.shift_segments;
  worked_min int;
  billable int;
  amount numeric;
  q jsonb;
BEGIN
  SELECT * INTO seg FROM public.shift_segments WHERE id = _seg_id FOR UPDATE;
  IF seg.ended_at IS NULL THEN
    RAISE EXCEPTION 'Segment not yet ended';
  END IF;
  worked_min := GREATEST(0, EXTRACT(EPOCH FROM (seg.ended_at - seg.started_at))::int / 60);
  billable := public._round_billable_minutes(worked_min);
  -- price as a synthetic window of `billable` minutes starting at seg.started_at
  q := public.compute_quote(seg.started_at,
                            seg.started_at + make_interval(mins => billable),
                            _env, _kind);
  amount := (q->>'amount')::numeric;
  UPDATE public.shift_segments
     SET billed_minutes = billable, billed_amount = amount
   WHERE id = _seg_id;
  RETURN amount;
END $$;

CREATE OR REPLACE FUNCTION public.pause_shift(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.coverage_requests;
  seg public.shift_segments;
  kind text;
  amount numeric;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can pause this shift'; END IF;
  IF r.status <> 'active' THEN RAISE EXCEPTION 'Shift is not active'; END IF;
  kind := CASE WHEN lower(coalesce(r.coverage,'')) LIKE 'home%' THEN 'home' ELSE 'standard' END;
  SELECT * INTO seg FROM public.shift_segments
   WHERE request_id = _request_id AND ended_at IS NULL
   ORDER BY segment_index DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No open segment'; END IF;
  UPDATE public.shift_segments SET ended_at = now() WHERE id = seg.id;
  amount := public._bill_segment(seg.id, r.environment, kind);
  UPDATE public.coverage_requests
     SET status = 'paused',
         total_billed_amount = COALESCE(total_billed_amount,0) + amount,
         payment_due_at = now() + interval '15 minutes'
   WHERE id = _request_id;
  RETURN jsonb_build_object('segment_id', seg.id, 'segment_amount', amount,
                            'payment_due_at', now() + interval '15 minutes');
END $$;
GRANT EXECUTE ON FUNCTION public.pause_shift(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.resume_shift(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.coverage_requests;
  unsettled int;
  next_idx int;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can resume'; END IF;
  IF r.status <> 'paused' THEN RAISE EXCEPTION 'Shift is not paused'; END IF;
  SELECT count(*) INTO unsettled FROM public.shift_segments
   WHERE request_id = _request_id AND ended_at IS NOT NULL AND settled_at IS NULL;
  IF unsettled > 0 THEN
    RAISE EXCEPTION 'Previous segment must be paid before resuming';
  END IF;
  SELECT COALESCE(MAX(segment_index),0)+1 INTO next_idx
    FROM public.shift_segments WHERE request_id = _request_id;
  INSERT INTO public.shift_segments(request_id, segment_index, started_at)
  VALUES (_request_id, next_idx, now());
  UPDATE public.coverage_requests SET status = 'active', payment_due_at = NULL
   WHERE id = _request_id;
  RETURN jsonb_build_object('segment_index', next_idx);
END $$;
GRANT EXECUTE ON FUNCTION public.resume_shift(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.end_shift(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.coverage_requests;
  seg public.shift_segments;
  kind text;
  amount numeric;
  due timestamptz := now() + interval '15 minutes';
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can end this shift'; END IF;
  IF r.status NOT IN ('active','paused') THEN RAISE EXCEPTION 'Shift is not in progress'; END IF;
  kind := CASE WHEN lower(coalesce(r.coverage,'')) LIKE 'home%' THEN 'home' ELSE 'standard' END;
  -- close any open segment
  SELECT * INTO seg FROM public.shift_segments
   WHERE request_id = _request_id AND ended_at IS NULL
   ORDER BY segment_index DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE public.shift_segments SET ended_at = now() WHERE id = seg.id;
    amount := public._bill_segment(seg.id, r.environment, kind);
    UPDATE public.coverage_requests
       SET total_billed_amount = COALESCE(total_billed_amount,0) + amount
     WHERE id = _request_id;
  END IF;
  UPDATE public.coverage_requests
     SET status = 'completed',
         billing_locked_at = now(),
         payment_due_at = due,
         settled_amount = COALESCE(total_billed_amount, settled_amount)
   WHERE id = _request_id
   RETURNING * INTO r;
  RETURN jsonb_build_object(
    'total_billed_amount', r.total_billed_amount,
    'payment_due_at', due
  );
END $$;
GRANT EXECUTE ON FUNCTION public.end_shift(uuid) TO authenticated;

-- ============================================================
-- 7. Payment window extension + restriction
-- ============================================================

CREATE OR REPLACE FUNCTION public.extend_payment_window(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.coverage_requests;
  rate_per_hour int;
  block_charge numeric;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF COALESCE(r.payment_status,'') = 'paid' THEN
    RETURN jsonb_build_object('skipped','already_paid');
  END IF;
  IF r.payment_due_at IS NULL OR now() < r.payment_due_at THEN
    RETURN jsonb_build_object('skipped','window_not_expired',
      'payment_due_at', r.payment_due_at);
  END IF;
  -- charge a 15-min block at the effective bucket rate (use 2000 baseline day rate)
  rate_per_hour := 2000;
  block_charge := ROUND((rate_per_hour::numeric / 4.0)
    * CASE WHEN r.environment='busy' THEN 1.25 ELSE 1.0 END);
  UPDATE public.coverage_requests
     SET total_billed_amount = COALESCE(total_billed_amount,0) + block_charge,
         settled_amount = COALESCE(total_billed_amount,0) + block_charge,
         payment_due_at = now() + interval '15 minutes',
         payment_extension_count = payment_extension_count + 1,
         last_extended_at = now()
   WHERE id = _request_id
   RETURNING * INTO r;
  -- apply restriction after 2+ extensions still unpaid
  IF r.payment_extension_count >= 2 THEN
    UPDATE public.profiles
       SET payment_restricted_at = COALESCE(payment_restricted_at, now())
     WHERE id = r.requester_id;
  END IF;
  RETURN jsonb_build_object(
    'total_billed_amount', r.total_billed_amount,
    'payment_due_at', r.payment_due_at,
    'extension_count', r.payment_extension_count,
    'added_block', block_charge
  );
END $$;
GRANT EXECUTE ON FUNCTION public.extend_payment_window(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_request_billing_state(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
    'payment_status', r.payment_status,
    'payment_due_at', r.payment_due_at,
    'payment_extension_count', r.payment_extension_count,
    'billing_locked_at', r.billing_locked_at,
    'server_now', now(),
    'segments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'segment_index', s.segment_index,
        'started_at', s.started_at, 'ended_at', s.ended_at,
        'billed_minutes', s.billed_minutes,
        'billed_amount', s.billed_amount,
        'settled_at', s.settled_at
      ) ORDER BY s.segment_index)
      FROM public.shift_segments s WHERE s.request_id = _request_id
    ), '[]'::jsonb)
  );
END $$;
GRANT EXECUTE ON FUNCTION public.get_request_billing_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_payment_restriction()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); restricted_at timestamptz; BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT payment_restricted_at INTO restricted_at FROM public.profiles WHERE id = uid;
  RETURN jsonb_build_object(
    'restricted', restricted_at IS NOT NULL,
    'restricted_at', restricted_at,
    'overdue', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cr.id, 'hospital', cr.hospital,
        'total_billed_amount', cr.total_billed_amount,
        'payment_due_at', cr.payment_due_at,
        'payment_extension_count', cr.payment_extension_count
      ))
      FROM public.coverage_requests cr
      WHERE cr.requester_id = uid
        AND cr.billing_locked_at IS NOT NULL
        AND COALESCE(cr.payment_status,'') <> 'paid'
    ), '[]'::jsonb)
  );
END $$;
GRANT EXECUTE ON FUNCTION public.get_my_payment_restriction() TO authenticated;

-- Extend mark_settlement_paid to clear restriction + mark segments
CREATE OR REPLACE FUNCTION public.mark_settlement_paid(_payment_reference text, _amount numeric)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE updated INT; r_id uuid; req_uid uuid; remaining INT;
BEGIN
  PERFORM 1 FROM public.coverage_requests
   WHERE payment_reference = _payment_reference FOR UPDATE;
  UPDATE public.coverage_requests
     SET payment_status = 'paid',
         paid_at = COALESCE(paid_at, now()),
         settled_amount = COALESCE(settled_amount, _amount)
   WHERE payment_reference = _payment_reference
     AND COALESCE(payment_status,'') <> 'paid'
   RETURNING id, requester_id INTO r_id, req_uid;
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated > 0 THEN
    UPDATE public.shift_segments
       SET settled_at = COALESCE(settled_at, now())
     WHERE request_id = r_id AND settled_at IS NULL;
    -- lift restriction if no more overdue unpaid shifts
    SELECT count(*) INTO remaining FROM public.coverage_requests
     WHERE requester_id = req_uid
       AND billing_locked_at IS NOT NULL
       AND COALESCE(payment_status,'') <> 'paid';
    IF remaining = 0 THEN
      UPDATE public.profiles SET payment_restricted_at = NULL WHERE id = req_uid;
    END IF;
  END IF;
  RETURN updated > 0;
END $$;
