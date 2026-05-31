ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarded_request_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarded_cover_at timestamptz;