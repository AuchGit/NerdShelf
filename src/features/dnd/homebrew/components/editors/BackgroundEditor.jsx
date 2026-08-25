// BackgroundEditor.jsx
//
// Strukturierter Homebrew-Background-Editor — 5etools-konform.
// Felder: name, source, skill/tool/lang-Proficiencies (mit choose-Optionen),
// ability-Bonus-Wahl, Feat-Ref, Description + Characteristics-Entries.
// Output direkt von loadBackgroundList konsumierbar.

import { useState, useEffect } from 'react'
import { Section, Field, ek } from './editorKit'
import SpellListLink from './SpellListLink'

const SKILL_OPTS = [
  'acrobatics','animal handling','arcana','athletics','deception','history',
  'insight','intimidation','investigation','medicine','nature','perception',
  'performance','persuasion','religion','sleight of hand','stealth','survival',
]
const TOOL_OPTS = [
  "thieves' tools","disguise kit","forgery kit","herbalism kit",
  "smith's tools","tinker's tools","cartographer's tools","cook's utensils",
  "alchemist's supplies","calligrapher's supplies","mason's tools",
  "navigator's tools","painter's supplies","poisoner's kit","leatherworker's tools",
  "carpenter's tools","glassblower's tools","jeweler's tools",
  "potter's tools","weaver's tools","woodcarver's tools",
]
const ABILITIES = ['str','dex','con','int','wis','cha']

function initFromEntry(entry) {
  const out = blank()
  if (!entry) return out
  out.name = entry.name || ''
  out.source = entry.source || 'HB'
  out._localMeta = entry._localMeta || {}
  out.spellListIds = Array.isArray(entry.spellListIds) ? entry.spellListIds : []
  // Skills
  if (Array.isArray(entry.skillProficiencies)) {
    for (const b of entry.skillProficiencies) {
      if (b?.choose) {
        out.skillChoose.count = b.choose.count || 2
        out.skillChoose.from = (b.choose.from || []).map(s => s.toLowerCase())
        out.skillChoose.enabled = true
      } else if (b && typeof b === 'object') {
        for (const [k, v] of Object.entries(b)) {
          if (v === true) out.skills.push(k.toLowerCase())
        }
      }
    }
  }
  // Tools
  if (Array.isArray(entry.toolProficiencies)) {
    for (const b of entry.toolProficiencies) {
      if (b?.choose) {
        out.toolChoose.count = b.choose.count || 1
        out.toolChoose.from = (b.choose.from || []).map(s => s.toLowerCase())
        out.toolChoose.enabled = true
      } else if (b && typeof b === 'object') {
        for (const [k, v] of Object.entries(b)) {
          if (v === true) out.tools.push(k.toLowerCase())
        }
      }
    }
  }
  // Languages
  if (Array.isArray(entry.languageProficiencies)) {
    for (const b of entry.languageProficiencies) {
      if (b?.choose) {
        out.langChoose.count = b.choose.count || 1
        out.langChoose.from = b.choose.from || ['anyStandard']
        out.langChoose.enabled = true
      } else if (typeof b?.anyStandard === 'number') {
        out.langChoose.count = b.anyStandard
        out.langChoose.from = ['anyStandard']
        out.langChoose.enabled = true
      } else if (b && typeof b === 'object') {
        for (const [k, v] of Object.entries(b)) {
          if (v === true) out.languages.push(k)
        }
      }
    }
  }
  // Ability
  if (Array.isArray(entry.ability)) {
    for (const b of entry.ability) {
      if (b?.choose?.weighted) {
        // 2024 weighted Variante — wir nehmen den Default 3-Point-Set
        out.abilityChoice.enabled = true
        out.abilityChoice.from = b.choose.weighted.from || ['str','dex','con','int','wis','cha']
        out.abilityChoice.points = (b.choose.weighted.weights || [2,1]).reduce((s, x) => s + x, 0)
      } else if (b?.choose) {
        out.abilityChoice.enabled = true
        out.abilityChoice.from = b.choose.from || ABILITIES
        out.abilityChoice.points = (b.choose.amount || 1) * (b.choose.count || 1)
      }
    }
  }
  // Feats
  if (Array.isArray(entry.feats)) {
    for (const b of entry.feats) {
      if (b && typeof b === 'object') {
        for (const k of Object.keys(b)) {
          if (b[k] === true) {
            const cleaned = k.split('|')[0].trim()
            if (cleaned) out.feats.push(cleaned)
          }
        }
      }
    }
  }
  // Entries
  if (Array.isArray(entry.entries)) {
    const strings = entry.entries.filter(e => typeof e === 'string')
    out.description = strings.join('\n\n')
  }
  return out
}

function blank() {
  return {
    name: '',
    source: 'HB',
    skills: [],
    skillChoose: { enabled: false, count: 2, from: [] },
    tools: [],
    toolChoose: { enabled: false, count: 1, from: [] },
    languages: [],
    langChoose: { enabled: false, count: 1, from: ['anyStandard'] },
    abilityChoice: { enabled: false, from: ['str','dex','con','int','wis','cha'], points: 3 },
    feats: [],
    description: '',
    spellListIds: [],
    _localMeta: {},
  }
}

export default function BackgroundEditor({ entry, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => initFromEntry(entry))
  useEffect(() => setDraft(initFromEntry(entry)), [entry?._localMeta?.id, entry?.name])

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const toggleList = (key, value) => setDraft(d => {
    const arr = d[key] || []
    const has = arr.includes(value)
    return { ...d, [key]: has ? arr.filter(x => x !== value) : [...arr, value] }
  })

  function commit() {
    const out = {
      name: draft.name.trim() || 'Unbenannter Background',
      source: draft.source.trim() || 'HB',
      _localMeta: draft._localMeta,
    }
    // Skills
    const skillBlocks = []
    if (draft.skills.length > 0) {
      const fix = {}
      for (const s of draft.skills) fix[s] = true
      skillBlocks.push(fix)
    }
    if (draft.skillChoose.enabled && draft.skillChoose.from.length > 0) {
      skillBlocks.push({ choose: { from: draft.skillChoose.from, count: draft.skillChoose.count || 1 } })
    }
    if (skillBlocks.length) out.skillProficiencies = skillBlocks
    // Tools
    const toolBlocks = []
    if (draft.tools.length > 0) {
      const fix = {}
      for (const t of draft.tools) fix[t] = true
      toolBlocks.push(fix)
    }
    if (draft.toolChoose.enabled && draft.toolChoose.from.length > 0) {
      toolBlocks.push({ choose: { from: draft.toolChoose.from, count: draft.toolChoose.count || 1 } })
    }
    if (toolBlocks.length) out.toolProficiencies = toolBlocks
    // Languages
    const langBlocks = []
    if (draft.languages.length > 0) {
      const fix = {}
      for (const l of draft.languages) fix[l] = true
      langBlocks.push(fix)
    }
    if (draft.langChoose.enabled) {
      if (draft.langChoose.from.includes('anyStandard') && draft.langChoose.from.length === 1) {
        langBlocks.push({ anyStandard: draft.langChoose.count || 1 })
      } else if (draft.langChoose.from.length > 0) {
        langBlocks.push({ choose: { from: draft.langChoose.from, count: draft.langChoose.count || 1 } })
      }
    }
    if (langBlocks.length) out.languageProficiencies = langBlocks
    // Ability bonus
    if (draft.abilityChoice.enabled && draft.abilityChoice.from.length > 0) {
      out.ability = [{
        choose: {
          from: draft.abilityChoice.from,
          amount: 1,
          count: draft.abilityChoice.points || 3,
        },
      }]
    }
    // Feats
    if (draft.feats.length > 0) {
      out.feats = [Object.fromEntries(draft.feats.map(f => [f.toLowerCase(), true]))]
    }
    // Entries
    if (draft.description.trim()) {
      out.entries = draft.description.split(/\n\n+/).map(s => s.trim()).filter(Boolean)
    }
    if (draft.spellListIds?.length) out.spellListIds = draft.spellListIds
    onSave(out)
  }

  return (
    <div style={ek.wrap}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <input value={draft.name} onChange={e => set('name', e.target.value)}
          placeholder="Background-Name" style={{ ...ek.input, flex: 1, fontSize: 16, fontWeight: 700 }} />
        <input value={draft.source} onChange={e => set('source', e.target.value)}
          placeholder="Source" style={{ ...ek.input, width: 140 }} />
      </div>

      {/* Skill Proficiencies */}
      <Section title="Skill Proficiencies" accent="#7aa2f7"
        subtitle="Fixed grants und optional Wahl-Block">
        <Field label="Fest gewährt">
          <ChipMulti options={SKILL_OPTS} selected={draft.skills}
            onToggle={v => toggleList('skills', v)} />
        </Field>
        <label style={{ ...ek.checkRow, marginTop: 8 }}>
          <input type="checkbox" checked={draft.skillChoose.enabled}
            onChange={e => set('skillChoose', { ...draft.skillChoose, enabled: e.target.checked })} />
          <span>Plus: Spieler wählt aus einer Liste</span>
        </label>
        {draft.skillChoose.enabled && (
          <div style={ek.grid}>
            <Field label="Anzahl Wahlen">
              <input type="number" min="1" max="6" value={draft.skillChoose.count}
                onChange={e => set('skillChoose', { ...draft.skillChoose, count: parseInt(e.target.value, 10) || 1 })}
                style={ek.input} />
            </Field>
            <Field label="Aus diesen Skills">
              <ChipMulti options={SKILL_OPTS} selected={draft.skillChoose.from}
                onToggle={v => {
                  const has = draft.skillChoose.from.includes(v)
                  set('skillChoose', {
                    ...draft.skillChoose,
                    from: has ? draft.skillChoose.from.filter(x => x !== v) : [...draft.skillChoose.from, v],
                  })
                }} />
            </Field>
          </div>
        )}
      </Section>

      {/* Tool Proficiencies */}
      <Section title="Tool Proficiencies" accent="#4dd0e1"
        subtitle="Fest gewährte Werkzeuge / Kits">
        <Field label="Fest gewährt">
          <ChipMulti options={TOOL_OPTS} selected={draft.tools}
            onToggle={v => toggleList('tools', v)} />
        </Field>
        <label style={{ ...ek.checkRow, marginTop: 8 }}>
          <input type="checkbox" checked={draft.toolChoose.enabled}
            onChange={e => set('toolChoose', { ...draft.toolChoose, enabled: e.target.checked })} />
          <span>Plus: Spieler wählt</span>
        </label>
        {draft.toolChoose.enabled && (
          <div style={ek.grid}>
            <Field label="Anzahl">
              <input type="number" min="1" value={draft.toolChoose.count}
                onChange={e => set('toolChoose', { ...draft.toolChoose, count: parseInt(e.target.value, 10) || 1 })}
                style={ek.input} />
            </Field>
            <Field label="Auswahl-Liste">
              <ChipMulti options={TOOL_OPTS} selected={draft.toolChoose.from}
                onToggle={v => {
                  const has = draft.toolChoose.from.includes(v)
                  set('toolChoose', {
                    ...draft.toolChoose,
                    from: has ? draft.toolChoose.from.filter(x => x !== v) : [...draft.toolChoose.from, v],
                  })
                }} />
            </Field>
          </div>
        )}
      </Section>

      {/* Languages */}
      <Section title="Sprachen" accent="#9ece6a"
        subtitle="Fest gewährt oder per Spieler-Wahl (anyStandard = irgendeine Standard-Sprache)">
        <Field label="Fest gewährt">
          <FreeChips items={draft.languages}
            placeholder="Sprache hinzufügen (z.B. Elvish)"
            onChange={(arr) => set('languages', arr)} />
        </Field>
        <label style={{ ...ek.checkRow, marginTop: 8 }}>
          <input type="checkbox" checked={draft.langChoose.enabled}
            onChange={e => set('langChoose', { ...draft.langChoose, enabled: e.target.checked })} />
          <span>Plus: Spieler wählt</span>
        </label>
        {draft.langChoose.enabled && (
          <div style={ek.grid}>
            <Field label="Anzahl Wahlen">
              <input type="number" min="1" max="5" value={draft.langChoose.count}
                onChange={e => set('langChoose', { ...draft.langChoose, count: parseInt(e.target.value, 10) || 1 })}
                style={ek.input} />
            </Field>
            <Field label="Quelle"
              hint="anyStandard = jede Standard-Sprache. Sonst custom Liste">
              <FreeChips items={draft.langChoose.from}
                placeholder="anyStandard oder Elvish, …"
                onChange={(arr) => set('langChoose', { ...draft.langChoose, from: arr })} />
            </Field>
          </div>
        )}
      </Section>

      {/* Ability Bonus */}
      <Section title="Ability Score Bonus" accent="#ff9533"
        subtitle="5.5e-Style: Spieler verteilt X Punkte auf bestimmte Abilities">
        <label style={ek.checkRow}>
          <input type="checkbox" checked={draft.abilityChoice.enabled}
            onChange={e => set('abilityChoice', { ...draft.abilityChoice, enabled: e.target.checked })} />
          <span>Ability-Score-Bonus aktivieren</span>
        </label>
        {draft.abilityChoice.enabled && (
          <div style={ek.grid}>
            <Field label="Punkte zum Verteilen">
              <input type="number" min="1" max="6" value={draft.abilityChoice.points}
                onChange={e => set('abilityChoice', { ...draft.abilityChoice, points: parseInt(e.target.value, 10) || 3 })}
                style={ek.input} />
            </Field>
            <Field label="Aus diesen Abilities">
              <ChipMulti options={ABILITIES.map(a => ({ v: a, l: a.toUpperCase() }))}
                selected={draft.abilityChoice.from}
                onToggle={v => {
                  const has = draft.abilityChoice.from.includes(v)
                  set('abilityChoice', {
                    ...draft.abilityChoice,
                    from: has ? draft.abilityChoice.from.filter(x => x !== v) : [...draft.abilityChoice.from, v],
                  })
                }} />
            </Field>
          </div>
        )}
      </Section>

      {/* Feats */}
      <Section title="Origin Feat(s)" accent="#b07afe"
        subtitle="Feats die der Background mitgibt (z.B. 'Magic Initiate: Cleric')">
        <FreeChips items={draft.feats}
          placeholder="Feat-Name eintippen (z.B. Magic Initiate; Cleric)"
          onChange={(arr) => set('feats', arr)} />
      </Section>

      {/* Description */}
      <Section title="Beschreibung" accent="#9aa3b4"
        subtitle="Flavor-Text. Absätze mit Leerzeile trennen.">
        <textarea value={draft.description} onChange={e => set('description', e.target.value)}
          rows={6} placeholder="Background-Story, Persönlichkeitstreiber, …"
          style={{ ...ek.input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
      </Section>

      <SpellListLink value={draft.spellListIds}
        onChange={(v) => set('spellListIds', v)}
        whatHasIt="diesen Background" />

      <div style={ek.footer}>
        <button type="button" onClick={onCancel} style={ek.cancelBtn}>Abbrechen</button>
        <button type="button" onClick={commit} style={ek.saveBtn}>Speichern</button>
      </div>
    </div>
  )
}

// ── helpers ────────────────────────────────────────────────

function ChipMulti({ options, selected, onToggle }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map(o => {
        const v = typeof o === 'string' ? o : o.v
        const l = typeof o === 'string' ? capitalize(o) : o.l
        const on = selected.includes(v)
        return (
          <button key={v} type="button" onClick={() => onToggle(v)}
            style={on ? ek.chipOn : ek.chip}>{l}</button>
        )
      })}
    </div>
  )
}

function FreeChips({ items, placeholder, onChange }) {
  const [draft, setDraft] = useState('')
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
        {items.map(it => (
          <button key={it} type="button" style={ek.chipOn}
            onClick={() => onChange(items.filter(x => x !== it))}>
            {it} ×
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && draft.trim()) {
              e.preventDefault()
              if (!items.includes(draft.trim())) onChange([...items, draft.trim()])
              setDraft('')
            }
          }}
          placeholder={placeholder}
          style={{ ...ek.input, flex: 1, fontSize: 12 }} />
        <button type="button" style={ek.miniBtn}
          onClick={() => {
            if (draft.trim() && !items.includes(draft.trim())) {
              onChange([...items, draft.trim()])
              setDraft('')
            }
          }}>+</button>
      </div>
    </div>
  )
}

function capitalize(s) { return s.replace(/\b\w/g, c => c.toUpperCase()) }
