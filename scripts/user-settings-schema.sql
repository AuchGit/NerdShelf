-- scripts/user-settings-schema.sql
--
-- Per-account settings that should follow the user from device to device:
-- the MTG price warnings, the card language, the DnD pill colours and the
-- cross-edition marker.
--
-- Deliberately NOT in here: display and layout preferences (card size,
-- columns, sort orders, sidebar width, the mobile viewer's grid, every VTT
-- view setting). Those describe one screen in one pair of hands and stay
-- in localStorage.
--
-- One row per user, the settings themselves as an opaque bundle, so adding
-- a setting later needs no migration.
--
-- Apply via the Supabase SQL editor. Every statement is idempotent, so
-- re-running it is safe.

create table if not exists user_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

drop policy if exists "user_settings owner select" on user_settings;
create policy "user_settings owner select" on user_settings
  for select using (auth.uid() = user_id);

drop policy if exists "user_settings owner insert" on user_settings;
create policy "user_settings owner insert" on user_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_settings owner update" on user_settings;
create policy "user_settings owner update" on user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_settings owner delete" on user_settings;
create policy "user_settings owner delete" on user_settings
  for delete using (auth.uid() = user_id);
