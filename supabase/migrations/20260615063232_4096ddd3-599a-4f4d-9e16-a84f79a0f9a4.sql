-- 1. Extend the verification status enum
ALTER TYPE public.verification_status ADD VALUE IF NOT EXISTS 'action_required';

-- 2. Per-doctor action-required metadata on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_action_reason text,
  ADD COLUMN IF NOT EXISTS verification_action_target text,
  ADD COLUMN IF NOT EXISTS verification_action_note   text,
  ADD COLUMN IF NOT EXISTS verification_action_at     timestamptz;

-- 3. Allow a doctor to flip themselves back to 'pending' once they
--    re-upload a corrected document. The existing trigger blocks
--    non-admins from changing verification_status directly, so we
--    expose a SECURITY DEFINER RPC that only works when the user is
--    currently in 'action_required'.
CREATE OR REPLACE FUNCTION public.doctor_resubmit_verification()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  cur public.verification_status;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT verification_status INTO cur FROM public.profiles WHERE id = uid;
  IF cur IS DISTINCT FROM 'action_required' THEN
    RETURN false;
  END IF;
  UPDATE public.profiles
     SET verification_status      = 'pending',
         verification_action_at   = now()
   WHERE id = uid;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.doctor_resubmit_verification() TO authenticated;