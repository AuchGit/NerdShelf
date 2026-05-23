-- scripts/wh40k-schema.sql
--
-- Supabase migration for the Warhammer 40K feature.
--
-- Apply via the Supabase SQL editor (or `supabase db push`). Each statement
-- is idempotent so re-running is safe.
--
-- History:
--   • Originally this script also created cross-domain
--     `nerdshelf_favorites` / `nerdshelf_inventory` tables that were shared
--     between MTG and WH40K via a `domain` column. That design was later
--     split into per-domain tables — see scripts/split-nerdshelf-tables.sql
--     which migrates data into mtg_favorites / wh40k_favorites /
--     mtg_inventory / wh40k_inventory and drops the legacy tables.
--   • This file now only owns the wh40k_armies table + its share_token
--     column. Favorites/inventory live in their own per-domain tables.

-- ─────────────────── armies ───────────────────
create table if not exists wh40k_armies (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null default 'Unbenannte Armee',
  faction     text,
  detachment  text,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists wh40k_armies_user_id_idx on wh40k_armies(user_id);

alter table wh40k_armies enable row level security;

drop policy if exists "wh40k_armies owner select" on wh40k_armies;
create policy "wh40k_armies owner select" on wh40k_armies
  for select using (auth.uid() = user_id);

drop policy if exists "wh40k_armies owner insert" on wh40k_armies;
create policy "wh40k_armies owner insert" on wh40k_armies
  for insert with check (auth.uid() = user_id);

drop policy if exists "wh40k_armies owner update" on wh40k_armies;
create policy "wh40k_armies owner update" on wh40k_armies
  for update using (auth.uid() = user_id);

drop policy if exists "wh40k_armies owner delete" on wh40k_armies;
create policy "wh40k_armies owner delete" on wh40k_armies
  for delete using (auth.uid() = user_id);

-- ─────────────────── share tokens ───────────────────
--
-- Every user-owned entity (MTG deck, WH40K army, DnD character) carries a
-- short opaque token alongside its internal UUID. The token is the public
-- identity used for exports, sharing, and cross-user imports.
--
-- Generation happens client-side (src/shared/tokens/shareToken.js). New
-- rows always get a token; existing rows are back-filled on next save.
--
-- This block is idempotent — re-running it on a DB that already has the
-- columns is a no-op.

alter table mtg_decks       add column if not exists share_token text;
alter table wh40k_armies    add column if not exists share_token text;

-- After the dnd-campaigns-schema.sql migration the table is `dnd_characters`;
-- older deployments still on `characters` get the same column there.
do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'dnd_characters'
  ) then
    execute 'alter table public.dnd_characters add column if not exists share_token text';
  elsif exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'characters'
  ) then
    execute 'alter table public.characters add column if not exists share_token text';
  end if;
end $$;

-- Per-table uniqueness, scoped to non-null values so we don't choke on
-- the back-fill window where some rows are still NULL.
create unique index if not exists mtg_decks_share_token_uniq
  on mtg_decks(share_token) where share_token is not null;
create unique index if not exists wh40k_armies_share_token_uniq
  on wh40k_armies(share_token) where share_token is not null;

do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'dnd_characters'
  ) then
    execute 'create unique index if not exists dnd_characters_share_token_uniq on public.dnd_characters(share_token) where share_token is not null';
  end if;
end $$;
