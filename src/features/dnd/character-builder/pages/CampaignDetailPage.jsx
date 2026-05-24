// src/features/dnd/character-builder/pages/CampaignDetailPage.jsx
// One campaign. The GM gets management controls (members, events, open /
// export any sheet); players only see member cards and open their own.

import { useEffect, useState } from 'react'
import { useNavigate } from '../lib/hashNav'
import { useAuth } from '../../../../core/auth/AuthContext'
import { supabase } from '../lib/supabase'
import { downloadFoundryJSON, exportToFoundry } from '../lib/foundryExport'
import { Panel, Button, Modal, Input } from '../../../../shared/ui'
import { ShareButton } from '../../../../shared/sharing'
import DndSubNav from '../components/ui/DndSubNav'
import {
  getCampaign, listMembers, listCampaignEvents, updateCampaign, deleteCampaign,
  removeMember, createEvent, updateEvent, deleteEvent, refreshMemberCard,
  classLine, formatDateTime, countdownLabel, setSessionActive,
} from '../lib/campaigns'

const wrap = { maxWidth: 1100, margin: '0 auto', padding: 'var(--space-5)' }

export default function CampaignDetailPage({ session, campaignId }) {
  const navigate = useNavigate()
  const { playerName } = useAuth()
  const uid = session.user.id

  const [campaign, setCampaign] = useState(null)
  const [members, setMembers] = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [eventModal, setEventModal] = useState(null)   // { event } | { event: null } for new
  const [now] = useState(() => Date.now())
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey(k => k + 1)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const c = await getCampaign(campaignId)
        if (cancelled) return
        if (!c) { setError('Campaign nicht gefunden.'); setLoading(false); return }
        const [m, e] = await Promise.all([listMembers(campaignId), listCampaignEvents(campaignId)])
        if (cancelled) return
        setCampaign(c); setMembers(m); setEvents(e); setError(null)
      } catch (err) {
        if (!cancelled) setError(err.message || String(err))
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [campaignId, reloadKey])

  // Keep the current player's own card snapshot fresh.
  useEffect(() => {
    if (!members.length) return
    const mine = members.filter(m => m.user_id === uid)
    if (!mine.length) return
    let cancelled = false
    ;(async () => {
      const ids = mine.map(m => m.character_id)
      const { data } = await supabase.from('dnd_characters').select('id, name, data').in('id', ids)
      if (cancelled || !data) return
      for (const m of mine) {
        const row = data.find(r => String(r.id) === String(m.character_id))
        if (!row) continue
        const fresh = JSON.stringify({ name: row.name, data: row.data })
        if (m._sig === fresh) continue
        try { await refreshMemberCard(m.id, row, playerName); m._sig = fresh } catch { /* ignore */ }
      }
    })()
    return () => { cancelled = true }
  }, [members, uid, playerName])

  if (loading) {
    return (
      <>
        <DndSubNav active="campaigns" />
        <div style={{ ...wrap, color: 'var(--color-text-muted)', textAlign: 'center', paddingTop: 'var(--space-7)' }}>Lade Campaign…</div>
      </>
    )
  }
  if (error) {
    return (
      <>
        <DndSubNav active="campaigns" />
        <div style={{ ...wrap, textAlign: 'center', paddingTop: 'var(--space-7)' }}>
          <div style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-4)' }}>{error}</div>
        </div>
      </>
    )
  }

  const isGm = campaign.gm_id === uid
  const nextEvent = events.find(e => new Date(e.starts_at).getTime() >= now)

  // Group members by player name.
  const byPlayer = {}
  for (const m of members) {
    const key = (m.player_name || '').trim() || 'Unbenannter Spieler'
    if (!byPlayer[key]) byPlayer[key] = []
    byPlayer[key].push(m)
  }
  const playerNames = Object.keys(byPlayer).sort((a, b) => a.localeCompare(b))

  async function handleDeleteCampaign() {
    if (!window.confirm(`Campaign "${campaign.name}" wirklich löschen? Das entfernt alle Mitglieder und Termine.`)) return
    try { await deleteCampaign(campaign.id); navigate('/campaigns') }
    catch (e) { alert('Löschen fehlgeschlagen: ' + e.message) }
  }

  async function handleLeave() {
    const mine = members.filter(m => m.user_id === uid)
    if (!mine.length) return
    if (!window.confirm('Diese Campaign verlassen?')) return
    try { for (const m of mine) await removeMember(m.id); navigate('/campaigns') }
    catch (e) { alert('Fehlgeschlagen: ' + e.message) }
  }

  async function handleRemoveMember(m) {
    if (!window.confirm(`${m.card?.name || 'Charakter'} aus der Campaign entfernen?`)) return
    try { await removeMember(m.id); reload() }
    catch (e) { alert('Fehlgeschlagen: ' + e.message) }
  }

  async function handleExport(m) {
    try {
      const { data, error: err } = await supabase
        .from('dnd_characters').select('data').eq('id', m.character_id).maybeSingle()
      if (err) throw err
      if (!data) { alert('Charakter konnte nicht geladen werden.'); return }
      await downloadFoundryJSON(data.data)
    } catch (e) {
      alert('Export fehlgeschlagen: ' + (e.message || e))
    }
  }

  async function handleDeleteEvent(ev) {
    if (!window.confirm(`Termin "${ev.title}" löschen?`)) return
    try { await deleteEvent(ev.id); reload() }
    catch (e) { alert('Fehlgeschlagen: ' + e.message) }
  }

  // GM bulk export: every member character → `<export>/<campaign>/<player>_<character>_foundry.json`.
  async function handleExportAll() {
    if (!members.length) { alert('Keine Charaktere zum Exportieren.'); return }
    if (!window.confirm(`Alle ${members.length} Charaktere als Foundry-JSON exportieren?`)) return

    const safe = s => String(s || '').replace(/[^a-z0-9_-]/gi, '_').replace(/^_+|_+$/g, '') || 'unbenannt'
    const campaignFolder = safe(campaign.name)

    const { data: chars, error: fetchErr } = await supabase
      .from('dnd_characters').select('id, name, data')
      .in('id', members.map(m => m.character_id))
    if (fetchErr) { alert('Konnte Charaktere nicht laden:\n' + fetchErr.message); return }

    const memberByCharId = {}
    for (const m of members) memberByCharId[m.character_id] = m

    // ── Tauri desktop: write a folder per campaign ───────────────────────
    if (window.__TAURI_INTERNALS__) {
      try {
        const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs')
        const { open } = await import('@tauri-apps/plugin-dialog')

        let baseDir = localStorage.getItem('dndbuilder_export_path')
        if (!baseDir) {
          const picked = await open({ directory: true, title: 'Export-Ordner wählen' })
          if (!picked) return
          baseDir = picked
          localStorage.setItem('dndbuilder_export_path', baseDir)
        }
        const folder = `${baseDir.replace(/[\\/]+$/, '')}/${campaignFolder}`
        await mkdir(folder, { recursive: true })

        let ok = 0
        const failed = []
        for (const c of (chars || [])) {
          try {
            const actor = await exportToFoundry(c.data)
            const m = memberByCharId[c.id]
            const player = safe(m?.player_name || 'player')
            const charName = safe(c.name || c.data?.info?.name || 'character')
            const filename = `${player}_${charName}_foundry.json`
            await writeTextFile(`${folder}/${filename}`, JSON.stringify(actor, null, 2))
            ok++
          } catch (e) {
            failed.push(`${c.name || 'Charakter'}: ${e.message || e}`)
          }
        }
        alert(
          `Exportiert: ${ok}/${(chars || []).length}\nNach: ${folder}` +
          (failed.length ? `\n\nFehlgeschlagen:\n${failed.join('\n')}` : '')
        )
      } catch (e) {
        alert('Export fehlgeschlagen:\n' + (e.message || e))
      }
      return
    }

    // ── Browser / PWA: trigger N blob downloads ──────────────────────────
    let ok = 0
    const failed = []
    for (const c of (chars || [])) {
      try {
        const actor = await exportToFoundry(c.data)
        const m = memberByCharId[c.id]
        const player = safe(m?.player_name || 'player')
        const charName = safe(c.name || c.data?.info?.name || 'character')
        const filename = `${campaignFolder}_${player}_${charName}_foundry.json`
        const blob = new Blob([JSON.stringify(actor, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = filename
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        URL.revokeObjectURL(url)
        ok++
        // brief gap so the browser doesn't drop downloads
        await new Promise(r => setTimeout(r, 200))
      } catch (e) {
        failed.push(`${c.name || 'Charakter'}: ${e.message || e}`)
      }
    }
    alert(
      `Exportiert: ${ok}/${(chars || []).length}` +
      (failed.length ? `\n\nFehlgeschlagen:\n${failed.join('\n')}` : '')
    )
  }

  return (
    <>
    <DndSubNav active="campaigns" />
    <div style={wrap}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        <Button variant="ghost" onClick={() => navigate('/campaigns')}>← Campaigns</Button>
        <h1 style={{ margin: 0, fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-bold)', flex: 1, minWidth: 0 }}>
          {campaign.name}
        </h1>
        {isGm ? (
          <>
            <Button
              onClick={async () => {
                try { await setSessionActive(campaign.id, true) }
                catch { /* fire-and-navigate — flag flip is best-effort */ }
                navigate(`/campaign/${campaign.id}/session`)
              }}
              disabled={!members.length}
            >
              ▶ Session starten
            </Button>
            <Button variant="secondary" onClick={handleExportAll} disabled={!members.length}>Alle exportieren</Button>
            <Button variant="secondary" onClick={() => setEditing(true)}>Bearbeiten</Button>
            <Button variant="danger" onClick={handleDeleteCampaign}>Löschen</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={handleLeave}>Verlassen</Button>
        )}
      </div>

      {/* Banner + meta */}
      <Panel padding="md" style={{ marginBottom: 'var(--space-5)', display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        {campaign.image && (
          <img src={campaign.image} alt="" style={{ width: 180, height: 110, objectFit: 'cover', borderRadius: 'var(--radius-md)' }} />
        )}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>Token:</span>
            <code style={{
              fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-bold)', letterSpacing: 2,
              background: 'var(--color-bg-sunken)', padding: '4px 10px', borderRadius: 'var(--radius-sm)',
            }}>{campaign.join_token}</code>
            {isGm && (
              <ShareButton
                kind="dnd_campaign"
                token={campaign.join_token}
                name={campaign.name}
              />
            )}
            <span style={{
              fontSize: 'var(--fs-xs)', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
              background: isGm ? 'var(--color-accent)' : 'var(--color-surface)',
              color: isGm ? 'var(--color-accent-contrast)' : 'var(--color-text-muted)',
              border: isGm ? 'none' : '1px solid var(--color-border)',
              textTransform: 'uppercase', fontWeight: 'var(--fw-semibold)',
            }}>{isGm ? 'Spielleiter' : 'Spieler'}</span>
          </div>
          {campaign.description && (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {campaign.description}
            </div>
          )}
          {nextEvent && (
            <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-sm)' }}>
              <span style={{ color: 'var(--color-text-muted)' }}>Nächster Termin: </span>
              <span style={{ fontWeight: 'var(--fw-semibold)' }}>{formatDateTime(nextEvent.starts_at)}</span>
              <span style={{ color: 'var(--color-accent)', marginLeft: 6 }}>({countdownLabel(nextEvent.starts_at)})</span>
            </div>
          )}
        </div>
      </Panel>

      {/* Members */}
      <SectionHeader title={`Charaktere (${members.length})`} />
      {members.length === 0 ? (
        <Panel style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
          Noch keine Charaktere. Teile den Token <strong>{campaign.join_token}</strong>, damit Spieler beitreten können.
        </Panel>
      ) : (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          {playerNames.map(pname => (
            <div key={pname} style={{ marginBottom: 'var(--space-4)' }}>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
                {pname}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--space-3)' }}>
                {byPlayer[pname].map(m => (
                  <MemberCard
                    key={m.id}
                    member={m}
                    isGm={isGm}
                    isMine={m.user_id === uid}
                    onOpenOwn={() => navigate(`/character/${m.character_id}`)}
                    onOpenGm={() => navigate(`/campaign/${campaign.id}/character/${m.character_id}`)}
                    onExport={() => handleExport(m)}
                    onRemove={() => handleRemoveMember(m)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Events */}
      <SectionHeader
        title={`Termine (${events.length})`}
        action={isGm && <Button size="sm" onClick={() => setEventModal({ event: null })}>+ Termin</Button>}
      />
      {events.length === 0 ? (
        <Panel style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 'var(--space-5)' }}>
          {isGm ? 'Noch keine Termine geplant.' : 'Der Spielleiter hat noch keine Termine eingetragen.'}
        </Panel>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {events.map(ev => (
            <EventRow
              key={ev.id}
              event={ev}
              now={now}
              isGm={isGm}
              onEdit={() => setEventModal({ event: ev })}
              onDelete={() => handleDeleteEvent(ev)}
            />
          ))}
        </div>
      )}

      {editing && (
        <CampaignSettingsModal
          campaign={campaign}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); reload() }}
        />
      )}
      {eventModal && (
        <EventModal
          campaignId={campaign.id}
          createdBy={uid}
          event={eventModal.event}
          onClose={() => setEventModal(null)}
          onSaved={() => { setEventModal(null); reload() }}
        />
      )}
    </div>
    </>
  )
}

// ── Member card ─────────────────────────────────────────────

function MemberCard({ member, isGm, isMine, onOpenOwn, onOpenGm, onExport, onRemove }) {
  const card = member.card || {}
  const canOpen = isMine || isGm
  return (
    <Panel padding="sm" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div
        onClick={canOpen ? (isMine ? onOpenOwn : onOpenGm) : undefined}
        style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-3)', cursor: canOpen ? 'pointer' : 'default' }}
      >
        <div style={{
          width: 56, height: 56, borderRadius: 'var(--radius-md)', flexShrink: 0, overflow: 'hidden',
          background: 'var(--color-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {card.portrait
            ? <img src={card.portrait} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontSize: 24, opacity: 0.4 }}>⚔</span>}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 'var(--fw-semibold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {card.name || 'Unbenannt'}
            {isMine && <span style={{ color: 'var(--color-accent)', fontSize: 'var(--fs-xs)', marginLeft: 6 }}>(du)</span>}
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {classLine(card)}
          </div>
          {card.race && (
            <div style={{ color: 'var(--color-text-dim)', fontSize: 'var(--fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {card.race}
            </div>
          )}
        </div>
      </div>
      {isGm && (
        <div style={{ display: 'flex', gap: 'var(--space-1)', padding: 'var(--space-2)', borderTop: '1px solid var(--color-border)' }}>
          <Button size="sm" variant="ghost" style={{ flex: 1 }} onClick={onOpenGm}>Öffnen</Button>
          <Button size="sm" variant="ghost" style={{ flex: 1 }} onClick={onExport}>Export</Button>
          <Button size="sm" variant="ghost" style={{ color: 'var(--color-danger)' }} onClick={onRemove}>✕</Button>
        </div>
      )}
    </Panel>
  )
}

// ── Event row ───────────────────────────────────────────────

function EventRow({ event, now, isGm, onEdit, onDelete }) {
  const past = new Date(event.starts_at).getTime() < now
  return (
    <Panel padding="sm" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', opacity: past ? 0.6 : 1 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 'var(--fw-semibold)' }}>{event.title}</div>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
          {formatDateTime(event.starts_at)}
          {!past && <span style={{ color: 'var(--color-accent)', marginLeft: 6 }}>({countdownLabel(event.starts_at)})</span>}
          {event.location && <span> · {event.location}</span>}
        </div>
        {event.description && (
          <div style={{ color: 'var(--color-text-dim)', fontSize: 'var(--fs-sm)', marginTop: 2, whiteSpace: 'pre-wrap' }}>
            {event.description}
          </div>
        )}
      </div>
      {isGm && (
        <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0 }}>
          <Button size="sm" variant="ghost" onClick={onEdit}>Bearbeiten</Button>
          <Button size="sm" variant="ghost" style={{ color: 'var(--color-danger)' }} onClick={onDelete}>✕</Button>
        </div>
      )}
    </Panel>
  )
}

// ── Campaign settings modal ─────────────────────────────────

function CampaignSettingsModal({ campaign, onClose, onSaved }) {
  const [name, setName] = useState(campaign.name)
  const [description, setDescription] = useState(campaign.description || '')
  const [image, setImage] = useState(campaign.image || null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  function pickImage(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setImage(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function save() {
    if (!name.trim()) return
    setBusy(true); setErr(null)
    try {
      await updateCampaign(campaign.id, { name: name.trim(), description, image })
      onSaved()
    } catch (e) { setErr(e.message || String(e)); setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title="Campaign bearbeiten"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
        <Button disabled={busy || !name.trim()} onClick={save}>Speichern</Button>
      </>}>
      <Field label="Name"><Input value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="Beschreibung">
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} style={textareaStyle} />
      </Field>
      <Field label="Banner-Bild">
        {image && <img src={image} alt="" style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-2)' }} />}
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input type="file" accept="image/*" onChange={pickImage} style={{ fontSize: 'var(--fs-sm)' }} />
          {image && <button onClick={() => setImage(null)} style={linkBtn}>Entfernen</button>}
        </div>
      </Field>
      {err && <div style={{ color: 'var(--color-danger)', fontSize: 'var(--fs-sm)' }}>{err}</div>}
    </Modal>
  )
}

// ── Event modal ─────────────────────────────────────────────

function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function EventModal({ campaignId, createdBy, event, onClose, onSaved }) {
  const [title, setTitle] = useState(event?.title || '')
  const [location, setLocation] = useState(event?.location || '')
  const [description, setDescription] = useState(event?.description || '')
  const [when, setWhen] = useState(toLocalInput(event?.starts_at))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function save() {
    if (!title.trim() || !when) { setErr('Titel und Datum sind erforderlich.'); return }
    setBusy(true); setErr(null)
    try {
      const startsAt = new Date(when).toISOString()
      if (event) {
        await updateEvent(event.id, { title: title.trim(), location, description, starts_at: startsAt })
      } else {
        await createEvent({ campaignId, title: title.trim(), location, description, startsAt, createdBy })
      }
      onSaved()
    } catch (e) { setErr(e.message || String(e)); setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={event ? 'Termin bearbeiten' : 'Neuer Termin'}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
        <Button disabled={busy} onClick={save}>Speichern</Button>
      </>}>
      <Field label="Titel"><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="z.B. Sitzung 5" autoFocus /></Field>
      <Field label="Datum & Uhrzeit">
        <Input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} />
      </Field>
      <Field label="Ort (optional)">
        <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="z.B. Discord, bei Tom" />
      </Field>
      <Field label="Notizen (optional)">
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} style={textareaStyle} />
      </Field>
      {err && <div style={{ color: 'var(--color-danger)', fontSize: 'var(--fs-sm)' }}>{err}</div>}
    </Modal>
  )
}

// ── Shared bits ─────────────────────────────────────────────

function SectionHeader({ title, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
      <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)' }}>{title}</h2>
      {action}
    </div>
  )
}

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

const linkBtn = {
  background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-muted)', cursor: 'pointer', padding: '6px 12px', fontSize: 'var(--fs-sm)',
}
const textareaStyle = {
  width: '100%', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px',
  fontSize: 'var(--fs-md)', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
}
