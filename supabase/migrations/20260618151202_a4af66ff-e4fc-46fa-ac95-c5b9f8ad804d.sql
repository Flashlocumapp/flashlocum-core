
-- 1. doctor_presence: replace broad SELECT policy
DROP POLICY IF EXISTS "Authenticated can read presence" ON public.doctor_presence;

CREATE POLICY "Presence readable by self admin or assigned requester"
  ON public.doctor_presence
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.coverage_requests cr
       WHERE cr.accepted_by = doctor_presence.user_id
         AND cr.requester_id = auth.uid()
    )
  );

-- 2. ratings: replace broad SELECT policy with participant-scoped read
DROP POLICY IF EXISTS "Authenticated can read ratings" ON public.ratings;

CREATE POLICY "Ratings readable by participants or admin"
  ON public.ratings
  FOR SELECT
  TO authenticated
  USING (
    rater_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR ratee_entity_id = 'doc:' || auth.uid()::text
    OR ratee_entity_id = 'req:' || auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.coverage_requests cr
       WHERE cr.id = ratings.shift_id
         AND (cr.requester_id = auth.uid() OR cr.accepted_by = auth.uid())
    )
  );

-- 3. Realtime publication: republish profiles and coverage_requests with
--    a column allow-list so sensitive fields are not broadcast via CDC.
ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles
  (id, role, full_name, gender, years_experience, location,
   verification_status, onboarded_at, onboarded_request_at, onboarded_cover_at,
   verification_action_at, verification_action_target,
   payment_restricted_at, account_restricted_at,
   trust_snapshot_at, last_seen_at, created_at, updated_at);

ALTER PUBLICATION supabase_realtime DROP TABLE public.coverage_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.coverage_requests
  (id, requester_id, accepted_by, hospital, area, coverage_type,
   day, start_time, end_time, start_ts, end_ts, duration_hrs, amount, fee_pct,
   status, started_at, accumulated_ms, days, day_index,
   environment, rev, broadcast_started_at, expired_at, first_started_at,
   requester_rating_submitted, requester_rating_score, requester_rating_at,
   doctor_rating_submitted, doctor_rating_score, doctor_rating_at,
   created_at, updated_at);
