CREATE OR REPLACE FUNCTION public.coverage_requests_emit_invalidate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_id uuid := COALESCE(NEW.id, OLD.id);
  should_emit boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    should_emit := NEW.status IN ('searching','paused');
  ELSIF TG_OP = 'UPDATE' THEN
    should_emit :=
         OLD.status IS DISTINCT FROM NEW.status
      OR (NEW.status IN ('searching','paused')
          AND (OLD.broadcast_started_at IS DISTINCT FROM NEW.broadcast_started_at
               OR OLD.rev IS DISTINCT FROM NEW.rev))
      OR OLD.accepted_by IS DISTINCT FROM NEW.accepted_by;
  END IF;

  IF should_emit THEN
    PERFORM realtime.send(
      jsonb_build_object('id', row_id, 'at', (extract(epoch from now()) * 1000)::bigint),
      'invalidate',
      'coverage_invalidations',
      false
    );
  END IF;

  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS coverage_requests_emit_invalidate ON public.coverage_requests;
CREATE TRIGGER coverage_requests_emit_invalidate
AFTER INSERT OR UPDATE ON public.coverage_requests
FOR EACH ROW
EXECUTE FUNCTION public.coverage_requests_emit_invalidate();