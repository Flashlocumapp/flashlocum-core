
-- 1. Fix mutable search_path on user functions
ALTER FUNCTION public._round_billable_minutes(integer) SET search_path = public;
ALTER FUNCTION public.server_now() SET search_path = public;

-- 2. Revoke EXECUTE on all public functions from PUBLIC and anon, then re-grant
--    to authenticated for user-facing RPCs. Trigger functions need no EXECUTE.
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    WHERE n.nspname = 'public' AND d.objid IS NULL
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon',
      fn.proname, fn.args);
  END LOOP;
END $$;

-- Re-grant EXECUTE to authenticated for the user-facing RPCs (caller-context required)
GRANT EXECUTE ON FUNCTION public.admin_apply_trust_restriction(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clear_trust_restriction(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_trust(boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_no_show(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_overview_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_publish_pricing_version(text, jsonb, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_risk_overview(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_system_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_coverage_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_first_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_approved_doctor() TO authenticated;
GRANT EXECUTE ON FUNCTION public.doctor_resubmit_verification() TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_shift(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.extend_payment_window(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_assigned_doctor_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_payment_restriction() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_rating(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_reliability(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_request_billing_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_request_phone(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shift_rating_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trust(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_assigned_doctor_of(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_request_phones() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_open_coverage_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_shift(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_trust(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_shift(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_shift(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_shift_rating(uuid, integer, text) TO authenticated;

-- 3. Hide payment_account (virtual bank account JSON) from regular signed-in
--    users on coverage_requests. Only service_role (server admin client) may
--    read it. The requester's payment screen calls a server function that
--    uses the admin client after verifying requester_id == auth.uid().
REVOKE SELECT (payment_account) ON public.coverage_requests FROM authenticated;
REVOKE UPDATE (payment_account) ON public.coverage_requests FROM authenticated;
-- service_role retains full access via GRANT ALL elsewhere.
