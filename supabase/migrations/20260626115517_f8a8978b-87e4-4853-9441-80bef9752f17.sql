REVOKE ALL ON FUNCTION public.list_online_approved_doctors() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_online_approved_doctors() TO authenticated;