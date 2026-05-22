-- scripts/dnd-campaigns-schema.sql
-- =====================================================================
-- D&D Campaigns + shared Calendar
-- =====================================================================
-- Adds the Campaigns feature: campaigns, memberships, events.
-- ALSO renames `characters` -> `dnd_characters` so every D&D table shares
-- the `dnd_` prefix.
--
-- Idempotent — safe to re-run. Apply in the Supabase SQL editor.
--
-- IMPORTANT: deploy the matching app build together with this migration.
-- The old build queries `characters`; the new build queries
-- `dnd_characters`. Running this without the new build (or vice versa)
-- breaks the character list until both sides match.
--
-- Depends on: share-token-trigger.sql, nerdshelf-imports-schema.sql
-- (their policies / triggers move with the table automatically on rename).
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 0. Rename characters -> dnd_characters
--    Indexes, constraints, RLS policies and triggers follow the table
--    automatically — no need to recreate them.
-- ─────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'characters')
     and not exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'dnd_characters')
  then
    alter table public.characters rename to dnd_characters;
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ─────────────────────────────────────────────────────────────────────

-- A campaign is owned (run) by exactly one game master.
create table if not exists public.dnd_campaigns (
  id          uuid primary key default gen_random_uuid(),
  gm_id       uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text default '',
  image       text,                                  -- optional banner (data URL)
  join_token  text not null unique,                  -- short code players type to join
  created_at  timestamptz not null default now()
);
create index if not exists dnd_campaigns_gm_idx    on public.dnd_campaigns(gm_id);
create index if not exists dnd_campaigns_token_idx on public.dnd_campaigns(join_token);

-- One row per (campaign, character). `card` is a denormalized snapshot of
-- the character's dashboard card (name, portrait, class summary, level,
-- edition) so players can see each other WITHOUT read access to the full
-- character `data`. `player_name` is denormalized for grouping.
create table if not exists public.dnd_campaign_members (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.dnd_campaigns(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  character_id bigint not null references public.dnd_characters(id) on delete cascade,
  player_name  text default '',
  card         jsonb not null default '{}'::jsonb,
  joined_at    timestamptz not null default now(),
  unique (campaign_id, character_id)
);
create index if not exists dnd_members_campaign_idx on public.dnd_campaign_members(campaign_id);
create index if not exists dnd_members_user_idx     on public.dnd_campaign_members(user_id);

-- Calendar events. Created by the GM, visible to every campaign member.
create table if not exists public.dnd_events (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  title       text not null,
  description text default '',
  location    text default '',
  starts_at   timestamptz not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists dnd_events_campaign_idx on public.dnd_events(campaign_id);
create index if not exists dnd_events_starts_idx   on public.dnd_events(starts_at);


-- ─────────────────────────────────────────────────────────────────────
-- 2. SECURITY DEFINER helpers
--    These bypass RLS when checking membership / GM status, which avoids
--    the "infinite recursion detected in policy" error you get when a
--    policy on table A selects from table B whose policy selects from A.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.dnd_is_campaign_gm(p_campaign uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.dnd_campaigns
    where id = p_campaign and gm_id = auth.uid()
  );
$$;

create or replace function public.dnd_is_campaign_member(p_campaign uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.dnd_campaign_members
    where campaign_id = p_campaign and user_id = auth.uid()
  );
$$;

-- True if the current user is the GM of any campaign the character belongs
-- to — used so a GM can open / export (but not edit) member characters.
create or replace function public.dnd_gm_can_see_character(p_character bigint)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.dnd_campaign_members m
    join public.dnd_campaigns c on c.id = m.campaign_id
    where m.character_id = p_character and c.gm_id = auth.uid()
  );
$$;


-- ─────────────────────────────────────────────────────────────────────
-- 3. Row Level Security
-- ─────────────────────────────────────────────────────────────────────

alter table public.dnd_campaigns        enable row level security;
alter table public.dnd_campaign_members enable row level security;
alter table public.dnd_events           enable row level security;

-- ── dnd_campaigns ──────────────────────────────────────────
drop policy if exists dnd_campaigns_select on public.dnd_campaigns;
create policy dnd_campaigns_select on public.dnd_campaigns
  for select to authenticated
  using (gm_id = auth.uid() or public.dnd_is_campaign_member(id));

drop policy if exists dnd_campaigns_insert on public.dnd_campaigns;
create policy dnd_campaigns_insert on public.dnd_campaigns
  for insert to authenticated
  with check (gm_id = auth.uid());

drop policy if exists dnd_campaigns_update on public.dnd_campaigns;
create policy dnd_campaigns_update on public.dnd_campaigns
  for update to authenticated
  using (gm_id = auth.uid()) with check (gm_id = auth.uid());

drop policy if exists dnd_campaigns_delete on public.dnd_campaigns;
create policy dnd_campaigns_delete on public.dnd_campaigns
  for delete to authenticated
  using (gm_id = auth.uid());

-- ── dnd_campaign_members ───────────────────────────────────
-- A member sees every other member of the same campaign (their cards);
-- the GM sees all members of campaigns they run.
drop policy if exists dnd_members_select on public.dnd_campaign_members;
create policy dnd_members_select on public.dnd_campaign_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.dnd_is_campaign_gm(campaign_id)
    or public.dnd_is_campaign_member(campaign_id)
  );

-- Direct self-join is allowed; the join RPC below is the normal path.
drop policy if exists dnd_members_insert on public.dnd_campaign_members;
create policy dnd_members_insert on public.dnd_campaign_members
  for insert to authenticated
  with check (user_id = auth.uid());

-- A player keeps their own card snapshot up to date.
drop policy if exists dnd_members_update on public.dnd_campaign_members;
create policy dnd_members_update on public.dnd_campaign_members
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A player can leave; the GM can remove anyone.
drop policy if exists dnd_members_delete on public.dnd_campaign_members;
create policy dnd_members_delete on public.dnd_campaign_members
  for delete to authenticated
  using (user_id = auth.uid() or public.dnd_is_campaign_gm(campaign_id));

-- ── dnd_events ─────────────────────────────────────────────
drop policy if exists dnd_events_select on public.dnd_events;
create policy dnd_events_select on public.dnd_events
  for select to authenticated
  using (
    public.dnd_is_campaign_gm(campaign_id)
    or public.dnd_is_campaign_member(campaign_id)
  );

drop policy if exists dnd_events_insert on public.dnd_events;
create policy dnd_events_insert on public.dnd_events
  for insert to authenticated
  with check (public.dnd_is_campaign_gm(campaign_id));

drop policy if exists dnd_events_update on public.dnd_events;
create policy dnd_events_update on public.dnd_events
  for update to authenticated
  using (public.dnd_is_campaign_gm(campaign_id))
  with check (public.dnd_is_campaign_gm(campaign_id));

drop policy if exists dnd_events_delete on public.dnd_events;
create policy dnd_events_delete on public.dnd_events
  for delete to authenticated
  using (public.dnd_is_campaign_gm(campaign_id));

-- ── dnd_characters: let the GM read member characters ──────
-- Owners keep their existing policies; this only ADDS read access for a
-- campaign's GM (open sheet read-only + Foundry export). No write access
-- is granted, so the GM can never edit a player's character.
drop policy if exists dnd_characters_gm_select on public.dnd_characters;
create policy dnd_characters_gm_select on public.dnd_characters
  for select to authenticated
  using (public.dnd_gm_can_see_character(id));


-- ─────────────────────────────────────────────────────────────────────
-- 4. Join RPC
--    Looks up a campaign by its join token, verifies the character belongs
--    to the caller, and inserts (or refreshes) the membership. The client
--    passes the card snapshot + player name it already has in memory.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.dnd_join_campaign(
  p_token        text,
  p_character_id bigint,
  p_player_name  text,
  p_card         jsonb
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_campaign uuid;
begin
  select id into v_campaign
  from public.dnd_campaigns
  where upper(join_token) = upper(trim(p_token));

  if v_campaign is null then
    raise exception 'CAMPAIGN_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.dnd_characters
    where id = p_character_id and user_id = auth.uid()
  ) then
    raise exception 'CHARACTER_NOT_OWNED';
  end if;

  insert into public.dnd_campaign_members
        (campaign_id, user_id, character_id, player_name, card)
  values (v_campaign, auth.uid(), p_character_id,
          coalesce(p_player_name, ''), coalesce(p_card, '{}'::jsonb))
  on conflict (campaign_id, character_id)
  do update set player_name = excluded.player_name,
                card        = excluded.card;

  return v_campaign;
end;
$$;

grant execute on function public.dnd_join_campaign(text, bigint, text, jsonb) to authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 5. Realtime publication
--    Add dnd_events to the supabase_realtime publication so connected
--    clients receive INSERT / UPDATE / DELETE pushes. The calendar
--    notification badge relies on this to update without polling.
-- ─────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dnd_events'
     )
  then
    execute 'alter publication supabase_realtime add table public.dnd_events';
  end if;
end $$;
