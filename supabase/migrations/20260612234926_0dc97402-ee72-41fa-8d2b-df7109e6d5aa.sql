
-- Re-add coverage_requests and profiles to the realtime publication.
-- These were removed previously to stop unfiltered fan-out; subscriptions are
-- now per-user / per-row scoped (see C-2 fix), so re-enabling is safe.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'coverage_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.coverage_requests;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE events carry the full OLD row.
-- Required for client-side filters like `id=eq.<uuid>` or `accepted_by=eq.<uid>`
-- to work on UPDATE / DELETE (the default only emits the PK).
ALTER TABLE public.coverage_requests REPLICA IDENTITY FULL;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
