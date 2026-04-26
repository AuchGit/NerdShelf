import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useParams } from '../lib/hashNav'
import { supabase } from '../lib/supabase'
import { useAuth } from '../../../../core/auth/AuthContext'
import { createEmptyCharacter } from '../lib/characterModel'
import { useLanguage } from '../lib/i18n'
import { getSpellcastingInfo, isSpellcaster } from '../lib/spellcastingRules'
import HeaderButtons from '../components/ui/HeaderButtons'
import StepIndicator        from '../components/wizard/StepIndicator'
import Step1Edition         from '../components/wizard/steps/Step1Edition'
import Step2BasicInfo       from '../components/wizard/steps/Step2BasicInfo'
import Step3Race            from '../components/wizard/steps/Step3Race'
import Step4Class, { isStep4Complete } from '../components/wizard/steps/Step4Class'
import Step4bProficiencies  from '../components/wizard/steps/Step4bProficiencies'
import Step5Background      from '../components/wizard/steps/Step5Background'
import Step6AbilityScores   from '../components/wizard/steps/Step6AbilityScores'
import Step7Proficiencies   from '../components/wizard/steps/Step7Proficiencies'
import Step8Spells          from '../components/wizard/steps/Step7Spells'   // rename your file if needed
import Step9Equipment       from '../components/wizard/steps/Step9Equipment'

function modStr(mod) { return mod >= 0 ? `+${mod}` : `${mod}` }

// ── Step index constants ───────────────────────────────────────────────────────
const STEP = {
  EDITION:       0,
  BASIC_INFO:    1,
  RACE:          2,
  BACKGROUND:    3,
  CLASS:         4,
  CLASS_OPTS:    5,  // skipped automatically when nothing to choose
  ABILITIES:     6,
  PROFICIENCIES: 7,
  SPELLS:        8,
  EQUIPMENT:     9,
  REVIEW:        10,
}

// ── Fallback step labels (update your i18n 'steps' array to have 11 entries) ──
const FALLBACK_STEPS = [
  'Edition', 'Basic Info', 'Race', 'Background',
  'Class', 'Class Options', 'Abilities', 'Proficiencies', 'Spells',
  'Equipment', 'Review',
]

// ── Classes with non-skill class options at level 1 ───────────────────────────
function hasClassNonSkillOptions(cls, edition) {
  if (!cls) return false
  const id = cls.classId
  // Fighting Style classes
  if (['Fighter', 'Paladin', 'Ranger'].includes(id)) return true
  // Ranger 5e also gets Favored Enemy + Natural Explorer
  // (already covered above)
  return false
}

// ── Helper: extract skill-choice spec from class startingProficiencies ─────────
function extractSkillChoices(startingProfs) {
  const skills = startingProfs?.skills
  if (!skills || skills.length === 0) return null
  for (const entry of skills) {
    if (entry?.choose?.from && Array.isArray(entry.choose.from))
      return { count: entry.choose.count || 2, from: entry.choose.from }
    if (typeof entry?.any === 'number')
      return { count: entry.any, from: [] }
  }
  return null
}

// ── CLASS_OPTS completion (only non-skill options) ────────────────────────────
function isClassOptsComplete(character) {
  const cls     = character.classes[0]
  const edition = character.meta.edition || '5e'
  if (!cls) return false
  // If there's nothing special to choose, step is trivially complete (auto-skip)
  if (!hasClassNonSkillOptions(cls, edition)) return true

  const lc = cls.levelChoices?.[1] || {}
  const id = cls.classId

  // Fighting Style required
  if (['Fighter', 'Paladin', 'Ranger'].includes(id)) {
    if (!lc.fightingStyle) return false
    // Superior Technique needs a maneuver too
    if (lc.fightingStyle === 'Superior Technique' && !lc.superiorTechniqueManeuver) return false
  }

  // Ranger 5e needs Favored Enemy + Terrain
  if (id === 'Ranger' && edition === '5e') {
    if (!lc.favoredEnemy || !lc.favoredTerrain) return false
  }

  return true
}

// ── PROFICIENCIES step completion ─────────────────────────────────────────────
const EXPERTISE_L1 = { Rogue: 2 }   // mirror from Step7Proficiencies

function isProficienciesComplete(character) {
  const cls = character.classes[0]
  if (!cls) return true

  // Skill choices — read from character.choices (single source of truth)
  const choices = extractSkillChoices(cls.startingProficiencies)
  if (choices) {
    const classKey = `class:${cls.classId.toLowerCase()}:level1:skill:0`
    const val = character.choices?.[classKey]
    const selected = Array.isArray(val) ? val.length : (val ? 1 : 0)
    if (selected < choices.count) return false
  }

  // Expertise — read from character.choices
  const expCount = EXPERTISE_L1[cls.classId] || 0
  if (expCount > 0) {
    const expKey = `class:${cls.classId.toLowerCase()}:level1:expertise:0`
    const val = character.choices?.[expKey]
    const selected = Array.isArray(val) ? val.length : (val ? 1 : 0)
    if (selected < expCount) return false
  }

  return true
}

// ── Spells step completion (unchanged) ────────────────────────────────────────
function isSpellStepComplete(character) {
  const cls = character.classes[0]
  if (!cls) return true
  if (!isSpellcaster(cls.classId)) return true
  const info = getSpellcastingInfo(cls.classId, cls.level, 0)
  if (!info) return true
  const selectedCantrips  = cls.levelChoices?.[1]?.cantrips?.length        || 0
  const selectedSpells    = cls.levelChoices?.[1]?.startingSpells?.length  || 0
  const cantripsDone      = info.cantripsKnown === 0 || selectedCantrips >= info.cantripsKnown
  if (info.type === 'prepared' && !info.hasSpellbook) return cantripsDone
  if (info.hasSpellbook) return cantripsDone && selectedSpells >= (info.spellbookStart || 6)
  if (info.type === 'known') {
    return cantripsDone && ((info.spellsKnown || 0) === 0 || selectedSpells >= (info.spellsKnown || 0))
  }
  return cantripsDone
}


// ── Main page ──────────────────────────────────────────────────────────────────

export default function CharacterCreatePage({ session }) {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { playerName } = useAuth()
  const [currentStep, setCurrentStep] = useState(0)
  const [character,   setCharacter]   = useState(createEmptyCharacter())
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)

  // Prefill info.player from user's profile playerName once (only if still empty).
  // Stays editable — we never overwrite after the first set.
  const prefilledPlayerRef = useRef(false)
  useEffect(() => {
    if (prefilledPlayerRef.current) return
    if (!playerName) return
    if (character.info.player) { prefilledPlayerRef.current = true; return }
    prefilledPlayerRef.current = true
    setCharacter(prev => {
      if (prev.info.player) return prev
      const next = structuredClone(prev)
      next.info.player = playerName
      return next
    })
  }, [playerName, character.info.player])

  function updateCharacter(path, value) {
    setCharacter(prev => {
      const next  = structuredClone(prev)

      // ── Edition change guard ──────────────────────────────────────────────
      // If edition changes after meaningful data exists, reset the character
      // to prevent cross-edition stale data (5e races in 5.5e character etc.)
      if (path === 'meta.edition' && prev.meta.edition && prev.meta.edition !== value) {
        const hasData = prev.species.raceId || prev.classes.length > 0 || prev.background.backgroundId
        if (hasData) {
          const fresh = createEmptyCharacter()
          fresh.meta.edition = value
          fresh.info.name = prev.info.name     // preserve name
          fresh.info.player = prev.info.player  // preserve player
          return fresh
        }
      }

      const parts = path.split('.')
      let obj = next
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]]
      obj[parts[parts.length - 1]] = value
      return next
    })
  }

  // ── Step labels ─────────────────────────────────────────────────────────────
  // Use i18n if available and long enough, else fall back to English defaults.
  const i18nSteps  = t('steps') || []
  const stepLabels = i18nSteps.length >= 11 ? i18nSteps : FALLBACK_STEPS

  // ── Completion checks ────────────────────────────────────────────────────────
  function isStepComplete(step) {
    switch (step) {
      case STEP.EDITION:       return !!character.meta.edition
      case STEP.BASIC_INFO:    return character.info.name.trim().length >= 2
      case STEP.RACE:          return !!character.species.raceId
      case STEP.BACKGROUND:    return !!character.background.backgroundId
      case STEP.CLASS:         return isStep4Complete(character)
      case STEP.CLASS_OPTS:    return isClassOptsComplete(character)
      case STEP.ABILITIES:     return !!character.abilityScores.method
      case STEP.PROFICIENCIES: return isProficienciesComplete(character)
      case STEP.SPELLS:        return isSpellStepComplete(character)
      case STEP.EQUIPMENT:     return true  // Equipment is optional — always completable
      case STEP.REVIEW:        return true
      default:                 return false
    }
  }

  const completedSteps = Object.values(STEP).filter(isStepComplete)

  function canGoToStep(index) {
    if (index === 0) return true
    if (completedSteps.includes(index)) return true
    return completedSteps.includes(index - 1)
  }

  function getValidationMsg(step) {
    if (step === STEP.CLASS) {
      const cls = character.classes[0]
      if (!cls) return t('errClass')
      if (cls.subclassLevel === 1 && !cls.subclassId) {
        return `${cls.classId} benötigt eine ${cls.subclassTitle || 'Subklasse'} auf Level 1.`
      }
      return t('errClass')
    }
    const msgs = {
      [STEP.EDITION]:       t('errEdition'),
      [STEP.BASIC_INFO]:    t('errName'),
      [STEP.RACE]:          t('errRace'),
      [STEP.BACKGROUND]:    t('errBackground'),
      [STEP.CLASS_OPTS]:    t('errSkills'),
      [STEP.ABILITIES]:     t('errAbilities'),
      [STEP.PROFICIENCIES]: t('errSkills'),
      [STEP.SPELLS]:        t('errSpells'),
    }
    return msgs[step] || ''
  }

  // ── Navigation: auto-skip CLASS_OPTS when nothing to choose ──────────────────
  const edition = character.meta.edition || '5e'
  const cls0    = character.classes[0]

  function getNextStep(from) {
    const next = Math.min(stepLabels.length - 1, from + 1)
    if (next === STEP.CLASS_OPTS && !hasClassNonSkillOptions(cls0, edition)) {
      return Math.min(stepLabels.length - 1, next + 1)
    }
    return next
  }

  function getPrevStep(from) {
    const prev = Math.max(0, from - 1)
    if (prev === STEP.CLASS_OPTS && !hasClassNonSkillOptions(cls0, edition)) {
      return Math.max(0, prev - 1)
    }
    return prev
  }

  async function handleFinish() {
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('characters').insert({
      user_id: session.user.id,
      name:    character.info.name,
      data:    character,
    })
    if (error) { setError(t('errSave')); setSaving(false); return }
    navigate('/')
  }

  // ── Shared props ─────────────────────────────────────────────────────────────
  const props = { character, updateCharacter }

  // ── Step components – must match STEP constant ordering ──────────────────────
  const stepComponents = [
    <Step1Edition        {...props} />,   // 0
    <Step2BasicInfo      {...props} />,   // 1
    <Step3Race           {...props} />,   // 2
    <Step5Background     {...props} />,   // 3
    <Step4Class          {...props} />,   // 4
    <Step4bProficiencies {...props} />,   // 5  (fighting style / ranger extras only)
    <Step6AbilityScores  {...props} />,   // 6
    <Step7Proficiencies  {...props} />,   // 7  (skills + expertise + feat choices)
    <Step8Spells         {...props} />,   // 8
    <Step9Equipment      {...props} />,   // 9
    <ReviewStep character={character} t={t} />, // 10
  ]

  const isLast  = currentStep === stepLabels.length - 1
  const canNext = isStepComplete(currentStep) || isLast

  return (
    <div style={styles.page}>

      {/* ── Header ── */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate('/')}>{t('back')}</button>
        <h1 style={styles.headerTitle}>{t('appTitle')}</h1>
        <HeaderButtons session={session} />
      </div>

      {/* ── Step indicator ── */}
      <StepIndicator
        steps          = {stepLabels}
        currentStep    = {currentStep}
        onStepClick    = {idx => canGoToStep(idx) && setCurrentStep(idx)}
        completedSteps = {completedSteps}
      />

      {/* ── Active step ── */}
      <div style={styles.content}>
        {stepComponents[currentStep]}
      </div>

      {/* ── Navigation footer ── */}
      <div style={styles.footer}>
        <button
          style={{ ...styles.navBtn, opacity: currentStep === 0 ? 0.3 : 1 }}
          disabled={currentStep === 0}
          onClick={() => setCurrentStep(getPrevStep(currentStep))}
        >
          {t('back')}
        </button>

        <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          {currentStep + 1} / {stepLabels.length}
        </span>

        {isLast ? (
          <button
            style={{ ...styles.navBtn, ...styles.navPrimary }}
            onClick={handleFinish}
            disabled={saving}
          >
            {saving ? t('saving') : t('finish')}
          </button>
        ) : (
          <button
            style={{ ...styles.navBtn, ...styles.navPrimary, opacity: canNext ? 1 : 0.4 }}
            onClick={() => {
              if (!canNext) { setError(getValidationMsg(currentStep)); return }
              setError(null)
              setCurrentStep(getNextStep(currentStep))
            }}
          >
            {t('next')}
          </button>
        )}
      </div>

      {error && <div style={styles.errorBar}>{error}</div>}
    </div>
  )
}


// ── Review step ────────────────────────────────────────────────────────────────

function ReviewStep({ character, t }) {
  const cls         = character.classes[0]
  const cantrips    = cls?.levelChoices?.[1]?.cantrips        || []
  const startSpells = cls?.levelChoices?.[1]?.startingSpells  || []
  // Read from character.choices (single source of truth)
  const _toArr = v => Array.isArray(v) ? v : (v ? [v] : [])
  const skillKey  = cls ? `class:${cls.classId.toLowerCase()}:level1:skill:0` : null
  const expKey    = cls ? `class:${cls.classId.toLowerCase()}:level1:expertise:0` : null
  const skills    = _toArr(character.choices?.[skillKey])
  const expertise = _toArr(character.choices?.[expKey])

  const items = [
    [t('name'),       character.info.name],
    [t('edition'),    character.meta.edition],
    [t('alignment'),  character.info.alignment || '—'],
    [t('race'),       `${character.species.raceId?.split('__')[0] || '—'}${character.species.subraceId ? ` (${character.species.subraceId.split('__')[0]})` : ''}`],
    [t('background'), character.background.backgroundId?.split('__')[0] || '—'],
    [t('class'),      cls ? `${cls.classId} (d${cls.hitDie})` : '—'],
    ...(skills.length     > 0 ? [['Skills',     skills.join(', ')]]   : []),
    ...(expertise.length  > 0 ? [['Expertise',  expertise.join(', ')]] : []),
    ...(cantrips.length   > 0 ? [['Cantrips',   cantrips.join(', ')]]  : []),
    ...(startSpells.length> 0 ? [['Start Spells', startSpells.join(', ')]] : []),
    ['Gold', `${character.inventory?.currency?.gp || 0} GP`],
    ['Items', `${(character.inventory?.items || []).length} Gegenstände`],
    ...['str','dex','con','int','wis','cha'].map(key => {
      const score = (character.abilityScores.base[key] || 8)
        + ((character.species.abilityScoreImprovements || {})[key] || 0)
        + ((character.background?.abilityScoreImprovements || {})[key] || 0)
      return [key.toUpperCase(), `${score} (${modStr(Math.floor((score - 10) / 2))})`]
    }),
  ]

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <h2 style={{ color: 'var(--accent)', marginBottom: 20 }}>{t('reviewTitle')}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {items.map(([label, value]) => (
          <div
            key={label}
            style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 12, border: '1px solid #2a4a6a' }}
          >
            <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 3 }}>{label}</div>
            <div style={{ color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 }}>{value}</div>
          </div>
        ))}
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: 20, fontSize: 13 }}>{t('reviewNote')}</p>
    </div>
  )
}


// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = {
  page:        { minHeight: '100vh', background: 'var(--bg-deep)', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column' },
  header:      { background: 'var(--bg-surface)', padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: 'var(--accent)', margin: 0, fontSize: 18 },
  backBtn:     { background: 'transparent', border: '1px solid #2a4a6a', color: 'var(--text-muted)', padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  content:     { flex: 1, padding: '24px 32px', maxWidth: 900, width: '100%', margin: '0 auto', boxSizing: 'border-box' },
  footer:      { background: 'var(--bg-surface)', borderTop: '1px solid #2a4a6a', padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  navBtn:      { padding: '9px 22px', borderRadius: 8, border: '1px solid #2a4a6a', background: 'transparent', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer' },
  navPrimary:  { background: 'var(--accent)', color: 'var(--bg-deep)', border: 'none', fontWeight: 'bold' },
  errorBar:    { background: 'var(--bg-card)', color: 'var(--accent-red)', padding: '10px 32px', textAlign: 'center', fontSize: 13 },
}