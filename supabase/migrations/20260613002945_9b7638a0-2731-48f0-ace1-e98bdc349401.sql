-- L-4: doctor_presence INSERT/UPDATE policies previously ran a fresh
-- subquery against public.profiles on every heartbeat. Replace with the
-- existing STABLE SECURITY DEFINER helper public.current_user_is_approved_doctor(),
-- which Postgres caches per statement and which scopes its own search_path.
-- Functionally equivalent; eliminates the per-row profile scan.

DROP POLICY IF EXISTS "Approved doctors insert own presence" ON public.doctor_presence;
CREATE POLICY "Approved doctors insert own presence"
ON public.doctor_presence FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.current_user_is_approved_doctor()
);

DROP POLICY IF EXISTS "Approved doctors update own presence" ON public.doctor_presence;
CREATE POLICY "Approved doctors update own presence"
ON public.doctor_presence FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND public.current_user_is_approved_doctor()
);
