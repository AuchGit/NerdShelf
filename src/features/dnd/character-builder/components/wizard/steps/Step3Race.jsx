// components/steps/Step3Race.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Race / Species selection step.
//
// KEY FIXES vs. previous version:
//  1. filterActiveDescriptors: variant-gated choice descriptors (e.g. Half-Elf
//     "Skill Versatility" vs "Elf Weapon Training") are hidden until the player
//     picks the parent variant option.  Only the chosen option's sub-choices show.
//  2. parseSubraceChoices receives `null` (not `{}`) when no subrace is selected,
//     so it returns [] cleanly instead of creating ghost descriptors.
//  3. Subrace choice keys are cleared on race change (unchanged logic, kept intact).
//
// BUG FIXES (this revision):
//  4. raceSkillChoices: short-circuits to null when the race OR subrace has a
//     _versions array. extractRacialSkillChoices() reads the top-level
//     skillProficiencies field directly and is therefore _versions-blind —
//     it would always produce a skill picker for Drow Descent regardless of
//     whether "Skill Versatility" or "Drow Magic" is the chosen variant.
//     Variant-specific skills now flow exclusively through choiceParser → Step7.
//
//  5. ChoicePicker block: 'variant' descriptors are excluded from the filter.
//     RaceChoicePicker already renders a VariantOptionSection (with the hover-
//     preview panel) for every _versions block.  Letting the ChoicePicker block
//     also render a type:'variant' descriptor produced a second, preview-less
//     duplicate picker for the same choice.
//
//  6. RaceChoicePicker onChange: variant selections (sel.*.variantOptions) are
//     now mirrored into character.choices[variantDescId].  filterActiveDescriptors
//     reads character.choices to decide which variant-gated sub-descriptors
//     (ability, spell, skill …) are active.  Without this bridge, choosing a
//     variant in RaceChoicePicker had no effect on the descriptor system and all
//     variant-gated choices were permanently hidden.
//
//  7. Subrace card badge: "Skill-Wahl vorhanden" is suppressed when _versions is
//     present (skill access is variant-conditional, not unconditional).
//     A generic "Variant Feature" badge is shown instead.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react'
import { loadRaceList } from '../../../lib/dataLoader'
import { useLanguage } from '../../../lib/i18n'
import BrowsePanel from '../../ui/BrowsePanel'
import EntryRenderer from '../../ui/EntryRenderer'
import AdditionalSpellPicker from '../AdditionalSpellPicker'
import RaceChoicePicker from '../RaceChoicePicker'
import ChoicePicker from '../../ui/ChoicePicker'
import { 
  parseRaceChoices, parseSubraceChoices,
  filterActiveDescriptors, filterDescriptorsByActiveVariants,
  getVersionCoveredKeys, setChoiceValue, asArray
} from '../../../lib/choiceParser'

const SIZE_LABELS = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', V: 'Varies' }

const ALL_SKILLS = [
  'acrobatics','animalHandling','arcana','athletics','deception',
  'history','insight','intimidation','investigation','medicine',
  'nature','perception','performance','persuasion','religion',
  'sleightOfHand','stealth','survival',
]

const SKILL_LABELS = {
  acrobatics: 'Acrobatics', animalHandling: 'Animal Handling', arcana: 'Arcana',
  athletics: 'Athletics', deception: 'Deception', history: 'History',
  insight: 'Insight', intimidation: 'Intimidation', investigation: 'Investigation',
  medicine: 'Medicine', nature: 'Nature', perception: 'Perception',
  performance: 'Performance', persuasion: 'Persuasion', religion: 'Religion',
  sleightOfHand: 'Sleight of Hand', stealth: 'Stealth', survival: 'Survival',
}


function toSkillKey(raw) {
  if (!raw) return ''
  if (SKILL_LABELS[raw]) return raw
  const camel = raw.replace(/\s+(.)/g, (_, c) => c.toUpperCase()).replace(/^(.)/, (_, c) => c.toLowerCase())
  if (SKILL_LABELS[camel]) return camel
  return camel
}

function extractRacialSkillChoices(skillProfs) {
  if (!skillProfs || skillProfs.length === 0) return null
  for (const entry of skillProfs) {
    if (typeof entry !== 'object') continue
    if (typeof entry.any === 'number') {
      return { count: entry.any, from: ALL_SKILLS }
    }
    if (entry.choose?.from && Array.isArray(entry.choose.from)) {
      return { count: entry.choose.count || 1, from: entry.choose.from.map(toSkillKey) }
    }
    if (entry.choose?.count) {
      return { count: entry.choose.count, from: ALL_SKILLS }
    }
  }
  return null
}

// ── FEAT CHOICE HELPERS ────────────────────────────────────────────────────────

function getRaceFeatChoiceCount(race, subrace) {
  for (const src of [subrace, race]) {
    if (!src?.feats) continue
    for (const entry of src.feats) {
      if (entry.choose !== undefined) {
        if (typeof entry.choose === 'number') return entry.choose
        if (typeof entry.choose === 'object') return entry.choose.count ?? 1
        return 1
      }
    }
  }
  return 0
}

// ── ASI / SPELL HELPERS ────────────────────────────────────────────────────────

function formatASI(ability) {
  if (!ability || ability.length === 0) return null
  const parts = []
  for (const entry of ability) {
    if (entry.choose) {
      const among = entry.choose.from?.join(', ') || 'any'
      parts.push(`+${entry.choose.count || 1} to ${among}`)
    } else {
      for (const [key, val] of Object.entries(entry)) {
        if (typeof val === 'number') parts.push(`+${val} ${key.toUpperCase()}`)
      }
    }
  }
  return parts.join(', ') || null
}

function hasSpellChoices(additionalSpells) {
  if (!additionalSpells?.length) return false
  for (const entry of additionalSpells) {
    const check = (val) => {
      const items = Array.isArray(val) ? val : [val]
      return items.some(s => typeof s === 'string' && s.trim().startsWith('choose'))
    }
    for (const v of Object.values(entry.known?._ || {})) {
      if (check(v)) return true
    }
    for (const levels of Object.values(entry.innate?._ || {})) {
      for (const v of Object.values(levels)) {
        if (check(v)) return true
      }
    }
  }
  return false
}

function getFixedRacialSpells(additionalSpells) {
  const fixed = []
  for (const entry of (additionalSpells || [])) {
    for (const [, val] of Object.entries(entry.known?._ || {})) {
      const items = Array.isArray(val) ? val : [val]
      items.forEach(s => {
        if (typeof s === 'string' && !s.startsWith('choose') && !s.startsWith('@')) {
          const name = s.split('|')[0].replace(/\b\w/g, c => c.toUpperCase())
          if (!fixed.includes(name)) fixed.push(name)
        }
      })
    }
    for (const [, levels] of Object.entries(entry.innate?._ || {})) {
      for (const [, val] of Object.entries(levels)) {
        const items = Array.isArray(val) ? val : [val]
        items.forEach(s => {
          if (typeof s === 'string' && !s.startsWith('choose') && !s.startsWith('@')) {
            const name = s.split('|')[0].replace(/\b\w/g, c => c.toUpperCase())
            if (!fixed.includes(name)) fixed.push(name)
          }
        })
      }
    }
  }
  return fixed
}

function getExpandedRacialSpells(additionalSpells) {
  const out = []
  for (const entry of (additionalSpells || [])) {
    if (!entry || typeof entry !== 'object') continue
    for (const spells of Object.values(entry.expanded || {})) {
      const items = Array.isArray(spells) ? spells : [spells]
      for (const s of items) {
        if (typeof s === 'string' && !s.startsWith('@')) {
          const name = s.split('|')[0].replace(/\b\w/g, c => c.toUpperCase())
          if (name && !out.includes(name)) out.push(name)
        }
      }
    }
  }
  return out
}

function getEffectiveSubraceSpells(subrace, chosenVariantName) {
  if (!subrace) return []
  const versions = subrace._versions
  if (!Array.isArray(versions) || versions.length === 0) {
    return subrace.additionalSpells || []
  }
  // _versions vorhanden → nur wenn explizit gewählt
  if (!chosenVariantName) return []
  const version = versions.find(v => {
    const parts = (v.name || '').split('; ')
    return parts[parts.length - 1] === chosenVariantName
  })
  if (!version) return []
  if (Object.prototype.hasOwnProperty.call(version, 'additionalSpells')) {
    return version.additionalSpells ?? []   // null → []
  }
  return subrace.additionalSpells || []    // absent → inherit
}

function hasVariantOptions(dataObj) {
  if (!dataObj?.entries || !Array.isArray(dataObj.entries)) return false
  function scan(arr) {
    for (const e of arr) {
      if (!e || typeof e !== 'object') continue
      if (e.type === 'options' && Array.isArray(e.entries) && e.entries.some(o => o?.name)) return true
      if (
        e.type === 'inset' &&
        typeof e.name === 'string' &&
        /choose/i.test(e.name) &&
        Array.isArray(e.entries) &&
        e.entries.some(o => o?.name)
      ) return true
      if (Array.isArray(e.entries) && scan(e.entries)) return true
    }
    return false
  }
  return scan(dataObj.entries)
}


// ── MAIN COMPONENT ─────────────────────────────────────────────────────────────

export default function Step3Race({ character, updateCharacter }) {
  const { t } = useLanguage()
  const [races, setRaces] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    loadRaceList(character.meta.edition).then(data => {
      setRaces(data)
      setLoading(false)
    })
  }, [character.meta.edition])

  const selectedRace    = races.find(r => r.id === character.species.raceId)    || null
  // FIX: use null (not undefined) when no subrace is selected so parseSubraceChoices returns []
  const selectedSubrace = selectedRace?.subraces?.find(s => s.id === character.species.subraceId) || null

  // ── Skill choices ──────────────────────────────────────────────────────────
  // FIX (Bug 1): When _versions is present on the race or subrace, the top-level
  // skillProficiencies field is version-specific data managed exclusively by
  // choiceParser.parseVersionedChoices.  Reading it here would always produce a
  // skill picker (e.g. the "Skill Versatility" branch of Drow Descent) regardless
  // of which variant the player chose.  Return null in that case so the inline
  // picker is suppressed entirely; variant-scoped skills appear in Step7 instead.
  const raceSkillChoices = useMemo(() => {
    const subraceCoversSkills = selectedSubrace?._versions?.some(v =>
      Object.prototype.hasOwnProperty.call(v, 'skillProficiencies')
    )
    if (subraceCoversSkills) return null

    const raceCoversSkills = selectedRace?._versions?.some(v =>
      Object.prototype.hasOwnProperty.call(v, 'skillProficiencies')
    )
    if (raceCoversSkills) return null

    const racePick = extractRacialSkillChoices(selectedRace?.skillProficiencies)
    const subPick  = extractRacialSkillChoices(selectedSubrace?.skillProficiencies)
    return subPick || racePick
  }, [selectedRace, selectedSubrace])

  const chosenRacialSkills = character.species?.traitChoices?.skills || []

  // ── Additional spells ──────────────────────────────────────
  const chosenSubraceVariant =
    (character.species?.raceChoices?.subrace?.variantOptions || [])[0] ?? null

  const effectiveSubraceSpells = useMemo(
    () => getEffectiveSubraceSpells(selectedSubrace, chosenSubraceVariant),
    [selectedSubrace, chosenSubraceVariant]
)

  // ── Handlers ───────────────────────────────────────────────

  // ── Version coverage guard ───────────────────────────────────────────────
  // Generic check: should the race's base value for `key` be suppressed?
  // Returns true when:
  //   (a) the race's own _versions covers that key, OR
  //   (b) the subrace directly provides that key (non-empty array), OR
  //   (c) the subrace's _versions covers that key.
  // Used by handleSelectRace, handleSelectSubrace, and the raceChoices prop
  // to enforce that only ONE branch is active for any covered key.
  function isKeyCoveredForRace(race, subrace, key) {
    if (getVersionCoveredKeys(race?._versions).has(key)) return true
    if (!subrace) return false
    const val = subrace[key]
    if (Array.isArray(val) && val.length > 0) return true
    return getVersionCoveredKeys(subrace?._versions).has(key)
  }

  function handleSelectRace(race) {
    updateCharacter('species.raceId',    race.id)
    updateCharacter('species.source',    race.source)
    updateCharacter('species.subraceId', null)
    updateCharacter('species.speed',     race.speed || 30)
    updateCharacter('species.size',      race.size?.[0] || 'M')
    updateCharacter('species.darkvision', race.darkvision || null)
    // FIX 1: Only store raw racial ASI. Step6 applies it based on user's chosen method.
    // FIX (variant exclusivity): If the race's own _versions covers 'ability',
    // the base ability array is version-managed — do NOT apply it unconditionally.
    const ownCovers = getVersionCoveredKeys(race._versions)
    updateCharacter('species.originalRacialASI',
      ownCovers.has('ability') ? {} : resolveFixedASI(race.ability))
    // FIX (variant exclusivity): If the race's own _versions covers 'additionalSpells',
    // the base spell block is version-managed — do NOT apply it unconditionally.
    const spellBlock = ownCovers.has('additionalSpells') ? [] : (race.additionalSpells || [])
    const fixed    = getFixedRacialSpells(spellBlock)
    const expanded = getExpandedRacialSpells(spellBlock)
    updateCharacter('species.spellChoices',   fixed)
    updateCharacter('species.expandedSpells', expanded)
    updateCharacter('species.traitChoices', { skills: [] })
    // Legacy extraProficiencies.skills no longer used — character.choices is single source
    updateCharacter('species.raceChoices', {
      race:    { abilityScore: null, entryIdx: null, spells: [], feats: [], variantOptions: [] },
      subrace: { abilityScore: null, entryIdx: null, spells: [], feats: [], variantOptions: [] },
    })
    // ── Origin feat cleanup ─────────────────────────────────────────────────
    // Remove feats granted by the previous race (Variant Human, Custom Lineage)
    // and their associated feat:* choice keys.
    const originFeatIds = (character.feats || [])
      .filter(f => f._isOriginFeat)
      .map(f => (f.featId || f.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''))
    updateCharacter('feats', (character.feats || []).filter(f => !f._isOriginFeat))
    // Reset ASI method since origin feat (if any) was just removed
    updateCharacter('species.asiMethod', 'fixed')

    // Clear all stale race / subrace / origin-feat choice keys when switching race.
    const cleaned = Object.fromEntries(
      Object.entries(character.choices || {}).filter(
        ([k]) => {
          if (k.startsWith('race:') || k.startsWith('subrace:')) return false
          // Remove feat:* keys belonging to origin feats
          if (k.startsWith('feat:') && originFeatIds.some(id => k.startsWith(`feat:${id}:`))) return false
          return true
        }
      )
    )
    updateCharacter('choices', cleaned)
  }

  function handleSelectSubrace(sub) {
    updateCharacter('species.subraceId', sub.id)
    // Override speed/darkvision if subrace provides them
    if (sub.speed != null) updateCharacter('species.speed', sub.speed)
    if (sub.darkvision != null) updateCharacter('species.darkvision', sub.darkvision)
    // FIX (variant exclusivity): Only merge race's base ability if the subrace
    // (via _versions or direct override) does NOT cover the 'ability' key.
    const abilityCovered = isKeyCoveredForRace(selectedRace, sub, 'ability')
    const baseASI = abilityCovered ? {} : resolveFixedASI(selectedRace?.ability || [])
    const subASI  = resolveFixedASI(sub.ability || [])
    const merged  = { ...baseASI }
    for (const [k, v] of Object.entries(subASI)) merged[k] = (merged[k] || 0) + v
    // FIX 1: Only store raw racial ASI. Step6 applies it based on user's chosen method.
    updateCharacter('species.originalRacialASI', merged)
    // FIX (variant exclusivity): Only include race's base additionalSpells if the
    // subrace does NOT cover 'additionalSpells' (via _versions or direct override).
    const spellsCovered = isKeyCoveredForRace(selectedRace, sub, 'additionalSpells')
    const raceFixed    = spellsCovered ? [] : getFixedRacialSpells(selectedRace?.additionalSpells || [])
    const subFixed     = getFixedRacialSpells(sub.additionalSpells || [])
    const allFixed     = [...new Set([...raceFixed, ...subFixed])]
    const raceExpanded = spellsCovered ? [] : getExpandedRacialSpells(selectedRace?.additionalSpells || [])
    const subExpanded  = getExpandedRacialSpells(sub.additionalSpells || [])
    const allExpanded  = [...new Set([...raceExpanded, ...subExpanded])]
    const prevChosen = (character.species.spellChoices || []).filter(s => !raceFixed.includes(s))
    updateCharacter('species.spellChoices',   [...allFixed, ...prevChosen])
    updateCharacter('species.expandedSpells', allExpanded)
    updateCharacter('species.traitChoices', { skills: [] })
    // Legacy extraProficiencies.skills no longer used — character.choices is single source
    const prevChoices = character.species.raceChoices || {}
    updateCharacter('species.raceChoices', {
      ...prevChoices,
      subrace: { abilityScore: null, entryIdx: null, spells: [], feats: [], variantOptions: [] },
    })
    // Clear stale subrace: choice keys when switching subrace.
    // Any variant sub-choices from the previous subrace are wiped here.
    const cleanedChoices = Object.fromEntries(
      Object.entries(character.choices || {}).filter(([k]) => !k.startsWith('subrace:'))
    )
    updateCharacter('choices', cleanedChoices)
  }

  function handleRaceChoiceChange(d, val) {
    let newChoices = setChoiceValue(character.choices || {}, d.id, val)

    // When a variant descriptor changes, immediately delete all choice keys that
    // belong to options that are no longer selected. This keeps character.choices
    // as the single source of truth — no stale data, no engine filtering needed.
    // NOTE: after Bug-5 fix, type:'variant' descriptors are no longer rendered by
    // the ChoicePicker block, so this path is only reached for non-_versions races
    // that still use the legacy entries-scan variant path.
    if (d.type === 'variant') {
      // FIX Bug 1+2: Race-Baseline-Deskriptoren für Keys, die Subrace-_versions
      // abdeckt, werden suppresst — sonst würden deren sub-choices nie gelöscht.
      const _rd2 = parseRaceChoices(selectedRace)
      const _sd2 = parseSubraceChoices(selectedSubrace)
      const _svk2 = getVersionCoveredKeys(selectedSubrace?._versions)
      const _T2K2 = { skill:'skillProficiencies', language:'languageProficiencies', tool:'toolProficiencies', ability:'ability', spell:'additionalSpells' }
      const allDescs = [
        ...(_svk2.size === 0 ? _rd2 : _rd2.filter(d => !_T2K2[d.type] || !_svk2.has(_T2K2[d.type]) || !!d.variantId)),
        ..._sd2,
      ]
      const nowSelected = asArray(val)
      for (const sub of allDescs) {
        if (sub.variantId !== d.id) continue
        if (!nowSelected.includes(sub.variantValue)) {
          // This sub-choice belongs to an option that is no longer active — delete it.
          const next = { ...newChoices }
          delete next[sub.id]
          newChoices = next
        }
      }
    }

    updateCharacter('choices', newChoices)
    // FIX 1: Ability choices are stored in character.choices and read by rulesEngine
    // from :ability: keys. Do NOT also write them into species.abilityScoreImprovements
    // — that would double-count them. Step6 manages abilityScoreImprovements.
  }

  function handleSpellChoicesChange(spells) {
    updateCharacter('species.spellChoices', spells)
  }

  function toggleRacialSkill(key) {
    const isSelected = chosenRacialSkills.includes(key)
    let next
    if (isSelected) {
      next = chosenRacialSkills.filter(s => s !== key)
    } else {
      if (chosenRacialSkills.length >= (raceSkillChoices?.count || 0)) return
      next = [...chosenRacialSkills, key]
    }
    // SINGLE SOURCE: only write to character.choices via the descriptor key.
    // Legacy paths (species.traitChoices.skills, extraProficiencies.skills) removed.
    updateCharacter('species.traitChoices', { ...(character.species.traitChoices || {}), skills: next })
    // Build the choice key matching choiceParser's format for race skill descriptors
    const raceSourceId = (selectedRace?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    const choiceKey = `race:${raceSourceId}:skill:0`
    updateCharacter('choices', setChoiceValue(character.choices || {}, choiceKey, next.length ? next : null))
  }

  // ── Misc helpers ───────────────────────────────────────────

  function resolveFixedASI(ability) {
    const result = {}
    for (const entry of (ability || [])) {
      if (!entry.choose) {
        for (const [key, val] of Object.entries(entry)) {
          if (typeof val === 'number') result[key] = (result[key] || 0) + val
        }
      }
    }
    return result
  }

  // ── Render helpers ─────────────────────────────────────────

  const title    = character.meta.edition === '5.5e' ? t('chooseSpecies') : t('chooseRace')
  const subtitle = character.meta.edition === '5.5e' ? t('raceSubtitle55e') : t('raceSubtitle5e')

  function renderListItem(race, isSelected) {
    const asi = formatASI(race.ability)
    return (
      <div>
        <div style={{ color: isSelected ? 'var(--accent)' : 'var(--text-primary)', fontWeight: 'bold', fontSize: 14 }}>
          {race.name}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
          {race.source}
          {asi && ` • ${asi}`}
          {race.hasSubraces && race.subraces?.length > 0 && ' • Hat Unterrassen'}
          {(race.additionalSpells?.length > 0) && ' • Zauber'}
          {race.skillProficiencies?.some(e => e.any || e.choose) && ' • Skill-Wahl'}
          {getRaceFeatChoiceCount(race, null) > 0 && ' • Feat-Wahl'}
        </div>
      </div>
    )
  }

  function renderDetail(race) {
    const validSubraces = (race.subraces || []).filter(s => s.name && s.name.trim().length > 0)
    const raceFixed     = getFixedRacialSpells(race.additionalSpells || [])

    return (
      <div>
        <div style={{ color: 'var(--accent)', fontSize: 22, fontWeight: 'bold', marginBottom: 4 }}>
          {race.name}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 16 }}>
          {t('source')}: {race.source}
        </div>

        {/* Stats badges */}
        <div style={ds.statRow}>
          <StatBadge label={t('speed')} value={`${race.speed} ft.`} />
          <StatBadge label={t('size')}  value={race.size.map(s => SIZE_LABELS[s] || s).join(', ')} />
          {formatASI(race.ability) && (
            <StatBadge label="ASI" value={formatASI(race.ability)} />
          )}
          {race.darkvision && <StatBadge label="Darkvision" value={`${race.darkvision} ft.`} />}
          {raceFixed.length > 0 && (
            <StatBadge label="Zauber" value={raceFixed.join(', ')} color="#a78bfa" />
          )}
          {getRaceFeatChoiceCount(race, null) > 0 && (
            <StatBadge label="Feat" value="Wählbar" color="#69db7c" />
          )}
        </div>

        {/* Trait tags */}
        {race.traitTags?.length > 0 && (
          <div style={ds.tagRow}>
            {race.traitTags.map(tag => (
              <span key={tag} style={ds.tag}>{tag}</span>
            ))}
          </div>
        )}

        <EntryRenderer entries={race.entries} />

        {/* Subraces */}
        {validSubraces.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ color: 'var(--accent)', fontWeight: 'bold', marginBottom: 10, fontSize: 13 }}>
              {t('subraceTitle')}
            </div>
            {validSubraces.map(sub => {
              const subFixed      = getFixedRacialSpells(sub.additionalSpells || [])
              const isSelectedSub = character.species.subraceId === sub.id
              // FIX (Bug 7): When _versions is present the subrace's skillProficiencies
              // belongs to one specific variant, not to the subrace unconditionally.
              // Show a generic "Variant Feature" indicator instead of "Skill-Wahl".
              const subHasVersions      = sub._versions?.length > 0
              const subHasUnconditionalSkills =
                !subHasVersions && !!extractRacialSkillChoices(sub.skillProficiencies)
              return (
                <div key={sub.id}
                  style={{ ...ds.subraceCard, ...(isSelectedSub ? ds.subraceSelected : {}) }}
                  onClick={() => handleSelectSubrace(sub)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 14 }}>{sub.name}</div>
                    {isSelectedSub && <span style={{ color: 'var(--accent)', fontSize: 12 }}>✓ Gewählt</span>}
                  </div>
                  {formatASI(sub.ability) && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
                      ASI: {formatASI(sub.ability)}
                    </div>
                  )}
                  {subFixed.length > 0 && (
                    <div style={{ color: 'var(--accent-purple)', fontSize: 12, marginTop: 2 }}>
                      🔮 Zauber: {subFixed.join(', ')}
                    </div>
                  )}
                  {hasSpellChoices(sub.additionalSpells) && (
                    <div style={{ color: 'var(--accent-blue)', fontSize: 11, marginTop: 2 }}>
                      + Zauberauswahl vorhanden
                    </div>
                  )}
                  {/* Unconditional skill choice (no _versions) */}
                  {subHasUnconditionalSkills && (
                    <div style={{ color: 'var(--accent-green)', fontSize: 11, marginTop: 2 }}>
                      + Skill-Wahl vorhanden
                    </div>
                  )}
                  {/* Variant feature badge (_versions present — skills/spells are conditional) */}
                  {subHasVersions && (
                    <div style={{ color: 'var(--accent)', fontSize: 11, marginTop: 2 }}>
                      ⚡ Variant Feature (wählbar)
                    </div>
                  )}
                  {getRaceFeatChoiceCount(null, sub) > 0 && (
                    <div style={{ color: 'var(--accent)', fontSize: 11, marginTop: 2 }}>
                      🎖 Feat-Wahl vorhanden
                    </div>
                  )}
                  {sub.traitTags?.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                      {sub.traitTags.slice(0, 4).map(tag => (
                        <span key={tag} style={{ ...ds.tag, fontSize: 10 }}>{tag}</span>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: 6 }}>
                    <EntryRenderer entries={sub.entries?.slice(0, 3)} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── RENDER ─────────────────────────────────────────────────

  return (
    <div>
      <h2 style={{ color: 'var(--accent)', marginBottom: 4 }}>{title}</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 16, fontSize: 14 }}>{subtitle}</p>

      <BrowsePanel
        items={races}
        selectedId={character.species.raceId}
        onSelect={handleSelectRace}
        renderListItem={renderListItem}
        renderDetail={renderDetail}
        searchKeys={['name', 'source']}
        loading={loading}
      />

      {/* ── Racial Spell / Ability / Variant Choice (RaceChoicePicker) ───────── */}
      {/* RaceChoicePicker is the single authoritative renderer for variant        */}
      {/* feature pickers (VariantOptionSection with hover-preview).  The variant */}
      {/* selection is bridged into character.choices so filterActiveDescriptors   */}
      {/* can gate variant-specific sub-descriptors in Step7 and below.           */}
      {character.species.raceId && (
        <RaceChoicePicker
          raceChoices     = {
            // FIX (variant exclusivity): Suppress race's base additionalSpells
            // when subrace covers them (via _versions or direct override).
            isKeyCoveredForRace(selectedRace, selectedSubrace, 'additionalSpells')
              ? []
              : (selectedRace?.additionalSpells    || [])
          }
          // FIX Bug 1b + 3: effectiveSubraceSpells gibt nur die Spells der
          // gewählten Variante zurück (leer wenn keine gewählt, oder wenn
          // _versions die Spells exklusiv verwaltet). Verhindert, dass
          // Spells aller Varianten gleichzeitig als "auto" angezeigt werden.
          subraceChoices={effectiveSubraceSpells}
          selections      = {character.species.raceChoices    || {}}
          onChange        = {(sel) => {
            updateCharacter('species.raceChoices', sel)
            const normStr = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]/g, '_')
            let mirror = { ...(character.choices || {}) }

            // ── Spell mirror (unchanged) ────────────────────────────────────
            if (sel.race?.spells?.length) {
              mirror[`race:${normStr(selectedRace?.name)}:spell:0`] = sel.race.spells
            }
            if (sel.subrace?.spells?.length) {
              mirror[`subrace:${normStr(selectedSubrace?.name)}:spell:0`] = sel.subrace.spells
            }

            // ── Variant mirror (FIX Bug 6) ──────────────────────────────────
            // RaceChoicePicker stores the chosen variant in sel.*.variantOptions[].
            // choiceParser.filterActiveDescriptors reads character.choices[variantDescId]
            // to decide which variant-gated sub-descriptors (skills, spells, ability…)
            // are active.  Bridge the two here so variant-gated choices in Step7
            // correctly activate the moment the player picks a variant option.
            //
            // mirrorVariant:
            //   versions   — _versions array on the entity (guard: skip when absent)
            //   descs      — ChoiceDescriptor[] from the parser (contains the variant desc)
            //   chosenName — the selected option name, or null to clear
            function mirrorVariant(versions, descs, chosenName) {
              if (!versions?.length) return
              const variantDesc = descs.find(d => d.type === 'variant')
              if (!variantDesc) return

              if (chosenName) {
                mirror[variantDesc.id] = chosenName
              } else {
                delete mirror[variantDesc.id]
              }

              // Eagerly delete sub-choice keys for options that are no longer chosen
              // so stale data from a previously selected variant branch never leaks.
              for (const d of descs) {
                if (d.variantId === variantDesc.id && d.variantValue !== chosenName) {
                  delete mirror[d.id]
                }
              }
            }

            mirrorVariant(
              selectedRace?._versions,
              parseRaceChoices(selectedRace),
              (sel.race?.variantOptions    || [])[0] ?? null,
            )
            mirrorVariant(
              selectedSubrace?._versions,
              parseSubraceChoices(selectedSubrace),
              (sel.subrace?.variantOptions || [])[0] ?? null,
            )

            updateCharacter('choices', mirror)
          }}
          raceName        = {selectedRace?.name}
          subraceName     = {selectedSubrace?.name}
          edition         = {character.meta.edition}
          raceData        = {selectedRace    || null}
          subraceData     = {selectedSubrace || null}
          character       = {character}
          updateCharacter = {updateCharacter}
        />
      )}

      {/* ── Race / Subrace non-proficiency choice descriptors ─────────────── */}
      {/* Proficiency choices (skill/language/tool/weapon) live in Step7.       */}
      {/* Color (Dragonborn), ability, feat choices are shown here.             */}
      {/*                                                                        */}
      {/* FIX (Bug 5): 'variant' is excluded from the filter.                   */}
      {/*   RaceChoicePicker already renders VariantOptionSection (with preview) */}
      {/*   for every _versions block.  Previously, the type:'variant' descriptor*/}
      {/*   from parseVersionedChoices also passed through here, producing a     */}
      {/*   second, preview-less duplicate picker for the exact same choice.     */}
      {/*   Adding d.type !== 'variant' to the filter eliminates the duplicate.  */}
      {/*   The variant descriptor still lives in allDescs so that               */}
      {/*   filterActiveDescriptors can resolve variantId references on gated    */}
      {/*   sub-descriptors — it just isn't rendered as a ChoicePicker anymore.  */}
      {/*                                                                        */}
      {/* FIX (Bug 1): filterActiveDescriptors ensures only choices for the      */}
      {/*   CHOSEN variant option are displayed. Unchosen options stay hidden.   */}
      {selectedRace && (() => {
        const PROF_TYPES = new Set(['skill','language','tool','weapon'])

        const raceDescs    = parseRaceChoices(selectedRace)
        // FIX: pass selectedSubrace directly (null when not selected → returns [])
        const subraceDescs = parseSubraceChoices(selectedSubrace)
        // FIX Bug 1+2: Subrace _versions kann Race-Baseline-Keys überschreiben.
        // Race-Deskriptoren ohne variantId für abgedeckte Keys werden gefiltert,
        // sonst erscheinen z.B. ability-Pickers doppelt (Race-Baseline + Subrace-Variante).
        const _svk3 = getVersionCoveredKeys(selectedSubrace?._versions)
        const _T2K3 = { skill:'skillProficiencies', language:'languageProficiencies', tool:'toolProficiencies', ability:'ability', spell:'additionalSpells' }
        const filteredRaceDescs = _svk3.size === 0
          ? raceDescs
          : raceDescs.filter(d => !_T2K3[d.type] || !_svk3.has(_T2K3[d.type]) || !!d.variantId)
        const allDescs     = [...filteredRaceDescs, ...subraceDescs]

        // Apply variant filter: only active variant sub-choices (and ungated) descriptors.
        // Exclude proficiency types (Step7), spells (RaceChoicePicker), and variant
        // descriptors (RaceChoicePicker's VariantOptionSection handles those).
        const activeDescs = filterDescriptorsByActiveVariants(allDescs, character.choices || {})
          .filter(d => !PROF_TYPES.has(d.type) && d.type !== 'spell' && d.type !== 'variant' && d.type !== 'ability')

        if (activeDescs.length === 0) return null
        return (
          <div style={{ marginTop: 16 }}>
            {activeDescs.map(d => (
              <div key={d.id} style={{ marginBottom: 14 }}>
                <ChoicePicker
                  descriptor = {d}
                  value      = {(character.choices || {})[d.id] ?? null}
                  onChange   = {val => handleRaceChoiceChange(d, val)}
                />
              </div>
            ))}
          </div>
        )
      })()}

    </div>
  )
}

// ── SHARED HELPERS ─────────────────────────────────────────────────────────────

function formatPrerequisite(prereq) {
  if (!prereq) return ''
  if (typeof prereq === 'string') return prereq
  if (Array.isArray(prereq)) {
    return prereq.map(p => {
      if (p.level)        return `Level ${p.level.level}${p.level.class ? ' ' + p.level.class.name : ''}`
      if (p.ability)      return Object.entries(p.ability).map(([k, v]) => `${k.toUpperCase()} ${v}+`).join(', ')
      if (p.race)         return (p.race || []).map(r => r.name).join(' or ')
      if (p.spellcasting) return 'Spellcasting ability'
      return JSON.stringify(p)
    }).join('; ')
  }
  return JSON.stringify(prereq)
}

// ── SUB-COMPONENTS ─────────────────────────────────────────────────────────────

function StatBadge({ label, value, color }) {
  return (
    <div style={ds.statBadge}>
      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{label}</span>
      <span style={{ color: color || 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 }}>{value}</span>
    </div>
  )
}

// ── STYLES ─────────────────────────────────────────────────────────────────────

const ds = {
  statRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  statBadge: {
    background: 'var(--bg-highlight)', borderRadius: 6, padding: '4px 10px',
    display: 'flex', flexDirection: 'column', gap: 2,
  },
  tagRow: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 },
  tag: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4,
    padding: '2px 8px', color: 'var(--text-muted)', fontSize: 11,
  },
  subraceCard: {
    background: 'var(--bg-elevated)', border: '2px solid var(--border)', borderRadius: 8,
    padding: 12, marginBottom: 8, cursor: 'pointer',
  },
  subraceSelected: { border: '2px solid var(--accent)', background: 'var(--bg-hover)' },
  innateBox: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px',
  },
  innatePill: {
    background: 'var(--bg-highlight)', border: '1px solid #2a6a4a', borderRadius: 6,
    padding: '3px 10px', fontSize: 12, color: 'var(--text-secondary)',
  },
}