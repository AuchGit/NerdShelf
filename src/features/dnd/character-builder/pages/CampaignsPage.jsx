// src/features/dnd/character-builder/pages/CampaignsPage.jsx
// Campaign dashboard: the campaigns you run or play in, plus create / join.

import { useEffect, useState } from 'react'
import { useNavigate } from '../lib/hashNav'
import { useAuth } from '../../../../core/auth/AuthContext'
import { supabase } from '../lib/supabase'
import { Panel, Button, Modal, Input } from '../../../../shared/ui'
import { ShareButton, useDeepLinkImport } from '../../../../shared/sharing'
import { ShareTokenBadge } from '../../../../shared/tokens'
import DndSubNav from '../components/ui/DndSubNav'
import {
  listMyCampaigns, memberCounts, nextEventByCampaign,
  createCampaign, joinCampaign, formatDate, countdownLabel, classLine,
} from '../lib/campaigns'

const wrap = { maxWidth: 1200, margin: '0 auto', padding: 'var(--space-5)' }

export default function CampaignsPage({ session }) {
  const navigate = useNavigate()
  const { playerName } = useAuth()
  const uid = session.user.id

  const [campaigns, setCampaigns] = useState([])
  const [counts, setCounts] = useState({})
  const [nextEvents, setNextEvents] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [joinTokenSeed, setJoinTokenSeed] = useState('')

  // Deep link: `<APP>/dnd/?join=<token>` → pop the join modal with the
  // token pre-filled. We're already on /dnd/ when the user lands here
  // since the campaigns route lives inside DndCharacterApp.
  useDeepLinkImport({
    param: 'join',
    onToken: (token) => { setJoinTokenSeed(token); setShowJoin(true) },
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cs = await listMyCampaigns()
        const ids = cs.map(c => c.id)
        const [mc, ne] = await Promise.all([memberCounts(ids), nextEventByCampaign(ids)])
        if (cancelled) return
        setCampaigns(cs); setCounts(mc); setNextEvents(ne)
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

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
          {campaigns.map(c => (
            <CampaignCard
              key={c.id}
              campaign={c}
              isGm={c.gm_id === uid}
              memberCount={counts[c.id] || 0}
              nextEvent={nextEvents[c.id]}
              onOpen={() => navigate(`/campaign/${c.id}`)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateCampaignModal
          gmId={uid}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); navigate(`/campaign/${id}`) }}
        />
      )}
      {showJoin && (
        <JoinCampaignModal
          userId={uid}
          playerName={playerName}
          initialToken={joinTokenSeed}
          onClose={() => { setShowJoin(false); setJoinTokenSeed('') }}
          onJoined={(id) => { setShowJoin(false); setJoinTokenSeed(''); navigate(`/campaign/${id}`) }}
        />
      )}
      </div>
    </>
  )
}

// ── Campaign card ───────────────────────────────────────────

function CampaignCard({ campaign, isGm, memberCount, nextEvent, onOpen }) {
  return (
    <Panel
      padding="sm"
      onClick={onOpen}
      style={{ cursor: 'pointer', overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
    >
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
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  function pickImage(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setImage(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function submit() {
    if (!name.trim()) return
    setBusy(true); setErr(null)
    try {
      const c = await createCampaign({ gmId, name: name.trim(), description, image })
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
      if (data && data.length) setCharId(String(data[0].id))
    })()
    return () => { cancelled = true }
  }, [userId])

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
      </Field>
      <Field label="Charakter">
        {characters.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
            Du hast noch keine Charaktere. Erstelle zuerst einen.
          </div>
        ) : (
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr', gap: 6,
            maxHeight: 340, overflowY: 'auto', padding: 2,
          }}>
            {characters.map(c => (
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
const selectStyle = {
  width: '100%', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px',
  fontSize: 'var(--fs-md)', fontFamily: 'inherit', minHeight: 36,
}
