// components/steps/Step7Proficiencies.jsx
// ─────────────────────────────────────────────────────────────────────────────
// All-in-one proficiency step: class skills, expertise, racial prof choices,
// feat choices, and a summary of all granted proficiencies.
//
// KEY FIXES vs. previous version:
//  1. filterActiveDescriptors: racial proficiency choices that belong to
//     un-chosen variant options are now hidden. Only the active variant's
//     sub-choices are shown (e.g. Half-Elf Skill Versatility vs Elf Weapon
//     Training — only the chosen one's picks are offered).
//  2. parseSubraceChoices receives `null` (not `{}`) when no subrace is
//     selected, so it returns [] cleanly without ghost descriptors.
//  3. Duplicate-proficiency guard: skills already chosen from race variants
//     are correctly blocked in the class skill picker.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { useLanguage } from '../../../lib/i18n'
import { loadFeatList, loadRaceList } from '../../../lib/dataLoader'
import {
  getAllChoiceDescriptors,
  setChoiceValue,
  parseFeatFixedProficiencies,
  asArray,
} from '../../../lib/choiceParser'
import ChoicePicker from '../../ui/ChoicePicker'

// ── Constants ──────────────────────────────────────────────────────────────────

const ALL_SKILLS = [
  'acrobatics','animalHandling','arcana','athletics','deception',
  'history','insight','intimidation','investigation','medicine',
  'nature','perception','performance','persuasion','religion',
  'sleightOfHand','stealth','survival',
]

const SKILL_LABELS = {
  acrobatics: 'Acrobatics',     animalHandling: 'Animal Handling', arcana: 'Arcana',
  athletics: 'Athletics',       deception: 'Deception',            history: 'History',
  insight: 'Insight',           intimidation: 'Intimidation',       investigation: 'Investigation',
  medicine: 'Medicine',         nature: 'Nature',                  perception: 'Perception',
  performance: 'Performance',   persuasion: 'Persuasion',           religion: 'Religion',
  sleightOfHand: 'Sleight of Hand', stealth: 'Stealth',            survival: 'Survival',
}

const SKILL_ABILITY = {
  acrobatics: 'dex', animalHandling: 'wis', arcana: 'int',
  athletics: 'str',  deception: 'cha',      history: 'int',
  insight: 'wis',    intimidation: 'cha',   investigation: 'int',
  medicine: 'wis',   nature: 'int',         perception: 'wis',
  performance: 'cha',persuasion: 'cha',      religion: 'int',
  sleightOfHand: 'dex', stealth: 'dex',     survival: 'wis',
}

const ABILITY_ABBR = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' }

const EXPERTISE_L1 = {
  Rogue: { count: 2, includesThievesTools: true },
}

const FEATURE_TYPE_LABEL = {
  'MM':   { label: 'Metamagic',      emoji: '✦' },
  'FS:F': { label: 'Fighting Style', emoji: '⚔' },
  'FS:R': { label: 'Fighting Style', emoji: '⚔' },
  'FS:P': { label: 'Fighting Style', emoji: '⚔' },
  'EI':   { label: 'Eldritch Invocation', emoji: '✦' },
  'MV:B': { label: 'Maneuver',       emoji: '★' },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function toSkillKey(raw) {
  if (!raw) return ''
  if (SKILL_LABELS[raw]) return raw
  const camel = raw.trim()
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toLowerCase())
  if (SKILL_LABELS[camel]) return camel
  const lower = raw.toLowerCase().replace(/\s/g, '')
  for (const k of ALL_SKILLS) { if (k.toLowerCase() === lower) return k }
  return camel
}

function extractSkillChoices(startingProfs) {
  const skills = startingProfs?.skills
  if (!skills || skills.length === 0) return null
  for (const entry of skills) {
    if (entry?.choose?.from && Array.isArray(entry.choose.from))
      return { count: entry.choose.count || 2, from: entry.choose.from }
    if (typeof entry?.any === 'number') return { count: entry.any, from: ALL_SKILLS }
  }
  return null
}

function flattenProfList(arr = []) {
  return arr.flatMap(entry => {
    if (typeof entry === 'string') return [entry]
    if (typeof entry === 'object') {
      if (entry.choose?.from) return [entry.choose.from.join(' or ')]
      const keys = Object.keys(entry).filter(k => k !== 'choose')
      return keys.length > 0 ? [keys.join(', ')] : []
    }
    return [String(entry)]
  }).filter(Boolean)
}

function parseTags(str) {
  return String(str || '').replace(/\{@[a-z]+\s([^}]+)\}/g, (_, inner) =>
    inner.split('|')[0]
  )
}

function getModifier(score) { return Math.floor((score - 10) / 2) }
function modStr(mod)        { return mod >= 0 ? `+${mod}` : `${mod}` }


// ── Main Component ─────────────────────────────────────────────────────────────

export default function Step7Proficiencies({ character, updateCharacter }) {
  const { t }    = useLanguage()
  const cls      = character.classes[0]
  const edition  = character.meta.edition || '5e'

  // ── Load race data for racial proficiency choices ─────────────────────────
  const [races, setRaces] = useState([])
  useEffect(() => {
    if (!character.species.raceId) return
    loadRaceList(edition).then(setRaces)
  }, [character.species.raceId, edition])

  // ── Load feat data for granted proficiencies ───────────────────────────────
  const [allFeatData, setAllFeatData] = useState([])
  useEffect(() => {
    loadFeatList(edition).then(setAllFeatData)
  }, [edition])

  // Resolve full feat data for every feat on the character + background feat
  const resolvedFeats = (() => {
    const names = [
      ...(character.feats || []).map(f => f.featId || f.name),
      ...(character.background?.feat?.name ? [character.background.feat.name] : []),
    ]
    return names
      .map(n => allFeatData.find(fd => fd.name.toLowerCase() === (n || '').toLowerCase()))
      .filter(Boolean)
  })()

  // Compute fixed (non-choice) proficiencies from all feats for GrantedSection
  const featFixedProfs = (() => {
    const result = { armor: [], weapons: [], tools: [], skills: [], languages: [] }
    for (const fd of resolvedFeats) {
      const fp = parseFeatFixedProficiencies(fd)
      for (const a of fp.armor)     if (!result.armor.includes(a))     result.armor.push(a)
      for (const w of fp.weapons)   if (!result.weapons.includes(w))   result.weapons.push(w)
      for (const t of fp.tools)     if (!result.tools.includes(t))     result.tools.push(t)
      for (const s of fp.skills)    if (!result.skills.includes(s))    result.skills.push(s)
      for (const l of fp.languages) if (!result.languages.includes(l)) result.languages.push(l)
    }
    return result
  })()

  const selectedRace = races.find(r => r.id === character.species.raceId) || null
  // FIX: use null (not `|| {}`) when subrace not found → parseSubraceChoices(null) returns []
  const selectedSubrace = selectedRace?.subraces?.find(s => s.id === character.species.subraceId) || null

  // ── Compute final ability scores (base + racial ASI) ──────────────────────
  const racialASI = character.species?.abilityScoreImprovements || {}
  const base      = character.abilityScores.base || {}
  const final     = {}
  for (const ab of ['str','dex','con','int','wis','cha']) {
    final[ab] = (base[ab] || 8) + (racialASI[ab] || 0)
  }
  const PB = 2

  function abilityMod(ab)    { return getModifier(final[ab] || 8) }
  function skillMod(key)     { return abilityMod(SKILL_ABILITY[key]) }
  function skillProfMod(key) { return skillMod(key) + PB }
  function skillExpMod(key)  { return skillMod(key) + PB * 2 }

  // ── Proficiency sources ───────────────────────────────────────────────────
  const bgSkills = (character.background?.skillProficiencies || []).map(toSkillKey)
  const bgTools  = character.background?.toolProficiencies   || []

  // ── FIX: racial skill choices now go through getAllChoiceDescriptors
  // so variant-gated sub-choices (e.g. Half-Elf variants) are honoured correctly
  // and subrace _versions coverage is handled in one place.
  const racialChosenSkills = (() => {
    if (!selectedRace) return []
    const allDescs = getAllChoiceDescriptors({
      race: selectedRace,
      subrace: selectedSubrace,
      choices: character.choices || {},
    }).filter(d => d.type === 'skill' && (d.source === 'race' || d.source === 'subrace'))
    return allDescs.flatMap(d => {
      const val = (character.choices || {})[d.id]
      return Array.isArray(val) ? val : (val ? [val] : [])
    })
  })()

  const classProfs   = cls?.startingProficiencies || {}
  const classArmor   = flattenProfList(classProfs.armor).map(parseTags)
  const classWeapons = flattenProfList(classProfs.weapons).map(parseTags)
  const classSaves   = classProfs.savingThrows || []
  const classTools   = flattenProfList(classProfs.tools).map(parseTags)

  // FIX 4: Compute already-granted languages and tools from ALL sources
  const grantedLanguages = (() => {
    const langs = []
    const addFixed = (profs) => {
      for (const entry of (profs || [])) {
        if (!entry || typeof entry !== 'object') continue
        for (const [k, v] of Object.entries(entry)) {
          if (v === true && !langs.includes(k)) langs.push(k)
        }
      }
    }
    addFixed(selectedRace?.languageProficiencies)
    addFixed(selectedSubrace?.languageProficiencies)
    for (const l of (character.background?.languages || [])) {
      if (!langs.includes(l)) langs.push(l)
    }
    for (const l of featFixedProfs.languages) {
      if (!langs.includes(l)) langs.push(l)
    }
    // Also include languages already chosen via descriptors (from any source)
    for (const [k, v] of Object.entries(character.choices || {})) {
      if (k.split(':').slice(-2, -1)[0] !== 'language') continue
      for (const l of (Array.isArray(v) ? v : (v ? [v] : []))) {
        if (!langs.includes(l)) langs.push(l)
      }
    }
    return langs
  })()

  const grantedTools = (() => {
    const tools = []
    const addFixed = (profs) => {
      for (const entry of (profs || [])) {
        if (!entry || typeof entry !== 'object') continue
        for (const [k, v] of Object.entries(entry)) {
          if (v === true && k !== 'choose' && k !== 'any' && !tools.includes(k)) tools.push(k)
        }
      }
    }
    addFixed(selectedRace?.toolProficiencies)
    addFixed(selectedSubrace?.toolProficiencies)
    for (const t of bgTools) { if (!tools.includes(t)) tools.push(t) }
    for (const t of featFixedProfs.tools) { if (!tools.includes(t)) tools.push(t) }
    // Also include tools already chosen via descriptors (from any source)
    for (const [k, v] of Object.entries(character.choices || {})) {
      if (k.split(':').slice(-2, -1)[0] !== 'tool') continue
      for (const t of (Array.isArray(v) ? v : (v ? [v] : []))) {
        if (!tools.includes(t)) tools.push(t)
      }
    }
    return tools
  })()

  // ── Class skill choices ───────────────────────────────────────────────────
  const skillChoices    = extractSkillChoices(classProfs)
  // SINGLE SOURCE: read from character.choices, not levelChoices
  const classSkillKey   = cls ? `class:${cls.classId.toLowerCase()}:level1:skill:0` : null
  const selectedSkills  = asArray((character.choices || {})[classSkillKey])

  // ── Expertise ─────────────────────────────────────────────────────────────
  const expertiseInfo    = cls ? (EXPERTISE_L1[cls.classId] || null) : null
  // SINGLE SOURCE: read from character.choices, not levelChoices
  const classExpertiseKey = cls ? `class:${cls.classId.toLowerCase()}:level1:expertise:0` : null
  const selectedExpertise = asArray((character.choices || {})[classExpertiseKey])

  // FIX: Collect ALL proficient skills from every source for expertise and disable checks
  const allDescriptorChosenSkills = (() => {
    const skills = []
    for (const [k, v] of Object.entries(character.choices || {})) {
      // Match any choice key ending in :skill:N
      const parts = k.split(':')
      const typeIdx = parts.length >= 2 ? parts[parts.length - 2] : ''
      if (typeIdx !== 'skill') continue
      for (const s of (Array.isArray(v) ? v : (v ? [v] : []))) {
        if (!skills.includes(s)) skills.push(s)
      }
    }
    return skills
  })()

  const allProficientSkills = [...new Set([
    ...bgSkills, ...selectedSkills, ...racialChosenSkills,
    ...featFixedProfs.skills, ...allDescriptorChosenSkills,
  ])]

  const expertiseOptions = [
    ...allProficientSkills,
    ...(expertiseInfo?.includesThievesTools ? ["thieves' tools"] : [])
  ]

  // ── Update helpers ────────────────────────────────────────────────────────
  function updateLevelChoice(patch) {
    const updated = [...character.classes]
    updated[0] = {
      ...updated[0],
      levelChoices: {
        ...updated[0].levelChoices,
        1: { ...(updated[0].levelChoices?.[1] || {}), ...patch },
      },
    }
    updateCharacter('classes', updated)
  }

  function setChoice(id, val) {
    updateCharacter('choices', setChoiceValue(character.choices || {}, id, val))
  }

  function toggleSkill(key) {
    // FIX: block toggling if skill is already granted by any source
    if (bgSkills.includes(key) || racialChosenSkills.includes(key) || featFixedProfs.skills.includes(key)) return
    // Also block if granted by a descriptor-based choice from another source
    const isDescriptorGranted = allDescriptorChosenSkills.includes(key) && !selectedSkills.includes(key)
    if (isDescriptorGranted) return
    const isSel = selectedSkills.includes(key)
    if (isSel) {
      const next = selectedSkills.filter(s => s !== key)
      // Also remove from expertise if skill is being un-selected
      const nextExp = selectedExpertise.filter(e => e !== key)
      // FIX: batch both changes into one updateCharacter call to avoid stale state
      let choices = character.choices || {}
      choices = setChoiceValue(choices, classSkillKey, next.length ? next : null)
      choices = setChoiceValue(choices, classExpertiseKey, nextExp.length ? nextExp : null)
      updateCharacter('choices', choices)
    } else {
      if (selectedSkills.length >= (skillChoices?.count || 0)) return
      const next = [...selectedSkills, key]
      setChoice(classSkillKey, next)
    }
  }

  function toggleExpertise(key) {
    const isSel = selectedExpertise.includes(key)
    if (isSel) {
      const next = selectedExpertise.filter(e => e !== key)
      setChoice(classExpertiseKey, next.length ? next : null)
    } else {
      if (selectedExpertise.length >= (expertiseInfo?.count || 0)) return
      const next = [...selectedExpertise, key]
      setChoice(classExpertiseKey, next)
    }
  }

  function updateFeatChoices(progressionName, choices) {
    updateCharacter('background.featChoices', {
      ...(character.background?.featChoices || {}),
      [progressionName]: choices,
    })
  }

  if (!cls) {
    return (
      <div style={S.container}>
        <h2 style={S.title}>Proficiencies</h2>
        <p style={{ color: 'var(--text-muted)' }}>Please choose a class first.</p>
      </div>
    )
  }

  const remainingSkills    = (skillChoices?.count || 0) - selectedSkills.length
  const remainingExpertise = (expertiseInfo?.count || 0) - selectedExpertise.length

  return (
    <div style={S.container}>
      <h2 style={S.title}>Proficiencies</h2>
      <p style={S.subtitle}>
        All proficiencies in one place. Modifiers reflect your final ability scores.
        Proficiency bonus at level 1: <strong style={{ color: 'var(--accent)' }}>+{PB}</strong>
      </p>

      {/* ── 1. Granted Proficiencies ─────────────────────────────────────── */}
      <GrantedSection
        bgSkills      = {bgSkills}
        bgTools       = {bgTools}
        classArmor    = {classArmor}
        classWeapons  = {classWeapons}
        classSaves    = {classSaves}
        classTools    = {classTools}
        className     = {cls.classId}
        skillProfMod  = {skillProfMod}
        featProfs     = {featFixedProfs}
      />

      {/* ── 2. Choose Class Skills ───────────────────────────────────────── */}
      {skillChoices && (
        <div style={S.section}>
          <div style={S.sectionTitle}>
            Choose {skillChoices.count} Skills — {cls.classId}
            <span style={{
              color: remainingSkills === 0 ? 'var(--accent-green)' : 'var(--accent)',
              marginLeft: 10, fontSize: 12, textTransform: 'none', fontWeight: 'normal',
            }}>
              {remainingSkills === 0 ? '✓ Done' : `${selectedSkills.length} / ${skillChoices.count}`}
            </span>
          </div>

          <div style={S.progressTrack}>
            <div style={{
              ...S.progressFill,
              width: `${Math.min(100, (selectedSkills.length / skillChoices.count) * 100)}%`,
            }} />
          </div>

          <div style={S.skillGrid}>
            {skillChoices.from.map(raw => {
              const key           = toSkillKey(raw)
              const isFromBg      = bgSkills.includes(key)
              const isFromRace    = racialChosenSkills.includes(key)
              const isFromFeat    = featFixedProfs.skills.includes(key)
              // FIX: also check descriptor-chosen skills from other sources (race/feat descriptors)
              const isFromDescriptor = allDescriptorChosenSkills.includes(key) && !selectedSkills.includes(key)
              const isAlreadyHave = isFromBg || isFromRace || isFromFeat || isFromDescriptor
              const isSel         = selectedSkills.includes(key)
              const isDisabled    = isAlreadyHave || (!isSel && selectedSkills.length >= skillChoices.count)
              const baseMod       = skillMod(key)
              const profMod       = skillProfMod(key)
              const ab            = SKILL_ABILITY[key]
              const sourceLabel   = isFromBg ? 'Background' : isFromRace ? 'Race' : isFromFeat ? 'Feat' : isFromDescriptor ? 'Granted' : null

              return (
                <button
                  key={key}
                  disabled={isDisabled}
                  onClick={() => toggleSkill(key)}
                  style={{
                    ...S.skillBtn,
                    ...(isAlreadyHave ? S.skillBtnBg       : {}),
                    ...(isSel         ? S.skillBtnSelected  : {}),
                    ...(isDisabled && !isAlreadyHave ? { opacity: 0.35 } : {}),
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  <div style={{ lineHeight: 1.3 }}>
                    <div style={S.skillName}>{SKILL_LABELS[key] || raw}</div>
                    <div style={{ color: isAlreadyHave ? 'var(--border)' : 'var(--text-muted)', fontSize: 10 }}>
                      {ABILITY_ABBR[ab]}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {sourceLabel
                      ? <span style={S.sourceTag}>{sourceLabel}</span>
                      : (
                          <>
                            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{modStr(baseMod)}</span>
                            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>→</span>
                            <span style={{
                              ...S.modBadge,
                              background: isSel ? 'var(--bg-highlight)' : 'var(--bg-card)',
                              color:      isSel ? 'var(--accent-green)' : 'var(--text-muted)',
                              border: `1px solid ${isSel ? 'var(--accent-green)' : 'var(--border)'}`,
                            }}>
                              {modStr(profMod)}
                            </span>
                          </>
                        )
                    }
                    {isSel && !isAlreadyHave && <span style={{ color: 'var(--accent)', fontSize: 14 }}>✓</span>}
                  </div>
                </button>
              )
            })}
          </div>

          {(bgSkills.length > 0 || racialChosenSkills.length > 0) && (
            <div style={S.hint}>
              {bgSkills.length > 0 && <>Already proficient from background: {bgSkills.map(k => SKILL_LABELS[k] || k).join(', ')}.</>}
              {bgSkills.length > 0 && racialChosenSkills.length > 0 && ' '}
              {racialChosenSkills.length > 0 && <>Already chosen from race: {racialChosenSkills.map(k => SKILL_LABELS[k] || k).join(', ')}.</>}
            </div>
          )}
        </div>
      )}

      {/* ── 3. Proficiency Choices (grouped by source) ──────────────────── */}
      {(() => {
        const PROF_TYPES = new Set(['skill', 'language', 'tool', 'weapon'])

        const allDescs = getAllChoiceDescriptors({
          race:    selectedRace,
          subrace: selectedSubrace,
          feats:   resolvedFeats,
          choices: character.choices || {},
        }).filter(d => PROF_TYPES.has(d.type))

        if (allDescs.length === 0) return null

        // FIX 5: Group descriptors by source + sourceId for labelling
        const SOURCE_LABELS = {
          race:       selectedRace?.name ? `Race: ${selectedRace.name}` : 'Race',
          subrace:    selectedSubrace?.name ? `Subrace: ${selectedSubrace.name}` : 'Subrace',
          background: `Background: ${character.background?.backgroundId || 'Background'}`,
          class:      `⚔ Class: ${cls?.classId || 'Class'}`,
        }

        // Build ordered groups: race → subrace → background → class → each feat
        const groups = []
        const bySource = {}
        for (const d of allDescs) {
          const groupKey = d.source === 'feat' ? `feat:${d.sourceId}` : d.source
          if (!bySource[groupKey]) bySource[groupKey] = []
          bySource[groupKey].push(d)
        }

        for (const src of ['race', 'subrace', 'background', 'class']) {
          if (bySource[src]?.length > 0) {
            groups.push({ key: src, label: SOURCE_LABELS[src], descs: bySource[src] })
          }
        }
        // Feat groups: find feat name from resolvedFeats by sourceId
        for (const [gk, descs] of Object.entries(bySource)) {
          if (!gk.startsWith('feat:')) continue
          const sid = gk.slice(5)
          const feat = resolvedFeats.find(f =>
            (f.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') === sid
          )
          groups.push({
            key: gk,
            label: `⭐ Feat: ${feat?.name || sid}`,
            descs,
          })
        }

        // Collect all already-granted skills across all sources
        const allGrantedSkills = [...new Set([
          ...bgSkills, ...selectedSkills, ...racialChosenSkills,
          ...featFixedProfs.skills, ...allDescriptorChosenSkills,
        ])]

        // FIX 6: Shared skill-grid renderer
        function renderSkillDescriptor(d, val) {
          const sel = Array.isArray(val) ? val : (val ? [val] : [])
          const full = sel.length >= d.count
          return (
            <div key={d.id} style={{ marginBottom: 16 }}>
              <div style={{ ...S.sectionTitle, borderBottom: 'none', marginBottom: 6, fontSize: 12 }}>
                {d.label}
                <span style={{
                  marginLeft: 10, fontSize: 12, textTransform: 'none', fontWeight: 'normal',
                  color: full ? 'var(--accent-green)' : 'var(--accent)',
                }}>
                  {full ? '✓ Done' : `${sel.length} / ${d.count}`}
                </span>
              </div>
              <div style={S.skillGrid}>
                {(d.options || []).map(opt => {
                  const key           = opt.value
                  const isSel         = sel.includes(key)
                  const isFromBg      = bgSkills.includes(key)
                  const isFromClass   = selectedSkills.includes(key)
                  const isFromRace    = racialChosenSkills.includes(key) && d.source !== 'race' && d.source !== 'subrace'
                  const isFromFeat    = featFixedProfs.skills.includes(key) && d.source !== 'feat'
                  // FIX: cross-check descriptor-chosen skills from OTHER descriptors
                  const isFromOtherDesc = !isSel && allDescriptorChosenSkills.includes(key) &&
                    !sel.includes(key)  // don't block our own selections
                  // Only count as "other descriptor" if it's not THIS descriptor's own selection
                  const isOtherDescGranted = (() => {
                    if (!isFromOtherDesc) return false
                    // Check if the skill is chosen by a DIFFERENT descriptor
                    for (const [k2, v2] of Object.entries(character.choices || {})) {
                      if (k2 === d.id) continue // skip self
                      const parts2 = k2.split(':')
                      if (parts2[parts2.length - 2] !== 'skill') continue
                      const vals2 = Array.isArray(v2) ? v2 : (v2 ? [v2] : [])
                      if (vals2.includes(key)) return true
                    }
                    return false
                  })()
                  const isAlreadyHave = isFromBg || isFromClass || isFromRace || isFromFeat || isOtherDescGranted
                  const isDisabled    = isAlreadyHave || (!isSel && full)
                  const baseMod       = skillMod(key)
                  const profMod       = skillProfMod(key)
                  const ab            = SKILL_ABILITY[key]
                  const sourceLabel   = isFromBg ? 'Background' : isFromClass ? 'Class' : isFromRace ? 'Race' : isFromFeat ? 'Feat' : isOtherDescGranted ? 'Granted' : null

                  return (
                    <button key={key} disabled={isDisabled}
                      onClick={() => {
                        if (isDisabled) return
                        let next
                        if (d.count === 1) { next = isSel ? null : key }
                        else {
                          const arr = sel.filter(v => v !== key)
                          next = isSel ? (arr.length ? arr : null) : [...sel, key]
                        }
                        setChoice(d.id, next)
                      }}
                      style={{
                        ...S.skillBtn,
                        ...(isSel ? S.skillBtnSelected : {}),
                        ...(isAlreadyHave ? S.skillBtnBg : {}),
                        ...(isDisabled && !isAlreadyHave ? { opacity: 0.35 } : {}),
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                      }}>
                      <div style={{ lineHeight: 1.3 }}>
                        <div style={S.skillName}>{SKILL_LABELS[key] || key}</div>
                        <div style={{ color: isAlreadyHave ? 'var(--border)' : 'var(--text-muted)', fontSize: 10 }}>{ABILITY_ABBR[ab]}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {sourceLabel
                          ? <span style={S.sourceTag}>{sourceLabel}</span>
                          : <>
                              <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{modStr(baseMod)}</span>
                              <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>→</span>
                              <span style={{ ...S.modBadge,
                                background: isSel ? 'var(--bg-highlight)' : 'var(--bg-card)',
                                color: isSel ? 'var(--accent-green)' : 'var(--text-muted)',
                                border: `1px solid ${isSel ? 'var(--accent-green)' : 'var(--border)'}`,
                              }}>{modStr(profMod)}</span>
                            </>
                        }
                        {isSel && !isAlreadyHave && <span style={{ color: 'var(--accent)', fontSize: 14 }}>✓</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        }

        // FIX 4: Pass disabledValues for language and tool pickers
        // Exclude the current descriptor's own chosen values so the user can still deselect them
        function renderNonSkillDescriptor(d, val) {
          const selfChosen = new Set(Array.isArray(val) ? val : (val ? [val] : []))
          const allDV = d.type === 'language' ? grantedLanguages
                      : d.type === 'tool'     ? grantedTools
                      : []
          // Only disable values NOT selected by this descriptor (i.e. granted elsewhere)
          const dv = allDV.filter(v => !selfChosen.has(v))
          return (
            <div key={d.id} style={{ marginBottom: 14 }}>
              <ChoicePicker descriptor={d} value={val}
                onChange={v => setChoice(d.id, v)}
                disabledValues={dv} />
            </div>
          )
        }

        return groups.map(group => (
          <div key={group.key} style={S.section}>
            <div style={S.sectionTitle}>{group.label}</div>
            {group.descs.map(d => {
              const val = (character.choices || {})[d.id] ?? null
              if (d.type === 'skill') return renderSkillDescriptor(d, val)
              return renderNonSkillDescriptor(d, val)
            })}
          </div>
        ))
      })()}

      {/* ── 4. Expertise (class + feat — always last) ─────────────────────── */}
      {/* FIX 6: All expertise rendered as the final section                    */}
      {(() => {
        // Class expertise
        const classExpertise = expertiseInfo ? [{
          type: 'class',
          info: expertiseInfo,
          selected: selectedExpertise,
          remaining: remainingExpertise,
          options: expertiseOptions,
          toggle: toggleExpertise,
          label: `${cls.classId} Expertise — Choose ${expertiseInfo.count}`,
        }] : []

        // Feat expertise
        const featExpertiseDescs = getAllChoiceDescriptors({
          race: selectedRace, subrace: selectedSubrace,
          feats: resolvedFeats, choices: character.choices || {},
        }).filter(d => d.type === 'expertise' && d.source === 'feat')

        if (classExpertise.length === 0 && featExpertiseDescs.length === 0) return null

        // Dynamically collect ALL proficient skills from every source:
        // background, class, racial choices, AND descriptor-chosen (feat/race/subrace)
        const choiceSkills = Object.entries(character.choices || {})
          .filter(([k]) => k.split(':').slice(-2, -1)[0] === 'skill')
          .flatMap(([, v]) => Array.isArray(v) ? v : (v ? [v] : []))
        const allProfSkills = [...new Set([
          ...bgSkills, ...selectedSkills, ...racialChosenSkills, ...choiceSkills,
        ])]

        return (
          <div style={S.section}>
            <div style={S.sectionTitle}>
              ◎ Expertise
            </div>

            {/* Class expertise */}
            {classExpertise.map(ce => (
              <div key="class-expertise" style={{ marginBottom: featExpertiseDescs.length > 0 ? 20 : 0 }}>
                <div style={{ ...S.sectionTitle, borderBottom: 'none', fontSize: 12, marginBottom: 6 }}>
                  {ce.label}
                  <span style={{
                    color: ce.remaining === 0 ? 'var(--accent-green)' : 'var(--accent)',
                    marginLeft: 10, fontSize: 12, textTransform: 'none', fontWeight: 'normal',
                  }}>
                    {ce.remaining === 0 ? '✓ Done' : `${ce.selected.length} / ${ce.info.count}`}
                  </span>
                </div>
                <p style={S.sectionDesc}>
                  Double your proficiency bonus for these checks.
                  {ce.info.includesThievesTools && " You may include Thieves' Tools."}
                </p>
                {ce.options.length === 0 ? (
                  <p style={{ color: 'var(--accent)', fontSize: 13 }}>Select skill proficiencies above first.</p>
                ) : (
                  <div style={S.skillGrid}>
                    {ce.options.map(key => {
                      const isSel = ce.selected.includes(key)
                      const isDisabled = !isSel && ce.selected.length >= ce.info.count
                      const isSkill = ALL_SKILLS.includes(key)
                      const ab = isSkill ? SKILL_ABILITY[key] : 'dex'
                      const mod = isSkill ? skillExpMod(key) : abilityMod('dex') + PB * 2
                      return (
                        <button key={key} disabled={isDisabled}
                          onClick={() => !isDisabled && ce.toggle(key)}
                          style={{
                            ...S.skillBtn, ...(isSel ? S.skillBtnExpertise : {}),
                            ...(isDisabled ? { opacity: 0.35 } : {}),
                            cursor: isDisabled ? 'not-allowed' : 'pointer',
                          }}>
                          <div style={{ lineHeight: 1.3 }}>
                            <div style={S.skillName}>{isSkill ? (SKILL_LABELS[key] || key) : key}</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{ABILITY_ABBR[ab]} · Expertise</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ ...S.modBadge,
                              background: isSel ? 'var(--bg-highlight)' : 'var(--bg-card)',
                              color: isSel ? 'var(--accent-purple)' : 'var(--text-muted)',
                              border: `1px solid ${isSel ? 'var(--accent-purple)' : 'var(--border)'}`,
                            }}>{modStr(mod)}</span>
                            {isSel && <span style={{ color: 'var(--accent-purple)', fontSize: 14 }}>✓</span>}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}

            {/* Feat expertise */}
            {featExpertiseDescs.map(d => {
              const val = (character.choices || {})[d.id]
              const selected = Array.isArray(val) ? val : (val ? [val] : [])
              const isFull = selected.length >= d.count
              const featName = resolvedFeats.find(f =>
                (f.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') === d.sourceId
              )?.name || d.sourceId
              return (
                <div key={d.id} style={{ marginTop: 16 }}>
                  <div style={{ ...S.sectionTitle, borderBottom: 'none', fontSize: 12, marginBottom: 6 }}>
                    ⭐ {featName}: {d.label}
                    <span style={{
                      color: isFull ? 'var(--accent-green)' : 'var(--accent)',
                      marginLeft: 10, fontSize: 12, textTransform: 'none', fontWeight: 'normal',
                    }}>
                      {isFull ? '✓ Done' : `${selected.length} / ${d.count}`}
                    </span>
                  </div>
                  <p style={S.sectionDesc}>Choose from your proficient skills to gain expertise.</p>
                  {allProfSkills.length === 0 ? (
                    <p style={{ color: 'var(--accent)', fontSize: 13 }}>Select skill proficiencies first.</p>
                  ) : (
                    <div style={S.skillGrid}>
                      {allProfSkills.map(key => {
                        const isSel = selected.includes(key)
                        const isDisabled = !isSel && isFull
                        const ab = SKILL_ABILITY[key]
                        const mod = skillMod(key) + PB * 2
                        return (
                          <button key={key} disabled={isDisabled}
                            onClick={() => {
                              if (isDisabled) return
                              let next
                              if (d.count === 1) { next = isSel ? null : key }
                              else {
                                const arr = selected.filter(v => v !== key)
                                next = isSel ? (arr.length ? arr : null) : [...selected, key]
                              }
                              setChoice(d.id, next)
                            }}
                            style={{
                              ...S.skillBtn, ...(isSel ? S.skillBtnExpertise : {}),
                              ...(isDisabled ? { opacity: 0.35 } : {}),
                              cursor: isDisabled ? 'not-allowed' : 'pointer',
                            }}>
                            <div style={{ lineHeight: 1.3 }}>
                              <div style={S.skillName}>{SKILL_LABELS[key] || key}</div>
                              <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{ABILITY_ABBR[ab]} · Expertise</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ ...S.modBadge,
                                background: isSel ? 'var(--bg-highlight)' : 'var(--bg-card)',
                                color: isSel ? 'var(--accent-purple)' : 'var(--text-muted)',
                                border: `1px solid ${isSel ? 'var(--accent-purple)' : 'var(--border)'}`,
                              }}>{modStr(mod)}</span>
                              {isSel && <span style={{ color: 'var(--accent-purple)', fontSize: 14 }}>✓</span>}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })()}
    </div>
  )
}


// ── Granted Proficiencies Section ──────────────────────────────────────────────

function GrantedSection({ bgSkills, bgTools, classArmor, classWeapons, classSaves, classTools, className, skillProfMod, featProfs }) {
  const [collapsed, setCollapsed] = useState(false)

  const fp = featProfs || { armor: [], weapons: [], tools: [], skills: [], languages: [] }
  const hasFeatProfs = fp.armor.length > 0 || fp.weapons.length > 0 ||
    fp.tools.length > 0 || fp.skills.length > 0 || fp.languages.length > 0

  const hasAnything = bgSkills.length > 0 || bgTools.length > 0 ||
    classArmor.length > 0 || classWeapons.length > 0 || classSaves.length > 0 || classTools.length > 0 ||
    hasFeatProfs

  if (!hasAnything) return null

  return (
    <div style={S.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div
          onClick={() => setCollapsed(v => !v)}
          role="button"
          style={{ ...S.sectionTitle, cursor: 'pointer', marginBottom: 0 }}
        >
          Granted Proficiencies {collapsed ? '▶' : '▼'}
        </div>
      </div>

      {!collapsed && (
        <div style={{ marginTop: 12 }}>
          {bgSkills.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={S.grantedLabel}>Background Skills</div>
              <div style={S.skillGrid}>
                {bgSkills.map(key => (
                  <div key={key} style={S.grantedRow}>
                    <div style={{ lineHeight: 1.3 }}>
                      <div style={{ color: 'var(--text-secondary)', fontWeight: 'bold', fontSize: 13 }}>
                        {SKILL_LABELS[key] || key}
                      </div>
                      <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>
                        {ABILITY_ABBR[SKILL_ABILITY[key]]}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ ...S.modBadge, color: 'var(--accent-green)', background: 'var(--bg-card)', border: '1px solid #1a5a2a' }}>
                        {modStr(skillProfMod(key))}
                      </span>
                      <span style={S.sourceTag}>Background</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {bgTools.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={S.grantedLabel}>Background Tools</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {bgTools.map((tool, i) => (
                  <span key={i} style={S.profChip}>
                    {tool}
                    <span style={{ ...S.sourceTag, marginLeft: 6 }}>Background</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {(classSaves.length > 0 || classArmor.length > 0 || classWeapons.length > 0 || classTools.length > 0) && (
            <div style={{ marginBottom: hasFeatProfs ? 14 : 0 }}>
              <div style={S.grantedLabel}>{className} Class</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {classSaves.map(s => (
                  <span key={s} style={S.profChip}>
                    {s.toUpperCase()} Save
                    <span style={{ ...S.sourceTag, marginLeft: 6 }}>Class</span>
                  </span>
                ))}
                {classArmor.map(a => (
                  <span key={a} style={S.profChip}>
                    {a}
                    <span style={{ ...S.sourceTag, marginLeft: 6 }}>Armor</span>
                  </span>
                ))}
                {classWeapons.map(w => (
                  <span key={w} style={S.profChip}>
                    {w}
                    <span style={{ ...S.sourceTag, marginLeft: 6 }}>Weapon</span>
                  </span>
                ))}
                {classTools.map(tool => (
                  <span key={tool} style={S.profChip}>
                    {tool}
                    <span style={{ ...S.sourceTag, marginLeft: 6 }}>Class</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Feat-granted proficiencies (Heavily Armored, etc.) ────────── */}
          {hasFeatProfs && (
            <div>
              <div style={S.grantedLabel}>Feats</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {fp.armor.map(a => (
                  <span key={a} style={S.profChip}>
                    {a} armor
                    <span style={{ ...S.sourceTag, marginLeft: 6 }}>Feat</span>
                  </span>
                ))}
                {fp.weapons.map(w => (
                  <span key={w} style={S.profChip}>
                    ⚔ {w}
                    <span style={{ ...S.sourceTag, marginLeft: 6 }}>Feat</span>
                  </span>
                ))}
                {fp.tools.map(t => (
                  <span key={t} style={S.profChip}>
                    {t}
                    <span style={{ ...S.sourceTag, marginLeft: 6 }}>Feat</span>
                  </span>
                ))}
                {fp.skills.map(sk => (
                  <span key={sk} style={S.profChip}>
                    {SKILL_LABELS[sk] || sk}
                    <span style={{ ...S.sourceTag, marginLeft: 6 }}>Feat</span>
                  </span>
                ))}
                {fp.languages.map(l => (
                  <span key={l} style={S.profChip}>
                    {l}
                    <span style={{ ...S.sourceTag, marginLeft: 6 }}>Feat</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ── Styles ─────────────────────────────────────────────────────────────────────

const S = {
  container:   { maxWidth: 800, margin: '0 auto', padding: 16 },
  title:       { color: 'var(--accent)', marginBottom: 4 },
  subtitle:    { color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 },
  section: {
    background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 12,
    padding: 16, marginBottom: 20,
  },
  sectionTitle: {
    color: 'var(--accent)', fontWeight: 'bold', fontSize: 13,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--border-subtle)',
  },
  sectionDesc:  { color: 'var(--text-muted)', fontSize: 13, marginBottom: 14, marginTop: 8 },
  grantedLabel: { color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  hint:         { color: 'var(--text-dim)', fontSize: 12, marginTop: 10 },

  skillGrid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(195px, 1fr))', gap: 8 },
  skillBtn: {
    background: 'var(--bg-elevated)', border: '2px solid var(--border)', borderRadius: 8,
    padding: '10px 14px', textAlign: 'left', display: 'flex',
    justifyContent: 'space-between', alignItems: 'center',
    transition: 'all 0.15s', width: '100%',
  },
  skillBtnSelected: { background: 'var(--bg-highlight)', border: '2px solid var(--accent)' },
  skillBtnBg:       { background: 'var(--bg-inset)', border: '2px solid #1a2a3a', opacity: 0.6 },
  skillBtnExpertise:{ background: 'var(--bg-hover)', border: '2px solid #a78bfa' },
  skillName:    { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13, marginBottom: 1 },

  modBadge: {
    fontSize: 12, fontWeight: 'bold', padding: '2px 7px', borderRadius: 4,
    minWidth: 34, textAlign: 'center', display: 'inline-block',
  },
  sourceTag: {
    fontSize: 10, background: 'var(--bg-hover)', color: 'var(--text-dim)',
    padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap',
  },
  progressTrack: { height: 5, background: 'var(--bg-highlight)', borderRadius: 3, marginBottom: 12, overflow: 'hidden' },
  progressFill:  { height: '100%', background: 'var(--accent)', borderRadius: 3, transition: 'width 0.3s' },

  grantedRow: {
    background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 8,
    padding: '9px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  profChip: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '5px 10px', fontSize: 12, color: 'var(--text-muted)',
    display: 'inline-flex', alignItems: 'center',
  },

  optFeatGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8,
  },
  optFeatCard: {
    background: 'var(--bg-elevated)', border: '2px solid var(--border)', borderRadius: 8,
    padding: '10px 12px', transition: 'all 0.15s',
  },
  optFeatCardSelected: { background: 'var(--bg-hover)', border: '2px solid #a78bfa' },
}