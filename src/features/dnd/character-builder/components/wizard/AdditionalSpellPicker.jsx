import { useState, useEffect, useMemo } from 'react'
import { loadSpellList, loadClassSpellNames } from '../../lib/dataLoader'
import { parseTags } from '../../lib/tagParser'

// ─────────────────────────────────────────────────────────────────────────────
// SCHOOL NORMALIZATION
// Handles single-letter codes ('D', 'N') and full names ('divination').
// All internal comparisons use lowercase full names.
// ─────────────────────────────────────────────────────────────────────────────

const SCHOOL_CODE_TO_FULL = {
  a: 'abjuration',    c: 'conjuration',   d: 'divination',
  e: 'enchantment',   v: 'evocation',     i: 'illusion',
  n: 'necromancy',    t: 'transmutation', p: 'psionic',
  u: 'universal',
}

export const SCHOOL_COLORS = {
  A: 'var(--accent-blue)', C: 'var(--accent-purple)', D: 'var(--accent-green)',
  E: 'var(--accent-pink)', V: 'var(--accent-red)', I: 'var(--accent-purple)',
  N: 'var(--text-muted)', T: 'var(--accent)', P: 'var(--accent-green)',
}

// 'D' → 'divination' | 'divination' → 'divination'
function normalizeSchool(raw) {
  if (!raw) return ''
  const lower = raw.toLowerCase().trim()
  return SCHOOL_CODE_TO_FULL[lower] || lower
}

// Convert a spell's school code ('D') → full lowercase name ('divination')
function spellSchoolFull(code) {
  return SCHOOL_CODE_TO_FULL[code?.toLowerCase()] || code?.toLowerCase() || ''
}


// ─────────────────────────────────────────────────────────────────────────────
// SPELL NAME NORMALIZATION
// Strips 5etools source tags (|xge) and flags (#c, #s, etc.) then title-cases.
// ─────────────────────────────────────────────────────────────────────────────

function toSpellName(raw) {
  if (!raw || typeof raw !== 'string') return ''
  // Strip source tag first (|xge, |phb, etc.), then flag suffix (#c, #s, etc.)
  const base = raw.split('|')[0].split('#')[0].trim()
  if (!base || base.startsWith('@')) return ''
  // Title-case: capitalize first letter of every word
  return base.replace(/\b\w/g, c => c.toUpperCase())
}


// ─────────────────────────────────────────────────────────────────────────────
// LEVEL KEY PARSING
// 's0', 's1' … 's9' → SPELL-level keys (background expanded tables).
// Plain numbers ('1', '10', '20') → CLASS-level keys (when gained).
// ─────────────────────────────────────────────────────────────────────────────

function parseLevelKey(str) {
  const s = String(str ?? '').trim()
  if (s.startsWith('s')) {
    const n = parseInt(s.slice(1))
    return { level: isNaN(n) ? 0 : n, isSpellLevel: true }
  }
  // Strip trailing 'e' (like '1e' in "daily": {"1e": [...]})
  const n = parseInt(s.replace(/e$/, ''))
  return { level: isNaN(n) ? 0 : n, isSpellLevel: false }
}


// ─────────────────────────────────────────────────────────────────────────────
// FILTER STRING PARSER
// Parses a choose/filter string like:
//   "level=0|class=Druid"                    (from object's .choose value)
//   "choose|level=0|class=Druid"             (old string-style)
//   "level=0;1;2;3;4;5|school=N;D"          (semicolons = multiple levels/schools)
//   "level=1;2;3;4;5|class=Cleric;Druid;Wizard"
//   ""                                        (any spell)
// ─────────────────────────────────────────────────────────────────────────────

function parseFilterString(str, outerCount = 1) {
  const filters = { minLevel: null, maxLevel: null, schools: [], classes: [], count: outerCount }
  if (typeof str !== 'string') return filters

  let s = str.trim()
  if (s.toLowerCase().startsWith('choose|')) s = s.slice(7)
  else if (s.toLowerCase() === 'choose') s = ''

  if (!s) return filters

  s.split('|').forEach(part => {
    const p = part.trim()
    if (!p) return

    if (p.startsWith('class=')) {
      p.slice(6).split(';').forEach(c => {
        const name = c.trim().toLowerCase()
        if (name) filters.classes.push(name)
      })
    } else if (p.startsWith('school=')) {
      p.slice(7).split(';').forEach(sc => {
        const full = normalizeSchool(sc.trim())
        if (full) filters.schools.push(full)
      })
    } else if (p.startsWith('level<=')) {
      const n = parseInt(p.slice(7))
      if (!isNaN(n)) filters.maxLevel = n
    } else if (p.startsWith('level>=')) {
      const n = parseInt(p.slice(7))
      if (!isNaN(n)) filters.minLevel = n
    } else if (p.startsWith('level=')) {
      const vals = p.slice(6).split(';').map(Number).filter(n => !isNaN(n))
      if (vals.length === 1) {
        filters.minLevel = vals[0]
        filters.maxLevel = vals[0]
      } else if (vals.length > 1) {
        filters.minLevel = Math.min(...vals)
        filters.maxLevel = Math.max(...vals)
      }
    } else if (p.startsWith('count=')) {
      const n = parseInt(p.slice(6))
      if (!isNaN(n)) filters.count = n
    }
  })

  return filters
}


// ─────────────────────────────────────────────────────────────────────────────
// SINGLE ENTRY PARSER
// Processes one additionalSpells entry object and extracts:
//   fixed        – spell names that are auto-granted (always added)
//   choiceGroups – groups where the user must pick N spells
// ─────────────────────────────────────────────────────────────────────────────

function parseOneEntry(entry) {
  if (!entry || typeof entry !== 'object') return { fixed: [], choiceGroups: [] }

  const fixed = []
  const rawChoices = []

  function addFixed(str) {
    const name = toSpellName(str)
    if (name && !fixed.includes(name)) fixed.push(name)
  }

  function pushChoiceSlot(filters) {
    rawChoices.push({ filters: { ...filters, count: 1 } })
  }

  function processItem(item, outerLevelInfo) {
    if (typeof item === 'string') {
      const t = item.trim()
      if (!t || t.startsWith('@')) return
      if (t.toLowerCase().startsWith('choose')) {
        const f = parseFilterString(t, 1)
        if (f) resolveAndPush(f, outerLevelInfo, f.count)
        return
      }
      addFixed(t)
    } else if (typeof item === 'object' && item !== null) {
      if ('choose' in item) {
        const outerCount = typeof item.count === 'number' ? item.count : 1
        const f = parseFilterString(item.choose, outerCount)
        if (f) resolveAndPush(f, outerLevelInfo, f.count)
      }
      // 'all' = dynamic computed list – not a user choice, skip
    }
  }

  function resolveAndPush(filters, outerLevelInfo, totalSlots) {
    const hasExplicitLevel = filters.minLevel !== null || filters.maxLevel !== null
    let minL, maxL
    if (hasExplicitLevel) {
      minL = filters.minLevel ?? 0
      maxL = filters.maxLevel ?? 9
    } else if (outerLevelInfo.isSpellLevel) {
      minL = outerLevelInfo.level
      maxL = outerLevelInfo.level
    } else {
      minL = 0
      maxL = 9
    }
    const resolved = { ...filters, minLevel: minL, maxLevel: maxL }
    const count = Math.max(1, totalSlots || 1)
    for (let i = 0; i < count; i++) pushChoiceSlot(resolved)
  }

  function processValue(val, outerLevelInfo) {
    if (typeof val === 'string') { processItem(val, outerLevelInfo); return }
    if (Array.isArray(val)) { for (const item of val) processItem(item, outerLevelInfo); return }
    if (typeof val === 'object' && val !== null) {
      if ('_' in val) {
        const items = Array.isArray(val._) ? val._ : [val._]
        for (const item of items) processItem(item, outerLevelInfo)
      } else {
        for (const [, subVal] of Object.entries(val)) processValue(subVal, outerLevelInfo)
      }
    }
  }

  function processSection(section) {
    if (!section || typeof section !== 'object') return
    for (const [keyStr, val] of Object.entries(section)) {
      if (keyStr === '_' && typeof val === 'object' && !Array.isArray(val)) {
        processSection(val)
      } else {
        const outerLevelInfo = parseLevelKey(keyStr)
        processValue(val, outerLevelInfo)
      }
    }
  }

  processSection(entry.known)
  processSection(entry.prepared)
  processSection(entry.innate)
  processSection(entry.expanded)

  // Group raw choice slots by identical filter signature
  const groupMap = new Map()
  for (const { filters } of rawChoices) {
    const key = JSON.stringify({
      min:     filters.minLevel,
      max:     filters.maxLevel,
      schools: [...filters.schools].sort(),
      classes: [...filters.classes].sort(),
    })
    if (groupMap.has(key)) {
      groupMap.get(key).count++
    } else {
      groupMap.set(key, { count: 1, filters: { ...filters } })
    }
  }

  return { fixed, choiceGroups: Array.from(groupMap.values()) }
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN PARSER  –  parseAdditionalSpells(additionalSpells[])
// Returns array of option objects: { optionName, fixed, choiceGroups }
// ─────────────────────────────────────────────────────────────────────────────

function parseAdditionalSpells(additionalSpells) {
  if (!Array.isArray(additionalSpells) || additionalSpells.length === 0) return []

  const valid = additionalSpells.filter(e => e && typeof e === 'object' && !Array.isArray(e))
  if (valid.length === 0) return []

  const allHaveNames = valid.length > 1 && valid.every(e => typeof e.name === 'string' && e.name.trim())
  if (allHaveNames) {
    return valid.map(entry => ({ optionName: entry.name, ...parseOneEntry(entry) }))
  }

  const mergedFixed    = []
  const mergedGroupMap = new Map()

  for (const entry of valid) {
    const { fixed, choiceGroups } = parseOneEntry(entry)
    for (const f of fixed) {
      if (!mergedFixed.includes(f)) mergedFixed.push(f)
    }
    for (const cg of choiceGroups) {
      const key = JSON.stringify({
        min:     cg.filters.minLevel,
        max:     cg.filters.maxLevel,
        schools: [...cg.filters.schools].sort(),
        classes: [...cg.filters.classes].sort(),
      })
      if (mergedGroupMap.has(key)) {
        mergedGroupMap.get(key).count += cg.count
      } else {
        mergedGroupMap.set(key, { count: cg.count, filters: { ...cg.filters } })
      }
    }
  }

  return [{
    optionName:   null,
    fixed:        mergedFixed,
    choiceGroups: Array.from(mergedGroupMap.values()),
  }]
}


// ─────────────────────────────────────────────────────────────────────────────
// SPELL COMPONENTS HELPER
// ─────────────────────────────────────────────────────────────────────────────

function getComponentString(components) {
  if (!components) return null
  if (typeof components === 'string') return components
  const parts = []
  if (components.v) parts.push('V')
  if (components.s) parts.push('S')
  if (components.m) {
    const mat = typeof components.m === 'string'
      ? components.m
      : (components.m?.text || 'Material')
    // Truncate very long material descriptions
    const short = mat.length > 40 ? mat.slice(0, 38) + '…' : mat
    parts.push(`M (${short})`)
  }
  return parts.length ? parts.join(', ') : null
}


// ─────────────────────────────────────────────────────────────────────────────
// SPELL ENTRY RENDERER  –  renders 5etools entries[] into readable paragraphs
// Handles: plain strings, lists, nested entries sections.
// Intentionally simple: detail panel is narrow, so we show ~4 paragraphs max.
// ─────────────────────────────────────────────────────────────────────────────

function renderSpellEntries(entries, depth = 0) {
  if (!Array.isArray(entries) || entries.length === 0) return null
  const nodes = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (!e) continue

    if (typeof e === 'string') {
      nodes.push(
        <p key={i} style={ss.descPara}>{parseTags(e)}</p>,
      )
    } else if (typeof e === 'object') {
      if ((e.type === 'entries' || e.type === 'section') && e.entries && depth < 2) {
        if (e.name) {
          nodes.push(<p key={`h${i}`} style={ss.descSubhead}>{parseTags(e.name)}</p>)
        }
        const kids = renderSpellEntries(e.entries, depth + 1)
        if (kids) nodes.push(<div key={`s${i}`}>{kids}</div>)
      } else if (e.type === 'list' && Array.isArray(e.items)) {
        nodes.push(
          <ul key={i} style={ss.descList}>
            {e.items.slice(0, 8).map((item, j) => {
              const text = typeof item === 'string'
                ? parseTags(item)
                : parseTags(item?.entry || item?.name || '')
              return text ? <li key={j} style={ss.descListItem}>{text}</li> : null
            })}
          </ul>,
        )
      } else if (e.type === 'table') {
        // Skip tables – too wide for the detail panel
      } else if (e.entries && depth < 2) {
        if (e.name) {
          nodes.push(<p key={`h${i}`} style={ss.descSubhead}>{parseTags(e.name)}</p>)
        }
        const kids = renderSpellEntries(e.entries, depth + 1)
        if (kids) nodes.push(<div key={`s${i}`}>{kids}</div>)
      }
    }
  }
  return nodes.length > 0 ? nodes : null
}


// ─────────────────────────────────────────────────────────────────────────────
// SPELL DETAIL PANEL  –  shown on the right when a spell is hovered
// Now includes the full spell description below the metadata rows.
// ─────────────────────────────────────────────────────────────────────────────

function SpellDetail({ spell }) {
  const schoolCode  = spell.school?.toUpperCase() || ''
  const schoolFull  = SCHOOL_CODE_TO_FULL[spell.school?.toLowerCase()] || spell.school || ''
  const schoolCap   = schoolFull ? schoolFull.charAt(0).toUpperCase() + schoolFull.slice(1) : ''
  const schoolColor = SCHOOL_COLORS[schoolCode] || 'var(--accent-blue)'
  const compStr     = getComponentString(spell.components)

  return (
    <div style={ss.detail}>
      <div style={ss.detailName}>{spell.name}</div>
      <div style={ss.detailSubhead}>
        <span>{spell.level === 0 ? 'Cantrip' : `Level ${spell.level}`}</span>
        {schoolCap && (
          <span style={{ color: schoolColor }}> · {schoolCap}</span>
        )}
      </div>

      <div style={ss.detailDivider} />

      <div style={ss.detailRows}>
        {spell.castingTime && <DetailRow icon="⚡" label="Aktion"   value={spell.castingTime} />}
        {spell.range       && <DetailRow icon="📏" label="Reichw."  value={spell.range} />}
        {spell.duration    && <DetailRow icon="⏱" label="Dauer"    value={spell.duration} />}
        {compStr           && <DetailRow icon="🧩" label="Komp."   value={compStr} />}
        {spell.source      && <DetailRow icon="📖" label="Quelle"  value={spell.source} />}
      </div>

      {(spell.concentration || spell.ritual) && (
        <div style={ss.detailBadges}>
          {spell.concentration && <span style={ss.concBadgeLg}>⚡ Konz.</span>}
          {spell.ritual        && <span style={ss.ritBadgeLg}>🔄 Ritual</span>}
        </div>
      )}

      {/* ── Full spell description ── */}
      {spell.entries?.length > 0 && (
        <div style={ss.descWrap}>
          {renderSpellEntries(spell.entries)}
        </div>
      )}
    </div>
  )
}

function DetailRow({ icon, label, value }) {
  return (
    <div style={ss.detailRow}>
      <span style={ss.detailIcon}>{icon}</span>
      <span style={ss.detailLabel}>{label}:</span>
      <span style={ss.detailValue}>{value}</span>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL SPELL LIST  (exported – reusable in any context)
//
// Split-panel UI: compact spell rows on the left, detail panel on the right.
// Works identically for class spells, racial spells, feat spells, backgrounds.
//
// Props:
//   spells       Spell[]                        pool to show
//   selected     string[]                       selected spell names
//   max          number (default Infinity)      max selectable
//   onToggle     (spell: SpellObj) => void      called with full spell object
//   fixedSpells  string[]                       auto-granted names (locked row)
//   label        string                         optional section heading
//   canToggle    (name: string) => bool         overrides max-check (group logic)
// ─────────────────────────────────────────────────────────────────────────────

export function UniversalSpellList({
  spells        = [],
  selected      = [],
  max           = Infinity,
  onToggle,
  fixedSpells   = [],
  label,
  canToggle,
  grantedSpells = {},   // { 'SpellName': 'von Quellenname' }  – already owned, not selectable
}) {
  const [search,  setSearch]  = useState('')
  const [hovered, setHovered] = useState(null)
  const [pinned,  setPinned]  = useState(null)

  // What the detail panel actually shows: hover preview takes priority,
  // but pinned persists so the panel stays visible (and scrollable) when
  // the mouse moves away from the spell list into the detail panel.
  const displayed = hovered ?? pinned

  const done = max !== Infinity && selected.length >= max

  const filtered = useMemo(() => {
    const q    = search.toLowerCase()
    const seen = new Set()
    return spells.filter(s => {
      if (seen.has(s.name)) return false
      if (q && !s.name.toLowerCase().includes(q)) return false
      seen.add(s.name)
      return true
    })
  }, [spells, search])

  function isActive(spell) {
    if (grantedSpells[spell.name]) return false   // already owned elsewhere
    const isSel = selected.includes(spell.name)
    if (isSel) return true                         // can always deselect
    if (canToggle) return canToggle(spell.name)
    return !done
  }

  return (
    <div style={ss.uslWrap}>
      {/* Optional heading */}
      {label && (
        <div style={ss.uslLabel}>
          <span>{label}</span>
          {max !== Infinity && (
            <span style={{
              color: selected.length >= max ? 'var(--accent-green)' : 'var(--accent)',
              marginLeft: 8,
              fontWeight: 'bold',
            }}>
              {selected.length}/{max}
            </span>
          )}
        </div>
      )}

      {/* Search */}
      <input
        style={ss.searchInput}
        type="text"
        placeholder="Suchen…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      <div style={ss.uslLayout}>
        {/* ── Left: compact spell list ─────────────────────────────── */}
        <div style={ss.uslList}>

          {/* Fixed (auto-granted) rows at top */}
          {fixedSpells.map(name => {
            const spell = spells.find(s => s.name === name)
            const isPinned = pinned?.name === name
            return (
              <div
                key={`fx-${name}`}
                style={{ ...ss.uslRowFixed, ...(isPinned ? ss.uslRowPinned : {}), cursor: spell ? 'pointer' : 'default' }}
                onClick={() => spell && setPinned(spell)}
                onMouseEnter={() => spell && setHovered(spell)}
                onMouseLeave={() => setHovered(null)}
              >
                <span style={ss.fixedBadge}>✓</span>
                <span style={{ ...ss.spellName, color: 'var(--accent-green)' }}>{name}</span>
                <span style={ss.autoTag}>auto</span>
              </div>
            )
          })}
          {fixedSpells.length > 0 && <div style={ss.divider} />}

          {/* Granted (already owned from another source) – shown at top, locked */}
          {Object.keys(grantedSpells).length > 0 && (() => {
            const grantedInPool = spells.filter(s => grantedSpells[s.name])
            if (grantedInPool.length === 0) return null
            return (
              <>
                {grantedInPool.map(spell => (
                  <div
                    key={`gr-${spell.name}`}
                    style={{ ...ss.uslRowGranted, ...(pinned?.name === spell.name ? ss.uslRowPinned : {}), cursor: 'pointer' }}
                    onClick={() => setPinned(spell)}
                    onMouseEnter={() => setHovered(spell)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <span style={ss.fixedBadge}>✓</span>
                    <span style={{ ...ss.spellName, color: 'var(--accent-green)', opacity: 0.75 }}>{spell.name}</span>
                    <span style={ss.grantedTag}>{grantedSpells[spell.name]}</span>
                  </div>
                ))}
                <div style={ss.divider} />
              </>
            )
          })()}

          {/* Chooseable spells */}
          {filtered.slice(0, 150).map(spell => {
            if (fixedSpells.includes(spell.name)) return null
            if (grantedSpells[spell.name]) return null  // shown in granted section above
            const isSel      = selected.includes(spell.name)
            const active     = isActive(spell)
            const isHov      = hovered?.name === spell.name
            const isPinned   = pinned?.name === spell.name
            const schoolCode = spell.school?.toUpperCase() || ''
            const schoolColor = SCHOOL_COLORS[schoolCode] || 'var(--accent-blue)'

            return (
              <div
                key={spell.id || spell.name}
                style={{
                  ...ss.uslRow,
                  ...(isSel             ? ss.uslRowSel    : {}),
                  ...(isPinned && !isSel ? ss.uslRowPinned : {}),
                  ...(isHov && !isSel && !isPinned ? ss.uslRowHov : {}),
                  opacity: active ? 1 : 0.28,
                  cursor:  'pointer',   // always pointer – even inactive rows show details on click
                }}
                onClick={() => {
                  setPinned(spell)         // always pin for detail view
                  if (active) onToggle(spell)  // only toggle selection if active
                }}
                onMouseEnter={() => setHovered(spell)}
                onMouseLeave={() => setHovered(null)}
              >
                {/* Level badge */}
                <span style={{ ...ss.lvlBadge, ...(isSel ? ss.lvlBadgeSel : {}) }}>
                  {spell.level === 0 ? 'C' : spell.level}
                </span>

                {/* Name */}
                <span style={ss.spellName}>{spell.name}</span>

                {/* School */}
                {spell.school && (
                  <span style={{ ...ss.schoolBadge, color: schoolColor }}>
                    {spell.school}
                  </span>
                )}

                {/* Concentration / Ritual flags */}
                {spell.concentration && <span style={ss.concDot} title="Konzentration">K</span>}
                {spell.ritual        && <span style={ss.ritDot}  title="Ritual">R</span>}

                {/* Selection checkmark */}
                {isSel && <span style={ss.checkMark}>✓</span>}
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div style={ss.noSpells}>Keine Zauber gefunden.</div>
          )}
          {filtered.length > 150 && (
            <div style={{ color: 'var(--text-dim)', fontSize: 11, padding: '4px 8px' }}>
              +{filtered.length - 150} weitere — Suche benutzen.
            </div>
          )}
        </div>

        {/* ── Right: detail panel ──────────────────────────────────── */}
        <div style={ss.detailPanel}>
          {displayed
            ? <SpellDetail spell={displayed} />
            : (
              <div style={ss.detailPlaceholder}>
                <div style={{ fontSize: 24, marginBottom: 6, opacity: 0.4 }}>✨</div>
                <div>Klick oder Hover<br />für Details</div>
              </div>
            )
          }
        </div>
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT  –  AdditionalSpellPicker
//
// Parses any additionalSpells[] array and renders the full picker UI.
//
// Props:
//   additionalSpells  any[]       raw data from JSON
//   selected          string[]    currently selected spell names
//   onChange          fn          called with new string[] on change
//   edition           string      '5e' | '2014' etc.
//   label             string      heading text
//   inline            bool        if true: suppress outer container + header
//                                 (use when parent card already provides context)
// ─────────────────────────────────────────────────────────────────────────────

export default function AdditionalSpellPicker({
  additionalSpells = [],
  selected         = [],
  onChange,
  edition          = '5e',
  label            = 'Additional Spells',
  inline           = false,
}) {
  const [allSpells,      setAllSpells]      = useState([])
  const [classSpellNames, setClassSpellNames] = useState({})  // { classLower: Set<nameLower> }
  const [loadingSpells,  setLoadingSpells]  = useState(true)
  const [selectedOption, setSelectedOption] = useState(null)  // for options mode

  // Parse additionalSpells (memoized)
  const parsed = useMemo(
    () => parseAdditionalSpells(additionalSpells),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(additionalSpells)]
  )

  const hasOptions = parsed.length > 1 && parsed.every(p => p.optionName !== null)

  const activeOpt = hasOptions
    ? (parsed.find(p => p.optionName === selectedOption) ?? null)
    : (parsed[0] ?? null)

  // Load the full spell list
  useEffect(() => {
    let cancelled = false
    setLoadingSpells(true)
    loadSpellList(edition).then(spells => {
      if (!cancelled) { setAllSpells(spells); setLoadingSpells(false) }
    })
    return () => { cancelled = true }
  }, [edition])

  // Load class spell lists on-demand (only when needed)
  useEffect(() => {
    if (!activeOpt) return
    const needed = new Set()
    for (const cg of activeOpt.choiceGroups || []) {
      for (const cls of cg.filters.classes || []) needed.add(cls)
    }
    needed.forEach(cls => {
      if (classSpellNames[cls] !== undefined) return
      const clsCap = cls.charAt(0).toUpperCase() + cls.slice(1)
      loadClassSpellNames(edition, clsCap).then(nameSet => {
        setClassSpellNames(prev => ({ ...prev, [cls]: nameSet }))
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOpt, edition])

  // Auto-populate fixed spells whenever the active option changes
  useEffect(() => {
    if (!activeOpt) return
    const fixed = activeOpt.fixed || []
    if (!fixed.length) return
    const missing = fixed.filter(f => !selected.includes(f))
    if (missing.length > 0) onChange?.([...selected, ...missing])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(activeOpt?.fixed), selectedOption])

  // Nothing to render
  if (!parsed.length) return null
  if (!activeOpt && !hasOptions) return null
  if (loadingSpells) return <div style={ss.loading}>⏳ Lade Zauberliste…</div>

  const fixed        = activeOpt?.fixed        || []
  const choiceGroups = activeOpt?.choiceGroups || []
  const chosenSpells = selected.filter(s => !fixed.includes(s))

  // ── Spell matching ────────────────────────────────────────────────────────

  function spellMatchesGroup(spellName, group) {
    const spellLower = spellName.toLowerCase()
    const spell = allSpells.find(s => s.name.toLowerCase() === spellLower)
    if (!spell) return false

    const { minLevel = 0, maxLevel = 9 } = group.filters
    if (spell.level < minLevel || spell.level > maxLevel) return false

    if (group.filters.schools.length > 0) {
      const spellSchool = spellSchoolFull(spell.school)
      if (!group.filters.schools.includes(spellSchool)) return false
    }

    if (group.filters.classes.length > 0) {
      const onAnyList = group.filters.classes.some(cls => {
        const nameSet = classSpellNames[cls]
        return nameSet && nameSet.has(spellLower)
      })
      if (!onAnyList) return false
    }

    return true
  }

  function countChosenForGroup(group) {
    return chosenSpells.filter(name => spellMatchesGroup(name, group)).length
  }

  function getSpellsForGroup(group) {
    return allSpells.filter(spell => spellMatchesGroup(spell.name, group))
  }

  function canSelectIntoGroup(name, group) {
    if (chosenSpells.includes(name)) return true
    if (countChosenForGroup(group) >= group.count) return false
    return spellMatchesGroup(name, group)
  }

  function toggleSpell(name) {
    const idx = chosenSpells.indexOf(name)
    if (idx >= 0) {
      const next = [...chosenSpells]
      next.splice(idx, 1)
      onChange?.([...fixed, ...next])
    } else {
      const canAdd = choiceGroups.some(g => canSelectIntoGroup(name, g))
      if (!canAdd) return
      onChange?.([...fixed, ...chosenSpells, name])
    }
  }

  const totalRequired = choiceGroups.reduce((s, g) => s + g.count, 0)
  const isDone = totalRequired === 0
    ? (!hasOptions || selectedOption !== null)
    : chosenSpells.length >= totalRequired && (!hasOptions || selectedOption !== null)

  // ── Render ────────────────────────────────────────────────────────────────

  const inner = (
    <>
      {/* Option selector (e.g. Circle of the Land) */}
      {hasOptions && (
        <div style={ss.section}>
          <div style={ss.label}>Option wählen:</div>
          <div style={ss.row}>
            {parsed.map(opt => (
              <button
                key={opt.optionName}
                style={{ ...ss.optBtn, ...(selectedOption === opt.optionName ? ss.optBtnSel : {}) }}
                onClick={() => {
                  setSelectedOption(opt.optionName)
                  onChange?.(opt.fixed || [])
                }}
              >
                {opt.optionName}
              </button>
            ))}
          </div>
          {!selectedOption && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>
              ↑ Wähle eine Option um fortzufahren
            </div>
          )}
        </div>
      )}

      {activeOpt && (
        <>
          {/* Fixed (auto-granted) spells */}
          {fixed.length > 0 && (
            <div style={ss.section}>
              <div style={ss.label}>Automatisch erhalten:</div>
              <div style={ss.row}>
                {fixed.map(name => (
                  <div key={name} style={ss.fixedPill}>
                    <span style={ss.check}>✓</span>
                    <span style={ss.fixedName}>{name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Choice groups – each uses UniversalSpellList */}
          {choiceGroups.map((group, gi) => {
            const cur          = countChosenForGroup(group)
            const groupSpells  = getSpellsForGroup(group)
            const isLoadingCls = group.filters.classes.length > 0
              && group.filters.classes.some(cls => classSpellNames[cls] === undefined)

            const { minLevel = 0, maxLevel = 9 } = group.filters
            const groupDone = cur >= group.count

            let lvlLabel
            if (minLevel === 0 && maxLevel === 0)       lvlLabel = 'Cantrip'
            else if (minLevel === maxLevel)              lvlLabel = `Level-${minLevel}-Zauber`
            else if (minLevel === 0 && maxLevel === 9)  lvlLabel = 'Zauber (beliebiges Level)'
            else                                        lvlLabel = `Level-${minLevel}–${maxLevel}-Zauber`

            const schoolLabel = group.filters.schools.length > 0
              ? ` (${group.filters.schools.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('/')})`
              : ''

            const classLabel = group.filters.classes.length > 0
              ? ` · ${group.filters.classes.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join('/')}-Liste`
              : ''

            return (
              <div key={gi} style={ss.section}>
                <div style={ss.label}>
                  Wähle {group.count}× {lvlLabel}{schoolLabel}{classLabel}
                  {' '}
                  <span style={{ color: groupDone ? 'var(--accent-green)' : 'var(--accent)', fontWeight: 'bold' }}>
                    ({cur}/{group.count})
                  </span>
                  {isLoadingCls && (
                    <span style={{ color: 'var(--text-dim)', fontSize: 10, marginLeft: 8 }}>
                      ⏳ lade Klassenliste…
                    </span>
                  )}
                </div>

                {!isLoadingCls && groupSpells.length === 0 && (
                  <div style={ss.noSpells}>Keine passenden Zauber gefunden.</div>
                )}

                {groupSpells.length > 0 && (
                  <UniversalSpellList
                    spells={groupSpells}
                    selected={chosenSpells}
                    onToggle={spell => toggleSpell(spell.name)}
                    canToggle={name => canSelectIntoGroup(name, group)}
                  />
                )}
              </div>
            )
          })}

          {choiceGroups.length === 0 && fixed.length === 0 && (
            <div style={ss.noSpells}>Keine zusätzlichen Zauber für diese Auswahl.</div>
          )}
        </>
      )}
    </>
  )

  // ── inline mode: no outer container/header (parent provides context) ──────
  if (inline) return <div>{inner}</div>

  return (
    <div style={ss.container}>
      {/* Header */}
      <div style={ss.header}>
        <span style={ss.headerLabel}>{label}</span>
        {isDone && <span style={ss.done}>✓ Vollständig</span>}
        {!isDone && totalRequired > 0 && (
          <span style={ss.progress}>{chosenSpells.length}/{totalRequired} gewählt</span>
        )}
      </div>

      {inner}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const ss = {
  // ── Outer container ───────────────────────────────────────────────────────
  container: {
    background: 'var(--bg-inset)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding:      14,
    marginTop:    12,
  },
  header: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   10,
    gap:            8,
  },
  headerLabel: { color: 'var(--accent)', fontWeight: 'bold', fontSize: 13, flex: 1 },
  done:        { color: 'var(--accent-green)', fontSize: 12, flexShrink: 0 },
  progress:    { color: 'var(--accent)', fontSize: 12, flexShrink: 0 },
  loading:     { color: 'var(--text-muted)', fontSize: 13, padding: 8 },

  // ── Section / label ───────────────────────────────────────────────────────
  section: { marginBottom: 14 },
  label: {
    color: 'var(--text-secondary)',
    fontSize:     12,
    fontWeight:   'bold',
    marginBottom: 6,
    lineHeight:   1.5,
  },
  row:      { display: 'flex', gap: 6, flexWrap: 'wrap' },
  noSpells: { color: 'var(--text-dim)', fontSize: 12, padding: '6px 0' },

  // ── Option buttons ────────────────────────────────────────────────────────
  optBtn: {
    padding:      '5px 12px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-muted)',
    cursor:       'pointer',
    fontSize:     12,
  },
  optBtnSel: {
    border: '1px solid var(--accent)',
    color: 'var(--accent)',
    background: 'var(--bg-hover)',
  },

  // ── Fixed spell pills (auto-granted section) ──────────────────────────────
  fixedPill: {
    display:      'flex',
    alignItems:   'center',
    gap:          5,
    background: 'var(--bg-highlight)',
    border:       '1px solid #2a6a4a',
    borderRadius: 6,
    padding:      '4px 10px',
    fontSize:     12,
  },
  check:     { color: 'var(--accent-green)', fontWeight: 'bold' },
  fixedName: { color: 'var(--text-secondary)' },

  // ── Search input ──────────────────────────────────────────────────────────
  searchInput: {
    width:        '100%',
    padding:      '6px 10px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    fontSize:     13,
    marginBottom: 6,
    boxSizing:    'border-box',
    outline:      'none',
  },

  // ── Universal spell list layout ───────────────────────────────────────────
  uslWrap:  {},
  uslLabel: {
    display:      'flex',
    alignItems:   'center',
    color: 'var(--text-secondary)',
    fontWeight:   'bold',
    fontSize:     12,
    marginBottom: 6,
  },
  uslLayout: {
    display:    'flex',
    gap:        10,
    alignItems: 'stretch',   // both panels always share the same height → no page jumps
    minHeight:  280,
  },
  uslList: {
    flex:           1,
    height:         280,
    overflowY:      'auto',
    display:        'flex',
    flexDirection:  'column',
    gap:            2,
    paddingRight:   2,
    // Subtle scrollbar styling
    scrollbarWidth: 'thin',
    scrollbarColor: 'var(--border) var(--bg-inset)',
  },

  // ── Spell rows ────────────────────────────────────────────────────────────
  uslRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
    padding:    '5px 8px',
    borderRadius: 5,
    border:     '1px solid transparent',
    background: 'var(--bg-card)',
    transition: 'border-color 0.12s, background 0.12s',
    userSelect: 'none',
    flexShrink: 0,
  },
  uslRowSel: {
    border: '1px solid var(--accent)',
    background: 'var(--bg-hover)',
  },
  uslRowPinned: {
    border:     '1px solid #4a7aaa',
    background: 'var(--bg-card)',
  },
  uslRowHov: {
    border:     '1px solid #3a5a7a',
    background: 'var(--bg-card)',
  },
  uslRowFixed: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
    padding:    '4px 8px',
    borderRadius: 5,
    background: 'var(--bg-card)',
    border:     '1px solid #2a5a3a',
    flexShrink: 0,
    opacity:    0.85,
  },
  fixedBadge: {
    color: 'var(--accent-green)',
    fontWeight: 'bold',
    fontSize:   11,
    flexShrink: 0,
    width:      16,
    textAlign:  'center',
  },
  autoTag: {
    color:     'var(--text-dim)',
    fontSize:   9,
    flexShrink: 0,
  },
  uslRowGranted: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
    padding:    '4px 8px',
    borderRadius: 5,
    background: 'var(--bg-card)',
    border:     '1px solid #1a4a2a',
    flexShrink: 0,
    opacity:    0.8,
  },
  grantedTag: {
    color:       'var(--accent-green)',
    fontSize:    9,
    flexShrink:  0,
    fontStyle:   'italic',
    maxWidth:    90,
    overflow:    'hidden',
    textOverflow:'ellipsis',
    whiteSpace:  'nowrap',
  },

  // ── Spell row elements ────────────────────────────────────────────────────
  lvlBadge: {
    background: 'var(--bg-highlight)',
    color: 'var(--accent-purple)',
    fontSize:    10,
    fontWeight:  'bold',
    padding:     '1px 5px',
    borderRadius: 4,
    flexShrink:  0,
    minWidth:    16,
    textAlign:   'center',
  },
  lvlBadgeSel: {
    background: 'var(--border)',
    color: 'var(--accent)',
  },
  spellName: {
    color: 'var(--text-secondary)',
    fontSize:     12,
    flex:         1,
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap',
  },
  schoolBadge: {
    fontSize:   10,
    fontWeight: 'bold',
    flexShrink: 0,
  },
  concDot:  { color: 'var(--accent-blue)', fontSize: 9, flexShrink: 0 },
  ritDot:   { color: 'var(--accent-green)', fontSize: 9, flexShrink: 0 },
  checkMark: { color: 'var(--accent-green)', fontWeight: 'bold', fontSize: 11, flexShrink: 0 },
  divider:  { height: 1, background: 'var(--border)', margin: '2px 0', flexShrink: 0 },

  // ── Detail panel ──────────────────────────────────────────────────────────
  detailPanel: {
    width:          300,
    flexShrink:     0,
    background:     'var(--bg-page)',
    border:         '1px solid #1e3a56',
    borderRadius:   8,
    padding:        '12px 14px',
    height:         280,
    overflowY:      'auto',
    scrollbarWidth: 'thin',
    scrollbarColor: 'var(--border) var(--bg-page)',
  },
  detailPlaceholder: {
    color:     'var(--text-dim)',
    fontSize:  12,
    textAlign: 'center',
    padding:   '24px 0',
  },

  // ── Detail content ────────────────────────────────────────────────────────
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
    gap:        5,
    alignItems: 'flex-start',
    fontSize:   11,
  },
  detailIcon:  { fontSize: 11, flexShrink: 0, width: 14, textAlign: 'center', marginTop: 1 },
  detailLabel: { color: 'var(--text-dim)', flexShrink: 0, minWidth: 40 },
  detailValue: { color: 'var(--text-secondary)', flex: 1, lineHeight: 1.4, wordBreak: 'break-word' },
  detailBadges: { display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 2 },
  concBadgeLg: {
    background:   'var(--bg-card)',
    color: 'var(--accent-blue)',
    fontSize:     10,
    padding:      '2px 7px',
    borderRadius: 4,
    border:       '1px solid #1a4a7a',
  },
  ritBadgeLg: {
    background:   'var(--bg-card)',
    color: 'var(--accent-green)',
    fontSize:     10,
    padding:      '2px 7px',
    borderRadius: 4,
    border:       '1px solid #1a5a3a',
  },

  // ── Spell description (entries) ───────────────────────────────────────────
  descWrap: {
    marginTop:    8,
    paddingTop:   8,
    borderTop:    '1px solid #1e3a56',
  },
  descPara: {
    color:        'var(--text-muted)',
    fontSize:     10,
    lineHeight:   1.55,
    margin:       '0 0 5px 0',
  },
  descSubhead: {
    color:        'var(--text-secondary)',
    fontSize:     10,
    fontWeight:   'bold',
    margin:       '5px 0 2px 0',
  },
  descList: {
    margin:       '2px 0 5px 0',
    paddingLeft:  14,
  },
  descListItem: {
    color:        'var(--text-muted)',
    fontSize:     10,
    lineHeight:   1.5,
    marginBottom: 2,
  },
}