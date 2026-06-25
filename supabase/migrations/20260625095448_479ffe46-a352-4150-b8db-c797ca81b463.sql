CREATE OR REPLACE FUNCTION public.drain_surcharge_due()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec public.coverage_requests;
  v_id uuid;
  block_charge numeric;
  cap_blocks int;
  next_index int;
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
    cap_blocks := COALESCE(public._pricing_modifier(v_id, 'surcharge_cap_blocks')::int, 96);
    block_charge := public._surcharge_block_amount(rec);

    IF rec.base_amount IS NULL THEN
      UPDATE public.coverage_requests
         SET base_amount = COALESCE(total_billed_amount, 0)
       WHERE id = rec.id;
    END IF;

    next_index := COALESCE(rec.payment_extension_count, 0) + 1;

    UPDATE public.coverage_requests
       SET total_billed_amount      = COALESCE(total_billed_amount, 0) + block_charge,
           settled_amount           = COALESCE(total_billed_amount, 0) + block_charge,
           surcharge_amount         = COALESCE(surcharge_amount, 0) + block_charge,
           payment_due_at           = now() + interval '15 minutes',
           payment_extension_count  = next_index,
           last_extended_at         = now(),
           payment_account          = NULL,
           payment_reference        = NULL,
           payment_url              = NULL
     WHERE id = rec.id;

    INSERT INTO public.payment_surcharge_log (request_id, block_index, block_amount, running_total, source)
    SELECT rec.id, next_index, block_charge, total_billed_amount, 'cron'
      FROM public.coverage_requests WHERE id = rec.id
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

    PERFORM realtime.send(
      jsonb_build_object('id', rec.id, 'reason', 'surcharge',
                         'at', (extract(epoch from now()) * 1000)::bigint),
      'invalidate', 'coverage_invalidations', false);

    processed := processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', processed, 'capped', capped);
END $$;