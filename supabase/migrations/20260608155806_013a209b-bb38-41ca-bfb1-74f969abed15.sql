
-- 1) Atomic claim RPC. Hides phone (no column-level SELECT exposure).
CREATE OR REPLACE FUNCTION public.claim_coverage_request(_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  updated int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND verification_status = 'approved') THEN
    RAISE EXCEPTION 'Not authorized';
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

REVOKE ALL ON FUNCTION public.claim_coverage_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_coverage_request(uuid) TO authenticated;

-- 2) Tighten doctor UPDATE policy: doctors can ONLY update rows they already
-- own. Claiming a searching row now happens exclusively through the RPC above,
-- so the USING clause no longer exposes phone to all approved doctors.
DROP POLICY IF EXISTS "Approved doctors claim or update assignments" ON public.coverage_requests;
CREATE POLICY "Approved doctors update own assignments"
  ON public.coverage_requests
  FOR UPDATE
  TO authenticated
  USING (accepted_by = auth.uid())
  WITH CHECK (accepted_by = auth.uid());

-- 3) Requester-facing assigned-doctor profile: drop the broad row policy and
-- expose only safe columns through a SECURITY DEFINER RPC.
DROP POLICY IF EXISTS "Requesters can view their assigned doctor profile" ON public.profiles;

CREATE OR REPLACE FUNCTION public.get_assigned_doctor_profile(_doctor uuid)
RETURNS TABLE(
  id uuid,
  full_name text,
  gender text,
  mdcn text,
  selfie_url text,
  years_experience text,
  verification_status verification_status
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.gender, p.mdcn, p.selfie_url, p.years_experience, p.verification_status
    FROM public.profiles p
   WHERE p.id = _doctor
     AND EXISTS (
       SELECT 1 FROM public.coverage_requests cr
        WHERE cr.accepted_by = _doctor
          AND cr.requester_id = auth.uid()
     )
$$;

REVOKE ALL ON FUNCTION public.get_assigned_doctor_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_assigned_doctor_profile(uuid) TO authenticated;

-- 4) Realtime: exclude phone from the published payload on coverage_requests.
ALTER PUBLICATION supabase_realtime DROP TABLE public.coverage_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.coverage_requests
  (id, requester_id, hospital, area, coverage_type, day, start_time, end_time,
   start_ts, end_ts, duration_hrs, amount, fee_pct, note, accommodation,
   status, accepted_by, started_at, accumulated_ms, settled_amount,
   days, day_index, cancelled_by, created_at, updated_at);

-- 5) Lock down SECURITY DEFINER functions that don't need public/anon EXECUTE.
REVOKE EXECUTE ON FUNCTION public.is_assigned_doctor_of(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.clear_presence_on_unapproval() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_requester_sensitive_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_self_verification_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated;
