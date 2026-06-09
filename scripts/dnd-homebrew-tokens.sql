-- scripts/dnd-homebrew-tokens.sql
-- ============================================================
-- Token-basiertes Sharing für dnd_homebrew. Pro Eintrag eine
-- kurze, unique URL-safe ID (8 Zeichen, ~218 Trillionen Werte).
-- Wer den Token kennt, kann den Eintrag via RPC fetchen.
--
-- VORAUSSETZUNG: dnd-homebrew-schema.sql + dnd-homebrew-public.sql
-- wurden bereits ausgeführt.
--
-- Idempotent — kann re-ausgeführt werden.
-- ============================================================

-- 1. Spalte share_token (nullable; wird beim 'Share' generiert)
alter table public.dnd_homebrew
  add column if not exists share_token text unique;

create index if not exists dnd_homebrew_share_token_idx
  on public.dnd_homebrew (share_token)
  where share_token is not null;

-- 2. Funktion zum Token-Generieren (8 base62-chars). Kollisions-frei
--    durch DB-UNIQUE Constraint; bei Collision in Schleife regenerieren.
create or replace function public.dnd_homebrew_make_token()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  v_attempts int := 0;
  v_taken boolean;
begin
  loop
    v_token := '';
    for i in 1..8 loop
      v_token := v_token || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    select exists(select 1 from public.dnd_homebrew where share_token = v_token) into v_taken;
    if not v_taken then return v_token; end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then raise exception 'token-collision overflow'; end if;
  end loop;
end;
$$;

grant execute on function public.dnd_homebrew_make_token() to authenticated;

-- 3. RPC: einen Eintrag per Token abrufen. SECURITY DEFINER damit die
--    Owner-RLS umgangen wird — aber NUR über exakten Token-Match;
--    ohne Token gibt's nichts zurück. Returns die roh-Spalten OHNE
--    user_id (Datenschutz — der Empfänger kriegt nur den Inhalt).
create or replace function public.dnd_homebrew_fetch_by_token(p_token text)
returns table (
  id uuid,
  kind text,
  name text,
  source text,
  data jsonb,
  share_token text,
  updated_at timestamptz,
  author_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    h.id,
    h.kind,
    h.name,
    h.source,
    h.data,
    h.share_token,
    h.updated_at,
    (select p.player_name from public.profiles p where p.id = h.user_id) as author_name
  from public.dnd_homebrew h
  where h.share_token = p_token
  limit 1;
$$;

grant execute on function public.dnd_homebrew_fetch_by_token(text) to authenticated;

-- 4. Sanity
do $$
begin
  raise notice '=== dnd-homebrew-tokens applied ===';
  raise notice 'Spalte: share_token (text unique, nullable)';
  raise notice 'RPC: dnd_homebrew_make_token() -> kollisionsfreier 8-Char Token';
  raise notice 'RPC: dnd_homebrew_fetch_by_token(p_token) -> Eintrag per Token';
end $$;
