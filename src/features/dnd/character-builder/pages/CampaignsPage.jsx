// src/features/dnd/character-builder/pages/CampaignsPage.jsx
// Campaign dashboard: the campaigns you run or play in, plus create / join.

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from '../lib/hashNav'
import { useAuth } from '../../../../core/auth/AuthContext'
import { supabase } from '../lib/supabase'
import { Panel, Button, Modal, Input } from '../../../../shared/ui'
import { ShareButton, useDeepLinkImport } from '../../../../shared/sharing'
import { ShareTokenBadge } from '../../../../shared/tokens'
import { readList, writeList, invalidate, subscribe } from '../../../../shared/cache/listCache'
import DndSubNav from '../components/ui/DndSubNav'
import {
  listMyCampaigns, memberCounts, nextEventByCampaign, listMyMemberships,
  createCampaign, joinCampaign, formatDate, countdownLabel, classLine,
} from '../lib/campaigns'

const wrap = { maxWidth: 1200, margin: '0 auto', padding: 'var(--space-5)' }

export default function CampaignsPage({ session }) {
  const navigate = useNavigate()
  const { playerName } = useAuth()
  const uid = session.user.id

  // Shape kept in one cache key so a single read/write covers the whole
  // dashboard. memberCounts / nextEventByCampaign are cheap aggregates
  // derived from the campaign list — bundling them avoids three keys for
  // one user-visible "campaigns view".
  const cacheKey = uid ? `dnd_campaigns_dashboard:${uid}` : null
  const cached = cacheKey ? readList(cacheKey) : null
  const [campaigns, setCampaigns] = useState(() => cached?.campaigns ?? [])
  const [counts, setCounts] = useState(() => cached?.counts ?? {})
  const [nextEvents, setNextEvents] = useState(() => cached?.nextEvents ?? {})
  // membersByCampaign[campaignId] = [{ id, character_id, card, ... }] — only
  // memberships belonging to the current user (campaigns they play in).
  const [myMembers, setMyMembers] = useState(() => cached?.myMembers ?? {})
  const [loading, setLoading] = useState(() => !cached)
  const [error, setError] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [joinTokenSeed, setJoinTokenSeed] = useState('')
  const [joinSessionFor, setJoinSessionFor] = useState(null) // campaign with multiple chars → picker

  // Deep link: `<APP>/dnd/?join=<token>` → pop the join modal with the
  // token pre-filled. We're already on /dnd/ when the user lands here
  // since the campaigns route lives inside DndCharacterApp.
  useDeepLinkImport({
    param: 'join',
    onToken: (token) => { setJoinTokenSeed(token); setShowJoin(true) },
  })

  const reload = useCallback(async () => {
    if (!uid) return
    try {
      const cs = await listMyCampaigns()
      const ids = cs.map(c => c.id)
      const [mc, ne, mine] = await Promise.all([
        memberCounts(ids), nextEventByCampaign(ids), listMyMemberships(uid),
      ])
      const mm = {}
      for (const m of mine) (mm[m.campaign_id] = mm[m.campaign_id] || []).push(m)
      setCampaigns(cs); setCounts(mc); setNextEvents(ne); setMyMembers(mm); setError(null)
      writeList(`dnd_campaigns_dashboard:${uid}`,
        { campaigns: cs, counts: mc, nextEvents: ne, myMembers: mm })
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [uid])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    if (!cacheKey) return
    return subscribe(cacheKey, (next) => {
      if (next === null) { reload(); return }
      if (next.campaigns) setCampaigns(next.campaigns)
      if (next.counts) setCounts(next.counts)
      if (next.nextEvents) setNextEvents(next.nextEvents)
      if (next.myMembers) setMyMembers(next.myMembers)
    })
  }, [cacheKey, reload])

  // Live: GM flips `session_active` on dnd_campaigns → patch the in-memory
  // list so the "Session beitreten" call-to-action appears / disappears
  // without a reload. Requires the realtime publication in
  // scripts/dnd-session-active.sql.
  useEffect(() => {
    if (!uid) return
    const channel = supabase
      .channel(`dnd-campaigns:${uid}`)
      .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'dnd_campaigns' },
          (payload) => {
            const row = payload.new
            if (!row) return
            setCampaigns(prev => {
              const next = prev.map(c => c.id === row.id ? { ...c, ...row } : c)
              // keep the cache in sync so a nav-away & back doesn't show a stale flag
              if (cacheKey) {
                const cur = readList(cacheKey) || {}
                writeList(cacheKey, { ...cur, campaigns: next })
              }
              return next
            })
          })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [uid, cacheKey])

  // Sort: active session in which I'm a player → top.
  // Everything else keeps the existing API order (created_at desc).
  const sortedCampaigns = (() => {
    const active = []
    const rest = []
    for (const c of campaigns) {
      const iAmPlayer = (myMembers[c.id] || []).length > 0
      if (c.session_active && iAmPlayer && c.gm_id !== uid) active.push(c)
      else rest.push(c)
    }
    return [...active, ...rest]
  })()

  // Player Join-Session entry-point: 1 character → straight to sheet,
  // multiple → open the picker.
  function handleJoinSession(campaign) {
    const mine = myMembers[campaign.id] || []
    if (mine.length === 0) return
    if (mine.length === 1) {
      navigate(`/character/${mine[0].character_id}`)
      return
    }
    setJoinSessionFor(campaign)
  }

  return (
    <>
      <DndSubNav active="campaigns" />
      <div style={wrap}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-5)' }}>
          <h1 style={{ margin: 0, fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-bold)', flex: 1, minWidth: 0 }}>Campaigns</h1>
          <Button variant="secondary" onClick={() => setShowJoin(true)}>Beitreten</Button>
          <Button onClick={() => setShowCreate(true)}>+ Campaign erstellen</Button>
        </div>

      {error && (
        <div style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-4)' }}>Fehler: {error}</div>
      )}

      {loading ? (
        <div style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 'var(--space-7)' }}>Lade Campaigns…</div>
      ) : campaigns.length === 0 ? (
        <Panel style={{ textAlign: 'center', padding: 'var(--space-7)' }}>
          <div style={{ fontSize: 40, opacity: 0.4, marginBottom: 'var(--space-3)' }}>⚑</div>
          <div style={{ fontWeight: 'var(--fw-semibold)', marginBottom: 'var(--space-2)' }}>Noch keine Campaigns</div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
            Erstelle eine Campaign als Spielleiter oder tritt mit einem Token bei.
          </div>
        </Panel>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
          {sortedCampaigns.map(c => {
            const isGm = c.gm_id === uid
            const liveForMe = c.session_active && !isGm && (myMembers[c.id] || []).length > 0
            return (
              <CampaignCard
                key={c.id}
                campaign={c}
                isGm={isGm}
                memberCount={counts[c.id] || 0}
                nextEvent={nextEvents[c.id]}
                liveSessionForPlayer={liveForMe}
                onOpen={() => navigate(`/campaign/${c.id}`)}
                onJoinSession={() => handleJoinSession(c)}
              />
            )
          })}
        </div>
      )}

      {showCreate && (
        <CreateCampaignModal
          gmId={uid}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); if (cacheKey) invalidate(cacheKey); navigate(`/campaign/${id}`) }}
        />
      )}
      {showJoin && (
        <JoinCampaignModal
          userId={uid}
          playerName={playerName}
          initialToken={joinTokenSeed}
          onClose={() => { setShowJoin(false); setJoinTokenSeed('') }}
          onJoined={(id) => { setShowJoin(false); setJoinTokenSeed(''); if (cacheKey) invalidate(cacheKey); navigate(`/campaign/${id}`) }}
        />
      )}
      {joinSessionFor && (
        <SessionCharacterPicker
          campaign={joinSessionFor}
          memberships={myMembers[joinSessionFor.id] || []}
          onClose={() => setJoinSessionFor(null)}
          onPick={(characterId) => { setJoinSessionFor(null); navigate(`/character/${characterId}`) }}
        />
      )}
      </div>
    </>
  )
}

// ── Campaign card ───────────────────────────────────────────

function CampaignCard({ campaign, isGm, memberCount, nextEvent, liveSessionForPlayer = false, onOpen, onJoinSession }) {
  return (
    <Panel
      padding="sm"
      onClick={onOpen}
      style={{
        cursor: 'pointer', overflow: 'hidden', padding: 0,
        display: 'flex', flexDirection: 'column',
        // Pulse the border for active sessions where the user is a player.
        borderColor: liveSessionForPlayer ? 'var(--color-accent)' : undefined,
        boxShadow: liveSessionForPlayer ? '0 0 0 1px var(--color-accent)' : undefined,
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = liveSessionForPlayer ? 'var(--color-accent)' : 'var(--color-border)')}
    >
      {/* Live-session banner — only when the user is a PLAYER (not GM)
          and the GM has flipped session_active. Click cascades from
          the panel's onOpen, so we stopPropagation on the button. */}
      {liveSessionForPlayer && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-3)',
            background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
            borderBottom: '1px solid var(--color-accent)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--color-accent)',
            boxShadow: '0 0 0 3px color-mix(in srgb, var(--color-accent) 30%, transparent)',
            flexShrink: 0,
          }} aria-hidden="true" />
          <span style={{ color: 'var(--color-accent)', fontWeight: 'var(--fw-semibold)', flex: 1, minWidth: 0 }}>
            Session läuft
          </span>
          <Button
            size="sm"
            onClick={(e) => { e.stopPropagation(); onJoinSession?.() }}
          >
            Beitreten
          </Button>
        </div>
      )}
      <div style={{
        height: 120, background: 'var(--color-bg-sunken)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        {campaign.image
          ? <img src={campaign.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ fontSize: 44, opacity: 0.35 }}>⚑</div>}
        <span style={{
          position: 'absolute', top: 8, right: 8, padding: '2px 8px', borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)', textTransform: 'uppercase', letterSpacing: 0.5,
          background: isGm ? 'var(--color-accent)' : 'var(--color-surface)',
          color: isGm ? 'var(--color-accent-contrast)' : 'var(--color-text-muted)',
          border: isGm ? 'none' : '1px solid var(--color-border)',
        }}>
          {isGm ? 'Spielleiter' : 'Spieler'}
        </span>
      </div>
      <div style={{ padding: 'var(--space-3) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {campaign.name}
        </div>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
          {memberCount} {memberCount === 1 ? 'Charakter' : 'Charaktere'}
        </div>
        <div style={{ marginTop: 4, fontSize: 'var(--fs-sm)' }}>
          {nextEvent ? (
            <span>
              <span style={{ color: 'var(--color-text-muted)' }}>Nächster Termin: </span>
              <span style={{ fontWeight: 'var(--fw-semibold)' }}>{formatDate(nextEvent.starts_at)}</span>
              <span style={{ color: 'var(--color-accent)', marginLeft: 6 }}>({countdownLabel(nextEvent.starts_at)})</span>
            </span>
          ) : (
            <span style={{ color: 'var(--color-text-dim)' }}>Kein Termin geplant</span>
          )}
        </div>
        {/* GM-only: token + share. Players don't need to share their own
            invite — they're not the inviter. */}
        {isGm && campaign.join_token && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            marginTop: 'var(--space-2)', flexWrap: 'wrap',
          }} onClick={e => e.stopPropagation()}>
            <ShareTokenBadge token={campaign.join_token} label="Join-Token" compact />
            <ShareButton kind="dnd_campaign" token={campaign.join_token} name={campaign.name} compact />
          </div>
        )}
      </div>
    </Panel>
  )
}

// ── Create modal ────────────────────────────────────────────

function CreateCampaignModal({ gmId, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [image, setImage] = useState(null)
  // Edition is required at create time — the join modal uses it to
  // hide characters of the other edition from the picker.
  const [edition, setEdition] = useState('5e')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function pickImage(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const { compressImage } = await import('../../../../shared/images/compressImage')
      // Banners are wider than portraits — allow 800px and a bit more
      // quality (the image is shown larger in the UI).
      const dataUrl = await compressImage(file, { maxDim: 800, quality: 0.8 })
      setImage(dataUrl)
    } catch (err) {
      setErr(err.message || 'Bild konnte nicht verarbeitet werden.')
    }
  }

  async function submit() {
    if (!name.trim()) return
    setBusy(true); setErr(null)
    try {
      const c = await createCampaign({ gmId, name: name.trim(), description, image, edition })
      onCreated(c.id)
    } catch (e) {
      setErr(e.message || String(e)); setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Campaign erstellen"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
        <Button disabled={busy || !name.trim()} onClick={submit}>Erstellen</Button>
      </>}>
      <Field label="Name">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="z.B. Die Verlorene Mine" autoFocus />
      </Field>
      <Field label="Edition">
        <div style={{ display: 'flex', gap: 8 }}>
          {['5e', '5.5e'].map(ed => (
            <button
              key={ed}
              type="button"
              onClick={() => setEdition(ed)}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                fontFamily: 'inherit', fontSize: 'var(--fs-sm)',
                cursor: 'pointer',
                border: `2px solid ${edition === ed ? 'var(--color-accent)' : 'var(--color-border)'}`,
                background: edition === ed
                  ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)'
                  : 'transparent',
                color: edition === ed ? 'var(--color-accent)' : 'var(--color-text)',
                fontWeight: edition === ed ? 'var(--fw-semibold)' : 'normal',
              }}
            >
              {ed === '5.5e' ? 'D&D 2024 (5.5e)' : 'D&D 2014 (5e)'}
            </button>
          ))}
        </div>
        <div style={{ color: 'var(--color-text-dim)', fontSize: 'var(--fs-xs)', marginTop: 4 }}>
          Spieler können der Campaign nur mit Charakteren dieser Edition beitreten.
        </div>
      </Field>
      <Field label="Beschreibung">
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
          style={textareaStyle} placeholder="Worum geht es in diesem Campaign?" />
      </Field>
      <Field label="Banner-Bild (optional)">
        {image && <img src={image} alt="" style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-2)' }} />}
        <input type="file" accept="image/*" onChange={pickImage} style={{ fontSize: 'var(--fs-sm)' }} />
      </Field>
      {err && <div style={{ color: 'var(--color-danger)', fontSize: 'var(--fs-sm)' }}>{err}</div>}
    </Modal>
  )
}

// ── Join modal ──────────────────────────────────────────────

function JoinCampaignModal({ userId, playerName, initialToken = '', onClose, onJoined }) {
  // Initial token comes from a shared deep link (`?join=<token>`) when the
  // user lands here from outside the app. Otherwise they type it.
  const [token, setToken] = useState(initialToken.toUpperCase())
  const [characters, setCharacters] = useState([])
  const [charId, setCharId] = useState('')
  // Edition of the campaign matching `token` — fetched once the token is
  // long enough to look up. Filters the character list so the user can
  // only join with a same-edition character.
  const [campaignEdition, setCampaignEdition] = useState(null)
  const [campaignNotFound, setCampaignNotFound] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('dnd_characters')
        .select('id, name, data')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      if (cancelled) return
      setCharacters(data || [])
    })()
    return () => { cancelled = true }
  }, [userId])

  // Look up the campaign by token to learn its edition. Done on every
  // token change with a tiny debounce. A direct SELECT on dnd_campaigns
  // is blocked by RLS for non-members (the policy exposes rows only to
  // the GM and existing members), which made the pre-flight always
  // report "not found" even when joining worked. We use the
  // dnd_lookup_campaign_by_token SECURITY DEFINER RPC instead — same
  // pattern as dnd_join_campaign, returns just the bits the modal
  // needs (id, name, edition).
  useEffect(() => {
    setCampaignEdition(null); setCampaignNotFound(false)
    const cleaned = (token || '').trim().toUpperCase()
    if (cleaned.length < 4) return
    let cancelled = false
    const handle = setTimeout(async () => {
      const { data, error } = await supabase
        .rpc('dnd_lookup_campaign_by_token', { p_token: cleaned })
      if (cancelled) return
      if (error) { setCampaignNotFound(true); return }
      const row = Array.isArray(data) ? data[0] : data
      if (!row) { setCampaignNotFound(true); return }
      setCampaignEdition(row.edition || '5e')
    }, 200)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [token])

  // Filtered character list — only same-edition characters can be picked.
  // If we don't know the campaign edition yet (token blank / not found),
  // show all. Auto-select the first eligible character.
  const eligibleCharacters = campaignEdition
    ? characters.filter(c => (c.data?.meta?.edition || '5e') === campaignEdition)
    : characters
  useEffect(() => {
    if (eligibleCharacters.length === 0) { setCharId(''); return }
    if (!eligibleCharacters.find(c => String(c.id) === String(charId))) {
      setCharId(String(eligibleCharacters[0].id))
    }
  }, [eligibleCharacters, charId])

  async function submit() {
    if (!token.trim() || !charId) return
    setBusy(true); setErr(null)
    try {
      const characterRow = characters.find(c => String(c.id) === String(charId))
      const id = await joinCampaign({ token, characterRow, playerName })
      onJoined(id)
    } catch (e) {
      setErr(e.message || String(e)); setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Campaign beitreten"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
        <Button disabled={busy || !token.trim() || !charId} onClick={submit}>Beitreten</Button>
      </>}>
      <Field label="Campaign-Token">
        <Input value={token} onChange={e => setToken(e.target.value.toUpperCase())}
          placeholder="z.B. K7QM2F" autoCapitalize="characters"
          autoFocus={!initialToken}
          style={{ letterSpacing: 2, fontWeight: 'var(--fw-semibold)' }} />
        {campaignEdition && (
          <div style={{ marginTop: 6, fontSize: 'var(--fs-xs)', color: 'var(--color-text-dim)' }}>
            Campaign-Edition: <b style={{ color: 'var(--color-accent)' }}>{campaignEdition === '5.5e' ? 'D&D 2024 (5.5e)' : 'D&D 2014 (5e)'}</b>
          </div>
        )}
        {campaignNotFound && token.trim() && (
          <div style={{ marginTop: 6, fontSize: 'var(--fs-xs)', color: 'var(--color-danger)' }}>
            Keine Campaign mit diesem Token gefunden.
          </div>
        )}
      </Field>
      <Field label="Charakter">
        {characters.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
            Du hast noch keine Charaktere. Erstelle zuerst einen.
          </div>
        ) : eligibleCharacters.length === 0 && campaignEdition ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
            Keiner deiner Charaktere ist in der Edition <b>{campaignEdition === '5.5e' ? '5.5e' : '5e'}</b>.
            Erstelle einen passenden Charakter, um beitreten zu können.
          </div>
        ) : (
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr', gap: 6,
            maxHeight: 340, overflowY: 'auto', padding: 2,
          }}>
            {eligibleCharacters.map(c => (
              <CharacterPickRow
                key={c.id}
                character={c}
                selected={String(c.id) === String(charId)}
                onSelect={() => setCharId(String(c.id))}
              />
            ))}
          </div>
        )}
      </Field>
      {err && <div style={{ color: 'var(--color-danger)', fontSize: 'var(--fs-sm)' }}>{err}</div>}
    </Modal>
  )
}

// Compact row for the join character picker: portrait + name + class/level
// in one line. Same data the campaign-member "card" snapshot derives from,
// so what the player sees here matches what the GM will see in the campaign.
function CharacterPickRow({ character, selected, onSelect }) {
  const d = character.data || {}
  const portrait = d.appearance?.portrait
  const name = character.name || d.info?.name || 'Unbenannt'
  // Reuse the same classLine helper the campaign card uses → guaranteed
  // identical wording across the join flow + the campaign view.
  const line = classLine({ classes: (d.classes || []).map(c => ({ classId: c.classId, level: c.level || 1 })) })

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 8px',
        border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
        background: selected ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', color: 'var(--color-text)',
        transition: 'all 120ms',
      }}
    >
      <div style={{
        width: 36, height: 36, flexShrink: 0, borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg-sunken)', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {portrait
          ? <img src={portrait} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 18, opacity: 0.4 }}>⚔</span>}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{name}</div>
        <div style={{
          fontSize: 11, color: 'var(--color-text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{line}</div>
      </div>
      <span aria-hidden="true" style={{
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
        border: `2px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
        background: selected ? 'var(--color-accent)' : 'transparent',
      }} />
    </button>
  )
}

// Active-session character picker. Only shown when the player has more
// than one character in the campaign — single-character case skips
// straight to the sheet.
function SessionCharacterPicker({ campaign, memberships, onClose, onPick }) {
  return (
    <Modal open onClose={onClose} title={`Session: ${campaign.name}`}
      footer={<Button variant="ghost" onClick={onClose}>Abbrechen</Button>}>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
        Mit welchem Charakter willst du der Session beitreten?
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
        {memberships.map(m => (
          <MembershipPickRow
            key={m.id}
            card={m.card || {}}
            onSelect={() => onPick(m.character_id)}
          />
        ))}
      </div>
    </Modal>
  )
}

// Same visual style as CharacterPickRow but reads from the denormalized
// `card` snapshot stored on dnd_campaign_members — we don't refetch the
// full character row just to render the picker.
function MembershipPickRow({ card, onSelect }) {
  const portrait = card?.portrait
  const name = card?.name || 'Unbenannt'
  const line = classLine(card)
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 8px',
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', color: 'var(--color-text)',
        transition: 'border-color 120ms',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
    >
      <div style={{
        width: 36, height: 36, flexShrink: 0, borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg-sunken)', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {portrait
          ? <img src={portrait} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 18, opacity: 0.4 }}>⚔</span>}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{name}</div>
        <div style={{
          fontSize: 11, color: 'var(--color-text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{line}</div>
      </div>
      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-accent)' }}>→</span>
    </button>
  )
}

// ── Shared bits ─────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', marginBottom: 'var(--space-1)', color: 'var(--color-text-muted)' }}>
        {label}
      </div>
      {children}
    </div>
  )
}

const textareaStyle = {
  width: '100%', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px',
  fontSize: 'var(--fs-md)', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
}
