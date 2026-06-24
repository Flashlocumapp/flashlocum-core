
-- 1. Columns
ALTER TABLE public.coverage_requests
  ADD COLUMN IF NOT EXISTS cancellation_reason_code text,
  ADD COLUMN IF NOT EXISTS cancellation_reason_text text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- 2. Validation trigger
CREATE OR REPLACE FUNCTION public.validate_cancellation_reason()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  requester_codes text[] := ARRAY['no_longer_needed','schedule_changed','wrong_details','found_alternative','other'];
  doctor_codes    text[] := ARRAY['personal_emergency','illness','scheduling_conflict','travel_issue','other'];
BEGIN
  -- Only validate on the transition TO cancelled, or on an UPDATE that touches the reason while already cancelled.
  IF NEW.status = 'cancelled'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'cancelled'
          OR NEW.cancellation_reason_code IS DISTINCT FROM OLD.cancellation_reason_code
          OR NEW.cancellation_reason_text IS DISTINCT FROM OLD.cancellation_reason_text)
  THEN
    -- Pre-acceptance silent cancels (no accepted_by, requester aborts before any match) skip reason capture.
    -- All post-acceptance cancels MUST include a reason code.
    IF NEW.accepted_by IS NOT NULL THEN
      IF NEW.cancellation_reason_code IS NULL OR length(trim(NEW.cancellation_reason_code)) = 0 THEN
        RAISE EXCEPTION 'cancellation_reason_code is required for post-acceptance cancellations';
      END IF;

      IF NEW.cancelled_by = 'requester' AND NOT (NEW.cancellation_reason_code = ANY(requester_codes)) THEN
        RAISE EXCEPTION 'Invalid requester cancellation reason: %', NEW.cancellation_reason_code;
      END IF;
      IF NEW.cancelled_by = 'doctor' AND NOT (NEW.cancellation_reason_code = ANY(doctor_codes)) THEN
        RAISE EXCEPTION 'Invalid doctor cancellation reason: %', NEW.cancellation_reason_code;
      END IF;

      IF NEW.cancellation_reason_code = 'other'
         AND (NEW.cancellation_reason_text IS NULL OR length(trim(NEW.cancellation_reason_text)) = 0)
      THEN
        RAISE EXCEPTION 'A free-text explanation is required when reason is "other"';
      END IF;
    END IF;

    IF NEW.cancelled_at IS NULL THEN
      NEW.cancelled_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_cancellation_reason_trg ON public.coverage_requests;
CREATE TRIGGER validate_cancellation_reason_trg
BEFORE INSERT OR UPDATE OF status, cancellation_reason_code, cancellation_reason_text, cancelled_by
ON public.coverage_requests
FOR EACH ROW
EXECUTE FUNCTION public.validate_cancellation_reason();

-- 3. Admin RPC
CREATE OR REPLACE FUNCTION public.admin_list_cancellations(_limit int DEFAULT 200)
RETURNS TABLE (
  shift_id uuid,
  cancelled_at timestamptz,
  cancelled_by text,
  actor_user_id uuid,
  actor_name text,
  reason_code text,
  reason_text text,
  hospital text,
  start_time text,
  end_time text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    cr.id,
    cr.cancelled_at,
    cr.cancelled_by,
    CASE WHEN cr.cancelled_by = 'doctor' THEN cr.accepted_by ELSE cr.requester_id END AS actor_user_id,
    COALESCE(p.full_name, p.hospital, '—') AS actor_name,
    cr.cancellation_reason_code,
    cr.cancellation_reason_text,
    cr.hospital,
    cr.start_time,
    cr.end_time
  FROM public.coverage_requests cr
  LEFT JOIN public.profiles p
    ON p.id = CASE WHEN cr.cancelled_by = 'doctor' THEN cr.accepted_by ELSE cr.requester_id END
  WHERE cr.status = 'cancelled'
    AND cr.cancellation_reason_code IS NOT NULL
  ORDER BY cr.cancelled_at DESC NULLS LAST
  LIMIT GREATEST(_limit, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_cancellations(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_cancellations(int) TO authenticated, service_role;
