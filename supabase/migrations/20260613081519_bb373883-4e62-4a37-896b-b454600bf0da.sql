
-- Fuzzy search support for admin universal search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_profiles_full_name_trgm
  ON public.profiles USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_phone_trgm
  ON public.profiles USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_mdcn_trgm
  ON public.profiles USING gin (mdcn gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cr_hospital_trgm
  ON public.coverage_requests USING gin (hospital gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cr_area_trgm
  ON public.coverage_requests USING gin (area gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cr_payref_trgm
  ON public.coverage_requests USING gin (payment_reference gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cr_phone_trgm
  ON public.coverage_requests USING gin (phone gin_trgm_ops);

-- Supporting btree indexes used by admin filters and aggregations
CREATE INDEX IF NOT EXISTS idx_cr_created_at         ON public.coverage_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cr_status             ON public.coverage_requests (status);
CREATE INDEX IF NOT EXISTS idx_cr_accepted_by        ON public.coverage_requests (accepted_by) WHERE accepted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cr_requester_id       ON public.coverage_requests (requester_id);
CREATE INDEX IF NOT EXISTS idx_cr_payment_status     ON public.coverage_requests (payment_status);
CREATE INDEX IF NOT EXISTS idx_profiles_created_at   ON public.profiles (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_verif_status ON public.profiles (verification_status);
CREATE INDEX IF NOT EXISTS idx_profiles_mdcn_norm    ON public.profiles ((upper(trim(mdcn))))
  WHERE mdcn IS NOT NULL AND onboarded_cover_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_device_tokens_user    ON public.device_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_esl_status_created    ON public.email_send_log (status, created_at DESC);

-- ----- admin_system_health() -----
CREATE OR REPLACE FUNCTION public.admin_system_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       jsonb;
  day_ago timestamptz := now() - interval '24 hours';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT jsonb_build_object(
    'email_sent_24h',    (SELECT count(*) FROM email_send_log WHERE status = 'sent'   AND created_at >= day_ago),
    'email_failed_24h',  (SELECT count(*) FROM email_send_log WHERE status = 'failed' AND created_at >= day_ago),
    'suppressed_total',  (SELECT count(*) FROM suppressed_emails),
    'device_tokens',     (SELECT count(*) FROM device_tokens),
    'users_with_tokens', (SELECT count(DISTINCT user_id) FROM device_tokens),
    'platforms',         COALESCE((
      SELECT jsonb_agg(jsonb_build_object('platform', platform, 'count', c))
        FROM (SELECT platform, count(*) AS c FROM device_tokens GROUP BY platform) t
    ), '[]'::jsonb),
    'profiles_total',  (SELECT count(*) FROM profiles),
    'requests_total',  (SELECT count(*) FROM coverage_requests),
    'ratings_total',   (SELECT count(*) FROM ratings),
    'signups_24h',     (SELECT count(*) FROM profiles WHERE created_at >= day_ago),
    'requests_24h',    (SELECT count(*) FROM coverage_requests WHERE created_at >= day_ago),
    'completed_24h',   (SELECT count(*) FROM coverage_requests WHERE status = 'completed' AND updated_at >= day_ago),
    'cancelled_24h',   (SELECT count(*) FROM coverage_requests WHERE status = 'cancelled' AND updated_at >= day_ago)
  ) INTO r;

  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_system_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_system_health() TO authenticated;

-- ----- admin_risk_overview(_days) -----
CREATE OR REPLACE FUNCTION public.admin_risk_overview(_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
      count(*) FILTER (WHERE status = 'searching' AND created_at < now() - interval '24 hours') AS unfilled_24h
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
      'requests_unfilled_24h',           (SELECT unfilled_24h FROM totals)
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
$$;

REVOKE ALL ON FUNCTION public.admin_risk_overview(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_risk_overview(int) TO authenticated;
