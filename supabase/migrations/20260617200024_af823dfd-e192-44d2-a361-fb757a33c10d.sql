
-- 1) Enforce admin account restriction on shift creation (requester)
--    and on accepting shifts (doctor) via a BEFORE trigger.

CREATE OR REPLACE FUNCTION public._cr_enforce_account_restriction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  restricted_at timestamptz;
  reason text;
  actor uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    actor := NEW.requester_id;
    IF actor IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT account_restricted_at, account_restricted_reason
      INTO restricted_at, reason
      FROM public.profiles WHERE id = actor;
    IF restricted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Account restricted: %', COALESCE(reason, 'contact support');
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Only check when a doctor is being assigned (accepted_by transitions
    -- from NULL to a uuid). Other updates (status, billing, etc.) are out
    -- of scope for this guard.
    IF NEW.accepted_by IS NOT NULL
       AND (OLD.accepted_by IS NULL OR OLD.accepted_by IS DISTINCT FROM NEW.accepted_by) THEN
      SELECT account_restricted_at, account_restricted_reason
        INTO restricted_at, reason
        FROM public.profiles WHERE id = NEW.accepted_by;
      IF restricted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Account restricted: %', COALESCE(reason, 'contact support');
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS coverage_requests_enforce_account_restriction
  ON public.coverage_requests;
CREATE TRIGGER coverage_requests_enforce_account_restriction
  BEFORE INSERT OR UPDATE ON public.coverage_requests
  FOR EACH ROW EXECUTE FUNCTION public._cr_enforce_account_restriction();

-- 2) Belt-and-suspenders: also block in claim_coverage_request (clearer error).

CREATE OR REPLACE FUNCTION public.claim_coverage_request(_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  updated int;
  restricted_at timestamptz;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid AND verification_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT account_restricted_at INTO restricted_at
    FROM public.profiles WHERE id = uid;
  IF restricted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Account restricted';
  END IF;
  UPDATE public.coverage_requests
     SET status = 'accepted', accepted_by = uid
   WHERE id = _request_id
     AND status = 'searching'
     AND accepted_by IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;

-- 3) Surface admin restriction in the banner feed alongside payment restriction.

CREATE OR REPLACE FUNCTION public.get_my_payment_restriction()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  pay_restricted_at timestamptz;
  acc_restricted_at timestamptz;
  acc_reason text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT payment_restricted_at, account_restricted_at, account_restricted_reason
    INTO pay_restricted_at, acc_restricted_at, acc_reason
    FROM public.profiles WHERE id = uid;
  RETURN jsonb_build_object(
    'restricted', (pay_restricted_at IS NOT NULL) OR (acc_restricted_at IS NOT NULL),
    'restricted_at', pay_restricted_at,
    'payment_restricted', pay_restricted_at IS NOT NULL,
    'account_restricted', acc_restricted_at IS NOT NULL,
    'account_restricted_at', acc_restricted_at,
    'account_restricted_reason', acc_reason,
    'overdue', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cr.id, 'hospital', cr.hospital,
        'total_billed_amount', cr.total_billed_amount,
        'payment_due_at', cr.payment_due_at,
        'payment_extension_count', cr.payment_extension_count
      ))
      FROM public.coverage_requests cr
      WHERE cr.requester_id = uid
        AND cr.billing_locked_at IS NOT NULL
        AND COALESCE(cr.payment_status,'') <> 'paid'
    ), '[]'::jsonb)
  );
END $$;
