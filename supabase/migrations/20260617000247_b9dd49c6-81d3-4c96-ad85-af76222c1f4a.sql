-- Pre-acceptance: 180-second SEARCHING auto-expiry, rev bump on edit/resume,
-- dismiss-as-rebroadcast support.

-- 1) New terminal state 'expired' on coverage_request_status.
ALTER TYPE public.coverage_request_status ADD VALUE IF NOT EXISTS 'expired';

-- 2) New columns. broadcast_started_at = when this request was last offered
-- to the doctor pool (publish, edit re-broadcast, or dismiss-resume). rev =
-- monotonic offer revision so doctor decline keys can be invalidated by edits.
ALTER TABLE public.coverage_requests
  ADD COLUMN IF NOT EXISTS rev INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS broadcast_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS coverage_requests_broadcast_started_at_idx
  ON public.coverage_requests(broadcast_started_at);
