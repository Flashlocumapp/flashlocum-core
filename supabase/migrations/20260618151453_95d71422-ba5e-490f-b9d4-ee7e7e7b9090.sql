
-- A. Drop profiles from Realtime publication.
ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles;

-- B. realtime.messages RLS policies.
DROP POLICY IF EXISTS "Authenticated can read coverage invalidations" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated can send coverage invalidations" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated can receive table CDC" ON realtime.messages;

CREATE POLICY "Authenticated can read coverage invalidations"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    (extension = 'broadcast' AND topic = 'coverage_invalidations')
    OR extension = 'postgres_changes'
    OR extension = 'presence'
  );

CREATE POLICY "Authenticated can send coverage invalidations"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    extension = 'broadcast' AND topic = 'coverage_invalidations'
  );

-- C. Revoke EXECUTE on trigger functions and internal helpers.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public._cr_after_status_change()',
    'public._cr_enforce_account_restriction()',
    'public._profiles_force_offline_on_restriction()',
    'public._ratings_after_insert()',
    'public._trust_ratings_received()',
    'public._trust_terminal_shifts()',
    'public.clear_presence_on_unapproval()',
    'public.coverage_requests_emit_invalidate()',
    'public.handle_new_user()',
    'public.handle_updated_at()',
    'public.prevent_requester_sensitive_change()',
    'public.prevent_self_verification_change()',
    'public.bump_request_rev_on_change()',
    'public.enqueue_email(text, jsonb)',
    'public.read_email_batch(text, integer, integer)',
    'public.delete_email(text, bigint)',
    'public.move_to_dlq(text, text, bigint, jsonb)',
    'public.dispatch_email_queue_processing()',
    'public.prune_email_send_log()',
    'public.recompute_trust(uuid)'
  ] LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', fn);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn);
    EXCEPTION WHEN undefined_function THEN
      NULL;
    END;
  END LOOP;
END $$;

-- D. Move pg_trgm out of public.
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO authenticated, anon, service_role;

DROP INDEX IF EXISTS public.idx_cr_payref_trgm;
DROP INDEX IF EXISTS public.idx_cr_phone_trgm;
DROP INDEX IF EXISTS public.idx_cr_hospital_trgm;
DROP INDEX IF EXISTS public.idx_cr_area_trgm;
DROP INDEX IF EXISTS public.idx_profiles_full_name_trgm;
DROP INDEX IF EXISTS public.idx_profiles_phone_trgm;
DROP INDEX IF EXISTS public.idx_profiles_mdcn_trgm;

DROP EXTENSION IF EXISTS pg_trgm;
CREATE EXTENSION pg_trgm WITH SCHEMA extensions;

CREATE INDEX idx_cr_payref_trgm   ON public.coverage_requests USING gin (payment_reference extensions.gin_trgm_ops);
CREATE INDEX idx_cr_phone_trgm    ON public.coverage_requests USING gin (phone extensions.gin_trgm_ops);
CREATE INDEX idx_cr_hospital_trgm ON public.coverage_requests USING gin (hospital extensions.gin_trgm_ops);
CREATE INDEX idx_cr_area_trgm     ON public.coverage_requests USING gin (area extensions.gin_trgm_ops);
CREATE INDEX idx_profiles_full_name_trgm ON public.profiles USING gin (full_name extensions.gin_trgm_ops);
CREATE INDEX idx_profiles_phone_trgm     ON public.profiles USING gin (phone extensions.gin_trgm_ops);
CREATE INDEX idx_profiles_mdcn_trgm      ON public.profiles USING gin (mdcn extensions.gin_trgm_ops);

-- Make trigram operators resolvable wherever they're used at runtime.
ALTER DATABASE postgres SET search_path = "$user", public, extensions;
