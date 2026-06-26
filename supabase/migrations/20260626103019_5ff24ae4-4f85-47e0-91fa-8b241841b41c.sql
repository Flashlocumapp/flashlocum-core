CREATE INDEX IF NOT EXISTS coverage_requests_open_feed_idx
  ON public.coverage_requests (created_at DESC)
  WHERE status = 'searching';

CREATE INDEX IF NOT EXISTS doctor_presence_online_idx
  ON public.doctor_presence (last_seen DESC)
  WHERE online = true;