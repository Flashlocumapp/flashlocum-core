ALTER TABLE public.coverage_requests
  ADD COLUMN IF NOT EXISTS payment_account jsonb;

COMMENT ON COLUMN public.coverage_requests.payment_account IS
  'Cached Monnify virtual-account details for the current pending payment_reference (accountNumber, accountName, bankName, amount, expiresOn). Cleared when a fresh reference is minted.';