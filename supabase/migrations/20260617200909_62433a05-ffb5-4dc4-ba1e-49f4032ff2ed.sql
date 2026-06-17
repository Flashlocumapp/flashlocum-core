
-- 1) Block restricted doctors from going online.
-- Existing doctor_presence RLS uses current_user_is_approved_doctor();
-- extending the helper transparently blocks presence writes.
CREATE OR REPLACE FUNCTION public.current_user_is_approved_doctor()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid()
       AND verification_status = 'approved'
       AND account_restricted_at IS NULL
  )
$$;

-- 2) Block restricted requesters from starting a shift.
CREATE OR REPLACE FUNCTION public.start_shift(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  UPDATE public.coverage_requests
     SET started_at = now_ms, status = 'active'
   WHERE id = _request_id;
  INSERT INTO public.shift_segments(request_id, segment_index, started_at)
  VALUES (_request_id, 1, now());
  RETURN jsonb_build_object('started_at', now());
END
$$;

-- 3) Block restricted requesters from resuming a paused shift.
CREATE OR REPLACE FUNCTION public.resume_shift(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.coverage_requests;
  next_idx int;
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
     SET status = 'active',
         payment_due_at = NULL
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object('segment_index', next_idx);
END
$$;
