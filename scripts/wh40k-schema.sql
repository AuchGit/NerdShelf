-- scripts/wh40k-schema.sql
--
-- Supabase migration for the Warhammer 40K feature plus the cross-domain
-- favorites/inventory tables shared with the rest of NerdShelf.
--
-- Apply via the Supabase SQL editor (or `supabase db push`). Each statement
-- is idempotent so re-running the script is safe.
--
-- Compatibility note: the existing MTG `mtg_favorites` table is intentionally
-- left alone. The new `nerdshelf_favorites` / `nerdshelf_inventory` tables
-- service the cross-domain shared hooks; MTG continues to use its dedicated
-- table until/unless we choose to migrate it later.

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

-- ─────────────────── shared favorites ───────────────────
create table if not exists nerdshelf_favorites (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  domain      text not null,
  item_id     text not null,
  item_label  text default '',
  created_at  timestamptz not null default now(),
  unique (user_id, domain, item_id)
);

create index if not exists nerdshelf_favorites_user_domain_idx
  on nerdshelf_favorites(user_id, domain);

alter table nerdshelf_favorites enable row level security;

drop policy if exists "nerdshelf_favorites owner select" on nerdshelf_favorites;
create policy "nerdshelf_favorites owner select" on nerdshelf_favorites
  for select using (auth.uid() = user_id);

drop policy if exists "nerdshelf_favorites owner insert" on nerdshelf_favorites;
create policy "nerdshelf_favorites owner insert" on nerdshelf_favorites
  for insert with check (auth.uid() = user_id);

drop policy if exists "nerdshelf_favorites owner delete" on nerdshelf_favorites;
create policy "nerdshelf_favorites owner delete" on nerdshelf_favorites
  for delete using (auth.uid() = user_id);

-- ─────────────────── shared inventory ───────────────────
create table if not exists nerdshelf_inventory (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  domain      text not null,
  item_id     text not null,
  quantity    integer not null default 1,
  item_label  text default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, domain, item_id)
);

create index if not exists nerdshelf_inventory_user_domain_idx
  on nerdshelf_inventory(user_id, domain);

alter table nerdshelf_inventory enable row level security;

drop policy if exists "nerdshelf_inventory owner select" on nerdshelf_inventory;
create policy "nerdshelf_inventory owner select" on nerdshelf_inventory
  for select using (auth.uid() = user_id);

drop policy if exists "nerdshelf_inventory owner insert" on nerdshelf_inventory;
create policy "nerdshelf_inventory owner insert" on nerdshelf_inventory
  for insert with check (auth.uid() = user_id);

drop policy if exists "nerdshelf_inventory owner update" on nerdshelf_inventory;
create policy "nerdshelf_inventory owner update" on nerdshelf_inventory
  for update using (auth.uid() = user_id);

drop policy if exists "nerdshelf_inventory owner delete" on nerdshelf_inventory;
create policy "nerdshelf_inventory owner delete" on nerdshelf_inventory
  for delete using (auth.uid() = user_id);
