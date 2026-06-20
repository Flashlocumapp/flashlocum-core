CREATE OR REPLACE FUNCTION public.expire_stale_doctor_presence()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  WITH stale AS (
    UPDATE public.doctor_presence
       SET online    = false,
           last_seen = now()
     WHERE online = true
       AND last_seen < now() - interval '90 seconds'
    RETURNING user_id
  )
  SELECT COUNT(*) INTO updated_count FROM stale;
  RETURN COALESCE(updated_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_doctor_presence() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_doctor_presence() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
      FROM cron.job
     WHERE jobname = 'expire_stale_doctor_presence';

    PERFORM cron.schedule(
      'expire_stale_doctor_presence',
      '*/1 * * * *',
      $cron$SELECT public.expire_stale_doctor_presence();$cron$
    );
  END IF;
END $$;