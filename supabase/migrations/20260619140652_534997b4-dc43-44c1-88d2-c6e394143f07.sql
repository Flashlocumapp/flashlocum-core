
-- =====================================================================
-- PRICING ENGINE V2 — Calculation rewrite per FlashLocum Pricing Spec
-- =====================================================================

DO $$
DECLARE
  v2 uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.pricing_versions WHERE label = 'v2') THEN
    RETURN;
  END IF;

  UPDATE public.pricing_versions SET is_active = false WHERE is_active = true;

  INSERT INTO public.pricing_versions (label, is_active, notes, effective_at)
  VALUES ('v2', true, 'FlashLocum Pricing Engine — Final spec compliance', now())
  RETURNING id INTO v2;

  INSERT INTO public.pricing_rates (version_id, tier, rate_day, rate_night) VALUES
    (v2, '<4h',  3000, 2500),
    (v2, '4-6h', 2500, 2000),
    (v2, '>6h',  2000, 1500),
    (v2, 'home_flat', 12000, 12000);

  INSERT INTO public.pricing_flats (version_id, product, amount) VALUES
    (v2, 'straight_24h', 36000),
    (v2, 'straight_48h', 72000),
    (v2, 'home_hour',    12000);

  INSERT INTO public.pricing_modifiers (version_id, key, value) VALUES
    (v2, 'busy_mult',          1.25),
    (v2, 'tolerance_min',      15),
    (v2, 'block_min',          15),
    (v2, 'first_hour_min',     60),
    (v2, 'home_busy_applies',  0),
    (v2, 'home_tolerance_min', 30),
    (v2, 'home_block_min',     60),
    (v2, 'straight24_lo_min',  1320),
    (v2, 'straight24_hi_min',  1500),
    (v2, 'straight48_lo_min',  2760),
    (v2, 'straight48_hi_min',  2940),
    (v2, 'straight_per_hour',  1500),
    (v2, 'surcharge_cap_blocks', 96);
END $$;

CREATE OR REPLACE FUNCTION public._hhmm_to_min(_s text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _s IS NULL OR _s = '' THEN 0
    ELSE (split_part(_s, ':', 1))::int * 60 + (split_part(_s, ':', 2))::int
  END
$$;

CREATE OR REPLACE FUNCTION public._booked_per_day_min(_start_hhmm text, _end_hhmm text)
RETURNS int LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE s int; e int;
BEGIN
  s := public._hhmm_to_min(_start_hhmm);
  e := public._hhmm_to_min(_end_hhmm);
  IF e <= s THEN e := e + 1440; END IF;
  RETURN GREATEST(0, e - s);
END $$;

CREATE OR REPLACE FUNCTION public._window_day_night_min(_start_hhmm text, _end_hhmm text)
RETURNS TABLE(day_min int, night_min int) LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  s int := public._hhmm_to_min(_start_hhmm);
  e int := public._hhmm_to_min(_end_hhmm);
  t int; h int; d int := 0; n int := 0;
BEGIN
  IF e <= s THEN e := e + 1440; END IF;
  FOR t IN s..e-1 LOOP
    h := ((t % 1440) / 60);
    IF h >= 6 AND h < 22 THEN d := d + 1; ELSE n := n + 1; END IF;
  END LOOP;
  day_min := d; night_min := n; RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public._tier_for_per_day_hours(_booked_hr numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _booked_hr > 6  THEN '>6h'
    WHEN _booked_hr >= 4 THEN '4-6h'
    ELSE                      '<4h'
  END
$$;

CREATE OR REPLACE FUNCTION public._classify_product(_coverage_type text, _days int)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN lower(coalesce(_coverage_type,'')) LIKE 'home%'    THEN 'home'
    WHEN lower(coalesce(_coverage_type,'')) LIKE '24%'      THEN 'straight_24h'
    WHEN lower(coalesce(_coverage_type,'')) LIKE '48%'      THEN 'straight_48h'
    WHEN lower(coalesce(_coverage_type,'')) LIKE 'weekend%' THEN 'straight_48h'
    ELSE 'standard'
  END
$$;

CREATE OR REPLACE FUNCTION public._price_standard_day(
  _booked_per_day_min int, _worked_min int,
  _day_window_min int, _night_window_min int,
  _rate_day int, _rate_night int, _busy_mult numeric,
  _tolerance_min int, _block_min int, _first_hour_min int
) RETURNS TABLE(billable_min int, amount numeric, tolerance_fired boolean)
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  working int; bill int; fired boolean := false;
  win_total int; d_bill int := 0; n_bill int := 0; amt numeric;
BEGIN
  working := GREATEST(0, COALESCE(_worked_min, 0));
  IF working < _first_hour_min THEN working := _first_hour_min; END IF;

  IF _booked_per_day_min > 0
     AND abs(working - _booked_per_day_min) <= _tolerance_min THEN
    bill := _booked_per_day_min; fired := true;
  ELSE
    bill := ((working + _block_min - 1) / _block_min) * _block_min;
  END IF;

  win_total := COALESCE(_day_window_min, 0) + COALESCE(_night_window_min, 0);
  IF win_total > 0 THEN
    d_bill := ROUND(bill::numeric * _day_window_min / win_total)::int;
    n_bill := bill - d_bill;
  ELSE
    d_bill := bill; n_bill := 0;
  END IF;

  amt := ROUND(((d_bill::numeric / 60.0) * _rate_day
              + (n_bill::numeric / 60.0) * _rate_night) * _busy_mult);

  billable_min := bill; amount := amt; tolerance_fired := fired;
  RETURN NEXT;
END $$;

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

  home_busy := COALESCE(public._pricing_modifier(v_id, 'home_busy_applies'), 0);
  busy_mult := CASE WHEN _environment = 'busy'
                    THEN COALESCE(public._pricing_modifier(v_id, 'busy_mult'), 1.25)
                    ELSE 1.0 END;

  product := CASE
    WHEN ck IN ('home','home_care')           THEN 'home'
    WHEN ck LIKE '24%' OR ck = 'straight_24h' THEN 'straight_24h'
    WHEN ck LIKE '48%' OR ck LIKE 'weekend%' OR ck = 'straight_48h' THEN 'straight_48h'
    ELSE 'standard'
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

  i int; day_worked int; remaining int;
  per_day record; day_amount numeric; day_bill int;

  flat_amount int; extra_hr int; hr_used int;
  total_booked int; home_rate int; bill int;

  v_total numeric := 0;
  billable_total int := 0;
  snapshot jsonb;
  days_breakdown jsonb := '[]'::jsonb;
  due timestamptz := now() + interval '15 minutes';
  last_seg_id uuid;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can end this shift'; END IF;
  IF r.status NOT IN ('active','paused') THEN RAISE EXCEPTION 'Shift is not in progress'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'No active pricing version'; END IF;

  total_days := GREATEST(1, COALESCE(r.days, 1));
  product := public._classify_product(r.coverage_type, total_days);

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

  booked_per_day_min := public._booked_per_day_min(r.start_time, r.end_time);
  SELECT day_min, night_min INTO d_win, n_win
    FROM public._window_day_night_min(r.start_time, r.end_time);

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
    total_booked := booked_per_day_min * total_days;
    home_rate := COALESCE(public._pricing_flat(v_id, 'home_hour'), 12000);
    remaining := GREATEST(sum_worked_min, first_hour_min);
    IF total_booked > 0 AND abs(remaining - total_booked) <= home_tol THEN
      bill := total_booked;
    ELSE
      bill := ((remaining + home_block - 1) / home_block) * home_block;
    END IF;
    v_total := ROUND((bill::numeric / 60.0) * home_rate * busy_mult);
    billable_total := bill;
    tier := 'home';
    rate_day := home_rate; rate_night := home_rate;

  ELSE
    booked_hr := booked_per_day_min::numeric / 60.0;
    tier := public._tier_for_per_day_hours(booked_hr);
    SELECT pr.rate_day, pr.rate_night INTO rates_row FROM public._pricing_rate(v_id, tier) pr;
    rate_day := COALESCE(rates_row.rate_day, 2000);
    rate_night := COALESCE(rates_row.rate_night, 1500);

    remaining := sum_worked_min;
    FOR i IN 1..total_days LOOP
      IF i < total_days THEN
        -- Earlier days are assumed to have been worked at their booked length
        -- (with grace if within tolerance). Pull at most booked + tolerance,
        -- the rest cascades to the final day where any overrun is billed.
        day_worked := LEAST(remaining, booked_per_day_min + tolerance_min);
      ELSE
        day_worked := remaining;
      END IF;
      remaining := remaining - day_worked;

      SELECT * INTO per_day FROM public._price_standard_day(
        booked_per_day_min, day_worked, d_win, n_win,
        rate_day, rate_night, busy_mult,
        tolerance_min, block_min, first_hour_min);
      day_amount := per_day.amount;
      day_bill := per_day.billable_min;

      v_total := v_total + day_amount;
      billable_total := billable_total + day_bill;
      days_breakdown := days_breakdown || jsonb_build_object(
        'day_index', i,
        'worked_min', day_worked,
        'billable_min', day_bill,
        'amount', day_amount,
        'tolerance_fired', per_day.tolerance_fired);
    END LOOP;
  END IF;

  IF last_seg_id IS NOT NULL THEN
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
    'sum_worked_min', sum_worked_min,
    'days', total_days,
    'days_breakdown', days_breakdown
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

GRANT EXECUTE ON FUNCTION public._hhmm_to_min(text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public._booked_per_day_min(text, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public._window_day_night_min(text, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public._tier_for_per_day_hours(numeric) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public._classify_product(text, int) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public._price_standard_day(int,int,int,int,int,int,numeric,int,int,int) TO authenticated, anon, service_role;
