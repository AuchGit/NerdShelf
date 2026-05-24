// src/features/dnd/character-builder/pages/SessionPage.jsx
//
// GM session overview. One compact card per character in the campaign.
// Live: a Supabase realtime channel listens to dnd_characters UPDATEs for
// the members of this campaign, so HP / conditions / death saves changes
// from players (or from the GM via the patchCombatState RPC) propagate
// instantly without anyone clicking refresh.
//
// The GM can also write to HP / conditions / death saves directly on each
// card; those writes use the dnd_patch_combat_state RPC (the GM doesn't
// have row-level UPDATE on dnd_characters — the RPC validates and
// whitelists keys server-side).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '../lib/hashNav'
import { supabase } from '../lib/supabase'
import { Panel, Button } from '../../../../shared/ui'
import DndSubNav from '../components/ui/DndSubNav'
import GmSessionPrefsEditor from '../components/ui/GmSessionPrefsEditor'
import ConditionChips from '../components/ui/ConditionChips'
import { useSessionPrefs } from '../lib/useSessionPrefs'
import { PASSIVE_OPTIONS, STAT_OPTIONS } from '../lib/sessionPrefs'
import {
  getCampaign, listMembers, updateMemberGmNotes, classLine, patchCombatState,
} from '../lib/campaigns'
import { computeCharacter } from '../lib/rulesEngine'
import { modStr, ABILITY_KEYS } from '../lib/sheetUtils'

const wrap = { maxWidth: 1300, margin: '0 auto', padding: 'var(--space-5)' }

export default function SessionPage({ session, campaignId }) {
  const navigate = useNavigate()
  const uid = session.user.id

  const [campaign, setCampaign] = useState(null)
  const [members,  setMembers]  = useState([])
  const [chars,    setChars]    = useState({})   // characterId → { data, name } | undefined while loading
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [showPrefs, setShowPrefs] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const refresh = () => setReloadKey(k => k + 1)

  useEffect(() => {
    let cancelled = false
    // No setLoading(true) here — initial state is true, and reloads should
    // refresh silently rather than hiding the whole page behind a spinner.
    ;(async () => {
      try {
        const c = await getCampaign(campaignId)
        if (cancelled) return
        if (!c) { setError('Campaign nicht gefunden.'); setLoading(false); return }
        if (c.gm_id !== uid) { setError('Nur der Spielleiter kann die Session-Übersicht öffnen.'); setLoading(false); return }
        const m = await listMembers(campaignId)
        if (cancelled) return

        const ids = m.map(x => x.character_id)
        let map = {}
        if (ids.length > 0) {
          // RLS: GM-can-see-character policy lets us pull the full data
          // for every member character without per-row joins.
          const { data: rows, error: err } = await supabase
            .from('dnd_characters').select('id, name, data').in('id', ids)
          if (err) throw err
          for (const r of (rows || [])) map[r.id] = r
        }
        if (cancelled) return
        setCampaign(c); setMembers(m); setChars(map); setError(null)
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [campaignId, uid, reloadKey])

  // ── Realtime: live updates from players (and our own RPC writes) ──
  // Subscribe once the members are known. Two channels:
  //   • dnd_characters UPDATE  → patch the chars map in place
  //   • dnd_campaign_members UPDATE (this campaign only) → patch members
  //     so GM-notes typed in another tab show up here too.
  // Requires the realtime publication in dnd-session-schema.sql.
  const characterIds = useMemo(
    () => members.map(m => String(m.character_id)).sort().join(','),
    [members],
  )
  useEffect(() => {
    if (!campaignId || !characterIds) return
    const charSet = new Set(characterIds.split(',').map(s => Number(s)))

    const channel = supabase
      .channel(`dnd-session:${campaignId}`)
      .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'dnd_characters' },
          (payload) => {
            const row = payload.new
            if (!row || !charSet.has(Number(row.id))) return
            setChars(prev => ({ ...prev, [row.id]: { id: row.id, name: row.name, data: row.data } }))
          })
      .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'dnd_campaign_members',
            filter: `campaign_id=eq.${campaignId}` },
          (payload) => {
            const row = payload.new
            if (!row) return
            setMembers(prev => prev.map(m => m.id === row.id ? { ...m, ...row } : m))
          })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [campaignId, characterIds])

  if (loading) return <Shell><Loading>Lade Session…</Loading></Shell>
  if (error)   return <Shell><Loading style={{ color: 'var(--color-danger)' }}>{error}</Loading></Shell>

  return (
    <Shell>
      <div style={wrap}>
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          <Button variant="ghost" onClick={() => navigate(`/campaign/${campaignId}`)}>← Campaign</Button>
          <h1 style={{ margin: 0, fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-bold)', flex: 1, minWidth: 0 }}>
            Session · {campaign.name}
          </h1>
          <Button variant="ghost" onClick={refresh} title="Stand aller Charaktere neu laden">↻ Aktualisieren</Button>
          <Button variant="secondary" onClick={() => setShowPrefs(v => !v)}>
            {showPrefs ? 'Einstellungen schließen' : '⚙ Anzeige'}
          </Button>
        </div>

        {showPrefs && (
          <Panel padding="md" style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)', marginBottom: 8 }}>
              Änderungen werden sofort übernommen und gelten auch für zukünftige Sessions
              (gleiche Einstellung wie in den DnD-Settings → Spielleiter).
            </div>
            <GmSessionPrefsEditor compact />
          </Panel>
        )}

        {/* ── Character grid ── */}
        {members.length === 0 ? (
          <Panel padding="lg" style={{ color: 'var(--color-text-muted)', textAlign: 'center' }}>
            Keine Charaktere in dieser Campaign.
          </Panel>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))',
            gap: 'var(--space-4)',
          }}>
            {members.map(m => (
              <SessionCard
                key={m.id}
                member={m}
                row={chars[m.character_id]}
                onOpenSheet={() => navigate(`/campaign/${campaignId}/session/character/${m.character_id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <>
      <DndSubNav active="campaigns" />
      {children}
    </>
  )
}

function Loading({ children, style }) {
  return (
    <div style={{ ...wrap, color: 'var(--color-text-muted)', textAlign: 'center', paddingTop: 'var(--space-7)', ...style }}>
      {children}
    </div>
  )
}

// ── Card ────────────────────────────────────────────────────

function SessionCard({ member, row, onOpenSheet }) {
  const { prefs } = useSessionPrefs()
  const card = member.card || {}
  const character = row?.data

  // computeCharacter is heavy — memoise per character row.
  const computed = useMemo(() => {
    if (!character) return null
    try { return computeCharacter(character) } catch { return null }
  }, [character])

  // ── Notes (debounced autosave) ──
  // Notes initialise from the row at first mount and stay local thereafter
  // — a server reload mid-edit shouldn't clobber what the GM is typing.
  // If they navigate away and come back, the component remounts and picks
  // up the latest persisted value via this initial state.
  const [notes, setNotes] = useState(member.gm_notes ?? '')
  const [savedAt, setSavedAt] = useState(null)
  const [saveErr, setSaveErr] = useState(null)
  const saveTimer = useRef(null)
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  function onNotesChange(e) {
    const v = e.target.value
    setNotes(v)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await updateMemberGmNotes(member.id, v)
        setSavedAt(Date.now()); setSaveErr(null)
      } catch (err) {
        setSaveErr(err.message || String(err))
      }
    }, 600)
  }

  // ── HP / stats ──
  const status = character?.status || {}
  const maxHP = computed?.hp?.max ?? status.maxHp ?? null
  const currentHP = status.currentHp ?? maxHP
  const tempHP = status.temporaryHp || 0
  const isDown = currentHP != null && currentHP <= 0
  const conditions = status.conditions || []
  const deathSaves = status.deathSaves || { successes: 0, failures: 0 }
  const charId = row?.id

  // ── GM combat-state writes (RPC) ──
  // Optimistic: patch the cards map immediately so the UI feels live; the
  // realtime echo re-confirms the same shape a moment later.
  async function patch(patchObj) {
    if (!charId) return
    // (state setter is in the SessionPage closure — but the card doesn't
    // have direct access. We rely on realtime to broadcast; if Supabase
    // realtime is slow, the player or another GM tab will still catch up.)
    try {
      await patchCombatState(charId, patchObj)
    } catch (e) {
      // Surface in console; the card stays unchanged until the next realtime
      // event so the UI doesn't lie about the state.
      console.warn('[session] patchCombatState failed:', e.message || e)
    }
  }

  function bumpHP(delta) {
    if (currentHP == null || maxHP == null) return
    const next = Math.max(0, Math.min(maxHP, currentHP + delta))
    patch({ currentHp: next })
  }
  function setDeathSave(kind, n) {
    patch({ deathSaves: { ...deathSaves, [kind]: Math.max(0, Math.min(3, n)) } })
  }
  function toggleCondition(id, on) {
    const next = on
      ? [...conditions.filter(x => x !== id), id]
      : conditions.filter(x => x !== id)
    patch({ conditions: next })
  }

  return (
    <Panel padding="none" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top: portrait + identity */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-3)' }}>
        <div style={{
          width: 64, height: 64, borderRadius: 'var(--radius-md)', flexShrink: 0, overflow: 'hidden',
          background: 'var(--color-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {card.portrait
            ? <img src={card.portrait} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontSize: 28, opacity: 0.4 }}>⚔</span>}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-md)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {card.name || row?.name || 'Unbenannt'}
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {classLine(card)}
          </div>
          {(card.race || member.player_name) && (
            <div style={{ color: 'var(--color-text-dim)', fontSize: 'var(--fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[card.race, member.player_name].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
      </div>

      {/* HP edit row — always visible if we know the HP */}
      {character && maxHP != null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 var(--space-3) var(--space-3)',
        }}>
          <div style={{
            flex: 1, padding: '6px 10px', borderRadius: 'var(--radius-md)',
            background: hpTone(currentHP, maxHP) === 'danger' ? 'color-mix(in srgb, var(--color-danger) 18%, transparent)'
                      : hpTone(currentHP, maxHP) === 'warning' ? 'color-mix(in srgb, var(--color-warning, #d98e00) 18%, transparent)'
                      : 'var(--color-bg-sunken)',
            border: `1px solid ${hpTone(currentHP, maxHP) === 'danger' ? 'var(--color-danger)'
                                 : hpTone(currentHP, maxHP) === 'warning' ? 'var(--color-warning, #d98e00)'
                                 : 'var(--color-border)'}`,
          }}>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>HP</div>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-bold)' }}>
              {currentHP}/{maxHP}
              {tempHP > 0 && <span style={{ marginLeft: 6, color: 'var(--accent-green, #2d8a2d)', fontSize: 12 }}>+{tempHP} temp</span>}
            </div>
          </div>
          <HpBtn onClick={() => bumpHP(-1)}>−1</HpBtn>
          <HpBtn onClick={() => bumpHP(-5)}>−5</HpBtn>
          <HpBtn onClick={() => bumpHP(+1)}>+1</HpBtn>
          <HpBtn onClick={() => bumpHP(+5)}>+5</HpBtn>
        </div>
      )}

      {/* Death saves — only when down */}
      {character && isDown && (
        <div style={{
          padding: '0 var(--space-3) var(--space-3)',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)',
            textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 'var(--fw-semibold)',
          }}>
            <span>Death Saves</span>
            <DeathSaveSummary s={deathSaves} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', width: 60 }}>Successes</span>
            <Pips n={3} filled={deathSaves.successes} color="var(--accent-green, #2d8a2d)" onSet={n => setDeathSave('successes', n)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', width: 60 }}>Failures</span>
            <Pips n={3} filled={deathSaves.failures} color="var(--color-danger)" onSet={n => setDeathSave('failures', n)} />
          </div>
        </div>
      )}

      {/* Stats strip */}
      {!character ? (
        <StatsHint>Charakterdaten konnten nicht geladen werden.</StatsHint>
      ) : !computed ? (
        <StatsHint>Charakter unvollständig — kein Level vergeben?</StatsHint>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(82px, 1fr))',
          gap: 6, padding: '0 var(--space-3) var(--space-3)',
        }}>
          {prefs.stats.map(id => {
            const v = renderStat(id, computed, character)
            return v == null ? null : <Stat key={id} label={v.label} value={v.value} />
          })}
          {prefs.passives.map(id => {
            const total = passiveTotal(id, computed)
            if (total == null) return null
            return <Stat key={id} label={passiveLabel(id)} value={total} />
          })}
        </div>
      )}

      {/* Conditions */}
      {character && (
        <div style={{ padding: '0 var(--space-3) var(--space-3)' }}>
          <div style={{
            fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)',
            textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 'var(--fw-semibold)',
            marginBottom: 4,
          }}>Conditions</div>
          <ConditionChips active={conditions} onToggle={toggleCondition} compact />
        </div>
      )}

      {/* Notes */}
      <div style={{ padding: 'var(--space-3)', borderTop: '1px solid var(--color-border)' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)', marginBottom: 4,
        }}>
          <span style={{ fontWeight: 'var(--fw-semibold)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            DM-Notizen
          </span>
          <span>
            {saveErr ? <span style={{ color: 'var(--color-danger)' }}>⚠ {saveErr}</span>
             : savedAt ? <span style={{ color: 'var(--color-text-dim)' }}>gespeichert</span>
             : ' '}
          </span>
        </div>
        <textarea
          value={notes}
          onChange={onNotesChange}
          rows={3}
          placeholder="Notizen für diesen Charakter…"
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical',
            background: 'var(--color-surface)', color: 'var(--color-text)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
            padding: '8px 10px', fontSize: 'var(--fs-sm)', fontFamily: 'inherit',
          }}
        />
      </div>

      {/* View-sheet button */}
      <div style={{ display: 'flex', padding: 'var(--space-2)', borderTop: '1px solid var(--color-border)' }}>
        <Button size="sm" variant="ghost" style={{ flex: 1 }} onClick={onOpenSheet} disabled={!character}>
          Sheet öffnen
        </Button>
      </div>
    </Panel>
  )
}

// ── Display helpers ────────────────────────────────────────

function StatsHint({ children }) {
  return (
    <div style={{
      padding: 'var(--space-3)', color: 'var(--color-text-muted)',
      fontSize: 'var(--fs-sm)', fontStyle: 'italic',
    }}>{children}</div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div style={{
      background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-sm)',
      padding: '6px 8px', textAlign: 'center',
      border: tone === 'danger'  ? '1px solid var(--color-danger)'
            : tone === 'warning' ? '1px solid var(--color-warning, #d98e00)'
            : '1px solid var(--color-border)',
    }}>
      <div style={{ fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </div>
      <div style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-md)' }}>
        {value}
      </div>
    </div>
  )
}

function hpTone(cur, max) {
  if (cur == null || max == null || max <= 0) return null
  if (cur <= 0) return 'danger'
  const pct = cur / max
  if (pct <= 0.25) return 'danger'
  if (pct <= 0.5)  return 'warning'
  return null
}

function HpBtn({ children, onClick }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        minWidth: 36, padding: '6px 8px',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-surface)', color: 'var(--color-text)',
        cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
        fontWeight: 'var(--fw-semibold)',
      }}
    >{children}</button>
  )
}

// Three-state pips for death saves. Click pip N to set count to N (or to
// N-1 if already filled, so a stray double-click can be corrected).
function Pips({ n, filled, color, onSet }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {Array.from({ length: n }, (_, i) => {
        const on = i < filled
        return (
          <button
            key={i} type="button"
            onClick={() => onSet(on && i + 1 === filled ? i : i + 1)}
            style={{
              width: 16, height: 16, borderRadius: '50%',
              border: `1.5px solid ${color}`,
              background: on ? color : 'transparent',
              cursor: 'pointer', padding: 0,
            }}
            aria-label={on ? 'tick (filled)' : 'tick (empty)'}
          />
        )
      })}
    </div>
  )
}

function DeathSaveSummary({ s }) {
  if (s.failures >= 3) return <span style={{ color: 'var(--color-danger)' }}>TOT</span>
  if (s.successes >= 3) return <span style={{ color: 'var(--accent-green, #2d8a2d)' }}>stabil</span>
  return null
}

// ── PASSIVE_OPTIONS / STAT_OPTIONS → renderers ──
// Keeping the label↔id mapping centralised here so the editor catalog
// stays the single source of truth and renderers can be added without
// touching the editor.

function passiveLabel(id) {
  const o = PASSIVE_OPTIONS.find(x => x.id === id)
  return o ? `Pas. ${capitalize(id)}` : capitalize(id)
}

function passiveTotal(id, computed) {
  const skill = computed?.skills?.[id]
  if (!skill) return null
  return 10 + (skill.total ?? 0)
}

function renderStat(id, computed, character) {
  const opt = STAT_OPTIONS.find(o => o.id === id)
  const label = opt ? opt.label : id
  switch (id) {
    case 'ac':         return { label: 'AC',   value: computed?.ac?.total ?? '—' }
    case 'speed':      return { label: 'Speed', value: (computed?.speed?.walk ?? computed?.speed ?? '—') + (typeof computed?.speed?.walk === 'number' ? ' ft' : '') }
    case 'initiative': return { label: 'Init', value: modStr(computed?.initiative ?? 0) }
    case 'saves': {
      const st = computed?.savingThrows
      if (!st) return null
      // Compact: STR/DEX/CON/INT/WIS/CHA on one line, modifier each.
      const txt = ABILITY_KEYS.map(k => `${k.toUpperCase()} ${modStr(st[k]?.total ?? 0)}`).join('  ')
      return { label: 'Saves', value: <span style={{ fontSize: 11, fontWeight: 'var(--fw-medium)' }}>{txt}</span> }
    }
    case 'hitDice': {
      const total = (character?.classes || []).reduce((s, c) => s + (c.level || 0), 0)
      const used = character?.status?.hitDiceUsed || 0
      if (total <= 0) return null
      return { label: 'Hit Dice', value: `${total - used}/${total}` }
    }
    case 'spellSave': {
      const sc = computed?.spellcasting
      const dcs = sc ? Object.values(sc).map(x => x.spellSaveDC).filter(v => v != null) : []
      if (!dcs.length) return null
      return { label: 'Spell DC', value: dcs.join(' / ') }
    }
    default: return { label, value: '—' }
  }
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s }
