-- =========================================================================
-- FlashLocum — schema for self-hosted Supabase project
-- Run this in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Safe to re-run; everything is idempotent.
-- =========================================================================

-- 1. App role enum (admin / doctor / requester) + user_roles table
do $$ begin
  create type public.app_role as enum ('doctor', 'requester', 'admin');
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.user_roles enable row level security;

drop policy if exists "Users can view their own roles" on public.user_roles;
create policy "Users can view their own roles"
  on public.user_roles for select
  to authenticated
  using (auth.uid() = user_id);

-- Security-definer role check used by other RLS policies
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- Admins can view all role assignments
drop policy if exists "Admins can view all roles" on public.user_roles;
create policy "Admins can view all roles"
  on public.user_roles for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- =========================================================================
-- 2. Verification status enum + profiles table
-- =========================================================================
do $$ begin
  create type public.verification_status as enum ('pending', 'approved', 'suspended', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text,
  full_name text,
  phone text,
  gender text,
  mdcn text,
  license_name text,
  bank_name text,
  bank_account text,
  selfie_url text,
  verification_status public.verification_status not null default 'pending',
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add the column if the table already existed without it
alter table public.profiles
  add column if not exists verification_status public.verification_status not null default 'pending';
alter table public.profiles
  add column if not exists bank_name text;
alter table public.profiles
  add column if not exists bank_account text;

grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

alter table public.profiles enable row level security;

-- User policies
drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Users can update their own profile but CANNOT change verification_status
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and verification_status = (
      select p.verification_status from public.profiles p where p.id = auth.uid()
    )
  );

-- Admin policies
drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles"
  on public.profiles for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can update all profiles" on public.profiles;
create policy "Admins can update all profiles"
  on public.profiles for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- =========================================================================
-- 3. updated_at trigger
-- =========================================================================
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- =========================================================================
-- 4. Auto-create profile row on signup
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, verification_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    coalesce(new.raw_user_meta_data ->> 'role', null),
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- 5. Realtime — push profile changes (admin approvals, etc.) to the client
-- =========================================================================
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;

-- =========================================================================
-- 6. Bootstrap your first admin (REPLACE the email below, then run once)
-- =========================================================================
-- insert into public.user_roles (user_id, role)
-- select id, 'admin'::public.app_role from auth.users where email = 'you@example.com'
-- on conflict do nothing;
