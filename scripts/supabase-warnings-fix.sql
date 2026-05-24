-- scripts/supabase-warnings-fix.sql
-- =====================================================================
-- Hardening pass for Supabase database-linter warnings.
--
-- This script addresses three classes of warnings flagged by the
-- Supabase linter (running https://supabase.com/dashboard/.../advisors):
--
--   1. function_search_path_mutable              (3 functions)
--      → ALTER ... SET search_path = public, pg_temp
--   2. anon_security_definer_function_executable (14 functions)
--      → REVOKE EXECUTE FROM anon (and from authenticated for triggers)
--   3. authenticated_security_definer_function_executable (14 functions)
--      → REVOKE for trigger functions (they're called by triggers, not RPC)
--
-- The 4th warning, `auth_leaked_password_protection`, is a dashboard
-- toggle: Supabase Dashboard → Authentication → Settings →
-- "Leaked password protection". Can't be flipped via SQL.
--
-- Why this is safe to apply:
--
--   • Setting `search_path` on a function does not change its behavior —
--     it just locks the resolution order so a malicious session can't
--     trick the function into hitting a shadow schema's tables.
--   • Trigger functions in Postgres are invoked by the trigger
--     mechanism itself, which does not check EXECUTE on the function
--     for the user who fires the trigger. Revoking EXECUTE from anon /
--     authenticated removes the unintended `POST /rest/v1/rpc/...` path
--     without affecting the trigger.
--   • RLS-helper functions (`dnd_is_campaign_gm`, etc.) are SECURITY
--     DEFINER specifically so they can bypass RLS during policy
--     evaluation; the policies call them on behalf of the authenticated
--     user, so authenticated still needs EXECUTE. We only revoke from
--     anon (no signed-in role → no use case).
--   • Real RPCs (`dnd_join_campaign`, `dnd_patch_combat_state`,
--     `lookup_share_token`, `is_admin`, the admin-tool functions) are
--     called by the JS layer with the authenticated key — we keep
--     EXECUTE for authenticated, revoke from anon.
--
-- Idempotent — safe to re-run. Apply in the Supabase SQL editor.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. Lock search_path on the three flagged trigger functions
-- ─────────────────────────────────────────────────────────────────────
-- These are all trigger functions (no arguments, return trigger) so
-- the signatures are unambiguous.

alter function public.mtg_match_touch_updated_at() set search_path = public, pg_temp;
alter function public.mint_share_token()          set search_path = public, pg_temp;
alter function public.ensure_share_token()        set search_path = public, pg_temp;


-- ─────────────────────────────────────────────────────────────────────
-- 2. Trigger functions — revoke EXECUTE from anon + authenticated
-- ─────────────────────────────────────────────────────────────────────
-- These functions are run by triggers internally; they do not need
-- (and never needed) a public RPC surface. PostgREST exposes any
-- SECURITY DEFINER function to whatever role has EXECUTE.

revoke execute on function public.mtg_match_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.mint_share_token()           from public, anon, authenticated;
revoke execute on function public.ensure_share_token()         from public, anon, authenticated;
revoke execute on function public.dnd_imports_set_owner()      from public, anon, authenticated;
revoke execute on function public.mtg_imports_set_owner()      from public, anon, authenticated;
revoke execute on function public.wh40k_imports_set_owner()    from public, anon, authenticated;

-- handle_new_user fires on auth.users INSERT — wired by Supabase Auth
-- itself, never called from the API. Revoke from both roles.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public' and p.proname = 'handle_new_user'
  ) then
    revoke execute on function public.handle_new_user() from public, anon, authenticated;
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────────────
-- 3. RLS-helper functions — revoke EXECUTE from anon only
-- ─────────────────────────────────────────────────────────────────────
-- These are SECURITY DEFINER so policies can call them without hitting
-- the RLS recursion that bare table queries inside a policy would. The
-- policy itself runs as `authenticated`, so authenticated MUST keep
-- EXECUTE for the policy chain to work. Anon has no need — no signed-
-- in identity, no policy to satisfy.

revoke execute on function public.dnd_gm_can_see_character(bigint) from public, anon;
revoke execute on function public.dnd_is_campaign_gm(uuid)         from public, anon;
revoke execute on function public.dnd_is_campaign_member(uuid)     from public, anon;
-- Re-grant explicitly so we leave a definitive `authenticated` grant
-- behind (in case PUBLIC was the only grant before).
grant execute on function public.dnd_gm_can_see_character(bigint) to authenticated;
grant execute on function public.dnd_is_campaign_gm(uuid)         to authenticated;
grant execute on function public.dnd_is_campaign_member(uuid)     to authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 4. Real RPCs — revoke EXECUTE from anon, ensure authenticated grant
-- ─────────────────────────────────────────────────────────────────────
-- These are the functions the JS layer calls via `supabase.rpc(...)`.
-- They expect a signed-in user (use auth.uid() internally), so anon
-- access is unsafe AND non-functional.

revoke execute on function public.dnd_join_campaign(text, bigint, text, jsonb) from public, anon;
revoke execute on function public.dnd_patch_combat_state(bigint, jsonb)        from public, anon;
revoke execute on function public.lookup_share_token(text)                     from public, anon;

grant execute on function public.dnd_join_campaign(text, bigint, text, jsonb) to authenticated;
grant execute on function public.dnd_patch_combat_state(bigint, jsonb)        to authenticated;
grant execute on function public.lookup_share_token(text)                     to authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 5. Admin-tool RPCs — revoke from anon, keep authenticated
-- ─────────────────────────────────────────────────────────────────────
-- The _reference admin tool checks `is_admin()` client-side and gates
-- pages with a RequireAdmin guard. The DB-level grant only opens the
-- pipe; the actual admin check stays in the JS / RLS layer.

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public' and p.proname = 'is_admin'
  ) then
    revoke execute on function public.is_admin() from public, anon;
    grant  execute on function public.is_admin() to authenticated;
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public' and p.proname = 'get_public_tables'
  ) then
    revoke execute on function public.get_public_tables() from public, anon;
    grant  execute on function public.get_public_tables() to authenticated;
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public' and p.proname = 'get_table_row_count'
  ) then
    revoke execute on function public.get_table_row_count(text) from public, anon;
    grant  execute on function public.get_table_row_count(text) to authenticated;
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon;
    grant  execute on function public.rls_auto_enable() to authenticated;
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────────────
-- Sanity report
-- ─────────────────────────────────────────────────────────────────────
do $$
declare
  v_total int;
begin
  select count(*) into v_total
    from pg_proc p
    join pg_namespace n on p.pronamespace = n.oid
   where n.nspname = 'public' and p.prosecdef = true;

  raise notice '=== supabase-warnings-fix applied ===';
  raise notice 'SECURITY DEFINER functions in public schema: %', v_total;
  raise notice 'Trigger fns: anon + authenticated revoked';
  raise notice 'RLS helpers + RPCs: anon revoked, authenticated kept';
  raise notice 'Manual step: enable "Leaked password protection" in';
  raise notice '             Supabase Dashboard → Auth → Settings.';
end $$;
