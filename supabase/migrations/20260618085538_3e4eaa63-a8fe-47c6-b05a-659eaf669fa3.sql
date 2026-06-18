CREATE OR REPLACE FUNCTION public.list_open_coverage_requests()
 RETURNS SETOF coverage_requests
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.current_user_is_approved_doctor() THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.doctor_presence dp
    WHERE dp.user_id = auth.uid() AND dp.online = true
  ) THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.account_restricted_at IS NOT NULL
  ) THEN
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
      cr.expired_at,
      NULL::uuid                                  AS pricing_version_id,
      NULL::jsonb                                 AS rate_snapshot,
      false                                       AS requester_rating_submitted,
      NULL::smallint                              AS requester_rating_score,
      NULL::timestamptz                           AS requester_rating_at,
      false                                       AS doctor_rating_submitted,
      NULL::smallint                              AS doctor_rating_score,
      NULL::timestamptz                           AS doctor_rating_at,
      NULL::jsonb                                 AS payment_account,
      cr.first_started_at
    FROM public.coverage_requests cr
    WHERE cr.status = 'searching'::coverage_request_status
      AND cr.accepted_by IS NULL
      AND cr.broadcast_started_at > now() - interval '180 seconds'
    ORDER BY cr.broadcast_started_at DESC
    LIMIT 500;
END
$function$;

GRANT EXECUTE ON FUNCTION public.list_open_coverage_requests() TO authenticated;