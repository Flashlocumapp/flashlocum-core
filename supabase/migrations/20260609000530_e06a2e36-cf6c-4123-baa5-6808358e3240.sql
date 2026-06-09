
CREATE TABLE public.ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ratee_entity_id text NOT NULL,
  rater_user_id uuid NOT NULL,
  shift_id uuid REFERENCES public.coverage_requests(id) ON DELETE SET NULL,
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ratings_ratee ON public.ratings(ratee_entity_id);
CREATE INDEX idx_ratings_rater ON public.ratings(rater_user_id);
CREATE UNIQUE INDEX uniq_rating_per_shift ON public.ratings(rater_user_id, ratee_entity_id, shift_id) WHERE shift_id IS NOT NULL;

GRANT SELECT, INSERT ON public.ratings TO authenticated;
GRANT ALL ON public.ratings TO service_role;

ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read ratings"
  ON public.ratings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users insert own ratings"
  ON public.ratings FOR INSERT TO authenticated
  WITH CHECK (rater_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_rating(_entity_id text)
RETURNS TABLE(score numeric, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(ROUND(AVG(score)::numeric, 2), 0)::numeric AS score,
         COUNT(*)::bigint AS count
    FROM public.ratings
   WHERE ratee_entity_id = _entity_id
$$;

CREATE OR REPLACE FUNCTION public.get_reliability(_entity_id text)
RETURNS TABLE(completed bigint, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid;
  hslug text;
BEGIN
  IF _entity_id LIKE 'doc:%' THEN
    BEGIN
      uid := substring(_entity_id from 5)::uuid;
    EXCEPTION WHEN others THEN
      completed := 0; total := 0; RETURN NEXT; RETURN;
    END;
    RETURN QUERY
      SELECT COUNT(*) FILTER (WHERE status = 'completed')::bigint,
             COUNT(*)::bigint
        FROM public.coverage_requests
       WHERE accepted_by = uid
         AND status IN ('completed','cancelled','active','paused','accepted');
  ELSIF _entity_id LIKE 'hosp:%' THEN
    hslug := substring(_entity_id from 6);
    RETURN QUERY
      SELECT COUNT(*) FILTER (WHERE status = 'completed')::bigint,
             COUNT(*)::bigint
        FROM public.coverage_requests
       WHERE accepted_by IS NOT NULL
         AND lower(regexp_replace(hospital, '\s+', '_', 'g')) = hslug
         AND status IN ('completed','cancelled','active','paused','accepted');
  ELSE
    completed := 0; total := 0; RETURN NEXT;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_rating(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_reliability(text) TO authenticated, anon;
