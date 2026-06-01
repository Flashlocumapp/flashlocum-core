-- Allow requesters to view the profile of any doctor who has accepted one
-- of their coverage requests. Without this, the requester cannot read the
-- assigned doctor's full_name / mdcn / etc. for display on the accepted card.
CREATE POLICY "Requesters can view their assigned doctor profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.coverage_requests cr
    WHERE cr.accepted_by = profiles.id
      AND cr.requester_id = auth.uid()
  )
);