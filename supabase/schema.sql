-- BeDa Rooms — Supabase schema
-- Run this in Supabase Dashboard → SQL Editor → New query → Paste → Run
-- Creates: profiles + rental_data (single JSON store per user) + RLS

-- 1) profiles (optional, for display name)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz default now()
);

-- 2) rental_data — one row per user, stores full app state as JSONB
-- Keeps App.jsx shape: { tenants: [], payments: {}, settings: {} }
create table if not exists public.rental_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"tenants":[],"payments":{},"settings":{}}'::jsonb,
  updated_at timestamptz default now()
);

-- updated_at trigger
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists rental_data_updated_at on public.rental_data;
create trigger rental_data_updated_at
  before update on public.rental_data
  for each row execute function public.handle_updated_at();

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  insert into public.rental_data (user_id, data)
  values (new.id, '{"tenants":[],"payments":{},"settings":{}}'::jsonb)
  on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- 3) RLS
alter table public.profiles enable row level security;
alter table public.rental_data enable row level security;

drop policy if exists "profiles self" on public.profiles;
create policy "profiles self" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "rental_data self" on public.rental_data;
create policy "rental_data self" on public.rental_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- allow renters (r{phone}@renter.beda-rooms.local) to read admin's rental_data
-- fixes bug where renter sees 0 tenants because data is per-user (src/storage.js:26, src/App.jsx:503)
drop policy if exists "rental_data renter read admin" on public.rental_data;
create policy "rental_data renter read admin" on public.rental_data
  for select using (
    auth.uid() = user_id
    or (
      (auth.jwt() ->> 'email') like '%@renter.beda-rooms.local'
      and user_id = (select id from auth.users where email = 'bedarooms@gmail.com' limit 1)
    )
  );

-- 4) Optional: normalized tables if you later want SQL queries
-- Uncomment if you prefer rows per tenant/payment instead of JSON blob
-- create table if not exists public.tenants (
--   id text primary key,
--   user_id uuid references auth.users(id) on delete cascade not null,
--   data jsonb not null,
--   created_at timestamptz default now()
-- );
-- alter table public.tenants enable row level security;
-- create policy "tenants self" on public.tenants for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
