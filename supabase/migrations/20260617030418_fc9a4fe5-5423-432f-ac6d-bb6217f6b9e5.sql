
-- ============================================================
-- Phase 3: Pricing configuration tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pricing_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  is_active boolean NOT NULL DEFAULT false
);

-- Only one active version at a time.
CREATE UNIQUE INDEX IF NOT EXISTS pricing_versions_only_one_active
  ON public.pricing_versions ((is_active)) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.pricing_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.pricing_versions(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('<4h','4-6h','>6h','home_flat')),
  rate_day int NOT NULL,
  rate_night int NOT NULL,
  UNIQUE (version_id, tier)
);

CREATE TABLE IF NOT EXISTS public.pricing_flats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.pricing_versions(id) ON DELETE CASCADE,
  product text NOT NULL CHECK (product IN ('straight_24h','straight_48h','home_hour')),
  amount int NOT NULL,
  UNIQUE (version_id, product)
);

CREATE TABLE IF NOT EXISTS public.pricing_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.pricing_versions(id) ON DELETE CASCADE,
  key text NOT NULL,
  value numeric NOT NULL,
  UNIQUE (version_id, key)
);

GRANT SELECT ON public.pricing_versions TO anon, authenticated;
GRANT ALL ON public.pricing_versions TO service_role;
GRANT SELECT ON public.pricing_rates TO anon, authenticated;
GRANT ALL ON public.pricing_rates TO service_role;
GRANT SELECT ON public.pricing_flats TO anon, authenticated;
GRANT ALL ON public.pricing_flats TO service_role;
GRANT SELECT ON public.pricing_modifiers TO anon, authenticated;
GRANT ALL ON public.pricing_modifiers TO service_role;

ALTER TABLE public.pricing_versions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_flats      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_modifiers  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pricing versions readable by all"
  ON public.pricing_versions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Pricing rates readable by all"
  ON public.pricing_rates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Pricing flats readable by all"
  ON public.pricing_flats FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Pricing modifiers readable by all"
  ON public.pricing_modifiers FOR SELECT TO anon, authenticated USING (true);

-- No INSERT/UPDATE/DELETE policies — writes only via SECURITY DEFINER fn below.

-- ============================================================
-- Seed v1 with current production rates
-- ============================================================
DO $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pricing_versions) THEN
    INSERT INTO public.pricing_versions(label, is_active, notes)
    VALUES ('v1 — initial', true, 'Seeded from hardcoded rates')
    RETURNING id INTO v_id;

    INSERT INTO public.pricing_rates(version_id, tier, rate_day, rate_night) VALUES
      (v_id, '<4h',       3000, 2500),
      (v_id, '4-6h',      2500, 2000),
      (v_id, '>6h',       2000, 1500),
      (v_id, 'home_flat', 15000, 15000);

    INSERT INTO public.pricing_flats(version_id, product, amount) VALUES
      (v_id, 'straight_24h', 36000),
      (v_id, 'straight_48h', 72000),
      (v_id, 'home_hour',    15000);

    INSERT INTO public.pricing_modifiers(version_id, key, value) VALUES
      (v_id, 'busy_mult',         1.25),
      (v_id, 'tolerance_min',     15),
      (v_id, 'block_min',         15),
      (v_id, 'first_hour_min',    60),
      (v_id, 'home_busy_applies', 0);  -- 0 = false; busy multiplier skipped for home
  END IF;
END $$;

-- FK from coverage_requests.pricing_version_id (Phase 2 column)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'coverage_requests_pricing_version_id_fkey'
       AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.coverage_requests
      ADD CONSTRAINT coverage_requests_pricing_version_id_fkey
      FOREIGN KEY (pricing_version_id)
      REFERENCES public.pricing_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- Helpers: resolve active version, fetch rates/flats/modifiers
-- ============================================================

CREATE OR REPLACE FUNCTION public._active_pricing_version_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT id FROM public.pricing_versions WHERE is_active = true LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public._pricing_rate(_version uuid, _tier text)
RETURNS TABLE(rate_day int, rate_night int)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT rate_day, rate_night
    FROM public.pricing_rates
   WHERE version_id = _version AND tier = _tier
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public._pricing_flat(_version uuid, _product text)
RETURNS int
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT amount FROM public.pricing_flats
   WHERE version_id = _version AND product = _product
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public._pricing_modifier(_version uuid, _key text)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT value FROM public.pricing_modifiers
   WHERE version_id = _version AND key = _key
   LIMIT 1
$$;

-- ============================================================
-- Admin: publish a new version atomically
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_publish_pricing_version(
  _label text,
  _rates jsonb,
  _flats jsonb,
  _modifiers jsonb,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  r jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Deactivate current active version first (unique partial idx requires this).
  UPDATE public.pricing_versions SET is_active = false WHERE is_active = true;

  INSERT INTO public.pricing_versions(label, is_active, notes, created_by)
  VALUES (_label, true, _notes, auth.uid())
  RETURNING id INTO v_id;

  FOR r IN SELECT * FROM jsonb_array_elements(_rates) LOOP
    INSERT INTO public.pricing_rates(version_id, tier, rate_day, rate_night)
    VALUES (v_id, r->>'tier', (r->>'rate_day')::int, (r->>'rate_night')::int);
  END LOOP;

  FOR r IN SELECT * FROM jsonb_array_elements(_flats) LOOP
    INSERT INTO public.pricing_flats(version_id, product, amount)
    VALUES (v_id, r->>'product', (r->>'amount')::int);
  END LOOP;

  FOR r IN SELECT * FROM jsonb_array_elements(_modifiers) LOOP
    INSERT INTO public.pricing_modifiers(version_id, key, value)
    VALUES (v_id, r->>'key', (r->>'value')::numeric);
  END LOOP;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_publish_pricing_version(text, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_publish_pricing_version(text, jsonb, jsonb, jsonb, text) TO authenticated;

-- ============================================================
-- Rewrite compute_quote to read from active pricing version
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_quote(
  _start timestamptz,
  _end timestamptz,
  _environment text DEFAULT 'normal',
  _coverage_kind text DEFAULT 'standard'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  total_min int;
  d_min int;
  n_min int;
  booked_hr numeric;
  rate_day int;
  rate_night int;
  busy_mult numeric;
  home_busy numeric;
  base numeric := 0;
  amount numeric;
  tier text;
  ck text := lower(coalesce(_coverage_kind,'standard'));
  v_id uuid := public._active_pricing_version_id();
  rates_row record;
  flat_amount int;
BEGIN
  IF _end <= _start THEN
    RETURN jsonb_build_object('amount', 0, 'breakdown',
      jsonb_build_object('error','end_before_start'));
  END IF;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No active pricing version';
  END IF;

  SELECT day_min, night_min INTO d_min, n_min
    FROM public._split_day_night_minutes(_start, _end);
  total_min := d_min + n_min;
  booked_hr := total_min::numeric / 60.0;

  busy_mult := CASE WHEN _environment = 'busy'
                    THEN COALESCE(public._pricing_modifier(v_id, 'busy_mult'), 1.0)
                    ELSE 1.0 END;
  home_busy := COALESCE(public._pricing_modifier(v_id, 'home_busy_applies'), 0);

  -- STEP 2: coverage product early-exit.
  IF ck IN ('home','home_care') THEN
    SELECT rate_day INTO rate_day FROM public._pricing_rate(v_id, 'home_flat');
    amount := ROUND(booked_hr * COALESCE(rate_day, 15000)
                    * CASE WHEN home_busy = 1 THEN busy_mult ELSE 1.0 END);
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object(
        'tier','home_flat','hours',booked_hr,'rate',COALESCE(rate_day,15000),
        'multiplier', CASE WHEN home_busy = 1 THEN busy_mult ELSE 1.0 END,
        'pricing_version_id', v_id));
  END IF;

  IF total_min = 1440 THEN
    flat_amount := public._pricing_flat(v_id, 'straight_24h');
    amount := ROUND(COALESCE(flat_amount, 36000) * busy_mult);
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object('tier','straight_24h','multiplier',busy_mult,
        'pricing_version_id', v_id));
  END IF;
  IF total_min = 2880 THEN
    flat_amount := public._pricing_flat(v_id, 'straight_48h');
    amount := ROUND(COALESCE(flat_amount, 72000) * busy_mult);
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object('tier','straight_48h','multiplier',busy_mult,
        'pricing_version_id', v_id));
  END IF;

  -- STEP 3: TIER from booked hours ONLY.
  IF booked_hr > 6 THEN
    tier := '>6h';
  ELSIF booked_hr >= 4 THEN
    tier := '4-6h';
  ELSE
    tier := '<4h';
  END IF;

  SELECT pr.rate_day, pr.rate_night INTO rates_row
    FROM public._pricing_rate(v_id, tier) pr;
  rate_day := rates_row.rate_day;
  rate_night := rates_row.rate_night;

  base := (d_min::numeric / 60.0) * rate_day
        + (n_min::numeric / 60.0) * rate_night;
  amount := ROUND(base * busy_mult);

  RETURN jsonb_build_object(
    'amount', amount,
    'breakdown', jsonb_build_object(
      'tier',tier,'day_min',d_min,'night_min',n_min,
      'rate_day',rate_day,'rate_night',rate_night,
      'multiplier',busy_mult,'environment',_environment,
      'pricing_version_id', v_id
    )
  );
END $$;

-- ============================================================
-- Rewrite end_shift to read from active pricing + write snapshot
-- ============================================================

CREATE OR REPLACE FUNCTION public.end_shift(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.coverage_requests;
  seg public.shift_segments;
  ct text;
  product text;
  sum_worked int := 0;
  sum_d int := 0;
  sum_n int := 0;
  seg_d int;
  seg_n int;
  seg_worked int;
  working_min int;
  billable_total int := 0;
  d_billable int := 0;
  n_billable int := 0;
  booked_min int := 0;
  booked_per_day_min int := 0;
  booked_d int := 0;
  booked_n int := 0;
  total_days int;
  booked_hr numeric;
  tier text;
  rate_day int := 0;
  rate_night int := 0;
  busy_mult numeric := 1.0;
  home_busy numeric;
  tolerance_min int;
  first_hour_min int;
  block_min int;
  v_total numeric := 0;
  base numeric;
  due timestamptz := now() + interval '15 minutes';
  last_seg_id uuid;
  tolerance_fired boolean := false;
  win_start timestamptz;
  win_end timestamptz;
  v_id uuid := public._active_pricing_version_id();
  rates_row record;
  flat_amount int;
  home_rate int;
  snapshot jsonb;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can end this shift'; END IF;
  IF r.status NOT IN ('active','paused') THEN RAISE EXCEPTION 'Shift is not in progress'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'No active pricing version'; END IF;

  ct := lower(coalesce(r.coverage_type,''));
  total_days := GREATEST(1, COALESCE(r.days, 1));

  IF ct LIKE 'home%' THEN
    product := 'home';
  ELSIF ct LIKE '24%' AND total_days = 1 THEN
    product := 'straight_24h';
  ELSIF ct LIKE 'weekend%' AND total_days = 1 THEN
    product := 'straight_48h';
  ELSE
    product := 'standard';
  END IF;

  home_busy := COALESCE(public._pricing_modifier(v_id, 'home_busy_applies'), 0);
  busy_mult := CASE WHEN r.environment = 'busy'
                      AND (product <> 'home' OR home_busy = 1)
                    THEN COALESCE(public._pricing_modifier(v_id, 'busy_mult'), 1.0)
                    ELSE 1.0 END;
  tolerance_min  := COALESCE(public._pricing_modifier(v_id, 'tolerance_min')::int, 15);
  first_hour_min := COALESCE(public._pricing_modifier(v_id, 'first_hour_min')::int, 60);
  block_min      := COALESCE(public._pricing_modifier(v_id, 'block_min')::int, 15);

  FOR seg IN
    SELECT * FROM public.shift_segments
     WHERE request_id = _request_id AND ended_at IS NULL
     FOR UPDATE
  LOOP
    UPDATE public.shift_segments SET ended_at = now() WHERE id = seg.id;
  END LOOP;

  UPDATE public.shift_segments
     SET billed_minutes = NULL, billed_amount = NULL
   WHERE request_id = _request_id;

  FOR seg IN
    SELECT * FROM public.shift_segments
     WHERE request_id = _request_id AND ended_at IS NOT NULL
     ORDER BY segment_index
  LOOP
    seg_worked := GREATEST(0, EXTRACT(EPOCH FROM (seg.ended_at - seg.started_at))::int / 60);
    sum_worked := sum_worked + seg_worked;
    IF seg_worked > 0 THEN
      SELECT day_min, night_min INTO seg_d, seg_n
        FROM public._split_day_night_minutes(seg.started_at, seg.ended_at);
      sum_d := sum_d + seg_d;
      sum_n := sum_n + seg_n;
    END IF;
    last_seg_id := seg.id;
  END LOOP;

  IF r.start_ts IS NOT NULL AND r.end_ts IS NOT NULL AND r.end_ts > r.start_ts THEN
    booked_min := ((r.end_ts - r.start_ts) / 1000 / 60)::int;
    booked_per_day_min := GREATEST(0, booked_min / total_days);
    win_start := to_timestamp(r.start_ts::double precision / 1000.0);
    win_end := win_start + make_interval(mins => booked_per_day_min);
    SELECT day_min, night_min INTO booked_d, booked_n
      FROM public._split_day_night_minutes(win_start, win_end);
  END IF;

  IF product = 'straight_24h' THEN
    flat_amount := public._pricing_flat(v_id, 'straight_24h');
    v_total := ROUND(COALESCE(flat_amount, 36000) * busy_mult);
    billable_total := 1440;
    tier := 'straight_24h';
  ELSIF product = 'straight_48h' THEN
    flat_amount := public._pricing_flat(v_id, 'straight_48h');
    v_total := ROUND(COALESCE(flat_amount, 72000) * busy_mult);
    billable_total := 2880;
    tier := 'straight_48h';
  ELSE
    IF product = 'home' THEN
      tier := 'home_flat';
      SELECT pr.rate_day INTO home_rate FROM public._pricing_rate(v_id, 'home_flat') pr;
    ELSE
      booked_hr := CASE
        WHEN booked_per_day_min > 0 THEN booked_per_day_min::numeric / 60.0
        ELSE sum_worked::numeric / 60.0
      END;
      IF booked_hr > 6 THEN tier := '>6h';
      ELSIF booked_hr >= 4 THEN tier := '4-6h';
      ELSE tier := '<4h';
      END IF;
      SELECT pr.rate_day, pr.rate_night INTO rates_row
        FROM public._pricing_rate(v_id, tier) pr;
      rate_day := rates_row.rate_day;
      rate_night := rates_row.rate_night;
    END IF;

    -- STEP 5a: First-Hour Rule
    IF sum_worked > 0 AND sum_worked < first_hour_min THEN
      working_min := first_hour_min;
    ELSE
      working_min := sum_worked;
    END IF;

    -- STEP 5b: tolerance (before rounding)
    IF booked_per_day_min > 0 AND working_min > 0
       AND abs(working_min - booked_per_day_min) <= tolerance_min THEN
      billable_total := booked_per_day_min;
      tolerance_fired := true;
    ELSE
      billable_total := CASE WHEN working_min > 0
        THEN CEIL(working_min::numeric / block_min)::int * block_min
        ELSE 0
      END;
    END IF;

    -- STEP 6: day/night split of billable
    IF product = 'home' THEN
      d_billable := billable_total;
      n_billable := 0;
    ELSIF tolerance_fired THEN
      d_billable := booked_d;
      n_billable := booked_n;
    ELSIF (sum_d + sum_n) > 0 THEN
      d_billable := ROUND(sum_d::numeric * billable_total / (sum_d + sum_n))::int;
      n_billable := billable_total - d_billable;
    ELSE
      d_billable := billable_total;
      n_billable := 0;
    END IF;

    -- STEP 7: amount from frozen rate
    IF billable_total > 0 THEN
      IF product = 'home' THEN
        v_total := ROUND((billable_total::numeric / 60.0) * COALESCE(home_rate, 15000) * busy_mult);
      ELSE
        base := (d_billable::numeric / 60.0) * rate_day
              + (n_billable::numeric / 60.0) * rate_night;
        v_total := ROUND(base * busy_mult);
      END IF;
    END IF;
  END IF;

  IF last_seg_id IS NOT NULL THEN
    UPDATE public.shift_segments
       SET billed_minutes = billable_total,
           billed_amount  = v_total
     WHERE id = last_seg_id;
  END IF;

  -- Build snapshot for immutable audit trail.
  snapshot := jsonb_build_object(
    'tier', tier,
    'product', product,
    'rate_day', rate_day,
    'rate_night', rate_night,
    'home_rate', home_rate,
    'busy_mult', busy_mult,
    'billable_min', billable_total,
    'booked_per_day_min', booked_per_day_min,
    'd_billable', d_billable,
    'n_billable', n_billable,
    'tolerance_fired', tolerance_fired,
    'sum_worked_min', sum_worked
  );

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status = 'completed',
         billing_locked_at = now(),
         total_billed_amount = v_total,
         payment_due_at = due,
         settled_amount = v_total,
         payment_status = 'pending',
         payment_reference = NULL,
         payment_url = NULL,
         paid_at = NULL,
         pricing_version_id = v_id,
         rate_snapshot = snapshot
   WHERE id = _request_id
   RETURNING * INTO r;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object(
    'total_billed_amount', r.total_billed_amount,
    'payment_due_at', due,
    'billable_minutes', billable_total,
    'tier', tier,
    'product', product,
    'pricing_version_id', v_id
  );
END $function$;

-- Allow lifecycle trigger to also let pricing_version_id / rate_snapshot pass.
-- (prevent_requester_sensitive_change uses the lifecycle_bypass flag which
--  end_shift sets, so no changes needed there.)

-- ============================================================
-- Phase 5: extend_payment_window uses snapshotted/active rate
-- ============================================================

CREATE OR REPLACE FUNCTION public.extend_payment_window(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.coverage_requests;
  v_id uuid;
  tier text;
  rate_per_hour int;
  busy_mult numeric;
  block_min int;
  block_charge numeric;
  rates_row record;
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

  -- Prefer the snapshotted version on this request; fall back to active.
  v_id := COALESCE(r.pricing_version_id, public._active_pricing_version_id());
  tier := COALESCE(r.rate_snapshot->>'tier', '>6h');
  IF tier NOT IN ('<4h','4-6h','>6h') THEN tier := '>6h'; END IF;

  SELECT pr.rate_day INTO rates_row FROM public._pricing_rate(v_id, tier) pr;
  rate_per_hour := COALESCE(rates_row.rate_day, 2000);

  busy_mult := CASE WHEN r.environment = 'busy'
                    THEN COALESCE(public._pricing_modifier(v_id, 'busy_mult'), 1.0)
                    ELSE 1.0 END;
  block_min := COALESCE(public._pricing_modifier(v_id, 'block_min')::int, 15);

  block_charge := ROUND((rate_per_hour::numeric * block_min / 60.0) * busy_mult);

  UPDATE public.coverage_requests
     SET total_billed_amount = COALESCE(total_billed_amount,0) + block_charge,
         settled_amount = COALESCE(total_billed_amount,0) + block_charge,
         payment_due_at = now() + interval '15 minutes',
         payment_extension_count = payment_extension_count + 1,
         last_extended_at = now()
   WHERE id = _request_id
   RETURNING * INTO r;

  IF r.payment_extension_count >= 2 THEN
    UPDATE public.profiles
       SET payment_restricted_at = COALESCE(payment_restricted_at, now())
     WHERE id = r.requester_id;
  END IF;

  RETURN jsonb_build_object(
    'total_billed_amount', r.total_billed_amount,
    'payment_due_at', r.payment_due_at,
    'extension_count', r.payment_extension_count,
    'added_block', block_charge
  );
END $$;
