-- BeDa Rooms — FULL backend schema for a NEW Supabase project
-- Run this ONCE in Supabase Dashboard → SQL Editor → New query → Paste → Run
-- Creates: profiles + rental_data (JSON blob: tenants/payments/settings) + private Storage bucket renter-ids + RLS
-- Admin: bedarooms@gmail.com (full access). Renters: r{phone}@renter.beda-rooms.local (read admin data + own ID photo only)
--
-- AFTER running:
--   1) Supabase Dashboard → Authentication → Providers → Email → DISABLE "Confirm email" (so renters can sign in immediately)
--   2) Copy Project URL + anon key (Settings → API) into your .env as VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, restart `npm run dev`
--   3) Sign up admin once as bedarooms@gmail.com (or sign in — handle_new_user creates the rental_data row automatically)

-- ============================================================
-- 1) profiles (one row per auth user, for display)
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz default now()
);

-- ============================================================
-- 2) rental_data — one row per user, full app state as JSONB
-- Shape: { tenants: [], payments: {}, settings: {} }
-- Tenant objects may include: idImagePath (e.g. "09123456789/abc-123456-photo.jpg")
-- NEVER store base64 images here — photos live in Storage (renter-ids bucket)
-- ============================================================
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

-- ============================================================
-- 3) RLS for tables
-- ============================================================
alter table public.profiles enable row level security;
alter table public.rental_data enable row level security;

-- Grants (WITHOUT these every read/write fails with
-- "permission denied for table rental_data" before RLS is even checked —
-- tables made via raw SQL get no role grants by default).
-- RLS policies below still control WHICH rows each user may touch.
grant all on public.profiles to anon, authenticated;
grant all on public.rental_data to anon, authenticated;

drop policy if exists "profiles self" on public.profiles;
create policy "profiles self" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "rental_data self" on public.rental_data;
create policy "rental_data self" on public.rental_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Renters sign in with their own email (role='renter' in user_metadata, set at
-- signup) or legacy r{phone}@renter.beda-rooms.local accounts. Either form can
-- READ the admin's rental_data row so they see their own tenant record.
-- Admin email is fixed: bedarooms@gmail.com — change it here if your owner email differs.
-- NOTE: the admin lookup MUST go through public.admin_user_id() (SECURITY
-- DEFINER). A raw subquery on auth.users here makes EVERY rental_data read
-- fail with "permission denied for table users" for all app roles.
create or replace function public.admin_user_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from auth.users where email = 'bedarooms@gmail.com' limit 1
$$;

grant execute on function public.admin_user_id() to anon, authenticated;

drop policy if exists "rental_data renter read admin" on public.rental_data;
create policy "rental_data renter read admin" on public.rental_data
  for select using (
    auth.uid() = user_id
    or (
      (
        (auth.jwt() ->> 'email') like '%@renter.beda-rooms.local'
        or (auth.jwt() -> 'user_metadata' ->> 'role') = 'renter'
      )
      and user_id = public.admin_user_id()
    )
  );

-- ============================================================
-- 4) Private Storage bucket: renter-ids (ID photos)
-- Files stored as: renter-ids/<phone-digits>/<tenantId>-<timestamp>-<filename>
--   e.g. renter-ids/09123456789/abc123-1719876543210-drivers-license.jpg
-- <phone-digits> MUST match auth user_metadata.phone set at renter signup
-- (src/App.jsx sets it via supabase.auth.signUp options.data.phone)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('renter-ids', 'renter-ids', false)
on conflict (id) do nothing;

-- --- Admin (bedarooms@gmail.com): full control over all ID photos ---
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

-- --- Renter: read ONLY photos inside their own phone folder ---
-- e.g. phone 09123456789 can read renter-ids/09123456789/* and nothing else
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

-- --- Renter: upload into their own phone folder (optional, for future self-upload) ---
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

-- NOTE: storage.objects also needs UPDATE/DELETE for renters? No — admin-only.
-- Admin policy above already covers update/delete for bedarooms@gmail.com.

-- ============================================================
-- 5) contract_signatures — electronic signatures for the rental agreement
-- One row per signing event. `image` holds a small canvas PNG dataURL.
-- Admin signs in Contract tab; renter signs in their dashboard (or in person).
-- Renter (own email with role='renter' metadata, or legacy r{phone}@renter.beda-rooms.local)
-- can INSERT as signer='tenant' only for their own phone, and READ signatures tied
-- to their phone (so they can see the landlord's countersignature on their own contract).
-- ============================================================
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

grant all on public.contract_signatures to anon, authenticated;

-- Admin: full control
drop policy if exists "contract_signatures admin all" on public.contract_signatures;
create policy "contract_signatures admin all" on public.contract_signatures
  for all using (
    (auth.jwt() ->> 'email') = 'bedarooms@gmail.com'
  )
  with check (
    (auth.jwt() ->> 'email') = 'bedarooms@gmail.com'
  );

-- Renter: sign (insert) as tenant for their OWN phone only
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

-- Renter: read signatures tied to their OWN phone (own + landlord's countersignature)
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
-- 6) (Optional) normalized tables — leave commented unless you outgrow JSONB
-- ============================================================
-- create table if not exists public.tenants (
--   id text primary key,
--   user_id uuid references auth.users(id) on delete cascade not null,
--   data jsonb not null,
--   created_at timestamptz default now()
-- );
-- alter table public.tenants enable row level security;
-- create policy "tenants self" on public.tenants for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
