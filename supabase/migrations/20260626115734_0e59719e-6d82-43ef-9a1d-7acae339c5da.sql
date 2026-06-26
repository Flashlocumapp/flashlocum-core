
-- 1) Pricing tables: drop anon read access; allow authenticated only
DROP POLICY IF EXISTS "Pricing versions readable by all" ON public.pricing_versions;
DROP POLICY IF EXISTS "Pricing rates readable by all" ON public.pricing_rates;
DROP POLICY IF EXISTS "Pricing flats readable by all" ON public.pricing_flats;
DROP POLICY IF EXISTS "Pricing modifiers readable by all" ON public.pricing_modifiers;

CREATE POLICY "Pricing versions readable by authenticated"
  ON public.pricing_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Pricing rates readable by authenticated"
  ON public.pricing_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Pricing flats readable by authenticated"
  ON public.pricing_flats FOR SELECT TO authenticated USING (true);
CREATE POLICY "Pricing modifiers readable by authenticated"
  ON public.pricing_modifiers FOR SELECT TO authenticated USING (true);

REVOKE SELECT ON public.pricing_versions FROM anon;
REVOKE SELECT ON public.pricing_rates FROM anon;
REVOKE SELECT ON public.pricing_flats FROM anon;
REVOKE SELECT ON public.pricing_modifiers FROM anon;

-- 2) Coverage requests: revoke column-level SELECT on the most sensitive
--    requester-only payment-instrument fields from the regular app roles.
--    Server functions that legitimately need these read via supabaseAdmin
--    (service_role), which is not affected by these revokes.
REVOKE SELECT (payment_url, payment_account) ON public.coverage_requests FROM authenticated;
REVOKE SELECT (payment_url, payment_account) ON public.coverage_requests FROM anon;
