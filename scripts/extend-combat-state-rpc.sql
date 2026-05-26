-- scripts/extend-combat-state-rpc.sql
-- =====================================================================
-- Adds new "tickable" keys to the slim dnd_patch_combat_state RPC so
-- concentration changes, action-economy ticks, weapon-marking and the
-- maxHpBonus stepper all propagate INSTANTLY to the GM session view
-- instead of going through the 700ms full-row debounce.
--
-- The GM session card subscribes to dnd_characters UPDATE events; the
-- only thing it needs to display "in real time" is data.status.*. So
-- as long as the RPC writes there, the GM sees it on the next websocket
-- tick (~50-100ms).
--
-- Idempotent. Apply via Supabase SQL editor.
-- =====================================================================

create or replace function public.dnd_patch_combat_state(
  p_char_id bigint,
  p_patch   jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := (select auth.uid());
  v_owner     uuid;
  v_data      jsonb;
  v_status    jsonb;
  v_allowed   text[] := array[
    -- Original combat keys
    'currentHp', 'temporaryHp', 'conditions', 'deathSaves',
    -- Newly tickable keys — all live under data.status and are user-
    -- facing during play, so the GM needs to see them in real time:
    'concentration',   -- { spell, level, since } or null
    'economy',         -- { action, bonusAction, reaction } booleans
    'markedWeapons',   -- { hex_warrior: weaponId, … } slot map
    'maxHpBonus',      -- integer adjustment shown next to HP
    'inspiration',     -- boolean
    'usedResources',   -- per-class resource counts
    'usedSpellSlots',  -- per-level used count
    'usedPactSlots',   -- single integer
    'hitDiceUsed'      -- integer, used by short-rest UI
  ];
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

  -- Whitelist: copy only the recognised keys from p_patch. Keys NOT in
  -- the whitelist are silently dropped (defends against a malicious
  -- client poking at arbitrary data fields).
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

do $$
begin
  raise notice '=== dnd_patch_combat_state extended ===';
  raise notice 'Whitelist now: HP, conditions, death saves, concentration, economy, marked weapons, maxHpBonus, inspiration, resources, slots';
end $$;
