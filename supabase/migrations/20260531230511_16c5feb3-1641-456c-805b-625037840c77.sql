-- Fix 1: Revoke EXECUTE on internal trigger functions from end-user roles.
-- These functions are only meant to run as triggers / via the auth pipeline,
-- not to be directly callable by signed-in users.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_self_verification_change() FROM PUBLIC;
DO $$ BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM anon, authenticated';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.prevent_self_verification_change() FROM anon, authenticated';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- has_role is intentionally callable by authenticated users because it is
-- used inside RLS policies that evaluate as the calling role.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- Fix 2: Prevent privilege escalation through self-update of profile.
-- Extend the existing guard trigger to also freeze `role` and `mdcn` for
-- non-admins once they've been set. The initial set (NULL -> value) during
-- onboarding is still allowed; subsequent changes require admin.
CREATE OR REPLACE FUNCTION public.prevent_self_verification_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
      NEW.verification_status := OLD.verification_status;
    END IF;
    IF OLD.role IS NOT NULL AND NEW.role IS DISTINCT FROM OLD.role THEN
      NEW.role := OLD.role;
    END IF;
    IF OLD.mdcn IS NOT NULL AND NEW.mdcn IS DISTINCT FROM OLD.mdcn THEN
      NEW.mdcn := OLD.mdcn;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Re-lock execute after CREATE OR REPLACE (definer functions default to PUBLIC).
REVOKE EXECUTE ON FUNCTION public.prevent_self_verification_change() FROM PUBLIC;
DO $$ BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.prevent_self_verification_change() FROM anon, authenticated';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Ensure the trigger is attached to profiles (idempotent).
DROP TRIGGER IF EXISTS profiles_prevent_priv_escalation ON public.profiles;
CREATE TRIGGER profiles_prevent_priv_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_verification_change();
