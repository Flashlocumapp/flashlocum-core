
-- P0 pricing correctness fixes:
-- 1. compute_quote: <4h flat ₦3,000/hr day+night; 4-6h flat ₦2,500/hr day+night.
-- 2. compute_quote: Home Care never gets the busy multiplier.
-- 3. end_shift: bill the WHOLE assignment with ONE tier bucket from total
--    worked time across all segments (not per-segment). Also apply the
--    60-min floor and 15-min ceiling once at assignment level.

CREATE OR REPLACE FUNCTION public.compute_quote(
  _start timestamptz,
  _end timestamptz,
  _environment text DEFAULT 'normal',
  _coverage_kind text DEFAULT 'standard'
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  total_min int;
  d_min int;
  n_min int;
  hours numeric;
  rate_day int;
  rate_night int;
  base numeric := 0;
  mult numeric := CASE WHEN _environment = 'busy' THEN 1.25 ELSE 1.0 END;
  amount numeric;
  bucket text;
BEGIN
  IF _end <= _start THEN
    RETURN jsonb_build_object('amount', 0, 'breakdown',
      jsonb_build_object('error','end_before_start'));
  END IF;

  SELECT day_min, night_min INTO d_min, n_min
    FROM public._split_day_night_minutes(_start, _end);
  total_min := d_min + n_min;
  hours := total_min::numeric / 60.0;

  -- Home Care: flat rate, NO busy multiplier (spec §4).
  IF _coverage_kind = 'home' THEN
    base := hours * 15000;
    amount := ROUND(base);
    RETURN jsonb_build_object(
      'amount', amount,
      'breakdown', jsonb_build_object(
        'kind','home','hours',hours,'rate',15000,
        'multiplier',1.0,'environment',_environment
      )
    );
  END IF;

  -- Fixed 24h / 48h flats
  IF total_min = 1440 THEN
    amount := ROUND(36000 * mult);
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object('kind','flat_24h','multiplier',mult));
  END IF;
  IF total_min = 2880 THEN
    amount := ROUND(72000 * mult);
    RETURN jsonb_build_object('amount', amount,
      'breakdown', jsonb_build_object('kind','flat_48h','multiplier',mult));
  END IF;

  -- Pick bucket from total hours (per-assignment tiering).
  -- Spec §2: <4h and 4–6h have the same day/night rate; only >6h splits.
  IF hours >= 6 THEN
    rate_day := 2000; rate_night := 1500; bucket := '6h+';
  ELSIF hours >= 4 THEN
    rate_day := 2500; rate_night := 2500; bucket := '4-6h';
  ELSE
    rate_day := 3000; rate_night := 3000; bucket := '<4h';
  END IF;

  base := (d_min::numeric / 60.0) * rate_day
        + (n_min::numeric / 60.0) * rate_night;
  amount := ROUND(base * mult);

  RETURN jsonb_build_object(
    'amount', amount,
    'breakdown', jsonb_build_object(
      'kind','standard','bucket',bucket,
      'day_min',d_min,'night_min',n_min,
      'rate_day',rate_day,'rate_night',rate_night,
      'multiplier',mult,'environment',_environment
    )
  );
END $$;

-- end_shift: aggregate ALL segments and bill with ONE tier from total time.
CREATE OR REPLACE FUNCTION public.end_shift(_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.coverage_requests;
  seg public.shift_segments;
  kind text;
  sum_worked int := 0;
  sum_d int := 0;
  sum_n int := 0;
  seg_d int;
  seg_n int;
  seg_worked int;
  billable_total int;
  scaled_d int;
  scaled_n int;
  v_total numeric := 0;
  q jsonb;
  due timestamptz := now() + interval '15 minutes';
  remainder_amount numeric;
  remainder_min int;
  last_seg_id uuid;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can end this shift'; END IF;
  IF r.status NOT IN ('active','paused') THEN RAISE EXCEPTION 'Shift is not in progress'; END IF;
  kind := CASE WHEN lower(coalesce(r.coverage_type,'')) LIKE 'home%' THEN 'home' ELSE 'standard' END;

  -- Close any still-open segment.
  FOR seg IN
    SELECT * FROM public.shift_segments
     WHERE request_id = _request_id AND ended_at IS NULL
     FOR UPDATE
  LOOP
    UPDATE public.shift_segments SET ended_at = now() WHERE id = seg.id;
  END LOOP;

  -- Reset prior billing so end_shift is the single source of truth.
  UPDATE public.shift_segments
     SET billed_minutes = NULL, billed_amount = NULL
   WHERE request_id = _request_id;

  -- Aggregate actual worked minutes + day/night split across ALL segments.
  FOR seg IN
    SELECT * FROM public.shift_segments
     WHERE request_id = _request_id
       AND ended_at IS NOT NULL
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

  -- Apply 60-min floor + 15-min ceiling ONCE at assignment level.
  billable_total := public._round_billable_minutes(sum_worked);

  -- Scale day/night proportionally so the rounded total matches.
  IF (sum_d + sum_n) > 0 THEN
    scaled_d := ROUND(sum_d::numeric * billable_total / (sum_d + sum_n))::int;
    scaled_n := billable_total - scaled_d;
  ELSE
    scaled_d := billable_total;
    scaled_n := 0;
  END IF;

  -- Single quote priced from total time → correct tier bucket.
  IF billable_total > 0 THEN
    -- Synthesize a window with the right d/n composition by walking from a
    -- reference start that yields exactly scaled_d day minutes and scaled_n
    -- night minutes. Simpler: compute amount directly from the aggregated
    -- minutes using compute_quote's pricing rules inline.
    -- We reuse compute_quote by constructing a synthetic window where the
    -- first scaled_d minutes are 06:00–day and the remaining are 22:00–night.
    -- That guarantees the same bucket/tier/multiplier the function would apply.
    DECLARE
      synth_start timestamptz;
      synth_end timestamptz;
      hours numeric := billable_total::numeric / 60.0;
      mult numeric := CASE WHEN r.environment = 'busy' AND kind = 'standard' THEN 1.25
                           WHEN r.environment = 'busy' AND kind = 'home'     THEN 1.0
                           ELSE 1.0 END;
      rate_day int; rate_night int;
      base numeric;
    BEGIN
      IF kind = 'home' THEN
        v_total := ROUND(hours * 15000);
      ELSIF billable_total = 1440 THEN
        v_total := ROUND(36000 * mult);
      ELSIF billable_total = 2880 THEN
        v_total := ROUND(72000 * mult);
      ELSE
        IF hours >= 6 THEN
          rate_day := 2000; rate_night := 1500;
        ELSIF hours >= 4 THEN
          rate_day := 2500; rate_night := 2500;
        ELSE
          rate_day := 3000; rate_night := 3000;
        END IF;
        base := (scaled_d::numeric / 60.0) * rate_day
              + (scaled_n::numeric / 60.0) * rate_night;
        v_total := ROUND(base * mult);
      END IF;
    END;
  END IF;

  -- Stamp the LAST segment with the aggregate billing for display purposes.
  -- (Per-segment billing is no longer authoritative; the assignment total is.)
  IF last_seg_id IS NOT NULL THEN
    UPDATE public.shift_segments
       SET billed_minutes = billable_total,
           billed_amount  = v_total
     WHERE id = last_seg_id;
  END IF;

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
         paid_at = NULL
   WHERE id = _request_id
   RETURNING * INTO r;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  RETURN jsonb_build_object(
    'total_billed_amount', r.total_billed_amount,
    'payment_due_at', due
  );
END $function$;
