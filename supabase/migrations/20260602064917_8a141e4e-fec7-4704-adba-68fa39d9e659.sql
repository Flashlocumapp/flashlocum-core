
-- Fix infinite recursion between profiles RLS and coverage_requests RLS.
-- The previous policy on profiles did EXISTS over coverage_requests, whose
-- own policies do EXISTS over profiles, creating a cycle.

CREATE OR REPLACE FUNCTION public.is_assigned_doctor_of(_doctor uuid, _requester uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coverage_requests
    WHERE accepted_by = _doctor AND requester_id = _requester
  )
$$;

DROP POLICY IF EXISTS "Requesters can view their assigned doctor profile" ON public.profiles;

CREATE POLICY "Requesters can view their assigned doctor profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.is_assigned_doctor_of(profiles.id, auth.uid()));
