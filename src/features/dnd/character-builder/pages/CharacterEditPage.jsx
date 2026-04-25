// pages/CharacterEditPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Loads an existing Level 1 character from Supabase and renders the
// CharacterCreatePage in "edit mode" (updates instead of inserts on save).
//
// Route: /character/:id/edit
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from '../lib/hashNav'
import { supabase } from '../lib/supabase'
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
import Step8Spells          from '../components/wizard/steps/Step7Spells'
import Step9Equipment       from '../components/wizard/steps/Step9Equipment'

function modStr(mod) { return mod >= 0 ? `+${mod}` : `${mod}` }

const STEP = {
  EDITION: 0, BASIC_INFO: 1, RACE: 2, BACKGROUND: 3, CLASS: 4,
  CLASS_OPTS: 5, ABILITIES: 6, PROFICIENCIES: 7, SPELLS: 8,
  EQUIPMENT: 9, REVIEW: 10,
}

const FALLBACK_STEPS = [
  'Edition', 'Basic Info', 'Race', 'Background', 'Class',
  'Class Options', 'Abilities', 'Proficiencies', 'Spells', 'Equipment', 'Review',
]

function hasClassNonSkillOptions(cls) {
  if (!cls) return false
  return ['Fighter', 'Paladin', 'Ranger'].includes(cls.classId)
}

function extractSkillChoices(profs) {
  const skills = profs?.skills
  if (!skills?.length) return null
  for (const e of skills) {
    if (e?.choose?.from) return { count: e.choose.count || 2, from: e.choose.from }
    if (typeof e?.any === 'number') return { count: e.any, from: [] }
  }
  return null
}

const EXPERTISE_L1 = { Rogue: 2 }

export default function CharacterEditPage({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [currentStep, setCurrentStep] = useState(0)
  const [character, setCharacter]     = useState(null)
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState(null)

  // Load existing character
  useEffect(() => {
    async function load() {
      const { data, error: err } = await supabase
        .from('characters').select('*').eq('id', id).eq('user_id', session.user.id).single()
      if (err || !data) { navigate('/'); return }
      setCharacter(data.data)
      setLoading(false)
    }
    load()
  }, [id])

  function updateCharacter(path, value) {
    setCharacter(prev => {
      const next = structuredClone(prev)
      if (path === 'meta.edition' && prev.meta.edition && prev.meta.edition !== value) {
        const hasData = prev.species.raceId || prev.classes.length > 0 || prev.background.backgroundId
        if (hasData) {
          const fresh = createEmptyCharacter()
          fresh.meta.edition = value
          fresh.info.name = prev.info.name
          fresh.info.player = prev.info.player
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

  if (loading || !character) return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 80 }}>Lade Character…</div>

  const i18nSteps = t('steps') || []
  const stepLabels = i18nSteps.length >= 11 ? i18nSteps : FALLBACK_STEPS

  function isStepComplete(step) {
    const cls = character.classes[0]
    switch (step) {
      case STEP.EDITION:    return !!character.meta.edition
      case STEP.BASIC_INFO: return character.info.name.trim().length >= 2
      case STEP.RACE:       return !!character.species.raceId
      case STEP.BACKGROUND: return !!character.background.backgroundId
      case STEP.CLASS:      return isStep4Complete(character)
      case STEP.CLASS_OPTS: return !hasClassNonSkillOptions(cls) || true
      case STEP.ABILITIES:  return !!character.abilityScores.method
      case STEP.PROFICIENCIES: {
        if (!cls) return true
        const choices = extractSkillChoices(cls.startingProficiencies)
        if (choices) {
          const key = `class:${cls.classId.toLowerCase()}:level1:skill:0`
          const val = character.choices?.[key]
          if ((Array.isArray(val) ? val.length : val ? 1 : 0) < choices.count) return false
        }
        const expN = EXPERTISE_L1[cls?.classId] || 0
        if (expN > 0) {
          const ek = `class:${cls.classId.toLowerCase()}:level1:expertise:0`
          const ev = character.choices?.[ek]
          if ((Array.isArray(ev) ? ev.length : ev ? 1 : 0) < expN) return false
        }
        return true
      }
      case STEP.SPELLS: {
        if (!cls || !isSpellcaster(cls.classId)) return true
        const info = getSpellcastingInfo(cls.classId, 1, 0)
        if (!info) return true
        const sc = cls.levelChoices?.[1]?.cantrips?.length || 0
        const ss = cls.levelChoices?.[1]?.startingSpells?.length || 0
        if (info.cantripsKnown > 0 && sc < info.cantripsKnown) return false
        if (info.type === 'known' && info.spellsKnown > 0 && ss < info.spellsKnown) return false
        if (info.hasSpellbook && ss < (info.spellbookStart || 6)) return false
        return true
      }
      case STEP.EQUIPMENT: return true
      case STEP.REVIEW:    return true
      default: return false
    }
  }

  const completedSteps = Object.values(STEP).filter(isStepComplete)
  const edition = character.meta.edition || '5e'
  const cls0 = character.classes[0]

  function getNextStep(from) {
    const next = Math.min(stepLabels.length - 1, from + 1)
    if (next === STEP.CLASS_OPTS && !hasClassNonSkillOptions(cls0)) return Math.min(stepLabels.length - 1, next + 1)
    return next
  }
  function getPrevStep(from) {
    const prev = Math.max(0, from - 1)
    if (prev === STEP.CLASS_OPTS && !hasClassNonSkillOptions(cls0)) return Math.max(0, prev - 1)
    return prev
  }

  async function handleFinish() {
    setSaving(true); setError(null)
    const { error: err } = await supabase
      .from('characters')
      .update({ data: character, name: character.info.name })
      .eq('id', id).eq('user_id', session.user.id)
    if (err) { setError('Speichern fehlgeschlagen'); setSaving(false); return }
    navigate(`/character/${id}`)
  }

  const props = { character, updateCharacter }
  const stepComponents = [
    <Step1Edition {...props} />,
    <Step2BasicInfo {...props} />,
    <Step3Race {...props} />,
    <Step5Background {...props} />,
    <Step4Class {...props} />,
    <Step4bProficiencies {...props} />,
    <Step6AbilityScores {...props} />,
    <Step7Proficiencies {...props} />,
    <Step8Spells {...props} />,
    <Step9Equipment {...props} />,
    <ReviewStep character={character} t={t} />,
  ]

  const isLast = currentStep === stepLabels.length - 1
  const canNext = isStepComplete(currentStep) || isLast

  return (
    <div style={S.page}>
      <div style={S.header}>
        <button style={S.backBtn} onClick={() => navigate(`/character/${id}`)}>← Zurück zum Sheet</button>
        <h1 style={S.headerTitle}>✏️ {character.info.name} bearbeiten</h1>
        <HeaderButtons session={session} />
      </div>
      <StepIndicator steps={stepLabels} currentStep={currentStep}
        onStepClick={idx => (completedSteps.includes(idx) || completedSteps.includes(idx - 1)) && setCurrentStep(idx)}
        completedSteps={completedSteps} />
      <div style={S.content}>{stepComponents[currentStep]}</div>
      <div style={S.footer}>
        <button style={{ ...S.navBtn, opacity: currentStep === 0 ? 0.3 : 1 }}
          disabled={currentStep === 0} onClick={() => setCurrentStep(getPrevStep(currentStep))}>
          {t('back')}
        </button>
        <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>{currentStep + 1} / {stepLabels.length}</span>
        {isLast ? (
          <button style={{ ...S.navBtn, ...S.navPrimary }} onClick={handleFinish} disabled={saving}>
            {saving ? 'Speichern…' : '✓ Änderungen speichern'}
          </button>
        ) : (
          <button style={{ ...S.navBtn, ...S.navPrimary, opacity: canNext ? 1 : 0.4 }}
            onClick={() => { if (!canNext) return; setCurrentStep(getNextStep(currentStep)) }}>
            {t('next')}
          </button>
        )}
      </div>
      {error && <div style={S.errorBar}>{error}</div>}
    </div>
  )
}

function ReviewStep({ character, t }) {
  const cls = character.classes[0]
  const _toArr = v => Array.isArray(v) ? v : (v ? [v] : [])
  const skillKey = cls ? `class:${cls.classId.toLowerCase()}:level1:skill:0` : null
  const skills = _toArr(character.choices?.[skillKey])
  const items = [
    ['Name', character.info.name],
    ['Edition', character.meta.edition],
    ['Rasse', `${character.species.raceId?.split('__')[0] || '—'}${character.species.subraceId ? ` (${character.species.subraceId.split('__')[0]})` : ''}`],
    ['Background', character.background.backgroundId?.split('__')[0] || '—'],
    ['Klasse', cls ? `${cls.classId} (d${cls.hitDie})` : '—'],
    ...(skills.length > 0 ? [['Skills', skills.join(', ')]] : []),
  ]
  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <h2 style={{ color: 'var(--accent)', marginBottom: 20 }}>Zusammenfassung</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {items.map(([l, v]) => (
          <div key={l} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 12, border: '1px solid var(--border)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 3 }}>{l}</div>
            <div style={{ color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 }}>{v}</div>
          </div>
        ))}
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: 20, fontSize: 13 }}>
        Drücke „Änderungen speichern" um die Bearbeitung abzuschließen.
      </p>
    </div>
  )
}

const S = {
  page: { minHeight: '100vh', background: 'var(--bg-page)', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' },
  headerTitle: { color: 'var(--accent)', fontSize: 18, margin: 0 },
  backBtn: { padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 },
  content: { flex: 1, padding: '24px 20px', overflowY: 'auto' },
  footer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)' },
  navBtn: { padding: '10px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 },
  navPrimary: { border: '2px solid var(--accent)', color: 'var(--accent)', fontWeight: 'bold' },
  errorBar: { position: 'fixed', bottom: 60, left: '50%', transform: 'translateX(-50%)', background: 'var(--accent-red)', color: 'var(--text-primary)', padding: '8px 20px', borderRadius: 8, fontSize: 13 },
}