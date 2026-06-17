-- 1) Trigger: bump rev + reset broadcast_started_at on (a) material edits while
-- searching/paused, and (b) any paused -> searching resume (dismiss path).
CREATE OR REPLACE FUNCTION public.bump_request_rev_on_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  material_changed boolean := false;
BEGIN
  -- Only consider rows that are (or were) live in the pre-acceptance window.
  IF OLD.status NOT IN ('searching','paused') AND NEW.status NOT IN ('searching','paused') THEN
    RETURN NEW;
  END IF;

  -- Resume from paused -> searching is itself a fresh broadcast (Wait for
  -- Doctor / X / outside-tap on the cancel sheet).
  IF OLD.status = 'paused' AND NEW.status = 'searching' THEN
    NEW.rev := COALESCE(OLD.rev, 1) + 1;
    NEW.broadcast_started_at := now();
    RETURN NEW;
  END IF;

  -- Material field changes while still pre-acceptance count as a new offer.
  IF NEW.status IN ('searching','paused') AND OLD.status IN ('searching','paused') THEN
    material_changed :=
         NEW.hospital      IS DISTINCT FROM OLD.hospital
      OR NEW.area          IS DISTINCT FROM OLD.area
      OR NEW.coverage_type IS DISTINCT FROM OLD.coverage_type
      OR NEW.day           IS DISTINCT FROM OLD.day
      OR NEW.start_time    IS DISTINCT FROM OLD.start_time
      OR NEW.end_time      IS DISTINCT FROM OLD.end_time
      OR NEW.start_ts      IS DISTINCT FROM OLD.start_ts
      OR NEW.end_ts        IS DISTINCT FROM OLD.end_ts
      OR NEW.duration_hrs  IS DISTINCT FROM OLD.duration_hrs
      OR NEW.amount        IS DISTINCT FROM OLD.amount
      OR NEW.environment   IS DISTINCT FROM OLD.environment
      OR NEW.note          IS DISTINCT FROM OLD.note
      OR NEW.days          IS DISTINCT FROM OLD.days;
    IF material_changed THEN
      NEW.rev := COALESCE(OLD.rev, 1) + 1;
      NEW.broadcast_started_at := now();
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS coverage_requests_bump_rev ON public.coverage_requests;
CREATE TRIGGER coverage_requests_bump_rev
BEFORE UPDATE ON public.coverage_requests
FOR EACH ROW
EXECUTE FUNCTION public.bump_request_rev_on_change();

-- 2) Auto-expiry (cron, every 30s).
CREATE OR REPLACE FUNCTION public.expire_stale_searching_requests()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.coverage_requests
     SET status = 'expired', expired_at = now()
   WHERE status IN ('searching','paused')
     AND accepted_by IS NULL
     AND broadcast_started_at < now() - interval '180 seconds';
$$;

REVOKE EXECUTE ON FUNCTION public.expire_stale_searching_requests() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_stale_searching_requests() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.expire_stale_searching_requests() TO service_role;

-- 3) Requester-callable expiry RPC (in-session, when the client timer fires).
CREATE OR REPLACE FUNCTION public.expire_request(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.coverage_requests;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF r.accepted_by IS NOT NULL THEN
    RETURN jsonb_build_object('skipped', 'already_accepted');
  END IF;
  IF r.status NOT IN ('searching','paused') THEN
    RETURN jsonb_build_object('skipped', 'not_searching', 'status', r.status::text);
  END IF;
  UPDATE public.coverage_requests
     SET status = 'expired', expired_at = now()
   WHERE id = _id;
  RETURN jsonb_build_object('expired', true);
END
$$;

REVOKE EXECUTE ON FUNCTION public.expire_request(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.expire_request(uuid) TO authenticated, service_role;

-- 4) Update list_open_coverage_requests to:
--    - exclude expired
--    - order by broadcast_started_at (latest offers first to surface fresh)
CREATE OR REPLACE FUNCTION public.list_open_coverage_requests()
 RETURNS SETOF public.coverage_requests
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.current_user_is_approved_doctor() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT
      cr.id,
      cr.requester_id,
      cr.hospital,
      cr.area,
      cr.coverage_type,
      cr.day,
      cr.start_time,
      cr.end_time,
      cr.start_ts,
      cr.end_ts,
      cr.duration_hrs,
      cr.amount,
      cr.fee_pct,
      ''::text                                    AS phone,
      NULL::text                                  AS note,
      NULL::text                                  AS accommodation,
      cr.status,
      cr.accepted_by,
      cr.started_at,
      cr.accumulated_ms,
      NULL::integer                               AS settled_amount,
      cr.days,
      cr.day_index,
      cr.cancelled_by,
      cr.created_at,
      cr.updated_at,
      NULL::text                                  AS payment_provider,
      NULL::text                                  AS payment_reference,
      NULL::text                                  AS payment_status,
      NULL::text                                  AS payment_url,
      NULL::timestamptz                           AS paid_at,
      NULL::timestamptz                           AS remitted_at,
      cr.environment,
      NULL::timestamptz                           AS payment_due_at,
      cr.payment_extension_count,
      NULL::timestamptz                           AS last_extended_at,
      NULL::numeric                               AS total_billed_amount,
      NULL::timestamptz                           AS billing_locked_at,
      cr.rev,
      cr.broadcast_started_at,
      cr.expired_at
    FROM public.coverage_requests cr
    WHERE cr.status = 'searching'::coverage_request_status
      AND cr.accepted_by IS NULL
      AND cr.broadcast_started_at > now() - interval '180 seconds'
    ORDER BY cr.broadcast_started_at DESC
    LIMIT 500;
END
$function$;

-- 5) Schedule cron sweep every 30s.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('expire-stale-searching-requests');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'expire-stale-searching-requests',
  '30 seconds',
  $$ SELECT public.expire_stale_searching_requests(); $$
);

-- 6) Admin overview: surface expired counter.
CREATE OR REPLACE FUNCTION public.admin_overview_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT jsonb_build_object(
    'total_users', (SELECT count(*) FROM public.profiles),
    'request_users', (SELECT count(*) FROM public.profiles WHERE onboarded_request_at IS NOT NULL),
    'cover_users', (SELECT count(*) FROM public.profiles WHERE onboarded_cover_at IS NOT NULL),
    'verified_doctors', (SELECT count(*) FROM public.profiles WHERE verification_status = 'approved'),
    'pending_doctors', (SELECT count(*) FROM public.profiles WHERE onboarded_cover_at IS NOT NULL AND verification_status = 'pending'),
    'rejected_doctors', (SELECT count(*) FROM public.profiles WHERE verification_status = 'rejected'),
    'suspended_doctors', (SELECT count(*) FROM public.profiles WHERE verification_status = 'suspended'),
    'online_doctors', (
      SELECT count(*) FROM public.doctor_presence dp
      JOIN public.profiles p ON p.id = dp.user_id
      WHERE dp.online = true
        AND dp.last_seen > now() - interval '2 minutes'
        AND p.verification_status = 'approved'
    ),
    'coverage_in_progress', (SELECT count(*) FROM public.coverage_requests WHERE status IN ('active','paused')),
    'coverage_upcoming', (SELECT count(*) FROM public.coverage_requests WHERE status IN ('searching','accepted')),
    'coverage_completed', (SELECT count(*) FROM public.coverage_requests WHERE status = 'completed'),
    'coverage_cancelled', (SELECT count(*) FROM public.coverage_requests WHERE status = 'cancelled'),
    'coverage_expired',   (SELECT count(*) FROM public.coverage_requests WHERE status = 'expired'),
    'active_today', (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '24 hours'),
    'active_week', (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '7 days')
  ) INTO result;

  RETURN result;
END;
$function$;

-- 7) Risk overview: include expired in 24h unfilled counter so the dashboard
-- reflects no-fill demand pressure, separate from user cancellations.
CREATE OR REPLACE FUNCTION public.admin_risk_overview(_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r     jsonb;
  d     int := GREATEST(LEAST(COALESCE(_days, 30), 180), 1);
  since timestamptz := now() - make_interval(days => d);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  WITH
  s AS (SELECT * FROM coverage_requests WHERE created_at >= since),
  totals AS (
    SELECT
      (count(*) FILTER (WHERE accepted_by IS NOT NULL AND status = 'cancelled'))::numeric /
        NULLIF(count(*) FILTER (WHERE accepted_by IS NOT NULL AND status IN ('completed','cancelled')), 0) AS doc_cr,
      (count(*) FILTER (WHERE status = 'cancelled'))::numeric /
        NULLIF(count(*) FILTER (WHERE status IN ('completed','cancelled')), 0) AS req_cr,
      count(*) FILTER (WHERE accepted_by IS NOT NULL AND status = 'cancelled') AS cancelled_after_accept,
      count(*) FILTER (
        WHERE (status = 'expired')
           OR (status = 'searching' AND created_at < now() - interval '24 hours')
      ) AS unfilled_24h,
      count(*) FILTER (WHERE status = 'expired') AS expired_total
    FROM s
  ),
  prof_counts AS (
    SELECT
      count(*) FILTER (WHERE verification_status = 'suspended') AS suspended,
      count(*) FILTER (WHERE verification_status = 'rejected') AS rejected,
      count(*) FILTER (WHERE verification_status = 'pending' AND onboarded_cover_at IS NOT NULL) AS pending
    FROM profiles
  ),
  doc_cancellers AS (
    SELECT accepted_by AS user_id,
           count(*) FILTER (WHERE status = 'completed') AS completed,
           count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
           count(*) FILTER (WHERE status IN ('completed','cancelled')) AS total
      FROM s WHERE accepted_by IS NOT NULL
      GROUP BY accepted_by
      HAVING count(*) FILTER (WHERE status = 'cancelled') >= 2
      ORDER BY
        (count(*) FILTER (WHERE status = 'cancelled'))::numeric /
          NULLIF(count(*) FILTER (WHERE status IN ('completed','cancelled')), 0) DESC NULLS LAST,
        count(*) FILTER (WHERE status = 'cancelled') DESC
      LIMIT 10
  ),
  req_cancellers AS (
    SELECT requester_id AS user_id,
           count(*) FILTER (WHERE status = 'completed') AS completed,
           count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
           count(*) FILTER (WHERE status IN ('completed','cancelled')) AS total
      FROM s
      GROUP BY requester_id
      HAVING count(*) FILTER (WHERE status = 'cancelled') >= 2
      ORDER BY
        (count(*) FILTER (WHERE status = 'cancelled'))::numeric /
          NULLIF(count(*) FILTER (WHERE status IN ('completed','cancelled')), 0) DESC NULLS LAST,
        count(*) FILTER (WHERE status = 'cancelled') DESC
      LIMIT 10
  ),
  dup_mdcn AS (
    SELECT upper(trim(mdcn)) AS mdcn, count(*) AS c
      FROM profiles
     WHERE mdcn IS NOT NULL AND onboarded_cover_at IS NOT NULL
     GROUP BY upper(trim(mdcn))
    HAVING count(*) > 1
     ORDER BY count(*) DESC
     LIMIT 20
  ),
  signup_trend AS (
    SELECT to_char(date_trunc('day', g), 'YYYY-MM-DD') AS day,
           (SELECT count(*) FROM profiles
             WHERE created_at >= g AND created_at < g + interval '1 day') AS signups
      FROM generate_series(
             date_trunc('day', now()) - make_interval(days => d - 1),
             date_trunc('day', now()),
             interval '1 day'
           ) g
  ),
  stuck AS (
    SELECT s.id, s.hospital, s.area, s.created_at, s.requester_id, p.full_name AS requester_name
      FROM s LEFT JOIN profiles p ON p.id = s.requester_id
     WHERE s.status = 'searching' AND s.created_at < now() - interval '24 hours'
     ORDER BY s.created_at ASC
     LIMIT 20
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'cancellation_rate_doctor',        COALESCE((SELECT doc_cr FROM totals), 0),
      'cancellation_rate_requester',     COALESCE((SELECT req_cr FROM totals), 0),
      'suspended_doctors',               (SELECT suspended FROM prof_counts),
      'rejected_doctors',                (SELECT rejected  FROM prof_counts),
      'pending_doctors',                 (SELECT pending   FROM prof_counts),
      'duplicate_mdcn_groups',           (SELECT count(*)  FROM dup_mdcn),
      'requests_cancelled_after_accept', (SELECT cancelled_after_accept FROM totals),
      'requests_unfilled_24h',           (SELECT unfilled_24h FROM totals),
      'requests_expired',                (SELECT expired_total FROM totals)
    ),
    'topDoctorCancellers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', dc.user_id, 'name', p.full_name,
        'total', dc.total, 'completed', dc.completed, 'cancelled', dc.cancelled,
        'cancellation_rate', dc.cancelled::numeric / NULLIF(dc.total, 0)
      ))
      FROM doc_cancellers dc LEFT JOIN profiles p ON p.id = dc.user_id
    ), '[]'::jsonb),
    'topRequesterCancellers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', rc.user_id, 'name', p.full_name,
        'total', rc.total, 'completed', rc.completed, 'cancelled', rc.cancelled,
        'cancellation_rate', rc.cancelled::numeric / NULLIF(rc.total, 0)
      ))
      FROM req_cancellers rc LEFT JOIN profiles p ON p.id = rc.user_id
    ), '[]'::jsonb),
    'duplicateMdcn', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'mdcn', d.mdcn, 'count', d.c,
        'users', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.full_name,
            'verification_status', p.verification_status,
            'created_at', p.created_at
          ))
          FROM profiles p
          WHERE upper(trim(p.mdcn)) = d.mdcn AND p.onboarded_cover_at IS NOT NULL
        ), '[]'::jsonb)
      ))
      FROM dup_mdcn d
    ), '[]'::jsonb),
    'signupTrend', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', day, 'signups', signups))
      FROM signup_trend
    ), '[]'::jsonb),
    'stuckSearching', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'hospital', hospital, 'area', area,
        'created_at', created_at, 'requester_id', requester_id,
        'requester_name', requester_name
      ))
      FROM stuck
    ), '[]'::jsonb)
  ) INTO r;

  RETURN r;
END;
$function$;
