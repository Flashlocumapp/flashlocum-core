
-- 1) Protect privileged profile columns from self-edits
CREATE OR REPLACE FUNCTION public.profiles_block_privileged_self_edits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role and admins bypass this guard.
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.verification_status         IS DISTINCT FROM OLD.verification_status
  OR NEW.verification_action_note    IS DISTINCT FROM OLD.verification_action_note
  OR NEW.account_restricted_at       IS DISTINCT FROM OLD.account_restricted_at
  OR NEW.account_restricted_reason   IS DISTINCT FROM OLD.account_restricted_reason
  OR NEW.payment_restricted_at       IS DISTINCT FROM OLD.payment_restricted_at
  OR NEW.payment_flagged_at          IS DISTINCT FROM OLD.payment_flagged_at
  OR NEW.monnify_sub_account_code    IS DISTINCT FROM OLD.monnify_sub_account_code
  THEN
    RAISE EXCEPTION 'Not allowed: privileged profile fields can only be modified by admins'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_block_privileged_self_edits ON public.profiles;
CREATE TRIGGER profiles_block_privileged_self_edits
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_block_privileged_self_edits();

-- 2) Tighten realtime.messages SELECT policy: drop blanket presence access.
DROP POLICY IF EXISTS "Authenticated can read coverage invalidations" ON realtime.messages;
CREATE POLICY "Authenticated can read coverage invalidations"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (extension = 'broadcast' AND topic = 'coverage_invalidations')
  OR extension = 'postgres_changes'
);

-- 3) Revoke EXECUTE from PUBLIC/anon on SECURITY DEFINER helpers.
REVOKE EXECUTE ON FUNCTION public.expire_stale_doctor_presence()                          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_apply_payment_restriction(uuid, text)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_clear_payment_flag(uuid, text)                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_clear_payment_restriction(uuid, text)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_flagged_accounts()                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_online_approved_doctors()                          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._lock_rate_on_insert()                                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._auto_advance_day_boundary()                            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._cr_recompute_trust_on_terminal()                       FROM PUBLIC, anon;
