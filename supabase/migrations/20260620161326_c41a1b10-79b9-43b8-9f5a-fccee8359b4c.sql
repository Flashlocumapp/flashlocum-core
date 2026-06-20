-- Audit 2: real GPS coords for doctor presence (event-driven writes only)
ALTER TABLE public.doctor_presence
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

-- Audit 1: replace SELECT policy so any authenticated user can see
-- online + approved doctors. Self/admin/assigned-requester reads still work.
DROP POLICY IF EXISTS "Presence readable by self admin or assigned requester"
  ON public.doctor_presence;

CREATE POLICY "Presence readable by self admin or online approved doctor"
  ON public.doctor_presence
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR (
      online = true
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = doctor_presence.user_id
           AND p.verification_status = 'approved'
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.coverage_requests cr
       WHERE cr.accepted_by = doctor_presence.user_id
         AND cr.requester_id = auth.uid()
    )
  );

-- Audit 1: SECURITY DEFINER RPC for the initial roster fetch. Bypasses the
-- per-row EXISTS in the SELECT policy and returns only safe presence fields
-- for online + approved doctors. No profile fields are exposed.
CREATE OR REPLACE FUNCTION public.list_online_approved_doctors()
RETURNS TABLE (
  user_id    uuid,
  online     boolean,
  last_seen  timestamptz,
  top        double precision,
  "left"     double precision,
  lat        double precision,
  lng        double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT dp.user_id, dp.online, dp.last_seen, dp.top, dp."left", dp.lat, dp.lng
    FROM public.doctor_presence dp
    JOIN public.profiles p ON p.id = dp.user_id
   WHERE dp.online = true
     AND p.verification_status = 'approved'
     AND dp.last_seen > now() - interval '90 seconds';
$$;

REVOKE ALL ON FUNCTION public.list_online_approved_doctors() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_online_approved_doctors() TO authenticated;