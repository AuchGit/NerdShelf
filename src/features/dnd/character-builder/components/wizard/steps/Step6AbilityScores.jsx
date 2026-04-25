import { useState, useEffect, useMemo } from 'react'
import { useLanguage } from '../../../lib/i18n'
import { loadFeatList, loadOptionalFeatureList, loadRaceList, loadBackgroundList } from '../../../lib/dataLoader'
import EntryRenderer from '../../ui/EntryRenderer'
import AdditionalSpellPicker from '../AdditionalSpellPicker'
import { parseFeatProficiencies } from '../../../lib/featParser'
import { parseFeatChoices, setChoiceValue, getAllChoiceDescriptors, asArray } from '../../../lib/choiceParser'
import ChoicePicker from '../../ui/ChoicePicker'

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha']
const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8]
const PB_COSTS  = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 }
const PB_BUDGET = 27

function getModifier(score) { return Math.floor((score - 10) / 2) }
function modStr(mod)        { return mod >= 0 ? `+${mod}` : `${mod}` }

export default function Step6AbilityScores({ character, updateCharacter }) {
  const { t }   = useLanguage()
  const method  = character.abilityScores.method
  const base    = character.abilityScores.base
  const is55e   = character.meta.edition === '5.5e'
  const hasRace = !!character.species.raceId

  // ── Klassen-Info für HP-Preview ───────────────────────────
  const cls       = character.classes[0]
  const hitDie    = cls?.hitDie || 8
  const conScore  = (base.con || 8) + ((character.species.abilityScoreImprovements || {}).con || 0) + ((character.background?.abilityScoreImprovements || {}).con || 0) + ((getChoiceBasedASI(character.choices)).con || 0)
  const conMod    = getModifier(conScore)
  const level1HP  = hitDie + conMod
  const avgPerLvl = Math.floor(hitDie / 2) + 1   // PHB-Durchschnitt = Hälfte aufgerundet
  const hpMethod  = character.hpPreference?.method || 'average'

  // ── State ─────────────────────────────────────────────────
  const [rolls,        setRolls]        = useState(character.abilityScores.rolls || [])
  const [assignments,  setAssignments]  = useState({})
  // Persist ASI method in character model so it survives navigation
  const [asiMethod,    setAsiMethod]    = useState(character.species?.asiMethod || 'fixed')
  const [feats,        setFeats]        = useState([])
  const [featsLoading, setFeatsLoading] = useState(false)
  // Derive originFeatId from character.feats — NOT local transient state
  const [originFeatId, setOriginFeatId] = useState(() => {
    const origin = character.feats.find(f => f._isOriginFeat)
    return origin?.featId || null
  })
  const [viewFeat,     setViewFeat]     = useState(null)
  const [featSearch,   setFeatSearch]   = useState('')
  const [freeASI,      setFreeASI]      = useState(() => {
    // Restore freeASI from stored abilityScoreImprovements when returning
    // to the page in free21/free111/originFeat mode
    const m = character.species?.asiMethod || 'fixed'
    if (m === 'free21' || m === 'free111' || m === 'originFeat') {
      return character.species?.abilityScoreImprovements || {}
    }
    return {}
  })

  const racialASI = character.species?.abilityScoreImprovements || {}

  // ── Serialised key so the effect below detects deep value changes ─────────
  // JSON.stringify is intentional: we need value-equality, not reference-equality,
  // because updateCharacter always produces a new object even when content is same.
  const originalRacialASIKey = JSON.stringify(character.species?.originalRacialASI || {})
  // Load race data for racial ability choice descriptors in fixed mode
  const [races, setRaces] = useState([])
  useEffect(() => {
    if (!hasRace) return
    loadRaceList(character.meta.edition).then(setRaces)
  }, [character.species.raceId, character.meta.edition])
  
  const selectedRace    = races.find(r => r.id === character.species.raceId) || null
  const selectedSubrace = selectedRace?.subraces?.find(s => s.id === character.species.subraceId) || null
 
  // ── Step6 is the SOLE owner of species.abilityScoreImprovements ──────────
  // Step3Race only writes species.originalRacialASI (the raw source data).
  // This effect watches for race/subrace selection changes AND for ability
  // choices made inside Step3 (which update originalRacialASI) and then
  // applies the bonuses to abilityScoreImprovements — but only in 'fixed'
  // mode.  Free / custom / originFeat modes are controlled exclusively by
  // the user's selections in the ASI section further down this step.
  //
  // Dependency on asiMethod is deliberately omitted: method switches are
  // already handled synchronously in switchAsiMethod() and setMethod().
  // Including it would cause a redundant double-write on every method change.
  useEffect(() => {
    if (!hasRace) {
      updateCharacter('species.abilityScoreImprovements', {})
      return
    }
    if (asiMethod === 'fixed') {
      // FIX: include both fixed racial ASI and chosen ability bonuses
      updateCharacter('species.abilityScoreImprovements', resolveFullFixedASI())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.species.raceId, character.species.subraceId, originalRacialASIKey])

  // Feats laden wenn Origin Feat gewählt oder wenn Race im fixed-Mode einen Feat gewährt
   const raceGrantsFeat = useMemo(() => {
    for (const src of [selectedSubrace, selectedRace]) {
      if (!src?.feats) continue
      for (const entry of src.feats) {
        if (entry?.any !== undefined || entry?.choose !== undefined) return true
      }
    }
    return false
  }, [selectedRace, selectedSubrace])
  useEffect(() => {
    const needFeats = asiMethod === 'originFeat' ||
      (asiMethod === 'fixed' && hasRace && raceGrantsFeat) ||
      // Also load when returning to the page with an existing origin feat
      character.feats.some(f => f._isOriginFeat)
    if (needFeats) {
      setFeatsLoading(true)
      loadFeatList(character.meta.edition).then(data => {
        setFeats(data)
        setFeatsLoading(false)
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asiMethod, character.meta.edition, raceGrantsFeat, hasRace])

  // ── Sync originFeatId + viewFeat from character.feats when feat data loads ──
  // originFeatId must be feat.id (from loaded data) but character.feats stores
  // feat.name as featId. This effect bridges the two after feat data is available.
  useEffect(() => {
    const origin = character.feats.find(f => f._isOriginFeat)
    if (origin && feats.length > 0) {
      const match = feats.find(f => f.name === origin.featId)
      if (match) {
        setOriginFeatId(match.id)
        if (!viewFeat) setViewFeat(match)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feats, character.feats])




  // Racial ability choice descriptors (e.g. Half-Elf +1 to 2 abilities)
  const racialAbilityDescs = useMemo(() => {
    if (!selectedRace) return []
    return getAllChoiceDescriptors({
      race: selectedRace,
      subrace: selectedSubrace,
      choices: character.choices || {},
    }).filter(d => d.type === 'ability')
  }, [selectedRace, selectedSubrace, character.choices])

  // ── 5.5e Background ASI ────────────────────────────────────────────────────
  // In 5.5e, backgrounds grant choosable ASI (+2/+1 or +1/+1/+1).
  // Load background data for 5.5e ASI picker.
  const [backgrounds, setBackgrounds] = useState([])
  useEffect(() => {
    if (!is55e || !character.background.backgroundId) return
    loadBackgroundList(character.meta.edition).then(setBackgrounds)
  }, [is55e, character.background.backgroundId, character.meta.edition])

  const selectedBackground = backgrounds.find(bg => bg.id === character.background.backgroundId) || null

  // ── Parse 5.5e weighted ASI from background ───────────────────────────
  // Format: [{choose: {weighted: {from: [...], weights: [2,1]}}},
  //          {choose: {weighted: {from: [...], weights: [1,1,1]}}}]
  // → Two alternative modes the user picks between.
  const bgWeightedModes = useMemo(() => {
    if (!is55e || !selectedBackground?.ability?.length) return []
    return selectedBackground.ability
      .filter(e => e?.choose?.weighted)
      .map(e => {
        const w = e.choose.weighted
        return { from: w.from || ABILITIES, weights: w.weights || [1] }
      })
  }, [is55e, selectedBackground])

  // Track which weighted mode is selected (index into bgWeightedModes)
  // Restore from character.background.asiWeightedMode on revisit
  const [bgAsiMode, setBgAsiMode] = useState(character.background?.asiWeightedMode ?? 0)

  // Track per-weight-slot assignments: { 0: "str", 1: "wis" } for mode [2,1]
  // Restore from character.background.asiWeightedPicks on revisit
  const [bgAsiPicks, setBgAsiPicks] = useState(character.background?.asiWeightedPicks || {})

  function applyBgWeightedASI(modeIdx, picks) {
    setBgAsiMode(modeIdx)
    setBgAsiPicks(picks)
    updateCharacter('background.asiWeightedMode', modeIdx)
    updateCharacter('background.asiWeightedPicks', picks)
    const mode = bgWeightedModes[modeIdx]
    if (!mode) { updateCharacter('background.abilityScoreImprovements', {}); return }
    const result = {}
    for (const [slotStr, ab] of Object.entries(picks)) {
      const slot = parseInt(slotStr)
      if (ab && ABILITIES.includes(ab) && mode.weights[slot] !== undefined) {
        result[ab] = (result[ab] || 0) + mode.weights[slot]
      }
    }
    updateCharacter('background.abilityScoreImprovements', result)
  }

  // Detect dynamically whether the selected race/subrace grants a feat choice.
  // No hardcoded race names — reads the .feats field from raw race/subrace data.
  // Covers both "any feat" (Variant Human: { any: 1 }) and "from list" patterns.


  // Point Buy
  const pointsSpent = Object.values(base).reduce((sum, s) => sum + (PB_COSTS[s] || 0), 0)
  const pointsLeft  = PB_BUDGET - pointsSpent

  // Pool
  // assignments maps abilityKey → pool INDEX (not value), so that duplicate
  // rolled values (e.g. three 12s) can each be independently assigned to
  // different abilities without one assignment removing the others.
  const pool         = method === 'standard_array' ? STANDARD_ARRAY : rolls
  const usedIndices  = new Set(Object.values(assignments).filter(i => i !== undefined))
  const freePool     = pool.map((v, i) => ({ v, i })).filter(({ i }) => !usedIndices.has(i))
  const isPoolMethod = method === 'standard_array' || method === 'roll3d6' || method === 'roll4d6'

  // ── Ursprüngliche feste Rassen-ASI holen ─────────────────
  // species.originalRacialASI wird in Step3Race gesetzt wenn die Rasse gewählt wird
  // und nie durch freie ASI-Choices überschrieben
  function resolveFixedRacialASI() {
    return character.species?.originalRacialASI || {}
  }

  // FIX: Only return the fixed (non-chooseable) racial ASI.
  // Choice-based ability bonuses (e.g. Variant Human +1/+1) live exclusively
  // in character.choices and are resolved by the rulesEngine / computeAbilityScores.
  // Merging them here would double-count because the rulesEngine also reads choices.
  function resolveFullFixedASI() {
    return resolveFixedRacialASI()
  }

  // Helper: read choice-based racial ability bonuses from character.choices.
  // Used ONLY for Step6's inline preview display — not persisted anywhere.
  function getChoiceBasedASI(choices) {
    const result = {}
    for (const [key, val] of Object.entries(choices || {})) {
      if (!key.startsWith('race:') && !key.startsWith('subrace:')) continue
      if (!key.includes(':ability:')) continue
      for (const ab of (Array.isArray(val) ? val : (val ? [val] : []))) {
        if (ABILITIES.includes(ab)) {
          result[ab] = (result[ab] || 0) + 1
        }
      }
    }
    return result
  }

  // ── Methoden-Wechsel ──────────────────────────────────────
  function setMethod(m) {
    updateCharacter('abilityScores.method', m)
    updateCharacter('abilityScores.base', { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 })
    setAssignments({})
    setRolls([])
    // NOTE: asiMethod, freeASI, and originFeat are NOT reset here.
    // How species ASI bonuses are applied is an independent choice from
    // which score-generation method the player uses. Resetting it would
    // discard the player's selection whenever they switch between e.g.
    // Standard Array and Point Buy.
    if (hasRace) {
      if (asiMethod === 'fixed') {
        updateCharacter('species.abilityScoreImprovements', resolveFullFixedASI())
      }
      // For free21 / free111 / originFeat the current species ASI stays intact
    }
  }

  // ── Würfeln ───────────────────────────────────────────────
  function doRoll(type) {
    const results = []
    for (let i = 0; i < 6; i++) {
      if (type === '3d6') {
        results.push(
          Math.ceil(Math.random() * 6) +
          Math.ceil(Math.random() * 6) +
          Math.ceil(Math.random() * 6)
        )
      } else {
        const dice = [1,2,3,4].map(() => Math.ceil(Math.random() * 6))
        dice.sort((a, b) => b - a)
        results.push(dice[0] + dice[1] + dice[2])
      }
    }
    results.sort((a, b) => b - a)
    setRolls(results)
    updateCharacter('abilityScores.rolls', results)
    setAssignments({})
    updateCharacter('abilityScores.base', { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 })
  }

  // ── Pool-Zuweisung (Standard Array / Rolled) ─────────────
  // assignments: { abilityKey: poolIndex }
  // Using index rather than value ensures duplicate values (e.g. three 12s)
  // remain independent — assigning one 12 does not remove the other two.
  function assignValue(abilityKey, poolIndex) {
    if (poolIndex === undefined || poolIndex === null || poolIndex === '') {
      // Clear this ability's assignment
      const newA = { ...assignments }
      delete newA[abilityKey]
      setAssignments(newA)
      updateCharacter('abilityScores.base', { ...base, [abilityKey]: 8 })
      return
    }
    const idx  = parseInt(poolIndex)
    const newA = { ...assignments }
    // If another ability already holds this pool slot, free it first
    for (const k of Object.keys(newA)) {
      if (newA[k] === idx) delete newA[k]
    }
    newA[abilityKey] = idx
    setAssignments(newA)
    updateCharacter('abilityScores.base', { ...base, [abilityKey]: pool[idx] })
  }

  // ── Point Buy ─────────────────────────────────────────────
  function pbChange(key, delta) {
    const cur  = base[key] || 8
    const next = cur + delta
    if (next < 8 || next > 15) return
    const diff = (PB_COSTS[next] || 0) - (PB_COSTS[cur] || 0)
    if (delta > 0 && pointsLeft < diff) return
    updateCharacter('abilityScores.base', { ...base, [key]: next })
  }

  // ── Manuell ───────────────────────────────────────────────
  function setManual(key, val) {
    const n = parseInt(val)
    if (isNaN(n)) return
    updateCharacter('abilityScores.base', { ...base, [key]: Math.max(1, Math.min(30, n)) })
  }

  // ── Freie ASI speichern ───────────────────────────────────
  function setFreeASIValue(newFree) {
    setFreeASI(newFree)
    updateCharacter('species.abilityScoreImprovements', newFree)
  }

  // ── ASI-Methode wechseln ──────────────────────────────────
  function switchAsiMethod(newMethod) {
    setAsiMethod(newMethod)
    updateCharacter('species.asiMethod', newMethod)  // persist for page revisits
    setFreeASI({})
    setOriginFeatId(null)
    setViewFeat(null)
    // Origin Feats entfernen wenn ASI-Methode wechselt (verhindert angehäufte Boni)
    updateCharacter('feats', character.feats.filter(f => !f._isOriginFeat))

    // Bug 4 fix: also purge character.choices for any existing origin feat
    const oldOriginFeat = character.feats.find(f => f._isOriginFeat)
    if (oldOriginFeat) {
      const oldPrefix = featChoicePrefix(oldOriginFeat.featId)
      const cleaned = Object.fromEntries(
        Object.entries(character.choices || {}).filter(([k]) => !k.startsWith(oldPrefix))
      )
      updateCharacter('choices', cleaned)
    }

    if (newMethod === 'fixed') {
      // Ursprüngliche feste Rassen-ASI wiederherstellen + ability choices
      updateCharacter('species.abilityScoreImprovements', resolveFullFixedASI())
    } else {
      // Freie ASI — leere Map, User muss neu wählen
      updateCharacter('species.abilityScoreImprovements', {})
    }
  }

  // ── Origin Feat auswählen ─────────────────────────────────

  // Normalise a feat name to its choices-key prefix, matching choiceParser.makeId().
  // e.g. "Magic Initiate" → "feat:magic_initiate:"
  function featChoicePrefix(featName) {
    const id = (featName || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    return `feat:${id}:`
  }

  function selectOriginFeat(feat) {
    // FIX 1: Toggle off if clicking the already-selected feat
    const currentOrigin = character.feats.find(f => f._isOriginFeat)
    if (currentOrigin && currentOrigin.featId === feat.name) {
      setOriginFeatId(null)
      updateCharacter('feats', character.feats.filter(f => !f._isOriginFeat))
      const prefix = featChoicePrefix(feat.name)
      updateCharacter('choices', Object.fromEntries(
        Object.entries(character.choices || {}).filter(([k]) => !k.startsWith(prefix))
      ))
      return
    }

    setOriginFeatId(feat.id)
    setViewFeat(feat)

    // ── Bug 4 fix: clear all character.choices entries from the OLD origin feat
    // and from the NEW feat (in case the user had previously picked it and then
    // switched away — stale entries would re-appear as pre-selected options).
    const oldOriginFeat = character.feats.find(f => f._isOriginFeat)
    let cleanedChoices = { ...(character.choices || {}) }
    if (oldOriginFeat && oldOriginFeat.featId !== feat.name) {
      const oldPrefix = featChoicePrefix(oldOriginFeat.featId)
      cleanedChoices = Object.fromEntries(
        Object.entries(cleanedChoices).filter(([k]) => !k.startsWith(oldPrefix))
      )
    }
    // Also wipe choices for the incoming feat so it starts fresh
    const newPrefix = featChoicePrefix(feat.name)
    cleanedChoices = Object.fromEntries(
      Object.entries(cleanedChoices).filter(([k]) => !k.startsWith(newPrefix))
    )
    updateCharacter('choices', cleanedChoices)

    const fixedBonus = {}
    const abilityChoices = []
    for (const entry of (feat.ability || [])) {
      if (entry.choose) {
        abilityChoices.push({ from: entry.choose.from || [], amount: entry.choose.amount || 1 })
      } else {
        for (const [k, v] of Object.entries(entry)) {
          if (typeof v === 'number') fixedBonus[k] = (fixedBonus[k] || 0) + v
        }
      }
    }

    // Parse proficiency grants (fixed go directly onto the feat entry;
    // choices are stored in profChoices for the UI step to populate)
    const profData = parseFeatProficiencies(feat)

    const featEntry = {
      featId: feat.name,
      source: feat.source,
      chosenAt: 'origin',
      _isOriginFeat: true,
      abilityBonus: fixedBonus,
      _fixedAbilityBonus: { ...fixedBonus },
      abilityChoices,
      additionalSpells: feat.additionalSpells || [],
      choices: {},
      skillProficiencies:  profData.skills.fixed,
      toolProficiencies:   profData.tools.fixed,
      weaponProficiencies: profData.weapons.fixed,
      armorProficiencies:  profData.armor.fixed,
      // Structured choice descriptors (UI in Step7Proficiencies populates them):
      profChoices: {
        skills:  profData.skills.choice,
        tools:   profData.tools.choice,
        weapons: profData.weapons.choice,
      },
    }

    updateCharacter('feats', [
      // Purge both _isOriginFeat and any legacy _isRaceFeat entries so
      // selecting a feat here can never duplicate a race-step selection.
      ...character.feats.filter(f => f._isOriginFeat !== true && f._isRaceFeat !== true),
      featEntry,
    ])
  }

  const filteredFeats = useMemo(() => {
    if (!featSearch.trim()) return feats
    const q = featSearch.toLowerCase()
    return feats.filter(f => f.name.toLowerCase().includes(q))
  }, [feats, featSearch])

  const asiOptions = [
    { id: 'fixed',      label: t('asiFixed') },
    { id: 'free21',     label: t('asiFreePlus2Plus1') },
    { id: 'free111',    label: t('asiFreePlus1Plus1Plus1') },
    { id: 'originFeat', label: is55e ? t('asiOriginFeat') : `${t('asiOriginFeat')} (Optional)` },
  ]

  const methodOptions = [
    { id: 'standard_array', label: t('standardArray'), desc: t('standardArrayDesc') },
    { id: 'point_buy',      label: t('pointBuy'),       desc: t('pointBuyDesc') },
    { id: 'roll3d6',        label: t('roll3d6'),         desc: t('roll3d6Desc') },
    { id: 'roll4d6',        label: t('roll4d6'),         desc: t('roll4d6Desc') },
    { id: 'manual',         label: t('manual'),          desc: t('manualDesc') },
  ]

  return (
    <div style={styles.container}>
      <h2 style={{ color: 'var(--accent)', marginBottom: 16 }}>{t('abilityScores')}</h2>

      {/* ── HP-Methode (oben, für Level-Up Präferenz) ── */}
      <div style={styles.hpSection}>
        <h3 style={styles.hpTitle}>{t('hpMethod')}</h3>
        <p style={styles.hpNote}>{t('hpMethodNote')}</p>
        <div style={styles.hpMethodRow}>
          {[
            {
              id: 'average',
              label: t('hpAverage'),
              desc: `${avgPerLvl} + CON Mod pro Level`,
            },
            {
              id: 'roll',
              label: t('hpRoll'),
              desc: `d${hitDie} + CON Mod, bei jedem Level-Up`,
            },
          ].map(opt => (
            <div key={opt.id}
              style={{ ...styles.hpCard, ...(hpMethod === opt.id ? styles.hpCardSelected : {}) }}
              onClick={() => updateCharacter('hpPreference.method', opt.id)}
            >
              <div style={styles.hpCardLabel}>{opt.label}</div>
              <div style={styles.hpCardDesc}>{opt.desc}</div>
              {hpMethod === opt.id && <div style={styles.hpCardCheck}>✓</div>}
            </div>
          ))}
        </div>
        <div style={styles.hpPreview}>
          {t('hpLevel1Preview')}:
          <strong style={{ color: 'var(--accent)', marginLeft: 8 }}>
            {hitDie} ({hitDie > 0 ? 'd' + hitDie : '?'}) + {conMod >= 0 ? '+' : ''}{conMod} CON
            {' '}= <span style={{ fontSize: 17 }}>{level1HP}</span>
          </strong>
        </div>
      </div>

      {/* ── Methode wählen ── */}
      <div style={styles.methodGrid}>
        {methodOptions.map(m => (
          <div key={m.id}
            style={{ ...styles.methodCard, ...(method === m.id ? styles.methodSelected : {}) }}
            onClick={() => setMethod(m.id)}
          >
            <div style={styles.methodLabel}>{m.label}</div>
            <div style={styles.methodDesc}>{m.desc}</div>
          </div>
        ))}
      </div>

      {/* ── Würfeln ── */}
      {(method === 'roll3d6' || method === 'roll4d6') && (
        <div style={styles.rollRow}>
          <button style={styles.rollBtn} onClick={() => doRoll(method === 'roll3d6' ? '3d6' : '4d6')}>
            {t('rollBtn')}
          </button>
          {rolls.length > 0 && (
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {t('rollResults')}: {rolls.join(', ')} (Ø {Math.round(rolls.reduce((a, b) => a + b, 0) / 6)})
            </span>
          )}
        </div>
      )}

      {/* ── Point Buy Budget ── */}
      {method === 'point_buy' && (
        <div style={styles.budget}>
          {t('pointsLeft')}:{' '}
          <strong style={{ color: pointsLeft < 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
            {pointsLeft} / {PB_BUDGET}
          </strong>
        </div>
      )}

      {/* ── Verfügbare Pool-Werte ── */}
      {isPoolMethod && pool.length > 0 && (
        <div style={styles.poolRow}>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('availableValues')}:</span>
          {freePool.map(({ v, i }) => (
            <span key={i} style={styles.poolVal}>{v}</span>
          ))}
          {freePool.length === 0 && (
            <span style={{ color: 'var(--accent-green)', fontSize: 13 }}>{t('allAssigned')}</span>
          )}
        </div>
      )}

      {/* ── Ability Score Grid ── */}
      <div style={styles.abilGrid}>
        {ABILITIES.map(key => {
          const score       = base[key] || 8
          const fixedRacial = (character.species.abilityScoreImprovements || {})[key] || 0
          const choiceRacial= (getChoiceBasedASI(character.choices))[key] || 0
          const racial      = fixedRacial + choiceRacial
          const bgASI       = (character.background?.abilityScoreImprovements || {})[key] || 0
          const featASI     = character.feats.reduce((sum, f) => sum + ((f.abilityBonus || {})[key] || 0), 0)
          const final       = score + racial + bgASI + featASI
          const mod         = getModifier(final)
          const assignedIdx = assignments[key]  // pool index or undefined

          return (
            <div key={key} style={styles.abilCard}>
              <div style={styles.abilAbbr}>{key.toUpperCase()}</div>
              <div style={styles.abilName}>{t(key)}</div>

              {/* Pool-Dropdown — keyed by index so duplicate values are independent */}
              {isPoolMethod && pool.length > 0 && (
                <select style={styles.select}
                  value={assignedIdx !== undefined ? assignedIdx : ''}
                  onChange={e => assignValue(key, e.target.value === '' ? null : e.target.value)}>
                  <option value="">—</option>
                  {assignedIdx !== undefined && (
                    <option value={assignedIdx}>{pool[assignedIdx]}</option>
                  )}
                  {freePool.map(({ v, i }) => <option key={i} value={i}>{v}</option>)}
                </select>
              )}

              {/* Point Buy */}
              {method === 'point_buy' && (
                <div style={styles.pbRow}>
                  <button style={styles.pbBtn} onClick={() => pbChange(key, -1)}>−</button>
                  <span style={styles.pbScore}>{score}</span>
                  <button style={styles.pbBtn} onClick={() => pbChange(key, +1)}>+</button>
                  <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>({PB_COSTS[score] || 0})</span>
                </div>
              )}

              {/* Manuell */}
              {method === 'manual' && (
                <input style={styles.manualInput} type="number" min="1" max="30"
                  value={score} onChange={e => setManual(key, e.target.value)} />
              )}

              {/* Score-Anzeige */}
              <div style={styles.scoreRow}>
                <div>
                  <div style={styles.scoreNum}>{final}</div>
                  {racial !== 0 && (
                    <div style={{ color: 'var(--accent-green)', fontSize: 10, textAlign: 'center' }}>
                      {score}{racial > 0 ? '+' : ''}{racial}
                    </div>
                  )}
                  {bgASI !== 0 && (
                    <div style={{ color: 'var(--accent-blue)', fontSize: 10, textAlign: 'center' }}>
                      bg{bgASI > 0 ? '+' : ''}{bgASI}
                    </div>
                  )}
                  {featASI !== 0 && (
                    <div style={{ color: 'var(--accent-purple)', fontSize: 10, textAlign: 'center' }}>
                      feat{featASI > 0 ? '+' : ''}{featASI}
                    </div>
                  )}
                </div>
                <div style={styles.modBox}>{modStr(mod)}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Spezies ASI-Methode (nur wenn Rasse gewählt) ── */}
      {hasRace && (
        <div style={styles.asiSection}>
          <h3 style={{ color: 'var(--accent)', marginBottom: 10, fontSize: 15 }}>
            {t('speciesASIMethod')}
          </h3>
          <div style={styles.asiMethodRow}>
            {asiOptions.map(o => (
              <div key={o.id}
                style={{ ...styles.asiOption, ...(asiMethod === o.id ? styles.asiOptionSelected : {}) }}
                onClick={() => switchAsiMethod(o.id)}
              >
                {o.label}
              </div>
            ))}
          </div>

          {asiMethod === 'free21'     && <ASIFree21   freeASI={freeASI} setFreeASI={setFreeASIValue} />}
          {asiMethod === 'free111'    && <ASIFree111  freeASI={freeASI} setFreeASI={setFreeASIValue} />}

          {/* FIX 3: ASI preview — show current bonuses for all modes */}
          {(() => {
            const fixedASI   = character.species?.abilityScoreImprovements || {}
            const choiceASI  = getChoiceBasedASI(character.choices)
            // Merge fixed + choice for display
            const merged = { ...fixedASI }
            for (const [ab, val] of Object.entries(choiceASI)) {
              merged[ab] = (merged[ab] || 0) + val
            }
            const entries = Object.entries(merged).filter(([, v]) => v !== 0)
            if (entries.length === 0) return null
            return (
              <div style={{
                marginTop: 10, padding: '8px 12px', background: 'var(--bg-inset)',
                borderRadius: 8, border: '1px solid var(--border-subtle)',
                display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
              }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Applied bonuses:</span>
                {entries.map(([ab, val]) => (
                  <span key={ab} style={{
                    color: 'var(--accent-green)', fontWeight: 'bold', fontSize: 13,
                    background: 'var(--bg-card)', padding: '2px 8px', borderRadius: 4,
                    border: '1px solid #1a5a2a',
                  }}>
                    {ab.toUpperCase()} {val > 0 ? '+' : ''}{val}
                  </span>
                ))}
              </div>
            )
          })()}

          {/* Racial ability choices in fixed mode (e.g. Half-Elf +1 to 2 abilities) */}
          {asiMethod === 'fixed' && racialAbilityDescs.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {racialAbilityDescs.map(d => (
                <div key={d.id} style={{ marginBottom: 10 }}>
                  <ChoicePicker
                    descriptor={d}
                    value={(character.choices || {})[d.id] ?? null}
                    onChange={val => {
                      const next = setChoiceValue(character.choices || {}, d.id, val)
                      updateCharacter('choices', next)
                      // Fixed racial ASI is unchanged by ability choices — choices
                      // live in character.choices and are resolved by rulesEngine.
                      updateCharacter('species.abilityScoreImprovements', resolveFullFixedASI())
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Origin Feat picker — shown in fixed mode when the race dynamically
              grants a feat (e.g. Variant Human). Stored as _isOriginFeat so it
              integrates with all downstream proficiency and spell systems. */}
          {asiMethod === 'fixed' && hasRace && raceGrantsFeat && (
            <div style={{ marginTop: 16 }}>
              <div style={{
                color: 'var(--accent)', fontWeight: 'bold', fontSize: 13, marginBottom: 4,
                paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)',
              }}>
                ⭐ Origin Feat (gewährt durch Rasse)
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 10 }}>
                Deine Rasse gewährt dir einen Feat als Teil der rassischen Boni.
              </div>
              <OriginFeatPicker
                feats           = {filteredFeats}
                allFeats        = {feats}
                featSearch      = {featSearch}
                setFeatSearch   = {setFeatSearch}
                loading         = {featsLoading}
                selectedId      = {originFeatId}
                viewFeat        = {viewFeat}
                setViewFeat     = {setViewFeat}
                onSelect        = {selectOriginFeat}
                freeASI         = {freeASI}
                setFreeASI      = {setFreeASIValue}
                character       = {character}
                updateCharacter = {updateCharacter}
                showASI         = {false}
              />
            </div>
          )}

          {asiMethod === 'originFeat' && (
            <OriginFeatPicker
              feats={filteredFeats}
              allFeats={feats}
              featSearch={featSearch}
              setFeatSearch={setFeatSearch}
              loading={featsLoading}
              selectedId={originFeatId}
              viewFeat={viewFeat}
              setViewFeat={setViewFeat}
              onSelect={selectOriginFeat}
              freeASI={freeASI}
              setFreeASI={setFreeASIValue}
              character={character}
              updateCharacter={updateCharacter}
            />
          )}
        </div>
      )}

      {/* ── 5.5e Background ASI (weighted format) ────────────────────────── */}
      {is55e && character.background.backgroundId && bgWeightedModes.length > 0 && (
        <div style={styles.asiSection}>
          <h3 style={{ color: 'var(--accent-blue)', marginBottom: 10, fontSize: 15 }}>
            Background ASI
          </h3>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
            Dein Hintergrund gewährt dir Ability Score Improvements. Wähle eine Verteilung:
          </div>

          {/* Mode picker: +2/+1 vs +1/+1/+1 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {bgWeightedModes.map((mode, idx) => {
              const label = mode.weights.map(w => `+${w}`).join(' / ')
              const isSel = bgAsiMode === idx
              return (
                <div key={idx}
                  onClick={() => { applyBgWeightedASI(idx, {}) }}
                  style={{
                    ...styles.asiOption,
                    ...(isSel ? styles.asiOptionSelected : {}),
                  }}>
                  {label}
                </div>
              )
            })}
          </div>

          {/* Ability pickers for chosen mode */}
          {bgWeightedModes[bgAsiMode] && (() => {
            const mode = bgWeightedModes[bgAsiMode]
            const fromList = mode.from.length > 0 ? mode.from : ABILITIES
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {mode.weights.map((weight, slot) => {
                  const current = bgAsiPicks[slot] || ''
                  // Abilities already picked in other slots
                  const usedInOtherSlots = Object.entries(bgAsiPicks)
                    .filter(([s]) => parseInt(s) !== slot)
                    .map(([, v]) => v)
                    .filter(Boolean)
                  return (
                    <div key={slot} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        color: 'var(--accent-blue)', fontWeight: 'bold', fontSize: 14,
                        minWidth: 30, textAlign: 'right',
                      }}>+{weight}:</span>
                      <select
                        style={styles.asiSelect}
                        value={current}
                        onChange={e => {
                          const next = { ...bgAsiPicks, [slot]: e.target.value || undefined }
                          if (!e.target.value) delete next[slot]
                          applyBgWeightedASI(bgAsiMode, next)
                        }}>
                        <option value="">— wählen —</option>
                        {fromList.map(ab => {
                          const taken = usedInOtherSlots.includes(ab) && current !== ab
                          return (
                            <option key={ab} value={ab} disabled={taken}>
                              {ab.toUpperCase()}{taken ? ' (vergeben)' : ''}
                            </option>
                          )
                        })}
                      </select>
                      {current && (
                        <span style={{ color: 'var(--accent-green)', fontSize: 12, fontWeight: 'bold' }}>
                          ✓ {current.toUpperCase()} +{weight}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* Preview */}
          {(() => {
            const bgASI = character.background?.abilityScoreImprovements || {}
            const entries = Object.entries(bgASI).filter(([, v]) => v !== 0)
            if (entries.length === 0) return null
            return (
              <div style={{
                marginTop: 10, padding: '8px 12px', background: 'var(--bg-inset)',
                borderRadius: 8, border: '1px solid var(--border-subtle)',
                display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
              }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Background bonuses:</span>
                {entries.map(([ab, val]) => (
                  <span key={ab} style={{
                    color: 'var(--accent-blue)', fontWeight: 'bold', fontSize: 13,
                    background: 'var(--bg-inset)', padding: '2px 8px', borderRadius: 4,
                    border: '1px solid #1a3a6a',
                  }}>
                    {ab.toUpperCase()} {val > 0 ? '+' : ''}{val}
                  </span>
                ))}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// ── +2/+1 freie ASI ────────────────────────────────────────

function ASIFree21({ freeASI, setFreeASI }) {
  const plus2 = Object.entries(freeASI).find(([, v]) => v === 2)?.[0] || ''
  const plus1 = Object.entries(freeASI).find(([, v]) => v === 1)?.[0] || ''

  function set(key2, key1) {
    const newF = {}
    if (key2) newF[key2] = 2
    if (key1) newF[key1] = 1
    setFreeASI(newF)
  }

  return (
    <div style={styles.asiFreeRow}>
      <div style={styles.asiLabel}>+2:</div>
      <select style={styles.asiSelect} value={plus2}
        onChange={e => set(e.target.value, plus1 === e.target.value ? '' : plus1)}>
        <option value="">— wählen —</option>
        {ABILITIES.filter(a => a !== plus1).map(a => (
          <option key={a} value={a}>{a.toUpperCase()}</option>
        ))}
      </select>
      <div style={styles.asiLabel}>+1:</div>
      <select style={styles.asiSelect} value={plus1}
        onChange={e => set(plus2 === e.target.value ? '' : plus2, e.target.value)}>
        <option value="">— wählen —</option>
        {ABILITIES.filter(a => a !== plus2).map(a => (
          <option key={a} value={a}>{a.toUpperCase()}</option>
        ))}
      </select>
    </div>
  )
}

// ── +1/+1/+1 freie ASI ────────────────────────────────────

function ASIFree111({ freeASI, setFreeASI }) {
  const chosen = ABILITIES.filter(a => (freeASI[a] || 0) > 0)

  function toggle(a) {
    const newF = { ...freeASI }
    if (newF[a]) delete newF[a]
    else if (chosen.length < 3) newF[a] = 1
    setFreeASI(newF)
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>+1 auf 3 Attribute:</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {ABILITIES.map(a => {
          const isChosen = (freeASI[a] || 0) > 0
          const canAdd   = chosen.length < 3 || isChosen
          return (
            <button key={a} onClick={() => canAdd && toggle(a)} style={{
              padding: '7px 16px', borderRadius: 8, fontSize: 14, fontWeight: 'bold',
              border: `2px solid ${isChosen ? 'var(--accent)' : 'var(--border)'}`,
              background: isChosen ? 'var(--bg-highlight)' : 'var(--bg-elevated)',
              color: isChosen ? 'var(--accent)' : 'var(--text-muted)',
              cursor: canAdd ? 'pointer' : 'not-allowed', opacity: canAdd ? 1 : 0.4,
            }}>
              {a.toUpperCase()} {isChosen ? '+1' : ''}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Origin Feat Picker ────────────────────────────────────

function OriginFeatPicker({
  feats, allFeats, featSearch, setFeatSearch,
  loading, selectedId, viewFeat, setViewFeat, onSelect,
  freeASI, setFreeASI, character, updateCharacter,
  showASI = true,  // set false when called from fixed mode — race already grants its own ASI
}) {
  return (
    <div style={{ marginTop: 12 }}>
      {/* +1/+1 ASI wählen — only shown in originFeat mode, not when used in fixed mode */}
      {showASI && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>
            +1 auf 2 Attribute (frei wählen):
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ABILITIES.map(a => {
              const cur        = freeASI[a] || 0
              const chosenCount = Object.values(freeASI).filter(v => v > 0).length
              const canToggle  = chosenCount < 2 || cur > 0
              return (
                <button key={a}
                  onClick={() => {
                    if (!canToggle && cur === 0) return
                    const nf = { ...freeASI }
                    if (cur > 0) delete nf[a]; else nf[a] = 1
                    setFreeASI(nf)
                  }}
                  style={{
                    padding: '7px 16px', borderRadius: 8, fontSize: 14, fontWeight: 'bold',
                    border: `2px solid ${cur > 0 ? 'var(--accent)' : 'var(--border)'}`,
                    background: cur > 0 ? 'var(--bg-highlight)' : 'var(--bg-elevated)',
                    color: cur > 0 ? 'var(--accent)' : 'var(--text-muted)',
                    cursor: (canToggle || cur > 0) ? 'pointer' : 'not-allowed',
                    opacity: (!canToggle && cur === 0) ? 0.4 : 1,
                  }}>
                  {a.toUpperCase()} {cur > 0 ? '+1' : ''}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>Origin Feat auswählen:</div>

      {loading ? (
        <div style={{ color: 'var(--accent)', padding: '20px', textAlign: 'center' }}>Lade Feats...</div>
      ) : (
        <div style={featStyles.layout}>
          {/* Liste */}
          <div style={featStyles.left}>
            <input style={featStyles.search} placeholder="Suchen..."
              value={featSearch} onChange={e => setFeatSearch(e.target.value)} />
            <div style={featStyles.list}>
              {feats.length === 0 && (
                <div style={{ color: 'var(--text-dim)', padding: 16, textAlign: 'center', fontSize: 13 }}>
                  Keine Feats gefunden.
                </div>
              )}
              {feats.map(feat => {
                const isSelected = feat.id === selectedId
                const isViewing  = feat.id === viewFeat?.id
                return (
                  <div key={feat.id}
                    style={{
                      ...featStyles.listItem,
                      ...(isSelected ? featStyles.listItemSelected : {}),
                      ...(isViewing && !isSelected ? featStyles.listItemViewing : {}),
                    }}
                    onClick={() => setViewFeat(feat)}>
                    <div style={{ color: isSelected ? 'var(--accent)' : 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 }}>
                      {feat.name}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                      {feat.source}
                      {feat.ability?.length > 0 && ' · +ASI'}
                      {feat.prerequisite && ' · Prerequisite'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Detail */}
          <div style={featStyles.right}>
            {viewFeat ? (
              <>
                <div style={featStyles.detailScroll}>
                  <FeatDetail feat={viewFeat} />
                </div>
                <div style={featStyles.footer}>
                  <button
                    style={{
                      ...featStyles.selectBtn,
                      ...(selectedId === viewFeat.id ? featStyles.selectBtnActive : {}),
                    }}
                    onClick={() => onSelect(viewFeat)}>
                    {selectedId === viewFeat.id ? '✓ Gewählt' : 'Feat wählen'}
                  </button>
                </div>
              </>
            ) : (
              <div style={featStyles.empty}>← Klicke einen Feat für Details</div>
            )}
          </div>
        </div>
      )}

      {/* Ability-Choice + Feat-Choices + Spell-Choice für gewählten Origin Feat */}
      {viewFeat && (() => {
        const stored   = character.feats.find(f => f._isOriginFeat && f.featId === viewFeat.name)
        if (!stored) return null
        const featData = allFeats.find(f => f.name === viewFeat.name)
        return (
          <>
            <FeatAbilityChoicePicker
              featEntry={stored}
              character={character}
              updateCharacter={updateCharacter}
            />
            <FeatOptChoicePicker
              featData={featData}
              edition={character.meta.edition}
              character={character}
              updateCharacter={updateCharacter}
            />
            {featData?.additionalSpells?.length > 0 && (
              <AdditionalSpellPicker
                additionalSpells={featData.additionalSpells}
                selected={stored.choices?.spells || []}
                onChange={spells => {
                  const updatedFeats = character.feats.map(f =>
                    f._isOriginFeat && f.featId === stored.featId
                      ? { ...f, choices: { ...(f.choices || {}), spells } }
                      : f
                  )
                  updateCharacter('feats', updatedFeats)
                }}
                edition={character.meta.edition}
                label={`Zauber — ${viewFeat.name}`}
              />
            )}
          </>
        )
      })()}
    </div>
  )
}

// ── Feat-Detail ────────────────────────────────────────────

function FeatDetail({ feat }) {
  return (
    <div>
      <div style={{ color: 'var(--accent)', fontSize: 18, fontWeight: 'bold', marginBottom: 4 }}>
        {feat.name}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
        Source: {feat.source}
        {feat.category && ` · ${feat.category}`}
      </div>

      {feat.prerequisite && (
        <div style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', marginBottom: 10 }}>
          <span style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 'bold' }}>Prerequisite: </span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{formatPrerequisite(feat.prerequisite)}</span>
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

function formatPrerequisite(prereq) {
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

// ── Feat Ability Choice Picker ─────────────────────────────

function FeatAbilityChoicePicker({ featEntry, character, updateCharacter }) {
  if (!featEntry?.abilityChoices?.length) return null

  function handlePick(choiceIdx, ability) {
    const currentChoices = featEntry.choices?.abilityChoiceByIndex || {}
    const newChoiceMap   = { ...currentChoices, [choiceIdx]: ability }

    // Nur die neuen Choices zählen — nie akkumulieren
    // Starte mit den festen Boni die beim Feat-Select gespeichert wurden
    const fixedBase = featEntry._fixedAbilityBonus || {}
    const chosenBonus = {}
    for (const [, ab] of Object.entries(newChoiceMap)) {
      if (ab) chosenBonus[ab] = (chosenBonus[ab] || 0) + 1
    }

    const updatedFeat = {
      ...featEntry,
      choices: { ...featEntry.choices, abilityChoiceByIndex: newChoiceMap, abilityBonus: chosenBonus },
      // Nur fixedBase + aktuelle Choices = kein Akkumulieren
      abilityBonus: { ...fixedBase, ...chosenBonus },
    }

    updateCharacter('feats', [
      ...character.feats.filter(f => f._isOriginFeat !== true),
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
              {(choice.from?.length ? choice.from : ABILITIES).map(ab => (
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

// ── FeatOptChoicePicker ────────────────────────────────────
// Renders skill / tool / language / weapon / optfeature choices
// for the selected origin feat, directly in Step6 below the ASI picker.
// Reads + writes character.choices via setChoiceValue.

function FeatOptChoicePicker({ featData, edition, character, updateCharacter }) {
  const [optFeatures, setOptFeatures] = useState([])

  // Load optional features once per feat (for optfeature type descriptors)
  useEffect(() => {
    if (!featData?.optionalfeatureProgression?.length) return
    let cancelled = false
    loadOptionalFeatureList(edition || '5e').then(arr => {
      if (!cancelled) setOptFeatures(arr)
    })
    return () => { cancelled = true }
  }, [featData?.name, edition])

  if (!featData) return null

  // Only show non-proficiency feat choices here. Proficiency choices (skill,
  // tool, language, weapon) are rendered exclusively in Step7Proficiencies.
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
        // For optfeature descriptors inject the live option list
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

// ── Styles ─────────────────────────────────────────────────

const styles = {
  container: { maxWidth: 820, margin: '0 auto' },

  // HP Section
  hpSection: {
    background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 10,
    padding: 16, marginBottom: 20,
  },
  hpTitle:     { color: 'var(--accent)', fontSize: 14, fontWeight: 'bold', marginBottom: 6, margin: '0 0 6px' },
  hpNote:      { color: 'var(--text-muted)', fontSize: 12, marginBottom: 10, margin: '0 0 10px' },
  hpMethodRow: { display: 'flex', gap: 10, marginBottom: 10 },
  hpCard: {
    flex: 1, background: 'var(--bg-elevated)', border: '2px solid var(--border)', borderRadius: 8,
    padding: '10px 14px', cursor: 'pointer', textAlign: 'center', position: 'relative',
  },
  hpCardSelected: { border: '2px solid var(--accent)', background: 'var(--bg-hover)' },
  hpCardLabel:    { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13, marginBottom: 4 },
  hpCardDesc:     { color: 'var(--text-muted)', fontSize: 12 },
  hpCardCheck:    { color: 'var(--accent)', fontSize: 14, marginTop: 4 },
  hpPreview: {
    color: 'var(--text-secondary)', fontSize: 13, background: 'var(--bg-inset)',
    borderRadius: 6, padding: '6px 12px', display: 'inline-block',
  },

  // Ability Score Method
  methodGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 16,
  },
  methodCard: {
    background: 'var(--bg-elevated)', border: '2px solid var(--border)', borderRadius: 8,
    padding: '10px 8px', cursor: 'pointer', textAlign: 'center',
  },
  methodSelected: { border: '2px solid var(--accent)', background: 'var(--bg-hover)' },
  methodLabel:    { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 12, marginBottom: 2 },
  methodDesc:     { color: 'var(--text-muted)', fontSize: 11 },

  rollRow:  { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 },
  rollBtn: {
    padding: '8px 20px', borderRadius: 8, border: 'none',
    background: 'var(--accent)', color: 'var(--bg-deep)', fontWeight: 'bold', cursor: 'pointer',
  },
  budget:   { color: 'var(--text-secondary)', marginBottom: 12, fontSize: 14 },
  poolRow: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    marginBottom: 16, padding: '8px 12px', background: 'var(--bg-elevated)',
    borderRadius: 8, border: '1px solid var(--border)',
  },
  poolVal: {
    background: 'var(--bg-highlight)', color: 'var(--accent)', padding: '3px 10px',
    borderRadius: 6, fontWeight: 'bold', fontSize: 14,
  },

  abilGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24,
  },
  abilCard: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10,
    padding: 14, display: 'flex', flexDirection: 'column', gap: 6,
  },
  abilAbbr:    { color: 'var(--accent)', fontWeight: 'bold', fontSize: 16 },
  abilName:    { color: 'var(--text-muted)', fontSize: 12 },
  select: {
    padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-hover)', color: 'var(--text-primary)', fontSize: 13,
  },
  pbRow:       { display: 'flex', alignItems: 'center', gap: 6 },
  pbBtn: {
    width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-highlight)', color: 'var(--text-primary)', fontSize: 16, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  pbScore:     { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 16, minWidth: 24, textAlign: 'center' },
  manualInput: {
    padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-hover)', color: 'var(--text-primary)', fontSize: 15, width: 70,
  },
  scoreRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    paddingTop: 8, borderTop: '1px solid var(--border)',
  },
  scoreNum:    { color: 'var(--text-primary)', fontSize: 22, fontWeight: 'bold', textAlign: 'center' },
  modBox:      { color: 'var(--accent)', fontSize: 16, fontWeight: 'bold' },

  // ASI Section
  asiSection: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10,
    padding: 16, marginTop: 8,
  },
  asiMethodRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  asiOption: {
    padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg-surface)', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer',
  },
  asiOptionSelected: { border: '1px solid var(--accent)', color: 'var(--accent)', background: 'var(--bg-hover)' },
  asiFreeRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 },
  asiLabel:   { color: 'var(--text-muted)', fontSize: 13, whiteSpace: 'nowrap' },
  asiSelect: {
    padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-hover)', color: 'var(--text-primary)', fontSize: 13,
  },
}

const featStyles = {
  layout: {
    display: 'grid', gridTemplateColumns: '260px 1fr',
    border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', height: 380,
  },
  left: {
    borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
    background: 'var(--bg-card)', overflow: 'hidden',
  },
  search: {
    margin: 10, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13, flexShrink: 0,
  },
  list:             { flex: 1, overflowY: 'auto', padding: '0 6px 6px' },
  listItem: {
    padding: '8px 10px', borderRadius: 7, cursor: 'pointer',
    marginBottom: 2, border: '1px solid transparent',
  },
  listItemSelected: { background: 'var(--bg-highlight)', border: '1px solid var(--accent)' },
  listItemViewing:  { background: 'var(--bg-hover)', border: '1px solid var(--border)' },
  right: {
    display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)', overflow: 'hidden',
  },
  detailScroll:   { flex: 1, overflowY: 'auto', padding: '16px' },
  footer: {
    flexShrink: 0, padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)',
  },
  selectBtn: {
    width: '100%', padding: 10, borderRadius: 8,
    border: '2px solid var(--accent)', background: 'transparent',
    color: 'var(--accent)', fontSize: 14, fontWeight: 'bold', cursor: 'pointer',
  },
  selectBtnActive: { background: 'var(--accent)', color: 'var(--bg-deep)' },
  empty: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text-dim)', fontSize: 13,
  },
}