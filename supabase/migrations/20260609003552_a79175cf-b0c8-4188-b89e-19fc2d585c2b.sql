
-- 1) Lock requester UPDATE on coverage_requests: prevent editing payment/financial fields
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
    NEW.accepted_by      := OLD.accepted_by;
    NEW.settled_amount   := OLD.settled_amount;
    NEW.started_at       := OLD.started_at;
    NEW.accumulated_ms   := OLD.accumulated_ms;
    NEW.requester_id     := OLD.requester_id;
    NEW.payment_status   := OLD.payment_status;
    NEW.payment_reference:= OLD.payment_reference;
    NEW.paid_at          := OLD.paid_at;
    NEW.fee_pct          := OLD.fee_pct;
  END IF;
  RETURN NEW;
END;
$function$;

-- Ensure trigger is attached (idempotent)
DROP TRIGGER IF EXISTS prevent_requester_sensitive_change_trg ON public.coverage_requests;
CREATE TRIGGER prevent_requester_sensitive_change_trg
  BEFORE UPDATE ON public.coverage_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_requester_sensitive_change();

-- 2) Remove profiles from Realtime publication (sensitive PII / banking fields)
ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles;

-- 3) Revoke EXECUTE on SECURITY DEFINER trust-metric RPCs from anon/PUBLIC
REVOKE EXECUTE ON FUNCTION public.get_rating(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_reliability(text) FROM PUBLIC, anon;
