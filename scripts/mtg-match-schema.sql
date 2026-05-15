-- scripts/mtg-match-schema.sql
--
-- Supabase migration for the MTG "Match HUD" realtime feature.
--
-- Apply via the Supabase SQL editor (or `supabase db push`). Each statement is
-- idempotent so re-running the script is safe.
--
-- Schema:
--   mtg_matches         — one row per live match. Identified to clients by a
--                         short join_code (uppercase Crockford-style).
--   mtg_match_players   — one row per joined player. Holds the per-player
--                         counters (life, poison, color, deck). Each player
--                         can only edit their own row.
--
-- Realtime:
--   Both tables are added to the supabase_realtime publication so changes
--   stream over Postgres Changes to subscribed clients without polling.
--
-- Row-Level Security:
--   • Any authenticated user can read any match / player row. This is what
--     lets a new player look up a match by its short code and join.
--   • Only the match creator can update / delete the match (life template,
--     status).
--   • A player can only insert / update / delete their own match_players row
--     (auth.uid() = user_id). All other rows are read-only to them.

-- ─────────────────── matches ───────────────────
create table if not exists mtg_matches (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid not null references auth.users(id) on delete cascade,
  join_code       text not null unique,
  starting_life   integer not null default 20,
  status          text not null default 'lobby',  -- 'lobby' | 'live' | 'ended'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists mtg_matches_created_by_idx on mtg_matches(created_by);
create index if not exists mtg_matches_join_code_idx  on mtg_matches(join_code);

alter table mtg_matches enable row level security;

drop policy if exists "mtg_matches authenticated select" on mtg_matches;
create policy "mtg_matches authenticated select" on mtg_matches
  for select using (auth.uid() is not null);

drop policy if exists "mtg_matches creator insert" on mtg_matches;
create policy "mtg_matches creator insert" on mtg_matches
  for insert with check (auth.uid() = created_by);

drop policy if exists "mtg_matches creator update" on mtg_matches;
create policy "mtg_matches creator update" on mtg_matches
  for update using (auth.uid() = created_by);

drop policy if exists "mtg_matches creator delete" on mtg_matches;
create policy "mtg_matches creator delete" on mtg_matches
  for delete using (auth.uid() = created_by);

-- ─────────────────── match players ───────────────────
create table if not exists mtg_match_players (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references mtg_matches(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  player_name     text not null default '',
  deck_id         uuid references mtg_decks(id) on delete set null,
  deck_name       text default '',
  life            integer not null default 20,
  poison          integer not null default 0,
  color           text not null default 'red',
  joined_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A user can only sit at a given match once. If they reload, they reuse
  -- the existing row.
  unique (match_id, user_id)
);

create index if not exists mtg_match_players_match_idx on mtg_match_players(match_id);
create index if not exists mtg_match_players_user_idx  on mtg_match_players(user_id);

alter table mtg_match_players enable row level security;

-- Anyone signed in can see every player row in any match. Without this the
-- HUD couldn't render opponents.
drop policy if exists "mtg_match_players authenticated select" on mtg_match_players;
create policy "mtg_match_players authenticated select" on mtg_match_players
  for select using (auth.uid() is not null);

-- A player can only create their own row.
drop policy if exists "mtg_match_players self insert" on mtg_match_players;
create policy "mtg_match_players self insert" on mtg_match_players
  for insert with check (auth.uid() = user_id);

-- A player can only edit their own row — this is the core "no editing other
-- people's life totals" guarantee.
drop policy if exists "mtg_match_players self update" on mtg_match_players;
create policy "mtg_match_players self update" on mtg_match_players
  for update using (auth.uid() = user_id);

-- A player can leave their own seat. The match creator can also remove
-- anyone (so they can kick a stale ghost row).
drop policy if exists "mtg_match_players self delete" on mtg_match_players;
create policy "mtg_match_players self delete" on mtg_match_players
  for delete using (
    auth.uid() = user_id
    or auth.uid() = (select created_by from mtg_matches m where m.id = match_id)
  );

-- ─────────────────── realtime publication ───────────────────
-- Add both tables to the realtime publication so Postgres Changes events
-- stream to subscribed clients. The DO block makes this idempotent — calling
-- ALTER PUBLICATION twice on the same table would error.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mtg_matches'
  ) then
    execute 'alter publication supabase_realtime add table public.mtg_matches';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mtg_match_players'
  ) then
    execute 'alter publication supabase_realtime add table public.mtg_match_players';
  end if;
end $$;

-- Optional: keep updated_at fresh on row mutations. Cheap, useful for sorting
-- the dashboard list.
create or replace function mtg_match_touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists mtg_matches_touch_updated_at on mtg_matches;
create trigger mtg_matches_touch_updated_at
  before update on mtg_matches
  for each row execute function mtg_match_touch_updated_at();

drop trigger if exists mtg_match_players_touch_updated_at on mtg_match_players;
create trigger mtg_match_players_touch_updated_at
  before update on mtg_match_players
  for each row execute function mtg_match_touch_updated_at();
