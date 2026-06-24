-- Restore postgres_changes (and presence) authorization on realtime.messages.
--
-- Migration 20260621032917 replaced the realtime.messages SELECT policy with
-- a broadcast-only clause and accidentally dropped the
-- `OR extension = 'postgres_changes'` clause that 20260620221844 had been
-- careful to keep. The result: all postgres_changes events were silently
-- denied for authenticated clients, so doctor_presence and coverage_requests
-- UPDATE/INSERT events stopped flowing in realtime. Online/offline and
-- request-edit visibility only refreshed on the 60s reconcile timer.
--
-- This restores the previous behaviour. Table RLS on doctor_presence and
-- coverage_requests still enforces who can read which rows; the realtime.messages
-- policy only governs the transport. The broadcast-extension restriction
-- (coverage_invalidations topic only) is preserved.

DROP POLICY IF EXISTS "Authenticated can read coverage invalidations" ON realtime.messages;

CREATE POLICY "Authenticated can read coverage invalidations"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (extension = 'broadcast' AND topic = 'coverage_invalidations')
  OR extension = 'postgres_changes'
  OR extension = 'presence'
);