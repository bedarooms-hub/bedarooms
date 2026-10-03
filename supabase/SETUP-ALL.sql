-- ============================================================
-- BeDa Rooms — COMPLETE Supabase setup in ONE script
-- Run this ONCE in Supabase Dashboard → SQL Editor → New query → Paste → Run
-- Safe to re-run: everything uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- It will NOT touch your existing tables (tenants, payments, rentals, units…)
-- Creates: profiles + rental_data + contract_signatures + renter-ids bucket + RLS
-- Admin: bedarooms@gmail.com (full access)
-- ============================================================

-- ---------- 1) profiles (one row per login user) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz default now()
);

-- ---------- 2) rental_data (the app's backend: tenants/payments/settings as JSON) ----------
-- Tenant objects may include idImagePath (e.g. "09123456789/abc-photo.jpg")
-- Photos themselves live in Storage (renter-ids bucket), never as base64 here.
create table if not exists public.rental_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"tenants":[],"payments":{},"settings":{}}'::jsonb,
  updated_at timestamptz default now()
);

create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists rental_data_updated_at on public.rental_data;
create trigger rental_data_updated_at
  before update on public.rental_data
  for each row execute function public.handle_updated_at();

-- auto-create profile + empty rental_data row on every signup (admin AND renter)
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

-- ---------- 3) RLS for tables ----------
alter table public.profiles enable row level security;
alter table public.rental_data enable row level security;

drop policy if exists "profiles self" on public.profiles;
create policy "profiles self" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "rental_data self" on public.rental_data;
create policy "rental_data self" on public.rental_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Renters (role='renter' in user_metadata, or legacy r{phone}@renter.beda-rooms.local)
-- can READ the admin's row so they see their own tenant record.
drop policy if exists "rental_data renter read admin" on public.rental_data;
create policy "rental_data renter read admin" on public.rental_data
  for select using (
    auth.uid() = user_id
    or (
      (
        (auth.jwt() ->> 'email') like '%@renter.beda-rooms.local'
        or (auth.jwt() -> 'user_metadata' ->> 'role') = 'renter'
      )
      and user_id = (select id from auth.users where email = 'bedarooms@gmail.com' limit 1)
    )
  );

-- ---------- 4) Private Storage bucket: renter-ids (ID photos) ----------
-- Files: renter-ids/<phone-digits>/<tenantId>-<timestamp>-<filename>
insert into storage.buckets (id, name, public)
values ('renter-ids', 'renter-ids', false)
on conflict (id) do nothing;

-- Admin full control over all ID photos
drop policy if exists "renter-ids admin all" on storage.objects;
create policy "renter-ids admin all" on storage.objects
  for all using (
    bucket_id = 'renter-ids'
    and (auth.jwt() ->> 'email') = 'bedarooms@gmail.com'
  )
  with check (
    bucket_id = 'renter-ids'
    and (auth.jwt() ->> 'email') = 'bedarooms@gmail.com'
  );

-- Renter: read ONLY photos inside their own phone folder
drop policy if exists "renter-ids renter read own" on storage.objects;
create policy "renter-ids renter read own" on storage.objects
  for select using (
    bucket_id = 'renter-ids'
    and (
      (auth.jwt() ->> 'email') like '%@renter.beda-rooms.local'
      or (auth.jwt() -> 'user_metadata' ->> 'role') = 'renter'
    )
    and name like ((auth.jwt() -> 'user_metadata' ->> 'phone') || '/%')
  );

-- Renter: upload into their own phone folder
drop policy if exists "renter-ids renter insert own" on storage.objects;
create policy "renter-ids renter insert own" on storage.objects
  for insert with check (
    bucket_id = 'renter-ids'
    and (
      (auth.jwt() ->> 'email') like '%@renter.beda-rooms.local'
      or (auth.jwt() -> 'user_metadata' ->> 'role') = 'renter'
    )
    and name like ((auth.jwt() -> 'user_metadata' ->> 'phone') || '/%')
  );

-- ---------- 5) contract_signatures (electronic signatures) ----------
create table if not exists public.contract_signatures (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  phone text not null default '',
  signer text not null check (signer in ('tenant', 'landlord')),
  name text not null default '',
  image text not null default '',
  signed_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists contract_signatures_tenant_idx on public.contract_signatures (tenant_id);

alter table public.contract_signatures enable row level security;

drop policy if exists "contract_signatures admin all" on public.contract_signatures;
create policy "contract_signatures admin all" on public.contract_signatures
  for all using (
    (auth.jwt() ->> 'email') = 'bedarooms@gmail.com'
  )
  with check (
    (auth.jwt() ->> 'email') = 'bedarooms@gmail.com'
  );

drop policy if exists "contract_signatures renter insert own" on public.contract_signatures;
create policy "contract_signatures renter insert own" on public.contract_signatures
  for insert with check (
    (
      (auth.jwt() ->> 'email') like '%@renter.beda-rooms.local'
      or (auth.jwt() -> 'user_metadata' ->> 'role') = 'renter'
    )
    and signer = 'tenant'
    and phone = (auth.jwt() -> 'user_metadata' ->> 'phone')
  );

drop policy if exists "contract_signatures renter read own" on public.contract_signatures;
create policy "contract_signatures renter read own" on public.contract_signatures
  for select using (
    (
      (auth.jwt() ->> 'email') like '%@renter.beda-rooms.local'
      or (auth.jwt() -> 'user_metadata' ->> 'role') = 'renter'
    )
    and phone = (auth.jwt() -> 'user_metadata' ->> 'phone')
  );

-- ============================================================
-- 6) VERIFY — these 4 queries must return rows (no errors)
-- ============================================================
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('profiles', 'rental_data', 'contract_signatures');

select id, name, public as is_public from storage.buckets
 where id in ('renter-ids', 'tenant-ids');

select policyname from pg_policies
 where schemaname = 'public' and tablename = 'rental_data';

select policyname from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'renter-ids%';
