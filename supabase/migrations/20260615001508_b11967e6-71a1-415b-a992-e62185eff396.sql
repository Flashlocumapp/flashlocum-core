
-- RLS policies for doctors storage bucket
-- Path layout: doctors/{user_id}/profile/* and doctors/{user_id}/verification/*

CREATE POLICY "Doctors can read their own files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'doctors'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Doctors can upload their own files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'doctors'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Doctors can update their own files"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'doctors'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Doctors can delete their own files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'doctors'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Admins can read all doctor files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'doctors'
  AND public.has_role(auth.uid(), 'admin')
);
