-- Restrict the internal Monnify sub-account identifier to service_role.
-- It is never displayed to users — only the server uses it when creating
-- payouts via supabaseAdmin, which bypasses these grants.
REVOKE SELECT (monnify_sub_account_code), UPDATE (monnify_sub_account_code), INSERT (monnify_sub_account_code)
  ON public.profiles FROM authenticated;
REVOKE SELECT (monnify_sub_account_code), UPDATE (monnify_sub_account_code), INSERT (monnify_sub_account_code)
  ON public.profiles FROM anon;