-- scripts/strip-card-portraits.sql
-- =====================================================================
-- Strip the base64 portrait blob out of every dnd_campaign_members.card.
--
-- The portrait was denormalised into the card so other players could see
-- it without RLS access to dnd_characters. Each portrait is typically
-- 100KB-1MB of base64, and every gm_notes edit / card refresh writes
-- the whole row — which then gets broadcast over realtime to every
-- subscriber. Under a 2-user concurrent load this caused PATCH
-- dnd_campaign_members 500s (statement timeout) and the project went
-- to Unhealthy in the Supabase dashboard.
--
-- buildCharacterCard() no longer includes the portrait, so new cards
-- are already clean. This one-shot UPDATE clears existing rows in place.
-- Idempotent — running it again is a no-op (the field is gone).
--
-- Apply via Supabase SQL editor.
-- =====================================================================

do $$
declare
  v_before bigint;
  v_with_portrait int;
  v_after bigint;
begin
  -- Total card payload size on disk before the strip (sum of jsonb sizes).
  select coalesce(sum(pg_column_size(card)), 0)
    into v_before
    from public.dnd_campaign_members;

  select count(*)
    into v_with_portrait
    from public.dnd_campaign_members
   where card ? 'portrait';

  update public.dnd_campaign_members
     set card = card - 'portrait'
   where card ? 'portrait';

  select coalesce(sum(pg_column_size(card)), 0)
    into v_after
    from public.dnd_campaign_members;

  raise notice '=== card portrait strip ===';
  raise notice 'rows updated              : %', v_with_portrait;
  raise notice 'card bytes before         : %', v_before;
  raise notice 'card bytes after          : %', v_after;
  raise notice 'bytes saved               : %', (v_before - v_after);
end $$;
