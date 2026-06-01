
CREATE TABLE public.doctor_presence (
  user_id uuid PRIMARY KEY,
  online boolean NOT NULL DEFAULT false,
  top numeric NOT NULL DEFAULT 0.5,
  "left" numeric NOT NULL DEFAULT 0.5,
  last_seen timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_presence TO authenticated;
GRANT ALL ON public.doctor_presence TO service_role;

ALTER TABLE public.doctor_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read presence"
ON public.doctor_presence FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Approved doctors insert own presence"
ON public.doctor_presence FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.verification_status = 'approved'::verification_status
  )
);

CREATE POLICY "Approved doctors update own presence"
ON public.doctor_presence FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.verification_status = 'approved'::verification_status
  )
);

CREATE POLICY "Doctors delete own presence"
ON public.doctor_presence FOR DELETE
TO authenticated
USING (user_id = auth.uid());

CREATE TRIGGER set_doctor_presence_updated_at
BEFORE UPDATE ON public.doctor_presence
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.doctor_presence REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.doctor_presence;
