
CREATE OR REPLACE FUNCTION public.admin_list_cancellations(_limit integer DEFAULT 200)
 RETURNS TABLE(shift_id uuid, cancelled_at timestamp with time zone, cancelled_by text, actor_user_id uuid, actor_name text, reason_code text, reason_text text, hospital text, start_time text, end_time text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    cr.id,
    cr.cancelled_at,
    cr.cancelled_by,
    CASE WHEN cr.cancelled_by = 'doctor' THEN cr.accepted_by ELSE cr.requester_id END AS actor_user_id,
    COALESCE(p.full_name, cr.hospital, '—') AS actor_name,
    cr.cancellation_reason_code,
    cr.cancellation_reason_text,
    cr.hospital,
    cr.start_time,
    cr.end_time
  FROM public.coverage_requests cr
  LEFT JOIN public.profiles p
    ON p.id = CASE WHEN cr.cancelled_by = 'doctor' THEN cr.accepted_by ELSE cr.requester_id END
  WHERE cr.status = 'cancelled'
    AND cr.cancellation_reason_code IS NOT NULL
  ORDER BY cr.cancelled_at DESC NULLS LAST
  LIMIT GREATEST(_limit, 1);
END;
$function$;
