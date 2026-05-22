// src/features/dnd/character-builder/pages/CampaignsPage.jsx
// Campaign dashboard: the campaigns you run or play in, plus create / join.

import { useEffect, useState } from 'react'
import { useNavigate } from '../lib/hashNav'
import { useAuth } from '../../../../core/auth/AuthContext'
import { supabase } from '../lib/supabase'
import { Panel, Button, Modal, Input } from '../../../../shared/ui'
import DndSubNav from '../components/ui/DndSubNav'
import {
  listMyCampaigns, memberCounts, nextEventByCampaign,
  createCampaign, joinCampaign, formatDate, countdownLabel,
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
          onClose={() => setShowJoin(false)}
          onJoined={(id) => { setShowJoin(false); navigate(`/campaign/${id}`) }}
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

function JoinCampaignModal({ userId, playerName, onClose, onJoined }) {
  const [token, setToken] = useState('')
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
          placeholder="z.B. K7QM2F" autoCapitalize="characters" autoFocus
          style={{ letterSpacing: 2, fontWeight: 'var(--fw-semibold)' }} />
      </Field>
      <Field label="Charakter">
        {characters.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
            Du hast noch keine Charaktere. Erstelle zuerst einen.
          </div>
        ) : (
          <select value={charId} onChange={e => setCharId(e.target.value)} style={selectStyle}>
            {characters.map(c => (
              <option key={c.id} value={c.id}>{c.name || c.data?.info?.name || 'Unbenannt'}</option>
            ))}
          </select>
        )}
      </Field>
      {err && <div style={{ color: 'var(--color-danger)', fontSize: 'var(--fs-sm)' }}>{err}</div>}
    </Modal>
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
