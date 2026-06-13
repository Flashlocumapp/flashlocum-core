
ALTER PUBLICATION supabase_realtime DROP TABLE public.coverage_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.coverage_requests (
  id, requester_id, accepted_by, status, hospital, area, coverage_type,
  day, day_index, days, start_time, end_time, start_ts, end_ts,
  duration_hrs, amount, fee_pct, accumulated_ms, started_at,
  payment_status, payment_provider, cancelled_by, created_at, updated_at
);

REVOKE EXECUTE ON FUNCTION public.admin_list_users(integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_user_is_approved_doctor() FROM anon;
REVOKE EXECUTE ON FUNCTION public.dispatch_email_queue_processing() FROM anon;
REVOKE EXECUTE ON FUNCTION public.email_queue_depth() FROM anon;
REVOKE EXECUTE ON FUNCTION public.prune_email_send_log(integer) FROM anon;
