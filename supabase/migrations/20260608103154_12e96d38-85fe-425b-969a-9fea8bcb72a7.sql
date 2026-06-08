
-- 1) Hide requester phone from doctors browsing the broadcast board.
-- Revoke table-wide SELECT and re-grant per column, excluding `phone`.
REVOKE SELECT ON public.coverage_requests FROM authenticated;
GRANT SELECT (
  id, requester_id, hospital, area, coverage_type, day,
  start_time, end_time, start_ts, end_ts, duration_hrs,
  amount, fee_pct, note, accommodation, status, accepted_by,
  started_at, accumulated_ms, settled_amount, days, day_index,
  cancelled_by, created_at, updated_at
) ON public.coverage_requests TO authenticated;

-- Secure helper: only the requester or the accepted doctor can read the phone.
CREATE OR REPLACE FUNCTION public.list_my_request_phones()
RETURNS TABLE(id uuid, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, phone
    FROM public.coverage_requests
   WHERE requester_id = auth.uid() OR accepted_by = auth.uid()
$$;
REVOKE EXECUTE ON FUNCTION public.list_my_request_phones() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_my_request_phones() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_request_phone(_request_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT phone
    FROM public.coverage_requests
   WHERE id = _request_id
     AND (requester_id = auth.uid() OR accepted_by = auth.uid())
$$;
REVOKE EXECUTE ON FUNCTION public.get_request_phone(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_request_phone(uuid) TO authenticated;

-- 2) Prevent requesters from tampering with sensitive fields on their own
-- requests. Admins remain unrestricted.
CREATE OR REPLACE FUNCTION public.prevent_requester_sensitive_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  -- Only restrict when the requester themselves is doing the update.
  IF NEW.requester_id = auth.uid() AND OLD.requester_id = auth.uid() THEN
    NEW.accepted_by    := OLD.accepted_by;
    NEW.settled_amount := OLD.settled_amount;
    NEW.started_at     := OLD.started_at;
    NEW.accumulated_ms := OLD.accumulated_ms;
    NEW.requester_id   := OLD.requester_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coverage_requests_prevent_requester_sensitive_change
  ON public.coverage_requests;
CREATE TRIGGER coverage_requests_prevent_requester_sensitive_change
BEFORE UPDATE ON public.coverage_requests
FOR EACH ROW EXECUTE FUNCTION public.prevent_requester_sensitive_change();

-- 3) Lock down SECURITY DEFINER helpers so anonymous callers cannot execute them.
REVOKE EXECUTE ON FUNCTION public.claim_first_admin()        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.claim_first_admin()        TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_overview_stats()     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_overview_stats()     TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_list_users()         FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_list_users()         TO authenticated;

REVOKE EXECUTE ON FUNCTION public.touch_last_seen()          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.touch_last_seen()          TO authenticated;
