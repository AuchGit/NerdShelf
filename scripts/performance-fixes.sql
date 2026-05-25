-- scripts/performance-fixes.sql
-- =====================================================================
-- Performance pass: fixes the Supabase RLS hot-path that causes the app
-- to slow down with 2+ concurrent users.
--
-- Three classes of fix, in order of impact:
--
--   1. `auth.uid()` wrap. The Supabase docs flag bare `auth.uid()` in
--      a policy USING / WITH CHECK clause as a hot-path anti-pattern:
--      Postgres re-evaluates the function PER ROW. Wrapping it as
--      `(select auth.uid())` turns it into an initplan that is run
--      ONCE per query. This is the single biggest win — every policy
--      benefits.
--
--   2. Composite indexes on the imports tables. The profiles RLS
--      policy does `WHERE user_id = (current user) AND source_owner_id = ...`
--      against each imports table on every profile read. Only `user_id`
--      was indexed; the composite `(user_id, source_owner_id)` lets the
--      EXISTS subquery become an index-only scan. Same idea on
--      `dnd_campaign_members(character_id)` so the GM-can-see-character
--      helper doesn't seq-scan member rows.
--
--   3. `get_player_names` RPC. The profiles RLS policy is structurally
--      expensive (UNION across three imports tables on every read). The
--      app only needs profile rows to display a player's `player_name`,
--      so we move that read path to a SECURITY DEFINER RPC that bypasses
--      RLS entirely and returns just (id, player_name) for a list of
--      ids. The policy stays in place for safety, but the hot path no
--      longer triggers it.
--
-- Idempotent — safe to re-run. Apply via Supabase SQL editor.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. Composite indexes used by the RLS policies
-- ─────────────────────────────────────────────────────────────────────

-- Imports → profiles cross-lookup: every profile read consults all three
-- tables looking for "I (auth.uid()) have an import row whose source_owner_id
-- matches this profile's id". Composite index gives a 1-page lookup.
create index if not exists mtg_imports_user_owner_idx
  on public.mtg_imports   (user_id, source_owner_id);
create index if not exists wh40k_imports_user_owner_idx
  on public.wh40k_imports (user_id, source_owner_id);
create index if not exists dnd_imports_user_owner_idx
  on public.dnd_imports   (user_id, source_owner_id);

-- GM-can-see-character helper joins dnd_campaign_members on character_id
-- and dnd_campaigns on id. Only campaign_id and user_id were indexed on
-- the members table — character_id was a seq scan per character.
create index if not exists dnd_members_character_idx
  on public.dnd_campaign_members (character_id);


-- ─────────────────────────────────────────────────────────────────────
-- 2. Rewrite every policy that uses `auth.uid()` so the call is wrapped
--    in (select auth.uid()). Same behaviour, but evaluated once per
--    query instead of once per row.
-- ─────────────────────────────────────────────────────────────────────

-- ── wh40k_armies ───────────────────────────────────────────
drop policy if exists "wh40k_armies owner select" on public.wh40k_armies;
create policy "wh40k_armies owner select" on public.wh40k_armies
  for select using ((select auth.uid()) = user_id);

drop policy if exists "wh40k_armies owner insert" on public.wh40k_armies;
create policy "wh40k_armies owner insert" on public.wh40k_armies
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "wh40k_armies owner update" on public.wh40k_armies;
create policy "wh40k_armies owner update" on public.wh40k_armies
  for update using ((select auth.uid()) = user_id);

drop policy if exists "wh40k_armies owner delete" on public.wh40k_armies;
create policy "wh40k_armies owner delete" on public.wh40k_armies
  for delete using ((select auth.uid()) = user_id);

-- ── wh40k_squads ───────────────────────────────────────────
drop policy if exists "wh40k_squads owner select" on public.wh40k_squads;
create policy "wh40k_squads owner select" on public.wh40k_squads
  for select using ((select auth.uid()) = user_id);

drop policy if exists "wh40k_squads owner insert" on public.wh40k_squads;
create policy "wh40k_squads owner insert" on public.wh40k_squads
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "wh40k_squads owner update" on public.wh40k_squads;
create policy "wh40k_squads owner update" on public.wh40k_squads
  for update using ((select auth.uid()) = user_id);

drop policy if exists "wh40k_squads owner delete" on public.wh40k_squads;
create policy "wh40k_squads owner delete" on public.wh40k_squads
  for delete using ((select auth.uid()) = user_id);

-- ── wh40k_favorites ────────────────────────────────────────
drop policy if exists "wh40k_favorites owner select" on public.wh40k_favorites;
create policy "wh40k_favorites owner select" on public.wh40k_favorites
  for select using ((select auth.uid()) = user_id);

drop policy if exists "wh40k_favorites owner insert" on public.wh40k_favorites;
create policy "wh40k_favorites owner insert" on public.wh40k_favorites
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "wh40k_favorites owner delete" on public.wh40k_favorites;
create policy "wh40k_favorites owner delete" on public.wh40k_favorites
  for delete using ((select auth.uid()) = user_id);

-- ── mtg_inventory ──────────────────────────────────────────
drop policy if exists "mtg_inventory owner select" on public.mtg_inventory;
create policy "mtg_inventory owner select" on public.mtg_inventory
  for select using ((select auth.uid()) = user_id);

drop policy if exists "mtg_inventory owner insert" on public.mtg_inventory;
create policy "mtg_inventory owner insert" on public.mtg_inventory
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "mtg_inventory owner update" on public.mtg_inventory;
create policy "mtg_inventory owner update" on public.mtg_inventory
  for update using ((select auth.uid()) = user_id);

drop policy if exists "mtg_inventory owner delete" on public.mtg_inventory;
create policy "mtg_inventory owner delete" on public.mtg_inventory
  for delete using ((select auth.uid()) = user_id);

-- ── wh40k_inventory ────────────────────────────────────────
drop policy if exists "wh40k_inventory owner select" on public.wh40k_inventory;
create policy "wh40k_inventory owner select" on public.wh40k_inventory
  for select using ((select auth.uid()) = user_id);

drop policy if exists "wh40k_inventory owner insert" on public.wh40k_inventory;
create policy "wh40k_inventory owner insert" on public.wh40k_inventory
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "wh40k_inventory owner update" on public.wh40k_inventory;
create policy "wh40k_inventory owner update" on public.wh40k_inventory
  for update using ((select auth.uid()) = user_id);

drop policy if exists "wh40k_inventory owner delete" on public.wh40k_inventory;
create policy "wh40k_inventory owner delete" on public.wh40k_inventory
  for delete using ((select auth.uid()) = user_id);

-- ── *_imports owner policies (three tables, identical shape) ──
do $$
declare t text;
begin
  foreach t in array array['mtg_imports', 'wh40k_imports', 'dnd_imports'] loop
    execute format('drop policy if exists "%1$s owner select" on public.%1$s', t);
    execute format(
      'create policy "%1$s owner select" on public.%1$s
         for select using ((select auth.uid()) = user_id)', t);

    execute format('drop policy if exists "%1$s owner insert" on public.%1$s', t);
    execute format(
      'create policy "%1$s owner insert" on public.%1$s
         for insert with check ((select auth.uid()) = user_id)', t);

    execute format('drop policy if exists "%1$s owner delete" on public.%1$s', t);
    execute format(
      'create policy "%1$s owner delete" on public.%1$s
         for delete using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- ── mtg_matches ────────────────────────────────────────────
drop policy if exists "mtg_matches authenticated select" on public.mtg_matches;
create policy "mtg_matches authenticated select" on public.mtg_matches
  for select using ((select auth.uid()) is not null);

drop policy if exists "mtg_matches creator insert" on public.mtg_matches;
create policy "mtg_matches creator insert" on public.mtg_matches
  for insert with check ((select auth.uid()) = created_by);

drop policy if exists "mtg_matches creator update" on public.mtg_matches;
create policy "mtg_matches creator update" on public.mtg_matches
  for update using ((select auth.uid()) = created_by);

drop policy if exists "mtg_matches creator delete" on public.mtg_matches;
create policy "mtg_matches creator delete" on public.mtg_matches
  for delete using ((select auth.uid()) = created_by);

-- ── mtg_match_players ──────────────────────────────────────
drop policy if exists "mtg_match_players authenticated select" on public.mtg_match_players;
create policy "mtg_match_players authenticated select" on public.mtg_match_players
  for select using ((select auth.uid()) is not null);

drop policy if exists "mtg_match_players self insert" on public.mtg_match_players;
create policy "mtg_match_players self insert" on public.mtg_match_players
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "mtg_match_players self update" on public.mtg_match_players;
create policy "mtg_match_players self update" on public.mtg_match_players
  for update using ((select auth.uid()) = user_id);

drop policy if exists "mtg_match_players self delete" on public.mtg_match_players;
create policy "mtg_match_players self delete" on public.mtg_match_players
  for delete using (
    (select auth.uid()) = user_id
    or (select auth.uid()) = (select created_by from public.mtg_matches m where m.id = match_id)
  );

-- ── dnd_campaigns ──────────────────────────────────────────
drop policy if exists dnd_campaigns_select on public.dnd_campaigns;
create policy dnd_campaigns_select on public.dnd_campaigns
  for select to authenticated
  using (gm_id = (select auth.uid()) or public.dnd_is_campaign_member(id));

drop policy if exists dnd_campaigns_insert on public.dnd_campaigns;
create policy dnd_campaigns_insert on public.dnd_campaigns
  for insert to authenticated
  with check (gm_id = (select auth.uid()));

drop policy if exists dnd_campaigns_update on public.dnd_campaigns;
create policy dnd_campaigns_update on public.dnd_campaigns
  for update to authenticated
  using (gm_id = (select auth.uid())) with check (gm_id = (select auth.uid()));

drop policy if exists dnd_campaigns_delete on public.dnd_campaigns;
create policy dnd_campaigns_delete on public.dnd_campaigns
  for delete to authenticated
  using (gm_id = (select auth.uid()));

-- ── dnd_campaign_members ───────────────────────────────────
drop policy if exists dnd_members_select on public.dnd_campaign_members;
create policy dnd_members_select on public.dnd_campaign_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.dnd_is_campaign_gm(campaign_id)
    or public.dnd_is_campaign_member(campaign_id)
  );

drop policy if exists dnd_members_insert on public.dnd_campaign_members;
create policy dnd_members_insert on public.dnd_campaign_members
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists dnd_members_update on public.dnd_campaign_members;
create policy dnd_members_update on public.dnd_campaign_members
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists dnd_members_delete on public.dnd_campaign_members;
create policy dnd_members_delete on public.dnd_campaign_members
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.dnd_is_campaign_gm(campaign_id));

-- (dnd_members_gm_update from dnd-session-schema is parameter-free in its
-- USING/WITH CHECK — only calls the helper function, no bare auth.uid().)

-- ── dnd_events ─────────────────────────────────────────────
-- Already uses helper functions only — no bare auth.uid() to wrap. Skip.

-- ── public-by-import policies on entity tables ─────────────
-- These three policies are hit by every cross-user view (importer reading
-- a friend's deck / army / character). Wrap auth.uid().
drop policy if exists "mtg_decks public via imports" on public.mtg_decks;
create policy "mtg_decks public via imports" on public.mtg_decks
  for select using (
    share_token is not null
    and exists (
      select 1 from public.mtg_imports i
       where i.user_id = (select auth.uid())
         and i.source_token = mtg_decks.share_token
    )
  );

drop policy if exists "wh40k_armies public via imports" on public.wh40k_armies;
create policy "wh40k_armies public via imports" on public.wh40k_armies
  for select using (
    share_token is not null
    and exists (
      select 1 from public.wh40k_imports i
       where i.user_id = (select auth.uid())
         and i.source_token = wh40k_armies.share_token
    )
  );

drop policy if exists "dnd_characters public via imports" on public.dnd_characters;
create policy "dnd_characters public via imports" on public.dnd_characters
  for select using (
    share_token is not null
    and exists (
      select 1 from public.dnd_imports i
       where i.user_id = (select auth.uid())
         and i.source_token = dnd_characters.share_token
    )
  );

-- ── profiles "self select" — cheap own-profile read path ──
-- AuthContext loads the signed-in user's own profile on every mount and
-- on every TOKEN_REFRESHED event. Without an explicit self policy that
-- read would fall through to the expensive "public name via imports"
-- check below (which doesn't even match — you don't import yourself).
-- An additional permissive policy is ORed with existing ones, so this
-- can only widen access, not narrow it.
drop policy if exists "profiles self select" on public.profiles;
create policy "profiles self select" on public.profiles
  for select using ((select auth.uid()) = id);

-- ── profiles "public name via imports" — wrap + use OR/EXISTS ──
-- The UNION ALL form forced Postgres to materialise a result set per
-- profile row before short-circuiting. Three independent EXISTS clauses
-- ORed together short-circuit cleanly (first hit wins) and let the
-- composite indexes added above carry the lookup.
drop policy if exists "profiles public name via imports" on public.profiles;
create policy "profiles public name via imports" on public.profiles
  for select using (
    exists (
      select 1 from public.mtg_imports   i
       where i.user_id = (select auth.uid()) and i.source_owner_id = profiles.id
    )
    or exists (
      select 1 from public.wh40k_imports i
       where i.user_id = (select auth.uid()) and i.source_owner_id = profiles.id
    )
    or exists (
      select 1 from public.dnd_imports   i
       where i.user_id = (select auth.uid()) and i.source_owner_id = profiles.id
    )
  );


-- ─────────────────────────────────────────────────────────────────────
-- 3. get_player_names RPC — bulk profile lookup that bypasses RLS
-- ─────────────────────────────────────────────────────────────────────
-- The app loads other users' `player_name` for the imports dashboards,
-- match HUDs etc. Going through the profiles table triggers the
-- expensive policy above. This SECURITY DEFINER function takes a list
-- of user ids and returns just (id, player_name), filtered to ids the
-- caller has actually imported something from — same authorisation
-- rule as the policy, but executed once per RPC call instead of once
-- per profile row.

drop function if exists public.get_player_names(uuid[]);
create or replace function public.get_player_names(p_user_ids uuid[])
returns table (id uuid, player_name text)
language sql stable security definer set search_path = public as $$
  with caller as (select auth.uid() as uid)
  select p.id, coalesce(p.player_name, '')::text
    from public.profiles p, caller
   where p.id = any(p_user_ids)
     and (
       p.id = caller.uid                                              -- always allow self
       or exists (select 1 from public.mtg_imports   i where i.user_id = caller.uid and i.source_owner_id = p.id)
       or exists (select 1 from public.wh40k_imports i where i.user_id = caller.uid and i.source_owner_id = p.id)
       or exists (select 1 from public.dnd_imports   i where i.user_id = caller.uid and i.source_owner_id = p.id)
     );
$$;

revoke execute on function public.get_player_names(uuid[]) from anon;
grant execute on function public.get_player_names(uuid[]) to authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 4. Sanity report
-- ─────────────────────────────────────────────────────────────────────

do $$
declare
  v_indexes int;
begin
  select count(*) into v_indexes
    from pg_indexes
   where schemaname = 'public'
     and indexname in (
       'mtg_imports_user_owner_idx',
       'wh40k_imports_user_owner_idx',
       'dnd_imports_user_owner_idx',
       'dnd_members_character_idx'
     );
  raise notice '=== performance-fixes applied ===';
  raise notice 'New composite indexes        : % / 4', v_indexes;
  raise notice 'auth.uid() wrap applied to   : wh40k_*, mtg_*, dnd_*, imports, favorites, inventory, profiles, match*';
  raise notice 'get_player_names RPC         : ready (use this instead of from(profiles).select for cross-user lookups)';
end $$;
