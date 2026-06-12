
-- Prevent two coverage requests from ever sharing a payment reference.
-- Partial index so historical rows without a reference are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_coverage_payment_reference
  ON public.coverage_requests(payment_reference)
  WHERE payment_reference IS NOT NULL;

-- Harden mark_settlement_paid: take a row lock first so the webhook and the
-- in-app reconcile poll serialize on the same row. The UPDATE keeps its
-- "<> 'paid'" guard, so even without the lock a second caller is a no-op,
-- but the lock removes the brief window where both could read 'unpaid'.
CREATE OR REPLACE FUNCTION public.mark_settlement_paid(_payment_reference text, _amount numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated INT;
BEGIN
  PERFORM 1
    FROM public.coverage_requests
   WHERE payment_reference = _payment_reference
   FOR UPDATE;

  UPDATE public.coverage_requests
     SET payment_status = 'paid',
         paid_at        = COALESCE(paid_at, now()),
         settled_amount = COALESCE(settled_amount, _amount)
   WHERE payment_reference = _payment_reference
     AND COALESCE(payment_status, '') <> 'paid';
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_settlement_remitted(_payment_reference text, _amount numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated INT;
BEGIN
  PERFORM 1
    FROM public.coverage_requests
   WHERE payment_reference = _payment_reference
   FOR UPDATE;

  UPDATE public.coverage_requests
     SET remitted_at = COALESCE(remitted_at, now()),
         settled_amount = COALESCE(settled_amount, _amount)
   WHERE payment_reference = _payment_reference
     AND payment_status = 'paid'
     AND remitted_at IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$function$;
