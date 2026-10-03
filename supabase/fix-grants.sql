-- BeDa Rooms — FIX: "permission denied for table rental_data" (empty table, app never syncs)
-- Run this ONCE in Supabase Dashboard → SQL Editor → New query → Paste → Run.
-- Why: tables created via raw SQL get NO grants to the anon/authenticated roles,
-- so PostgREST rejects every read/write BEFORE row-level security is even checked.
-- These GRANTs let the app reach the tables; the RLS policies still decide
-- WHICH rows each user may see (admin sees own row, renter reads admin's row).
-- Safe to re-run.

grant all on public.rental_data to anon, authenticated;
grant all on public.profiles to anon, authenticated;
grant all on public.contract_signatures to anon, authenticated;

-- ---------- VERIFY (must return rows, no errors) ----------
select tablename, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and tablename in ('rental_data', 'profiles', 'contract_signatures')
  and grantee in ('anon', 'authenticated')
order by tablename, grantee;
