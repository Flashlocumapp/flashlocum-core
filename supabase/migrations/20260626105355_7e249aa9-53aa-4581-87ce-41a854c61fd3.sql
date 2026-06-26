ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles;
DELETE FROM auth.users WHERE email = 'momohoizamsi@gmail.com';
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;