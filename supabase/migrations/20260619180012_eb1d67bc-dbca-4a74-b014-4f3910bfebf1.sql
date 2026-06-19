-- 1) pause_shift: after freezing the day's billed segment, reset accumulated_ms to 0
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
         accumulated_ms = 0,                 -- per-day freeze: new day's timer starts from zero
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

-- 2) resume_shift: ensure accumulated_ms stays at 0 for the new day's session
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
     SET status         = 'active',
         started_at     = now_ms,
         accumulated_ms = 0          -- new day session: live timer starts from zero
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);
  RETURN jsonb_build_object('resumed_at', now(), 'startedAtMs', now_ms,
                            'segment_index', next_idx, 'day_index', di);
END $function$;

-- 3) Safety trigger: any change to total_billed_amount on an unpaid row
--    invalidates the cached Monnify virtual account + reference + URL.
--    This makes "Monnify amount must always match server-calculated total"
--    enforceable at the data layer, regardless of which RPC mutated the total.
CREATE OR REPLACE FUNCTION public._invalidate_payment_cache_on_amount_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.payment_status IS DISTINCT FROM 'paid'
     AND COALESCE(NEW.total_billed_amount, 0) IS DISTINCT FROM COALESCE(OLD.total_billed_amount, 0)
  THEN
    NEW.payment_account   := NULL;
    NEW.payment_reference := NULL;
    NEW.payment_url       := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invalidate_payment_cache ON public.coverage_requests;
CREATE TRIGGER trg_invalidate_payment_cache
BEFORE UPDATE OF total_billed_amount ON public.coverage_requests
FOR EACH ROW
EXECUTE FUNCTION public._invalidate_payment_cache_on_amount_change();
