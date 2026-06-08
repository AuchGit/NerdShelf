// ItemEditor.jsx
//
// Strukturierter Homebrew-Item Editor mit MEHREREN Actions/Reactions/
// Passives pro Item. Speichert die Action-Daten als strukturiertes
// _hbActions-Array — die Engine in OverviewTab liest diese Felder
// DIREKT (kein Entries-Text-Parsing). Pills werden 1:1 aus den
// gespeicherten Feldern gebaut.
//
// Template-Loading: wenn ein 5etools-Item als Vorlage geladen wird,
// extrahiert parseTemplateActions() versuchsweise Actions aus dem
// entries-Text und befüllt die strukturierten Felder vor.

import { useState, useEffect } from 'react'
import EntryRenderer from '../../../character-builder/components/ui/EntryRenderer'

const TYPE_OPTIONS = [
  { v: 'M',  l: 'M — Melee Weapon' },
  { v: 'R',  l: 'R — Ranged Weapon' },
  { v: 'LA', l: 'LA — Light Armor' },
  { v: 'MA', l: 'MA — Medium Armor' },
  { v: 'HA', l: 'HA — Heavy Armor' },
  { v: 'S',  l: 'S — Shield' },
  { v: 'G',  l: 'G — Gear / Tool' },
  { v: 'P',  l: 'P — Potion / Consumable' },
  { v: 'W',  l: 'W — Wondrous Item' },
  { v: 'RG', l: 'RG — Ring' },
  { v: 'RD', l: 'RD — Rod' },
  { v: 'WD', l: 'WD — Wand' },
  { v: 'SC', l: 'SC — Scroll' },
  { v: 'A',  l: 'A — Ammunition' },
]
const RARITY_OPTIONS = ['none', 'common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact']
const WEAPON_CAT = [
  { v: '',         l: '(none)' },
  { v: 'simple',   l: 'Simple' },
  { v: 'martial',  l: 'Martial' },
]
const DMG_TYPE_OPTIONS = [
  { v: '',  l: '(keiner)' },
  { v: 'B', l: 'Bludgeoning' },
  { v: 'P', l: 'Piercing' },
  { v: 'S', l: 'Slashing' },
  { v: 'A', l: 'Acid' },
  { v: 'C', l: 'Cold' },
  { v: 'F', l: 'Fire' },
  { v: 'O', l: 'Force' },
  { v: 'L', l: 'Lightning' },
  { v: 'N', l: 'Necrotic' },
  { v: 'I', l: 'Poison' },
  { v: 'Y', l: 'Psychic' },
  { v: 'R', l: 'Radiant' },
  { v: 'T', l: 'Thunder' },
]
const ACTION_COSTS = [
  { v: 'action',   l: 'Action' },
  { v: 'bonus',    l: 'Bonus Action' },
  { v: 'reaction', l: 'Reaction' },
  { v: 'passive',  l: 'Passive (Trigger / On-Hit)' },
]
const REST_OPTS = [
  { v: 'none',  l: 'unbegrenzt' },
  { v: 'short', l: 'pro Short Rest' },
  { v: 'long',  l: 'pro Long Rest' },
  { v: 'dawn',  l: 'wieder bei Sonnenaufgang' },
  { v: 'day',   l: 'pro Day' },
]
const SAVE_ABILITIES = ['', 'str', 'dex', 'con', 'int', 'wis', 'cha']

function newAction() {
  return {
    id: `a-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
    name: 'Aktivieren',
    cost: 'action',
    description: '',
    damageDice: '',
    damageType: '',
    saveAbility: '',
    saveDc: '',
    attackBonus: '',
    chargesMax: 0,
    chargesCost: 1,
    chargesRest: 'long',
  }
}

// Parsen einer existing item entries für Action-Extraktion (Template-Load).
function parseTemplateActions(entries) {
  if (!Array.isArray(entries)) return []
  const out = []
  const strings = entries.filter(e => typeof e === 'string')
  for (const text of strings) {
    let cost = null
    if (/\bas an action\b/i.test(text)) cost = 'action'
    else if (/\bas a bonus action\b/i.test(text)) cost = 'bonus'
    else if (/\bas a reaction\b/i.test(text)) cost = 'reaction'
    else if (/\bwhen you hit\b|\bon a hit\b|\bif you hit\b/i.test(text)) cost = 'passive'
    if (!cost) continue
    const act = newAction()
    act.cost = cost
    act.description = text.replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
    // Damage extrahieren
    const dmgM = text.match(/\{@damage\s+([^|}]+)\}\s*(\w+)?/i) || text.match(/(\d+d\d+(?:\s*\+\s*\d+)?)\s+(\w+)\s+damage/i)
    if (dmgM) {
      act.damageDice = dmgM[1].trim().replace(/\s+/g, '')
      if (dmgM[2]) act.damageType = dmgM[2][0].toUpperCase()
    }
    // Save
    const sM = text.match(/(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving\s+throw/i)
    if (sM) act.saveAbility = sM[1].slice(0,3).toLowerCase()
    const dcM = text.match(/\bDC\s*(\d+)/i)
    if (dcM) act.saveDc = dcM[1]
    // Charges
    const chM = text.match(/(\d+)\s+charges?/i)
    if (chM) act.chargesMax = parseInt(chM[1], 10)
    if (/short or long rest/i.test(text)) act.chargesRest = 'short'
    else if (/long rest/i.test(text)) act.chargesRest = 'long'
    else if (/at dawn/i.test(text)) act.chargesRest = 'dawn'
    // Name aus der ersten Substanz raten
    const firstSentence = text.split(/[.!?]/)[0].slice(0, 40)
    act.name = firstSentence.replace(/^as (an? )?(bonus action|action|reaction),\s*/i, '').slice(0, 30) || 'Aktion'
    out.push(act)
  }
  return out
}

export default function ItemEditor({ entry, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => {
    // Template-Load: wenn entries existieren aber kein _hbActions, parse
    // die Vorlage und befülle _hbActions automatisch.
    const initial = { ...entry }
    if (!Array.isArray(initial._hbActions)) {
      const parsed = parseTemplateActions(initial.entries)
      initial._hbActions = parsed
    }
    if (!Array.isArray(initial.property)) initial.property = []
    if (!Array.isArray(initial.mastery)) initial.mastery = []
    return initial
  })
  useEffect(() => {
    const initial = { ...entry }
    if (!Array.isArray(initial._hbActions)) initial._hbActions = parseTemplateActions(entry?.entries)
    if (!Array.isArray(initial.property)) initial.property = []
    if (!Array.isArray(initial.mastery)) initial.mastery = []
    setDraft(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?._localMeta?.id, entry?.name])

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const setAction = (id, patch) => setDraft(d => ({
    ...d,
    _hbActions: (d._hbActions || []).map(a => a.id === id ? { ...a, ...patch } : a),
  }))
  const addAction = () => setDraft(d => ({ ...d, _hbActions: [...(d._hbActions || []), newAction()] }))
  const removeAction = (id) => setDraft(d => ({ ...d, _hbActions: (d._hbActions || []).filter(a => a.id !== id) }))

  function commit() {
    const out = { ...draft }
    if (!out.weight) delete out.weight
    if (!out.value) delete out.value
    if (!out.ac) delete out.ac
    if (!out.dmg1) delete out.dmg1
    if (!out.dmgType) delete out.dmgType
    if (!out.weaponCategory) delete out.weaponCategory
    if (!out.property?.length) delete out.property
    if (!out.mastery?.length) delete out.mastery
    if (!out.reqAttune) delete out.reqAttune
    if (!out._hbActions?.length) delete out._hbActions
    // Sync entries-Feld aus den strukturierten Actions damit FeaturesTab
    // und alte Parser eine human-readable Beschreibung haben. _hbActions
    // bleibt aber Single Source of Truth für die Engine.
    const composed = []
    if (out.description) composed.push(out.description)
    for (const a of (out._hbActions || [])) {
      const lines = []
      const costPhrase = a.cost === 'action' ? 'As an action,'
        : a.cost === 'bonus' ? 'As a bonus action,'
        : a.cost === 'reaction' ? 'As a reaction,'
        : ''
      let body = a.description.trim()
      if (costPhrase && !body.toLowerCase().startsWith(costPhrase.toLowerCase())) {
        body = `${costPhrase} ${body.charAt(0).toLowerCase()}${body.slice(1)}`
      }
      if (a.damageDice) {
        const t = a.damageType ? ` ${a.damageType}` : ''
        if (!/damage/i.test(body)) body += ` dealing {@damage ${a.damageDice}}${t} damage`
      }
      if (a.saveAbility && a.saveDc) {
        body += `, requiring a DC ${a.saveDc} ${a.saveAbility.toUpperCase()} saving throw`
      }
      lines.push(body.trim().replace(/,\s*$/, '') + '.')
      if (a.chargesMax > 0) {
        const restPhrase = REST_OPTS.find(r => r.v === a.chargesRest)?.l || ''
        lines.push(`This action consumes ${a.chargesCost} charge${a.chargesCost > 1 ? 's' : ''} (${a.chargesMax} max, regains ${restPhrase}).`)
      }
      composed.push(lines.join(' '))
    }
    if (composed.length === 0 && out.description) composed.push(out.description)
    out.entries = composed.length > 0 ? composed : (out.entries || [])
    delete out.description
    onSave(out)
  }

  const isWeapon = ['M', 'R'].includes(draft.type)
  const isArmor  = ['LA', 'MA', 'HA', 'S'].includes(draft.type)

  return (
    <div style={ed.wrap}>
      <div style={ed.headerRow}>
        <input value={draft.name || ''} onChange={e => set('name', e.target.value)}
          placeholder="Name" style={{ ...ed.input, flex: 1, fontSize: 18, fontWeight: 700 }} />
        <input value={draft.source || ''} onChange={e => set('source', e.target.value)}
          placeholder="Source (z.B. HB-MILES)" style={{ ...ed.input, width: 160 }} />
      </div>

      <div style={ed.grid}>
        <Field label="Typ">
          <select value={draft.type || ''} onChange={e => set('type', e.target.value)} style={ed.input}>
            {TYPE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </Field>
        <Field label="Rarity">
          <select value={draft.rarity || 'none'} onChange={e => set('rarity', e.target.value)} style={ed.input}>
            {RARITY_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Gewicht (lb)">
          <input type="number" step="0.1" value={draft.weight ?? ''} onChange={e => set('weight', e.target.value ? parseFloat(e.target.value) : null)} style={ed.input} />
        </Field>
        <Field label="Wert (Kupfer)">
          <input type="number" value={draft.value ?? ''} onChange={e => set('value', e.target.value ? parseInt(e.target.value, 10) : null)} style={ed.input} />
        </Field>
        {isArmor && (
          <Field label="AC">
            <input type="number" value={draft.ac ?? ''} onChange={e => set('ac', e.target.value ? parseInt(e.target.value, 10) : null)} style={ed.input} />
          </Field>
        )}
      </div>

      {isWeapon && (
        <div style={ed.grid}>
          <Field label="Damage">
            <input value={draft.dmg1 || ''} onChange={e => set('dmg1', e.target.value)} placeholder="1d8" style={ed.input} />
          </Field>
          <Field label="Damage Type">
            <select value={draft.dmgType || ''} onChange={e => set('dmgType', e.target.value)} style={ed.input}>
              {DMG_TYPE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </Field>
          <Field label="Weapon Category">
            <select value={draft.weaponCategory || ''} onChange={e => set('weaponCategory', e.target.value)} style={ed.input}>
              {WEAPON_CAT.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </Field>
        </div>
      )}

      <Field label="Attunement">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={!!draft.reqAttune}
            onChange={e => set('reqAttune', e.target.checked ? true : false)} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>verlangt Attunement</span>
          {draft.reqAttune && (
            <input value={typeof draft.reqAttune === 'string' ? draft.reqAttune : ''}
              onChange={e => set('reqAttune', e.target.value || true)}
              placeholder='z.B. "by a wizard"' style={{ ...ed.input, flex: 1 }} />
          )}
        </div>
      </Field>

      <Field label="Item-Beschreibung (Flavor)">
        <textarea value={draft.description || ''} onChange={e => set('description', e.target.value)}
          rows={3} placeholder="Allgemeine Beschreibung des Items (kein Action-Effekt)."
          style={{ ...ed.input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
      </Field>

      {/* ── Aktionen-Liste ──────────────────────────────────── */}
      <div style={{
        marginTop: 16, padding: 14, borderRadius: 10,
        background: 'var(--bg-inset)',
        border: '1px solid var(--accent-purple)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ ...ed.label, color: 'var(--accent-purple)', marginBottom: 0 }}>
            ⚙ Aktionen (im Sheet sichtbar wenn attuned + equipped)
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={addAction} style={ed.miniBtn}>+ Aktion</button>
        </div>
        {(!draft._hbActions || draft._hbActions.length === 0) && (
          <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            Keine Aktionen. Klick "+ Aktion" um eine hinzuzufügen — kann Action /
            Bonus Action / Reaction / Passiver Trigger sein.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(draft._hbActions || []).map(a => (
            <ActionBlock key={a.id} action={a}
              onChange={(patch) => setAction(a.id, patch)}
              onRemove={() => removeAction(a.id)}
            />
          ))}
        </div>
      </div>

      <div style={ed.footer}>
        <button type="button" onClick={onCancel} style={ed.cancelBtn}>Abbrechen</button>
        <button type="button" onClick={commit} style={ed.saveBtn}>Speichern</button>
      </div>
    </div>
  )
}

function ActionBlock({ action: a, onChange, onRemove }) {
  return (
    <div style={{
      padding: 10, borderRadius: 8,
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input value={a.name} onChange={e => onChange({ name: e.target.value })}
          placeholder="Action-Name" style={{ ...ed.input, flex: 1, fontWeight: 700 }} />
        <select value={a.cost} onChange={e => onChange({ cost: e.target.value })} style={{ ...ed.input, width: 160 }}>
          {ACTION_COSTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <button type="button" onClick={onRemove} style={{ ...ed.miniBtn, color: 'var(--accent-red)' }}>×</button>
      </div>
      <Field label="Beschreibung">
        <textarea value={a.description} onChange={e => onChange({ description: e.target.value })}
          rows={2} placeholder="z.B. you can speak the command word, the wand fires…"
          style={{ ...ed.input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
      </Field>
      <div style={ed.grid}>
        <Field label="Damage (Würfel)">
          <input value={a.damageDice} onChange={e => onChange({ damageDice: e.target.value })}
            placeholder="3d6" style={ed.input} />
        </Field>
        <Field label="Damage-Type">
          <select value={a.damageType} onChange={e => onChange({ damageType: e.target.value })} style={ed.input}>
            {DMG_TYPE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </Field>
        <Field label="Attack-Bonus (optional)">
          <input value={a.attackBonus} onChange={e => onChange({ attackBonus: e.target.value })}
            placeholder="z.B. +7" style={ed.input} />
        </Field>
      </div>
      <div style={ed.grid}>
        <Field label="Save-Ability (optional)">
          <select value={a.saveAbility} onChange={e => onChange({ saveAbility: e.target.value })} style={ed.input}>
            {SAVE_ABILITIES.map(s => <option key={s} value={s}>{s ? s.toUpperCase() : '(kein Save)'}</option>)}
          </select>
        </Field>
        <Field label="Save-DC">
          <input value={a.saveDc} onChange={e => onChange({ saveDc: e.target.value })}
            placeholder="15" style={ed.input} />
        </Field>
      </div>
      <div style={ed.grid}>
        <Field label="Charges max (0 = kein Limit)">
          <input type="number" min="0" value={a.chargesMax}
            onChange={e => onChange({ chargesMax: parseInt(e.target.value, 10) || 0 })}
            style={ed.input} />
        </Field>
        {a.chargesMax > 0 && (
          <>
            <Field label="Charges/Aktivierung">
              <input type="number" min="1" value={a.chargesCost}
                onChange={e => onChange({ chargesCost: parseInt(e.target.value, 10) || 1 })}
                style={ed.input} />
            </Field>
            <Field label="Reset">
              <select value={a.chargesRest} onChange={e => onChange({ chargesRest: e.target.value })} style={ed.input}>
                {REST_OPTS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </Field>
          </>
        )}
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
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  input: { width: '100%', padding: '8px 10px', fontSize: 13, background: 'var(--bg-inset)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit' },
  miniBtn: { padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 },
  footer: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 },
  cancelBtn: { padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 },
  saveBtn: { padding: '8px 20px', borderRadius: 8, border: '2px solid var(--accent)', background: 'var(--accent)', color: 'var(--bg-base, #111)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700 },
}
