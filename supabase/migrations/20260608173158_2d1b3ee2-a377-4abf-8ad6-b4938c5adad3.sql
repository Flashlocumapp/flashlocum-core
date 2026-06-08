
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS monnify_sub_account_code TEXT;

ALTER TABLE public.coverage_requests
  ADD COLUMN IF NOT EXISTS payment_provider  TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS payment_status    TEXT,
  ADD COLUMN IF NOT EXISTS payment_url       TEXT,
  ADD COLUMN IF NOT EXISTS paid_at           TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS coverage_requests_payment_reference_idx
  ON public.coverage_requests (payment_reference);

-- Idempotent webhook handler. Service-role callable only.
CREATE OR REPLACE FUNCTION public.mark_settlement_paid(
  _payment_reference TEXT,
  _amount NUMERIC
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated INT;
BEGIN
  UPDATE public.coverage_requests
     SET payment_status = 'paid',
         paid_at        = COALESCE(paid_at, now()),
         settled_amount = COALESCE(settled_amount, _amount)
   WHERE payment_reference = _payment_reference
     AND COALESCE(payment_status, '') <> 'paid';
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_settlement_paid(TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_settlement_paid(TEXT, NUMERIC) TO service_role;
