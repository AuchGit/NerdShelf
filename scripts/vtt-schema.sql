-- scripts/vtt-schema.sql
-- =====================================================================
-- Virtual Tabletop (VTT) for D&D campaigns.
--
-- Persistent, campaign-scoped battlemap state: maps, tokens, zones,
-- walls/doors, level-transitions and manual fog. Everything hangs off a
-- campaign so the GM can prepare ahead of time; starting a session just
-- opens the live view onto this state.
--
-- IDs are client-generated text (the VTT store creates `tok_…`, `wall_…`
-- etc. and the op-sync layer broadcasts them), so PKs are `text`.
-- character_id is bigint (→ dnd_characters), campaign_id is uuid
-- (→ dnd_campaigns), matching the existing schema.
--
-- Reuses the existing RLS helpers from dnd-campaigns-schema.sql:
--   dnd_is_campaign_gm(uuid)      — caller is the campaign's GM
--   dnd_is_campaign_member(uuid)  — caller is GM or a player member
--
-- Idempotent — safe to re-run. Apply in the Supabase SQL editor AFTER
-- dnd-campaigns-schema.sql.
-- =====================================================================

-- ── one VTT-state row per campaign (active map + initiative/combat) ──
create table if not exists public.vtt_campaign_state (
  campaign_id   uuid primary key references public.dnd_campaigns(id) on delete cascade,
  active_map_id text,
  initiative    jsonb not null default '{"order":[],"activeIndex":0,"round":1,"active":false}'::jsonb,
  journal       jsonb not null default '[]'::jsonb,   -- persisted handouts [{id,title,imageUrl,imagePath,body,createdAt}]
  presented_handout text,                              -- id of the handout currently shown to all players
  paused        boolean not null default false,        -- session frozen by the DM (players can't move/act)
  updated_at    timestamptz not null default now()
);
alter table public.vtt_campaign_state add column if not exists journal jsonb not null default '[]'::jsonb;
alter table public.vtt_campaign_state add column if not exists presented_handout text;
alter table public.vtt_campaign_state add column if not exists paused boolean not null default false;
alter table public.vtt_campaign_state add column if not exists relay_url text;  -- GM-hosted direct-connection (relay) ws:// URL, announced to players

create table if not exists public.vtt_maps (
  id            text primary key,
  campaign_id   uuid not null references public.dnd_campaigns(id) on delete cascade,
  name          text not null default 'Map',
  image_path    text,                       -- Storage object path (NOT the bytes)
  width         int  not null,
  height        int  not null,
  grid          jsonb not null,             -- {size,offsetX,offsetY,color,opacity,thickness,style,snapMapToGrid}
  fog_mode      text not null default 'none',
  levels        jsonb not null default '[]'::jsonb,
  player_visible boolean not null default false,
  lighting_enabled boolean not null default true,
  light_style   text not null default 'modern',  -- 'modern' (soft glow) | 'classic' (rings)
  light_baseline text not null default 'bright',  -- 'bright' | 'dim' | 'dark' ambient level
  darkness      jsonb not null default '[]'::jsonb, -- [{id,x,y,r,level}] dark regions (brush stamps)
  terrain       jsonb not null default '[]'::jsonb, -- [{id,col,row,level,kind,ft,visible}] climb/difficult cells
  memory_style  text not null default 'darkened',   -- explored-memory look: 'darkened' | 'grayscale'
  memory_strength real not null default 0.55,        -- 0..1 how dark explored memory is
  light_contrast real not null default 0.5,           -- 0..1 contrast between light steps
  light_blur     real not null default 0,             -- px softness of light transitions
  bloody_tokens  boolean not null default false,       -- procedural blood overlay by missing HP
  created_at    timestamptz not null default now()
);
create index if not exists vtt_maps_campaign on public.vtt_maps(campaign_id);
alter table public.vtt_maps add column if not exists lighting_enabled boolean not null default true;
alter table public.vtt_maps add column if not exists light_style text not null default 'modern';
alter table public.vtt_maps add column if not exists light_baseline text not null default 'bright';
alter table public.vtt_maps add column if not exists darkness jsonb not null default '[]'::jsonb;
alter table public.vtt_maps add column if not exists terrain jsonb not null default '[]'::jsonb;
alter table public.vtt_maps add column if not exists memory_style text not null default 'darkened';
alter table public.vtt_maps add column if not exists memory_strength real not null default 0.55;
alter table public.vtt_maps add column if not exists light_contrast real not null default 0.5;
alter table public.vtt_maps add column if not exists light_blur real not null default 0;
alter table public.vtt_maps add column if not exists bloody_tokens boolean not null default false;
alter table public.vtt_maps add column if not exists enclosed_dark boolean not null default false;  -- roofed wall-loops always dark; windows/open doors leak the outdoor baseline inside
alter table public.vtt_maps add column if not exists world_shadow_dir real;        -- directional "sun" shadow angle in degrees (default 135)
alter table public.vtt_maps add column if not exists world_shadow_strength real;    -- 0 = off; >0 = walls cast a map-wide directional shadow
-- On-token turn markers + badge sizing (DM-set, synced to the table):
alter table public.vtt_maps add column if not exists turn_marker_scope text not null default 'all';   -- 'all' | 'players'
alter table public.vtt_maps add column if not exists turn_marker_view  text not null default 'all';   -- 'all' | 'dm'
alter table public.vtt_maps add column if not exists turn_marker_style text not null default 'ring';  -- 'ring' | 'chevron' | 'glow'
alter table public.vtt_maps add column if not exists token_badge_scale real not null default 1;       -- scales conditions/HP/AC/elev badges
alter table public.vtt_maps add column if not exists image_url_full text;  -- legacy baked relay URL for the full-res original
alter table public.vtt_maps add column if not exists image_full_name text;  -- relative key of the full-res original in the GM's relay maps dir (URL built live from the current relay address)

create table if not exists public.vtt_tokens (
  id            text primary key,
  campaign_id   uuid not null references public.dnd_campaigns(id) on delete cascade,
  map_id        text not null references public.vtt_maps(id) on delete cascade,
  level         text,
  kind          text not null default 'npc',          -- player | npc
  owner_user_id uuid references auth.users(id) on delete set null,
  character_id  bigint references public.dnd_characters(id) on delete set null,
  name          text,
  image_url     text,
  color         text,
  x             double precision not null default 0,
  y             double precision not null default 0,
  size_cells    int not null default 1,
  hp            int,
  hp_max        int,
  ac            int,                               -- shown on enemy tokens (DM only)
  conditions    jsonb not null default '[]'::jsonb,
  light         jsonb,                             -- {preset,brightFt,dimFt,color} or null (a "luminous token")
  statblock     jsonb,                             -- raw 5etools statblock for NPC tokens (DM double-click overlay)
  visible_to    jsonb not null default '[]'::jsonb,-- user ids that may see an 'invisible' token (DM override)
  auras         jsonb not null default '[]'::jsonb, -- [{id,radiusFt,color}] colored range circles (all see)
  sight_reset_at bigint                             -- bumped by the DM to clear this token's owner's explored memory
);
create index if not exists vtt_tokens_map on public.vtt_tokens(map_id);
create index if not exists vtt_tokens_campaign on public.vtt_tokens(campaign_id);
-- Backfill new columns on pre-existing token tables (idempotent).
alter table public.vtt_tokens add column if not exists light jsonb;
alter table public.vtt_tokens add column if not exists ac int;
alter table public.vtt_tokens add column if not exists statblock jsonb;
alter table public.vtt_tokens add column if not exists visible_to jsonb not null default '[]'::jsonb;
alter table public.vtt_tokens add column if not exists auras jsonb not null default '[]'::jsonb;
alter table public.vtt_tokens add column if not exists sight_reset_at bigint;
alter table public.vtt_tokens add column if not exists inside boolean;
alter table public.vtt_tokens add column if not exists controllers jsonb not null default '[]'::jsonb;
alter table public.vtt_tokens add column if not exists bloodied text;  -- per-token blood override: 'on' | 'off' | null(auto)

create table if not exists public.vtt_zones (
  id           text primary key,
  campaign_id  uuid not null references public.dnd_campaigns(id) on delete cascade,
  map_id       text not null references public.vtt_maps(id) on delete cascade,
  level        text,
  created_by   uuid references auth.users(id) on delete set null,
  type         text not null,
  x            double precision, y double precision,
  params       jsonb not null default '{}'::jsonb,
  color        text, opacity real
);
create index if not exists vtt_zones_map on public.vtt_zones(map_id);
alter table public.vtt_zones add column if not exists los_walls boolean not null default true;

create table if not exists public.vtt_walls (
  id           text primary key,
  campaign_id  uuid not null references public.dnd_campaigns(id) on delete cascade,
  map_id       text not null references public.vtt_maps(id) on delete cascade,
  level        text,
  a            jsonb not null,             -- {x,y}
  b            jsonb not null,
  kind         text not null default 'both', -- both | movement | shadow | cover | door
  open         boolean not null default false,
  see_out_ft   int,                         -- cover/bush: see-out distance from inside (ft)
  height_ft    int,                         -- wall height (ft); 0/null = full blocker
  no_roof      boolean not null default false, -- loop without a roof: viewable from above when elevated
  see_through  boolean not null default false -- one-sided loop: see inside from outside, shadow only behind
);
create index if not exists vtt_walls_map on public.vtt_walls(map_id);
alter table public.vtt_walls add column if not exists see_out_ft int;
alter table public.vtt_walls add column if not exists height_ft int;
alter table public.vtt_walls add column if not exists no_roof boolean not null default false;
alter table public.vtt_walls add column if not exists see_through boolean not null default false;
alter table public.vtt_walls add column if not exists milky boolean not null default false;
alter table public.vtt_walls add column if not exists width_cells real;  -- door/window icon display width in cells (null = default 0.7)
alter table public.vtt_walls add column if not exists color text;  -- Buntglas-Fensterfarbe (null = klares Glas: geschlossen blockt Licht)

create table if not exists public.vtt_transitions (
  id           text primary key,
  campaign_id  uuid not null references public.dnd_campaigns(id) on delete cascade,
  map_id       text not null references public.vtt_maps(id) on delete cascade,
  level        text,
  col          int not null,
  row          int not null,
  kind         text not null default 'stairs', -- stairs | ladder
  exits        jsonb not null default '[]'::jsonb -- [{toLevel,col,row}]
);
create index if not exists vtt_transitions_map on public.vtt_transitions(map_id);

create table if not exists public.vtt_lights (
  id           text primary key,
  campaign_id  uuid not null references public.dnd_campaigns(id) on delete cascade,
  map_id       text not null references public.vtt_maps(id) on delete cascade,
  level        text,
  x            double precision not null default 0,
  y            double precision not null default 0,
  bright_ft    int not null default 20,
  dim_ft       int not null default 40,
  color        text not null default '#ffd9a0',
  enabled      boolean not null default true,
  height_ft    int                          -- light height (ft); shines over walls shorter than this
);
create index if not exists vtt_lights_map on public.vtt_lights(map_id);
alter table public.vtt_lights add column if not exists height_ft int;
alter table public.vtt_lights add column if not exists player_switch boolean not null default false;
alter table public.vtt_lights add column if not exists icon text;  -- which SVG shows on the light/switch (torch/lantern/candle path); null = default switch glyph

create table if not exists public.vtt_fog (
  id           text primary key,
  campaign_id  uuid not null references public.dnd_campaigns(id) on delete cascade,
  map_id       text not null references public.vtt_maps(id) on delete cascade,
  polygon      jsonb not null,
  mode         text not null default 'reveal',  -- 'reveal' (hole) or 'hide' (re-cover)
  created_at   timestamptz not null default now()
);
create index if not exists vtt_fog_map on public.vtt_fog(map_id);
alter table public.vtt_fog add column if not exists mode text not null default 'reveal';
alter table public.vtt_fog add column if not exists created_at timestamptz not null default now();

-- ── Global demo maps (cross-campaign, admin-published) ───────────────
-- A demo map is a self-contained snapshot (map fields + all entities) anyone
-- can load as a fresh copy into their own campaign. Only admins may publish.
create table if not exists public.vtt_demo_maps (
  id           text primary key,
  name         text not null default 'Demo Map',
  image_path   text,
  width        int not null default 0,
  height       int not null default 0,
  grid         jsonb not null default '{}'::jsonb,
  snapshot     jsonb not null default '{}'::jsonb, -- {map, walls, lights, zones, transitions}
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- Admin allowlist (you, as Supabase admin, insert your auth uid here).
create table if not exists public.vtt_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create or replace function public.vtt_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vtt_admins where user_id = auth.uid());
$$;
grant execute on function public.vtt_is_admin() to authenticated;

alter table public.vtt_demo_maps enable row level security;
alter table public.vtt_admins enable row level security;
-- Shared maps: anyone authenticated may read all and create new ones; editing /
-- deleting is restricted to the row's owner (no admin role required anymore).
drop policy if exists vtt_demo_read on public.vtt_demo_maps;
create policy vtt_demo_read on public.vtt_demo_maps for select to authenticated using (true);
drop policy if exists vtt_demo_write on public.vtt_demo_maps;            -- legacy admin-only policy
drop policy if exists vtt_demo_insert on public.vtt_demo_maps;
create policy vtt_demo_insert on public.vtt_demo_maps for insert to authenticated
  with check (created_by = auth.uid());
drop policy if exists vtt_demo_modify on public.vtt_demo_maps;
create policy vtt_demo_modify on public.vtt_demo_maps for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists vtt_demo_delete on public.vtt_demo_maps;
create policy vtt_demo_delete on public.vtt_demo_maps for delete to authenticated
  using (created_by = auth.uid());
drop policy if exists vtt_admins_read on public.vtt_admins;
create policy vtt_admins_read on public.vtt_admins for select to authenticated using (user_id = auth.uid());

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.vtt_campaign_state enable row level security;
alter table public.vtt_maps        enable row level security;
alter table public.vtt_tokens      enable row level security;
alter table public.vtt_zones       enable row level security;
alter table public.vtt_walls       enable row level security;
alter table public.vtt_transitions enable row level security;
alter table public.vtt_lights      enable row level security;
alter table public.vtt_fog         enable row level security;

-- Helper: apply the standard "members read, GM writes" policy set to a table.
-- (Written out per-table below for clarity / idempotency.)

-- campaign_state: members read, GM writes
drop policy if exists vtt_state_select on public.vtt_campaign_state;
create policy vtt_state_select on public.vtt_campaign_state for select to authenticated
  using (public.dnd_is_campaign_member(campaign_id));
drop policy if exists vtt_state_write on public.vtt_campaign_state;
create policy vtt_state_write on public.vtt_campaign_state for all to authenticated
  using (public.dnd_is_campaign_gm(campaign_id)) with check (public.dnd_is_campaign_gm(campaign_id));

-- maps / walls / transitions / fog: members read, GM writes
do $$
declare t text;
begin
  foreach t in array array['vtt_maps','vtt_walls','vtt_transitions','vtt_lights','vtt_fog'] loop
    execute format('drop policy if exists %I on public.%I', t||'_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.dnd_is_campaign_member(campaign_id))', t||'_select', t);
    execute format('drop policy if exists %I on public.%I', t||'_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.dnd_is_campaign_gm(campaign_id)) with check (public.dnd_is_campaign_gm(campaign_id))', t||'_write', t);
  end loop;
end $$;

-- tokens: members read; GM full write; a player may UPDATE their OWN token
-- (move it, change its state). Insert/delete stays GM-only.
drop policy if exists vtt_tokens_select on public.vtt_tokens;
create policy vtt_tokens_select on public.vtt_tokens for select to authenticated
  using (public.dnd_is_campaign_member(campaign_id));
drop policy if exists vtt_tokens_gm on public.vtt_tokens;
create policy vtt_tokens_gm on public.vtt_tokens for all to authenticated
  using (public.dnd_is_campaign_gm(campaign_id)) with check (public.dnd_is_campaign_gm(campaign_id));
drop policy if exists vtt_tokens_owner_update on public.vtt_tokens;
create policy vtt_tokens_owner_update on public.vtt_tokens for update to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-- zones: members read; GM full write; a member may manage their OWN zones.
drop policy if exists vtt_zones_select on public.vtt_zones;
create policy vtt_zones_select on public.vtt_zones for select to authenticated
  using (public.dnd_is_campaign_member(campaign_id));
drop policy if exists vtt_zones_gm on public.vtt_zones;
create policy vtt_zones_gm on public.vtt_zones for all to authenticated
  using (public.dnd_is_campaign_gm(campaign_id)) with check (public.dnd_is_campaign_gm(campaign_id));
drop policy if exists vtt_zones_owner on public.vtt_zones;
create policy vtt_zones_owner on public.vtt_zones for all to authenticated
  using (created_by = auth.uid() and public.dnd_is_campaign_member(campaign_id))
  with check (created_by = auth.uid() and public.dnd_is_campaign_member(campaign_id));

-- ── vtt_toggle_door — any member can open/close a door ────────────────
create or replace function public.vtt_toggle_door(p_wall text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_campaign uuid; v_kind text; v_open boolean;
begin
  select campaign_id, kind, open into v_campaign, v_kind, v_open
  from public.vtt_walls where id = p_wall;
  if v_campaign is null then raise exception 'WALL_NOT_FOUND'; end if;
  if v_kind <> 'door' then raise exception 'NOT_A_DOOR'; end if;
  if not public.dnd_is_campaign_member(v_campaign) then raise exception 'NOT_AUTHORIZED'; end if;
  update public.vtt_walls set open = not coalesce(v_open,false) where id = p_wall;
  return not coalesce(v_open,false);
end $$;
grant execute on function public.vtt_toggle_door(text) to authenticated;

-- ── vtt_toggle_light — any member can flip a player-switchable light ──
create or replace function public.vtt_toggle_light(p_light text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_campaign uuid; v_switch boolean; v_enabled boolean;
begin
  select campaign_id, player_switch, enabled into v_campaign, v_switch, v_enabled
  from public.vtt_lights where id = p_light;
  if v_campaign is null then raise exception 'LIGHT_NOT_FOUND'; end if;
  if not coalesce(v_switch,false) then raise exception 'NOT_SWITCHABLE'; end if;
  if not public.dnd_is_campaign_member(v_campaign) then raise exception 'NOT_AUTHORIZED'; end if;
  update public.vtt_lights set enabled = not coalesce(v_enabled,true) where id = p_light;
  return not coalesce(v_enabled,true);
end $$;
grant execute on function public.vtt_toggle_light(text) to authenticated;

-- ── Realtime publication ─────────────────────────────────────────────
do $$
declare v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array[
      'vtt_campaign_state','vtt_maps','vtt_tokens','vtt_zones','vtt_walls','vtt_transitions','vtt_lights','vtt_fog'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end $$;

-- ── Storage bucket for map images ────────────────────────────────────
-- Maps live in Storage (never in the DB). Create the bucket if missing.
-- Public read (map URLs are unguessable content hashes; a campaign's
-- players can see the map anyway). Authenticated users may upload.
insert into storage.buckets (id, name, public)
  values ('vtt-maps', 'vtt-maps', true)
  on conflict (id) do nothing;

drop policy if exists vtt_maps_storage_read on storage.objects;
create policy vtt_maps_storage_read on storage.objects for select to public
  using (bucket_id = 'vtt-maps');
drop policy if exists vtt_maps_storage_write on storage.objects;
create policy vtt_maps_storage_write on storage.objects for insert to authenticated
  with check (bucket_id = 'vtt-maps');
-- upsert overwrites an existing object → UPDATE; deleting a map removes it.
-- Without these, re-uploading the same content hash fails with an RLS error.
drop policy if exists vtt_maps_storage_update on storage.objects;
create policy vtt_maps_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'vtt-maps') with check (bucket_id = 'vtt-maps');
drop policy if exists vtt_maps_storage_delete on storage.objects;
create policy vtt_maps_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vtt-maps');

do $$
begin
  raise notice '=== vtt-schema applied ===';
  raise notice 'tables: vtt_campaign_state, vtt_maps, vtt_tokens, vtt_zones, vtt_walls, vtt_transitions, vtt_fog';
  raise notice 'RLS: members read; GM writes; players update own token; members manage own zones; vtt_toggle_door RPC';
  raise notice 'realtime + vtt-maps storage bucket: ready';
end $$;
