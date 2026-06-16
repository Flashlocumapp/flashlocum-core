CREATE OR REPLACE FUNCTION public.prevent_self_verification_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
      NEW.verification_status := OLD.verification_status;
    END IF;
    IF OLD.role IS NOT NULL AND NEW.role IS DISTINCT FROM OLD.role THEN
      NEW.role := OLD.role;
    END IF;
    IF OLD.mdcn IS NOT NULL AND NEW.mdcn IS DISTINCT FROM OLD.mdcn THEN
      NEW.mdcn := OLD.mdcn;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;