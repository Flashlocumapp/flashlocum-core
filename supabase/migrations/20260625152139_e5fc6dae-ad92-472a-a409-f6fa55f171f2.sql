
-- =========================================================
-- PRE-CAPACITOR FULL DATA RESET (Option 1)
-- Keeps only admin user ce06e7f8-5e3f-40e8-937a-51c9cf8de0ec
-- =========================================================
DO $$
DECLARE
  admin_id uuid := 'ce06e7f8-5e3f-40e8-937a-51c9cf8de0ec';
BEGIN
  -- 1. Activity / billing / rating data (child rows first)
  DELETE FROM public.payment_surcharge_log;
  DELETE FROM public.payment_underpayments;
  DELETE FROM public.shift_segments;
  DELETE FROM public.ratings;
  DELETE FROM public.trust_blocks;
  DELETE FROM public.coverage_requests;

  -- 2. Notifications / messaging / push
  DELETE FROM public.notification_outbox;
  DELETE FROM public.email_send_log;
  DELETE FROM public.email_send_state;
  DELETE FROM public.suppressed_emails;
  DELETE FROM public.email_unsubscribe_tokens;
  DELETE FROM public.device_tokens;

  -- 3. Presence
  DELETE FROM public.doctor_presence;

  -- 4. Admin audit (kept empty as agreed)
  DELETE FROM public.admin_actions;
  DELETE FROM public.admin_payment_actions;

  -- 5. Remove non-admin user_roles
  DELETE FROM public.user_roles WHERE user_id <> admin_id;

  -- 6. Remove non-admin profiles
  DELETE FROM public.profiles WHERE id <> admin_id;

  -- 7. Reset admin profile flags so they look like a brand-new account
  UPDATE public.profiles
     SET trust_snapshot            = NULL,
         account_restricted_at     = NULL,
         account_restricted_by     = NULL,
         account_restricted_reason = NULL,
         payment_flagged_at        = NULL,
         payment_flagged_reason    = NULL,
         payment_restricted_at     = NULL,
         last_seen_at              = NULL
   WHERE id = admin_id;

  -- 8. Remove non-admin auth users (Lovable Cloud allows data DML in auth.users)
  DELETE FROM auth.users WHERE id <> admin_id;
END $$;
