CREATE OR REPLACE FUNCTION public.list_online_approved_doctors()
RETURNS TABLE(user_id uuid, online boolean, last_seen timestamptz,
              top double precision, "left" double precision,
              lat double precision, lng double precision)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT dp.user_id, dp.online, dp.last_seen, dp.top, dp."left", dp.lat, dp.lng
    FROM public.doctor_presence dp
    JOIN public.profiles p ON p.id = dp.user_id
   WHERE dp.online = true
     AND p.verification_status = 'approved';
$$;