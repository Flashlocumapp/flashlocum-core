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
  IF r.status <> 'paused' THEN RAISE EXCEPTION 'Shift cannot be resumed from %', r.status; END IF;

  v_booked_per_day := public._booked_per_day_min(r.start_time, r.end_time);
  v_product := public._effective_product(r.coverage_type, v_booked_per_day, COALESCE(r.days, 1));
  IF v_product IN ('straight_24h', 'straight_48h') THEN
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
         started_at = now_ms,
         accumulated_ms = 0
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object(
    'segment_index', next_idx,
    'day_index', di,
    'resumed_at', now()
  );
END $function$;