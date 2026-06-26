
-- Lightweight, broadly-readable trust summary for pills (rating + reliability only).
-- Safe to grant to every authenticated user: no eligibility reasons, no restriction
-- state, no PII. Reads the live snapshot kept fresh by rating/coverage triggers.
CREATE OR REPLACE FUNCTION public.get_trust_summary(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  snap jsonb;
  role_text text;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT trust_snapshot INTO snap FROM public.profiles WHERE id = _user_id;
  IF snap IS NULL THEN
    snap := public.recompute_trust(_user_id);
  END IF;
  IF snap IS NULL THEN
    RETURN NULL;
  END IF;

  role_text := COALESCE(snap->>'role', 'doctor');

  RETURN jsonb_build_object(
    'user_id', _user_id,
    'role', role_text,
    'rating', jsonb_build_object(
      'score', COALESCE((snap->'rating'->>'score')::numeric, 5.0),
      'block_index', COALESCE((snap->'rating'->>'block_index')::int, 0),
      'block_size', COALESCE((snap->'rating'->>'block_size')::int, 20)
    ),
    'reliability', jsonb_build_object(
      'score', COALESCE((snap->'reliability'->>'score')::numeric, 100),
      'block_index', COALESCE((snap->'reliability'->>'block_index')::int, 0),
      'block_size', COALESCE((snap->'reliability'->>'block_size')::int, 20)
    )
  );
END
$$;

REVOKE EXECUTE ON FUNCTION public.get_trust_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trust_summary(uuid) TO authenticated;

-- Drop the 5-minute staleness branch in get_trust; triggers keep snapshot live.
CREATE OR REPLACE FUNCTION public.get_trust(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  snap jsonb;
  allowed boolean;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  allowed := caller = _user_id OR public.has_role(caller,'admin')
          OR EXISTS (SELECT 1 FROM public.coverage_requests cr
                      WHERE (cr.requester_id = caller AND cr.accepted_by = _user_id)
                         OR (cr.accepted_by  = caller AND cr.requester_id = _user_id));
  IF NOT allowed THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT trust_snapshot INTO snap FROM public.profiles WHERE id = _user_id;
  IF snap IS NULL THEN
    snap := public.recompute_trust(_user_id);
  END IF;
  RETURN snap;
END
$$;
