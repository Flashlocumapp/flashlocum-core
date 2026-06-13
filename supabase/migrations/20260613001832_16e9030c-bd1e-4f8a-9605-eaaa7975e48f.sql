-- M-6: Codify the email-queue processing cron job in a migration.
--
-- Background: the email queue (pgmq) is drained by POSTing to the
-- TanStack route /lovable/email/queue/process. The schedule that triggers
-- those POSTs previously only existed in the project dashboard, so a
-- re-provision would silently lose it. This migration recreates the
-- schedule from source.
--
-- Two values are project-specific and cannot live in a migration:
--   1. The full URL of the processor route (depends on deployment domain)
--   2. The service-role key used as Bearer auth
-- Both are read from Supabase Vault at call time. If either secret is
-- missing the cron run is a safe no-op (logged as a notice) — set the
-- two vault secrets and the schedule starts draining automatically.

-- Helper: one queue-processing kick. Read vault, then net.http_post.
CREATE OR REPLACE FUNCTION public.dispatch_email_queue_processing()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault', 'net'
AS $$
DECLARE
  v_url   text;
  v_key   text;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
   WHERE name = 'email_processor_url'
   LIMIT 1;

  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'email_processor_service_role_key'
   LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'dispatch_email_queue_processing skipped: missing vault secret(s) email_processor_url / email_processor_service_role_key';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_email_queue_processing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_email_queue_processing() TO service_role;

-- Schedule it. Idempotent: unschedule any prior job with the same name first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
       FROM cron.job
      WHERE jobname = 'process-email-queue';

    -- Every minute. pg_cron's minimum granularity is 1 minute; if you need
    -- lower latency, schedule multiple sub-minute kicks using the standard
    -- "* * * * *" + delays pattern, or trigger directly from the producer.
    PERFORM cron.schedule(
      'process-email-queue',
      '* * * * *',
      $cron$SELECT public.dispatch_email_queue_processing();$cron$
    );
  END IF;
END
$$;