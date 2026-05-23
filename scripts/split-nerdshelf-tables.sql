-- scripts/split-nerdshelf-tables.sql
-- =====================================================================
-- Splits the cross-domain helper tables into per-domain tables:
--
--   nerdshelf_favorites  →  mtg_favorites (exists)  +  wh40k_favorites
--   nerdshelf_inventory  →  mtg_inventory           +  wh40k_inventory
--   nerdshelf_imports    →  mtg_imports  +  wh40k_imports  +  dnd_imports
--
-- Data is copied first, then the public-by-import RLS policies on the
-- entity tables are rebuilt against the new per-domain tables, then the
-- old tables and their helpers are dropped.
--
-- The migration is idempotent — re-running is safe. It also tolerates
-- the situation where some of the legacy tables don't exist (clean
-- install).
--
-- Apply via Supabase SQL editor. Depends on:
--   - share-token-trigger.sql      (entity tables have share_token)
--   - dnd-campaigns-schema.sql     (characters → dnd_characters rename)
-- Both have already been applied if the app currently runs.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. NEW TABLES — favorites
-- =====================================================================
-- mtg_favorites already exists with the MTG-native (scryfall_id, card_name)
-- shape — we don't touch it. The shared-hook code that used
-- nerdshelf_favorites for MTG is being routed to mtg_favorites's existing
-- shape (item_id ≡ scryfall_id, item_label ≡ card_name) in the JS layer.
--
-- wh40k_favorites is brand new.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.wh40k_favorites (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  item_id     text not null,
  item_label  text default '',
  created_at  timestamptz not null default now(),
  unique (user_id, item_id)
);
create index if not exists wh40k_favorites_user_idx on public.wh40k_favorites(user_id);

alter table public.wh40k_favorites enable row level security;

drop policy if exists "wh40k_favorites owner select" on public.wh40k_favorites;
create policy "wh40k_favorites owner select" on public.wh40k_favorites
  for select using (auth.uid() = user_id);

drop policy if exists "wh40k_favorites owner insert" on public.wh40k_favorites;
create policy "wh40k_favorites owner insert" on public.wh40k_favorites
  for insert with check (auth.uid() = user_id);

drop policy if exists "wh40k_favorites owner delete" on public.wh40k_favorites;
create policy "wh40k_favorites owner delete" on public.wh40k_favorites
  for delete using (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────
-- 2. NEW TABLES — inventory
-- =====================================================================
-- One row per (user, item) within each domain. mtg_inventory carries a
-- `kind` column because MTG actually uses the inventory table for two
-- distinct purposes: real owned cards ('collection') and manually-added
-- wishlist entries ('wishlist-manual'). Splitting that out into a kind
-- enum is cleaner than keeping a domain marker that lies about its scope.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.mtg_inventory (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  item_id     text not null,
  quantity    integer not null default 1,
  item_label  text default '',
  kind        text not null default 'collection'
              check (kind in ('collection', 'wishlist-manual')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, item_id, kind)
);
create index if not exists mtg_inventory_user_idx on public.mtg_inventory(user_id);
create index if not exists mtg_inventory_user_kind_idx on public.mtg_inventory(user_id, kind);

alter table public.mtg_inventory enable row level security;

drop policy if exists "mtg_inventory owner select" on public.mtg_inventory;
create policy "mtg_inventory owner select" on public.mtg_inventory
  for select using (auth.uid() = user_id);

drop policy if exists "mtg_inventory owner insert" on public.mtg_inventory;
create policy "mtg_inventory owner insert" on public.mtg_inventory
  for insert with check (auth.uid() = user_id);

drop policy if exists "mtg_inventory owner update" on public.mtg_inventory;
create policy "mtg_inventory owner update" on public.mtg_inventory
  for update using (auth.uid() = user_id);

drop policy if exists "mtg_inventory owner delete" on public.mtg_inventory;
create policy "mtg_inventory owner delete" on public.mtg_inventory
  for delete using (auth.uid() = user_id);


create table if not exists public.wh40k_inventory (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  item_id     text not null,
  quantity    integer not null default 1,
  item_label  text default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, item_id)
);
create index if not exists wh40k_inventory_user_idx on public.wh40k_inventory(user_id);

alter table public.wh40k_inventory enable row level security;

drop policy if exists "wh40k_inventory owner select" on public.wh40k_inventory;
create policy "wh40k_inventory owner select" on public.wh40k_inventory
  for select using (auth.uid() = user_id);

drop policy if exists "wh40k_inventory owner insert" on public.wh40k_inventory;
create policy "wh40k_inventory owner insert" on public.wh40k_inventory
  for insert with check (auth.uid() = user_id);

drop policy if exists "wh40k_inventory owner update" on public.wh40k_inventory;
create policy "wh40k_inventory owner update" on public.wh40k_inventory
  for update using (auth.uid() = user_id);

drop policy if exists "wh40k_inventory owner delete" on public.wh40k_inventory;
create policy "wh40k_inventory owner delete" on public.wh40k_inventory
  for delete using (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────
-- 3. NEW TABLES — imports (per domain)
-- =====================================================================
-- Schema mirrors the legacy nerdshelf_imports row shape (minus `domain`)
-- so the JS layer can keep using the same column names.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.mtg_imports (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  source_token    text not null,
  source_id       text,
  source_owner_id uuid,
  imported_at     timestamptz not null default now(),
  unique (user_id, source_token)
);
create index if not exists mtg_imports_user_idx on public.mtg_imports(user_id);

create table if not exists public.wh40k_imports (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  source_token    text not null,
  source_id       text,
  source_owner_id uuid,
  imported_at     timestamptz not null default now(),
  unique (user_id, source_token)
);
create index if not exists wh40k_imports_user_idx on public.wh40k_imports(user_id);

create table if not exists public.dnd_imports (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  source_token    text not null,
  source_id       text,
  source_owner_id uuid,
  imported_at     timestamptz not null default now(),
  unique (user_id, source_token)
);
create index if not exists dnd_imports_user_idx on public.dnd_imports(user_id);

alter table public.mtg_imports   enable row level security;
alter table public.wh40k_imports enable row level security;
alter table public.dnd_imports   enable row level security;

-- ── owner RLS (one block per table — RLS is per-table) ──
do $$
declare t text;
begin
  foreach t in array array['mtg_imports', 'wh40k_imports', 'dnd_imports'] loop
    execute format('drop policy if exists "%1$s owner select" on public.%1$s', t);
    execute format('create policy "%1$s owner select" on public.%1$s for select using (auth.uid() = user_id)', t);

    execute format('drop policy if exists "%1$s owner insert" on public.%1$s', t);
    execute format('create policy "%1$s owner insert" on public.%1$s for insert with check (auth.uid() = user_id)', t);

    execute format('drop policy if exists "%1$s owner delete" on public.%1$s', t);
    execute format('create policy "%1$s owner delete" on public.%1$s for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;

-- ── auto-set source_owner_id trigger (per table) ──
-- The trigger sets source_owner_id by joining against the matching entity
-- table when the client didn't pass one. SECURITY DEFINER so the lookup
-- bypasses RLS during the insert.

create or replace function public.mtg_imports_set_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source_owner_id is null then
    select user_id into new.source_owner_id from public.mtg_decks
    where share_token = new.source_token;
  end if;
  return new;
end $$;
drop trigger if exists mtg_imports_set_owner_trg on public.mtg_imports;
create trigger mtg_imports_set_owner_trg
  before insert on public.mtg_imports
  for each row execute function public.mtg_imports_set_owner();

create or replace function public.wh40k_imports_set_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source_owner_id is null then
    select user_id into new.source_owner_id from public.wh40k_armies
    where share_token = new.source_token;
  end if;
  return new;
end $$;
drop trigger if exists wh40k_imports_set_owner_trg on public.wh40k_imports;
create trigger wh40k_imports_set_owner_trg
  before insert on public.wh40k_imports
  for each row execute function public.wh40k_imports_set_owner();

create or replace function public.dnd_imports_set_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source_owner_id is null then
    select user_id into new.source_owner_id from public.dnd_characters
    where share_token = new.source_token;
  end if;
  return new;
end $$;
drop trigger if exists dnd_imports_set_owner_trg on public.dnd_imports;
create trigger dnd_imports_set_owner_trg
  before insert on public.dnd_imports
  for each row execute function public.dnd_imports_set_owner();


-- ─────────────────────────────────────────────────────────────────────
-- 4. DATA MIGRATION
-- =====================================================================
-- Each block guarded with `if exists` so a fresh install (legacy tables
-- never created) is a no-op.
-- ─────────────────────────────────────────────────────────────────────

-- nerdshelf_favorites → wh40k_favorites
-- MTG favorites: nerdshelf_favorites doesn't carry the scryfall_id column,
-- so any 'mtg' rows there were experimental — the real MTG favorites have
-- always lived in mtg_favorites. We still copy any non-conflicting rows
-- into mtg_favorites's existing shape, treating item_id as scryfall_id.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'nerdshelf_favorites')
  then
    -- wh40k
    insert into public.wh40k_favorites (user_id, item_id, item_label, created_at)
    select user_id, item_id, coalesce(item_label, ''), created_at
      from public.nerdshelf_favorites
     where domain = 'wh40k'
    on conflict (user_id, item_id) do nothing;

    -- mtg (only if mtg_favorites exists and has the expected columns)
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'mtg_favorites'
                 and column_name = 'scryfall_id')
    then
      insert into public.mtg_favorites (user_id, scryfall_id, card_name)
      select user_id, item_id, coalesce(item_label, '')
        from public.nerdshelf_favorites
       where domain = 'mtg'
      on conflict do nothing;
    end if;
  end if;
end $$;


-- nerdshelf_inventory → mtg_inventory + wh40k_inventory
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'nerdshelf_inventory')
  then
    -- MTG owned collection
    insert into public.mtg_inventory (user_id, item_id, quantity, item_label, kind, created_at, updated_at)
    select user_id, item_id, quantity, coalesce(item_label, ''),
           'collection', created_at, updated_at
      from public.nerdshelf_inventory
     where domain = 'mtg'
    on conflict (user_id, item_id, kind) do nothing;

    -- MTG manual wishlist entries (separate kind so they coexist with
    -- collection rows for the same card without violating the unique key)
    insert into public.mtg_inventory (user_id, item_id, quantity, item_label, kind, created_at, updated_at)
    select user_id, item_id, quantity, coalesce(item_label, ''),
           'wishlist-manual', created_at, updated_at
      from public.nerdshelf_inventory
     where domain = 'mtg-wishlist-manual'
    on conflict (user_id, item_id, kind) do nothing;

    -- WH40K inventory
    insert into public.wh40k_inventory (user_id, item_id, quantity, item_label, created_at, updated_at)
    select user_id, item_id, quantity, coalesce(item_label, ''), created_at, updated_at
      from public.nerdshelf_inventory
     where domain = 'wh40k'
    on conflict (user_id, item_id) do nothing;
  end if;
end $$;


-- nerdshelf_imports → mtg_imports + wh40k_imports + dnd_imports
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'nerdshelf_imports')
  then
    insert into public.mtg_imports (user_id, source_token, source_id, source_owner_id, imported_at)
    select user_id, source_token, source_id, source_owner_id, imported_at
      from public.nerdshelf_imports
     where domain = 'mtg_deck'
    on conflict (user_id, source_token) do nothing;

    insert into public.wh40k_imports (user_id, source_token, source_id, source_owner_id, imported_at)
    select user_id, source_token, source_id, source_owner_id, imported_at
      from public.nerdshelf_imports
     where domain = 'wh40k_army'
    on conflict (user_id, source_token) do nothing;

    insert into public.dnd_imports (user_id, source_token, source_id, source_owner_id, imported_at)
    select user_id, source_token, source_id, source_owner_id, imported_at
      from public.nerdshelf_imports
     where domain = 'dnd_character'
    on conflict (user_id, source_token) do nothing;
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────────────
-- 5. REBUILD entity-table public-by-import RLS policies
-- =====================================================================
-- The old policies referenced nerdshelf_imports (filtering by domain).
-- New policies reference the matching per-domain imports table — no
-- domain filter needed because the table name encodes it.
-- ─────────────────────────────────────────────────────────────────────

drop policy if exists "mtg_decks public via imports" on public.mtg_decks;
create policy "mtg_decks public via imports" on public.mtg_decks
  for select using (
    share_token is not null
    and exists (
      select 1 from public.mtg_imports i
       where i.user_id = auth.uid()
         and i.source_token = mtg_decks.share_token
    )
  );

drop policy if exists "wh40k_armies public via imports" on public.wh40k_armies;
create policy "wh40k_armies public via imports" on public.wh40k_armies
  for select using (
    share_token is not null
    and exists (
      select 1 from public.wh40k_imports i
       where i.user_id = auth.uid()
         and i.source_token = wh40k_armies.share_token
    )
  );

-- The legacy file dropped this for table name `characters` — the rename
-- migration carried it over to `dnd_characters` automatically, but to be
-- safe we drop both possible historical names.
drop policy if exists "characters public via imports" on public.dnd_characters;
drop policy if exists "dnd_characters public via imports" on public.dnd_characters;
create policy "dnd_characters public via imports" on public.dnd_characters
  for select using (
    share_token is not null
    and exists (
      select 1 from public.dnd_imports i
       where i.user_id = auth.uid()
         and i.source_token = dnd_characters.share_token
    )
  );

-- profiles: same "I can see the owner's player_name once I've imported
-- something of theirs" rule, now spanning the three per-domain tables.
drop policy if exists "profiles public name via imports" on public.profiles;
create policy "profiles public name via imports" on public.profiles
  for select using (
    exists (
      select 1 from public.mtg_imports   i where i.user_id = auth.uid() and i.source_owner_id = profiles.id
      union all
      select 1 from public.wh40k_imports i where i.user_id = auth.uid() and i.source_owner_id = profiles.id
      union all
      select 1 from public.dnd_imports   i where i.user_id = auth.uid() and i.source_owner_id = profiles.id
    )
  );


-- ─────────────────────────────────────────────────────────────────────
-- 6. lookup_share_token — keep the unified RPC signature
-- =====================================================================
-- The TokenImportInput needs ONE call that says "this token belongs to
-- domain X, owned by user Y". The RPC still UNIONs across the three
-- entity tables; only the imports tables changed, not the entity tables.
-- ─────────────────────────────────────────────────────────────────────

drop function if exists public.lookup_share_token(text);
create or replace function public.lookup_share_token(p_token text)
returns table (
  domain      text,
  source_id   text,
  owner_id    uuid,
  owner_name  text,
  entity_name text
)
language sql security definer set search_path = public as $$
  select 'mtg_deck'::text, d.id::text, d.user_id, p.player_name, d.name
    from public.mtg_decks d
    left join public.profiles p on p.id = d.user_id
   where d.share_token = p_token
  union all
  select 'wh40k_army'::text, a.id::text, a.user_id, p.player_name, a.name
    from public.wh40k_armies a
    left join public.profiles p on p.id = a.user_id
   where a.share_token = p_token
  union all
  select 'dnd_character'::text, c.id::text, c.user_id, p.player_name, c.name
    from public.dnd_characters c
    left join public.profiles p on p.id = c.user_id
   where c.share_token = p_token
  limit 1;
$$;
grant execute on function public.lookup_share_token(text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 7. DROP the legacy tables
-- =====================================================================
-- Order: drop the imports table LAST so that if anything above failed,
-- the legacy data is still on disk for a re-run. CASCADE removes the
-- old triggers/functions/policies that referenced them.
-- ─────────────────────────────────────────────────────────────────────

drop trigger if exists nerdshelf_imports_set_owner_trg on public.nerdshelf_imports;
drop function if exists public.nerdshelf_imports_set_owner();

drop table if exists public.nerdshelf_favorites cascade;
drop table if exists public.nerdshelf_inventory cascade;
drop table if exists public.nerdshelf_imports   cascade;


-- ─────────────────────────────────────────────────────────────────────
-- 8. Sanity report
-- =====================================================================
-- Surfaces row counts in the new tables so you can verify the migration
-- moved roughly what you expected.

do $$
declare
  v_wh40k_fav     int;
  v_mtg_inv       int;
  v_mtg_wish      int;
  v_wh40k_inv     int;
  v_mtg_imp       int;
  v_wh40k_imp     int;
  v_dnd_imp       int;
begin
  select count(*) into v_wh40k_fav  from public.wh40k_favorites;
  select count(*) into v_mtg_inv    from public.mtg_inventory where kind = 'collection';
  select count(*) into v_mtg_wish   from public.mtg_inventory where kind = 'wishlist-manual';
  select count(*) into v_wh40k_inv  from public.wh40k_inventory;
  select count(*) into v_mtg_imp    from public.mtg_imports;
  select count(*) into v_wh40k_imp  from public.wh40k_imports;
  select count(*) into v_dnd_imp    from public.dnd_imports;

  raise notice '=== Migration done ===';
  raise notice 'wh40k_favorites          : % rows', v_wh40k_fav;
  raise notice 'mtg_inventory (coll.)    : % rows', v_mtg_inv;
  raise notice 'mtg_inventory (wish.)    : % rows', v_mtg_wish;
  raise notice 'wh40k_inventory          : % rows', v_wh40k_inv;
  raise notice 'mtg_imports              : % rows', v_mtg_imp;
  raise notice 'wh40k_imports            : % rows', v_wh40k_imp;
  raise notice 'dnd_imports              : % rows', v_dnd_imp;
end $$;
