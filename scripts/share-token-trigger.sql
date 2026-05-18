-- scripts/share-token-trigger.sql
--
-- Unified share-token automation for every owned entity in NerdShelf
-- (MTG decks, WH40K armies, DnD characters). Idempotent — safe to run
-- repeatedly. Apply via Supabase SQL editor or `supabase db push`.
--
-- What this does:
--   1. Ensures the `share_token text` column + unique index exist on
--      all three tables (matches what wh40k-schema.sql already does;
--      restated here for completeness so this one file is a complete
--      "share-token everywhere" migration).
--   2. Defines `mint_share_token()` — server-side token generator that
--      produces 12-character Crockford Base32 strings, identical in
--      shape to the client-side `newShareToken()` in
--      src/shared/tokens/shareToken.js. New tokens minted by either
--      side stay interchangeable.
--   3. Attaches a BEFORE-INSERT-OR-UPDATE trigger on each table that
--      fills `share_token` with a fresh value whenever the row's
--      token is NULL. This means:
--         • New rows always get a token (regardless of whether the
--           client passed one).
--         • Legacy rows that pre-date the column get a token the
--           first time anything updates them.
--   4. One-time backfill of rows that still have NULL tokens at the
--      moment of running, so existing characters / decks / armies
--      immediately surface a token without needing a manual edit.

-- ─────────────────── columns + unique indexes ───────────────────
alter table mtg_decks
  add column if not exists share_token text;
alter table wh40k_armies
  add column if not exists share_token text;
alter table characters
  add column if not exists share_token text;

create unique index if not exists mtg_decks_share_token_uniq
  on mtg_decks(share_token) where share_token is not null;
create unique index if not exists wh40k_armies_share_token_uniq
  on wh40k_armies(share_token) where share_token is not null;
create unique index if not exists characters_share_token_uniq
  on characters(share_token) where share_token is not null;

-- ─────────────────── token generator ───────────────────
-- 12 characters from the Crockford Base32 alphabet (no I, L, O, U —
-- removes the four most-confused letters when a token is read aloud
-- or transcribed by hand). ~60 bits of entropy → collisions are
-- vanishingly rare; the unique index above is the authoritative
-- guard for the few that could occur.
create or replace function mint_share_token() returns text as $$
declare
  alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  result   text := '';
  i        int;
begin
  for i in 1..12 loop
    result := result
      || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$ language plpgsql;

-- ─────────────────── trigger function ───────────────────
-- Single function, three triggers — each table attaches the same
-- BEFORE INSERT OR UPDATE behaviour: mint a token iff one isn't
-- already set. Updates with an existing non-null token are a no-op,
-- so re-saves don't churn the token (it's a permanent identifier).
create or replace function ensure_share_token() returns trigger as $$
begin
  if new.share_token is null or new.share_token = '' then
    new.share_token := mint_share_token();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists mtg_decks_share_token_trigger    on mtg_decks;
create trigger          mtg_decks_share_token_trigger
  before insert or update on mtg_decks
  for each row execute function ensure_share_token();

drop trigger if exists wh40k_armies_share_token_trigger on wh40k_armies;
create trigger          wh40k_armies_share_token_trigger
  before insert or update on wh40k_armies
  for each row execute function ensure_share_token();

drop trigger if exists characters_share_token_trigger   on characters;
create trigger          characters_share_token_trigger
  before insert or update on characters
  for each row execute function ensure_share_token();

-- ─────────────────── one-time backfill ───────────────────
-- Update only rows that still have NULL — already-tokened rows are
-- untouched, so re-running this script doesn't churn anything.
update mtg_decks    set share_token = mint_share_token() where share_token is null;
update wh40k_armies set share_token = mint_share_token() where share_token is null;
update characters   set share_token = mint_share_token() where share_token is null;
