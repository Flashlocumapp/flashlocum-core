-- FLASHLOCUM — BILLING ENGINE CORRECTION (E1 + E2 + E3 + E4 + Backfill)

DROP FUNCTION IF EXISTS public._effective_product(text, int, int);

CREATE OR REPLACE FUNCTION public._effective_product(
  _coverage_type text,
  _booked_per_day_min int,
  _days int
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN lower(coalesce(_coverage_type,'')) LIKE 'home%'    THEN 'home'
    WHEN lower(coalesce(_coverage_type,'')) LIKE '24%'      THEN 'straight_24h'
    WHEN lower(coalesce(_coverage_type,'')) LIKE '48%'      THEN 'straight_48h'
    WHEN lower(coalesce(_coverage_type,'')) LIKE 'weekend%' THEN 'straight_48h'
    WHEN COALESCE(_booked_per_day_min,0) = 1440
      AND COALESCE(_days,1) = 1 THEN 'straight_24h'
    WHEN COALESCE(_booked_per_day_min,0) = 1440
      AND COALESCE(_days,1) = 2 THEN 'straight_48h'
    ELSE 'standard'
  END
$$;

GRANT EXECUTE ON FUNCTION public._effective_product(text,int,int)
  TO authenticated, anon, service_role;


CREATE OR REPLACE FUNCTION public.compute_quote(
  _start timestamptz, _end timestamptz,
  _environment text DEFAULT 'normal',
  _coverage_kind text DEFAULT 'standard'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_id uuid := public._active_pricing_version_id();
  busy_mult numeric; home_busy numeric;
  total_min int; d_min int; n_min int;
  booked_hr numeric;
  tier text; rates_row record;
  rate_day int; rate_night int;
  flat_amount int; home_rate int;
  amount numeric;
  ck text := lower(coalesce(_coverage_kind, 'standard'));
  product text;
  per_day_min int;
  inferred_days int;
BEGIN
  IF _end <= _start THEN
    RETURN jsonb_build_object('amount', 0,
      'breakdown', jsonb_build_object('error','end_before_start'));
  END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'No active pricing version'; END IF;

  SELECT day_min, night_min INTO d_min, n_min
    FROM public._split_day_night_minutes(_start, _end);
  total_min := d_min + n_min;
  booked_hr := total_min::numeric / 60.0;

  inferred_days := CASE WHEN total_min = 2880 THEN 2 ELSE 1 END;
  per_day_min := CASE WHEN total_min IN (1440, 2880) THEN 1440 ELSE total_min END;

  home_busy := COALESCE(public._pricing_modifier(v_id, 'home_busy_applies'), 0);
  busy_mult := CASE WHEN _environment = 'busy'
                    THEN COALESCE(public._pricing_modifier(v_id, 'busy_mult'), 1.25)
                    ELSE 1.0 END;

  product := CASE
    WHEN ck IN ('home','home_care')                              THEN 'home'
    WHEN ck LIKE '24%' OR ck = 'straight_24h'                    THEN 'straight_24h'
    WHEN ck LIKE '48%' OR ck LIKE 'weekend%' OR ck = 'straight_48h' THEN 'straight_48h'
    ELSE public._effective_product('standard', per_day_min, inferred_days)
  END;

  IF product = 'home' THEN
    home_rate := COALESCE(public._pricing_flat(v_id, 'home_hour'), 12000);
    amount := ROUND(booked_hr * home_rate
              * CASE WHEN home_busy = 1 THEN busy_mult ELSE 1.0 END);
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object('product','home','hours',booked_hr,
        'rate',home_rate,
        'multiplier', CASE WHEN home_busy = 1 THEN busy_mult ELSE 1.0 END,
        'pricing_version_id', v_id));
  END IF;

  IF product = 'straight_24h' THEN
    flat_amount := COALESCE(public._pricing_flat(v_id, 'straight_24h'), 36000);
    amount := ROUND(flat_amount * busy_mult);
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object('product','straight_24h','flat',flat_amount,
        'multiplier',busy_mult,'pricing_version_id', v_id));
  END IF;

  IF product = 'straight_48h' THEN
    flat_amount := COALESCE(public._pricing_flat(v_id, 'straight_48h'), 72000);
    amount := ROUND(flat_amount * busy_mult);
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object('product','straight_48h','flat',flat_amount,
        'multiplier',busy_mult,'pricing_version_id', v_id));
  END IF;

  tier := public._tier_for_per_day_hours(booked_hr);
  SELECT pr.rate_day, pr.rate_night INTO rates_row FROM public._pricing_rate(v_id, tier) pr;
  rate_day := rates_row.rate_day; rate_night := rates_row.rate_night;
  amount := ROUND(((d_min::numeric / 60.0) * rate_day
                 + (n_min::numeric / 60.0) * rate_night) * busy_mult);

  RETURN jsonb_build_object('amount', amount,
    'breakdown', jsonb_build_object(
      'product','standard','tier',tier,
      'day_min',d_min,'night_min',n_min,
      'rate_day',rate_day,'rate_night',rate_night,
      'multiplier',busy_mult,'environment',_environment,
      'pricing_version_id', v_id));
END $$;


CREATE OR REPLACE FUNCTION public.end_shift(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.coverage_requests;
  v_id uuid := public._active_pricing_version_id();
  product text;
  total_days int;
  busy_mult numeric; home_busy numeric;
  tolerance_min int; block_min int; first_hour_min int;
  home_tol int; home_block int;
  st24_lo int; st24_hi int; st48_lo int; st48_hi int; st_ph int;
  v_total_ms bigint := 0;
  sum_worked_min int := 0;
  booked_per_day_min int := 0;
  d_win int := 0; n_win int := 0;
  booked_hr numeric;
  tier text;
  rates_row record;
  rate_day int := 0; rate_night int := 0;
  per_day record; day_amount numeric; day_bill int;
  flat_amount int; extra_hr int; hr_used int;
  home_rate int; bill int; remaining int;
  v_total numeric := 0;
  billable_total int := 0;
  snapshot jsonb;
  days_breakdown jsonb := '[]'::jsonb;
  due timestamptz := now() + interval '15 minutes';
  last_seg_id uuid;
  day_rec record;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can end this shift'; END IF;
  IF r.status NOT IN ('active','paused') THEN RAISE EXCEPTION 'Shift is not in progress'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'No active pricing version'; END IF;

  total_days := GREATEST(1, COALESCE(r.days, 1));
  booked_per_day_min := public._booked_per_day_min(r.start_time, r.end_time);
  SELECT day_min, night_min INTO d_win, n_win
    FROM public._window_day_night_min(r.start_time, r.end_time);

  product := public._effective_product(r.coverage_type, booked_per_day_min, total_days);

  busy_mult      := COALESCE(public._pricing_modifier(v_id, 'busy_mult'), 1.25);
  home_busy      := COALESCE(public._pricing_modifier(v_id, 'home_busy_applies'), 0);
  tolerance_min  := COALESCE(public._pricing_modifier(v_id, 'tolerance_min')::int, 15);
  block_min      := COALESCE(public._pricing_modifier(v_id, 'block_min')::int, 15);
  first_hour_min := COALESCE(public._pricing_modifier(v_id, 'first_hour_min')::int, 60);
  home_tol       := COALESCE(public._pricing_modifier(v_id, 'home_tolerance_min')::int, 30);
  home_block     := COALESCE(public._pricing_modifier(v_id, 'home_block_min')::int, 60);
  st24_lo        := COALESCE(public._pricing_modifier(v_id, 'straight24_lo_min')::int, 1320);
  st24_hi        := COALESCE(public._pricing_modifier(v_id, 'straight24_hi_min')::int, 1500);
  st48_lo        := COALESCE(public._pricing_modifier(v_id, 'straight48_lo_min')::int, 2760);
  st48_hi        := COALESCE(public._pricing_modifier(v_id, 'straight48_hi_min')::int, 2940);
  st_ph          := COALESCE(public._pricing_modifier(v_id, 'straight_per_hour')::int, 1500);

  IF NOT (r.environment = 'busy' AND (product <> 'home' OR home_busy = 1)) THEN
    busy_mult := 1.0;
  END IF;

  UPDATE public.shift_segments SET ended_at = now()
   WHERE request_id = _request_id AND ended_at IS NULL;

  UPDATE public.shift_segments
     SET billed_minutes = NULL, billed_amount = NULL
   WHERE request_id = _request_id;

  SELECT
    COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)), 0)::bigint,
    COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at))::int / 60)), 0)
  INTO v_total_ms, sum_worked_min
  FROM public.shift_segments
  WHERE request_id = _request_id AND ended_at IS NOT NULL;

  SELECT id INTO last_seg_id FROM public.shift_segments
   WHERE request_id = _request_id AND ended_at IS NOT NULL
   ORDER BY segment_index DESC LIMIT 1;

  IF product = 'straight_24h' THEN
    flat_amount := COALESCE(public._pricing_flat(v_id, 'straight_24h'), 36000);
    IF sum_worked_min >= st24_lo AND sum_worked_min <= st24_hi THEN
      v_total := ROUND(flat_amount * busy_mult);
    ELSIF sum_worked_min < st24_lo THEN
      hr_used := CEIL(sum_worked_min::numeric / 60.0)::int;
      v_total := ROUND(hr_used * st_ph * busy_mult);
    ELSE
      extra_hr := CEIL((sum_worked_min - st24_hi)::numeric / 60.0)::int;
      v_total := ROUND((flat_amount + extra_hr * st_ph) * busy_mult);
    END IF;
    billable_total := sum_worked_min;
    tier := 'straight_24h';

  ELSIF product = 'straight_48h' THEN
    flat_amount := COALESCE(public._pricing_flat(v_id, 'straight_48h'), 72000);
    IF sum_worked_min >= st48_lo AND sum_worked_min <= st48_hi THEN
      v_total := ROUND(flat_amount * busy_mult);
    ELSIF sum_worked_min < st48_lo THEN
      hr_used := CEIL(sum_worked_min::numeric / 60.0)::int;
      v_total := ROUND(hr_used * st_ph * busy_mult);
    ELSE
      extra_hr := CEIL((sum_worked_min - st48_hi)::numeric / 60.0)::int;
      v_total := ROUND((flat_amount + extra_hr * st_ph) * busy_mult);
    END IF;
    billable_total := sum_worked_min;
    tier := 'straight_48h';

  ELSIF product = 'home' THEN
    home_rate := COALESCE(public._pricing_flat(v_id, 'home_hour'), 12000);
    tier := 'home';
    rate_day := home_rate; rate_night := home_rate;

    FOR day_rec IN
      WITH per_day_w AS (
        SELECT COALESCE(day_index, 1) AS day_index,
               COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at))::int / 60)), 0)::int AS worked_min,
               MAX(segment_index) AS last_seg_index
          FROM public.shift_segments
         WHERE request_id = _request_id AND ended_at IS NOT NULL
         GROUP BY day_index
      ),
      booked_days AS (
        SELECT generate_series(1, total_days) AS day_index
      )
      SELECT bd.day_index,
             COALESCE(pdw.worked_min, 0) AS worked_min,
             pdw.last_seg_index
        FROM booked_days bd
        LEFT JOIN per_day_w pdw ON pdw.day_index = bd.day_index
       ORDER BY bd.day_index
    LOOP
      remaining := GREATEST(day_rec.worked_min, first_hour_min);
      IF booked_per_day_min > 0
         AND abs(remaining - booked_per_day_min) <= home_tol THEN
        bill := booked_per_day_min;
      ELSE
        bill := ((remaining + home_block - 1) / home_block) * home_block;
      END IF;
      day_amount := ROUND((bill::numeric / 60.0) * home_rate * busy_mult);
      day_bill := bill;

      v_total := v_total + day_amount;
      billable_total := billable_total + day_bill;
      days_breakdown := days_breakdown || jsonb_build_object(
        'day_index', day_rec.day_index,
        'worked_min', day_rec.worked_min,
        'billable_min', day_bill,
        'amount', day_amount,
        'tolerance_fired', booked_per_day_min > 0
          AND abs(GREATEST(day_rec.worked_min, first_hour_min) - booked_per_day_min) <= home_tol
      );

      IF day_rec.last_seg_index IS NOT NULL THEN
        UPDATE public.shift_segments
           SET billed_minutes = day_bill, billed_amount = day_amount
         WHERE request_id = _request_id
           AND segment_index = day_rec.last_seg_index;
      END IF;
    END LOOP;

  ELSE
    booked_hr := booked_per_day_min::numeric / 60.0;
    tier := public._tier_for_per_day_hours(booked_hr);
    SELECT pr.rate_day, pr.rate_night INTO rates_row FROM public._pricing_rate(v_id, tier) pr;
    rate_day := COALESCE(rates_row.rate_day, 2000);
    rate_night := COALESCE(rates_row.rate_night, 1500);

    FOR day_rec IN
      WITH per_day_w AS (
        SELECT COALESCE(day_index, 1) AS day_index,
               COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at))::int / 60)), 0)::int AS worked_min,
               MAX(segment_index) AS last_seg_index
          FROM public.shift_segments
         WHERE request_id = _request_id AND ended_at IS NOT NULL
         GROUP BY day_index
      ),
      booked_days AS (
        SELECT generate_series(1, total_days) AS day_index
      )
      SELECT bd.day_index,
             COALESCE(pdw.worked_min, 0) AS worked_min,
             pdw.last_seg_index
        FROM booked_days bd
        LEFT JOIN per_day_w pdw ON pdw.day_index = bd.day_index
       ORDER BY bd.day_index
    LOOP
      SELECT * INTO per_day FROM public._price_standard_day(
        booked_per_day_min, day_rec.worked_min, d_win, n_win,
        rate_day, rate_night, busy_mult,
        tolerance_min, block_min, first_hour_min);
      day_amount := per_day.amount;
      day_bill := per_day.billable_min;

      v_total := v_total + day_amount;
      billable_total := billable_total + day_bill;
      days_breakdown := days_breakdown || jsonb_build_object(
        'day_index', day_rec.day_index,
        'worked_min', day_rec.worked_min,
        'billable_min', day_bill,
        'amount', day_amount,
        'tolerance_fired', per_day.tolerance_fired);

      IF day_rec.last_seg_index IS NOT NULL THEN
        UPDATE public.shift_segments
           SET billed_minutes = day_bill, billed_amount = day_amount
         WHERE request_id = _request_id
           AND segment_index = day_rec.last_seg_index;
      END IF;
    END LOOP;
  END IF;

  IF product IN ('straight_24h','straight_48h') AND last_seg_id IS NOT NULL THEN
    UPDATE public.shift_segments
       SET billed_minutes = billable_total, billed_amount = v_total
     WHERE id = last_seg_id;
  END IF;

  snapshot := jsonb_build_object(
    'product', product, 'tier', tier,
    'rate_day', rate_day, 'rate_night', rate_night,
    'busy_mult', busy_mult,
    'billable_min', billable_total,
    'booked_per_day_min', booked_per_day_min,
    'day_window_min', d_win,
    'night_window_min', n_win,
    'sum_worked_min', sum_worked_min,
    'days', total_days,
    'days_breakdown', days_breakdown,
    'straight_per_hour', st_ph,
    'home_hour', COALESCE(public._pricing_flat(v_id, 'home_hour'), 12000),
    'block_min', block_min
  );

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status              = 'awaiting_payment',
         started_at          = NULL,
         accumulated_ms      = v_total_ms,
         billing_locked_at   = now(),
         total_billed_amount = v_total,
         payment_due_at      = due,
         settled_amount      = v_total,
         payment_status      = 'pending',
         payment_reference   = NULL,
         payment_url         = NULL,
         paid_at             = NULL,
         pricing_version_id  = v_id,
         rate_snapshot       = snapshot
   WHERE id = _request_id
   RETURNING * INTO r;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object(
    'total_billed_amount', r.total_billed_amount,
    'payment_due_at', due,
    'billable_minutes', billable_total,
    'tier', tier,
    'product', product,
    'pricing_version_id', v_id,
    'accumulated_ms', v_total_ms,
    'snapshot', snapshot
  );
END $$;


CREATE OR REPLACE FUNCTION public._surcharge_block_amount(
  _request public.coverage_requests
) RETURNS numeric
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  snap jsonb := COALESCE(_request.rate_snapshot, '{}'::jsonb);
  product text := COALESCE(snap->>'product', 'standard');
  busy_mult numeric := COALESCE((snap->>'busy_mult')::numeric, 1.0);
  block_min int := COALESCE((snap->>'block_min')::int, 15);
  day_window_min int;
  rate_day int := COALESCE((snap->>'rate_day')::int, 2000);
  rate_night int := COALESCE((snap->>'rate_night')::int, 1500);
  straight_ph int := COALESCE((snap->>'straight_per_hour')::int, 1500);
  hourly_rate int;
BEGIN
  IF snap ? 'day_window_min' THEN
    day_window_min := COALESCE((snap->>'day_window_min')::int, 0);
  ELSE
    SELECT d.day_min INTO day_window_min
      FROM public._window_day_night_min(_request.start_time, _request.end_time) d;
    day_window_min := COALESCE(day_window_min, 0);
  END IF;

  IF product = 'home' THEN
    RETURN 3000;
  ELSIF product IN ('straight_24h','straight_48h') THEN
    hourly_rate := straight_ph;
  ELSE
    hourly_rate := CASE WHEN day_window_min > 0 THEN rate_day ELSE rate_night END;
  END IF;

  RETURN ROUND((hourly_rate::numeric * block_min / 60.0) * busy_mult);
END $$;

GRANT EXECUTE ON FUNCTION public._surcharge_block_amount(public.coverage_requests)
  TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.extend_payment_window(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.coverage_requests;
  v_id uuid;
  block_charge numeric;
  cap_blocks int;
  next_index int;
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
  cap_blocks := COALESCE(public._pricing_modifier(v_id, 'surcharge_cap_blocks')::int, 96);
  block_charge := public._surcharge_block_amount(r);

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


CREATE OR REPLACE FUNCTION public.drain_surcharge_due()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec record;
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
           last_extended_at         = now()
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

    processed := processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', processed, 'capped', capped);
END $$;


-- BACKFILL — recompute surcharge for every locked in-flight row.
DO $$
DECLARE
  rec public.coverage_requests;
  corrected_block numeric;
  corrected_total numeric;
  delta numeric;
  base numeric;
BEGIN
  FOR rec IN
    SELECT * FROM public.coverage_requests
     WHERE billing_locked_at IS NOT NULL
       AND COALESCE(payment_extension_count, 0) > 0
  LOOP
    corrected_block := public._surcharge_block_amount(rec);
    corrected_total := corrected_block * rec.payment_extension_count;
    delta := corrected_total - COALESCE(rec.surcharge_amount, 0);

    IF delta = 0 THEN
      CONTINUE;
    END IF;

    base := COALESCE(rec.base_amount,
                     COALESCE(rec.total_billed_amount, 0) - COALESCE(rec.surcharge_amount, 0));

    UPDATE public.coverage_requests
       SET base_amount         = base,
           surcharge_amount    = corrected_total,
           total_billed_amount = base + corrected_total,
           settled_amount      = base + corrected_total
     WHERE id = rec.id;

    INSERT INTO public.payment_surcharge_log
      (request_id, block_index, block_amount, running_total, source)
    VALUES
      (rec.id, rec.payment_extension_count + 10000, delta,
       base + corrected_total, 'backfill_v2')
    ON CONFLICT (request_id, block_index) DO NOTHING;
  END LOOP;
END $$;


-- TEST FIXTURES — abort migration on drift.
DO $$
DECLARE
  q jsonb;
  amt numeric;
  per record;
BEGIN
  -- 8h booking @ >6h tier (rate_day=2000):
  -- worked 8h14 → tolerance fires → 480 min → ₦16,000
  SELECT * INTO per FROM public._price_standard_day(
    480, 494, 480, 0, 2000, 1500, 1.0, 15, 15, 60);
  IF per.amount <> 16000 THEN
    RAISE EXCEPTION 'Fixture A failed: expected 16000, got %', per.amount;
  END IF;

  -- worked 8h16 → ceiling 510 min → ₦17,000
  SELECT * INTO per FROM public._price_standard_day(
    480, 496, 480, 0, 2000, 1500, 1.0, 15, 15, 60);
  IF per.amount <> 17000 THEN
    RAISE EXCEPTION 'Fixture B failed: expected 17000, got %', per.amount;
  END IF;

  -- worked 8h31 → ceiling 525 min → ₦17,500
  SELECT * INTO per FROM public._price_standard_day(
    480, 511, 480, 0, 2000, 1500, 1.0, 15, 15, 60);
  IF per.amount <> 17500 THEN
    RAISE EXCEPTION 'Fixture C failed: expected 17500, got %', per.amount;
  END IF;

  -- 6h booking @ 4-6h tier (rate_day=2500): worked 6h16 → ceiling 390 → ₦16,250
  SELECT * INTO per FROM public._price_standard_day(
    360, 376, 360, 0, 2500, 2000, 1.0, 15, 15, 60);
  IF per.amount <> 16250 THEN
    RAISE EXCEPTION 'Fixture D failed: expected 16250, got %', per.amount;
  END IF;

  -- Booking A per-day quote: 09–17 Standard, day-only → ₦16,000 (stays standard)
  q := public.compute_quote(
    '2026-06-23 09:00:00+00'::timestamptz,
    '2026-06-23 17:00:00+00'::timestamptz,
    'normal', 'standard');
  amt := (q->>'amount')::numeric;
  IF amt <> 16000 THEN
    RAISE EXCEPTION 'Fixture Booking A failed: expected 16000, got %', amt;
  END IF;

  -- 24h-Standard upgrade: 08:00 → 08:00 next day → straight_24h ₦36,000
  q := public.compute_quote(
    '2026-06-23 08:00:00+00'::timestamptz,
    '2026-06-24 08:00:00+00'::timestamptz,
    'normal', 'standard');
  amt := (q->>'amount')::numeric;
  IF amt <> 36000 THEN
    RAISE EXCEPTION 'Fixture 24h upgrade failed: expected 36000, got %', amt;
  END IF;
  IF (q->'breakdown'->>'product') <> 'straight_24h' THEN
    RAISE EXCEPTION 'Fixture 24h classifier failed: product=%',
      q->'breakdown'->>'product';
  END IF;

  -- Booking B per-day decomposition: 9h booking @ rate_day 2000
  SELECT * INTO per FROM public._price_standard_day(540, 552, 540, 0, 2000, 1500, 1.0, 15, 15, 60);
  IF per.amount <> 18000 THEN RAISE EXCEPTION 'Fixture B-day1 failed: %', per.amount; END IF;

  SELECT * INTO per FROM public._price_standard_day(540, 0, 540, 0, 2000, 1500, 1.0, 15, 15, 60);
  IF per.amount <> 2000 THEN RAISE EXCEPTION 'Fixture B-day2 failed: %', per.amount; END IF;

  SELECT * INTO per FROM public._price_standard_day(540, 513, 540, 0, 2000, 1500, 1.0, 15, 15, 60);
  IF per.amount <> 17500 THEN RAISE EXCEPTION 'Fixture B-day3 failed: %', per.amount; END IF;

  SELECT * INTO per FROM public._price_standard_day(540, 44, 540, 0, 2000, 1500, 1.0, 15, 15, 60);
  IF per.amount <> 2000 THEN RAISE EXCEPTION 'Fixture B-day4 failed: %', per.amount; END IF;

  SELECT * INTO per FROM public._price_standard_day(540, 245, 540, 0, 2000, 1500, 1.0, 15, 15, 60);
  IF per.amount <> 8500 THEN RAISE EXCEPTION 'Fixture B-day5 failed: %', per.amount; END IF;

  -- Classifier sanity
  IF public._effective_product('Standard', 480, 3) <> 'standard' THEN
    RAISE EXCEPTION 'Classifier: 3x8h must stay standard';
  END IF;
  IF public._effective_product('Standard', 1440, 1) <> 'straight_24h' THEN
    RAISE EXCEPTION 'Classifier: 1440x1 must upgrade';
  END IF;
  IF public._effective_product('Standard', 1440, 2) <> 'straight_48h' THEN
    RAISE EXCEPTION 'Classifier: 1440x2 must upgrade';
  END IF;
  IF public._effective_product('Standard', 1440, 3) <> 'standard' THEN
    RAISE EXCEPTION 'Classifier: 1440x3 must NOT upgrade';
  END IF;
END $$;