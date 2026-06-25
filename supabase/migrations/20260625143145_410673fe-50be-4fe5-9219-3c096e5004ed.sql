
-- 1. Generic admin audit log
CREATE TABLE IF NOT EXISTS public.admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  action text NOT NULL,
  target_user_id uuid,
  target_shift_id uuid,
  target_payment_ref text,
  reason text,
  note text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_target_user
  ON public.admin_actions(target_user_id, created_at DESC)
  WHERE target_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_actions_target_shift
  ON public.admin_actions(target_shift_id, created_at DESC)
  WHERE target_shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_actions_actor
  ON public.admin_actions(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_action
  ON public.admin_actions(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created
  ON public.admin_actions(created_at DESC);

GRANT SELECT ON public.admin_actions TO authenticated;
GRANT ALL ON public.admin_actions TO service_role;
ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read admin_actions" ON public.admin_actions;
CREATE POLICY "Admins can read admin_actions"
  ON public.admin_actions
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- No INSERT/UPDATE/DELETE policies — writes only happen via service_role
-- inside server functions that have already verified admin role.

-- 2. Trust state extensions on profiles (additive, nullable)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trust_frozen_at timestamptz,
  ADD COLUMN IF NOT EXISTS trust_frozen_reason text,
  ADD COLUMN IF NOT EXISTS trust_escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS trust_escalated_note text,
  ADD COLUMN IF NOT EXISTS trust_restriction_expires_at timestamptz;

-- 3. Trust history reader — surfaces the admin_actions rows that target
--    a given user with a trust-related action.
CREATE OR REPLACE FUNCTION public.admin_list_trust_history(_user_id uuid)
RETURNS TABLE(
  id uuid,
  action text,
  reason text,
  note text,
  actor_user_id uuid,
  actor_name text,
  payload jsonb,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.action,
    a.reason,
    a.note,
    a.actor_user_id,
    p.full_name AS actor_name,
    a.payload,
    a.created_at
  FROM public.admin_actions a
  LEFT JOIN public.profiles p ON p.id = a.actor_user_id
  WHERE a.target_user_id = _user_id
    AND a.action LIKE 'trust.%'
  ORDER BY a.created_at DESC
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.admin_list_trust_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_trust_history(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_trust_history(uuid) TO service_role;
