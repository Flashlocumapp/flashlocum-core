-- M-7: Hard pagination cap on admin_list_users so the admin console
-- can never pull an unbounded result set into memory. Existing zero-arg
-- callers keep working because all new params have defaults.

DROP FUNCTION IF EXISTS public.admin_list_users();

CREATE OR REPLACE FUNCTION public.admin_list_users(
  _limit  int DEFAULT 500,
  _offset int DEFAULT 0
)
 RETURNS TABLE(
   id uuid, full_name text, email text, phone text, role text, location text,
   verification_status verification_status,
   created_at timestamp with time zone,
   last_seen_at timestamp with time zone,
   onboarded_request_at timestamp with time zone,
   onboarded_cover_at timestamp with time zone
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Clamp to a sane window. Negative or zero limits collapse to the
  -- default; anything above the hard ceiling is truncated.
  v_limit  int := LEAST(GREATEST(COALESCE(_limit, 500), 1), 2000);
  v_offset int := GREATEST(COALESCE(_offset, 0), 0);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    u.email::text,
    p.phone,
    p.role,
    p.location,
    p.verification_status,
    p.created_at,
    p.last_seen_at,
    p.onboarded_request_at,
    p.onboarded_cover_at
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  ORDER BY p.created_at DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_users(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(int, int) TO service_role;