
-- 1. Tighten doctor_presence SELECT: self, admin, or requester of an assignment
DROP POLICY IF EXISTS "Presence readable by self admin or approved doctor" ON public.doctor_presence;
CREATE POLICY "Presence readable by self admin or assigned requester"
ON public.doctor_presence
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.coverage_requests cr
    WHERE cr.accepted_by = doctor_presence.user_id
      AND cr.requester_id = auth.uid()
  )
);

-- 2. Tighten ratings SELECT: rater, ratee (via entity id), or admin only
DROP POLICY IF EXISTS "Ratings readable by participants or admin" ON public.ratings;
CREATE POLICY "Ratings readable by rater ratee or admin"
ON public.ratings
FOR SELECT
TO authenticated
USING (
  rater_user_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR ratee_entity_id = ('doc:' || auth.uid()::text)
  OR ratee_entity_id = ('req:' || auth.uid()::text)
);

-- 3. Tighten realtime authorization: only allow the coverage_invalidations broadcast topic
DROP POLICY IF EXISTS "Authenticated can read coverage invalidations" ON realtime.messages;
CREATE POLICY "Authenticated can read coverage invalidations"
ON realtime.messages
FOR SELECT
TO authenticated
USING (extension = 'broadcast' AND topic = 'coverage_invalidations');

-- 4. Revoke anon execute on the trigger function
REVOKE EXECUTE ON FUNCTION public.profiles_block_privileged_self_edits() FROM anon, PUBLIC;
