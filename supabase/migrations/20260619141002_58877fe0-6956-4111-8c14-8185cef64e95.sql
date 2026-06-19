
-- =====================================================================
-- TRACK B — Payment Enforcement Engine
-- =====================================================================

-- 1) Extra columns on coverage_requests for cap + base-amount tracking.
ALTER TABLE public.coverage_requests
  ADD COLUMN IF NOT EXISTS base_amount      numeric,
  ADD COLUMN IF NOT EXISTS surcharge_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS surcharge_capped_at timestamptz;

-- 2) Profile-level flag (system) is distinct from restriction (admin-only).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS payment_flagged_at    timestamptz,
  ADD COLUMN IF NOT EXISTS payment_flagged_reason text;

-- =====================================================================
-- 3) Surcharge ledger
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.payment_surcharge_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid NOT NULL REFERENCES public.coverage_requests(id) ON DELETE CASCADE,
  block_index  int NOT NULL,
  block_amount numeric NOT NULL,
  running_total numeric NOT NULL,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  source       text NOT NULL DEFAULT 'cron',
  UNIQUE (request_id, block_index)
);

GRANT SELECT ON public.payment_surcharge_log TO authenticated;
GRANT ALL    ON public.payment_surcharge_log TO service_role;

ALTER TABLE public.payment_surcharge_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "requester or admin can view surcharge log"
  ON public.payment_surcharge_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.coverage_requests cr
             WHERE cr.id = payment_surcharge_log.request_id
               AND (cr.requester_id = auth.uid()
                    OR public.has_role(auth.uid(), 'admin')))
  );

CREATE INDEX IF NOT EXISTS payment_surcharge_log_request_idx
  ON public.payment_surcharge_log (request_id, block_index);

-- =====================================================================
-- 4) Admin payment-action audit
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.admin_payment_actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  admin_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id  uuid REFERENCES public.coverage_requests(id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (action IN ('restrict','lift','extend','freeze','escalate','clear_flag','clear')),
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.admin_payment_actions TO authenticated;
GRANT ALL    ON public.admin_payment_actions TO service_role;

ALTER TABLE public.admin_payment_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins can view all payment actions"
  ON public.admin_payment_actions
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS admin_payment_actions_user_idx
  ON public.admin_payment_actions (user_id, created_at DESC);

-- =====================================================================
-- 5) extend_payment_window — REWRITTEN
--    Per spec: surcharge block uses the locked tier's NIGHT rate; Home
--    Care uses Home rate. Cap at 96 blocks (= 24 hours); on cap, freeze
--    and flag the account (no auto-restriction).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.extend_payment_window(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.coverage_requests;
  v_id uuid;
  product text;
  tier text;
  hourly_rate int;
  busy_mult numeric;
  block_min int;
  block_charge numeric;
  cap_blocks int;
  next_index int;
  rates_row record;
  home_rate int;
  base numeric;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF COALESCE(r.payment_status,'') = 'paid' THEN
    RETURN jsonb_build_object('skipped','already_paid');
  END IF;
  IF r.payment_due_at IS NULL OR now() < r.payment_due_at THEN
    RETURN jsonb_build_object('skipped','window_not_expired',
      'payment_due_at', r.payment_due_at);
  END IF;
  IF r.surcharge_capped_at IS NOT NULL THEN
    RETURN jsonb_build_object('skipped','already_capped',
      'capped_at', r.surcharge_capped_at);
  END IF;

  v_id := COALESCE(r.pricing_version_id, public._active_pricing_version_id());
  product := COALESCE(r.rate_snapshot->>'product', 'standard');
  busy_mult := CASE WHEN r.environment = 'busy' AND product <> 'home'
                    THEN COALESCE(public._pricing_modifier(v_id, 'busy_mult'), 1.25)
                    ELSE 1.0 END;
  block_min := COALESCE(public._pricing_modifier(v_id, 'block_min')::int, 15);
  cap_blocks := COALESCE(public._pricing_modifier(v_id, 'surcharge_cap_blocks')::int, 96);

  -- Resolve hourly rate for the block (night rate of locked tier; Home rate for Home).
  IF product = 'home' THEN
    hourly_rate := COALESCE(public._pricing_flat(v_id, 'home_hour'), 12000);
  ELSIF product IN ('straight_24h','straight_48h') THEN
    -- Straight uses the documented surcharge hourly rate.
    hourly_rate := COALESCE(public._pricing_modifier(v_id, 'straight_per_hour')::int, 1500);
  ELSE
    tier := COALESCE(r.rate_snapshot->>'tier', '>6h');
    IF tier NOT IN ('<4h','4-6h','>6h') THEN tier := '>6h'; END IF;
    SELECT pr.rate_night INTO rates_row FROM public._pricing_rate(v_id, tier) pr;
    hourly_rate := COALESCE(rates_row.rate_night, 1500);
  END IF;

  block_charge := ROUND((hourly_rate::numeric * block_min / 60.0) * busy_mult);

  -- Set base_amount if first time (the End Shift total before any surcharge).
  IF r.base_amount IS NULL THEN
    UPDATE public.coverage_requests
       SET base_amount = COALESCE(total_billed_amount, 0)
     WHERE id = _request_id
     RETURNING * INTO r;
  END IF;
  base := COALESCE(r.base_amount, 0);

  next_index := COALESCE(r.payment_extension_count, 0) + 1;

  UPDATE public.coverage_requests
     SET total_billed_amount      = COALESCE(total_billed_amount, 0) + block_charge,
         settled_amount           = COALESCE(total_billed_amount, 0) + block_charge,
         surcharge_amount         = COALESCE(surcharge_amount, 0) + block_charge,
         payment_due_at           = now() + interval '15 minutes',
         payment_extension_count  = next_index,
         last_extended_at         = now()
   WHERE id = _request_id
   RETURNING * INTO r;

  INSERT INTO public.payment_surcharge_log (request_id, block_index, block_amount, running_total, source)
  VALUES (_request_id, next_index, block_charge, r.total_billed_amount, 'manual')
  ON CONFLICT (request_id, block_index) DO NOTHING;

  -- 24h / 96-block cap: freeze amount and flag the account for admin review.
  IF next_index >= cap_blocks THEN
    UPDATE public.coverage_requests
       SET surcharge_capped_at = now()
     WHERE id = _request_id;

    UPDATE public.profiles
       SET payment_flagged_at    = COALESCE(payment_flagged_at, now()),
           payment_flagged_reason = COALESCE(payment_flagged_reason,
             'Surcharge cap reached on shift ' || _request_id::text)
     WHERE id = r.requester_id;
  END IF;

  RETURN jsonb_build_object(
    'total_billed_amount', r.total_billed_amount,
    'base_amount', base,
    'surcharge_amount', r.surcharge_amount,
    'payment_due_at', r.payment_due_at,
    'extension_count', r.payment_extension_count,
    'block_charge', block_charge,
    'capped', next_index >= cap_blocks
  );
END $$;

-- =====================================================================
-- 6) drain_surcharge_due — cron entry point.
--    Applies one block per request whose payment_due_at has passed and
--    that hasn't hit the cap. Service-role only.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.drain_surcharge_due()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec record;
  v_id uuid;
  product text;
  tier text;
  hourly_rate int;
  busy_mult numeric;
  block_min int;
  block_charge numeric;
  cap_blocks int;
  next_index int;
  rates_row record;
  processed int := 0;
  capped int := 0;
BEGIN
  FOR rec IN
    SELECT * FROM public.coverage_requests
     WHERE billing_locked_at IS NOT NULL
       AND COALESCE(payment_status,'') <> 'paid'
       AND payment_due_at IS NOT NULL
       AND payment_due_at <= now()
       AND surcharge_capped_at IS NULL
     ORDER BY payment_due_at
     LIMIT 200
  LOOP
    v_id := COALESCE(rec.pricing_version_id, public._active_pricing_version_id());
    product := COALESCE(rec.rate_snapshot->>'product', 'standard');
    busy_mult := CASE WHEN rec.environment = 'busy' AND product <> 'home'
                      THEN COALESCE(public._pricing_modifier(v_id, 'busy_mult'), 1.25)
                      ELSE 1.0 END;
    block_min := COALESCE(public._pricing_modifier(v_id, 'block_min')::int, 15);
    cap_blocks := COALESCE(public._pricing_modifier(v_id, 'surcharge_cap_blocks')::int, 96);

    IF product = 'home' THEN
      hourly_rate := COALESCE(public._pricing_flat(v_id, 'home_hour'), 12000);
    ELSIF product IN ('straight_24h','straight_48h') THEN
      hourly_rate := COALESCE(public._pricing_modifier(v_id, 'straight_per_hour')::int, 1500);
    ELSE
      tier := COALESCE(rec.rate_snapshot->>'tier', '>6h');
      IF tier NOT IN ('<4h','4-6h','>6h') THEN tier := '>6h'; END IF;
      SELECT pr.rate_night INTO rates_row FROM public._pricing_rate(v_id, tier) pr;
      hourly_rate := COALESCE(rates_row.rate_night, 1500);
    END IF;

    block_charge := ROUND((hourly_rate::numeric * block_min / 60.0) * busy_mult);

    IF rec.base_amount IS NULL THEN
      UPDATE public.coverage_requests
         SET base_amount = COALESCE(total_billed_amount, 0)
       WHERE id = rec.id;
      rec.base_amount := COALESCE(rec.total_billed_amount, 0);
    END IF;

    next_index := COALESCE(rec.payment_extension_count, 0) + 1;

    UPDATE public.coverage_requests
       SET total_billed_amount      = COALESCE(total_billed_amount, 0) + block_charge,
           settled_amount           = COALESCE(total_billed_amount, 0) + block_charge,
           surcharge_amount         = COALESCE(surcharge_amount, 0) + block_charge,
           payment_due_at           = now() + interval '15 minutes',
           payment_extension_count  = next_index,
           last_extended_at         = now()
     WHERE id = rec.id;

    INSERT INTO public.payment_surcharge_log (request_id, block_index, block_amount, running_total, source)
    SELECT rec.id, next_index, block_charge,
           (SELECT total_billed_amount FROM public.coverage_requests WHERE id = rec.id),
           'cron'
    ON CONFLICT (request_id, block_index) DO NOTHING;

    IF next_index >= cap_blocks THEN
      UPDATE public.coverage_requests
         SET surcharge_capped_at = now()
       WHERE id = rec.id;

      UPDATE public.profiles
         SET payment_flagged_at    = COALESCE(payment_flagged_at, now()),
             payment_flagged_reason = COALESCE(payment_flagged_reason,
               'Surcharge cap reached on shift ' || rec.id::text)
       WHERE id = rec.requester_id;

      capped := capped + 1;
    END IF;

    processed := processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', processed, 'capped', capped);
END $$;

REVOKE EXECUTE ON FUNCTION public.drain_surcharge_due() FROM public, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.drain_surcharge_due() TO service_role;

-- =====================================================================
-- 7) get_my_payment_restriction — REWRITTEN to expose flagged + restricted separately
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_my_payment_restriction()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  pay_restricted_at timestamptz;
  acc_restricted_at timestamptz;
  acc_reason text;
  flagged_at timestamptz;
  flagged_reason text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT payment_restricted_at, account_restricted_at, account_restricted_reason,
         payment_flagged_at, payment_flagged_reason
    INTO pay_restricted_at, acc_restricted_at, acc_reason,
         flagged_at, flagged_reason
    FROM public.profiles WHERE id = uid;
  RETURN jsonb_build_object(
    'restricted', (pay_restricted_at IS NOT NULL) OR (acc_restricted_at IS NOT NULL),
    'restricted_at', pay_restricted_at,
    'payment_restricted', pay_restricted_at IS NOT NULL,
    'account_restricted', acc_restricted_at IS NOT NULL,
    'account_restricted_at', acc_restricted_at,
    'account_restricted_reason', acc_reason,
    'payment_flagged', flagged_at IS NOT NULL,
    'payment_flagged_at', flagged_at,
    'payment_flagged_reason', flagged_reason,
    'overdue', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cr.id, 'hospital', cr.hospital,
        'total_billed_amount', cr.total_billed_amount,
        'base_amount', cr.base_amount,
        'surcharge_amount', cr.surcharge_amount,
        'payment_due_at', cr.payment_due_at,
        'payment_extension_count', cr.payment_extension_count,
        'surcharge_capped_at', cr.surcharge_capped_at
      ))
      FROM public.coverage_requests cr
      WHERE cr.requester_id = uid
        AND cr.billing_locked_at IS NOT NULL
        AND COALESCE(cr.payment_status,'') <> 'paid'
    ), '[]'::jsonb)
  );
END $$;

-- =====================================================================
-- 8) Admin RPCs
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_apply_payment_restriction(
  _user_id uuid, _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.profiles
     SET payment_restricted_at = COALESCE(payment_restricted_at, now())
   WHERE id = _user_id;
  INSERT INTO public.admin_payment_actions (user_id, admin_id, action, reason)
  VALUES (_user_id, auth.uid(), 'restrict', _reason);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_clear_payment_restriction(
  _user_id uuid, _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.profiles
     SET payment_restricted_at = NULL
   WHERE id = _user_id;
  INSERT INTO public.admin_payment_actions (user_id, admin_id, action, reason)
  VALUES (_user_id, auth.uid(), 'lift', _reason);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_clear_payment_flag(
  _user_id uuid, _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.profiles
     SET payment_flagged_at = NULL,
         payment_flagged_reason = NULL
   WHERE id = _user_id;
  INSERT INTO public.admin_payment_actions (user_id, admin_id, action, reason)
  VALUES (_user_id, auth.uid(), 'clear_flag', _reason);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_flagged_accounts()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', p.id,
      'full_name', p.full_name,
      'email', p.email,
      'payment_flagged_at', p.payment_flagged_at,
      'payment_flagged_reason', p.payment_flagged_reason,
      'payment_restricted_at', p.payment_restricted_at,
      'outstanding_total', (
        SELECT COALESCE(SUM(total_billed_amount), 0)
          FROM public.coverage_requests cr
         WHERE cr.requester_id = p.id
           AND COALESCE(cr.payment_status,'') <> 'paid'
           AND cr.billing_locked_at IS NOT NULL
      ),
      'capped_shifts', (
        SELECT COUNT(*) FROM public.coverage_requests cr
         WHERE cr.requester_id = p.id
           AND cr.surcharge_capped_at IS NOT NULL
           AND COALESCE(cr.payment_status,'') <> 'paid'
      )
    ) ORDER BY p.payment_flagged_at DESC)
    FROM public.profiles p
    WHERE p.payment_flagged_at IS NOT NULL
       OR p.payment_restricted_at IS NOT NULL
  ), '[]'::jsonb);
END $$;

-- =====================================================================
-- 9) On webhook payment success: clear the flag for that requester
--    (kept as a helper; called from monnify webhook path going forward).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.clear_payment_flag_on_settlement(_request_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid;
  unpaid_count int;
BEGIN
  SELECT requester_id INTO uid FROM public.coverage_requests WHERE id = _request_id;
  IF uid IS NULL THEN RETURN; END IF;
  SELECT COUNT(*) INTO unpaid_count
    FROM public.coverage_requests
   WHERE requester_id = uid
     AND COALESCE(payment_status,'') <> 'paid'
     AND billing_locked_at IS NOT NULL;
  IF unpaid_count = 0 THEN
    UPDATE public.profiles
       SET payment_flagged_at = NULL,
           payment_flagged_reason = NULL
     WHERE id = uid AND payment_flagged_at IS NOT NULL;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.clear_payment_flag_on_settlement(uuid) FROM public, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.clear_payment_flag_on_settlement(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.admin_apply_payment_restriction(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clear_payment_restriction(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clear_payment_flag(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_flagged_accounts() TO authenticated;
