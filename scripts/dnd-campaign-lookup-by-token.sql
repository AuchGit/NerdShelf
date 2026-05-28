-- ──────────────────────────────────────────────────────────────────────
-- dnd_lookup_campaign_by_token
--
-- The Join modal needs to read a campaign's edition (and name) *before*
-- the user picks a character, so the character list can be filtered to
-- the matching edition. Direct SELECT from dnd_campaigns is blocked by
-- RLS for non-members — the SELECT policy only exposes rows to the GM
-- or to current members. As a result the pre-flight lookup always
-- returned null and the UI showed "Keine Campaign mit diesem Token
-- gefunden" even when joining worked. This RPC closes the gap with the
-- same SECURITY DEFINER pattern dnd_join_campaign already uses: it
-- exposes only the bits the join flow needs (id, edition, name) and
-- requires an authenticated caller plus a valid token.
-- ──────────────────────────────────────────────────────────────────────

create or replace function public.dnd_lookup_campaign_by_token(p_token text)
returns table (
  id       uuid,
  name     text,
  edition  text
)
language sql security definer stable set search_path = public as $$
  select c.id, c.name, c.edition
  from public.dnd_campaigns c
  where upper(c.join_token) = upper(trim(p_token));
$$;

grant execute on function public.dnd_lookup_campaign_by_token(text) to authenticated;
