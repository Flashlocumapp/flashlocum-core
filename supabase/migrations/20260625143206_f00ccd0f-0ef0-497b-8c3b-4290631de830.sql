
CREATE OR REPLACE FUNCTION public.admin_list_trust_history(_user_id uuid)
RETURNS TABLE(
  id uuid,
  action text,
  reason text,
  note text,
  actor_user_id uuid,
  actor_name text,
  payload jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.action,
    a.reason,
    a.note,
    a.actor_user_id,
    p.full_name AS actor_name,
    a.payload,
    a.created_at
  FROM public.admin_actions a
  LEFT JOIN public.profiles p ON p.id = a.actor_user_id
  WHERE a.target_user_id = _user_id
    AND a.action LIKE 'trust.%'
  ORDER BY a.created_at DESC
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_trust_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_trust_history(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_trust_history(uuid) TO service_role;
