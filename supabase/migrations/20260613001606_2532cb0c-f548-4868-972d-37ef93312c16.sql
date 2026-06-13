-- M-5: TTL for email_send_log + pgmq queue-depth monitoring view.

-- 1) Retention function — deletes log rows older than 30 days.
--    SECURITY DEFINER so pg_cron (running as postgres) and admins can both invoke.
CREATE OR REPLACE FUNCTION public.prune_email_send_log(_retain_days int DEFAULT 30)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  removed bigint;
BEGIN
  DELETE FROM public.email_send_log
   WHERE created_at < now() - make_interval(days => _retain_days);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_email_send_log(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_email_send_log(int) TO service_role;

-- 2) Schedule a daily cleanup at 03:15 UTC. pg_cron lives in the cron schema
--    on Supabase; the unschedule/schedule pattern keeps the migration idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Drop any previous schedule with the same name so re-runs don't duplicate.
    PERFORM cron.unschedule(jobid)
       FROM cron.job
      WHERE jobname = 'prune_email_send_log_daily';

    PERFORM cron.schedule(
      'prune_email_send_log_daily',
      '15 3 * * *',
      $cron$SELECT public.prune_email_send_log(30);$cron$
    );
  END IF;
END
$$;

-- 3) pgmq queue-depth monitoring view (read-only). Lets the admin dashboard
--    surface backlog without poking pgmq internals directly. Returns one row
--    per email queue with current depth + oldest enqueued_at.
CREATE OR REPLACE FUNCTION public.email_queue_depth()
RETURNS TABLE(queue_name text, depth bigint, oldest_enqueued_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pgmq'
AS $$
DECLARE
  q text;
  d bigint;
  oldest timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  FOREACH q IN ARRAY ARRAY['auth_emails','transactional_emails','auth_emails_dlq','transactional_emails_dlq'] LOOP
    BEGIN
      EXECUTE format('SELECT count(*), min(enqueued_at) FROM pgmq.q_%I', q)
        INTO d, oldest;
      queue_name := q;
      depth := COALESCE(d, 0);
      oldest_enqueued_at := oldest;
      RETURN NEXT;
    EXCEPTION WHEN undefined_table THEN
      -- Queue not yet created; report zero.
      queue_name := q;
      depth := 0;
      oldest_enqueued_at := NULL;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.email_queue_depth() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_queue_depth() TO authenticated;
GRANT EXECUTE ON FUNCTION public.email_queue_depth() TO service_role;