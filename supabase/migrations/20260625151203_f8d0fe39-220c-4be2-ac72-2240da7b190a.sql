
-- 1. doctor_presence SELECT policy: require active coverage request for the "online doctors" branch
DROP POLICY IF EXISTS "Presence readable by self admin assigned requester or online ap" ON public.doctor_presence;
CREATE POLICY "Presence readable by self admin assigned requester or online ap"
ON public.doctor_presence
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.coverage_requests cr
    WHERE cr.accepted_by = doctor_presence.user_id
      AND cr.requester_id = auth.uid()
  )
  OR (
    online = true
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = doctor_presence.user_id
        AND p.verification_status = 'approved'::verification_status
        AND p.account_restricted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.coverage_requests cr2
      WHERE cr2.requester_id = auth.uid()
        AND cr2.status IN (
          'searching'::coverage_request_status,
          'accepted'::coverage_request_status,
          'active'::coverage_request_status,
          'paused'::coverage_request_status,
          'awaiting_payment'::coverage_request_status
        )
    )
  )
);

-- 2. realtime.messages SELECT policy: drop open postgres_changes branch
DROP POLICY IF EXISTS "Authenticated can read coverage invalidations" ON realtime.messages;
CREATE POLICY "Authenticated can read coverage invalidations"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  extension = 'broadcast'::text
  AND topic = 'coverage_invalidations'::text
);

-- 3. Revoke anon EXECUTE on SECURITY DEFINER admin helper
REVOKE EXECUTE ON FUNCTION public.admin_list_trust_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_trust_history(uuid) TO authenticated;

-- 4. Pin search_path on pgmq wrapper functions
ALTER FUNCTION public.delete_email(text, bigint)         SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.enqueue_email(text, jsonb)         SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb)   SET search_path = public, pgmq;
