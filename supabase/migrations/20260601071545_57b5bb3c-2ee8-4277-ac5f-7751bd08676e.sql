
-- Coverage requests: real backend state for Request Coverage + Cover & Earn

CREATE TYPE public.coverage_request_status AS ENUM (
  'searching', 'accepted', 'active', 'paused', 'completed', 'cancelled'
);

CREATE TABLE public.coverage_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL,
  hospital text NOT NULL,
  area text NOT NULL,
  coverage_type text NOT NULL,
  day text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  start_ts bigint,
  end_ts bigint,
  duration_hrs numeric NOT NULL DEFAULT 0,
  amount integer NOT NULL DEFAULT 0,
  fee_pct integer NOT NULL DEFAULT 0,
  phone text NOT NULL DEFAULT '',
  note text,
  accommodation text,
  status public.coverage_request_status NOT NULL DEFAULT 'searching',
  accepted_by uuid,
  started_at bigint,
  accumulated_ms bigint NOT NULL DEFAULT 0,
  settled_amount integer,
  days integer NOT NULL DEFAULT 1,
  day_index integer NOT NULL DEFAULT 1,
  cancelled_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_coverage_requests_requester ON public.coverage_requests(requester_id);
CREATE INDEX idx_coverage_requests_accepted ON public.coverage_requests(accepted_by);
CREATE INDEX idx_coverage_requests_status ON public.coverage_requests(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coverage_requests TO authenticated;
GRANT ALL ON public.coverage_requests TO service_role;

ALTER TABLE public.coverage_requests ENABLE ROW LEVEL SECURITY;

-- Requesters: full CRUD on their own rows
CREATE POLICY "Requesters manage own requests select"
  ON public.coverage_requests FOR SELECT TO authenticated
  USING (auth.uid() = requester_id);

CREATE POLICY "Requesters insert own requests"
  ON public.coverage_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Requesters update own requests"
  ON public.coverage_requests FOR UPDATE TO authenticated
  USING (auth.uid() = requester_id)
  WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Requesters delete own requests"
  ON public.coverage_requests FOR DELETE TO authenticated
  USING (auth.uid() = requester_id);

-- Doctors (approved): see live/searching pool + anything they accepted
CREATE POLICY "Approved doctors view live and own assignments"
  ON public.coverage_requests FOR SELECT TO authenticated
  USING (
    (status = 'searching' AND accepted_by IS NULL
      AND EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = auth.uid() AND p.verification_status = 'approved'))
    OR accepted_by = auth.uid()
  );

-- Doctors can claim a searching request OR update one already assigned to them
CREATE POLICY "Approved doctors claim or update assignments"
  ON public.coverage_requests FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.verification_status = 'approved')
    AND (
      (status = 'searching' AND accepted_by IS NULL)
      OR accepted_by = auth.uid()
    )
  )
  WITH CHECK (
    accepted_by = auth.uid()
  );

-- updated_at trigger
CREATE TRIGGER coverage_requests_updated_at
  BEFORE UPDATE ON public.coverage_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Realtime
ALTER TABLE public.coverage_requests REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.coverage_requests;
