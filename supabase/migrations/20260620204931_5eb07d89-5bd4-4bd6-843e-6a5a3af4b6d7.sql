DROP POLICY IF EXISTS "Presence readable by self admin or online approved doctor" ON public.doctor_presence;

CREATE POLICY "Presence readable by self admin or approved doctor"
  ON public.doctor_presence
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = doctor_presence.user_id
        AND p.verification_status = 'approved'::verification_status
    )
    OR EXISTS (
      SELECT 1 FROM public.coverage_requests cr
      WHERE cr.accepted_by = doctor_presence.user_id
        AND cr.requester_id = auth.uid()
    )
  );