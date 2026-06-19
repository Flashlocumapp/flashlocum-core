-- Pre-shift reminder bookkeeping
ALTER TABLE public.coverage_requests
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- Index so the cron query is cheap.
CREATE INDEX IF NOT EXISTS coverage_requests_reminder_lookup_idx
  ON public.coverage_requests (start_ts)
  WHERE reminder_sent_at IS NULL;

-- ============================================================
-- notification_outbox — durable retry queue for failed pushes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  entity_id text NOT NULL,
  version bigint NOT NULL,
  occurred_at bigint NOT NULL,
  audience text NOT NULL CHECK (audience IN ('doctor','requester')),
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Outbox is server-managed only. No anon/authenticated access.
GRANT ALL ON public.notification_outbox TO service_role;

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

-- No authenticated/anon policies — service_role bypasses RLS for cron + push retry.
CREATE POLICY "service role full access"
  ON public.notification_outbox
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Index for the retry sweep.
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
  ON public.notification_outbox (next_attempt_at)
  WHERE delivered_at IS NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notification_outbox_set_updated_at ON public.notification_outbox;
CREATE TRIGGER notification_outbox_set_updated_at
  BEFORE UPDATE ON public.notification_outbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
