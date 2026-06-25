
-- 1) Restrict INSERT (broadcast send) on realtime.messages to service_role.
--    The DB trigger coverage_requests_emit_invalidate() already publishes
--    invalidations via realtime.send() with SECURITY DEFINER, so authenticated
--    clients do not need INSERT here. Removes the spoofing surface.
DROP POLICY IF EXISTS "Authenticated can send coverage invalidations" ON realtime.messages;

CREATE POLICY "Service role can send coverage invalidations"
ON realtime.messages
FOR INSERT
TO service_role
WITH CHECK (extension = 'broadcast' AND topic = 'coverage_invalidations');

-- 2) Drop the unconditional `presence` extension clause from the SELECT
--    policy. The app does not use Supabase Realtime Presence (doctor
--    presence is tracked via the public.doctor_presence table + postgres_changes).
--    The allowed subscriptions are: broadcast on 'coverage_invalidations'
--    and postgres_changes (RLS-gated per source table).
DROP POLICY IF EXISTS "Authenticated can read coverage invalidations" ON realtime.messages;

CREATE POLICY "Authenticated can read coverage invalidations"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (extension = 'broadcast' AND topic = 'coverage_invalidations')
  OR extension = 'postgres_changes'
);
