
-- ============================================================
-- Phase 1: Harden mark_settlement_paid against underpayment
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payment_underpayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.coverage_requests(id) ON DELETE CASCADE,
  payment_reference text NOT NULL,
  expected_amount numeric NOT NULL,
  received_amount numeric NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb
);

CREATE INDEX IF NOT EXISTS payment_underpayments_ref_idx
  ON public.payment_underpayments(payment_reference);

GRANT SELECT ON public.payment_underpayments TO authenticated;
GRANT ALL ON public.payment_underpayments TO service_role;

ALTER TABLE public.payment_underpayments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view underpayments"
  ON public.payment_underpayments FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- Phase 2: Per-request rate snapshot columns
-- (pricing_version_id FK added in Phase 3 once pricing_versions exists)
-- ============================================================

ALTER TABLE public.coverage_requests
  ADD COLUMN IF NOT EXISTS pricing_version_id uuid,
  ADD COLUMN IF NOT EXISTS rate_snapshot jsonb;

-- ============================================================
-- Rewrite mark_settlement_paid: enforce amount >= expected
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_settlement_paid(
  _payment_reference text,
  _amount numeric
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.coverage_requests;
  updated INT;
  remaining INT;
  expected numeric;
BEGIN
  SELECT * INTO r FROM public.coverage_requests
   WHERE payment_reference = _payment_reference
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF COALESCE(r.payment_status,'') = 'paid' THEN
    -- Idempotent: a duplicate webhook for an already-paid shift is a no-op.
    RETURN true;
  END IF;

  expected := COALESCE(r.total_billed_amount, 0);

  -- Underpayment guard: do NOT mark paid. Log and exit false so the webhook
  -- handler can ack the provider without flipping payment status.
  IF _amount < expected THEN
    INSERT INTO public.payment_underpayments(
      request_id, payment_reference, expected_amount, received_amount, raw
    ) VALUES (
      r.id, _payment_reference, expected, _amount,
      jsonb_build_object('expected', expected, 'received', _amount)
    );
    RETURN false;
  END IF;

  -- settled_amount is always pinned to the server-computed total. We never
  -- trust the caller's amount as a billable figure.
  UPDATE public.coverage_requests
     SET payment_status = 'paid',
         paid_at = COALESCE(paid_at, now()),
         settled_amount = expected
   WHERE id = r.id
     AND COALESCE(payment_status,'') <> 'paid';
  GET DIAGNOSTICS updated = ROW_COUNT;

  IF updated > 0 THEN
    UPDATE public.shift_segments
       SET settled_at = COALESCE(settled_at, now())
     WHERE request_id = r.id AND settled_at IS NULL;

    -- Multi-day auto-advance preserved from prior implementation.
    SELECT * INTO r FROM public.coverage_requests WHERE id = r.id;
    IF r.status = 'paused' AND COALESCE(r.day_index, 1) < COALESCE(r.days, 1) THEN
      UPDATE public.coverage_requests
         SET status = 'accepted',
             accumulated_ms = 0,
             started_at = NULL,
             day_index = COALESCE(r.day_index, 1) + 1,
             payment_due_at = NULL
       WHERE id = r.id;
    END IF;

    -- Lift payment restriction once no overdue unpaid shifts remain.
    SELECT count(*) INTO remaining FROM public.coverage_requests
     WHERE requester_id = r.requester_id
       AND billing_locked_at IS NOT NULL
       AND COALESCE(payment_status,'') <> 'paid';
    IF remaining = 0 THEN
      UPDATE public.profiles
         SET payment_restricted_at = NULL
       WHERE id = r.requester_id;
    END IF;
  END IF;

  RETURN updated > 0;
END $function$;
