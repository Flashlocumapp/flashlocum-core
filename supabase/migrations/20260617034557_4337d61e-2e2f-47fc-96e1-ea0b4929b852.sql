
-- ===========================================================================
-- Trust Snapshot layer (M1 + M2)
-- Single server-computed object for rating + reliability + eligibility +
-- restriction. No client-side scoring. No auto-restriction from scores.
-- ===========================================================================

-- 1. ENUM: add no_show
ALTER TYPE public.coverage_request_status ADD VALUE IF NOT EXISTS 'no_show';

-- 2. ratings table hardening
-- Migrate any historical hosp:<slug> ratees to req:<requester_id>
UPDATE public.ratings r
   SET ratee_entity_id = 'req:' || cr.requester_id::text
  FROM public.coverage_requests cr
 WHERE r.shift_id = cr.id
   AND r.ratee_entity_id LIKE 'hosp:%';

-- Delete any rating rows we cannot resolve (paranoia; shift_id is non-null already)
DELETE FROM public.ratings WHERE shift_id IS NULL;

ALTER TABLE public.ratings
  ALTER COLUMN shift_id SET NOT NULL,
  ADD COLUMN IF NOT EXISTS feedback text NULL;

DROP INDEX IF EXISTS public.uniq_rating_per_shift;
CREATE UNIQUE INDEX uniq_rating_per_shift
  ON public.ratings (rater_user_id, ratee_entity_id, shift_id);

-- 3. coverage_requests: per-shift rating mirror columns
ALTER TABLE public.coverage_requests
  ADD COLUMN IF NOT EXISTS requester_rating_submitted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requester_rating_score smallint,
  ADD COLUMN IF NOT EXISTS requester_rating_at timestamptz,
  ADD COLUMN IF NOT EXISTS doctor_rating_submitted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doctor_rating_score smallint,
  ADD COLUMN IF NOT EXISTS doctor_rating_at timestamptz;

-- 4. profiles: trust snapshot + admin restriction fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trust_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS trust_snapshot_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_restricted_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_restricted_reason text,
  ADD COLUMN IF NOT EXISTS account_restricted_by uuid;

-- 5. trust_blocks (closed 20-block history)
CREATE TABLE IF NOT EXISTS public.trust_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('rating','reliability')),
  block_index int  NOT NULL,
  from_at     timestamptz NOT NULL,
  to_at       timestamptz NOT NULL,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, kind, block_index)
);
GRANT SELECT ON public.trust_blocks TO authenticated;
GRANT ALL ON public.trust_blocks TO service_role;
ALTER TABLE public.trust_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY trust_blocks_self_read ON public.trust_blocks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- ===========================================================================
-- 6. Helpers
-- ===========================================================================

-- terminal shift set for a user (as doctor OR requester)
CREATE OR REPLACE FUNCTION public._trust_terminal_shifts(_user_id uuid, _role text)
RETURNS TABLE(shift_id uuid, terminal_at timestamptz, outcome text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT cr.id, COALESCE(cr.updated_at, cr.created_at),
         CASE WHEN cr.status::text = 'completed' THEN 'completed'
              WHEN cr.status::text = 'no_show'   THEN 'no_show'
              ELSE 'cancelled' END
    FROM public.coverage_requests cr
   WHERE ( (_role = 'doctor'    AND cr.accepted_by = _user_id)
        OR (_role = 'requester' AND cr.requester_id = _user_id) )
     AND ( cr.status::text IN ('completed','no_show')
        OR (cr.status::text = 'cancelled' AND cr.accepted_by IS NOT NULL) )
   ORDER BY COALESCE(cr.updated_at, cr.created_at) ASC
$$;

-- ratings received by a user, ordered
CREATE OR REPLACE FUNCTION public._trust_ratings_received(_user_id uuid)
RETURNS TABLE(score int, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT r.score::int, r.created_at
    FROM public.ratings r
   WHERE r.ratee_entity_id IN ('doc:' || _user_id::text, 'req:' || _user_id::text)
   ORDER BY r.created_at ASC
$$;

-- ===========================================================================
-- 7. recompute_trust — pure compute, never touches restriction state
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.recompute_trust(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_role text;
  v_block_size int := 20;
  -- rating
  rt_total int := 0;
  rt_in_progress int;
  rt_blocks_closed int;
  rt_existing_blocks int;
  rt_score numeric := 5.0;
  rt_last jsonb := NULL;
  -- reliability
  rl_total int := 0;
  rl_in_progress int;
  rl_blocks_closed int;
  rl_existing_blocks int;
  rl_score numeric := 100;
  rl_last jsonb := NULL;
  i int;
  block_rows jsonb;
  block_avg numeric;
  block_from timestamptz;
  block_to timestamptz;
  comp int; canc int; ns int;
  rating_threshold numeric := 3.5;
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
  rel_threshold := CASE WHEN v_role = 'requester' THEN 75 ELSE 85 END;

  -- ---------- RATING blocks ----------
  SELECT count(*) INTO rt_total FROM public._trust_ratings_received(_user_id);
  rt_blocks_closed := rt_total / v_block_size;
  rt_in_progress := rt_total - rt_blocks_closed * v_block_size;

  SELECT COALESCE(max(block_index),0) INTO rt_existing_blocks
    FROM public.trust_blocks WHERE user_id=_user_id AND kind='rating';

  IF rt_blocks_closed > rt_existing_blocks THEN
    FOR i IN (rt_existing_blocks+1)..rt_blocks_closed LOOP
      WITH src AS (
        SELECT score, created_at,
               row_number() OVER (ORDER BY created_at ASC) AS rn
          FROM public._trust_ratings_received(_user_id)
      )
      SELECT AVG(score)::numeric(4,2), MIN(created_at), MAX(created_at)
        INTO block_avg, block_from, block_to
        FROM src
       WHERE rn BETWEEN ((i-1)*v_block_size + 1) AND (i*v_block_size);
      INSERT INTO public.trust_blocks(user_id, kind, block_index, from_at, to_at, payload)
      VALUES (_user_id, 'rating', i, block_from, block_to,
        jsonb_build_object('avg', block_avg, 'samples', v_block_size,
                           'from', block_from, 'to', block_to))
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  IF rt_blocks_closed > 0 THEN
    SELECT payload INTO rt_last FROM public.trust_blocks
     WHERE user_id=_user_id AND kind='rating' AND block_index=rt_blocks_closed;
    rt_score := COALESCE((rt_last->>'avg')::numeric, 5.0);
  END IF;

  -- ---------- RELIABILITY blocks ----------
  SELECT count(*) INTO rl_total FROM public._trust_terminal_shifts(_user_id, v_role);
  rl_blocks_closed := rl_total / v_block_size;
  rl_in_progress := rl_total - rl_blocks_closed * v_block_size;

  SELECT COALESCE(max(block_index),0) INTO rl_existing_blocks
    FROM public.trust_blocks WHERE user_id=_user_id AND kind='reliability';

  IF rl_blocks_closed > rl_existing_blocks THEN
    FOR i IN (rl_existing_blocks+1)..rl_blocks_closed LOOP
      WITH src AS (
        SELECT outcome, terminal_at,
               row_number() OVER (ORDER BY terminal_at ASC) AS rn
          FROM public._trust_terminal_shifts(_user_id, v_role)
      ), agg AS (
        SELECT
          count(*) FILTER (WHERE outcome='completed') AS c,
          count(*) FILTER (WHERE outcome='cancelled') AS x,
          count(*) FILTER (WHERE outcome='no_show')   AS n,
          min(terminal_at) AS f, max(terminal_at) AS t
          FROM src
         WHERE rn BETWEEN ((i-1)*v_block_size + 1) AND (i*v_block_size)
      )
      SELECT c, x, n, f, t INTO comp, canc, ns, block_from, block_to FROM agg;
      INSERT INTO public.trust_blocks(user_id, kind, block_index, from_at, to_at, payload)
      VALUES (_user_id, 'reliability', i, block_from, block_to,
        jsonb_build_object('completed', comp, 'cancelled', canc, 'no_show', ns,
                           'total', v_block_size, 'from', block_from, 'to', block_to))
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  IF rl_blocks_closed > 0 THEN
    SELECT payload INTO rl_last FROM public.trust_blocks
     WHERE user_id=_user_id AND kind='reliability' AND block_index=rl_blocks_closed;
    rl_score := ROUND( ((rl_last->>'completed')::numeric / v_block_size) * 100 );
  END IF;

  -- ---------- eligibility (signal only) ----------
  IF rt_score < rating_threshold THEN
    reasons := array_append(reasons, format('rating %s < %s', rt_score, rating_threshold));
  END IF;
  IF rl_score < rel_threshold THEN
    reasons := array_append(reasons, format('reliability %s < %s', rl_score, rel_threshold));
  END IF;
  restricted := restricted_at IS NOT NULL;

  snap := jsonb_build_object(
    'version', 1,
    'computed_at', now(),
    'user_id', _user_id,
    'role', v_role,
    'rating', jsonb_build_object(
      'score', rt_score,
      'block_index', rt_blocks_closed,
      'block_size', v_block_size,
      'in_progress_count', rt_in_progress,
      'last_block', rt_last
    ),
    'reliability', jsonb_build_object(
      'score', rl_score,
      'block_index', rl_blocks_closed,
      'block_size', v_block_size,
      'in_progress_count', rl_in_progress,
      'last_block', rl_last
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
END $$;

-- ===========================================================================
-- 8. RPCs
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.get_trust(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE caller uuid := auth.uid(); snap jsonb; snap_at timestamptz; allowed boolean;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  allowed := caller = _user_id OR public.has_role(caller,'admin')
          OR EXISTS (SELECT 1 FROM public.coverage_requests cr
                      WHERE (cr.requester_id = caller AND cr.accepted_by = _user_id)
                         OR (cr.accepted_by = caller  AND cr.requester_id = _user_id));
  IF NOT allowed THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT trust_snapshot, trust_snapshot_at INTO snap, snap_at
    FROM public.profiles WHERE id = _user_id;
  IF snap IS NULL OR snap_at IS NULL OR snap_at < now() - interval '5 minutes' THEN
    -- recompute_trust requires SECURITY DEFINER; safe to call
    snap := (SELECT public.recompute_trust(_user_id));
  END IF;
  RETURN snap;
END $$;

CREATE OR REPLACE FUNCTION public.get_shift_rating_state(_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.coverage_requests; caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF caller <> r.requester_id AND caller <> r.accepted_by
     AND NOT public.has_role(caller,'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN jsonb_build_object(
    'shift_id', r.id,
    'doctor_rating', jsonb_build_object(
      'submitted', r.doctor_rating_submitted,
      'score', r.doctor_rating_score,
      'at', r.doctor_rating_at
    ),
    'requester_rating', jsonb_build_object(
      'submitted', r.requester_rating_submitted,
      'score', r.requester_rating_score,
      'at', r.requester_rating_at
    )
  );
END $$;

CREATE OR REPLACE FUNCTION public.submit_shift_rating(_request_id uuid, _score int, _feedback text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  r public.coverage_requests;
  caller uuid := auth.uid();
  ratee uuid;
  ratee_id text;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _score < 1 OR _score > 5 THEN RAISE EXCEPTION 'Invalid score'; END IF;
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status NOT IN ('completed','cancelled','no_show') THEN
    RAISE EXCEPTION 'Shift not yet terminal';
  END IF;

  IF caller = r.requester_id AND r.accepted_by IS NOT NULL THEN
    ratee := r.accepted_by;
    ratee_id := 'doc:' || ratee::text;
  ELSIF caller = r.accepted_by THEN
    ratee := r.requester_id;
    ratee_id := 'req:' || ratee::text;
  ELSE
    RAISE EXCEPTION 'Not authorized to rate this shift';
  END IF;

  INSERT INTO public.ratings(ratee_entity_id, rater_user_id, shift_id, score, feedback)
  VALUES (ratee_id, caller, r.id, _score, NULLIF(_feedback,''));

  RETURN public.get_shift_rating_state(_request_id);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Already rated' USING ERRCODE = 'unique_violation';
END $$;

-- ===========================================================================
-- 9. Triggers
-- ===========================================================================

-- 9a. ratings insert -> mirror submission flags + recompute trust
CREATE OR REPLACE FUNCTION public._ratings_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ratee uuid; is_doctor boolean;
BEGIN
  is_doctor := NEW.ratee_entity_id LIKE 'doc:%';
  BEGIN
    ratee := substring(NEW.ratee_entity_id from position(':' in NEW.ratee_entity_id)+1)::uuid;
  EXCEPTION WHEN others THEN ratee := NULL; END;

  IF is_doctor THEN
    UPDATE public.coverage_requests
       SET doctor_rating_submitted = true,
           doctor_rating_score = NEW.score,
           doctor_rating_at = NEW.created_at
     WHERE id = NEW.shift_id;
  ELSE
    UPDATE public.coverage_requests
       SET requester_rating_submitted = true,
           requester_rating_score = NEW.score,
           requester_rating_at = NEW.created_at
     WHERE id = NEW.shift_id;
  END IF;

  IF ratee IS NOT NULL THEN
    PERFORM public.recompute_trust(ratee);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ratings_after_insert ON public.ratings;
CREATE TRIGGER trg_ratings_after_insert
  AFTER INSERT ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public._ratings_after_insert();

-- 9b. coverage_requests status -> recompute trust for both sides on terminal
CREATE OR REPLACE FUNCTION public._cr_after_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status::text IN ('completed','cancelled','no_show')
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    IF NEW.requester_id IS NOT NULL THEN
      PERFORM public.recompute_trust(NEW.requester_id);
    END IF;
    IF NEW.accepted_by IS NOT NULL THEN
      PERFORM public.recompute_trust(NEW.accepted_by);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cr_after_status_change ON public.coverage_requests;
CREATE TRIGGER trg_cr_after_status_change
  AFTER UPDATE OF status ON public.coverage_requests
  FOR EACH ROW EXECUTE FUNCTION public._cr_after_status_change();

-- ===========================================================================
-- 10. Admin governance RPCs
-- NOTE: account_restricted_at is ONLY written by these two functions.
-- No trigger, no other function, ever writes it automatically.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.admin_apply_trust_restriction(_user_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE public.profiles
     SET account_restricted_at = COALESCE(account_restricted_at, now()),
         account_restricted_by = auth.uid(),
         account_restricted_reason = _reason
   WHERE id = _user_id;
  RETURN public.recompute_trust(_user_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_clear_trust_restriction(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE public.profiles
     SET account_restricted_at = NULL,
         account_restricted_by = NULL,
         account_restricted_reason = NULL
   WHERE id = _user_id;
  RETURN public.recompute_trust(_user_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_mark_no_show(_request_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status = 'no_show'
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);
  RETURN jsonb_build_object('ok', true, 'reason', _reason);
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_trust(_only_flagged boolean DEFAULT true, _limit int DEFAULT 200)
RETURNS TABLE(user_id uuid, full_name text, role text, snapshot jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.trust_snapshot
      FROM public.profiles p
     WHERE p.trust_snapshot IS NOT NULL
       AND (NOT _only_flagged OR (p.trust_snapshot->'eligibility'->>'any')::boolean = true)
     ORDER BY
       LEAST(
         COALESCE((p.trust_snapshot->'rating'->>'score')::numeric, 5),
         COALESCE((p.trust_snapshot->'reliability'->>'score')::numeric, 100) / 20.0
       ) ASC
     LIMIT LEAST(GREATEST(COALESCE(_limit,200),1), 1000);
END $$;

-- ===========================================================================
-- 11. Backfill: mirror existing ratings + initial recompute for all profiles
-- ===========================================================================

-- Mirror existing ratings into coverage_requests submission columns
UPDATE public.coverage_requests cr
   SET doctor_rating_submitted = true,
       doctor_rating_score = r.score,
       doctor_rating_at = r.created_at
  FROM public.ratings r
 WHERE r.shift_id = cr.id AND r.ratee_entity_id LIKE 'doc:%';

UPDATE public.coverage_requests cr
   SET requester_rating_submitted = true,
       requester_rating_score = r.score,
       requester_rating_at = r.created_at
  FROM public.ratings r
 WHERE r.shift_id = cr.id AND r.ratee_entity_id LIKE 'req:%';

-- Compute initial trust snapshot for every profile (cheap; no blocks closed for most)
DO $$
DECLARE pid uuid;
BEGIN
  FOR pid IN SELECT id FROM public.profiles LOOP
    PERFORM public.recompute_trust(pid);
  END LOOP;
END $$;
