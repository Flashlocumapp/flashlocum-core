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
  new_day_index integer;
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

  new_day_index := COALESCE(r.day_index, 1) + 1;

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
    'day_index', new_day_index
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.pause_shift(uuid) TO authenticated;