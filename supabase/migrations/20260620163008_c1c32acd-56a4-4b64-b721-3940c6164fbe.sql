
-- ============ AUDIT 5: Fix prevent_requester_sensitive_change ============

CREATE OR REPLACE FUNCTION public.prevent_requester_sensitive_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(), 'admin') THEN RETURN NEW; END IF;
  IF COALESCE(current_setting('app.lifecycle_bypass', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.requester_id = auth.uid() AND OLD.requester_id = auth.uid() THEN
    NEW.accepted_by       := OLD.accepted_by;
    NEW.settled_amount    := OLD.settled_amount;
    NEW.started_at        := OLD.started_at;
    NEW.accumulated_ms    := OLD.accumulated_ms;
    NEW.requester_id      := OLD.requester_id;
    NEW.payment_status    := OLD.payment_status;
    NEW.payment_reference := OLD.payment_reference;
    NEW.paid_at           := OLD.paid_at;
    NEW.fee_pct           := OLD.fee_pct;
    NEW.remitted_at       := OLD.remitted_at;
  END IF;

  IF OLD.accepted_by IS NOT NULL
     AND OLD.accepted_by = auth.uid()
     AND (NEW.requester_id IS NULL OR NEW.requester_id <> auth.uid()) THEN
    NEW.requester_id      := OLD.requester_id;
    NEW.accepted_by       := OLD.accepted_by;
    NEW.settled_amount    := OLD.settled_amount;
    NEW.payment_status    := OLD.payment_status;
    NEW.payment_reference := OLD.payment_reference;
    NEW.payment_provider  := OLD.payment_provider;
    NEW.payment_url       := OLD.payment_url;
    NEW.paid_at           := OLD.paid_at;
    NEW.fee_pct           := OLD.fee_pct;
    NEW.remitted_at       := OLD.remitted_at;
    NEW.hospital          := OLD.hospital;
    NEW.phone             := OLD.phone;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prevent_requester_sensitive_change_trg ON public.coverage_requests;

-- ============ AUDIT 5b: Harden _ratings_after_insert ============

CREATE OR REPLACE FUNCTION public._ratings_after_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ratee uuid; is_doctor boolean;
BEGIN
  is_doctor := NEW.ratee_entity_id LIKE 'doc:%';
  BEGIN
    ratee := substring(NEW.ratee_entity_id from position(':' in NEW.ratee_entity_id)+1)::uuid;
  EXCEPTION WHEN others THEN ratee := NULL; END;

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
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
  PERFORM set_config('app.lifecycle_bypass', '', true);

  IF ratee IS NOT NULL THEN
    PERFORM public.recompute_trust(ratee);
  END IF;
  RETURN NEW;
END $function$;

-- ============ AUDIT 6: _trust_terminal_shifts — attribute by cancelled_by role ============
-- cancelled_by is text: 'doctor' | 'requester'. Pre-acceptance cancels (accepted_by IS NULL) excluded.

CREATE OR REPLACE FUNCTION public._trust_terminal_shifts(_user_id uuid, _role text)
 RETURNS TABLE(shift_id uuid, terminal_at timestamp with time zone, outcome text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT cr.id,
         COALESCE(cr.updated_at, cr.created_at) AS terminal_at,
         CASE WHEN cr.status::text = 'completed' THEN 'completed'
              WHEN cr.status::text = 'no_show'   THEN 'no_show'
              ELSE 'cancelled' END AS outcome
    FROM public.coverage_requests cr
   WHERE (
            (cr.status::text = 'completed'
              AND ( (_role = 'doctor'    AND cr.accepted_by  = _user_id)
                 OR (_role = 'requester' AND cr.requester_id = _user_id) ))
         OR
            (cr.status::text = 'cancelled'
              AND cr.accepted_by IS NOT NULL
              AND cr.cancelled_by = _role
              AND ( (_role = 'doctor'    AND cr.accepted_by  = _user_id)
                 OR (_role = 'requester' AND cr.requester_id = _user_id) ))
         OR
            (cr.status::text = 'no_show'
              AND ( (_role = 'doctor'
                       AND cr.accepted_by = _user_id
                       AND COALESCE(cr.cancelled_by, 'doctor') = 'doctor')
                 OR (_role = 'requester'
                       AND cr.requester_id = _user_id
                       AND cr.cancelled_by = 'requester') ))
         )
   ORDER BY COALESCE(cr.updated_at, cr.created_at) ASC
$function$;

-- ============ AUDIT 7: recompute_trust — rolling latest-20 ============

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
  rt_score numeric := 5.0;
  rl_total int := 0;
  rl_sample int := 0;
  rl_completed int := 0;
  rl_score numeric := 100;
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

  SELECT count(*) INTO rt_total FROM public._trust_ratings_received(_user_id);
  WITH latest AS (
    SELECT score FROM public._trust_ratings_received(_user_id)
     ORDER BY created_at DESC LIMIT v_window
  )
  SELECT COALESCE(AVG(score)::numeric(4,2), 5.0), COUNT(*)::int
    INTO rt_score, rt_sample FROM latest;
  IF rt_sample = 0 THEN rt_score := 5.0; END IF;

  SELECT count(*) INTO rl_total FROM public._trust_terminal_shifts(_user_id, v_role);
  WITH latest AS (
    SELECT outcome FROM public._trust_terminal_shifts(_user_id, v_role)
     ORDER BY terminal_at DESC LIMIT v_window
  )
  SELECT COUNT(*) FILTER (WHERE outcome='completed')::int, COUNT(*)::int
    INTO rl_completed, rl_sample FROM latest;
  IF rl_sample > 0 THEN
    rl_score := ROUND(rl_completed::numeric / rl_sample * 100);
  ELSE
    rl_score := 100;
  END IF;

  IF rt_sample > 0 AND rt_score < rating_threshold THEN
    reasons := array_append(reasons, format('rating %s < %s', rt_score, rating_threshold));
  END IF;
  IF rl_sample > 0 AND rl_score < rel_threshold THEN
    reasons := array_append(reasons, format('reliability %s < %s', rl_score, rel_threshold));
  END IF;
  restricted := restricted_at IS NOT NULL;

  snap := jsonb_build_object(
    'version', 2,
    'computed_at', now(),
    'user_id', _user_id,
    'role', v_role,
    'window_size', v_window,
    'rating', jsonb_build_object(
      'score', rt_score,
      'sample_size', rt_sample,
      'total_count', rt_total,
      'block_index', GREATEST(0, rt_total / v_window),
      'block_size', v_window,
      'in_progress_count', rt_sample
    ),
    'reliability', jsonb_build_object(
      'score', rl_score,
      'sample_size', rl_sample,
      'completed', rl_completed,
      'total_count', rl_total,
      'block_index', GREATEST(0, rl_total / v_window),
      'block_size', v_window,
      'in_progress_count', rl_sample
    ),
    'eligibility', jsonb_build_object(
      'rating_below_threshold', rt_sample > 0 AND rt_score < rating_threshold,
      'reliability_below_threshold', rl_sample > 0 AND rl_score < rel_threshold,
      'any', (rt_sample > 0 AND rt_score < rating_threshold)
          OR (rl_sample > 0 AND rl_score < rel_threshold),
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

-- ============ AUDIT 6b: Recompute trust on terminal status change ============

CREATE OR REPLACE FUNCTION public._cr_recompute_trust_on_terminal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status::text IN ('completed','cancelled','no_show')
     AND OLD.status::text IS DISTINCT FROM NEW.status::text THEN
    IF NEW.requester_id IS NOT NULL THEN
      PERFORM public.recompute_trust(NEW.requester_id);
    END IF;
    IF NEW.accepted_by IS NOT NULL THEN
      PERFORM public.recompute_trust(NEW.accepted_by);
    END IF;
  END IF;
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS trg_cr_recompute_trust_on_terminal ON public.coverage_requests;
CREATE TRIGGER trg_cr_recompute_trust_on_terminal
  AFTER UPDATE OF status ON public.coverage_requests
  FOR EACH ROW EXECUTE FUNCTION public._cr_recompute_trust_on_terminal();

-- ============ Backfill ============

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
