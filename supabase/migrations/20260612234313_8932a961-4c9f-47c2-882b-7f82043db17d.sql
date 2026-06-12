
-- coverage_requests: requester history, accepted-doctor history, open pool
CREATE INDEX IF NOT EXISTS idx_coverage_requests_requester_created
  ON public.coverage_requests(requester_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_coverage_requests_accepted_created
  ON public.coverage_requests(accepted_by, created_at DESC)
  WHERE accepted_by IS NOT NULL;

-- Open-pool scans: status='searching' is the hottest filter for cover doctors.
CREATE INDEX IF NOT EXISTS idx_coverage_requests_status_created
  ON public.coverage_requests(status, created_at DESC);

-- Settlement reconcile lookups by payment_reference are already unique-indexed
-- (uniq_coverage_payment_reference), so no second btree needed there.

-- profiles: admin overview counts + online-doctor + last-seen scans
CREATE INDEX IF NOT EXISTS idx_profiles_verification_status
  ON public.profiles(verification_status);

CREATE INDEX IF NOT EXISTS idx_profiles_last_seen_at
  ON public.profiles(last_seen_at DESC)
  WHERE last_seen_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_onboarded_cover
  ON public.profiles(onboarded_cover_at)
  WHERE onboarded_cover_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_onboarded_request
  ON public.profiles(onboarded_request_at)
  WHERE onboarded_request_at IS NOT NULL;

-- doctor_presence: the admin online-doctor count joins on user_id and filters
-- by (online, last_seen). The PK already covers user_id; add a partial index
-- for the "currently online" predicate.
CREATE INDEX IF NOT EXISTS idx_doctor_presence_online_last_seen
  ON public.doctor_presence(last_seen DESC)
  WHERE online = true;

-- Refresh planner stats so the new indexes are used immediately.
ANALYZE public.coverage_requests;
ANALYZE public.profiles;
ANALYZE public.doctor_presence;
