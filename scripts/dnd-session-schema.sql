-- scripts/dnd-session-schema.sql
-- =====================================================================
-- "Session starten" feature for D&D campaigns.
--
-- Adds a single GM-owned notes column on dnd_campaign_members so the
-- spielleiter can jot per-character notes during a session. The
-- visibility prefs (which passive scores / stats to show in the session
-- overview) are stored locally per-GM (localStorage) and do NOT need a
-- table — they're personal display settings, not shared state.
--
-- Idempotent — safe to re-run. Apply in the Supabase SQL editor.
--
-- Depends on: dnd-campaigns-schema.sql (creates dnd_campaign_members +
-- the SECURITY DEFINER membership helpers used below).
-- =====================================================================

alter table public.dnd_campaign_members
  add column if not exists gm_notes text not null default '';

-- ─────────────────────────────────────────────────────────────────────
-- RLS update — let the GM both read AND write gm_notes
-- ─────────────────────────────────────────────────────────────────────
--
-- The existing dnd_members_select policy already lets the GM read every
-- member of campaigns they run (via dnd_is_campaign_gm). For UPDATE the
-- existing policy only lets a player edit their OWN row — the GM has no
-- write path. We add a dedicated GM-update policy alongside the player
-- one so the GM can patch gm_notes without otherwise touching the row.

drop policy if exists dnd_members_gm_update on public.dnd_campaign_members;
create policy dnd_members_gm_update on public.dnd_campaign_members
  for update to authenticated
  using (public.dnd_is_campaign_gm(campaign_id))
  with check (public.dnd_is_campaign_gm(campaign_id));

-- ─────────────────────────────────────────────────────────────────────
-- Realtime publication
-- ─────────────────────────────────────────────────────────────────────
-- During a live session the GM dashboard subscribes to dnd_characters
-- changes so HP / conditions / death-saves updates from players (or from
-- the GM via the RPC below) propagate without polling. dnd_campaign_members
-- is also added so notes typed in one tab show up in another.
do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['dnd_characters', 'dnd_campaign_members']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- dnd_patch_combat_state — shared write path for HP / conditions / death
-- saves. Permitted to:
--    • the character owner (their own combat state), and
--    • the GM of any campaign the character is a member of.
--
-- p_patch may only carry these top-level keys; anything else is dropped.
-- The original `data` jsonb is preserved — only `data.status.<key>` is
-- merged. Returns the new `data.status` so the caller can confirm.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.dnd_patch_combat_state(
  p_char_id bigint,
  p_patch   jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_owner     uuid;
  v_data      jsonb;
  v_status    jsonb;
  v_allowed   text[] := array['currentHp', 'temporaryHp', 'conditions', 'deathSaves'];
  v_clean     jsonb := '{}'::jsonb;
  v_key       text;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select user_id, data into v_owner, v_data
  from public.dnd_characters where id = p_char_id;
  if v_owner is null then
    raise exception 'CHARACTER_NOT_FOUND';
  end if;

  if v_owner <> v_uid and not public.dnd_gm_can_see_character(p_char_id) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Whitelist: copy only the recognised keys from p_patch.
  foreach v_key in array v_allowed loop
    if p_patch ? v_key then
      v_clean := v_clean || jsonb_build_object(v_key, p_patch -> v_key);
    end if;
  end loop;

  if v_clean = '{}'::jsonb then
    return coalesce(v_data -> 'status', '{}'::jsonb);
  end if;

  v_status := coalesce(v_data -> 'status', '{}'::jsonb) || v_clean;
  update public.dnd_characters
     set data = jsonb_set(coalesce(data, '{}'::jsonb), '{status}', v_status, true),
         updated_at = now()
   where id = p_char_id;

  return v_status;
end $$;

grant execute on function public.dnd_patch_combat_state(bigint, jsonb) to authenticated;

-- Sanity report
do $$
declare v_count int;
begin
  select count(*) into v_count from public.dnd_campaign_members;
  raise notice '=== dnd-session-schema applied ===';
  raise notice 'dnd_campaign_members rows         : %', v_count;
  raise notice 'gm_notes column                   : ready (default empty)';
  raise notice 'realtime publication              : dnd_characters + dnd_campaign_members';
  raise notice 'dnd_patch_combat_state RPC        : ready';
end $$;
