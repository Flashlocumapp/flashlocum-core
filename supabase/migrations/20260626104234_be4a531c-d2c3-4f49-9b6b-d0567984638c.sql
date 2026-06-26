DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='profiles'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles';
  END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles
  (id, role, full_name, gender, years_experience, location,
   verification_status, onboarded_at, onboarded_request_at, onboarded_cover_at,
   verification_action_at, verification_action_target,
   payment_restricted_at, account_restricted_at,
   trust_frozen_at, trust_frozen_reason,
   trust_snapshot_at, last_seen_at, created_at, updated_at);

ALTER TABLE public.profiles REPLICA IDENTITY FULL;
