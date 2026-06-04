
-- Add operational tracking columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS verification_receipt_url text;

-- Heartbeat: user updates own last_seen_at. Bypasses any role-update guards.
CREATE OR REPLACE FUNCTION public.touch_last_seen()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  UPDATE public.profiles SET last_seen_at = now() WHERE id = uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated;

-- Admin overview stats — single round-trip operational snapshot.
CREATE OR REPLACE FUNCTION public.admin_overview_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    'active_today', (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '24 hours'),
    'active_week', (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '7 days')
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_overview_stats() TO authenticated;

-- Admin user directory with email pulled from auth.users.
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id uuid,
  full_name text,
  email text,
  phone text,
  role text,
  location text,
  verification_status verification_status,
  created_at timestamptz,
  last_seen_at timestamptz,
  onboarded_request_at timestamptz,
  onboarded_cover_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
