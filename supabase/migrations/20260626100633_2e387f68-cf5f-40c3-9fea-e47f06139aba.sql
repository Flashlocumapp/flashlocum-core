
-- Archive table for notification_outbox (>30d)
CREATE TABLE IF NOT EXISTS public.notification_outbox_archive (LIKE public.notification_outbox INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE public.notification_outbox_archive ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
GRANT SELECT ON public.notification_outbox_archive TO authenticated;
GRANT ALL ON public.notification_outbox_archive TO service_role;
ALTER TABLE public.notification_outbox_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_archive_admin_select" ON public.notification_outbox_archive
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS notification_outbox_archive_created_idx ON public.notification_outbox_archive (created_at);
CREATE INDEX IF NOT EXISTS notification_outbox_archive_user_idx ON public.notification_outbox_archive (user_id);

-- Archive table for admin_actions (>180d)
CREATE TABLE IF NOT EXISTS public.admin_actions_archive (LIKE public.admin_actions INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE public.admin_actions_archive ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
GRANT SELECT ON public.admin_actions_archive TO authenticated;
GRANT ALL ON public.admin_actions_archive TO service_role;
ALTER TABLE public.admin_actions_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_actions_archive_admin_select" ON public.admin_actions_archive
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS admin_actions_archive_created_idx ON public.admin_actions_archive (created_at);
CREATE INDEX IF NOT EXISTS admin_actions_archive_actor_idx ON public.admin_actions_archive (actor_user_id);

-- Move function: archives old rows in a single transaction.
-- notification_outbox: only delivered rows older than 30 days (never archive undelivered).
-- admin_actions: rows older than 180 days.
CREATE OR REPLACE FUNCTION public.archive_old_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notif_moved int := 0;
  v_admin_moved int := 0;
BEGIN
  WITH moved AS (
    DELETE FROM public.notification_outbox
    WHERE delivered_at IS NOT NULL
      AND delivered_at < now() - INTERVAL '30 days'
    RETURNING *
  )
  INSERT INTO public.notification_outbox_archive
    (id, user_id, kind, entity_id, version, occurred_at, audience, title, body,
     payload, attempts, next_attempt_at, last_error, delivered_at, created_at, updated_at)
  SELECT id, user_id, kind, entity_id, version, occurred_at, audience, title, body,
         payload, attempts, next_attempt_at, last_error, delivered_at, created_at, updated_at
  FROM moved;
  GET DIAGNOSTICS v_notif_moved = ROW_COUNT;

  WITH moved AS (
    DELETE FROM public.admin_actions
    WHERE created_at < now() - INTERVAL '180 days'
    RETURNING *
  )
  INSERT INTO public.admin_actions_archive
    (id, actor_user_id, action, target_user_id, target_shift_id, target_payment_ref,
     reason, note, payload, created_at)
  SELECT id, actor_user_id, action, target_user_id, target_shift_id, target_payment_ref,
         reason, note, payload, created_at
  FROM moved;
  GET DIAGNOSTICS v_admin_moved = ROW_COUNT;

  RETURN jsonb_build_object(
    'notification_outbox_archived', v_notif_moved,
    'admin_actions_archived', v_admin_moved,
    'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.archive_old_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_old_logs() TO service_role;

-- Schedule: daily at 03:15 UTC. Uses pg_cron + direct SQL (Option 1: no HTTP needed).
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  PERFORM cron.unschedule('archive-old-logs-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'archive-old-logs-daily',
  '15 3 * * *',
  $$ SELECT public.archive_old_logs(); $$
);
