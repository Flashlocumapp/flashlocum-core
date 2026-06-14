
CREATE OR REPLACE FUNCTION public.start_shift(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.coverage_requests; now_ms bigint := (EXTRACT(EPOCH FROM now())*1000)::bigint;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can start this shift'; END IF;
  IF r.started_at IS NOT NULL THEN RAISE EXCEPTION 'Shift already started'; END IF;
  UPDATE public.coverage_requests
     SET started_at = now_ms, status = 'active'
   WHERE id = _request_id;
  INSERT INTO public.shift_segments(request_id, segment_index, started_at)
  VALUES (_request_id, 1, now());
  RETURN jsonb_build_object('started_at', now());
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
  kind := CASE WHEN lower(coalesce(r.coverage_type,'')) LIKE 'home%' THEN 'home' ELSE 'standard' END;
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
  kind := CASE WHEN lower(coalesce(r.coverage_type,'')) LIKE 'home%' THEN 'home' ELSE 'standard' END;
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
         settled_amount = COALESCE(total_billed_amount, settled_amount)::int
   WHERE id = _request_id
   RETURNING * INTO r;
  RETURN jsonb_build_object(
    'total_billed_amount', r.total_billed_amount,
    'payment_due_at', due
  );
END $$;
