
-- Allow the lifecycle SECURITY DEFINER functions to bypass the
-- prevent_requester_sensitive_change trigger when they intentionally
-- need to reset payment fields for a new billing cycle.
CREATE OR REPLACE FUNCTION public.prevent_requester_sensitive_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- Lifecycle RPCs (pause_shift / end_shift / resume_shift / start_shift)
  -- legitimately need to mutate payment & timing fields. They set this
  -- session-local flag immediately before their UPDATE.
  IF COALESCE(current_setting('app.lifecycle_bypass', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.requester_id = auth.uid() AND OLD.requester_id = auth.uid() THEN
    NEW.accepted_by       := OLD.accepted_by;
    NEW.settled_amount    := OLD.settled_amount;
    NEW.started_at        := OLD.started_at;
    NEW.accumulated_ms    := OLD.accumulated_ms;
    NEW.requester_id      := OLD.requester_id;
    NEW.payment_status    := OLD.payment_status;
    NEW.payment_reference := OLD.payment_reference;
    NEW.paid_at           := OLD.paid_at;
    NEW.fee_pct           := OLD.fee_pct;
    NEW.remitted_at       := OLD.remitted_at;
  END IF;

  IF OLD.accepted_by IS NOT NULL
     AND OLD.accepted_by = auth.uid()
     AND (NEW.requester_id IS NULL OR NEW.requester_id <> auth.uid()) THEN
    NEW.requester_id      := OLD.requester_id;
    NEW.accepted_by       := OLD.accepted_by;
    NEW.settled_amount    := OLD.settled_amount;
    NEW.payment_status    := OLD.payment_status;
    NEW.payment_reference := OLD.payment_reference;
    NEW.payment_provider  := OLD.payment_provider;
    NEW.payment_url       := OLD.payment_url;
    NEW.paid_at           := OLD.paid_at;
    NEW.fee_pct           := OLD.fee_pct;
    NEW.remitted_at       := OLD.remitted_at;
    NEW.hospital          := OLD.hospital;
    NEW.phone             := OLD.phone;
    NEW.location          := OLD.location;
    NEW.lat               := OLD.lat;
    NEW.lng               := OLD.lng;
    NEW.scheduled_start   := OLD.scheduled_start;
    NEW.scheduled_end     := OLD.scheduled_end;
    NEW.notes             := OLD.notes;
  END IF;

  RETURN NEW;
END;
$function$;

-- pause_shift: bypass the requester guard so the payment cycle truly resets.
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

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status = 'paused',
         total_billed_amount = COALESCE(total_billed_amount,0) + v_amount,
         payment_due_at = now() + interval '15 minutes',
         payment_status = 'pending',
         payment_reference = NULL,
         payment_url = NULL,
         paid_at = NULL,
         settled_amount = NULL
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object('segment_id', seg.id, 'segment_amount', v_amount,
                            'payment_due_at', now() + interval '15 minutes');
END $function$;

-- end_shift: same bypass for the final billing cycle.
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
    PERFORM set_config('app.lifecycle_bypass', 'on', true);
    UPDATE public.coverage_requests
       SET total_billed_amount = COALESCE(total_billed_amount,0) + v_amount
     WHERE id = _request_id;
    PERFORM set_config('app.lifecycle_bypass', '', true);
  END IF;

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status = 'completed',
         billing_locked_at = now(),
         payment_due_at = due,
         settled_amount = COALESCE(total_billed_amount, settled_amount)::int,
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
