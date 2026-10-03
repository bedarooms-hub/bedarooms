-- BeDa Rooms — FIX: "permission denied for table users"
-- Run this ONCE in Supabase Dashboard → SQL Editor → New query → Paste → Run.
-- Why: the "rental_data renter read admin" policy contains a subquery on
-- auth.users, which the anon/authenticated roles may never read directly —
-- so EVERY rental_data read (admin AND renter) aborts with
-- "permission denied for table users".
-- Fix: hide the admin lookup inside a SECURITY DEFINER function (runs with the
-- table owner's rights, bypassing the grant check) and point the policy at it.
-- Safe to re-run.

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

-- ---------- VERIFY (must return rows, no errors) ----------
select policyname from pg_policies
  where schemaname = 'public' and tablename = 'rental_data';
select proname, prosecdef from pg_proc
  where pronamespace = 'public'::regnamespace and proname = 'admin_user_id';
