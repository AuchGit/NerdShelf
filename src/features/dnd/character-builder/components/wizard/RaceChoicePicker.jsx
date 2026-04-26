import { useState, useEffect, useMemo } from 'react'
import { loadSpellList, loadClassSpellNames, loadFeatList, loadOptionalFeatureList } from '../../lib/dataLoader'
import { parseTags } from '../../lib/tagParser'
import { parseFeatChoices, setChoiceValue } from '../../lib/choiceParser'
import { parseFeatProficiencies } from '../../lib/featParser'
import AdditionalSpellPicker, { UniversalSpellList } from './AdditionalSpellPicker'
import ChoicePicker from '../ui/ChoicePicker'
import EntryRenderer from '../ui/EntryRenderer'

// ═════════════════════════════════════════════════════════════════════════════
// RACE CHOICE PICKER  (enhanced)
//
// Handles all race/subrace choices:
//   • Spellcasting ability selection
//   • Multi-entry cantrip/spell option picks (e.g. Astral Elf)
//   • Auto-granted fixed spells (known, innate, expanded) with hover detail
//   • Interactive pool spell pickers (e.g. High Elf wizard cantrip)
//     — uses UniversalSpellList so every spell row has a hover tooltip
//       showing school, casting time, range, duration, components, source,
//       concentration and ritual flags — identical to AdditionalSpellPicker.
//   • Feat choices from race/subrace `feats` property
//     — Variant Human: any 1 feat from full list
//     — "from list" variants: restricted to named feats (e.g. Drow Descent)
//   • Variant feature option choices parsed from `entries` option blocks
//     — e.g. Drow Descent "Choose 1: Skill Versatility | Drow Magic"
//     — stored in selections.*.variantOptions (string[])
//
// Props:
//   raceChoices       any[]   – additionalSpells[] for the selected race
//   subraceChoices    any[]   – additionalSpells[] for the selected subrace
//   raceData          object  – raw race object (for feat + variant choices)
//   subraceData       object  – raw subrace object (for feat + variant choices)
//   selections        object  – { race: SelectionState, subrace: SelectionState }
//   onChange          fn      – (newSelections: object) => void
//   raceName          string  – display name of the race
//   subraceName       string  – display name of the subrace
//   edition           string  – '5e' | '5.5e' (optional, defaults to '5e')
//
// SelectionState = {
//   abilityScore:   string | null   e.g. 'CHA'
//   entryIdx:       number | null   which entry chosen in multi-entry mode
//   spells:         string[]        spell names chosen from pool choices
//   feats:          string[]        feat names chosen (Variant Human / restricted list)
//   variantOptions: string[]        option names chosen from variant feature blocks
// }
//
// Integration in Step3Race.jsx — pass raceData + subraceData:
//   <RaceChoicePicker
//     raceChoices    = {selectedRace?.additionalSpells    || []}
//     subraceChoices={effectiveSubraceSpells}
//     raceData       = {selectedRace    || null}
//     subraceData    = {selectedSubrace || null}
//     selections     = {character.species.raceChoices || {}}
//     onChange       = {sel => updateCharacter('species.raceChoices', sel)}
//     raceName       = {selectedRace?.name}
//     subraceName    = {selectedSubrace?.name}
//     edition        = {character.meta.edition}
//   />
// ═════════════════════════════════════════════════════════════════════════════


// ─────────────────────────────────────────────────────────────────────────────
// SCHOOL METADATA  (mirrors AdditionalSpellPicker for consistent colours)
// ─────────────────────────────────────────────────────────────────────────────

const SCHOOL_CODE_TO_FULL = {
  a: 'abjuration',   c: 'conjuration', d: 'divination',  e: 'enchantment',
  v: 'evocation',    i: 'illusion',    n: 'necromancy',   t: 'transmutation',
  p: 'psionic',      u: 'universal',
}

const SCHOOL_COLORS = {
  A: 'var(--accent-blue)', C: 'var(--accent-purple)', D: 'var(--accent-green)', E: 'var(--accent-pink)',
  V: 'var(--accent-red)', I: 'var(--accent-purple)', N: 'var(--text-muted)', T: 'var(--accent)',
  P: 'var(--accent-green)',
}


// ─────────────────────────────────────────────────────────────────────────────
// ABILITY METADATA
// ─────────────────────────────────────────────────────────────────────────────

const ABILITY_INFO = {
  STR: { name: 'Stärke',       icon: '▲', color: 'var(--accent)' },
  DEX: { name: 'Geschickl.',   icon: '◈', color: 'var(--accent-green)' },
  CON: { name: 'Konstitution', icon: '♥', color: 'var(--accent-red)' },
  INT: { name: 'Intelligenz',  icon: '◑', color: 'var(--accent-blue)' },
  WIS: { name: 'Weisheit',     icon: '◐', color: 'var(--accent-purple)' },
  CHA: { name: 'Charisma',     icon: '✦', color: 'var(--accent)' },
}


// ─────────────────────────────────────────────────────────────────────────────
// SPELL COMPONENT STRING HELPER
// ─────────────────────────────────────────────────────────────────────────────

function getComponentString(components) {
  if (!components) return null
  if (typeof components === 'string') return components
  const parts = []
  if (components.v) parts.push('V')
  if (components.s) parts.push('S')
  if (components.m) {
    const mat   = typeof components.m === 'string' ? components.m : (components.m?.text || 'Material')
    const short = mat.length > 40 ? mat.slice(0, 38) + '…' : mat
    parts.push(`M (${short})`)
  }
  return parts.length ? parts.join(', ') : null
}


// ─────────────────────────────────────────────────────────────────────────────
// RAW DATA HELPERS  (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────

function normName(raw) {
  if (!raw || typeof raw !== 'string') return ''
  const base = raw.split('|')[0].split('#')[0].trim()
  if (!base || base.startsWith('@')) return ''
  return base.replace(/\b\w/g, c => c.toUpperCase())
}

function isCantripFlag(raw) {
  return typeof raw === 'string' && raw.includes('#c')
}

function isChooseStr(s) {
  return typeof s === 'string' && s.trim().toLowerCase().startsWith('choose')
}

function parseChooseFilter(str, count = 1) {
  if (!str || typeof str !== 'string') return null
  const f = { minLevel: null, maxLevel: null, schools: [], classes: [], count }
  let s = str.trim().toLowerCase()
  if (s.startsWith('choose|')) s = s.slice(7)
  else if (s === 'choose') return f
  s.split('|').forEach(p => {
    if (p.startsWith('level=')) {
      const vals = p.slice(6).split(';').map(Number).filter(n => !isNaN(n))
      if (vals.length) { f.minLevel = Math.min(...vals); f.maxLevel = Math.max(...vals) }
    } else if (p.startsWith('class=')) {
      f.classes.push(
        ...p.slice(6).split(';').map(c => c.charAt(0).toUpperCase() + c.slice(1)),
      )
    } else if (p.startsWith('school=')) {
      f.schools.push(...p.slice(7).split(';'))
    }
  })
  return f
}

// Berechnet Spell-Vorschau pro _versions-Optionsname.
// Gibt { [optionName]: { fixedKnown: [{name, isCantrip}], innate: [{name, charLevel, freq}] } } zurück.
function buildVariantSpellPreviews(dataObj) {
  if (!dataObj?._versions?.length) return {}
  const previews = {}
  for (const version of dataObj._versions) {
    const parts = (version.name || '').split('; ')
    const optName = parts[parts.length - 1]
    if (!optName) continue

    // Effektive Spells dieser Version bestimmen (gleiche Semantik wie parseVersionedChoices)
    let spellBlocks
    if (Object.prototype.hasOwnProperty.call(version, 'additionalSpells')) {
      spellBlocks = version.additionalSpells ?? []
    } else {
      spellBlocks = dataObj.additionalSpells || []
    }

    const fixedKnown = []
    const innate = []
    for (const block of (spellBlocks || [])) {
      if (block.known) {
        for (const val of Object.values(block.known)) {
          collectKnown(val, fixedKnown, [])
        }
      }
      if (block.innate) {
        for (const [lvlStr, val] of Object.entries(block.innate)) {
          collectInnate(val, parseInt(lvlStr, 10), innate)
        }
      }
    }
    previews[optName] = { fixedKnown, innate }
  }
  return previews
}

function collectKnown(val, fixedKnown, poolChoices) {
  if (!val) return
  if (typeof val === 'string') {
    if (isChooseStr(val)) {
      const f = parseChooseFilter(val)
      if (f) poolChoices.push(f)
    } else {
      const name = normName(val)
      if (name) fixedKnown.push({ name, isCantrip: isCantripFlag(val) })
    }
    return
  }
  if (Array.isArray(val)) { val.forEach(v => collectKnown(v, fixedKnown, poolChoices)); return }
  if (typeof val === 'object') {
    if ('choose' in val) {
      const f = parseChooseFilter(val.choose, typeof val.count === 'number' ? val.count : 1)
      if (f) poolChoices.push(f)
      return
    }
    if ('_' in val) {
      const items = Array.isArray(val._) ? val._ : [val._]
      items.forEach(i => collectKnown(i, fixedKnown, poolChoices))
      return
    }
    for (const subVal of Object.values(val)) {
      if (typeof subVal === 'object' && !Array.isArray(subVal)) {
        for (const spells of Object.values(subVal)) collectKnown(spells, fixedKnown, poolChoices)
      } else {
        collectKnown(subVal, fixedKnown, poolChoices)
      }
    }
  }
}

function collectInnate(val, charLevel, out) {
  if (!val) return
  if (Array.isArray(val)) {
    val.forEach(s => { const n = normName(s); if (n) out.push({ name: n, charLevel, freq: 'at will' }) })
    return
  }
  if (typeof val === 'string') {
    const n = normName(val)
    if (n) out.push({ name: n, charLevel, freq: 'at will' })
    return
  }
  if (typeof val === 'object') {
    for (const [freq, freqVal] of Object.entries(val)) {
      if (typeof freqVal === 'object') {
        for (const [count, spells] of Object.entries(freqVal)) {
          ;(Array.isArray(spells) ? spells : [spells]).forEach(s => {
            const n = normName(s)
            if (n) out.push({ name: n, charLevel, freq: `${count}×/Tag` })
          })
        }
      }
    }
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN CHOICE PARSER  (exported — used externally if needed)
// ─────────────────────────────────────────────────────────────────────────────

export function parseChoices(choices) {
  if (!Array.isArray(choices) || choices.length === 0) return null

  const entries = choices.map((entry, idx) => {
    const e = {
      idx,
      abilityOptions: null,
      fixedAbility:   null,
      fixedKnown:     [],
      innate:         [],
      expanded:       [],
      poolChoices:    [],
    }

    if (entry.ability) {
      if (typeof entry.ability === 'string') {
        e.fixedAbility = entry.ability.toUpperCase()
      } else if (entry.ability?.choose?.length) {
        e.abilityOptions = entry.ability.choose.map(a => a.toUpperCase())
      }
    }

    if (entry.known) {
      for (const val of Object.values(entry.known)) {
        collectKnown(val, e.fixedKnown, e.poolChoices)
      }
    }

    if (entry.innate) {
      for (const [charLvl, val] of Object.entries(entry.innate)) {
        collectInnate(val, parseInt(charLvl, 10), e.innate)
      }
    }

    if (entry.expanded) {
      for (const [key, spells] of Object.entries(entry.expanded)) {
        const lvl = parseInt(key.startsWith('s') ? key.slice(1) : key, 10)
        ;(Array.isArray(spells) ? spells : [spells]).forEach(s => {
          const n = normName(s)
          if (n) e.expanded.push({ name: n, spellLevel: isNaN(lvl) ? 0 : lvl })
        })
      }
    }

    return e
  })

  const isMultiEntry     = entries.length > 1
  const hasAbilityChoice = entries.some(e => e.abilityOptions !== null)
  const hasPoolChoices   = entries.some(e => e.poolChoices.length > 0)
  const hasFixed         = entries.some(
    e => e.fixedKnown.length + e.innate.length + e.expanded.length > 0,
  )
  const hasAnything = hasAbilityChoice || isMultiEntry || hasPoolChoices || hasFixed

  return { hasAnything, isMultiEntry, hasAbilityChoice, hasPoolChoices, hasFixed, entries }
}


// ─────────────────────────────────────────────────────────────────────────────
// SPELL POOL FILTERING HELPER
// ─────────────────────────────────────────────────────────────────────────────

function getPoolCandidates(pool, allSpells, classSpellMaps) {
  let candidates = allSpells

  if (pool.minLevel !== null) candidates = candidates.filter(s => s.level >= pool.minLevel)
  if (pool.maxLevel !== null) candidates = candidates.filter(s => s.level <= pool.maxLevel)

  if (pool.schools && pool.schools.length > 0) {
    candidates = candidates.filter(s => {
      const fullSchool = SCHOOL_CODE_TO_FULL[s.school?.toLowerCase()] || s.school?.toLowerCase() || ''
      return pool.schools.some(sc => sc.toLowerCase() === fullSchool)
    })
  }

  if (pool.classes && pool.classes.length > 0 && Object.keys(classSpellMaps).length > 0) {
    candidates = candidates.filter(s => {
      const nameLower = s.name.toLowerCase()
      return pool.classes.some(cls => {
        const nameSet = classSpellMaps[cls.toLowerCase()]
        return nameSet && nameSet.has(nameLower)
      })
    })
  }

  return candidates
}

// Collect all class names mentioned across pool choices for lazy loading
function extractRequiredClasses(parsed) {
  const classes = new Set()
  if (!parsed) return classes
  for (const entry of parsed.entries) {
    for (const pool of entry.poolChoices) {
      for (const cls of (pool.classes || [])) classes.add(cls.toLowerCase())
    }
  }
  return classes
}

// True when a parsed choice group has non-pool content worth showing in the detail column
function hasNonPoolContent(parsed) {
  if (!parsed?.hasAnything) return false
  const e = parsed.entries[0]
  return (
    e.abilityOptions !== null  ||
    e.fixedAbility   !== null  ||
    parsed.isMultiEntry        ||
    e.fixedKnown.length > 0    ||
    e.innate.length > 0        ||
    e.expanded.length > 0
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// RICH SPELL DETAIL PANEL  –  shown on hover, same info as AdditionalSpellPicker
// ─────────────────────────────────────────────────────────────────────────────

function SpellDetailFull({ spell }) {
  const schoolCode  = spell.school?.toUpperCase() || ''
  const schoolFull  = SCHOOL_CODE_TO_FULL[spell.school?.toLowerCase()] || spell.school || ''
  const schoolCap   = schoolFull ? schoolFull.charAt(0).toUpperCase() + schoolFull.slice(1) : ''
  const schoolColor = SCHOOL_COLORS[schoolCode] || 'var(--accent-blue)'
  const compStr     = getComponentString(spell.components)

  return (
    <div style={rc.detail}>
      <div style={rc.detailName}>{spell.name}</div>
      <div style={rc.detailSubhead}>
        <span>{spell.level === 0 ? 'Cantrip' : `Stufe ${spell.level}`}</span>
        {schoolCap && <span style={{ color: schoolColor }}> · {schoolCap}</span>}
      </div>
      <div style={rc.detailDivider} />
      <div style={rc.detailRows}>
        {spell.castingTime && <DetailRow icon="⚡" label="Aktion"  value={spell.castingTime} />}
        {spell.range       && <DetailRow icon="↔" label="Reichw." value={spell.range} />}
        {spell.duration    && <DetailRow icon="⏱" label="Dauer"   value={spell.duration} />}
        {compStr           && <DetailRow icon="◇" label="Komp."  value={compStr} />}
        {spell.source      && <DetailRow icon="§" label="Quelle" value={spell.source} />}
      </div>
      {(spell.concentration || spell.ritual) && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4, marginBottom: 6 }}>
          {spell.concentration && <span style={rc.concBadge}>⚡ Konz.</span>}
          {spell.ritual        && <span style={rc.ritBadge}>↻ Ritual</span>}
        </div>
      )}
      {spell.entries?.length > 0 && (
        <div style={rc.descWrap}>
          {renderSpellEntries(spell.entries)}
        </div>
      )}
    </div>
  )
}

// Fallback when full spell data hasn't loaded yet — shows what we already know
function SpellDetailBasic({ item }) {
  const sectionMeta = {
    known:    { label: 'Bekannter Zauber',   icon: '§' },
    innate:   { label: 'Angeborener Zauber', icon: '★' },
    expanded: { label: 'Erweiterter Zauber', icon: '§§' },
  }
  const meta = sectionMeta[item.section] || { label: 'Zauber', icon: '✦' }
  return (
    <div style={rc.detail}>
      <div style={rc.detailName}>{item.name}</div>
      <div style={rc.detailSubhead}>
        {item.isCantrip ? 'Zaubertrick · ' : ''}
        {meta.label}
      </div>
      <div style={rc.detailDivider} />
      <div style={rc.detailRows}>
        {item.isCantrip  && <DetailRow icon="✦" label="Typ"     value="Cantrip (Stufe 0)" />}
        {item.spellLevel > 0 && <DetailRow icon="★" label="Stufe"  value={`Stufe ${item.spellLevel}`} />}
        {item.charLevel  && <DetailRow icon="⚡" label="Erhält." value={`Ab Char-Stufe ${item.charLevel}`} />}
        {item.freq && item.freq !== 'at will' && (
          <DetailRow icon="↻" label="Nutzung" value={item.freq} />
        )}
      </div>
      <div style={rc.infoBadge}>
        {item.section === 'innate'   && 'Automatisch gewährt – keine Vorbereitung nötig.'}
        {item.section === 'expanded' && 'Erweitert die Zauberliste deiner Klasse.'}
        {item.section === 'known'    && 'Wird direkt bekannt – kein Slot verbraucht.'}
      </div>
    </div>
  )
}

function DetailRow({ icon, label, value }) {
  return (
    <div style={rc.detailRow}>
      <span style={rc.detailIcon}>{icon}</span>
      <span style={rc.detailLabel}>{label}:</span>
      <span style={rc.detailValue}>{value}</span>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// RENDER SPELL / FEAT ENTRIES  –  mirrors AdditionalSpellPicker approach.
// Handles the three common 5etools entry types:
//   • string   – plain paragraph
//   • list     – bulleted list (entry.items)
//   • entries  – named sub-section (entry.name + entry.entries)
// Tags like {@b text}, {@i text}, {@spell name} are stripped via parseTags().
// ─────────────────────────────────────────────────────────────────────────────

function renderSpellEntries(entries) {
  if (!entries || entries.length === 0) return null
  return entries.map((entry, i) => {
    // Plain string paragraph
    if (typeof entry === 'string') {
      return (
        <p key={i} style={rc.descPara}>
          {parseTags(entry)}
        </p>
      )
    }
    // Named sub-section with nested entries
    if (entry?.type === 'entries' || (entry?.name && entry?.entries)) {
      return (
        <div key={i} style={{ marginBottom: 6 }}>
          {entry.name && (
            <div style={rc.descSubhead}>{parseTags(entry.name)}</div>
          )}
          {renderSpellEntries(entry.entries)}
        </div>
      )
    }
    // Bulleted list
    if (entry?.type === 'list' && Array.isArray(entry.items)) {
      return (
        <ul key={i} style={rc.descList}>
          {entry.items.map((item, j) => (
            <li key={j} style={rc.descListItem}>
              {typeof item === 'string' ? parseTags(item) : renderSpellEntries([item])}
            </li>
          ))}
        </ul>
      )
    }
    // Inset / quote – treat like a paragraph
    if (entry?.type === 'inset' || entry?.type === 'quote') {
      return (
        <p key={i} style={{ ...rc.descPara, fontStyle: 'italic', color: 'var(--text-muted)' }}>
          {parseTags(entry.entries?.[0] || entry.text || '')}
        </p>
      )
    }
    return null
  })
}


// ─────────────────────────────────────────────────────────────────────────────
// DETAIL PANEL  –  right-hand side; selects the right sub-panel by item type
// Enhanced: 'spell' type now does a full allSpells lookup for rich metadata.
// ─────────────────────────────────────────────────────────────────────────────

function DetailPanel({ item, allSpells, allFeats = [] }) {
  if (!item) {
    return (
      <div style={rc.detailEmpty}>
        <div style={{ fontSize: 26, marginBottom: 6, opacity: 0.25 }}>✦</div>
        <div>Hover für<br />Details</div>
      </div>
    )
  }

  // ── Feat: rich lookup in allFeats first, fallback to stub ─────────────────
  if (item.type === 'feat') {
    const rich = allFeats.find(f => f.name?.toLowerCase() === item.feat?.name?.toLowerCase())
    return <FeatDetailPanel feat={rich ?? item.feat} />
  }

  // ── Spell: try rich lookup first ──────────────────────────────────────────
  if (item.type === 'spell') {
    const found = allSpells.find(s => s.name.toLowerCase() === item.name?.toLowerCase())
    return found ? <SpellDetailFull spell={found} /> : <SpellDetailBasic item={item} />
  }

  // ── Ability ───────────────────────────────────────────────────────────────
  if (item.type === 'ability') {
    const info = ABILITY_INFO[item.ability] || { name: item.ability, icon: '⭐', color: 'var(--text-muted)' }
    return (
      <div style={rc.detail}>
        <div style={rc.detailName}>{info.icon} {info.name}</div>
        <div style={rc.detailSubhead}>Zauberfähigkeit</div>
        <div style={rc.detailDivider} />
        <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.5, marginBottom: 10 }}>
          Bestimmt Zauberattacke und Rettungswurf-SG für alle Rassenzauber.
        </div>
        <div>
          <span style={{ ...rc.abilityBadge, color: info.color, borderColor: info.color + '55' }}>
            {item.ability}
          </span>
        </div>
      </div>
    )
  }

  // ── Multi-entry option ────────────────────────────────────────────────────
  if (item.type === 'entry') {
    const entry = item.entry
    return (
      <div style={rc.detail}>
        <div style={rc.detailName}>Option {item.idx + 1}</div>
        <div style={rc.detailSubhead}>Zauber-Variante</div>
        <div style={rc.detailDivider} />
        <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 8 }}>
          Diese Option gewährt:
        </div>
        {entry.fixedKnown.map(s => (
          <div key={s.name} style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: 'var(--accent-purple)' }}>{s.isCantrip ? '✦' : '§'}</span>
            <span>{s.name}</span>
            {s.isCantrip && <span style={rc.cantripBadge}>Cantrip</span>}
          </div>
        ))}
        {entry.innate.map(s => (
          <div key={s.name} style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>
            + {s.name} ab Stufe {s.charLevel}
          </div>
        ))}
      </div>
    )
  }

  // ── Variant feature option ────────────────────────────────────────────────
  if (item.type === 'variantOption') {
    const opt     = item.option
    const preview = opt._spellPreview   // NEU: aus _versions abgeleitet

    return (
      <div style={rc.detail}>
        <div style={rc.detailName}>{opt.name}</div>
        <div style={rc.detailSubhead}>Variant Feature · Option</div>
        <div style={rc.detailDivider} />

        {/* NEU: Spell-Vorschau aus _versions */}
        {preview?.fixedKnown?.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4, fontWeight: 'bold' }}>
              Gewährte Zauber:
            </div>
            {preview.fixedKnown.map(s => (
              <div key={s.name} style={rc.fixedRow}>
                <span style={rc.fixedCheck}>✓</span>
                <span style={rc.spellName}>{s.name}</span>
                {s.isCantrip && <span style={rc.cantripBadge}>Cantrip</span>}
              </div>
            ))}
          </div>
        )}
        {preview?.innate?.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4, fontWeight: 'bold' }}>
              Angeborene Zauber:
            </div>
            {preview.innate.map(s => (
              <div key={s.name} style={rc.fixedRow}>
                <span style={rc.fixedCheck}>✓</span>
                <span style={rc.spellName}>{s.name}</span>
                {s.charLevel && <span style={rc.charLvlBadge}>ab Stufe {s.charLevel}</span>}
                {s.freq && s.freq !== 'at will' && <span style={rc.freqBadge}>{s.freq}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Text-Beschreibung (wie bisher) */}
        {opt.entries?.length > 0
          ? <div style={rc.descWrap}>{renderSpellEntries(opt.entries)}</div>
          : (!preview?.fixedKnown?.length && !preview?.innate?.length &&
              <div style={rc.infoBadge}>Keine zusätzlichen Details verfügbar.</div>)
        }
      </div>
    )
  }

  // ── Pool choice info ──────────────────────────────────────────────────────
  if (item.type === 'pool') {
    const f = item.filter
    const lvlStr = f.minLevel !== null
      ? (f.minLevel === f.maxLevel ? `Stufe ${f.minLevel}` : `Stufe ${f.minLevel}–${f.maxLevel}`)
      : 'Beliebige Stufe'
    const classStr = f.classes?.length ? f.classes.join(', ') : 'Beliebig'
    return (
      <div style={rc.detail}>
        <div style={rc.detailName}>Zauberwahl</div>
        <div style={rc.detailSubhead}>Aus Klassenliste</div>
        <div style={rc.detailDivider} />
        <div style={rc.detailRows}>
          <DetailRow icon="◎" label="Anzahl" value={`${f.count} Zauber`} />
          <DetailRow icon="★" label="Level"  value={lvlStr} />
          <DetailRow icon="◇" label="Klasse" value={classStr} />
        </div>
      </div>
    )
  }

  return null
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Ability Score Choice
// ─────────────────────────────────────────────────────────────────────────────

function AbilitySection({ options, selected, onSelect, onHover }) {
  return (
    <div style={rc.section}>
      <div style={rc.sectionHeader}>
        <span style={rc.sectionTitle}>✦ Zauberfähigkeit</span>
        <span style={selected ? rc.doneBadge : rc.pendingBadge}>
          {selected ? '✓ Gewählt' : '1 wählen'}
        </span>
      </div>
      <div style={rc.abilityRow}>
        {options.map(ab => {
          const info = ABILITY_INFO[ab] || { name: ab, icon: '★', color: 'var(--text-muted)' }
          const isSel = selected === ab
          return (
            <div
              key={ab}
              style={{
                ...rc.abilityCard,
                ...(isSel ? { border: `2px solid ${info.color}`, background: 'var(--bg-hover)' } : {}),
              }}
              onClick={() => onSelect(ab === selected ? null : ab)}
              onMouseEnter={() => onHover({ type: 'ability', ability: ab })}
              onMouseLeave={() => onHover(null)}
            >
              <div style={{ fontSize: 20, lineHeight: 1 }}>{info.icon}</div>
              <div style={{ ...rc.abilityName, color: isSel ? info.color : 'var(--text-muted)' }}>{info.name}</div>
              <div style={{ ...rc.abilityCode, color: isSel ? info.color : 'var(--text-dim)' }}>{ab}</div>
              {isSel && <div style={{ ...rc.abilityCheck, color: info.color }}>✓</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Entry Choice  (multi-entry: pick 1 of N spell packages)
// ─────────────────────────────────────────────────────────────────────────────

function EntryChoiceSection({ entries, selectedIdx, onSelect, onHover }) {
  return (
    <div style={rc.section}>
      <div style={rc.sectionHeader}>
        <span style={rc.sectionTitle}>✦ Zauber wählen</span>
        <span style={selectedIdx !== null && selectedIdx !== undefined ? rc.doneBadge : rc.pendingBadge}>
          {selectedIdx !== null && selectedIdx !== undefined ? '✓ Gewählt' : `1 von ${entries.length}`}
        </span>
      </div>
      <div style={rc.entryList}>
        {entries.map(entry => {
          const isSel = selectedIdx === entry.idx
          return (
            <div
              key={entry.idx}
              style={{ ...rc.entryCard, ...(isSel ? rc.entryCardSel : {}) }}
              onClick={() => onSelect(entry.idx === selectedIdx ? null : entry.idx)}
              onMouseEnter={() => onHover({ type: 'entry', idx: entry.idx, entry })}
              onMouseLeave={() => onHover(null)}
            >
              <span style={{ ...rc.entryBullet, color: isSel ? 'var(--accent)' : 'var(--border)' }}>
                {isSel ? '◆' : '◇'}
              </span>
              <div style={{ flex: 1 }}>
                {entry.fixedKnown.map(s => (
                  <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ color: 'var(--accent-purple)', fontSize: 11 }}>{s.isCantrip ? '✦' : '§'}</span>
                    <span style={{ ...rc.spellName, color: isSel ? 'var(--accent)' : 'var(--text-secondary)' }}>
                      {s.name}
                    </span>
                    {s.isCantrip && <span style={rc.cantripBadge}>Cantrip</span>}
                  </div>
                ))}
                {entry.innate.map(s => (
                  <div key={s.name} style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 2 }}>
                    + {s.name} ab Stufe {s.charLevel}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Fixed Spells  (auto-granted — read-only rows with hover detail)
// ─────────────────────────────────────────────────────────────────────────────

// FIX Bug 3: isActive-Flag steuert visuellen Zustand (aktiv vs. inaktiv).
// isActive=false → Spell gehört zu einer nicht gewählten Variante.
function FixedSpellsSection({ items, title, icon, onHover, isActive = true }) {
  if (!items || items.length === 0) return null
  return (
    <div style={{ ...rc.section, opacity: isActive ? 1 : 0.4 }}>
      <div style={rc.sectionHeader}>
        <span style={rc.sectionTitle}>{icon} {title}</span>
        {isActive
          ? <span style={rc.autoBadge}>auto</span>
          : <span style={{
              ...rc.autoBadge,
              background: 'var(--bg-page)',
              color:       'var(--text-dim)',
              border:      '1px solid #1e2a3a',
            }}>inactive</span>
        }
      </div>
      <div style={rc.fixedList}>
        {items.map((item, i) => (
          <div
            key={`${item.name}-${i}`}
            style={rc.fixedRow}
            onMouseEnter={() => isActive && onHover?.({ type: 'spell', ...item })}
            onMouseLeave={() => onHover?.(null)}
          >
            <span style={{ ...rc.fixedCheck, color: isActive ? 'var(--accent-green)' : 'var(--border)' }}>
              {isActive ? '✓' : '○'}
            </span>
            <span style={{ ...rc.spellName, color: isActive ? undefined : 'var(--text-dim)' }}>
              {item.name}
            </span>
            {item.isCantrip                       && <span style={rc.cantripBadge}>Cantrip</span>}
            {item.spellLevel > 0                  && <span style={rc.lvlBadge}>Stufe {item.spellLevel}</span>}
            {item.charLevel                       && <span style={rc.charLvlBadge}>ab Stufe {item.charLevel}</span>}
            {item.freq && item.freq !== 'at will' && <span style={rc.freqBadge}>{item.freq}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Pool Spell Picker  (interactive – replaces old placeholder)
// Uses UniversalSpellList so every row has the same hover-tooltip experience
// as AdditionalSpellPicker.
// ─────────────────────────────────────────────────────────────────────────────

function PoolSpellSection({
  pool,
  allSpells,
  classSpellMaps,
  selectedSpells,
  onToggle,
  sourceLabel,
}) {
  const candidates = useMemo(
    () => getPoolCandidates(pool, allSpells, classSpellMaps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool, allSpells, JSON.stringify(classSpellMaps)],
  )

  // Spells selected that are actually candidates for THIS pool
  const poolSelected = useMemo(
    () => selectedSpells.filter(name =>
      candidates.some(s => s.name.toLowerCase() === name.toLowerCase()),
    ),
    [selectedSpells, candidates],
  )

  const poolDone = poolSelected.length >= pool.count

  // Build a descriptive label
  const minL = pool.minLevel
  const maxL = pool.maxLevel
  let lvlLabel
  if (minL === 0 && maxL === 0)       lvlLabel = 'Cantrip'
  else if (minL === maxL && minL !== null) lvlLabel = `Level-${minL}-Zauber`
  else if (minL === null && maxL === null) lvlLabel = 'Zauber (beliebiges Level)'
  else                                     lvlLabel = `Level-${minL ?? 0}–${maxL ?? 9}-Zauber`

  const classLabel = pool.classes?.length > 0
    ? ` · ${pool.classes.join('/')}-Liste`
    : ''

  const isLoadingClass = pool.classes?.length > 0
    && pool.classes.some(cls => classSpellMaps[cls.toLowerCase()] === undefined)

  return (
    <div style={rc.poolSection}>
      <div style={rc.sectionHeader}>
        <span style={rc.sectionTitle}>
          ⚅ Wähle {pool.count}× {lvlLabel}{classLabel}
          {sourceLabel ? <span style={{ color: 'var(--text-dim)', fontWeight: 'normal' }}> ({sourceLabel})</span> : null}
        </span>
        <span style={poolDone ? rc.doneBadge : rc.pendingBadge}>
          {poolSelected.length}/{pool.count}
        </span>
      </div>

      {isLoadingClass && (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>
          ⏳ Lade Klassenzauberliste…
        </div>
      )}

      {!isLoadingClass && candidates.length === 0 && (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: '6px 0', fontStyle: 'italic' }}>
          Keine passenden Zauber gefunden.
        </div>
      )}

      {!isLoadingClass && candidates.length > 0 && (
        <UniversalSpellList
          spells={candidates}
          selected={poolSelected}
          max={pool.count}
          onToggle={spell => onToggle(spell.name)}
        />
      )}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// FEAT DETAIL PANEL  –  shown when hovering a feat in the picker
// ─────────────────────────────────────────────────────────────────────────────

function FeatDetailPanel({ feat }) {
  if (!feat) return (
    <div style={rc.detailEmpty}>
      <div style={{ fontSize: 26, marginBottom: 6, opacity: 0.25 }}>★</div>
      <div>Hover für<br />Details</div>
    </div>
  )

  return (
    <div style={{ padding: 2 }}>
      <div style={{ color: 'var(--accent)', fontSize: 18, fontWeight: 'bold', marginBottom: 4 }}>
        {feat.name}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
        Source: {feat.source}
        {feat.category && ` · ${feat.category}`}
        {feat.isRepeatable && ' · wiederholbar'}
      </div>

      {feat.prerequisite && (
        <div style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', marginBottom: 10 }}>
          <span style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 'bold' }}>Prerequisite: </span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{formatFeatPrerequisite(feat.prerequisite)}</span>
        </div>
      )}

      {feat.ability?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {feat.ability.map((entry, i) => {
            if (entry.choose) {
              return (
                <div key={i} style={{ background: 'var(--bg-highlight)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', marginBottom: 4 }}>
                  <span style={{ color: 'var(--accent-green)', fontWeight: 'bold', fontSize: 12 }}>
                    +{entry.choose.count || 1} ASI
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {' '}(choose: {(entry.choose.from || []).join(', ').toUpperCase()})
                  </span>
                </div>
              )
            }
            const pairs = Object.entries(entry).filter(([, v]) => typeof v === 'number')
            if (pairs.length > 0) {
              return (
                <div key={i} style={{ background: 'var(--bg-highlight)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', marginBottom: 4 }}>
                  {pairs.map(([k, v]) => (
                    <span key={k} style={{ color: 'var(--accent-green)', fontWeight: 'bold', fontSize: 12, marginRight: 8 }}>
                      {k.toUpperCase()} +{v}
                    </span>
                  ))}
                </div>
              )
            }
            return null
          })}
        </div>
      )}

      <EntryRenderer entries={feat.entries} />
    </div>
  )
}

function formatFeatPrerequisite(prereq) {
  if (!prereq) return ''
  if (typeof prereq === 'string') return prereq
  if (Array.isArray(prereq)) {
    return prereq.map(p => {
      if (p.level) return `Level ${p.level.level}${p.level.class ? ' ' + p.level.class.name : ''}`
      if (p.ability) return Object.entries(p.ability).map(([k, v]) => `${k.toUpperCase()} ${v}+`).join(', ')
      if (p.race) return (p.race || []).map(r => r.name).join(' or ')
      if (p.spellcasting) return 'Spellcasting ability'
      return JSON.stringify(p)
    }).join('; ')
  }
  return JSON.stringify(prereq)
}


// ─────────────────────────────────────────────────────────────────────────────
// FULL FEAT PICKER  –  Step6-style two-panel layout for "any feat" mode
//
// Used for Variant Human: left panel = searchable list (click to view),
// right panel = detail + "Feat wählen" button.
// Renders full-width (like PoolSpellSection), outside the two-column layout.
// ─────────────────────────────────────────────────────────────────────────────

function FullFeatPicker({
  count,           // number of feats to pick (usually 1)
  allFeats,        // full feat list
  featsLoading,    // bool
  selectedFeatIds, // string[]
  onSelectFeat,    // (featObj: object) => void  – called with full feat object
  label,           // optional source label
}) {
  const [search,   setSearch]   = useState('')
  const [viewFeat, setViewFeat] = useState(null)

  const isDone = selectedFeatIds.length >= count

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return allFeats
    return allFeats.filter(f =>
      f.name?.toLowerCase().includes(q) ||
      f.source?.toLowerCase().includes(q),
    )
  }, [allFeats, search])

  return (
    <div style={rc.section}>
      <div style={rc.sectionHeader}>
        <span style={rc.sectionTitle}>
          ★ Feat wählen
          {label ? <span style={{ color: 'var(--text-dim)', fontWeight: 'normal' }}> ({label})</span> : null}
        </span>
        <span style={isDone ? rc.doneBadge : rc.pendingBadge}>
          {selectedFeatIds.length}/{count}
        </span>
      </div>

      {featsLoading && (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>⏳ Lade Feats…</div>
      )}

      {!featsLoading && allFeats.length === 0 && (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, fontStyle: 'italic' }}>
          Keine Feats gefunden.
        </div>
      )}

      {!featsLoading && allFeats.length > 0 && (
        <div style={rc.fullFeatLayout}>
          {/* LEFT — search + scrollable list */}
          <div style={rc.fullFeatLeft}>
            <input
              style={rc.featSearch}
              placeholder="Feat suchen…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div style={rc.fullFeatList}>
              {filtered.length === 0 && (
                <div style={{ color: 'var(--text-dim)', padding: 16, textAlign: 'center', fontSize: 12 }}>
                  Keine Ergebnisse.
                </div>
              )}
              {filtered.map(feat => {
                const isSel     = selectedFeatIds.includes(feat.name)
                const isViewing = viewFeat?.name === feat.name
                return (
                  <div
                    key={feat.name}
                    style={{
                      ...rc.fullFeatItem,
                      ...(isSel              ? rc.fullFeatItemSel     : {}),
                      ...(isViewing && !isSel ? rc.fullFeatItemViewing : {}),
                    }}
                    onClick={() => setViewFeat(feat)}
                  >
                    <div style={{ color: isSel ? 'var(--accent)' : 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 }}>
                      {feat.name}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                      {feat.source}
                      {feat.ability?.length > 0 && ' · +ASI'}
                      {feat.prerequisite ? ' · Prerequisite' : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* RIGHT — detail + select button */}
          <div style={rc.fullFeatRight}>
            {viewFeat ? (
              <>
                <div style={rc.fullFeatDetailScroll}>
                  <FeatDetailPanel feat={viewFeat} />
                </div>
                <div style={rc.fullFeatFooter}>
                  {(() => {
                    const isSel  = selectedFeatIds.includes(viewFeat.name)
                    const canSel = isSel || !isDone
                    return (
                      <button
                        style={{
                          ...rc.fullFeatBtn,
                          ...(isSel   ? rc.fullFeatBtnActive : {}),
                          ...(!canSel ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
                        }}
                        onClick={() => canSel && onSelectFeat(viewFeat)}
                      >
                        {isSel ? '✓ Gewählt' : 'Feat wählen'}
                      </button>
                    )
                  })()}
                </div>
              </>
            ) : (
              <div style={rc.fullFeatEmpty}>← Feat anklicken für Details</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// FEAT CHOICE SECTION  –  compact card list for restricted feat sets
//
// Used when the race/subrace restricts which feats are available (e.g. a
// Drow Descent subrace offering only "Skill Versatility" or "Drow Magic").
// Hovering a card fills the right-hand detail panel via onHover.
// For the full-list (Variant Human) case, use FullFeatPicker instead.
// ─────────────────────────────────────────────────────────────────────────────

function FeatChoiceSection({
  count,           // number of feats to pick
  allFeats,        // pre-filtered feat objects from the restricted list
  featsLoading,    // bool
  selectedFeatIds, // string[]  currently chosen feat names
  onToggle,        // (featName: string) => void
  onHover,         // (item | null) => void  – drives right-hand detail panel
  label,           // optional source label in header
}) {
  const isDone = selectedFeatIds.length >= count

  return (
    <div style={rc.section}>
      <div style={rc.sectionHeader}>
        <span style={rc.sectionTitle}>
          ★ Feat wählen
          {label ? <span style={{ color: 'var(--text-dim)', fontWeight: 'normal' }}> ({label})</span> : null}
        </span>
        <span style={isDone ? rc.doneBadge : rc.pendingBadge}>
          {selectedFeatIds.length}/{count}
        </span>
      </div>

      {featsLoading && (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>⏳ Lade Feats…</div>
      )}

      {!featsLoading && allFeats.length === 0 && (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, fontStyle: 'italic' }}>
          Keine Feats gefunden.
        </div>
      )}

      {!featsLoading && allFeats.length > 0 && (
        <div>
          {allFeats.map(feat => {
            const id      = feat.name
            const isSel   = selectedFeatIds.includes(id)
            const canPick = isSel || !isDone
            return (
              <div
                key={id}
                style={{
                  ...rc.featCard,
                  ...(isSel ? rc.featCardSel : {}),
                  opacity: canPick ? 1 : 0.45,
                  cursor:  canPick ? 'pointer' : 'not-allowed',
                }}
                onClick      = {() => canPick && onToggle(id)}
                onMouseEnter = {() => onHover?.({ type: 'feat', feat })}
                onMouseLeave = {() => onHover?.(null)}
              >
                <span style={{ color: isSel ? 'var(--accent)' : 'var(--border)', fontSize: 14, flexShrink: 0 }}>
                  {isSel ? '◆' : '◇'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ ...rc.featName, color: isSel ? 'var(--accent)' : 'var(--text-secondary)' }}>
                    {feat.name}
                  </div>
                  {feat.source && (
                    <div style={rc.featCategory}>{feat.source}</div>
                  )}
                </div>
                {isSel && (
                  <span style={{ color: 'var(--accent-green)', fontSize: 11, fontWeight: 'bold' }}>✓</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// CHOICE GROUP  –  non-pool sections for one source (race or subrace)
// Pool choices are lifted out and rendered separately (full-width) below.
// ─────────────────────────────────────────────────────────────────────────────

// FIX Bug 3: spellsActive=false → Spells dieser Gruppe gehören zu einer
// nicht-gewählten Variante und werden visuell deaktiviert dargestellt.
function ChoiceGroup({ parsed, sel, onUpdate, label, onHover, spellsActive = true }) {
  if (!parsed?.hasAnything) return null

  const isME    = parsed.isMultiEntry
  const entry0  = parsed.entries[0]
  const activeE = isME
    ? (sel.entryIdx != null ? parsed.entries[sel.entryIdx] : null)
    : entry0

  const abilityOptions = entry0?.abilityOptions
  const fixedKnown     = (activeE || entry0)?.fixedKnown || []
  const innate         = (activeE || entry0)?.innate      || []
  const expanded       = (activeE || entry0)?.expanded    || []

  const showFixed = !isME || (sel.entryIdx != null)

  // Nothing in this group except pool choices → skip (handled by parent)
  const hasVisibleContent =
    abilityOptions              ||
    entry0?.fixedAbility        ||
    isME                        ||
    (showFixed && fixedKnown.length > 0) ||
    innate.length > 0           ||
    expanded.length > 0

  if (!hasVisibleContent) return null

  return (
    <div style={rc.choiceGroup}>
      <div style={rc.groupLabel}>{label}</div>

      {/* 1. Spellcasting Ability Choice */}
      {abilityOptions && (
        <AbilitySection
          options={abilityOptions}
          selected={sel.abilityScore}
          onSelect={ab => onUpdate({ abilityScore: ab })}
          onHover={onHover}
        />
      )}

      {/* Fixed ability (no choice needed) */}
      {!abilityOptions && entry0?.fixedAbility && (
        <div style={rc.section}>
          <div style={rc.sectionHeader}>
            <span style={rc.sectionTitle}>✦ Zauberfähigkeit</span>
            <span style={rc.autoBadge}>fixiert</span>
          </div>
          <div style={rc.fixedRow}>
            <span style={rc.fixedCheck}>✓</span>
            <span style={rc.spellName}>
              {ABILITY_INFO[entry0.fixedAbility]?.name || entry0.fixedAbility}
            </span>
            <span style={{
              ...rc.abilityBadge,
              color:       ABILITY_INFO[entry0.fixedAbility]?.color || 'var(--text-muted)',
              borderColor: (ABILITY_INFO[entry0.fixedAbility]?.color || 'var(--text-muted)') + '55',
            }}>
              {entry0.fixedAbility}
            </span>
          </div>
        </div>
      )}

      {/* 2. Entry Choice (pick 1 of N spell packages) */}
      {isME && (
        <EntryChoiceSection
          entries={parsed.entries}
          selectedIdx={sel.entryIdx}
          onSelect={idx => onUpdate({ entryIdx: idx })}
          onHover={onHover}
        />
      )}

      {/* 3. Fixed known spells */}
      {showFixed && fixedKnown.length > 0 && (
        <FixedSpellsSection
          items={fixedKnown.map(s => ({ ...s, section: 'known' }))}
          title="Bekannte Zauber"
          icon="§"
          onHover={onHover}
          isActive={spellsActive}
        />
      )}

      {/* 4. Innate spells (by character level) */}
      {innate.length > 0 && (
        <FixedSpellsSection
          items={innate.map(s => ({ ...s, section: 'innate' }))}
          title="Angeborene Zauber"
          icon="★"
          onHover={onHover}
          isActive={spellsActive}
        />
      )}

      {/* 5. Expanded spell list */}
      {expanded.length > 0 && (
        <FixedSpellsSection
          items={expanded.map(s => ({ ...s, section: 'expanded' }))}
          title="Erweiterte Zauberliste"
          icon="§§"
          onHover={onHover}
          isActive={spellsActive}
        />
      )}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS HELPER
// ─────────────────────────────────────────────────────────────────────────────

function computeProgress(parsed, sel, activeEntry, variantOpts) {
  let total = 0, done = 0
  if (!parsed) return { total, done }

  const entry0 = parsed.entries[0]

  if (entry0?.abilityOptions)  { total++; if (sel.abilityScore) done++ }
  if (parsed.isMultiEntry)     { total++; if (sel.entryIdx != null) done++ }

  const poolChoices = activeEntry?.poolChoices || entry0?.poolChoices || []
  for (const pool of poolChoices) {
    total += pool.count
    done  += Math.min((sel.spells || []).length, pool.count)
  }

  // Variant feature options (e.g. Drow Descent "choose 1")
  if (variantOpts) {
    total += variantOpts.count
    done  += Math.min((sel.variantOptions || []).length, variantOpts.count)
  }

  return { total, done }
}


// ─────────────────────────────────────────────────────────────────────────────
// FEAT HELPERS  –  extract feat-choice metadata from raw race/subrace objects.
//
// Two data patterns exist in 5etools:
//   A) "any feat" (Variant Human):  feats: [{ choose: 1 }]  |  [{ any: 1 }]
//   B) "from list" (Drow Descent):  feats: [{ choose: { from: ["feat-a","feat-b"], count: 1 } }]
//
// getFeatChoiceCount  → how many feats to pick  (0 = no feat choice)
// getFeatChoiceFrom   → null (any) | string[] (restricted set of feat names)
// ─────────────────────────────────────────────────────────────────────────────

function getFeatChoiceCount(raceObj) {
  if (!raceObj?.feats || !Array.isArray(raceObj.feats)) return 0
  for (const entry of raceObj.feats) {
    if (entry == null) continue
    if (entry.any !== undefined)    return typeof entry.any === 'number' ? entry.any : 1
    if (entry.choose !== undefined) {
      if (typeof entry.choose === 'number') return entry.choose
      if (typeof entry.choose === 'object' && entry.choose !== null) {
        return entry.choose.count ?? 1
      }
      return 1
    }
  }
  return 0
}

// Returns null = pick from ALL feats, string[] = pick from this restricted list.
// The list contains raw id strings from the data (e.g. "skill-versatility-phb").
// We normalise them to Title Case names for display / matching against allFeats.
function getFeatChoiceFrom(raceObj) {
  if (!raceObj?.feats || !Array.isArray(raceObj.feats)) return null
  for (const entry of raceObj.feats) {
    if (entry == null) continue
    if (entry.choose && typeof entry.choose === 'object' && Array.isArray(entry.choose.from)) {
      // Normalise: strip source suffix, convert dashes to spaces, title-case
      return entry.choose.from.map(raw => {
        const base = raw.split('|')[0]
        return base
          .replace(/-/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase())
      })
    }
  }
  return null  // no restricted list → any feat
}


// ─────────────────────────────────────────────────────────────────────────────
// VARIANT OPTION PARSER
//
// Scans a race/subrace object's `entries` array for 5etools option blocks:
//   { type: 'options', count: N, entries: [ { type: 'entries', name, entries }, … ] }
//
// This covers patterns like Drow Descent's "Variant Feature (Choose 1)".
// Returns null when no such block exists.
// ─────────────────────────────────────────────────────────────────────────────

function parseVariantOptions(dataObj) {
  if (!dataObj?.entries || !Array.isArray(dataObj.entries)) return null

  function scanEntries(arr) {
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object') continue

      // ── Existing: type === 'options'  (count als Zahlen-Feld) ──────────────
      if (entry.type === 'options' && Array.isArray(entry.entries)) {
        const count   = typeof entry.count === 'number' ? entry.count : 1
        const options = entry.entries
          .filter(o => o?.name)
          .map(o => ({ name: String(o.name), entries: Array.isArray(o.entries) ? o.entries : [] }))
        if (options.length > 0) return { count, options }
      }

      // ── NEW: type === 'inset'  (count im name-String kodiert) ──────────────
      // Struktur: { type: 'inset', name: '… (Choose N) …', entries: [...] }
      // Beispiel: Half-Elf Variant-Unterrassen (SCAG) — Drow Descent etc.
      if (entry.type === 'inset' && Array.isArray(entry.entries)) {
        const match = typeof entry.name === 'string'
          ? entry.name.match(/\bChoose\s+(\d+)\b/i)
          : null
        const count   = match ? parseInt(match[1], 10) : 1
        const options = entry.entries
          .filter(o => o?.name)
          .map(o => ({ name: String(o.name), entries: Array.isArray(o.entries) ? o.entries : [] }))
        if (options.length > 0) return { count, options }
      }

      // ── Recurse one level into named sub-sections ──────────────────────────
      if (Array.isArray(entry.entries)) {
        const found = scanEntries(entry.entries)
        if (found) return found
      }
    }
    return null
  }

  return scanEntries(dataObj.entries)
}


// ─────────────────────────────────────────────────────────────────────────────
// FEAT ASI PARSER  –  derives fixedBonus + abilityChoices from feat.ability[]
// ─────────────────────────────────────────────────────────────────────────────

function parseFeatASI(feat) {
  const fixedBonus    = {}
  const abilityChoices = []
  for (const entry of (feat.ability || [])) {
    if (entry.choose) {
      abilityChoices.push({
        from:   entry.choose.from   || [],
        amount: entry.choose.amount || 1,
      })
    } else {
      for (const [k, v] of Object.entries(entry)) {
        if (typeof v === 'number') fixedBonus[k] = (fixedBonus[k] || 0) + v
      }
    }
  }
  return { fixedBonus, abilityChoices }
}


// ─────────────────────────────────────────────────────────────────────────────
// VARIANT OPTION CHOICE SECTION
//
// Renders a compact pick-up-to-N list of named variant feature options.
// Each card shows the option name; hovering sends it to the detail panel.
// ─────────────────────────────────────────────────────────────────────────────

function VariantOptionSection({ count, options, selectedNames, onToggle, onHover, label }) {
  const isDone = selectedNames.length >= count

  return (
    <div style={rc.section}>
      <div style={rc.sectionHeader}>
        <span style={rc.sectionTitle}>
          ✦ Variant Feature
          {label ? <span style={{ color: 'var(--text-dim)', fontWeight: 'normal' }}> ({label})</span> : null}
        </span>
        <span style={isDone ? rc.doneBadge : rc.pendingBadge}>
          {selectedNames.length}/{count}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {options.map(opt => {
          const isSel    = selectedNames.includes(opt.name)
          const canPick  = isSel || !isDone
          const inactive = isDone && !isSel   // chose something else — this one is discarded
          return (
            <div
              key={opt.name}
              style={{
                ...rc.featCard,
                ...(isSel    ? rc.featCardSel : {}),
                ...(inactive ? {
                  background:   'var(--bg-page)',
                  border:       '1px solid #151f2e',
                  opacity:      0.45,
                } : {}),
                cursor: canPick ? 'pointer' : 'not-allowed',
              }}
              onClick      = {() => canPick && onToggle(opt.name)}
              onMouseEnter = {() => !inactive && onHover?.({ type: 'variantOption', option: opt })}
              onMouseLeave = {() => onHover?.(null)}
            >
              <span style={{
                color:    isSel ? 'var(--accent)' : inactive ? 'var(--bg-hover)' : 'var(--border)',
                fontSize: 14,
                flexShrink: 0,
              }}>
                {isSel ? '◆' : inactive ? '✗' : '◇'}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{
                  ...rc.featName,
                  color:          isSel ? 'var(--accent)' : inactive ? 'var(--text-dim)' : 'var(--text-secondary)',
                  textDecoration: inactive ? 'line-through' : 'none',
                }}>
                  {opt.name}
                </div>
                {inactive && (
                  <div style={{ fontSize: 10, color: 'var(--border)', marginTop: 2 }}>
                    not chosen — inactive
                  </div>
                )}
              </div>
              {isSel && (
                <span style={{ color: 'var(--accent-green)', fontSize: 11, fontWeight: 'bold' }}>✓ Active</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// RACE FEAT ABILITY CHOICE PICKER
//
// Mirrors Step6's FeatAbilityChoicePicker but targets character.feats entries
// where _isRaceFeat === true.  Renders a <select> for each abilityChoices slot.
// ─────────────────────────────────────────────────────────────────────────────

const ABILITIES_RC = ['str', 'dex', 'con', 'int', 'wis', 'cha']

function RaceFeatAbilityChoicePicker({ featEntry, character, updateCharacter }) {
  if (!featEntry?.abilityChoices?.length) return null

  function handlePick(choiceIdx, ability) {
    const currentChoices = featEntry.choices?.abilityChoiceByIndex || {}
    const newChoiceMap   = { ...currentChoices, [choiceIdx]: ability }

    const fixedBase    = featEntry._fixedAbilityBonus || {}
    const chosenBonus  = {}
    for (const [, ab] of Object.entries(newChoiceMap)) {
      if (ab) chosenBonus[ab] = (chosenBonus[ab] || 0) + 1
    }

    const updatedFeat = {
      ...featEntry,
      choices: { ...featEntry.choices, abilityChoiceByIndex: newChoiceMap, abilityBonus: chosenBonus },
      abilityBonus: { ...fixedBase, ...chosenBonus },
    }

    updateCharacter('feats', [
      ...character.feats.filter(f => !(f._isRaceFeat && f.featId === featEntry.featId)),
      updatedFeat,
    ])
  }

  return (
    <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
      <div style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>
        Feat ASI wählen:
      </div>
      {featEntry.abilityChoices.map((choice, idx) => {
        const currentVal = featEntry.choices?.abilityChoiceByIndex?.[idx] || ''
        return (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>+{choice.amount || 1}:</span>
            <select
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-hover)', color: 'var(--text-primary)', fontSize: 13 }}
              value={currentVal}
              onChange={e => handlePick(idx, e.target.value)}
            >
              <option value="">— wählen —</option>
              {(choice.from?.length ? choice.from : ABILITIES_RC).map(ab => (
                <option key={ab} value={ab}>{ab.toUpperCase()}</option>
              ))}
            </select>
            {currentVal && (
              <span style={{ color: 'var(--accent-green)', fontSize: 12 }}>✓ {currentVal.toUpperCase()} +{choice.amount || 1}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// RACE FEAT OPT-CHOICE PICKER
//
// Renders non-proficiency feat choices (optfeature, variant) for a race feat.
// Mirrors FeatOptChoicePicker from Step6AbilityScores.
// Proficiency choices (skill, tool, language, weapon) live in Step7.
// ─────────────────────────────────────────────────────────────────────────────

function RaceFeatOptChoicePicker({ featData, edition, character, updateCharacter }) {
  const [optFeatures, setOptFeatures] = useState([])

  useEffect(() => {
    if (!featData?.optionalfeatureProgression?.length) return
    let cancelled = false
    loadOptionalFeatureList(edition || '5e').then(arr => {
      if (!cancelled) setOptFeatures(arr)
    })
    return () => { cancelled = true }
  }, [featData?.name, edition])

  if (!featData) return null

  const TYPES = ['optfeature', 'variant']
  const descriptors = parseFeatChoices(featData).filter(d => TYPES.includes(d.type))
  if (descriptors.length === 0) return null

  function handleChange(id, val) {
    const next = setChoiceValue(character.choices || {}, id, val)
    updateCharacter('choices', next)
  }

  return (
    <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
      <div style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 'bold', marginBottom: 10 }}>
        Feat-Auswahl:
      </div>
      {descriptors.map(d => {
        const opts = d.type === 'optfeature'
          ? optFeatures
              .filter(of => of.featureType?.some(t => d.filter?.featureTypes?.includes(t)))
              .map(of => ({
                value:       of.name,
                label:       of.name,
                description: (of.entries || []).find(e => typeof e === 'string')?.slice(0, 160) || '',
                meta:        { source: of.source },
              }))
          : d.options
        return (
          <div key={d.id} style={{ marginBottom: 12 }}>
            <ChoicePicker
              descriptor={d}
              value={(character.choices || {})[d.id] ?? null}
              onChange={val => handleChange(d.id, val)}
              options={opts}
            />
          </div>
        )
      })}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function RaceChoicePicker({
  raceChoices    = [],
  subraceChoices = [],
  raceData       = null,   // raw race object  (for feat choices)
  subraceData    = null,   // raw subrace object (for feat choices)
  selections     = {},
  onChange,
  raceName       = '',
  subraceName    = '',
  edition        = '5e',
  character      = null,   // full character object (for feat ASI/spell writes)
  updateCharacter = null,  // updater fn (for feat ASI/spell writes)
}) {
  const [hovered,        setHovered]        = useState(null)
  const [allSpells,      setAllSpells]      = useState([])
  const [classSpellMaps, setClassSpellMaps] = useState({})
  const [allFeats,       setAllFeats]       = useState([])
  const [featsLoading,   setFeatsLoading]   = useState(false)

  // ── Feat metadata derived from raw data objects ──────────────────────────
  const raceFeatCount    = getFeatChoiceCount(raceData)
  const subraceFeatCount = getFeatChoiceCount(subraceData)
  const raceFeatFrom     = getFeatChoiceFrom(raceData)     // null | string[]
  const subraceFeatFrom  = getFeatChoiceFrom(subraceData)  // null | string[]

  // ── Variant feature options (e.g. Drow Descent "Choose 1") ───────────────
  // Parsed from dataObj.entries looking for { type: 'options', count, entries }
  const raceVariantOpts    = useMemo(() => parseVariantOptions(raceData),    [raceData])
  const subraceVariantOpts = useMemo(() => parseVariantOptions(subraceData), [subraceData])
  // Spell-Vorschau aus _versions ableiten (für Hover-Details)
  const subraceVariantPreviews = useMemo(
    () => buildVariantSpellPreviews(subraceData),
    [subraceData]
  )
  const raceVariantPreviews = useMemo(
    () => buildVariantSpellPreviews(raceData),
    [raceData]
  )
  // Feat selection has moved to Step6AbilityScores (Origin Feat in standard racial bonus mode).
  // RaceChoicePicker no longer loads or renders feat pickers.
  // hasFeatChoices only drives early-out for variant option choices now.
  const hasFeatChoices = !!raceVariantOpts || !!subraceVariantOpts

  // ── Parse spell choices (memoized) ───────────────────────────────────────
  const raceParsed = useMemo(
    () => parseChoices(raceChoices),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(raceChoices)],
  )
  const subraceParsed = useMemo(
    () => parseChoices(subraceChoices),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(subraceChoices)],
  )

  // ── Load full spell list for hover + pool filtering ──────────────────────
  useEffect(() => {
    let cancelled = false
    loadSpellList(edition).then(spells => {
      if (!cancelled) setAllSpells(spells)
    })
    return () => { cancelled = true }
  }, [edition])

  // ── Load class spell lists needed for pool filtering (lazy) ──────────────
  useEffect(() => {
    const needed = new Set([
      ...extractRequiredClasses(raceParsed),
      ...extractRequiredClasses(subraceParsed),
    ])
    needed.forEach(cls => {
      if (classSpellMaps[cls] !== undefined) return
      const clsCap = cls.charAt(0).toUpperCase() + cls.slice(1)
      loadClassSpellNames(edition, clsCap).then(nameSet => {
        setClassSpellMaps(prev => ({ ...prev, [cls]: nameSet }))
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceParsed, subraceParsed, edition])

  // NOTE: Feat list loading removed — feat selection moved to Step6AbilityScores.

  // ── Early-out: nothing to render ─────────────────────────────────────────
  if (!raceParsed?.hasAnything && !subraceParsed?.hasAnything && !hasFeatChoices) return null

  // ── Selection state with safe defaults ───────────────────────────────────
  const raceSel    = selections.race    || { abilityScore: null, entryIdx: null, spells: [], feats: [], variantOptions: [] }
  const subraceSel = selections.subrace || { abilityScore: null, entryIdx: null, spells: [], feats: [], variantOptions: [] }

  function updateRaceSel(updates)    { onChange?.({ ...selections, race:    { ...raceSel,    ...updates } }) }
  function updateSubraceSel(updates) { onChange?.({ ...selections, subrace: { ...subraceSel, ...updates } }) }

  // ── Feat select helpers ─────────────────────────────────────────────────
  // Writes both raceChoices.*.feats[] and character.feats[].

  function buildRaceFeatEntry(feat) {
    const { fixedBonus, abilityChoices } = parseFeatASI(feat)
    const profData = parseFeatProficiencies(feat)
    return {
      featId:              feat.name,
      source:              feat.source,
      chosenAt:            'race',
      _isRaceFeat:         true,
      abilityBonus:        fixedBonus,
      _fixedAbilityBonus:  { ...fixedBonus },
      abilityChoices,
      additionalSpells:    feat.additionalSpells || [],
      choices:             {},
      skillProficiencies:  profData.skills.fixed,
      toolProficiencies:   profData.tools.fixed,
      weaponProficiencies: profData.weapons.fixed,
      armorProficiencies:  profData.armor.fixed,
      profChoices: {
        skills:  profData.skills.choice,
        tools:   profData.tools.choice,
        weapons: profData.weapons.choice,
      },
    }
  }

  // Normalise a feat name to its choices-key prefix, matching choiceParser.makeId().
  function featChoicePrefix(featName) {
    const id = (featName || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    return `feat:${id}:`
  }

  function cleanFeatChoices(featName) {
    if (!character || !updateCharacter || !featName) return
    const prefix = featChoicePrefix(featName)
    const cleaned = Object.fromEntries(
      Object.entries(character.choices || {}).filter(([k]) => !k.startsWith(prefix))
    )
    updateCharacter('choices', cleaned)
  }

  function handleRaceFeatSelect(feat) {
    const cur   = raceSel.feats || []
    const isSel = cur.includes(feat.name)
    if (isSel) {
      // Deselect: remove feat + clean choices
      updateRaceSel({ feats: cur.filter(n => n !== feat.name) })
      if (character && updateCharacter) {
        updateCharacter('feats', (character.feats || []).filter(
          f => !(f._isRaceFeat && f.featId === feat.name),
        ))
        cleanFeatChoices(feat.name)
      }
    } else if (raceFeatCount <= 1 && cur.length > 0) {
      // Replace: clean old feat choices, then add new
      const oldName = cur[0]
      updateRaceSel({ feats: [feat.name] })
      if (character && updateCharacter) {
        cleanFeatChoices(oldName)
        // Also clean incoming feat choices so it starts fresh
        cleanFeatChoices(feat.name)
        updateCharacter('feats', [
          ...(character.feats || []).filter(f => !(f._isRaceFeat && f.featId === oldName)),
          buildRaceFeatEntry(feat),
        ])
      }
    } else {
      updateRaceSel({ feats: [...cur, feat.name] })
      if (character && updateCharacter) {
        // Clean incoming feat choices so it starts fresh
        cleanFeatChoices(feat.name)
        updateCharacter('feats', [
          ...(character.feats || []).filter(f => !(f._isRaceFeat && f.featId === feat.name)),
          buildRaceFeatEntry(feat),
        ])
      }
    }
  }

  function handleSubraceFeatSelect(feat) {
    const cur   = subraceSel.feats || []
    const isSel = cur.includes(feat.name)
    if (isSel) {
      updateSubraceSel({ feats: cur.filter(n => n !== feat.name) })
      if (character && updateCharacter) {
        updateCharacter('feats', (character.feats || []).filter(
          f => !(f._isRaceFeat && f.featId === feat.name),
        ))
        cleanFeatChoices(feat.name)
      }
    } else {
      updateSubraceSel({ feats: [...cur, feat.name] })
      if (character && updateCharacter) {
        cleanFeatChoices(feat.name)
        updateCharacter('feats', [
          ...(character.feats || []).filter(f => !(f._isRaceFeat && f.featId === feat.name)),
          buildRaceFeatEntry(feat),
        ])
      }
    }
  }

  // ── Active entry for each group ───────────────────────────────────────────
  const activeRaceEntry = raceParsed?.isMultiEntry
    ? (raceSel.entryIdx != null ? raceParsed.entries[raceSel.entryIdx] : null)
    : (raceParsed?.entries[0] ?? null)
  const activeSubraceEntry = subraceParsed?.isMultiEntry
    ? (subraceSel.entryIdx != null ? subraceParsed.entries[subraceSel.entryIdx] : null)
    : (subraceParsed?.entries[0] ?? null)

  // ── Pool choices ──────────────────────────────────────────────────────────
  const racePools      = activeRaceEntry?.poolChoices    || []
  const subracePools   = activeSubraceEntry?.poolChoices || []
  const hasPoolChoices = racePools.length > 0 || subracePools.length > 0

  // ── Progress: spells + abilities + variant options ────────────────────────
  const raceProgress    = computeProgress(raceParsed,    raceSel,    activeRaceEntry,    raceVariantOpts)
  const subraceProgress = computeProgress(subraceParsed, subraceSel, activeSubraceEntry, subraceVariantOpts)
  // Progress excludes feats — feat selection has moved to Step6AbilityScores.
  const totalTotal = raceProgress.total + subraceProgress.total
  const totalDone  = raceProgress.done  + subraceProgress.done
  const allDone    = totalTotal > 0 && totalDone >= totalTotal

  // ── Two-column layout: show when any non-pool content exists ─────────────
  // Feat pickers have moved to Step6AbilityScores and no longer affect this layout.
  const showTwoCol =
    hasNonPoolContent(raceParsed)    ||
    hasNonPoolContent(subraceParsed) ||
    !!raceVariantOpts                ||
    !!subraceVariantOpts

  // ── Build feat list for "from" pickers (restricted set, no full load) ────
  // For "any feat" mode allFeats is loaded; for "from" mode we synthesise
  // minimal stub objects from the name list so FeatChoiceSection can render
  // without waiting for the full feat list.
  function featListFor(fromNames) {
    if (fromNames === null) return allFeats   // "any feat" → full list
    // "from list" → filter allFeats if loaded, else use stubs
    if (allFeats.length > 0) {
      const lower = fromNames.map(n => n.toLowerCase())
      const found = allFeats.filter(f => lower.includes(f.name?.toLowerCase()))
      if (found.length > 0) return found
    }
    // Fallback: minimal stubs (name only, no rich detail yet)
    return fromNames.map(name => ({ name }))
  }

  return (
    <div style={rc.wrapper}>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={rc.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={rc.headerIcon}>⚅</span>
          <span style={rc.headerTitle}>Rassen-Eigenschaften</span>
        </div>
        {totalTotal > 0 && (
          <span style={{ ...rc.progressBadge, color: allDone ? 'var(--accent-green)' : 'var(--accent)' }}>
            {allDone ? '✓ Alles gewählt' : `${totalDone} / ${totalTotal} gewählt`}
          </span>
        )}
      </div>

      {/* ── Two-Column Layout: non-pool + feat choices + hover detail ── */}
      {showTwoCol && (
        <div style={rc.layout}>

          {/* LEFT: scrollable choice groups */}
          <div style={rc.listPanel}>

          {/* ── RACE block ───────────────────────────────────────────── */}

            {/* Spell/ability choices for race */}
            {raceParsed?.hasAnything && (
              <ChoiceGroup
                parsed   = {raceParsed}
                sel      = {raceSel}
                onUpdate = {updateRaceSel}
                label    = {raceName || 'Rasse'}
                onHover  = {setHovered}
              />
            )}

            {/* Variant option choice for race */}
            {raceVariantOpts && (
              <div style={rc.choiceGroup}>
                {(raceParsed?.hasAnything || raceFeatCount > 0) && (
                  <div style={rc.groupLabel}>{raceName || 'Rasse'}</div>
                )}
                <VariantOptionSection
                  count         = {raceVariantOpts.count}
                  options       = {raceVariantOpts.options.map(o => ({
                    ...o,
                    _spellPreview: raceVariantPreviews[o.name] || null,   // NEU
                  }))}
                  selectedNames = {raceSel.variantOptions || []}
                  onToggle      = {name => {
                    const cur  = raceSel.variantOptions || []
                    const next = cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name]
                    updateRaceSel({ variantOptions: next })
                  }}
                  onHover = {setHovered}
                  label   = {raceName || null}
                />
              </div>
            )}

          {/* ── SUBRACE block  (order: VariantOpts → ChoiceGroup → Feats) ── */}

            {/* 1. Variant option choice for subrace — must come first */}
            {subraceVariantOpts && (
              <div style={rc.choiceGroup}>
                {subraceParsed?.hasAnything && (
                  <div style={rc.groupLabel}>{subraceName || 'Unterrasse'}</div>
                )}
                <VariantOptionSection
                  count         = {subraceVariantOpts.count}
                  options       = {subraceVariantOpts.options.map(o => ({
                    ...o,
                    _spellPreview: subraceVariantPreviews[o.name] || null,   // NEU
                  }))}
                  selectedNames = {subraceSel.variantOptions || []}
                  onToggle      = {name => {
                    const cur  = subraceSel.variantOptions || []
                    const next = cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name]
                    updateSubraceSel({ variantOptions: next })
                  }}
                  onHover = {setHovered}
                  label   = {subraceName || null}
                />
              </div>
            )}

            {/* 2. Spell/ability choices for subrace — locked until variant chosen */}
            {subraceParsed?.hasAnything && (() => {
              const locked = !!(subraceVariantOpts && (subraceSel.variantOptions || []).length === 0)
              // FIX Bug 3: spellsActive=false wenn Variant-Options vorhanden aber noch
              // keine gewählt → Spells werden als "inactive" (ausgegraut) dargestellt.
              const spellsActive = !subraceVariantOpts || (subraceSel.variantOptions || []).length > 0
              return (
                <div style={locked ? { pointerEvents: 'none', opacity: 0.35, position: 'relative' } : {}}>
                  {locked && (
                    <div style={{
                      fontSize: 11, color: 'var(--accent)', background: 'var(--bg-deep)',
                      border: '1px solid #4a3a0a', borderRadius: 6,
                      padding: '4px 10px', marginBottom: 6,
                    }}>
                      ⬆ Wähle zuerst ein Variant Feature
                    </div>
                  )}
                  <ChoiceGroup
                    parsed       = {subraceParsed}
                    sel          = {subraceSel}
                    onUpdate     = {updateSubraceSel}
                    label        = {subraceName || 'Unterrasse'}
                    onHover      = {setHovered}
                    spellsActive = {spellsActive}
                  />
                </div>
              )
            })()}

          </div>

          {/* RIGHT: hover detail panel */}
          <div style={rc.detailPanel}>
            <DetailPanel item={hovered} allSpells={allSpells} allFeats={allFeats} />
          </div>
        </div>
      )}

      {/* ── Pool Spell Pickers (full-width, each with built-in detail) ── */}
      {hasPoolChoices && (
        <div style={rc.poolArea}>
          {racePools.map((pool, i) => (
            <PoolSpellSection
              key            = {`race-pool-${i}`}
              pool           = {pool}
              allSpells      = {allSpells}
              classSpellMaps = {classSpellMaps}
              selectedSpells = {raceSel.spells || []}
              sourceLabel    = {raceName || null}
              onToggle       = {name => {
                const cur  = raceSel.spells || []
                const next = cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name]
                updateRaceSel({ spells: next })
              }}
            />
          ))}
          {subracePools.map((pool, i) => (
            <PoolSpellSection
              key            = {`subrace-pool-${i}`}
              pool           = {pool}
              allSpells      = {allSpells}
              classSpellMaps = {classSpellMaps}
              selectedSpells = {subraceSel.spells || []}
              sourceLabel    = {subraceName || null}
              onToggle       = {name => {
                const cur  = subraceSel.spells || []
                const next = cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name]
                updateSubraceSel({ spells: next })
              }}
            />
          ))}
        </div>
      )}

    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// STYLES  –  inline style objects, consistent with AdditionalSpellPicker palette
// ─────────────────────────────────────────────────────────────────────────────

const rc = {
  // ── Outer wrapper ─────────────────────────────────────────────────────────
  wrapper: {
    background: 'var(--bg-inset)',
    border:       '1px solid #1e3a56',
    borderRadius: 12,
    overflow:     'hidden',
    marginTop:    16,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '12px 16px',
    borderBottom:   '1px solid #1a3a56',
    background:     'var(--bg-panel)',
  },
  headerIcon:    { fontSize: 16 },
  headerTitle:   { color: 'var(--accent)', fontWeight: 'bold', fontSize: 14 },
  progressBadge: { fontSize: 12, fontWeight: 'bold' },

  // ── Two-column layout ─────────────────────────────────────────────────────
  layout: {
    display:    'flex',
    gap:        0,
    alignItems: 'flex-start',
  },
  listPanel: {
    flex:           1,
    maxHeight:      440,
    overflowY:      'auto',
    padding:        '14px 16px',
    scrollbarWidth: 'thin',
    scrollbarColor: '#2a4a6a #0a1525',
  },
  detailPanel: {
    width:          200,
    flexShrink:     0,
    background:     'var(--bg-page)',
    borderLeft:     '1px solid #1a3a56',
    padding:        '14px 14px',
    position:       'sticky',
    top:            0,
    alignSelf:      'flex-start',
    maxHeight:      340,
    overflowY:      'auto',
    scrollbarWidth: 'thin',
    scrollbarColor: '#2a4a6a #08111e',
  },

  // ── Pool area (full-width, below two-column layout) ───────────────────────
  poolArea: {
    padding:    '0 16px 16px',
    borderTop:  '1px solid #1a3a56',
  },
  poolSection: {
    marginTop: 16,
  },

  // ── Choice group (race / subrace block) ───────────────────────────────────
  choiceGroup: {
    marginBottom: 6,
  },
  groupLabel: {
    color: 'var(--accent)',
    fontWeight:     'bold',
    fontSize:       12,
    marginBottom:   10,
    paddingBottom:  6,
    borderBottom:   '1px solid #1a3a56',
    letterSpacing:  '0.04em',
    textTransform:  'uppercase',
  },

  // ── Section ───────────────────────────────────────────────────────────────
  section: {
    marginBottom: 12,
  },
  sectionHeader: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   6,
  },
  sectionTitle: {
    color: 'var(--text-secondary)',
    fontSize:      11,
    fontWeight:    'bold',
    letterSpacing: '0.03em',
  },

  // ── Status badges ─────────────────────────────────────────────────────────
  doneBadge: {
    background:   'var(--bg-card)',
    color: 'var(--accent-green)',
    fontSize:     10,
    padding:      '1px 7px',
    borderRadius: 10,
    border:       '1px solid #1a5a3a',
  },
  pendingBadge: {
    background:   'var(--bg-deep)',
    color:        'var(--accent)',
    fontSize:     10,
    padding:      '1px 7px',
    borderRadius: 10,
    border:       '1px solid #3a3a1a',
  },
  autoBadge: {
    background: 'var(--bg-highlight)',
    color:        'var(--text-muted)',
    fontSize:     10,
    padding:      '1px 7px',
    borderRadius: 10,
    border:       '1px solid #2a5a7a',
  },

  // ── Ability picker ────────────────────────────────────────────────────────
  abilityRow: {
    display:  'flex',
    gap:      6,
    flexWrap: 'wrap',
  },
  abilityCard: {
    position:      'relative',
    display:       'flex',
    flexDirection: 'column',
    alignItems:    'center',
    gap:           3,
    padding:       '8px 12px',
    borderRadius:  8,
    border: '2px solid var(--border)',
    background: 'var(--bg-elevated)',
    cursor:        'pointer',
    userSelect:    'none',
    minWidth:      60,
    transition:    'border-color 0.12s, background 0.12s',
  },
  abilityName:  { fontSize: 11, fontWeight: 'bold' },
  abilityCode:  { fontSize: 10 },
  abilityCheck: {
    position: 'absolute', top: 3, right: 5,
    fontSize: 10, fontWeight: 'bold',
  },
  abilityBadge: {
    fontSize:     10,
    padding:      '1px 6px',
    borderRadius: 4,
    border:       '1px solid',
    fontWeight:   'bold',
    background: 'var(--bg-highlight)',
  },

  // ── Entry choice list ─────────────────────────────────────────────────────
  entryList: {
    display:       'flex',
    flexDirection: 'column',
    gap:           4,
  },
  entryCard: {
    display:    'flex',
    alignItems: 'flex-start',
    gap:        8,
    padding:    '7px 10px',
    borderRadius: 7,
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    cursor:     'pointer',
    userSelect: 'none',
    transition: 'border-color 0.12s, background 0.12s',
  },
  entryCardSel: {
    border: '1px solid var(--accent)',
    background: 'var(--bg-hover)',
  },
  entryBullet: {
    fontSize:   14,
    flexShrink: 0,
    marginTop:  1,
  },

  // ── Fixed spell rows ──────────────────────────────────────────────────────
  fixedList: {
    display:       'flex',
    flexDirection: 'column',
    gap:           2,
  },
  fixedRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
    padding:    '4px 8px',
    borderRadius: 5,
    background: 'var(--bg-card)',
    border:     '1px solid #1a4a2a',
    cursor:     'default',
    userSelect: 'none',
  },
  fixedCheck: {
    color: 'var(--accent-green)',
    fontWeight: 'bold',
    fontSize:   11,
    flexShrink: 0,
  },
  spellName: {
    color: 'var(--text-secondary)',
    fontSize:     12,
    flex:         1,
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap',
  },

  // ── Inline spell-row badges ───────────────────────────────────────────────
  cantripBadge: {
    background:   'var(--bg-deep)',
    color: 'var(--accent-purple)',
    fontSize:     9,
    padding:      '1px 5px',
    borderRadius: 3,
    border:       '1px solid #2a2a5a',
    flexShrink:   0,
  },
  lvlBadge: {
    background: 'var(--bg-highlight)',
    color: 'var(--accent-blue)',
    fontSize:     9,
    padding:      '1px 5px',
    borderRadius: 3,
    flexShrink:   0,
  },
  charLvlBadge: {
    background:   'var(--bg-card)',
    color: 'var(--accent-green)',
    fontSize:     9,
    padding:      '1px 5px',
    borderRadius: 3,
    border:       '1px solid #2a4a1a',
    flexShrink:   0,
  },
  freqBadge: {
    background:   'var(--bg-card)',
    color: 'var(--accent)',
    fontSize:     9,
    padding:      '1px 5px',
    borderRadius: 3,
    flexShrink:   0,
  },

  // ── Detail panel ──────────────────────────────────────────────────────────
  detailEmpty: {
    color:     'var(--text-dim)',
    fontSize:  11,
    textAlign: 'center',
    padding:   '30px 0',
  },
  detail: {},
  detailName: {
    color: 'var(--accent)',
    fontWeight:   'bold',
    fontSize:     13,
    marginBottom: 3,
    lineHeight:   1.3,
  },
  detailSubhead: {
    color:        'var(--text-muted)',
    fontSize:     11,
    marginBottom: 8,
  },
  detailDivider: {
    height:       1,
    background:   'var(--bg-highlight)',
    marginBottom: 8,
  },
  detailRows: {
    display:       'flex',
    flexDirection: 'column',
    gap:           5,
    marginBottom:  8,
  },
  detailRow: {
    display:    'flex',
    gap:        4,
    alignItems: 'flex-start',
    fontSize:   11,
  },
  detailIcon:  { fontSize: 11, flexShrink: 0, width: 14, textAlign: 'center', marginTop: 1 },
  detailLabel: { color: 'var(--text-dim)', flexShrink: 0, minWidth: 38 },
  detailValue: { color: 'var(--text-secondary)', flex: 1, lineHeight: 1.4, wordBreak: 'break-word' },
  infoBadge: {
    background:   'var(--bg-inset)',
    color:        'var(--text-muted)',
    fontSize:     10,
    padding:      '5px 7px',
    borderRadius: 5,
    border:       '1px solid #1a3a4a',
    lineHeight:   1.4,
    fontStyle:    'italic',
  },

  // ── Concentration / Ritual badges (in detail panel) ───────────────────────
  concBadge: {
    background:   'var(--bg-card)',
    color: 'var(--accent-blue)',
    fontSize:     10,
    padding:      '2px 7px',
    borderRadius: 4,
    border:       '1px solid #1a4a7a',
  },
  ritBadge: {
    background:   'var(--bg-card)',
    color: 'var(--accent-green)',
    fontSize:     10,
    padding:      '2px 7px',
    borderRadius: 4,
    border:       '1px solid #1a5a3a',
  },

  // ── Spell / feat description entries ──────────────────────────────────────
  descWrap: {
    marginTop:  8,
    borderTop:  '1px solid #1a3a56',
    paddingTop: 8,
  },
  descPara: {
    color:        'var(--text-muted)',
    fontSize:     10,
    lineHeight:   1.5,
    margin:       '0 0 5px 0',
    padding:      0,
    wordBreak:    'break-word',
  },
  descSubhead: {
    color: 'var(--text-secondary)',
    fontSize:     10,
    fontWeight:   'bold',
    marginBottom: 2,
    marginTop:    4,
  },
  descList: {
    margin:      '0 0 5px 0',
    padding:     '0 0 0 14px',
    listStyle:   'disc',
  },
  descListItem: {
    color:      'var(--text-muted)',
    fontSize:   10,
    lineHeight: 1.5,
    marginBottom: 2,
  },

  // ── Feat picker ───────────────────────────────────────────────────────────
  featCard: {
    display:    'flex',
    alignItems: 'flex-start',
    gap:        8,
    padding:    '8px 10px',
    borderRadius: 7,
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    cursor:     'pointer',
    userSelect: 'none',
    transition: 'border-color 0.12s, background 0.12s',
    marginBottom: 4,
  },
  featCardSel: {
    border: '1px solid var(--accent)',
    background: 'var(--bg-hover)',
  },
  featName: {
    color: 'var(--text-secondary)',
    fontSize: 12,
    flex:     1,
    lineHeight: 1.3,
  },
  featCategory: {
    fontSize:     9,
    color:        'var(--text-dim)',
    marginTop:    2,
  },
  featSearch: {
    margin:       10,
    padding:      '7px 10px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    fontSize:     13,
    flexShrink:   0,
    outline:      'none',
    boxSizing:    'border-box',
    width:        'calc(100% - 20px)',
  },
  featScrollArea: {
    maxHeight:      260,
    overflowY:      'auto',
    scrollbarWidth: 'thin',
    scrollbarColor: '#2a4a6a #0a1525',
  },

  // ── Full-list feat picker (Step6-style two-panel) ─────────────────────────
  fullFeatLayout: {
    display:             'grid',
    gridTemplateColumns: '260px 1fr',
    border: '1px solid var(--border)',
    borderRadius:        10,
    overflow:            'hidden',
    height:              380,
  },
  fullFeatLeft: {
    borderRight: '1px solid var(--border)',
    display:       'flex',
    flexDirection: 'column',
    background: 'var(--bg-card)',
    overflow:      'hidden',
  },
  fullFeatList: {
    flex:           1,
    overflowY:      'auto',
    padding:        '0 6px 6px',
    scrollbarWidth: 'thin',
    scrollbarColor: '#2a4a6a #0d1f3c',
  },
  fullFeatItem: {
    padding:      '8px 10px',
    borderRadius: 7,
    cursor:       'pointer',
    marginBottom: 2,
    border:       '1px solid transparent',
  },
  fullFeatItemSel: {
    background: 'var(--bg-highlight)',
    border: '1px solid var(--accent)',
  },
  fullFeatItemViewing: {
    background: 'var(--bg-hover)',
    border: '1px solid var(--border)',
  },
  fullFeatRight: {
    display:       'flex',
    flexDirection: 'column',
    background: 'var(--bg-panel)',
    overflow:      'hidden',
  },
  fullFeatDetailScroll: {
    flex:           1,
    overflowY:      'auto',
    padding:        16,
    scrollbarWidth: 'thin',
    scrollbarColor: '#2a4a6a #0f1e35',
  },
  fullFeatFooter: {
    flexShrink:  0,
    padding:     '12px 16px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-card)',
  },
  fullFeatBtn: {
    width:        '100%',
    padding:      10,
    borderRadius: 8,
    border: '2px solid var(--accent)',
    background: 'transparent',
    color: 'var(--accent)',
    fontSize:     14,
    fontWeight:   'bold',
    cursor:       'pointer',
  },
  fullFeatBtnActive: {
    background: 'var(--accent)',
    color:      'var(--bg-deep)',
  },
  fullFeatEmpty: {
    flex:            1,
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    color: 'var(--text-dim)',
    fontSize:        13,
  },
}