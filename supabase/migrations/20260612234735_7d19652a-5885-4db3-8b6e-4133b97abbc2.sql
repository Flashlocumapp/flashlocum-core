
-- Cached "is the caller an approved doctor?" check.
-- STABLE so Postgres can evaluate it once per query instead of per row.
CREATE OR REPLACE FUNCTION public.current_user_is_approved_doctor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid()
       AND verification_status = 'approved'
  )
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_is_approved_doctor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_approved_doctor() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_approved_doctor() TO service_role;

-- Rewrite the SELECT policy: identical semantics, but the per-row correlated
-- EXISTS subquery is replaced with a STABLE function call the planner can hoist.
DROP POLICY IF EXISTS "Approved doctors view live and own assignments"
  ON public.coverage_requests;

CREATE POLICY "Approved doctors view live and own assignments"
  ON public.coverage_requests
  FOR SELECT
  TO authenticated
  USING (
    (
      status = 'searching'::coverage_request_status
      AND accepted_by IS NULL
      AND public.current_user_is_approved_doctor()
    )
    OR accepted_by = auth.uid()
  );

ANALYZE public.coverage_requests;
