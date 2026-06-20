-- Allow requesters to read the selfie files of doctors assigned to their coverage requests.
-- Mirrors the access already granted by get_assigned_doctor_profile() but at the storage layer
-- so requester clients can mint signed URLs for the assigned doctor's avatar.
CREATE POLICY "Requesters can read assigned doctor selfies"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'doctors'
  AND (storage.foldername(name))[2] = 'profile'
  AND EXISTS (
    SELECT 1 FROM public.coverage_requests cr
    WHERE cr.requester_id = auth.uid()
      AND cr.accepted_by::text = (storage.foldername(name))[1]
  )
);
