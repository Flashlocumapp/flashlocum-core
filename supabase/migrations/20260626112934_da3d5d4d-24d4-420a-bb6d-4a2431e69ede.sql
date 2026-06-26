-- Align doctor_presence SELECT visibility with broadcast eligibility.
-- Prior policy gated visibility on the requester having an active coverage
-- request, which caused doctors to receive broadcasts but not appear on the
-- requester Home map. Visibility and broadcast eligibility must use the
-- same source of truth: online + approved + not restricted.

DROP POLICY IF EXISTS "Presence readable by self admin assigned requester or online ap" ON public.doctor_presence;

CREATE POLICY "Presence readable: self, admin, assigned requester, online approved"
  ON public.doctor_presence
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.coverage_requests cr
      WHERE cr.accepted_by = doctor_presence.user_id
        AND cr.requester_id = auth.uid()
    )
    OR (
      online = true
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = doctor_presence.user_id
          AND p.verification_status = 'approved'::public.verification_status
          AND p.account_restricted_at IS NULL
      )
    )
  );

-- Tighten the initial RPC to match the policy (exclude restricted accounts).
CREATE OR REPLACE FUNCTION public.list_online_approved_doctors()
RETURNS TABLE(user_id uuid, online boolean, last_seen timestamp with time zone, top double precision, "left" double precision, lat double precision, lng double precision)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT dp.user_id, dp.online, dp.last_seen, dp.top, dp."left", dp.lat, dp.lng
    FROM public.doctor_presence dp
    JOIN public.profiles p ON p.id = dp.user_id
   WHERE dp.online = true
     AND p.verification_status = 'approved'
     AND p.account_restricted_at IS NULL;
$function$;