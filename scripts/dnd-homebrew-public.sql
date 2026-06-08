-- scripts/dnd-homebrew-public.sql
-- ============================================================
-- Erweitert dnd_homebrew um Public-Sharing damit andere Spieler
-- öffentlich-geteilte Homebrew-Einträge abrufen und in ihre lokale
-- Liste importieren können.
--
-- VORAUSSETZUNG: scripts/dnd-homebrew-schema.sql wurde bereits einmal
-- ausgeführt (Tabelle existiert).
--
-- Idempotent — kann re-ausgeführt werden.
-- ============================================================

-- 1. Spalte is_public + Index
alter table public.dnd_homebrew
  add column if not exists is_public boolean not null default false;

create index if not exists dnd_homebrew_public_idx
  on public.dnd_homebrew (is_public, kind, updated_at desc)
  where is_public = true;

-- 2. RLS-Policy: jeder eingeloggte User kann is_public=true Einträge
--    SELECT'en (zusätzlich zur bestehenden owner-Policy).
drop policy if exists dnd_homebrew_select_public on public.dnd_homebrew;
create policy dnd_homebrew_select_public on public.dnd_homebrew
  for select using (is_public = true);

-- 3. Optional: ungeloggte (anon) Browse-Möglichkeit. Default: aus.
--    Falls die App auch ohne Login öffentliche Homebrew zeigen soll,
--    den folgenden Block uncommenten:
--
-- grant select on public.dnd_homebrew to anon;

-- 4. Sanity
do $$
begin
  raise notice '=== dnd-homebrew-public applied ===';
  raise notice 'Spalte: is_public (default false)';
  raise notice 'Policy: dnd_homebrew_select_public — jeder Auth-User';
  raise notice 'liest is_public=true Eintraege; Owner-Policy bleibt';
  raise notice 'fuer alle eigenen (auch private).';
end $$;
