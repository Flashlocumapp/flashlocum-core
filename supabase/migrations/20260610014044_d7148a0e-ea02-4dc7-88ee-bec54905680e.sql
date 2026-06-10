-- 1) Extend sensitive-field protection to doctors as well as requesters.
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

  -- Requester guard (unchanged behavior)
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
  END IF;

  -- Doctor guard: assigned doctor may only update shift-state columns.
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

-- 2) Remove coverage_requests from the realtime publication to stop
-- column-level leakage of phone numbers and payment fields.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'coverage_requests'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.coverage_requests';
  END IF;
END $$;