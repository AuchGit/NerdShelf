// RaceEditor.jsx
//
// Strukturierter Homebrew-Race-Editor. Liefert ein 5etools-konformes
// race-Object (mit ability, size, speed, darkvision, language/skill/
// weapon/armorProficiencies, additionalSpells, entries) zurück, das
// die existierende loadRaceList-Pipeline direkt konsumiert. Dazu
// jeweils ein '_localMeta'-Block für Persistenz.

import { useState, useEffect } from 'react'
import EntryRenderer from '../../../character-builder/components/ui/EntryRenderer'
import GrantSpellPicker from './GrantSpellPicker'
import SpellListLink from './SpellListLink'

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha']
const SIZE_OPTS = [
  { v: 'T', l: 'Tiny' },
  { v: 'S', l: 'Small' },
  { v: 'M', l: 'Medium' },
  { v: 'L', l: 'Large' },
]
const COMMON_LANGUAGES = ['Common', 'Dwarvish', 'Elvish', 'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc', 'Abyssal', 'Celestial', 'Draconic', 'Deep Speech', 'Infernal', 'Primordial', 'Sylvan', 'Undercommon']
const COMMON_SKILLS = ['Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History', 'Insight', 'Intimidation', 'Investigation', 'Medicine', 'Nature', 'Perception', 'Performance', 'Persuasion', 'Religion', 'Sleight of Hand', 'Stealth', 'Survival']
const TOOL_OPTS = ['Thieves\' Tools', 'Herbalism Kit', 'Smith\'s Tools', 'Tinker\'s Tools', 'Disguise Kit', 'Forgery Kit', 'Cartographer\'s Tools', 'Cook\'s Utensils']
const WEAPON_PROF_OPTS = ['Simple Weapons', 'Martial Weapons', 'Longsword', 'Shortsword', 'Longbow', 'Shortbow', 'Rapier', 'Hand Crossbow']
const ARMOR_PROF_OPTS = ['Light Armor', 'Medium Armor', 'Heavy Armor', 'Shields']

export default function RaceEditor({ entry, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => initFromEntry(entry))
  useEffect(() => setDraft(initFromEntry(entry)), [entry?._localMeta?.id, entry?.name])

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const toggleInList = (key, value) => setDraft(d => {
    const arr = d[key] || []
    const has = arr.includes(value)
    return { ...d, [key]: has ? arr.filter(x => x !== value) : [...arr, value] }
  })

  function setAbility(ab, val) {
    const next = { ...(draft.abilityBonuses || {}) }
    if (val === 0 || !val) delete next[ab]
    else next[ab] = parseInt(val, 10)
    set('abilityBonuses', next)
  }

  function commit() {
    // Komponiere 5etools-shape race-object
    const out = {
      name: draft.name.trim() || 'Unbenannte Rasse',
      source: draft.source.trim() || 'HB',
      size: [draft.size || 'M'],
      speed: { walk: parseInt(draft.speed, 10) || 30 },
      _localMeta: draft._localMeta,
    }
    // Ability-Bonus-Array im 5etools-Format
    const abEntries = Object.entries(draft.abilityBonuses || {}).filter(([, v]) => v)
    if (abEntries.length > 0) {
      out.ability = [Object.fromEntries(abEntries)]
    }
    if (draft.darkvision) out.darkvision = parseInt(draft.darkvision, 10) || 60
    // Proficiencies — alle als 5etools-shape arrays
    if (draft.languages?.length > 0) {
      out.languageProficiencies = [Object.fromEntries(draft.languages.map(l => [l.toLowerCase(), true]))]
    }
    if (draft.skills?.length > 0) {
      out.skillProficiencies = [Object.fromEntries(draft.skills.map(s => [s.toLowerCase(), true]))]
    }
    if (draft.tools?.length > 0) {
      out.toolProficiencies = [Object.fromEntries(draft.tools.map(t => [t.toLowerCase(), true]))]
    }
    if (draft.weapons?.length > 0) {
      out.weaponProficiencies = [Object.fromEntries(draft.weapons.map(w => [w.toLowerCase(), true]))]
    }
    if (draft.armor?.length > 0) {
      out.armorProficiencies = [Object.fromEntries(draft.armor.map(a => [a.toLowerCase(), true]))]
    }
    // Granted spells via additionalSpells (5etools shape) —
    // level-keyed: { known: {"1": [...], "3": [...]}, innate: {...} }
    // genau wie offizielle Race-Daten (Tiefling: Thaumaturgy @1,
    // Hellish Rebuke @3, Darkness @5).
    if (draft.grants?.length > 0) {
      const known = {}, innate = {}, prepared = {}
      for (const g of draft.grants) {
        const lvl = String(g.level || 1)
        const bucket = g.mode === 'innate' ? innate
          : g.mode === 'prepared' ? prepared : known
        if (!bucket[lvl]) bucket[lvl] = []
        bucket[lvl].push(g.spellName.toLowerCase())
      }
      const block = {}
      if (Object.keys(known).length > 0) block.known = known
      if (Object.keys(innate).length > 0) block.innate = innate
      if (Object.keys(prepared).length > 0) block.prepared = prepared
      if (Object.keys(block).length > 0) out.additionalSpells = [block]
    }
    // Traits → entries. Per-Trait level wird als zusätzliches Feld
    // `_hbLevel` mitgegeben (kein 5etools-Standard, aber die Engine
    // gateet darauf — Default 1 wenn nicht gesetzt = sofort aktiv).
    const entries = []
    if (draft.description) entries.push(draft.description)
    for (const t of (draft.traits || [])) {
      if (!t.name && !t.text) continue
      const traitBlock = {
        type: 'entries',
        name: t.name || 'Trait',
        entries: [t.text || ''],
      }
      if (t.level && t.level > 1) traitBlock._hbLevel = t.level
      entries.push(traitBlock)
    }
    if (entries.length > 0) out.entries = entries
    if (draft.spellListIds?.length) out.spellListIds = draft.spellListIds
    onSave(out)
  }

  const previewEntries = []
  if (draft.description) previewEntries.push(draft.description)
  for (const t of (draft.traits || [])) {
    if (t.name || t.text) previewEntries.push({
      type: 'entries', name: t.name || 'Trait', entries: [t.text || ''],
    })
  }

  return (
    <div style={ed.wrap}>
      <div style={ed.headerRow}>
        <input value={draft.name} onChange={e => set('name', e.target.value)}
          placeholder="Rassen-Name" style={{ ...ed.input, flex: 1, fontSize: 18, fontWeight: 700 }} />
        <input value={draft.source} onChange={e => set('source', e.target.value)}
          placeholder="Source" style={{ ...ed.input, width: 160 }} />
      </div>

      <div style={ed.grid}>
        <Field label="Größe">
          <select value={draft.size} onChange={e => set('size', e.target.value)} style={ed.input}>
            {SIZE_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </Field>
        <Field label="Speed (ft)">
          <input type="number" value={draft.speed} onChange={e => set('speed', e.target.value)} style={ed.input} />
        </Field>
        <Field label="Darkvision (ft, 0 = keins)">
          <input type="number" value={draft.darkvision} onChange={e => set('darkvision', e.target.value)} style={ed.input} />
        </Field>
      </div>

      <Field label="Ability Bonuses">
        <div style={ed.grid}>
          {ABILITIES.map(ab => (
            <div key={ab} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 30, color: '#9aa3b4', fontSize: 11, fontWeight: 700 }}>{ab.toUpperCase()}</span>
              <input type="number" value={draft.abilityBonuses?.[ab] || ''}
                onChange={e => setAbility(ab, e.target.value)}
                placeholder="0" style={{ ...ed.input, width: 70 }} />
            </div>
          ))}
        </div>
      </Field>

      <Field label="Sprachen">
        <ChipMultiSelect options={COMMON_LANGUAGES} selected={draft.languages || []}
          onToggle={v => toggleInList('languages', v)} />
      </Field>
      <Field label="Skill Proficiencies">
        <ChipMultiSelect options={COMMON_SKILLS} selected={draft.skills || []}
          onToggle={v => toggleInList('skills', v)} />
      </Field>
      <Field label="Tool Proficiencies">
        <ChipMultiSelect options={TOOL_OPTS} selected={draft.tools || []}
          onToggle={v => toggleInList('tools', v)} />
      </Field>
      <Field label="Weapon Proficiencies">
        <ChipMultiSelect options={WEAPON_PROF_OPTS} selected={draft.weapons || []}
          onToggle={v => toggleInList('weapons', v)} />
      </Field>
      <Field label="Armor Proficiencies">
        <ChipMultiSelect options={ARMOR_PROF_OPTS} selected={draft.armor || []}
          onToggle={v => toggleInList('armor', v)} />
      </Field>

      <Field label="Allgemeine Beschreibung">
        <textarea value={draft.description || ''} onChange={e => set('description', e.target.value)}
          rows={3} placeholder="Flavor / Hintergrund-Text der Rasse."
          style={{ ...ed.input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
      </Field>

      {/* Traits — benannte Sub-Features (Fey Ancestry, Stonecunning, Lucky etc.) */}
      <TraitList traits={draft.traits || []}
        onChange={(next) => set('traits', next)} />

      {/* Granted Spells */}
      <div style={{
        marginTop: 16, padding: 14, borderRadius: 10,
        background: '#0f1115',
        border: '1px solid #7aa2f7',
      }}>
        <div style={ed.label}>📖 Gewährte Spells (zur Rasse gehörig)</div>
        <div style={{ color: '#9aa3b4', fontSize: 11, marginBottom: 10 }}>
          Spells die jeder Charakter dieser Rasse automatisch bekommt
          (z.B. Tiefling: Thaumaturgy als known, Hellish Rebuke als 1/day).
        </div>
        <GrantSpellPicker
          grants={draft.grants || []}
          onChange={(next) => set('grants', next)}
        />
      </div>

      <SpellListLink value={draft.spellListIds}
        onChange={(v) => set('spellListIds', v)}
        whatHasIt="diese Rasse" />

      <div style={{ marginTop: 16 }}>
        <div style={ed.label}>Vorschau</div>
        <div style={{
          padding: '10px 14px',
          background: '#171a21',
          border: '1px solid #2a3040', borderRadius: 8,
        }}>
          <div style={{ fontWeight: 700, color: '#7aa2f7', marginBottom: 4 }}>
            {draft.name || '(unbenannt)'}
            <span style={{ marginLeft: 8, fontSize: 11, color: '#6b7386' }}>
              {SIZE_OPTS.find(o => o.v === draft.size)?.l || 'Medium'} · {draft.speed || 30} ft.
              {draft.darkvision ? ` · Darkvision ${draft.darkvision} ft.` : ''}
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

// ── Helpers ─────────────────────────────────────────────────

function initFromEntry(entry) {
  if (!entry) return blankRace()
  // Reverse-engineering aus 5etools-shape (für Template-Load)
  const out = blankRace()
  out.name = entry.name || ''
  out.source = entry.source || 'HB'
  out._localMeta = entry._localMeta || {}
  out.spellListIds = Array.isArray(entry.spellListIds) ? entry.spellListIds : []
  if (Array.isArray(entry.size)) out.size = entry.size[0] || 'M'
  if (typeof entry.speed === 'number') out.speed = entry.speed
  else if (entry.speed?.walk) out.speed = entry.speed.walk
  out.darkvision = entry.darkvision || 0
  if (Array.isArray(entry.ability) && entry.ability[0]) {
    out.abilityBonuses = { ...entry.ability[0] }
    delete out.abilityBonuses.choose
  }
  const flat = (arr) => {
    if (!Array.isArray(arr)) return []
    const out = []
    for (const block of arr) {
      if (!block || typeof block !== 'object') continue
      for (const [k, v] of Object.entries(block)) {
        if (v === true && k !== 'choose' && k !== 'any' && k !== 'anyStandard') {
          out.push(k.charAt(0).toUpperCase() + k.slice(1))
        }
      }
    }
    return out
  }
  out.languages = flat(entry.languageProficiencies)
  out.skills    = flat(entry.skillProficiencies)
  out.tools     = flat(entry.toolProficiencies)
  out.weapons   = flat(entry.weaponProficiencies)
  out.armor     = flat(entry.armorProficiencies)
  // Entries — first string is description, named sub-entries become traits
  if (Array.isArray(entry.entries)) {
    for (const e of entry.entries) {
      if (typeof e === 'string') {
        if (!out.description) out.description = e
      } else if (e && typeof e === 'object' && e.name && Array.isArray(e.entries)) {
        out.traits.push({
          id: `t-${Math.random().toString(36).slice(2, 8)}`,
          name: e.name,
          text: e.entries.filter(x => typeof x === 'string').join('\n\n'),
          level: e._hbLevel || 1,
        })
      }
    }
  }
  // additionalSpells → grants (best-effort, mit Level-Erhalt)
  if (Array.isArray(entry.additionalSpells)) {
    for (const block of entry.additionalSpells) {
      if (!block || typeof block !== 'object') continue
      for (const mode of ['known', 'innate', 'prepared']) {
        const td = block[mode]
        if (!td || typeof td !== 'object') continue
        for (const [lvlKey, vals] of Object.entries(td)) {
          const lvl = parseInt(lvlKey, 10) || 1
          const items = Array.isArray(vals) ? vals : Object.values(vals || {}).flat()
          for (const s of items) {
            const name = typeof s === 'string' ? s.split('|')[0]
              : s?.name ? s.name : null
            if (!name) continue
            out.grants.push({
              spellName: name.replace(/\b\w/g, c => c.toUpperCase()).trim(),
              source: '',
              mode,
              level: lvl,
            })
          }
        }
      }
    }
  }
  return out
}

function blankRace() {
  return {
    name: '',
    source: 'HB',
    spellListIds: [],
    size: 'M',
    speed: 30,
    darkvision: 0,
    abilityBonuses: {},
    languages: ['Common'],
    skills: [],
    tools: [],
    weapons: [],
    armor: [],
    description: '',
    traits: [],
    grants: [],
    _localMeta: {},
  }
}

function ChipMultiSelect({ options, selected, onToggle }) {
  const [custom, setCustom] = useState('')
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {options.map(o => {
          const on = selected.includes(o)
          return (
            <button key={o} type="button" onClick={() => onToggle(o)}
              style={on ? ed.chipOn : ed.chip}>{o}</button>
          )
        })}
      </div>
      {selected.filter(s => !options.includes(s)).map(s => (
        <button key={s} type="button" onClick={() => onToggle(s)} style={ed.chipOn}>{s} ×</button>
      ))}
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <input value={custom} onChange={e => setCustom(e.target.value)}
          placeholder="Eigenen Eintrag hinzufügen…"
          style={{ ...ed.input, flex: 1, fontSize: 11 }} />
        <button type="button" style={ed.miniBtn} onClick={() => {
          if (custom.trim()) { onToggle(custom.trim()); setCustom('') }
        }}>+</button>
      </div>
    </div>
  )
}

function TraitList({ traits, onChange }) {
  const add = () => onChange([...(traits || []), {
    id: `t-${Date.now()}-${Math.floor(Math.random()*1e4)}`,
    name: '', text: '', level: 1,
  }])
  const set = (id, patch) => onChange(traits.map(t => t.id === id ? { ...t, ...patch } : t))
  const remove = (id) => onChange(traits.filter(t => t.id !== id))
  return (
    <div style={{
      marginTop: 16, padding: 14, borderRadius: 10,
      background: '#0f1115',
      border: '1px solid #b07afe',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ ...ed.label, color: '#b07afe', marginBottom: 0 }}>
          ✨ Traits (benannte Sub-Features wie Fey Ancestry, Lucky, …)
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={add} style={ed.miniBtn}>+ Trait</button>
      </div>
      {traits.length === 0 && (
        <div style={{ color: '#6b7386', fontSize: 12 }}>
          Keine Traits. "+ Trait" für benannte Features (erscheinen auf dem Sheet im "Race Traits"-Block). Per-Trait <b>Level</b> bestimmt ab wann das Trait aktiv wird (z.B. Aasimar bekommt manche Traits erst ab L3).
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {traits.map(t => (
          <div key={t.id} style={{ padding: 8, background: '#171a21', border: '1px solid #2a3040', borderRadius: 6 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <input value={t.name} onChange={e => set(t.id, { name: e.target.value })}
                placeholder="Trait-Name (z.B. Lucky)" style={{ ...ed.input, flex: 1, fontWeight: 700 }} />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#9aa3b4', fontSize: 11 }}>
                ab L
                <input type="number" min="1" max="20" value={t.level || 1}
                  onChange={e => set(t.id, { level: Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)) })}
                  style={{ width: 44, padding: '4px 6px', fontSize: 11, background: '#0f1115', color: '#e6e8ee', border: '1px solid #2a3040', borderRadius: 4, fontFamily: 'inherit', textAlign: 'center' }}
                  title="Charakter-Level ab dem dieses Trait aktiv wird" />
              </label>
              <button type="button" onClick={() => remove(t.id)}
                style={{ ...ed.miniBtn, color: '#f7768e' }}>×</button>
            </div>
            <textarea value={t.text} onChange={e => set(t.id, { text: e.target.value })}
              rows={2} placeholder="Trait-Beschreibung."
              style={{ ...ed.input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return <div style={{ marginBottom: 12 }}><div style={ed.label}>{label}</div>{children}</div>
}

const ed = {
  wrap: { padding: 20, borderRadius: 12, background: '#171a21', border: '1px solid #2a3040', marginBottom: 16 },
  headerRow: { display: 'flex', gap: 8, marginBottom: 16 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 12 },
  label: { fontSize: 11, fontWeight: 700, color: '#9aa3b4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  input: { width: '100%', padding: '8px 10px', fontSize: 13, background: '#0f1115', color: '#e6e8ee', border: '1px solid #2a3040', borderRadius: 6, fontFamily: 'inherit' },
  miniBtn: { padding: '4px 10px', borderRadius: 6, border: '1px solid #2a3040', background: '#171a21', color: '#9aa3b4', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 },
  chip: { padding: '3px 9px', borderRadius: 6, fontSize: 11, background: '#0f1115', color: '#9aa3b4', border: '1px solid #2a3040', cursor: 'pointer', fontFamily: 'inherit' },
  chipOn: { padding: '3px 9px', borderRadius: 6, fontSize: 11, background: 'color-mix(in srgb, #7aa2f7 22%, transparent)', color: '#7aa2f7', border: '1px solid #7aa2f7', cursor: 'pointer', fontFamily: 'inherit' },
  footer: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 },
  cancelBtn: { padding: '8px 16px', borderRadius: 8, border: '1px solid #2a3040', background: 'transparent', color: '#9aa3b4', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 },
  saveBtn: { padding: '8px 20px', borderRadius: 8, border: '2px solid #7aa2f7', background: '#7aa2f7', color: '#0f1115', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700 },
}
