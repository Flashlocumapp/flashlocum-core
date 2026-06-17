CREATE OR REPLACE FUNCTION public.submit_shift_rating(_request_id uuid, _score integer, _feedback text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.coverage_requests;
  caller uuid := auth.uid();
  ratee uuid;
  ratee_id text;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _score < 1 OR _score > 5 THEN RAISE EXCEPTION 'Invalid score'; END IF;
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  -- Allow rating once the shift has been ended (awaiting payment) or fully terminal.
  IF r.status NOT IN ('awaiting_payment','completed','cancelled','no_show') THEN
    RAISE EXCEPTION 'Shift not yet terminal';
  END IF;

  IF caller = r.requester_id AND r.accepted_by IS NOT NULL THEN
    ratee := r.accepted_by;
    ratee_id := 'doc:' || ratee::text;
  ELSIF caller = r.accepted_by THEN
    ratee := r.requester_id;
    ratee_id := 'req:' || ratee::text;
  ELSE
    RAISE EXCEPTION 'Not authorized to rate this shift';
  END IF;

  INSERT INTO public.ratings(ratee_entity_id, rater_user_id, shift_id, score, feedback)
  VALUES (ratee_id, caller, r.id, _score, NULLIF(_feedback,''));

  RETURN public.get_shift_rating_state(_request_id);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Already rated' USING ERRCODE = 'unique_violation';
END $function$;