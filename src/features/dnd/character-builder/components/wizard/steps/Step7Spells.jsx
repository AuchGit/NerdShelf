import { useState, useEffect, useMemo } from 'react'
import {
  loadSpellList, loadClassSpellNames,
} from '../../../lib/dataLoader'
import { getSpellcastingInfo } from '../../../lib/spellcastingRules'
import { UniversalSpellList } from '../AdditionalSpellPicker'

const modStr = n => (n >= 0 ? `+${n}` : `${n}`)
function getMod(score) { return Math.floor((score - 10) / 2) }
function getAbilityScore(char, key) {
  return (char.abilityScores.base[key] || 8) + ((char.species.abilityScoreImprovements || {})[key] || 0)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Step7Spells({ character, updateCharacter }) {
  const edition = character.meta.edition
  const cls     = character.classes[0]
  const classId = cls?.classId

  const [allSpells,      setAllSpells]      = useState([])
  const [classSpellNames, setClassSpellNames] = useState(new Set())
  const [loading,        setLoading]        = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [spells, cNames] = await Promise.all([
        loadSpellList(edition),
        classId ? loadClassSpellNames(edition, classId) : Promise.resolve(new Set()),
      ])
      if (cancelled) return
      setAllSpells(spells)
      setClassSpellNames(cNames)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [edition, classId])

  const spellInfo     = classId ? getSpellcastingInfo(classId, 1, 0, null, edition) : null
  // Data-driven max castable level at L1. Any class with a
  // spellcasting profile at L1 (spellInfo non-null AND has spell
  // capacity — cantrips, known spells, or prepared spells) can cast
  // 1st-level spells. The previous `['Paladin','Ranger'] → 0`
  // hardcode silently broke the 5.5e Paladin & Ranger ("keine spells
  // gefunden") because they DO learn spells at L1 in the 2024 PHB.
  const hasL1Casting = !!spellInfo && (
    (spellInfo.cantripsKnown || 0) > 0
    || (spellInfo.spellsKnown || 0) > 0
    || (spellInfo.maxPrepared || 0) > 0
    || !!spellInfo.hasSpellbook
  )
  const maxCastable   = hasL1Casting ? 1 : 0
  const profBonus     = 2

  const classId_lc = (classId ?? '').toLowerCase()

  // Names of spells added to the character's class spell list by race/subrace
  // (e.g. "Spells of the Mark" from Dragonmark subraces, ERLW p.41).
  // These only apply when the character HAS a spellcasting class.
  const expandedRacialNames = useMemo(() => {
    if (!spellInfo) return new Set()          // non-caster: irrelevant
    const names = character.species?.expandedSpells || []
    return new Set(names.map(n => n.toLowerCase()))
  }, [character.species?.expandedSpells, spellInfo])

  // Membership test: a spell belongs to this class if EITHER:
  //   (a) spell-lists.json says so (classSpellNames, guaranteed correct), OR
  //   (b) the spell's inline .classes array says so (fallback), OR
  //   (c) it was added to the spell list by a racial trait (expanded spells).
  function isClassSpell(s) {
    if (classSpellNames.size > 0 && classSpellNames.has(s.name.toLowerCase())) return true
    if ((s.classes || []).some(c => c.toLowerCase() === classId_lc)) return true
    return expandedRacialNames.has(s.name.toLowerCase())
  }

  const classCantrips = useMemo(() =>
    spellInfo?.cantripsKnown > 0
      ? allSpells.filter(s => s.level === 0 && isClassSpell(s))
      : []
  // eslint-disable-next-line react-hooks/exhaustive-deps
  , [allSpells, classSpellNames, classId_lc, spellInfo, expandedRacialNames])

  const classSpellsL1 = useMemo(() =>
    maxCastable > 0
      ? allSpells.filter(s => s.level >= 1 && s.level <= maxCastable && isClassSpell(s))
      : []
  // eslint-disable-next-line react-hooks/exhaustive-deps
  , [allSpells, classSpellNames, classId_lc, maxCastable, expandedRacialNames])

  const lv1                  = cls?.levelChoices?.[1] || {}
  const selectedCantrips     = lv1.cantrips        || []
  const selectedStartingSpells = lv1.startingSpells || []

  // ── Spell metadata persistence ────────────────────────────────────────────

  function saveMetadata(spellsArr) {
    const meta = { ...character.spellMetadata }
    for (const s of spellsArr) {
      if (!s?.name) continue
      meta[s.name] = {
        level: s.level, school: s.school, concentration: s.concentration,
        ritual: s.ritual, source: s.source, castingTime: s.castingTime,
        range: s.range, duration: s.duration,
      }
    }
    updateCharacter('spellMetadata', meta)
  }

  // ── Level-1 choice updater ────────────────────────────────────────────────

  function updateLv1(key, val) {
    if (!cls) return
    const updated = character.classes.map((c, i) =>
      i === 0
        ? { ...c, levelChoices: { ...c.levelChoices, 1: { ...c.levelChoices?.[1], [key]: val } } }
        : c
    )
    updateCharacter('classes', updated)
  }

  // ── Class spell toggles ───────────────────────────────────────────────────

  function toggleCantrip(spell) {
    const cur = selectedCantrips
    const has = cur.includes(spell.name)
    if (!has && cur.length >= (spellInfo?.cantripsKnown || 0)) return
    updateLv1('cantrips', has ? cur.filter(n => n !== spell.name) : [...cur, spell.name])
    if (!has) saveMetadata([spell])
  }

  function toggleStartingSpell(spell) {
    const cur = selectedStartingSpells
    const has = cur.includes(spell.name)
    const max = spellInfo?.hasSpellbook
      ? (spellInfo.spellbookStart || 6)
      : (spellInfo?.spellsKnown || 0)
    if (!has && cur.length >= max) return
    updateLv1('startingSpells', has ? cur.filter(n => n !== spell.name) : [...cur, spell.name])
    if (!has) saveMetadata([spell])
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const spellAbility = spellInfo?.spellcastingAbility
  const abilityMod   = spellAbility ? getMod(getAbilityScore(character, spellAbility)) : 0
  const isPrepared   = spellInfo?.type === 'prepared'
  const isWizard     = !!spellInfo?.hasSpellbook
  const cantripsMax  = spellInfo?.cantripsKnown || 0
  const spellbookMax = spellInfo?.spellbookStart || 6
  const knownMax     = spellInfo?.spellsKnown    || 0
  // 5.5e prepared casters (Ranger, Paladin, …) pick their initial
  // prepared list at character creation — "choose two level 1 Ranger
  // spells" in the XPHB Spellcasting feature. The legacy 5e flow had
  // no commitment at L1 (you'd pick on the sheet at first long rest);
  // the 2024 PHB rules require it up front. preparedTable[0] is the
  // initial count; legacy classes without a table fall through to 0.
  const preparedMax = (isPrepared && !isWizard) ? (spellInfo?.maxPrepared || 0) : 0
  const initialPrepared = character.status?.preparedSpells?.[classId] || []

  function togglePrepared(spell) {
    const cur = initialPrepared
    const has = cur.includes(spell.name)
    if (!has && cur.length >= preparedMax) return
    const next = has ? cur.filter(n => n !== spell.name) : [...cur, spell.name]
    updateCharacter(`status.preparedSpells.${classId}`, next)
    if (!has) saveMetadata([spell])
  }

  // Build a map of already-granted spells so the picker can show them as locked
  // { 'Detect Magic': 'von Elf', 'Cure Wounds': 'von Feat: Magic Initiate', … }
  const grantedSpells = useMemo(() => {
    const result = {}
    const raceLabel     = character.species.raceId    || 'Rasse'
    const subraceLabel  = character.species.subraceId || 'Unterrasse'

    // Fixed racial spells (set by handleSelectRace / handleSelectSubrace)
    for (const name of (character.species.spellChoices || [])) {
      result[name] = `von ${raceLabel}`
    }
    // Pool-chosen racial spells (set by RaceChoicePicker)
    for (const name of (character.species.raceChoices?.race?.spells    || [])) {
      result[name] = `von ${raceLabel}`
    }
    for (const name of (character.species.raceChoices?.subrace?.spells || [])) {
      result[name] = `von ${subraceLabel}`
    }

    for (const feat of (character.feats || [])) {
      const featLabel = `Feat: ${feat.featId}`

      // Bug 6 fix: feat.additionalSpells is the raw 5etools additionalSpells[] —
      // each element is an object like { ability, known: {_: [...]}, innate: {_: {...}} }.
      // The old code iterated this array and checked `typeof name === 'string'`, which
      // is always false (they're objects). We now walk the structure to pull out fixed
      // (non-choose) spell names, mirroring getFixedRacialSpells() in Step3Race.
      for (const block of (feat.additionalSpells || [])) {
        if (!block || typeof block !== 'object') continue
        // known._  — flat array or object keyed by level
        for (const val of Object.values(block.known?._ || {})) {
          const items = Array.isArray(val) ? val : [val]
          for (const s of items) {
            if (typeof s === 'string' && !s.startsWith('choose') && !s.startsWith('@')) {
              const name = s.split('|')[0].replace(/\b\w/g, c => c.toUpperCase())
              if (name) result[name] = featLabel
            }
          }
        }
        // innate._ — { charLevel: { freq: [spells] } }
        for (const levels of Object.values(block.innate?._ || {})) {
          if (!levels || typeof levels !== 'object') continue
          for (const arr of Object.values(levels)) {
            for (const s of (Array.isArray(arr) ? arr : [arr])) {
              if (typeof s === 'string' && !s.startsWith('choose') && !s.startsWith('@')) {
                const name = s.split('|')[0].replace(/\b\w/g, c => c.toUpperCase())
                if (name) result[name] = featLabel
              }
            }
          }
        }
      }

      // Pool-chosen feat spells (written by AdditionalSpellPicker → feat.choices.spells)
      for (const name of (feat.choices?.spells || [])) {
        if (typeof name === 'string') result[name] = featLabel
      }
    }
    return result
  }, [character.species.spellChoices, character.species.raceChoices, character.feats,
      character.species.raceId, character.species.subraceId])

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) return <div style={S.empty}>Lade Zauberlisten…</div>

  return (
    <div style={S.container}>
      <h2 style={S.pageTitle}>⚡ Zauber</h2>

      {/* ── CLASS ─────────────────────────────────────────────────────── */}
      {spellInfo && (
        <div style={S.card}>
          <div style={S.cardHeader}>
            <span style={S.cardTitle}>{classId} — Spellcasting</span>
            <div style={S.pillRow}>
              <InfoPill label="Ability"       value={spellAbility?.toUpperCase()} />
              <InfoPill label="Mod"           value={modStr(abilityMod)} />
              <InfoPill label="Spell Attack"  value={modStr(abilityMod + profBonus)} />
              <InfoPill label="Save DC"       value={8 + abilityMod + profBonus} />
            </div>
          </div>

          {/* Cantrips */}
          {cantripsMax > 0 && (
            <UniversalSpellList
              label={`Cantrips — wähle ${cantripsMax}`}
              spells={classCantrips}
              selected={selectedCantrips}
              max={cantripsMax}
              onToggle={toggleCantrip}
              grantedSpells={grantedSpells}
            />
          )}

          {/* Prepared caster: pick initial prepared spells.
              5.5e (XPHB) requires choosing the initial list at creation —
              "choose two level 1 Ranger spells" / "two level 1 Paladin
              spells" / etc. The maxPrepared field comes from each
              class's preparedTable at level 1. Picks land in
              `character.status.preparedSpells[classId]` which is the
              same store the sheet's Prepare modal reads on every long
              rest swap. */}
          {isPrepared && !isWizard && preparedMax > 0 && (
            <div style={{ marginTop: 12 }}>
              <UniversalSpellList
                label={`Prepared Spells — wähle ${preparedMax} Level-1-Zauber`}
                spells={classSpellsL1}
                selected={initialPrepared}
                max={preparedMax}
                onToggle={togglePrepared}
                grantedSpells={grantedSpells}
              />
              <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 6 }}>
                Bei jeder Long Rest darfst du einen vorbereiteten Spell gegen einen anderen tauschen.
              </div>
            </div>
          )}

          {/* Wizard spellbook */}
          {isWizard && (
            <div style={{ marginTop: 12 }}>
              <UniversalSpellList
                label={`Spellbook — wähle ${spellbookMax} Level-1-Zauber`}
                spells={classSpellsL1}
                selected={selectedStartingSpells}
                max={spellbookMax}
                onToggle={toggleStartingSpell}
                grantedSpells={grantedSpells}
              />
            </div>
          )}

          {/* Known spells (non-prepared, non-wizard) */}
          {!isPrepared && !isWizard && knownMax > 0 && maxCastable > 0 && (
            <div style={{ marginTop: 12 }}>
              <UniversalSpellList
                label={`Bekannte Zauber — wähle ${knownMax}`}
                spells={classSpellsL1}
                selected={selectedStartingSpells}
                max={knownMax}
                onToggle={toggleStartingSpell}
                grantedSpells={grantedSpells}
              />
            </div>
          )}

          {maxCastable === 0 && cantripsMax === 0 && (
            <div style={S.note}>Diese Klasse erhält Spellcasting erst ab Level 2.</div>
          )}
        </div>
      )}

      {!spellInfo && (
        <div style={{ ...S.card, color: 'var(--text-muted)', fontSize: 14 }}>
          Diese Klasse hat kein Spellcasting.
        </div>
      )}

      {/* NOTE: Feat spells are handled in the Feat selection step.              */}
      {/*       Race spells are handled in Step 3 (Race selection).              */}
    </div>
  )
}


// ─── InfoPill ─────────────────────────────────────────────────────────────────

function InfoPill({ label, value }) {
  return (
    <div style={{ background: 'var(--bg-highlight)', borderRadius: 6, padding: '4px 10px', textAlign: 'center' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{label}</div>
      <div style={{ color: 'var(--accent)', fontWeight: 'bold', fontSize: 13 }}>{value}</div>
    </div>
  )
}


// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  container: { maxWidth: 860, margin: '0 auto' },
  pageTitle: { color: 'var(--accent)', marginBottom: 16 },
  empty:     { color: 'var(--accent)', textAlign: 'center', padding: 40 },
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding:      20,
    marginBottom: 20,
  },
  cardHeader: {
    display:       'flex',
    alignItems:    'center',
    justifyContent: 'space-between',
    marginBottom:  14,
    flexWrap:      'wrap',
    gap:           8,
  },
  cardTitle: { color: 'var(--accent)', fontWeight: 'bold', fontSize: 16 },
  pillRow:   { display: 'flex', gap: 8, flexWrap: 'wrap' },
  label:     { color: 'var(--text-secondary)', fontWeight: 'bold', fontSize: 13, marginBottom: 7 },
  note: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding:      '12px 16px',
    color: 'var(--text-muted)',
    fontSize:     13,
    lineHeight:   1.6,
    marginTop:    8,
  },
}