
-- 1. Clean up orphaned presence rows (users no longer in auth.users or not approved)
DELETE FROM public.doctor_presence dp
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = dp.user_id)
   OR NOT EXISTS (
     SELECT 1 FROM public.profiles p
     WHERE p.id = dp.user_id AND p.verification_status = 'approved'
   );

-- 2. Add cascade delete from auth.users so deleted accounts auto-remove presence
ALTER TABLE public.doctor_presence
  DROP CONSTRAINT IF EXISTS doctor_presence_user_id_fkey;
ALTER TABLE public.doctor_presence
  ADD CONSTRAINT doctor_presence_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. Ensure proper grants (table was effectively locked)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_presence TO authenticated;
GRANT ALL ON public.doctor_presence TO service_role;

-- 4. Admin management policy — admins can do anything
DROP POLICY IF EXISTS "Admins manage all presence" ON public.doctor_presence;
CREATE POLICY "Admins manage all presence" ON public.doctor_presence
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. When a profile is suspended/rejected/pending, clear their presence
CREATE OR REPLACE FUNCTION public.clear_presence_on_unapproval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.verification_status IS DISTINCT FROM 'approved' THEN
    DELETE FROM public.doctor_presence WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_presence_on_unapproval ON public.profiles;
CREATE TRIGGER trg_clear_presence_on_unapproval
  AFTER UPDATE OF verification_status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.clear_presence_on_unapproval();
