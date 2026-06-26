
-- ============================================================================
-- Trust freeze enforcement.
-- Mirrors the existing account_restricted_at guards (trigger + claim + start +
-- resume) but for the admin-controlled trust_frozen_at field. Active shifts
-- are intentionally not affected: pause / end / payment paths do NOT check.
-- ============================================================================

-- 1) Extend insert/accept trigger to also block when caller is frozen.
CREATE OR REPLACE FUNCTION public._cr_enforce_account_restriction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  restricted_at timestamptz;
  frozen_at     timestamptz;
  reason        text;
  freeze_reason text;
  actor         uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    actor := NEW.requester_id;
    IF actor IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT account_restricted_at, account_restricted_reason,
           trust_frozen_at, trust_frozen_reason
      INTO restricted_at, reason, frozen_at, freeze_reason
      FROM public.profiles WHERE id = actor;
    IF restricted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Account restricted: %', COALESCE(reason, 'contact support');
    END IF;
    IF frozen_at IS NOT NULL THEN
      RAISE EXCEPTION 'Account frozen: %', COALESCE(freeze_reason, 'contact support');
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.accepted_by IS NOT NULL
       AND (OLD.accepted_by IS NULL OR OLD.accepted_by IS DISTINCT FROM NEW.accepted_by) THEN
      SELECT account_restricted_at, account_restricted_reason,
             trust_frozen_at, trust_frozen_reason
        INTO restricted_at, reason, frozen_at, freeze_reason
        FROM public.profiles WHERE id = NEW.accepted_by;
      IF restricted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Account restricted: %', COALESCE(reason, 'contact support');
      END IF;
      IF frozen_at IS NOT NULL THEN
        RAISE EXCEPTION 'Account frozen: %', COALESCE(freeze_reason, 'contact support');
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;

-- 2) claim_coverage_request: clearer error for the doctor.
CREATE OR REPLACE FUNCTION public.claim_coverage_request(_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  updated int;
  restricted_at timestamptz;
  frozen_at     timestamptz;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid AND verification_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT account_restricted_at, trust_frozen_at
    INTO restricted_at, frozen_at
    FROM public.profiles WHERE id = uid;
  IF restricted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Account restricted';
  END IF;
  IF frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'Account frozen';
  END IF;
  UPDATE public.coverage_requests
     SET status = 'accepted', accepted_by = uid
   WHERE id = _request_id
     AND status = 'searching'
     AND accepted_by IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;

-- 3) start_shift: block when requester is frozen. Existing semantics preserved.
CREATE OR REPLACE FUNCTION public.start_shift(_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.coverage_requests;
  now_ms bigint := (EXTRACT(EPOCH FROM now())*1000)::bigint;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the requester can start this shift';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND account_restricted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Account restricted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND trust_frozen_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Account frozen';
  END IF;
  IF r.started_at IS NOT NULL THEN RAISE EXCEPTION 'Shift already started'; END IF;

  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET started_at       = now_ms,
         status           = 'active',
         accumulated_ms   = 0,
         first_started_at = COALESCE(first_started_at, now())
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);

  INSERT INTO public.shift_segments(request_id, segment_index, started_at)
  VALUES (_request_id, 1, now());

  RETURN jsonb_build_object('started_at', now(), 'startedAtMs', now_ms);
END $function$;

GRANT EXECUTE ON FUNCTION public.start_shift(uuid) TO authenticated;

-- 4) resume_shift: block when requester is frozen.
CREATE OR REPLACE FUNCTION public.resume_shift(_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.coverage_requests;
  next_idx int;
  di int;
  now_ms bigint := (EXTRACT(EPOCH FROM now())*1000)::bigint;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Only the requester can resume this shift'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND trust_frozen_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Account frozen';
  END IF;
  IF r.status <> 'paused' THEN
    IF r.status = 'active' THEN
      RETURN jsonb_build_object('already_active', true);
    END IF;
    RAISE EXCEPTION 'Shift is not paused';
  END IF;
  SELECT COALESCE(MAX(segment_index), 0) + 1 INTO next_idx
    FROM public.shift_segments WHERE request_id = _request_id;
  di := GREATEST(1, LEAST(COALESCE(r.days,1), COALESCE(r.day_index,1)));
  INSERT INTO public.shift_segments(request_id, segment_index, started_at, day_index)
  VALUES (_request_id, next_idx, now(), di);
  PERFORM set_config('app.lifecycle_bypass', 'on', true);
  UPDATE public.coverage_requests
     SET status         = 'active',
         started_at     = now_ms,
         accumulated_ms = 0
   WHERE id = _request_id;
  PERFORM set_config('app.lifecycle_bypass', '', true);
  RETURN jsonb_build_object('resumed_at', now(), 'startedAtMs', now_ms,
                            'segment_index', next_idx, 'day_index', di);
END $function$;

GRANT EXECUTE ON FUNCTION public.resume_shift(uuid) TO authenticated;
