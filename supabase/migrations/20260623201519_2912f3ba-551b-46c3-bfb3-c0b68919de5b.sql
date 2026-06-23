-- Rolling-20 with virtual buffer: pad missing events with synthetic seeds
-- (5.0 for ratings, completed for reliability) up to 20. Once n_real >= 20,
-- the buffer is fully displaced and the window is pure rolling-20.

CREATE OR REPLACE FUNCTION public.recompute_trust(_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_window int := 20;
  rt_total int := 0;
  rt_sample int := 0;
  rt_sum numeric := 0;
  rt_score numeric := 5.0;
  rl_total int := 0;
  rl_sample int := 0;
  rl_completed_real int := 0;
  rl_completed_effective int := 0;
  rl_score numeric := 100;
  rating_threshold numeric;
  rel_threshold numeric;
  snap jsonb;
  reasons text[] := ARRAY[]::text[];
  restricted boolean;
  restricted_at timestamptz;
  restricted_by uuid;
  restricted_reason text;
BEGIN
  SELECT role, account_restricted_at, account_restricted_by, account_restricted_reason
    INTO v_role, restricted_at, restricted_by, restricted_reason
    FROM public.profiles WHERE id = _user_id;
  IF v_role IS NULL THEN v_role := 'doctor'; END IF;

  -- Role-aware thresholds
  rating_threshold := CASE WHEN v_role = 'doctor' THEN 4.0 ELSE 3.5 END;
  rel_threshold    := CASE WHEN v_role = 'requester' THEN 75 ELSE 85 END;

  -- ===== Rating: latest 20 real + (20 - n) synthetic 5.0 seeds =====
  SELECT count(*) INTO rt_total FROM public._trust_ratings_received(_user_id);
  WITH latest AS (
    SELECT score FROM public._trust_ratings_received(_user_id)
     ORDER BY created_at DESC LIMIT v_window
  )
  SELECT COALESCE(SUM(score), 0)::numeric, COUNT(*)::int
    INTO rt_sum, rt_sample FROM latest;

  -- Blended score across full 20-slot window
  rt_score := ROUND(
    ((rt_sum + 5.0 * GREATEST(0, v_window - rt_sample)) / v_window)::numeric,
    2
  );

  -- ===== Reliability: latest 20 real + (20 - n) synthetic "completed" seeds =====
  SELECT count(*) INTO rl_total FROM public._trust_terminal_shifts(_user_id, v_role);
  WITH latest AS (
    SELECT outcome FROM public._trust_terminal_shifts(_user_id, v_role)
     ORDER BY terminal_at DESC LIMIT v_window
  )
  SELECT COUNT(*) FILTER (WHERE outcome='completed')::int, COUNT(*)::int
    INTO rl_completed_real, rl_sample FROM latest;

  rl_completed_effective := rl_completed_real + GREATEST(0, v_window - rl_sample);
  rl_score := ROUND(rl_completed_effective::numeric / v_window * 100);

  -- Flag only when below threshold (buffer keeps early users safe)
  IF rt_score < rating_threshold THEN
    reasons := array_append(reasons, format('rating %s < %s', rt_score, rating_threshold));
  END IF;
  IF rl_score < rel_threshold THEN
    reasons := array_append(reasons, format('reliability %s < %s', rl_score, rel_threshold));
  END IF;
  restricted := restricted_at IS NOT NULL;

  snap := jsonb_build_object(
    'version', 3,
    'computed_at', now(),
    'user_id', _user_id,
    'role', v_role,
    'window_size', v_window,
    'rating', jsonb_build_object(
      'score', rt_score,
      'sample_size', rt_sample,
      'total_count', rt_total,
      'buffer_seeds', GREATEST(0, v_window - rt_sample),
      'threshold', rating_threshold,
      'block_index', GREATEST(0, rt_total / v_window),
      'block_size', v_window,
      'in_progress_count', rt_sample
    ),
    'reliability', jsonb_build_object(
      'score', rl_score,
      'sample_size', rl_sample,
      'completed', rl_completed_real,
      'total_count', rl_total,
      'buffer_seeds', GREATEST(0, v_window - rl_sample),
      'threshold', rel_threshold,
      'block_index', GREATEST(0, rl_total / v_window),
      'block_size', v_window,
      'in_progress_count', rl_sample
    ),
    'eligibility', jsonb_build_object(
      'rating_below_threshold', rt_score < rating_threshold,
      'reliability_below_threshold', rl_score < rel_threshold,
      'any', (rt_score < rating_threshold) OR (rl_score < rel_threshold),
      'reasons', to_jsonb(reasons)
    ),
    'restriction', jsonb_build_object(
      'restricted', restricted,
      'restricted_at', restricted_at,
      'restricted_by', restricted_by,
      'reason', restricted_reason,
      'source', CASE WHEN restricted THEN 'admin_trust' ELSE NULL END
    )
  );

  UPDATE public.profiles
     SET trust_snapshot = snap, trust_snapshot_at = now()
   WHERE id = _user_id;

  RETURN snap;
END $function$;

-- Backfill snapshots for every existing profile so admin reflects the new model
DO $$
DECLARE u uuid;
BEGIN
  FOR u IN SELECT id FROM public.profiles LOOP
    BEGIN
      PERFORM public.recompute_trust(u);
    EXCEPTION WHEN others THEN NULL;
    END;
  END LOOP;
END $$;