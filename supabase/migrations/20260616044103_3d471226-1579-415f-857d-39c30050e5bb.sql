-- Multi-day shift rule: one continuous timed assignment, one final payment at End.
-- pause_shift no longer bills or touches payment fields.
-- resume_shift no longer requires prior payment.
-- end_shift bills every previously unbilled (closed) segment.

CREATE OR REPLACE FUNCTION public.pause_shift(_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.coverage_requests;
  seg public.shift_segments;
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

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status = 'paused'
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object('segment_id', seg.id, 'paused_at', now());
END $function$;

CREATE OR REPLACE FUNCTION public.resume_shift(_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.coverage_requests;
  next_idx int;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can resume'; END IF;
  IF r.status <> 'paused' THEN RAISE EXCEPTION 'Shift is not paused'; END IF;

  SELECT COALESCE(MAX(segment_index),0)+1 INTO next_idx
    FROM public.shift_segments WHERE request_id = _request_id;
  INSERT INTO public.shift_segments(request_id, segment_index, started_at)
  VALUES (_request_id, next_idx, now());

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status = 'active',
         payment_due_at = NULL
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object('segment_index', next_idx);
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
  kind text;
  v_amount numeric;
  v_total numeric := 0;
  due timestamptz := now() + interval '15 minutes';
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can end this shift'; END IF;
  IF r.status NOT IN ('active','paused') THEN RAISE EXCEPTION 'Shift is not in progress'; END IF;
  kind := CASE WHEN lower(coalesce(r.coverage_type,'')) LIKE 'home%' THEN 'home' ELSE 'standard' END;

  -- Close any still-open segment.
  FOR seg IN
    SELECT * FROM public.shift_segments
     WHERE request_id = _request_id AND ended_at IS NULL
     FOR UPDATE
  LOOP
    UPDATE public.shift_segments SET ended_at = now() WHERE id = seg.id;
  END LOOP;

  -- Bill every segment that has not yet been billed.
  FOR seg IN
    SELECT * FROM public.shift_segments
     WHERE request_id = _request_id
       AND ended_at IS NOT NULL
       AND billed_amount IS NULL
     ORDER BY segment_index
     FOR UPDATE
  LOOP
    v_amount := public._bill_segment(seg.id, r.environment, kind);
    v_total := v_total + COALESCE(v_amount, 0);
  END LOOP;

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status = 'completed',
         billing_locked_at = now(),
         total_billed_amount = COALESCE(total_billed_amount,0) + v_total,
         payment_due_at = due,
         settled_amount = COALESCE(total_billed_amount,0) + v_total,
         payment_status = 'pending',
         payment_reference = NULL,
         payment_url = NULL,
         paid_at = NULL
   WHERE id = _request_id
   RETURNING * INTO r;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object(
    'total_billed_amount', r.total_billed_amount,
    'payment_due_at', due
  );
END $function$;