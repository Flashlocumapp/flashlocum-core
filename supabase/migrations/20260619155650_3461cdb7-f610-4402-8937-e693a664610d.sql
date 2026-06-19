
ALTER PUBLICATION supabase_realtime DROP TABLE public.coverage_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.coverage_requests;
ALTER TABLE public.coverage_requests REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='shift_segments') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.shift_segments';
  END IF;
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.shift_segments';
  EXECUTE 'ALTER TABLE public.shift_segments REPLICA IDENTITY FULL';
END $$;
