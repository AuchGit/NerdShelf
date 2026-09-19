-- scripts/mtg-public-decks.sql
--
-- "Mit allen teilen" for MTG decks: a deck can be marked public, and every
-- signed-in NerdShelf user then finds it under "Mit mir geteilt" — no
-- token, no link needed. Decks that aren't public can still be shared the
-- old way, by link or token (scripts/split-nerdshelf-tables.sql).
--
-- Only READ access widens. Editing, deleting and toggling a deck stay with
-- its owner; the existing owner policies are untouched.
--
-- Safe with the rest of the app: every list query on mtg_decks filters by
-- user_id explicitly, so public decks of other people never leak into your
-- own deck list, wishlist or match deck picker.
--
-- Apply via the Supabase SQL editor. Every statement is idempotent.

-- 1. The flag. Existing decks stay private.
alter table public.mtg_decks
  add column if not exists is_public boolean not null default false;

-- 2. The community list reads public decks newest first.
create index if not exists mtg_decks_public_updated_idx
  on public.mtg_decks (updated_at desc)
  where is_public;

-- 3. Any signed-in user may read a public deck. Policies for the same
--    command are OR-ed, so this adds to "owner" and "public via imports"
--    instead of replacing them.
drop policy if exists "mtg_decks public to all users" on public.mtg_decks;
create policy "mtg_decks public to all users" on public.mtg_decks
  for select to authenticated
  using (is_public);

-- 4. Owner names: the dashboard shows who shared a deck. get_player_names
--    so far only answered for people you imported something from; it now
--    also answers for owners of public decks. Everything else is the body
--    from scripts/performance-fixes.sql, unchanged.
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
       or exists (select 1 from public.mtg_decks     d where d.user_id = p.id and d.is_public)
     );
$$;

revoke execute on function public.get_player_names(uuid[]) from anon;
grant execute on function public.get_player_names(uuid[]) to authenticated;
