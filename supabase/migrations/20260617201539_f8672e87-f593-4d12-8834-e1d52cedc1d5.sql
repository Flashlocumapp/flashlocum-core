CREATE OR REPLACE FUNCTION public._profiles_force_offline_on_restriction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.account_restricted_at IS NULL) AND (NEW.account_restricted_at IS NOT NULL) THEN
    UPDATE public.doctor_presence
       SET online = false,
           last_seen = now() - interval '10 minutes'
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_force_offline_on_restriction ON public.profiles;
CREATE TRIGGER profiles_force_offline_on_restriction
AFTER UPDATE OF account_restricted_at ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public._profiles_force_offline_on_restriction();