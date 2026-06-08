ALTER TABLE public.coverage_requests REPLICA IDENTITY DEFAULT;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coverage_requests TO authenticated;
GRANT ALL ON public.coverage_requests TO service_role;