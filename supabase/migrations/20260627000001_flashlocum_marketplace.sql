-- FlashLocum Marketplace: shifts + applications tables
-- Add missing profile columns for the new mobile app

-- ============================================================
-- 1. Add missing columns to profiles
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS specialty text,
  ADD COLUMN IF NOT EXISTS gmc_number text,
  ADD COLUMN IF NOT EXISTS hospital_name text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS availability text,
  ADD COLUMN IF NOT EXISTS onboarded_cover_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarded_request_at timestamptz;

-- ============================================================
-- 2. shifts table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  specialty text NOT NULL,
  shift_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  location text NOT NULL,
  city text NOT NULL,
  hourly_rate numeric NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz DEFAULT now(),
  CONSTRAINT shifts_status_check CHECK (status IN ('open', 'filled', 'completed'))
);

GRANT SELECT ON public.shifts TO authenticated, anon;
GRANT INSERT, UPDATE ON public.shifts TO authenticated;
GRANT ALL ON public.shifts TO service_role;

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read open shifts
CREATE POLICY "Anyone can read open shifts"
  ON public.shifts FOR SELECT
  TO authenticated
  USING (status = 'open' OR requester_id = auth.uid());

-- Requesters can insert their own shifts
CREATE POLICY "Requesters can insert shifts"
  ON public.shifts FOR INSERT
  TO authenticated
  WITH CHECK (requester_id = auth.uid());

-- Requesters can update their own shifts
CREATE POLICY "Requesters can update their own shifts"
  ON public.shifts FOR UPDATE
  TO authenticated
  USING (requester_id = auth.uid())
  WITH CHECK (requester_id = auth.uid());

-- ============================================================
-- 3. applications table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid REFERENCES public.shifts(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  UNIQUE(shift_id, doctor_id),
  CONSTRAINT applications_status_check CHECK (status IN ('pending', 'accepted', 'declined'))
);

GRANT SELECT ON public.applications TO authenticated;
GRANT INSERT, UPDATE ON public.applications TO authenticated;
GRANT ALL ON public.applications TO service_role;

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- Doctors can read their own applications
CREATE POLICY "Doctors can read own applications"
  ON public.applications FOR SELECT
  TO authenticated
  USING (
    doctor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = applications.shift_id AND s.requester_id = auth.uid()
    )
  );

-- Doctors can insert their own applications
CREATE POLICY "Doctors can apply to shifts"
  ON public.applications FOR INSERT
  TO authenticated
  WITH CHECK (doctor_id = auth.uid());

-- Requesters can update application status for their shifts
CREATE POLICY "Requesters can update applications for their shifts"
  ON public.applications FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = applications.shift_id AND s.requester_id = auth.uid()
    )
  );

-- ============================================================
-- 4. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_shifts_requester_id ON public.shifts(requester_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON public.shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_shift_date ON public.shifts(shift_date DESC);
CREATE INDEX IF NOT EXISTS idx_applications_shift_id ON public.applications(shift_id);
CREATE INDEX IF NOT EXISTS idx_applications_doctor_id ON public.applications(doctor_id);

-- ============================================================
-- 5. Seed data: 5 sample open shifts
-- ============================================================
INSERT INTO public.shifts (specialty, shift_date, start_time, end_time, location, city, hourly_rate, notes, status)
VALUES
  ('General Practice', CURRENT_DATE + 2, '08:00', '16:00', 'Lagos Island General Hospital', 'Lagos', 18000, 'Outpatient clinic cover needed. Bring your MDCN certificate.', 'open'),
  ('Emergency Medicine', CURRENT_DATE + 3, '20:00', '08:00', 'National Hospital Abuja', 'Abuja', 28000, 'Night shift A&E cover. Experience with trauma preferred.', 'open'),
  ('Paediatrics', CURRENT_DATE + 4, '09:00', '17:00', 'University of Lagos Teaching Hospital', 'Lagos', 22000, 'Paediatric ward cover. Neonatal experience a plus.', 'open'),
  ('Internal Medicine', CURRENT_DATE + 5, '07:00', '15:00', 'Aminu Kano Teaching Hospital', 'Kano', 20000, 'Medical ward rounds and admissions.', 'open'),
  ('Obstetrics & Gynaecology', CURRENT_DATE + 6, '08:00', '20:00', 'University of Benin Teaching Hospital', 'Benin City', 25000, 'Labour ward and antenatal clinic cover.', 'open')
ON CONFLICT DO NOTHING;
