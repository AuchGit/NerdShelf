-- scripts/dnd-homebrew-schema.sql
-- ============================================================
-- Homebrew Cloud-Sync für die D&D-Sektion.
--
-- Tabelle hält Items / Spells / Backgrounds / Creatures / Features
-- pro User. Daten als JSONB im 5etools-Shape damit die App sie ohne
-- Schema-Wandlung direkt konsumieren kann.
--
-- Idempotent — `create if not exists`. Apply via Supabase SQL Editor.
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists public.dnd_homebrew (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('items','spells','backgrounds','creatures','features')),
  -- local_id ist die lokale (Tauri-fs) _localMeta.id — wir keyen damit
  -- damit upsert per (user_id, kind, local_id) das Update statt
  -- Duplikat macht.
  local_id    text not null,
  name        text not null default 'Unbenannt',
  source      text not null default 'HB',
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (user_id, kind, local_id)
);

create index if not exists dnd_homebrew_user_kind_idx
  on public.dnd_homebrew (user_id, kind);
create index if not exists dnd_homebrew_updated_idx
  on public.dnd_homebrew (user_id, updated_at desc);

-- updated_at automatisch bei jedem UPDATE
create or replace function public.dnd_homebrew_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists dnd_homebrew_touch_updated_at on public.dnd_homebrew;
create trigger dnd_homebrew_touch_updated_at
  before update on public.dnd_homebrew
  for each row execute function public.dnd_homebrew_touch_updated_at();

revoke execute on function public.dnd_homebrew_touch_updated_at() from public, anon, authenticated;

-- ── RLS ────────────────────────────────────────────────────
alter table public.dnd_homebrew enable row level security;

drop policy if exists dnd_homebrew_select_own on public.dnd_homebrew;
create policy dnd_homebrew_select_own on public.dnd_homebrew
  for select using (user_id = auth.uid());

drop policy if exists dnd_homebrew_insert_own on public.dnd_homebrew;
create policy dnd_homebrew_insert_own on public.dnd_homebrew
  for insert with check (user_id = auth.uid());

drop policy if exists dnd_homebrew_update_own on public.dnd_homebrew;
create policy dnd_homebrew_update_own on public.dnd_homebrew
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists dnd_homebrew_delete_own on public.dnd_homebrew;
create policy dnd_homebrew_delete_own on public.dnd_homebrew
  for delete using (user_id = auth.uid());

-- Grants
grant select, insert, update, delete on public.dnd_homebrew to authenticated;

do $$
begin
  raise notice '=== dnd-homebrew-schema applied ===';
  raise notice 'Tabelle: public.dnd_homebrew (kind, local_id, data jsonb)';
  raise notice 'RLS: owner-only';
  raise notice 'Trigger: updated_at auto-touch';
end $$;
