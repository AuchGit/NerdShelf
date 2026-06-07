import { useState, useEffect } from 'react'
import { useLanguage } from '../../../lib/i18n'
import { setChoiceValue } from '../../../lib/choiceParser'
import { loadClassData, loadOptionalFeatureList } from '../../../lib/dataLoader'
import { parseClassFeatureOptionChoices } from '../../../lib/optionBlockResolver'

// ── Skill-Konstanten ───────────────────────────────────────
const ALL_SKILLS = [
  'acrobatics','animalHandling','arcana','athletics','deception',
  'history','insight','intimidation','investigation','medicine',
  'nature','perception','performance','persuasion','religion',
  'sleightOfHand','stealth','survival',
]

const SKILL_LABELS = {
  acrobatics:     'Acrobatics (DEX)',  animalHandling: 'Animal Handling (WIS)',
  arcana:         'Arcana (INT)',       athletics:      'Athletics (STR)',
  deception:      'Deception (CHA)',   history:        'History (INT)',
  insight:        'Insight (WIS)',      intimidation:   'Intimidation (CHA)',
  investigation:  'Investigation (INT)',medicine:       'Medicine (WIS)',
  nature:         'Nature (INT)',       perception:     'Perception (WIS)',
  performance:    'Performance (CHA)', persuasion:     'Persuasion (CHA)',
  religion:       'Religion (INT)',    sleightOfHand:  'Sleight of Hand (DEX)',
  stealth:        'Stealth (DEX)',     survival:       'Survival (WIS)',
}

function toSkillKey(raw) {
  if (!raw) return ''
  const s = raw.trim()
  if (SKILL_LABELS[s]) return s
  const camel = s.replace(/\s+(.)/g, (_, c) => c.toUpperCase()).replace(/^(.)/, (_, c) => c.toLowerCase())
  if (SKILL_LABELS[camel]) return camel
  const lower = s.toLowerCase().replace(/\s/g, '')
  for (const key of ALL_SKILLS) { if (key.toLowerCase() === lower) return key }
  return camel
}

function displaySkill(raw) {
  const key = toSkillKey(raw)
  return SKILL_LABELS[key] || raw
}

function camelToTitle(s) {
  if (!s) return ''
  return s.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
}

function extractSkillChoices(startingProfs) {
  const skills = startingProfs?.skills
  if (!skills || skills.length === 0) return null
  for (const entry of skills) {
    if (entry?.choose?.from && Array.isArray(entry.choose.from))
      return { count: entry.choose.count || 2, from: entry.choose.from }
    if (typeof entry?.any === 'number') return { count: entry.any, from: ALL_SKILLS }
    if (entry?.choose?.count && typeof entry.choose.from === 'string')
      return { count: entry.choose.count, from: ALL_SKILLS }
  }
  return null
}

// ── Fighting Styles / Maneuvers / Invocations / Metamagic /
//    Eldritch Shots / Pact Boons / Primal Order / …
//
// Quelle ist jetzt komplett data-driven (5etools `optionalfeatures.json`
// + `classFeature[].entries[].type:'options'`). Der generische
// Option-Block-Resolver (lib/optionBlockResolver.js) baut die
// ChoiceDescriptors; rulesEngine wendet die mechanischen Boni über
// lib/featureBonusExtractor.js an. Hier — keine hardcoded Tabellen
// mehr.
// ─────────────────────────────────────────────────────────────

// Ranger Favored Enemy + Natural Explorer (5e PHB).
// Beide Listen werden direkt aus den 5etools-Feature-Entries
// extrahiert — kein hardcoded Fallback.
//
// Favored Enemy Text-Schnipsel (PHB Ranger L1):
//   "Choose a type of favored enemy: {@filter aberrations|bestiary|...},
//    {@filter beasts|...}, …, or {@filter undead|...}.
//    Alternatively, you can select two races of {@filter humanoid|...}."
//
// Natural Explorer Text-Schnipsel:
//   "Choose one type of favored terrain: arctic, coast, desert, …, or
//    the Underdark."
function extractFavoredEnemyOptions(classData) {
  const feat = (classData?.features || []).find(
    f => f.name === 'Favored Enemy' && (f.level == null || f.level === 1),
  )
  if (!Array.isArray(feat?.entries)) return []
  const text = feat.entries.filter(e => typeof e === 'string').join(' ')
  const tokens = []
  const re = /\{@filter\s+([^|}]+)\|bestiary\|type=[^}]+\}/g
  let m
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].trim().toLowerCase()
    // Casing direkt aus dem Datenfeld übernehmen — 5etools spielt die
    // Pluralität (Fey + Undead bleiben singular; Aberrations bleibt
    // plural). Nur First-Letter-Capitalization.
    const cap = raw.charAt(0).toUpperCase() + raw.slice(1)
    if (!tokens.includes(cap)) tokens.push(cap)
  }
  // Der "Alternatively, you can select two races of humanoid"-Satz
  // führt nur den singular "humanoid" als Tag — kein @filter-Match
  // ergibt "Humanoids". Wir ergänzen manuell, falls humanoid im Text
  // aber noch nicht in der Liste ist.
  if (/\bhumanoid/i.test(text) && !tokens.includes('Humanoid') && !tokens.includes('Humanoids')) {
    tokens.push('Humanoids')
  }
  return tokens
}

function extractFavoredTerrainOptions(classData) {
  const feat = (classData?.features || []).find(
    f => f.name === 'Natural Explorer' && (f.level == null || f.level === 1),
  )
  if (!Array.isArray(feat?.entries)) return []
  const text = feat.entries.filter(e => typeof e === 'string').join(' ')
  const m = text.match(/choose\s+one\s+type\s+of\s+favored\s+terrain:\s+([^.]+?)\./i)
  if (!m) return []
  const list = m[1]
    .replace(/\bor\s+the\s+/gi, '')
    .replace(/\bor\s+/gi, '')
    .split(/,\s*/)
    .map(s => s.replace(/^the\s+/i, '').trim())
    .filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
  return [...new Set(list)]
}

// ── Hauptkomponente ────────────────────────────────────────
// NOTE: Skill proficiency choices and Expertise have moved to Step7Proficiencies,
// which runs after Ability Scores so modifiers can be shown.
// This step now only handles non-skill class options:
//   • Fighting Style (Fighter, Paladin, Ranger)
//   • Superior Technique Maneuver
//   • Ranger Favored Enemy / Terrain (5e)
// The step is auto-skipped in CharacterCreatePage when nothing applies.

export default function Step4bProficiencies({ character, updateCharacter }) {
  const { t } = useLanguage()
  const cls = character.classes[0]
  const edition = character.meta.edition || '5e'

  // Fighting Style / Maneuver / Invocation / Metamagic werden jetzt
  // alle über die generischen Feature-Option-Descriptors gerendert
  // (siehe unten). Hier nur noch die niche-5e-Ranger-Extras die nicht
  // als optionalfeature in den Daten leben.
  const selectedFavoredEnemy  = cls?.levelChoices?.[1]?.favoredEnemy   || null
  const selectedFavoredTerrain = cls?.levelChoices?.[1]?.favoredTerrain || null
  const hasRangerExtras = cls?.classId === 'Ranger' && edition === '5e'
  // Optionen werden weiter unten aus classData via useMemo extrahiert
  // (siehe favoredEnemyOpts / favoredTerrainOpts). Kein hardcoded Array.

  // ── Ranger extras ─────────────────────────────────────────
  function selectFavoredEnemy(val) {
    updateLevelChoice({ favoredEnemy: val === selectedFavoredEnemy ? null : val })
  }
  function selectFavoredTerrain(val) {
    updateLevelChoice({ favoredTerrain: val === selectedFavoredTerrain ? null : val })
  }

  // Gemeinsame Update-Funktion
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

  // Write a choice into character.choices (unified choice storage).
  // NOTE: Class skill proficiency choices were moved to Step7Proficiencies.
  // If a toggleSkill handler is ever added back here, call:
  //   setChoice(`class:${cls.classId.toLowerCase()}:level1:skill:0`, nextSkills)
  function setChoice(id, val) {
    updateCharacter('choices', setChoiceValue(character.choices || {}, id, val))
  }

  // ── Generic Feature-Option-Blocks ─────────────────────────
  // 5etools encoded inline picks: `type: 'options'` mit refClassFeature
  // / refSubclassFeature children. Wir laden die Class-Data lazy, ziehen
  // alle Option-Block-Descriptors raus und rendern sie als generische
  // Cards. Druid Primal Order (Magician / Warden), Sub-Class-internal
  // sub-options, future class options — alle landen hier ohne Hardcode.
  //
  // refOptionalfeature-Blöcke (5e Fighting Style → Archery / Defense /
  // …) werden in dieser Phase ausgeklammert — sie nutzen weiter den
  // bestehenden FIGHTING_STYLES-Pfad oben.
  const [classData, setClassData] = useState(null)
  const [optionalFeatureMap, setOptionalFeatureMap] = useState(null)
  useEffect(() => {
    if (!cls?.classId) { setClassData(null); return }
    let cancelled = false
    loadClassData(edition, cls.classId).then(d => {
      if (!cancelled) setClassData(d)
    }).catch(() => { if (!cancelled) setClassData(null) })
    return () => { cancelled = true }
  }, [cls?.classId, edition])

  // Optfeature-Map laden — pro Edition einmal. Wird vom Resolver für
  // refOptionalfeature-Lookups (5e Fighter Fighting Style → Archery /
  // Defense / Dueling / …, Battle Master Maneuvers, Warlock
  // Invocations, Sorcerer Metamagic, …) gebraucht.
  useEffect(() => {
    let cancelled = false
    loadOptionalFeatureList(edition).then(list => {
      if (cancelled) return
      const m = new Map()
      for (const f of (list || [])) {
        if (!f?.name) continue
        const lower = String(f.name).toLowerCase()
        const src = String(f.source || '').toUpperCase()
        m.set(lower, f)
        if (src) m.set(`${lower}|${src}`, f)
      }
      setOptionalFeatureMap(m)
    }).catch(() => { if (!cancelled) setOptionalFeatureMap(new Map()) })
    return () => { cancelled = true }
  }, [edition])

  // Alle Feature-Option-Descriptors — refClassFeature, refSubclass
  // Feature UND refOptionalfeature werden alle generisch behandelt.
  // Damit verschwindet die hardcoded FIGHTING_STYLES / BATTLE_MASTER_
  // MANEUVERS-Tabelle als Source-of-Truth; die Daten kommen direkt
  // aus optionalfeatures.json.
  const featureOptionDescs = (() => {
    if (!classData || !cls) return []
    return parseClassFeatureOptionChoices(cls, classData, {
      edition,
      optionalFeatureMap,
    }) || []
  })()

  // Ranger 5e PHB-Optionen direkt aus den Feature-Entries extrahieren.
  // useMemo damit die Listen nur neu berechnet werden wenn classData
  // wechselt (Klassenwechsel etc.).
  const favoredEnemyOpts = useMemo(
    () => hasRangerExtras ? extractFavoredEnemyOptions(classData) : [],
    [hasRangerExtras, classData],
  )
  const favoredTerrainOpts = useMemo(
    () => hasRangerExtras ? extractFavoredTerrainOptions(classData) : [],
    [hasRangerExtras, classData],
  )

  // ── Kein Character / keine Klasse ─────────────────────────
  if (!cls) {
    return (
      <div style={styles.container}>
        <h2 style={styles.title}>{t('classOptions')}</h2>
        <p style={styles.muted}>Bitte wähle zuerst eine Klasse.</p>
      </div>
    )
  }

  const hasAnythingToPick = hasRangerExtras
    || (featureOptionDescs && featureOptionDescs.length > 0)

  if (!hasAnythingToPick) {
    return (
      <div style={styles.container}>
        <h2 style={styles.title}>{t('classOptions')}</h2>
        <p style={styles.subtitle}>{cls.classId}</p>
        <div style={styles.emptyBox}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>✓</div>
          <p style={styles.muted}>{t('noSkillChoices')}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>{t('classOptions')}</h2>
      <p style={styles.subtitle}>{cls.classId}</p>

      {/* ── Generische Feature-Option-Blocks ───────────────────
          Aus 5etools type:'options'-Inline-Picks (Druid Primal
          Order: Magician/Warden, ähnliche subclass-interne
          Sub-Options, alle zukünftigen Class-Options). Storage in
          character.choices via Descriptor-ID. */}
      {featureOptionDescs.map(desc => {
        const stored = character.choices?.[desc.id]
        const storedArr = Array.isArray(stored) ? stored : (stored ? [stored] : [])
        const setStored = (next) => {
          // count=1 → string, count>1 → string[]. Beide Shapes
          // werden überall via asArray gelesen.
          const value = desc.count === 1 ? (next[0] || null) : next
          updateCharacter('choices', setChoiceValue(character.choices || {}, desc.id, value))
        }
        const toggle = (valueKey) => {
          if (desc.count === 1) {
            setStored(storedArr.includes(valueKey) ? [] : [valueKey])
            return
          }
          const has = storedArr.includes(valueKey)
          if (has) setStored(storedArr.filter(v => v !== valueKey))
          else if (storedArr.length < desc.count) setStored([...storedArr, valueKey])
        }
        const done = storedArr.length === desc.count
        return (
          <div key={desc.id} style={styles.section}>
            <div style={styles.sectionTitle}>
              {desc._featureName || desc.label}
              {done
                ? <span style={{ color: 'var(--accent-green)', marginLeft: 8, fontSize: 12, textTransform: 'none' }}>
                    ✓ {storedArr.length}/{desc.count}
                  </span>
                : <span style={{ color: 'var(--accent)', marginLeft: 8, fontSize: 12, textTransform: 'none' }}>
                    {storedArr.length}/{desc.count} — wählen
                  </span>}
            </div>
            <p style={styles.sectionDesc}>
              Wähle {desc.count === 1 ? 'eine Option' : `${desc.count} Optionen`} für „{desc._featureName || desc.label}".
            </p>
            <div style={styles.styleGrid}>
              {desc.options.map(opt => {
                const isSel = storedArr.includes(opt.value)
                // Description-Strings für die Card aus den Entries extrahieren.
                const firstString = Array.isArray(opt.description)
                  ? opt.description.find(e => typeof e === 'string')
                  : null
                const shortDesc = firstString
                  ? String(firstString).replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1').slice(0, 260)
                  : ''
                return (
                  <div
                    key={opt.value}
                    style={{ ...styles.styleCard, ...(isSel ? styles.styleCardSelected : {}) }}
                    onClick={() => toggle(opt.value)}
                  >
                    <div style={styles.styleName}>{opt.label}</div>
                    {shortDesc && <div style={styles.styleDesc}>{shortDesc}{firstString && firstString.length > 260 ? ' …' : ''}</div>}
                    {isSel && <div style={styles.styleCheck}>✓ Gewählt</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* ── Ranger: Favored Enemy + Natural Explorer (5e only) ── */}
      {hasRangerExtras && (
        <>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Favored Enemy</div>
            <p style={styles.sectionDesc}>
              Wähle einen Favored Enemy. Du hast advantage auf Survival-Checks um sie zu verfolgen,
              und auf Intelligence-Checks um sie zu erinnern.
            </p>
            <div style={styles.chipGrid}>
              {favoredEnemyOpts.length === 0 && (
                <span style={styles.muted}>Lade Optionen…</span>
              )}
              {favoredEnemyOpts.map(enemy => {
                const isSel = selectedFavoredEnemy === enemy
                return (
                  <button key={enemy}
                    style={{ ...styles.chip, ...(isSel ? styles.chipSelected : {}) }}
                    onClick={() => selectFavoredEnemy(enemy)}>
                    {enemy} {isSel ? '✓' : ''}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>Natural Explorer — Favored Terrain</div>
            <p style={styles.sectionDesc}>
              Wähle ein Favored Terrain. In diesem Terrain erhältst du verschiedene Boni.
            </p>
            <div style={styles.chipGrid}>
              {favoredTerrainOpts.length === 0 && (
                <span style={styles.muted}>Lade Optionen…</span>
              )}
              {favoredTerrainOpts.map(terrain => {
                const isSel = selectedFavoredTerrain === terrain
                return (
                  <button key={terrain}
                    style={{ ...styles.chip, ...(isSel ? styles.chipSelected : {}) }}
                    onClick={() => selectFavoredTerrain(terrain)}>
                    {terrain} {isSel ? '✓' : ''}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}

    </div>
  )
}
// Skills are now chosen in Step7Proficiencies (after Ability Scores),
// where modifiers are visible.

// ── Styles ─────────────────────────────────────────────────

const styles = {
  container: { maxWidth: 800, margin: '0 auto', padding: 16 },
  title:     { color: 'var(--accent)', marginBottom: 4 },
  subtitle:  { color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 },
  muted:     { color: 'var(--text-dim)', fontSize: 14 },
  emptyBox: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12,
    padding: 40, textAlign: 'center', color: 'var(--text-muted)',
  },
  section: {
    background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 12,
    padding: 16, marginBottom: 20,
  },
  sectionTitle: {
    color: 'var(--accent)', fontWeight: 'bold', fontSize: 13,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--border-subtle)',
  },
  sectionDesc: { color: 'var(--text-muted)', fontSize: 13, marginBottom: 14, marginTop: 8 },

  // Fighting Styles
  styleGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8,
  },
  styleCard: {
    background: 'var(--bg-elevated)', border: '2px solid var(--border)', borderRadius: 8,
    padding: '12px 14px', cursor: 'pointer', transition: 'all 0.15s',
  },
  styleCardSelected: { border: '2px solid var(--accent)', background: 'var(--bg-highlight)' },
  styleName:  { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13, marginBottom: 6 },
  styleDesc:  { color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 },
  styleCheck: { color: 'var(--accent)', fontSize: 11, marginTop: 6, fontWeight: 'bold' },

  // Battle Master Maneuvers
  maneuverGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8,
  },
  maneuverCard: {
    background: 'var(--bg-elevated)', border: '2px solid var(--border)', borderRadius: 8,
    padding: '10px 12px', cursor: 'pointer', transition: 'all 0.15s',
  },
  maneuverSelected: { border: '2px solid var(--accent)', background: 'var(--bg-highlight)' },
  maneuverName: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 },
  maneuverSource: {
    color: 'var(--text-dim)', fontSize: 10, background: 'var(--bg-surface)',
    padding: '1px 5px', borderRadius: 3,
  },
  maneuverDesc: { color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.4 },

  // Spell note
  spellNoteBox: {
    display: 'flex', alignItems: 'flex-start', gap: 4,
    background: 'var(--bg-card)', border: '1px solid var(--accent-purple)', borderRadius: 10,
    padding: '12px 16px', marginBottom: 20,
  },

  // Chip buttons (Favored Enemy etc)
  chipGrid: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: {
    padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13,
  },
  chipSelected: { border: '1px solid var(--accent)', color: 'var(--accent)', background: 'var(--bg-highlight)' },

  // Skills styles removed — skills now in Step7Proficiencies
}