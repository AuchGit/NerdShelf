-- scripts/signup-fix-player-name.sql
-- =====================================================================
-- FIX: Signup 500 — "new row for relation profiles violates check
--      constraint profiles_player_name_length"
--
-- Root cause:
--   public.handle_new_user() is wired to auth.users via on_auth_user_created
--   trigger. On signup it inserts a row into public.profiles with NULL or
--   empty player_name. The CHECK constraint `profiles_player_name_length`
--   (≥ 2 chars) rejects this insert → the whole auth.users INSERT
--   transaction aborts → API returns 500.
--
-- Fix (this script):
--   Rewrite handle_new_user() so it reads `player_name` from the auth
--   raw_user_meta_data JSON that the client now passes via
--   `signUp({ options: { data: { player_name } } })`. The client patch
--   is in src/core/auth/LoginPage.jsx — both pieces need to be in place.
--
--   • If the metadata has a usable player_name, INSERT with it
--   • If not (legacy clients, password reset, etc.), INSERT a safe
--     placeholder ("Player_<short-id>") so the CHECK constraint passes
--     and the user can rename via the profile editor later
--
-- Idempotent — re-creates the function; safe to re-run.
-- Apply in Supabase Dashboard → SQL Editor.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player_name text;
begin
  -- Bevorzugt: client hat player_name in den Auth-Metadaten gesetzt
  -- (über supabase.auth.signUp({ options: { data: { player_name } } })).
  v_player_name := nullif(trim(coalesce(
    NEW.raw_user_meta_data ->> 'player_name',
    NEW.raw_user_meta_data ->> 'playerName',
    NEW.raw_user_meta_data ->> 'name'
  )), '');

  -- Fallback wenn die Metadaten leer sind (älterer Client, OAuth-Provider,
  -- etc.): generiere einen Platzhalter aus den ersten Zeichen der user-id.
  -- Erfüllt die CHECK-Constraint (≥ 2 Zeichen) und kann später vom User
  -- über den Profile-Editor umbenannt werden.
  if v_player_name is null or length(v_player_name) < 2 then
    v_player_name := 'Player_' || substr(NEW.id::text, 1, 8);
  elsif length(v_player_name) > 50 then
    v_player_name := substr(v_player_name, 1, 50);
  end if;

  insert into public.profiles (id, player_name)
  values (NEW.id, v_player_name)
  on conflict (id) do update set
    player_name = excluded.player_name
    where public.profiles.player_name is null
       or length(public.profiles.player_name) < 2;

  return NEW;
end;
$$;

-- Lock down execute (mirrors scripts/supabase-warnings-fix.sql).
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Ensure the trigger is wired. Supabase usually creates this at project
-- init; the IF NOT EXISTS guard keeps the script idempotent.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'on_auth_user_created'
      and tgrelid = 'auth.users'::regclass
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end $$;

-- Sanity check
do $$
declare
  v_name text;
begin
  raise notice '=== signup-fix-player-name applied ===';
  raise notice 'handle_new_user() now reads player_name from';
  raise notice 'raw_user_meta_data->>player_name (with playerName + name';
  raise notice 'fallbacks). Empty metadata → Player_<id8> placeholder.';
  raise notice '';
  raise notice 'Client-side, ensure src/core/auth/LoginPage.jsx passes';
  raise notice 'player_name in supabase.auth.signUp options.data.';
end $$;
