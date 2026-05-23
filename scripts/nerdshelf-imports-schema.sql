-- scripts/nerdshelf-imports-schema.sql
--
-- DEPRECATED — this file built a single cross-domain `nerdshelf_imports`
-- table. That design was later split into per-domain tables:
--   • mtg_imports   for MTG decks
--   • wh40k_imports for WH40K armies
--   • dnd_imports   for DnD characters
--
-- The migration script that performs the split (and drops the legacy
-- nerdshelf_imports / nerdshelf_favorites / nerdshelf_inventory tables)
-- is: scripts/split-nerdshelf-tables.sql
--
-- This file is kept only so old install instructions / git history refer
-- to something that still exists. Running it is a no-op.

do $$
begin
  raise notice 'nerdshelf-imports-schema.sql is deprecated.';
  raise notice 'Use scripts/split-nerdshelf-tables.sql instead.';
end $$;
