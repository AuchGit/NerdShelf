// FeatureEditor.jsx
//
// Strukturierter Editor für Homebrew-Class-/Subclass-/Race-Features.
// Die ausgewählten Felder werden zum entries-Text komponiert SO dass
// die existierenden Sheet-Parser (detectActionSlot, parseFeatureEffect,
// findCharges) sie automatisch erkennen — der User braucht kein
// 5etools-Magic-Wording im Kopf zu haben.
//
// Output-Shape: 5etools `classFeature`-konform — also direkt von der
// Engine konsumierbar wenn der Feature in __activeFeatures landet.

import { useState, useEffect } from 'react'
import EntryRenderer from '../../../character-builder/components/ui/EntryRenderer'

const ACTION_OPTS = [
  { v: 'passive',  l: 'Passiv (kein Action-Cost)' },
  { v: 'action',   l: 'Action' },
  { v: 'bonus',    l: 'Bonus Action' },
  { v: 'reaction', l: 'Reaction' },
]
const REST_OPTS = [
  { v: 'none',  l: 'Unbegrenzt (kein Limit)' },
  { v: 'short', l: 'pro Short Rest' },
  { v: 'long',  l: 'pro Long Rest' },
  { v: 'day',   l: 'pro Day' },
  { v: 'combat',l: 'pro Combat' },
  { v: 'turn',  l: 'pro Turn' },
  { v: 'round', l: 'pro Round' },
]
const USES_BASIS = [
  { v: 'fixed',     l: 'Feste Anzahl' },
  { v: 'profBonus', l: 'gleich Proficiency Bonus' },
  { v: 'cha',       l: 'gleich CHA Mod' },
  { v: 'wis',       l: 'gleich WIS Mod' },
  { v: 'int',       l: 'gleich INT Mod' },
]
const DAMAGE_TYPES = [
  '', 'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
  'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
]
const CLASS_OPTS = [
  '', 'Barbarian','Bard','Cleric','Druid','Fighter','Monk','Paladin',
  'Ranger','Rogue','Sorcerer','Warlock','Wizard','Artificer',
]

const ACTION_PREFIX = {
  action:   'As an action, ',
  bonus:    'As a bonus action, ',
  reaction: 'As a reaction, ',
}

function buildEntries({ description, actionType, damageDice, damageType, usesCount, usesBasis, restType }) {
  // Komponiert den entries-Text so dass die Sheet-Regex-Parser ihn
  // konsumieren können.
  const parts = []
  const prefix = ACTION_PREFIX[actionType] || ''
  let main = (description || '').trim()
  if (prefix && !main.toLowerCase().startsWith(prefix.toLowerCase())) {
    main = prefix + (main.charAt(0).toLowerCase() + main.slice(1))
  }
  // Damage in den Haupttext: wir bauen "deal an extra <NdM> <type> damage"
  if (damageDice) {
    const typeSuffix = damageType ? ` ${damageType}` : ''
    const dmgPhrase = `you deal an extra {@damage ${damageDice}}${typeSuffix} damage`
    if (!main.toLowerCase().includes('damage')) {
      main += (main.endsWith('.') ? ' ' : '. ') + dmgPhrase + '.'
    } else {
      // User hat schon damage erwähnt — nicht doppelt rein
    }
  }
  if (main) parts.push(main)
  // Uses-Suffix als eigener Eintrag (eigene Zeile damit findCharges greift)
  if (usesBasis !== 'none' && restType !== 'none') {
    let count = ''
    if (usesBasis === 'fixed') {
      const n = parseInt(usesCount, 10) || 1
      const restWord = REST_OPTS.find(o => o.v === restType)?.l.replace('pro ', '') || 'long rest'
      count = `You can use this feature ${n} time${n > 1 ? 's' : ''}, and you regain expended uses when you finish a ${restWord.toLowerCase()}.`
    } else if (usesBasis === 'profBonus') {
      const restWord = REST_OPTS.find(o => o.v === restType)?.l.replace('pro ', '') || 'long rest'
      count = `You can use this feature a number of times equal to your proficiency bonus, and you regain expended uses when you finish a ${restWord.toLowerCase()}.`
    } else {
      const ab = usesBasis.toUpperCase()
      const restWord = REST_OPTS.find(o => o.v === restType)?.l.replace('pro ', '') || 'long rest'
      count = `You can use this feature a number of times equal to your ${ab} modifier (minimum once), and you regain expended uses when you finish a ${restWord.toLowerCase()}.`
    }
    parts.push(count)
  }
  return parts
}

export default function FeatureEditor({ entry, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => {
    // Reverse-engineer existing entries → structured fields if possible.
    const arr = Array.isArray(entry.entries) ? entry.entries.filter(e => typeof e === 'string') : []
    const flat = arr.join(' ')
    let actionType = 'passive'
    if (/\bas a bonus action\b/i.test(flat)) actionType = 'bonus'
    else if (/\bas a reaction\b/i.test(flat)) actionType = 'reaction'
    else if (/\bas an action\b/i.test(flat)) actionType = 'action'
    const dmgM = flat.match(/\{@damage\s+([^|}]+)\}\s*(\w+)?/i) || flat.match(/(\d+d\d+(?:\s*\+\s*\d+)?)\s+(\w+)?\s*damage/i)
    const damageDice = dmgM ? dmgM[1].trim().replace(/\s+/g, '') : ''
    const damageType = dmgM && DAMAGE_TYPES.includes((dmgM[2] || '').toLowerCase()) ? dmgM[2].toLowerCase() : ''
    let usesBasis = 'none', restType = 'none', usesCount = 1
    if (/equal to your proficiency bonus/i.test(flat)) usesBasis = 'profBonus'
    const cnt = flat.match(/(\d+)\s+times?/i)
    if (cnt) { usesBasis = 'fixed'; usesCount = parseInt(cnt[1], 10) }
    if (/\blong rest\b/i.test(flat)) restType = 'long'
    else if (/\bshort rest\b/i.test(flat)) restType = 'short'
    else if (/\bper combat\b/i.test(flat)) restType = 'combat'
    else if (/\bper day\b/i.test(flat)) restType = 'day'
    // Stripped description: take first sentence, remove the auto-prefix.
    let description = arr[0] || ''
    if (description.startsWith('{@i')) description = arr[1] || ''
    for (const p of Object.values(ACTION_PREFIX)) {
      if (description.toLowerCase().startsWith(p.toLowerCase())) {
        description = description.slice(p.length)
        description = description.charAt(0).toUpperCase() + description.slice(1)
        break
      }
    }
    return {
      name: entry.name || '',
      source: entry.source || 'HB',
      level: entry.level ?? 1,
      classId: entry.className || '',
      actionType,
      damageDice,
      damageType,
      usesCount,
      usesBasis,
      restType,
      description,
      _localMeta: entry._localMeta || {},
    }
  })
  useEffect(() => {
    // Kein deep re-init bei prop-change — der User hat schon angefangen
    // zu editieren wenn entry sich ändert (Save-Path).
  }, [entry])

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))

  function commit() {
    const entries = buildEntries(draft)
    const out = {
      name: draft.name.trim() || 'Unbenannt',
      source: draft.source.trim() || 'HB',
      level: parseInt(draft.level, 10) || 1,
      // 5etools setzt className wenn das Feature an eine Klasse gebunden ist
      ...(draft.classId ? { className: draft.classId, classSource: draft.source } : {}),
      entries,
      _localMeta: draft._localMeta,
    }
    onSave(out)
  }

  const previewEntries = buildEntries(draft)

  return (
    <div style={ed.wrap}>
      <div style={ed.headerRow}>
        <input value={draft.name} onChange={e => set('name', e.target.value)}
          placeholder="Feature-Name" style={{ ...ed.input, flex: 1, fontSize: 18, fontWeight: 700 }} />
        <input value={draft.source} onChange={e => set('source', e.target.value)}
          placeholder="Source" style={{ ...ed.input, width: 160 }} />
      </div>

      <div style={ed.grid}>
        <Field label="Level (Klassen-Stufe)">
          <input type="number" min="1" max="20" value={draft.level}
            onChange={e => set('level', parseInt(e.target.value, 10) || 1)} style={ed.input} />
        </Field>
        <Field label="Klasse (optional)">
          <select value={draft.classId} onChange={e => set('classId', e.target.value)} style={ed.input}>
            {CLASS_OPTS.map(c => <option key={c} value={c}>{c || '(klassenfrei)'}</option>)}
          </select>
        </Field>
        <Field label="Action-Cost">
          <select value={draft.actionType} onChange={e => set('actionType', e.target.value)} style={ed.input}>
            {ACTION_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </Field>
      </div>

      <div style={ed.grid}>
        <Field label="Damage (Würfel)">
          <input value={draft.damageDice} onChange={e => set('damageDice', e.target.value)}
            placeholder="z.B. 1d6 oder 2d8 + 4" style={ed.input} />
        </Field>
        <Field label="Damage-Typ">
          <select value={draft.damageType} onChange={e => set('damageType', e.target.value)} style={ed.input}>
            {DAMAGE_TYPES.map(t => <option key={t} value={t}>{t || '(keiner)'}</option>)}
          </select>
        </Field>
      </div>

      <div style={ed.grid}>
        <Field label="Uses — Basis">
          <select value={draft.usesBasis} onChange={e => set('usesBasis', e.target.value)} style={ed.input}>
            <option value="none">— kein Use-Limit —</option>
            {USES_BASIS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </Field>
        {draft.usesBasis === 'fixed' && (
          <Field label="Anzahl Uses">
            <input type="number" min="1" value={draft.usesCount}
              onChange={e => set('usesCount', parseInt(e.target.value, 10) || 1)} style={ed.input} />
          </Field>
        )}
        {draft.usesBasis !== 'none' && (
          <Field label="Reset">
            <select value={draft.restType} onChange={e => set('restType', e.target.value)} style={ed.input}>
              {REST_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </Field>
        )}
      </div>

      <Field label="Beschreibung (Effekt)">
        <textarea value={draft.description} onChange={e => set('description', e.target.value)}
          rows={6} placeholder="Beschreibe was die Feature macht — Action-Prefix und Uses-Klausel werden automatisch angehängt."
          style={{ ...ed.input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
      </Field>

      <div style={ed.preview}>
        <div style={ed.label}>Vorschau (so wird's gespeichert + im Sheet gerendert)</div>
        <div style={{
          padding: '10px 14px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)', borderRadius: 8,
        }}>
          <div style={{ fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>
            {draft.name || '(unbenannt)'}
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-dim)' }}>
              {draft.classId} · L{draft.level} · {draft.source}
            </span>
          </div>
          {previewEntries.length > 0 && <EntryRenderer entries={previewEntries} />}
        </div>
      </div>

      <div style={ed.footer}>
        <button type="button" onClick={onCancel} style={ed.cancelBtn}>Abbrechen</button>
        <button type="button" onClick={commit} style={ed.saveBtn}>Speichern</button>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <div style={ed.label}>{label}</div>
      {children}
    </div>
  )
}

const ed = {
  wrap: { padding: 20, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', marginBottom: 16 },
  headerRow: { display: 'flex', gap: 8, marginBottom: 16 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  input: { width: '100%', padding: '8px 10px', fontSize: 13, background: 'var(--bg-inset)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit' },
  preview: { marginBottom: 16 },
  footer: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  cancelBtn: { padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 },
  saveBtn: { padding: '8px 20px', borderRadius: 8, border: '2px solid var(--accent)', background: 'var(--accent)', color: 'var(--bg-base, #111)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700 },
}
