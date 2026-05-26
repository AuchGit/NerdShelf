-- scripts/dnd-campaigns-edition.sql
-- =====================================================================
-- Adds an `edition` column to dnd_campaigns so the GM picks 5e or 5.5e
-- when creating a campaign. The join flow uses this to filter the
-- player's character list to only matching editions.
--
-- Idempotent — re-running is a no-op. Apply via Supabase SQL editor.
-- =====================================================================

alter table public.dnd_campaigns
  add column if not exists edition text not null default '5e';

-- Sanity check: only the two known values are allowed (a future
-- 6e/whatever can be added by simply replacing this constraint).
do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
     where table_schema = 'public' and table_name = 'dnd_campaigns'
       and constraint_name = 'dnd_campaigns_edition_check'
  ) then
    alter table public.dnd_campaigns
      add constraint dnd_campaigns_edition_check check (edition in ('5e', '5.5e'));
  end if;
end $$;

-- Rebuild the join RPC so it server-enforces the edition match. Without
-- this, a player could pick any character via a hand-crafted client and
-- bypass the UI filter. The RPC reads the character's stored edition
-- (data->meta->>edition, defaulting to '5e') and refuses if it doesn't
-- equal the campaign's edition. The client surfaces the error.
create or replace function public.dnd_join_campaign(
  p_token        text,
  p_character_id bigint,
  p_player_name  text,
  p_card         jsonb
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_campaign  uuid;
  v_camp_ed   text;
  v_char_ed   text;
begin
  select id, edition into v_campaign, v_camp_ed
    from public.dnd_campaigns
   where upper(join_token) = upper(trim(p_token));

  if v_campaign is null then
    raise exception 'CAMPAIGN_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.dnd_characters
     where id = p_character_id and user_id = (select auth.uid())
  ) then
    raise exception 'CHARACTER_NOT_OWNED';
  end if;

  select coalesce(data->'meta'->>'edition', '5e')
    into v_char_ed
    from public.dnd_characters
   where id = p_character_id;

  if v_camp_ed is not null and v_char_ed is not null and v_camp_ed <> v_char_ed then
    raise exception 'EDITION_MISMATCH';
  end if;

  insert into public.dnd_campaign_members
        (campaign_id, user_id, character_id, player_name, card)
  values (v_campaign, (select auth.uid()), p_character_id,
          coalesce(p_player_name, ''), coalesce(p_card, '{}'::jsonb))
  on conflict (campaign_id, character_id)
  do update set player_name = excluded.player_name,
                card        = excluded.card;

  return v_campaign;
end;
$$;

grant execute on function public.dnd_join_campaign(text, bigint, text, jsonb) to authenticated;

do $$
declare v_count int;
begin
  select count(*) into v_count from public.dnd_campaigns;
  raise notice '=== dnd_campaigns edition column ready (% rows, default ''5e'') ===', v_count;
  raise notice 'dnd_join_campaign RPC patched with EDITION_MISMATCH check';
end $$;
