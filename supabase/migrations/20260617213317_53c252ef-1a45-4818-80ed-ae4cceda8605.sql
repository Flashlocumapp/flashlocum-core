-- Lock down SECURITY DEFINER trigger functions that were executable by anon/PUBLIC.
-- These are trigger functions only; they fire as the table owner and never need
-- to be invoked directly through the API.

REVOKE EXECUTE ON FUNCTION public._cr_enforce_account_restriction() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._profiles_force_offline_on_restriction() FROM PUBLIC, anon;
