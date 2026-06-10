
ALTER TABLE public.coverage_requests
  ADD COLUMN IF NOT EXISTS remitted_at timestamptz;

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

CREATE OR REPLACE FUNCTION public.mark_settlement_remitted(_payment_reference text, _amount numeric)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  updated INT;
BEGIN
  UPDATE public.coverage_requests
     SET remitted_at = COALESCE(remitted_at, now()),
         settled_amount = COALESCE(settled_amount, _amount)
   WHERE payment_reference = _payment_reference
     AND payment_status = 'paid'
     AND remitted_at IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.mark_settlement_remitted(text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_settlement_remitted(text, numeric) TO service_role;
