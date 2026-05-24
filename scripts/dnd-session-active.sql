-- scripts/dnd-session-active.sql
-- =====================================================================
-- "Live session" indicator for D&D campaigns.
--
-- Adds a single boolean on dnd_campaigns that the GM flips when starting
-- a session. Players see the flag (RLS already gives campaign members
-- SELECT on dnd_campaigns) and the CampaignsPage surfaces an active
-- session at the top with a "Session beitreten" button. Realtime
-- broadcasts the flag flip so the player's dashboard updates without a
-- refresh.
--
-- Idempotent. Apply in the Supabase SQL editor.
-- Depends on: dnd-campaigns-schema.sql (creates the table + GM update
-- policy that gates writes on this column).
-- =====================================================================

alter table public.dnd_campaigns
  add column if not exists session_active boolean not null default false;

-- Realtime publication: needed so player dashboards pick up the GM's
-- start / end click live. The existing GM-only UPDATE policy on
-- dnd_campaigns means only the GM can flip the flag.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'dnd_campaigns'
     )
  then
    execute 'alter publication supabase_realtime add table public.dnd_campaigns';
  end if;
end $$;

do $$
declare v_active int;
begin
  select count(*) into v_active from public.dnd_campaigns where session_active;
  raise notice '=== dnd-session-active applied ===';
  raise notice 'dnd_campaigns.session_active        : ready (default false)';
  raise notice 'currently active sessions           : %', v_active;
  raise notice 'realtime publication                : includes dnd_campaigns';
end $$;
