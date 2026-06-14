
-- 1. pause_shift: bill segment AND force a fresh payment cycle for the new bill.
CREATE OR REPLACE FUNCTION public.pause_shift(_request_id uuid)
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
  v_amount := public._bill_segment(seg.id, r.environment, kind);
  UPDATE public.coverage_requests
     SET status = 'paused',
         total_billed_amount = COALESCE(total_billed_amount,0) + v_amount,
         payment_due_at = now() + interval '15 minutes',
         -- Force a brand-new payment cycle for this new bill.
         payment_status = 'pending',
         payment_reference = NULL,
         payment_url = NULL,
         paid_at = NULL
   WHERE id = _request_id;
  RETURN jsonb_build_object('segment_id', seg.id, 'segment_amount', v_amount,
                            'payment_due_at', now() + interval '15 minutes');
END $function$;

-- 2. end_shift: bill final segment AND force a fresh payment cycle for the new bill.
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
    v_amount := public._bill_segment(seg.id, r.environment, kind);
    UPDATE public.coverage_requests
       SET total_billed_amount = COALESCE(total_billed_amount,0) + v_amount
     WHERE id = _request_id;
  END IF;
  UPDATE public.coverage_requests
     SET status = 'completed',
         billing_locked_at = now(),
         payment_due_at = due,
         settled_amount = COALESCE(total_billed_amount, settled_amount)::int,
         -- Force a fresh payment cycle for the final bill.
         payment_status = 'pending',
         payment_reference = NULL,
         payment_url = NULL,
         paid_at = NULL
   WHERE id = _request_id
   RETURNING * INTO r;
  RETURN jsonb_build_object(
    'total_billed_amount', r.total_billed_amount,
    'payment_due_at', due
  );
END $function$;

-- 3. mark_settlement_paid: after a paused-day payment, auto-advance multi-day
-- shifts to the next day so the doctor sees the synchronized state via
-- realtime (status='accepted', today's timer cleared, day_index bumped).
CREATE OR REPLACE FUNCTION public.mark_settlement_paid(_payment_reference text, _amount numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE updated INT; r_id uuid; req_uid uuid; remaining INT; r public.coverage_requests;
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

    -- Multi-day pause: auto-advance to the next day so both requester and
    -- doctor see Upcoming Coverage with a reset timer.
    SELECT * INTO r FROM public.coverage_requests WHERE id = r_id;
    IF r.status = 'paused' AND COALESCE(r.day_index, 1) < COALESCE(r.days, 1) THEN
      UPDATE public.coverage_requests
         SET status = 'accepted',
             accumulated_ms = 0,
             started_at = NULL,
             day_index = COALESCE(r.day_index, 1) + 1,
             payment_due_at = NULL
       WHERE id = r_id;
    END IF;

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
END $function$;
