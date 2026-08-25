-- dnd-homebrew-kinds.sql
--
-- Erweitert die kind-CHECK-Constraint von public.dnd_homebrew.
--
-- Das Ausgangs-Schema (dnd-homebrew-schema.sql) erlaubte nur
--   items | spells | backgrounds | creatures | features
-- Die App kennt inzwischen zusätzlich:
--   races       — Homebrew-Rassen (Editor existiert seit Längerem; ohne
--                 diese Migration scheitert JEDES Speichern einer Rasse
--                 an der Constraint)
--   spelllists  — benannte Zauber-Sammlungen, die die wählbaren Zauber
--                 eines Charakters erweitern (direkt zugeordnet oder über
--                 eine Rasse / einen Background / ein Feature / ein Item)
--
-- Idempotent: mehrfaches Ausführen ist unschädlich.

alter table public.dnd_homebrew
  drop constraint if exists dnd_homebrew_kind_check;

alter table public.dnd_homebrew
  add constraint dnd_homebrew_kind_check
  check (kind in (
    'items','spells','backgrounds','races','creatures','features','spelllists'
  ));

do $$
begin
  raise notice 'dnd_homebrew.kind akzeptiert jetzt auch races und spelllists.';
end $$;
