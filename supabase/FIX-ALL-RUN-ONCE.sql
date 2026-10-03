-- BeDa Rooms — ONE script that unblocks cloud sync.
-- Copy ALL of this into Supabase Dashboard → SQL Editor → New query → Run.
-- Fixes BOTH errors:
--   1) "permission denied for table rental_data" (app can never read/write)
--   2) "permission denied for table users" (policy reads auth.users directly)
-- Safe to re-run. The 3 VERIFY queries at the end must return rows, no red errors.

-- ---------- 1) Grants: let the app reach the tables ----------
-- (Tables made via raw SQL get no role grants by default, so every
-- read/write is rejected BEFORE row-level security is even checked.
-- RLS policies still decide WHICH rows each user may touch.)
grant all on public.rental_data to anon, authenticated;
grant all on public.profiles to anon, authenticated;
grant all on public.contract_signatures to anon, authenticated;

-- ---------- 2) Admin lookup as a privileged function ----------
-- (The renter policy must find the admin's account id. A raw subquery on
-- auth.users fails for all app roles, so the lookup lives in this
-- SECURITY DEFINER function instead, which runs with owner rights.)
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

-- ---------- 3) VERIFY (must return rows, no errors) ----------
select tablename, grantee
from information_schema.role_table_grants
where table_schema = 'public'
  and tablename = 'rental_data'
  and grantee in ('anon', 'authenticated');

select proname as function_name from pg_proc
where proname = 'admin_user_id';

select policyname from pg_policies
where schemaname = 'public' and tablename = 'rental_data';
