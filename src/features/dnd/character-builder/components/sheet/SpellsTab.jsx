// components/sheet/SpellsTab.jsx
// Complete spell list (every spell the character knows, not just level 1),
// spell preparation for prepared casters, interactive spell slots, casting
// with up-casting, and concentration tracking. Every spell row — in the main
// list and in the prepare dialog — expands inline to show full details.

import { useState, useEffect, useMemo } from 'react'
import EntryRenderer from '../ui/EntryRenderer'
import FiveEToolsLink from '../ui/FiveEToolsLink'
import { Section, EmptyState, Btn, SheetModal, TextInput } from './SheetKit'
import { S } from './sheetStyles'
import {
  collectCharacterSpells, computeSpellSlots, ordinal, spellLevelLabel, SCHOOL_NAMES,
} from '../../lib/sheetUtils'
import { getSpellcastingInfo } from '../../lib/spellcastingRules'
import { favoriteKey } from '../../lib/favorites'
import { FavoriteToggle } from './OverviewTab'

function formatComponents(c = {}) {
  const parts = []
  if (c.v) parts.push('V')
  if (c.s) parts.push('S')
  if (c.m) parts.push('M')
  let out = parts.join(', ')
  if (c.m && typeof c.m === 'object' && c.m.text) out += ` (${c.m.text})`
  else if (c.m && typeof c.m === 'string') out += ` (${c.m})`
  return out || '—'
}

const LEVEL_COLORS = ['var(--accent-blue)', 'var(--accent)', 'var(--accent)', 'var(--accent)',
  'var(--accent-purple)', 'var(--accent-purple)', 'var(--accent-purple)', 'var(--accent-red)',
  'var(--accent-red)', 'var(--accent-red)']

function levelColor(lvl) { return LEVEL_COLORS[Math.min(9, lvl)] || 'var(--accent)' }

// Shared expand-panel style so spell rows look identical everywhere.
const EXPAND_PANEL = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderTop: 'none',
  borderBottomLeftRadius: 8, borderBottomRightRadius: 8, padding: '12px 14px',
}
const rowWhenOpen = { marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }

// Reusable spell enricher (level / school / description from the loaded
// spell list, custom spells, or stored spellMetadata).
function makeEnricher(spellMap, character) {
  const customByName = {}
  for (const c of (character.custom?.spells || [])) {
    if (c?.name) customByName[c.name.toLowerCase()] = c
  }
  const meta = character.spellMetadata || {}
  return function enrich(name) {
    const loaded = spellMap?.get(name.toLowerCase())
    const custom = customByName[name.toLowerCase()]
    const m = meta[name] || {}
    return {
      name,
      level: loaded?.level ?? custom?.level ?? m.level ?? 0,
      school: loaded?.school || custom?.school || m.school || 'U',
      concentration: loaded?.concentration ?? custom?.concentration ?? m.concentration ?? false,
      ritual: loaded?.ritual ?? custom?.ritual ?? m.ritual ?? false,
      castingTime: loaded?.castingTime || custom?.castingTime || m.castingTime || '—',
      range: loaded?.range || custom?.range || m.range || '—',
      duration: loaded?.duration || custom?.duration || m.duration || '—',
      components: loaded?.components || {},
      entries: loaded?.entries || custom?.entries || (custom?.description ? [custom.description] : []),
      entriesHigherLevel: loaded?.entriesHigherLevel || custom?.entriesHigherLevel || [],
      source: loaded?.source || custom?.source || m.source || null,
    }
  }
}

// ── Full spell detail block — shared by the list and the prepare dialog ──
function SpellDetails({ spell, edition }) {
  const entries = spell.entries || []
  const entriesHL = spell.entriesHigherLevel || []
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <div style={S.detailChip}><span style={S.detailChipLabel}>Level: </span><span style={S.detailChipValue}>{spell.level ? spell.level : 'Cantrip'}</span></div>
        <div style={S.detailChip}><span style={S.detailChipLabel}>School: </span><span style={S.detailChipValue}>{SCHOOL_NAMES[spell.school] || spell.school || '—'}</span></div>
        <div style={S.detailChip}><span style={S.detailChipLabel}>Cast: </span><span style={S.detailChipValue}>{spell.castingTime || '—'}</span></div>
        <div style={S.detailChip}><span style={S.detailChipLabel}>Range: </span><span style={S.detailChipValue}>{spell.range || '—'}</span></div>
        <div style={S.detailChip}><span style={S.detailChipLabel}>Duration: </span><span style={S.detailChipValue}>{spell.duration || '—'}</span></div>
        <div style={S.detailChip}><span style={S.detailChipLabel}>Components: </span><span style={S.detailChipValue}>{formatComponents(spell.components)}</span></div>
        {spell.source && (
          <FiveEToolsLink kind="spell" name={spell.name} source={spell.source} edition={edition} compact />
        )}
      </div>
      {(spell.concentration || spell.ritual) && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {spell.concentration && <span style={{ ...S.tag, borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}>Concentration</span>}
          {spell.ritual && <span style={{ ...S.tag, borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>Ritual</span>}
        </div>
      )}
      {entries.length > 0 ? (
        <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          <EntryRenderer entries={entries} />
          {entriesHL.length > 0 && <div style={{ marginTop: 10 }}><EntryRenderer entries={entriesHL} /></div>}
        </div>
      ) : (
        <div style={{ color: 'var(--text-dim)', fontSize: 13, fontStyle: 'italic' }}>
          No description available for this spell.
        </div>
      )}
    </div>
  )
}

// ── Ritual row — same look as a SpellRow, but the only cast option is
//    "Cast as Ritual (+10 min)" since rituals don't consume a slot ──
function RitualRow({ spell, onCastRitual, edition }) {
  const [open, setOpen] = useState(false)
  const lc = levelColor(spell.level)
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ ...S.spellRow, ...(open ? rowWhenOpen : {}) }}>
        <div style={{ ...S.spellLevelBadge, background: lc + '22', color: lc }}>{spell.level}</div>
        <div style={S.spellRowMain} onClick={() => setOpen(o => !o)}>
          <div style={S.spellName}>
            {spell.name}
            <span style={{ color: 'var(--text-dim)', fontSize: 11, marginLeft: 6 }}>{open ? '▲' : '▼'}</span>
          </div>
          <div style={S.spellMeta}>
            {SCHOOL_NAMES[spell.school] || spell.school}
            {spell.range && spell.range !== '—' ? ` · ${spell.range}` : ''}
            {' · via '}{spell.viaClasses.join(', ')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          {spell.prepared && (
            <span style={{ ...S.tag, borderColor: 'var(--accent)', color: 'var(--accent)' }}>Prepared</span>
          )}
          {spell.concentration && (
            <span style={{ ...S.tag, borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}>Conc</span>
          )}
        </div>
      </div>
      {open && (
        <div style={EXPAND_PANEL}>
          <SpellDetails spell={spell} edition={edition} />
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ ...S.formLabel, marginBottom: 8 }}>Ritual</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Btn variant="primary" onClick={() => onCastRitual(spell)}>Cast as Ritual (+10 min)</Btn>
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>No slot consumed.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Spell row in the main list — expands to details + cast actions ──
function SpellRow({ spell, slotRemaining, pactRemaining, warlockSlots, onCast, spellcasting, edition, character, applyCharacter }) {
  const [open, setOpen] = useState(false)
  const level = spell.level
  const lc = levelColor(level)

  const castOptions = []
  if (level === 0) {
    castOptions.push({ label: 'Cast (cantrip)', fn: () => onCast(spell, 0, false) })
  } else {
    for (let lvl = level; lvl <= 9; lvl++) {
      const rem = slotRemaining(lvl)
      if (rem > 0) castOptions.push({
        label: lvl === level ? `Cast at Level ${lvl} (${rem} left)` : `Up-cast at Level ${lvl} (${rem} left)`,
        fn: () => onCast(spell, lvl, false),
      })
    }
    if (warlockSlots && warlockSlots.level >= level && pactRemaining() > 0) {
      castOptions.push({
        label: `Cast with Pact Slot (Level ${warlockSlots.level}, ${pactRemaining()} left)`,
        fn: () => onCast(spell, warlockSlots.level, true),
      })
    }
  }

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ ...S.spellRow, ...(open ? rowWhenOpen : {}) }}>
        <div style={{ ...S.spellLevelBadge, background: lc + '22', color: lc }}>
          {level === 0 ? 'C' : level}
        </div>
        <div style={S.spellRowMain} onClick={() => setOpen(o => !o)}>
          <div style={{ ...S.spellName, display: 'flex', alignItems: 'center', gap: 4 }}>
            <FavoriteToggle
              favKey={favoriteKey('spell', spell.name)}
              character={character}
              applyCharacter={applyCharacter}
            />
            {spell.name}
            <span style={{ color: 'var(--text-dim)', fontSize: 11, marginLeft: 6 }}>{open ? '▲' : '▼'}</span>
          </div>
          <div style={S.spellMeta}>
            {SCHOOL_NAMES[spell.school] || spell.school}
            {spell.castingTime && spell.castingTime !== '—' ? ` · ${spell.castingTime}` : ''}
            {spell.range && spell.range !== '—' ? ` · ${spell.range}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          {/* Source-class chip(s) with that class's attack mod / save DC.
              For multiclass characters every spell can have different
              numbers depending on which class grants it — make that
              attribution explicit so the player doesn't have to remember
              "wait, my Hex was cast as a Warlock or a Sorcerer?" */}
          {(spell.sourceClasses && Array.from(spell.sourceClasses)).map(cls => {
            const sc = spellcasting?.[cls]
            if (!sc) return null
            return (
              <span
                key={cls}
                style={{
                  ...S.tag,
                  borderColor: 'var(--accent-blue)',
                  color: 'var(--accent-blue)',
                  fontWeight: 600,
                }}
                title={`${cls}: Spell Attack ${sc.spellAttackDisplay} · Save DC ${sc.spellSaveDC} · Ability ${sc.ability?.toUpperCase()}`}
              >
                {cls} · {sc.spellAttackDisplay} / DC {sc.spellSaveDC}
              </span>
            )
          })}
          {spell.status === 'prepared' && (
            <span style={{ ...S.tag, borderColor: 'var(--accent)', color: 'var(--accent)' }}>Prepared</span>
          )}
          {spell.concentration && (
            <span style={{ ...S.tag, borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}>Conc</span>
          )}
          {spell.ritual && (
            <span style={{ ...S.tag, borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>Ritual</span>
          )}
        </div>
      </div>
      {open && (
        <div style={EXPAND_PANEL}>
          <SpellDetails spell={spell} edition={edition} />
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ ...S.formLabel, marginBottom: 8 }}>{level === 0 ? 'Cast' : 'Cast at slot level'}</div>
            {castOptions.length === 0 ? (
              <div style={{ color: 'var(--accent-red)', fontSize: 13 }}>No spell slots available.</div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {castOptions.map((opt, i) => <Btn key={i} variant="primary" onClick={opt.fn}>{opt.label}</Btn>)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function SpellsTab({ character, computed, updateCharacter, applyCharacter }) {
  const [allSpells, setAllSpells] = useState(null)
  const [prepareFor, setPrepareFor] = useState(null)  // classId currently being prepared
  const edition = character.meta?.edition || '5e'

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { loadSpellList } = await import('../../lib/dataLoader')
      const list = await loadSpellList(edition)
      if (!cancelled) setAllSpells(list)
    }
    load()
    return () => { cancelled = true }
  }, [edition])

  const spellMap = useMemo(() => {
    const m = new Map()
    for (const s of (allSpells || [])) m.set(s.name.toLowerCase(), s)
    return m
  }, [allSpells])

  const { slots, warlockSlots } = computeSpellSlots(character)
  const usedSlots = character.status?.usedSpellSlots || {}
  const usedPact = character.status?.usedPactSlots || 0
  const concentration = character.status?.concentration || null
  const hasSpellcasting = character.classes.some(c => c.spellcastingAbility)
  const preparedByClass = useMemo(
    () => character.status?.preparedSpells || {},
    [character.status?.preparedSpells],
  )

  // Highest spell level the character can prepare / cast.
  const maxSpellLvl = useMemo(() => {
    let mx = 0
    if (slots) for (let i = 0; i < 9; i++) if (slots[i] > 0) mx = i + 1
    if (warlockSlots && warlockSlots.level > mx) mx = warlockSlots.level
    return mx
  }, [slots, warlockSlots])

  // Per-class spellcasting classification (prepared vs known vs spellbook).
  const casterClasses = useMemo(() => {
    return (character.classes || []).map(cls => {
      const sub = cls.subclassId?.split('__')[0] || null
      const mod = computed?.spellcasting?.[cls.classId]?.modifier ?? 0
      const info = getSpellcastingInfo(cls.classId, cls.level, mod, sub, edition)
      return info ? { classId: cls.classId, info } : null
    }).filter(Boolean)
  }, [character.classes, computed, edition])

  // ── Build the castable spell view ──────────────────────────
  const { byLevel, hasAny, alwaysNames } = useMemo(() => {
    const enrich = makeEnricher(spellMap, character)
    const collected = collectCharacterSpells(character)
    const infoByClass = {}
    for (const c of casterClasses) infoByClass[c.classId] = c.info

    const castable = new Map()
    const always = new Set()
    function add(name, status, sources = []) {
      const key = name.toLowerCase()
      const ex = castable.get(key)
      if (ex) {
        if (status === 'always') ex.status = 'always'
        for (const sc of sources) ex.sourceClasses.add(sc)
        return
      }
      castable.set(key, { ...enrich(name), status, sourceClasses: new Set(sources) })
    }

    for (const c of collected) {
      const lvl = enrich(c.name).level
      const allSources = Array.isArray(c.sourceClasses) ? c.sourceClasses : []
      if (lvl === 0) { add(c.name, 'always', allSources); always.add(c.name.toLowerCase()); continue }
      if (c.origins.includes('race') || c.origins.includes('feat') || c.origins.includes('custom')) {
        add(c.name, 'always', allSources); always.add(c.name.toLowerCase()); continue
      }
      let resolved = false
      for (const sc of c.sourceClasses) {
        const info = infoByClass[sc]
        if (!info) continue
        if (info.type === 'known') {
          add(c.name, 'always', [sc]); always.add(c.name.toLowerCase()); resolved = true
        } else if (info.type === 'prepared') {
          if (c.granted) {
            add(c.name, 'always', [sc]); always.add(c.name.toLowerCase()); resolved = true
          } else {
            resolved = true  // preparable pool spell — castable only once prepared
          }
        }
      }
      if (!resolved) { add(c.name, 'always', allSources); always.add(c.name.toLowerCase()) }
    }

    for (const [classId, names] of Object.entries(preparedByClass)) {
      for (const name of (names || [])) add(name, 'prepared', [classId])
    }

    const groups = {}
    for (const sp of castable.values()) {
      if (!groups[sp.level]) groups[sp.level] = []
      groups[sp.level].push(sp)
    }
    for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.name.localeCompare(b.name))
    return { byLevel: groups, hasAny: castable.size > 0, alwaysNames: always }
  }, [character, spellMap, casterClasses, preparedByClass])

  const prepSections = useMemo(() => {
    if (maxSpellLvl < 1) return []
    return casterClasses
      .filter(c => c.info.type === 'prepared')
      .map(c => ({
        classId: c.classId,
        hasSpellbook: !!c.info.hasSpellbook,
        max: c.info.maxPrepared || 0,
        count: (preparedByClass[c.classId] || []).length,
      }))
  }, [casterClasses, preparedByClass, maxSpellLvl])

  // ── Ritual spells the character can cast as rituals ────────
  // Per-class rules (info.ritualCasting from spellcastingRules):
  //   'spellbook' (Wizard): any ritual in spellbook, prepared or not
  //   'known'    (Bard):    any known ritual
  //   'prepared' (Cleric/Druid/Artificer): only currently prepared rituals
  // Rituals known via race/feat/etc. don't count — the ritual feature is
  // class-bound. Output is deduped + sorted by level then name.
  const rituals = useMemo(() => {
    const enrich = makeEnricher(spellMap, character)
    const infoByClass = {}
    for (const c of casterClasses) infoByClass[c.classId] = c.info
    const anyRitualClass = casterClasses.some(c => c.info.ritualCasting)
    if (!anyRitualClass) return []

    const out = new Map()
    const accept = (name, classId, prepared) => {
      const key = name.toLowerCase()
      const e = out.get(key)
      const existing = e || { ...enrich(name), viaClasses: new Set(), prepared: false }
      existing.viaClasses.add(classId)
      if (prepared) existing.prepared = true
      out.set(key, existing)
    }

    for (const c of collectCharacterSpells(character)) {
      const sp = enrich(c.name)
      if (!sp.ritual) continue
      if (sp.level === 0) continue   // cantrips have no ritual variant
      for (const sourceClass of c.sourceClasses) {
        const info = infoByClass[sourceClass]
        if (!info?.ritualCasting) continue
        const mode = info.ritualCasting
        if (mode === 'spellbook') {
          // Wizard rule: must be in spellbook (collectCharacterSpells gives
          // us spellbook contents already; granted spells don't count).
          if (c.granted) continue
          accept(c.name, sourceClass, false)
        } else if (mode === 'known') {
          accept(c.name, sourceClass, false)
        } else if (mode === 'prepared') {
          const prep = preparedByClass[sourceClass] || []
          if (prep.some(n => n.toLowerCase() === c.name.toLowerCase())) {
            accept(c.name, sourceClass, true)
          }
        }
      }
    }

    return [...out.values()]
      .map(r => ({ ...r, viaClasses: [...r.viaClasses] }))
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
  }, [character, spellMap, casterClasses, preparedByClass])

  // ── Slot helpers ──────────────────────────────────────────
  function slotRemaining(level) {
    if (!slots || !slots[level - 1]) return 0
    return Math.max(0, slots[level - 1] - (usedSlots[level] || 0))
  }
  function pactRemaining() {
    return warlockSlots ? Math.max(0, warlockSlots.slots - usedPact) : 0
  }
  function setSlotUsed(level, used) {
    const max = slots?.[level - 1] || 0
    updateCharacter(`status.usedSpellSlots.${level}`, Math.max(0, Math.min(max, used)))
  }
  function setPactUsed(used) {
    const max = warlockSlots?.slots || 0
    updateCharacter('status.usedPactSlots', Math.max(0, Math.min(max, used)))
  }

  // ── Casting ───────────────────────────────────────────────
  // Concentration data shape: { spell: <name>, level: <slot used>,
  //   since: <iso timestamp> }. Single canonical key `spell` — older
  //   characters that stored `.name` are bridged by the read side
  //   (OverviewTab reads `c.spell || c.name`).
  function castSpell(spell, slotLevel, usePact) {
    const concName = concentration?.spell || concentration?.name
    if (spell.concentration && concName && concName !== spell.name) {
      if (!window.confirm(`Du konzentrierst gerade auf ${concName}. Durch ${spell.name} ersetzen?`)) return
    }
    applyCharacter(d => {
      if (!d.status) d.status = {}
      if (usePact) {
        d.status.usedPactSlots = (d.status.usedPactSlots || 0) + 1
      } else if (slotLevel > 0) {
        if (!d.status.usedSpellSlots) d.status.usedSpellSlots = {}
        d.status.usedSpellSlots[slotLevel] = (d.status.usedSpellSlots[slotLevel] || 0) + 1
      }
      if (spell.concentration) {
        d.status.concentration = {
          spell: spell.name,
          level: usePact ? warlockSlots?.level : slotLevel,
          since: new Date().toISOString(),
        }
      }
    })
  }

  // Ritual casts: no slot consumed, but concentration still applies.
  function castRitual(spell) {
    const concName = concentration?.spell || concentration?.name
    if (spell.concentration && concName && concName !== spell.name) {
      if (!window.confirm(`Du konzentrierst gerade auf ${concName}. Durch ${spell.name} ersetzen?`)) return
    }
    if (spell.concentration) {
      applyCharacter(d => {
        if (!d.status) d.status = {}
        d.status.concentration = {
          spell: spell.name,
          level: spell.level,
          since: new Date().toISOString(),
        }
      })
    }
  }

  if (!hasSpellcasting && !hasAny) {
    return (
      <div className="dnd-sheet-tab-body" style={S.tabBody}>
        <EmptyState title="No Spellcasting" desc="This character has no spells or spell slots." />
      </div>
    )
  }

  const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b)

  return (
    <div className="dnd-sheet-tab-body" style={S.tabBody}>
      {/* ── Spellcasting overview ── */}
      {computed?.spellcasting && Object.keys(computed.spellcasting).length > 0 && (
        <Section title="Spellcasting">
          {Object.entries(computed.spellcasting).map(([clsName, sc]) => (
            <div key={clsName} style={S.spellcastRow}>
              <span style={S.spellcastClass}>{clsName}</span>
              <div style={S.detailChip}><span style={S.detailChipLabel}>Ability: </span><span style={S.detailChipValue}>{sc.ability.toUpperCase()}</span></div>
              <div style={S.detailChip}><span style={S.detailChipLabel}>Spell Attack: </span><span style={S.detailChipValue}>{sc.spellAttackDisplay}</span></div>
              <div style={S.detailChip}><span style={S.detailChipLabel}>Save DC: </span><span style={S.detailChipValue}>{sc.spellSaveDC}</span></div>
            </div>
          ))}
        </Section>
      )}

      {/* ── Concentration banner ── */}
      {concentration && (concentration.spell || concentration.name) && (
        <div style={S.concBanner}>
          <span style={{ color: 'var(--accent-purple)', fontSize: 13, fontWeight: 'bold' }}>
            Concentrating on {concentration.spell || concentration.name}
            {concentration.level ? ` (Level ${concentration.level})` : ''}
          </span>
          <Btn variant="ghost" onClick={() => updateCharacter('status.concentration', null)}>Drop</Btn>
        </div>
      )}

      {/* ── Spell slots ── */}
      {(slots || warlockSlots) && (
        <Section title="Spell Slots">
          <div style={S.slotGrid}>
            {slots && slots.map((max, i) => {
              const level = i + 1
              if (max === 0) return null
              const used = usedSlots[level] || 0
              const remaining = max - used
              return (
                <div key={level} style={S.slotBox}>
                  <div style={S.slotLevel}>{ordinal(level)} Level</div>
                  <div style={{ ...S.slotCount, color: remaining > 0 ? 'var(--accent)' : 'var(--accent-red)' }}>
                    {remaining} / {max}
                  </div>
                  <div style={S.slotDots}>
                    {Array.from({ length: max }, (_, j) => (
                      <button
                        key={j} type="button"
                        onClick={() => setSlotUsed(level, j < remaining ? max - j : max - (j + 1))}
                        style={{ ...S.slotDot, background: j < remaining ? 'var(--accent)' : 'var(--bg-inset)' }}
                        aria-label={`slot ${j + 1}`}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
            {warlockSlots && (
              <div style={{ ...S.slotBox, borderColor: 'var(--accent-purple)' }}>
                <div style={S.slotLevel}>Pact · {ordinal(warlockSlots.level)} Lv.</div>
                <div style={{ ...S.slotCount, color: pactRemaining() > 0 ? 'var(--accent-purple)' : 'var(--accent-red)' }}>
                  {pactRemaining()} / {warlockSlots.slots}
                </div>
                <div style={S.slotDots}>
                  {Array.from({ length: warlockSlots.slots }, (_, j) => {
                    const rem = pactRemaining()
                    return (
                      <button
                        key={j} type="button"
                        onClick={() => setPactUsed(j < rem ? warlockSlots.slots - j : warlockSlots.slots - (j + 1))}
                        style={{ ...S.slotDot, background: j < rem ? 'var(--accent-purple)' : 'var(--bg-inset)' }}
                        aria-label={`pact slot ${j + 1}`}
                      />
                    )
                  })}
                </div>
              </div>
            )}
          </div>
          <div style={S.sideHint}>Click a pip to spend or restore a slot. A Long Rest restores all slots.</div>
        </Section>
      )}

      {/* ── Spell preparation ── */}
      {prepSections.length > 0 && (
        <Section title="Spell Preparation">
          <div style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 8 }}>
            Prepared casters choose which spells are ready each day. Only prepared spells can be cast.
          </div>
          {prepSections.map(ps => (
            <div key={ps.classId} style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '10px 14px', marginBottom: 6,
            }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 14, flex: 1, minWidth: 100 }}>
                {ps.classId}
              </span>
              <span style={{ fontSize: 13 }}>
                Prepared{' '}
                <b style={{ color: ps.count > ps.max ? 'var(--accent-red)' : 'var(--accent)' }}>
                  {ps.count} / {ps.max}
                </b>
              </span>
              <Btn variant="accent" onClick={() => setPrepareFor(ps.classId)}>Prepare</Btn>
            </div>
          ))}
        </Section>
      )}

      {/* ── Rituals (only if the character has class-level ritual casting) ── */}
      {rituals.length > 0 && (
        <Section title={`Rituals (${rituals.length})`}>
          <div style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 8 }}>
            Cast any of these as a ritual (+10 minutes, no slot consumed).
          </div>
          {rituals.map(spell => (
            <RitualRow key={spell.name} spell={spell} onCastRitual={castRitual} edition={edition} />
          ))}
        </Section>
      )}

      {/* ── Spells by level ── */}
      {!hasAny && <EmptyState title="No spells ready" desc="Use Prepare to choose your spells, or learn spells at level-up." />}

      {/* Multi-column grid on desktop: auto-fit packs as many level columns as
          the viewport allows (1 column ≈ 320px wide). On phones the minmax
          collapses to a single column, identical to the old stacked layout. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '0 20px' }}>
        {levels.map(level => (
          <Section key={level} title={`${spellLevelLabel(level)} (${byLevel[level].length})`}>
            {byLevel[level].map(spell => (
              <SpellRow
                key={spell.name} spell={spell}
                slotRemaining={slotRemaining} pactRemaining={pactRemaining}
                warlockSlots={warlockSlots} onCast={castSpell}
                spellcasting={computed?.spellcasting}
                edition={edition}
                character={character}
                applyCharacter={applyCharacter}
              />
            ))}
          </Section>
        ))}
      </div>

      {/* ── Prepare modal ── */}
      {prepareFor && (
        <PrepareModal
          classId={prepareFor}
          section={prepSections.find(p => p.classId === prepareFor)}
          maxSpellLvl={maxSpellLvl}
          allSpells={allSpells}
          spellMap={spellMap}
          character={character}
          preparedByClass={preparedByClass}
          alwaysNames={alwaysNames}
          edition={edition}
          onClose={() => setPrepareFor(null)}
          onChange={arr => updateCharacter(`status.preparedSpells.${prepareFor}`, arr)}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PREPARE MODAL
// ═══════════════════════════════════════════════════════════════

// One preparable spell — expands inline to show full details.
function PrepareRow({ spell, isPrep, note, atLimit, onToggle, edition }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ ...S.spellRow, ...(open ? rowWhenOpen : {}) }}>
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
          <div style={S.spellName}>
            {spell.name}
            <span style={{ color: 'var(--text-dim)', fontSize: 11, marginLeft: 6 }}>{open ? '▲' : '▼'}</span>
          </div>
          <div style={S.spellMeta}>
            {SCHOOL_NAMES[spell.school] || spell.school}
            {note && <span style={{ color: 'var(--accent-green)' }}> · {note}</span>}
          </div>
        </div>
        <Btn
          variant={isPrep ? 'accent' : 'primary'}
          disabled={atLimit}
          style={{ padding: '5px 12px', fontSize: 12 }}
          onClick={onToggle}
          title={atLimit ? 'Preparation limit reached' : ''}
        >
          {isPrep ? 'Prepared' : 'Prepare'}
        </Btn>
      </div>
      {open && (
        <div style={EXPAND_PANEL}>
          <SpellDetails spell={spell} edition={edition} />
        </div>
      )}
    </div>
  )
}

export function PrepareModal({
  classId, section, maxSpellLvl, allSpells, spellMap, character,
  preparedByClass, alwaysNames, edition, onClose, onChange,
}) {
  const [search, setSearch] = useState('')
  const hasSpellbook = section?.hasSpellbook
  const max = section?.max || 0
  const prepared = preparedByClass[classId] || []
  const preparedSet = new Set(prepared.map(n => n.toLowerCase()))

  // Pool of preparable spells — stored as full spell objects so each row
  // can expand to its complete description.
  const pool = useMemo(() => {
    const byName = new Map()
    if (hasSpellbook) {
      // Wizard prepares from the spellbook (the spells actually learned).
      for (const c of collectCharacterSpells(character)) {
        if (c.granted) continue
        if (!c.sourceClasses.includes(classId)) continue
        const sp = spellMap?.get(c.name.toLowerCase())
        const level = sp?.level ?? 0
        if (level < 1 || level > maxSpellLvl) continue
        const k = c.name.toLowerCase()
        if (!byName.has(k)) byName.set(k, sp || { name: c.name, level, school: 'U' })
      }
    } else {
      // Cleric / Druid / Paladin / Artificer prepare from the whole class list.
      const want = classId.toLowerCase()
      for (const s of (allSpells || [])) {
        if (!(s.classes || []).some(cn => String(cn).toLowerCase() === want)) continue
        if (s.level < 1 || s.level > maxSpellLvl) continue
        const k = s.name.toLowerCase()
        if (!byName.has(k)) byName.set(k, s)
      }
    }
    return [...byName.values()].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
  }, [allSpells, spellMap, character, classId, hasSpellbook, maxSpellLvl])

  const filtered = search.trim()
    ? pool.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    : pool

  const groups = {}
  for (const s of filtered) {
    if (!groups[s.level]) groups[s.level] = []
    groups[s.level].push(s)
  }
  const groupLevels = Object.keys(groups).map(Number).sort((a, b) => a - b)

  function toggle(name) {
    const lower = name.toLowerCase()
    if (preparedSet.has(lower)) {
      onChange(prepared.filter(n => n.toLowerCase() !== lower))
    } else {
      if (prepared.length >= max) return
      onChange([...prepared, name])
    }
  }

  // If a spell is already available through another class / source, say so.
  function otherSource(name) {
    const lower = name.toLowerCase()
    for (const [cid, names] of Object.entries(preparedByClass)) {
      if (cid === classId) continue
      if ((names || []).some(n => n.toLowerCase() === lower)) return `Prepared as ${cid}`
    }
    if (alwaysNames.has(lower)) return 'Already known'
    return null
  }

  const overLimit = prepared.length > max

  return (
    <SheetModal open onClose={onClose} title={`Prepare ${classId} Spells`} width={640}
      footer={<Btn variant="primary" onClick={onClose}>Done</Btn>}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap', marginBottom: 10,
      }}>
        <span style={{ fontSize: 14 }}>
          Prepared:{' '}
          <b style={{ color: overLimit ? 'var(--accent-red)' : 'var(--accent)' }}>{prepared.length} / {max}</b>
        </span>
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          {hasSpellbook ? 'From your spellbook' : `Full ${classId} spell list`}
        </span>
      </div>
      {overLimit && (
        <div style={{ color: 'var(--accent-red)', fontSize: 12, marginBottom: 8 }}>
          Over the preparation limit — un-prepare a spell.
        </div>
      )}

      <TextInput value={search} onChange={setSearch} placeholder="Search spells..." autoFocus />

      <div style={{ marginTop: 10, maxHeight: 440, overflowY: 'auto' }}>
        {allSpells === null && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Loading spells...</div>
        )}
        {allSpells !== null && pool.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>
            {maxSpellLvl < 1 ? 'No spell slots available yet.' : 'No preparable spells found.'}
          </div>
        )}
        {groupLevels.map(lvl => (
          <div key={lvl}>
            <div style={{
              color: 'var(--accent)', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase',
              letterSpacing: 0.6, margin: '10px 2px 6px',
            }}>
              {ordinal(lvl)} Level
            </div>
            {groups[lvl].map(s => {
              const isPrep = preparedSet.has(s.name.toLowerCase())
              return (
                <PrepareRow
                  key={s.name} spell={s} isPrep={isPrep}
                  note={otherSource(s.name)}
                  atLimit={!isPrep && prepared.length >= max}
                  onToggle={() => toggle(s.name)}
                  edition={edition}
                />
              )
            })}
          </div>
        ))}
      </div>
    </SheetModal>
  )
}
