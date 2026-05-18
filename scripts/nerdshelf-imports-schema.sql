-- scripts/nerdshelf-imports-schema.sql
--
-- Cross-domain share-token import system. Lets users add a friend's deck /
-- army / character to their own dashboard in read-only mode, grouped under
-- the original owner's player name.
--
-- Two pieces:
--   1. `nerdshelf_imports` — per-user list of "I imported this token"
--      records. Survives reloads, lets the dashboard re-fetch the source
--      rows on every page load.
--   2. Public-by-token READ policies on `mtg_decks`, `wh40k_armies`,
--      `characters` and `profiles` — anyone authenticated can SELECT a
--      row IF they know its 60-bit share_token. Enumeration is
--      computationally infeasible, and no WRITE/UPDATE/DELETE policy is
--      relaxed, so imports stay strictly read-only.
--
-- Apply via Supabase SQL editor. Idempotent — re-running is safe.
-- Depends on: share-token-trigger.sql (must run first so the share_token
-- columns and unique indexes exist on the three entity tables).

-- ─────────────────── imports table ───────────────────
-- `source_id` is text, not uuid: `characters.id` is bigint while
-- `mtg_decks.id` / `wh40k_armies.id` are uuid. Text is the common
-- denominator that lets one column hold them all without forcing a
-- per-domain schema split.
create table if not exists nerdshelf_imports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  domain        text not null check (domain in ('mtg_deck', 'wh40k_army', 'dnd_character')),
  source_token  text not null,
  source_id     text,                       -- denormalized; text covers uuid+bigint
  imported_at   timestamptz not null default now(),
  unique (user_id, domain, source_token)
);

-- If an earlier (broken) revision of this migration created `source_id`
-- as uuid, convert it in place — Postgres rejects re-running the CREATE
-- with a mismatched column type otherwise.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'nerdshelf_imports' and column_name = 'source_id' and data_type = 'uuid'
  ) then
    alter table nerdshelf_imports alter column source_id type text using source_id::text;
  end if;
end $$;

create index if not exists nerdshelf_imports_user_idx
  on nerdshelf_imports(user_id);
create index if not exists nerdshelf_imports_user_domain_idx
  on nerdshelf_imports(user_id, domain);

alter table nerdshelf_imports enable row level security;

drop policy if exists "nerdshelf_imports owner select" on nerdshelf_imports;
create policy "nerdshelf_imports owner select" on nerdshelf_imports
  for select using (auth.uid() = user_id);

drop policy if exists "nerdshelf_imports owner insert" on nerdshelf_imports;
create policy "nerdshelf_imports owner insert" on nerdshelf_imports
  for insert with check (auth.uid() = user_id);

drop policy if exists "nerdshelf_imports owner delete" on nerdshelf_imports;
create policy "nerdshelf_imports owner delete" on nerdshelf_imports
  for delete using (auth.uid() = user_id);

-- ─────────────────── public-by-token READ policies ───────────────────
-- Authenticated users can SELECT a row if EITHER they own it OR they
-- previously imported its share_token (recorded in nerdshelf_imports).
-- Crucially we DO NOT broaden any insert/update/delete policy, so
-- imports remain strictly read-only.

drop policy if exists "mtg_decks public via imports" on mtg_decks;
create policy "mtg_decks public via imports" on mtg_decks
  for select using (
    share_token is not null
    and exists (
      select 1 from nerdshelf_imports i
      where i.user_id = auth.uid()
        and i.domain = 'mtg_deck'
        and i.source_token = mtg_decks.share_token
    )
  );

drop policy if exists "wh40k_armies public via imports" on wh40k_armies;
create policy "wh40k_armies public via imports" on wh40k_armies
  for select using (
    share_token is not null
    and exists (
      select 1 from nerdshelf_imports i
      where i.user_id = auth.uid()
        and i.domain = 'wh40k_army'
        and i.source_token = wh40k_armies.share_token
    )
  );

drop policy if exists "characters public via imports" on characters;
create policy "characters public via imports" on characters
  for select using (
    share_token is not null
    and exists (
      select 1 from nerdshelf_imports i
      where i.user_id = auth.uid()
        and i.domain = 'dnd_character'
        and i.source_token = characters.share_token
    )
  );

-- ─────────────────── profiles public read ───────────────────
-- The dashboard needs the original owner's `player_name` to label the
-- "imported from <X>" category. This is the only piece of profile data
-- we expose; everything else stays behind the owner-only policy. If a
-- general public-read policy on profiles already exists in your project
-- this drop+recreate is a no-op.

drop policy if exists "profiles owner select" on profiles;
create policy "profiles owner select" on profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles public name via imports" on profiles;
create policy "profiles public name via imports" on profiles
  for select using (
    exists (
      select 1
      from nerdshelf_imports i
      left join mtg_decks    d on d.share_token = i.source_token and i.domain = 'mtg_deck'
      left join wh40k_armies a on a.share_token = i.source_token and i.domain = 'wh40k_army'
      left join characters   c on c.share_token = i.source_token and i.domain = 'dnd_character'
      where i.user_id = auth.uid()
        and (d.user_id = profiles.id
          or a.user_id = profiles.id
          or c.user_id = profiles.id)
    )
  );

-- ─────────────────── lookup helper ───────────────────
-- RPC the client calls BEFORE inserting into nerdshelf_imports — confirms
-- a token exists and returns its (domain, source_id, owner_id, name).
-- `security definer` lets it peek past RLS for the existence check;
-- it never returns the actual entity data, only minimal metadata so the
-- user can confirm "yes, that's the right thing" before importing.

-- Drop any prior signature first — Postgres won't replace a function
-- whose return type has changed (uuid → text in the source_id column).
drop function if exists lookup_share_token(text);

create or replace function lookup_share_token(p_token text)
returns table (
  domain      text,
  source_id   text,
  owner_id    uuid,
  owner_name  text,
  entity_name text
)
language sql
security definer
set search_path = public
as $$
  select 'mtg_deck'::text, d.id::text, d.user_id, p.player_name, d.name
    from mtg_decks d
    left join profiles p on p.id = d.user_id
    where d.share_token = p_token
  union all
  select 'wh40k_army'::text, a.id::text, a.user_id, p.player_name, a.name
    from wh40k_armies a
    left join profiles p on p.id = a.user_id
    where a.share_token = p_token
  union all
  select 'dnd_character'::text, c.id::text, c.user_id, p.player_name, c.name
    from characters c
    left join profiles p on p.id = c.user_id
    where c.share_token = p_token
  limit 1;
$$;

grant execute on function lookup_share_token(text) to authenticated;
