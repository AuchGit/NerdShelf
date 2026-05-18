-- scripts/wh40k-squads-schema.sql
--
-- Supabase migration for WH40K saved squads — named, reusable "unit
-- presets" that a user composes from their own inventory (or freely, for
-- units they don't physically own) and then drops into an army with one
-- tap from the army builder.
--
-- A squad is the smallest army-list building block in 10e: one canonical
-- unit at a specific legal model count, with optional wargear notes. We
-- store the unit & size as columns so they're queryable; the wargear
-- choices, free-form notes, and forward-compatible extras live in `data`
-- (jsonb).
--
-- Apply via the Supabase SQL editor or `supabase db push`. Every
-- statement is idempotent so re-running is safe.

create table if not exists wh40k_squads (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null default 'Unbenannter Squad',
  faction_id   text,
  unit_id      text not null,
  model_count  integer not null default 1,
  data         jsonb not null default '{}'::jsonb,
  share_token  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists wh40k_squads_user_id_idx
  on wh40k_squads(user_id);
create index if not exists wh40k_squads_user_faction_idx
  on wh40k_squads(user_id, faction_id);

create unique index if not exists wh40k_squads_share_token_uniq
  on wh40k_squads(share_token) where share_token is not null;

alter table wh40k_squads enable row level security;

drop policy if exists "wh40k_squads owner select" on wh40k_squads;
create policy "wh40k_squads owner select" on wh40k_squads
  for select using (auth.uid() = user_id);

drop policy if exists "wh40k_squads owner insert" on wh40k_squads;
create policy "wh40k_squads owner insert" on wh40k_squads
  for insert with check (auth.uid() = user_id);

drop policy if exists "wh40k_squads owner update" on wh40k_squads;
create policy "wh40k_squads owner update" on wh40k_squads
  for update using (auth.uid() = user_id);

drop policy if exists "wh40k_squads owner delete" on wh40k_squads;
create policy "wh40k_squads owner delete" on wh40k_squads
  for delete using (auth.uid() = user_id);

-- Hook into the share-token trigger created by share-token-trigger.sql.
-- If that script hasn't been run yet, the trigger creation here will
-- fail with "function ensure_share_token() does not exist" — that's
-- the intended signal to apply share-token-trigger.sql first.
drop trigger if exists wh40k_squads_share_token_trigger on wh40k_squads;
create trigger          wh40k_squads_share_token_trigger
  before insert or update on wh40k_squads
  for each row execute function ensure_share_token();

update wh40k_squads set share_token = mint_share_token() where share_token is null;
