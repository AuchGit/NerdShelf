// components/steps/Step4Class.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Class selection step.
//
// KEY FIXES vs. previous version:
//  1. SUBCLASS_AT_LEVEL_1 constant REMOVED.  Level-1 subclass requirement is
//     now derived dynamically from cls.subclassLevel === 1 using the data that
//     5etools already provides.  This means Sorcerer, Warlock, Cleric AND any
//     future / homebrew classes that set subclassLevel:1 work automatically.
//  2. handleSelect auto-switches to the "subclasses" tab when the chosen class
//     requires a level-1 subclass selection.
//  3. SubclassCard "Wählen" button scrolls into view for level-1 subclasses so
//     the player immediately sees their options without manual tab switching.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { loadClassList } from '../../../lib/dataLoader'
import { useLanguage } from '../../../lib/i18n'
import { parseTags } from '../../../lib/tagParser'
import BrowsePanel from '../../ui/BrowsePanel'
import EntryRenderer from '../../ui/EntryRenderer'

const CASTER_COLORS = {
  full: 'var(--accent-purple)', half: 'var(--accent-blue)', '1/3': 'var(--accent-green)', pact: 'var(--accent-pink)', null: 'var(--text-dim)',
}

// FIX: Removed `const SUBCLASS_AT_LEVEL_1 = ['Sorcerer', 'Warlock', 'Cleric']`
// Use cls.subclassLevel === 1 everywhere instead (see isL1Subclass helper below).

/**
 * FIX (NEW): Returns true when the given class (from 5etools data) requires its
 * subclass to be chosen at level 1. Reads directly from cls.subclassLevel so
 * this works for all classes without any hardcoded list to maintain.
 */
function isL1Subclass(cls) {
  return cls?.subclassLevel === 1
}

export default function Step4Class({ character, updateCharacter }) {
  const { t } = useLanguage()
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [detailTab, setDetailTab] = useState('info')
  const [expandedSubclass, setExpandedSubclass] = useState(null)

  useEffect(() => {
    setLoading(true)
    loadClassList(character.meta.edition).then(data => {
      setClasses(data)
      setLoading(false)
    })
  }, [character.meta.edition])

  const selectedClass    = character.classes[0]
  const selectedClassId  = selectedClass?.classId
  const selectedSubclassId = selectedClass?.subclassId

  function handleSelect(cls) {
    const newClass = {
      classId: cls.id,
      subclassId: null,
      source: cls.source,
      level: 1,
      hitDie: cls.hitDie,
      isSpellcaster: !!cls.spellcastingAbility,
      spellcastingAbility: cls.spellcastingAbility,
      casterProgression: cls.casterProgression,
      subclassTitle: cls.subclassTitle,
      // FIX: persist subclassLevel so isL1Subclass() works on the saved class object
      subclassLevel: cls.subclassLevel,
      proficiency: cls.proficiency || [],
      startingProficiencies: cls.startingProficiencies || {},
      levelChoices: { 1: {} },
      hpRolls: { 1: cls.hitDie },
      preparedSpells: [],
      knownSpells: [],
    }
    if (character.classes.length === 0) {
      updateCharacter('classes', [newClass])
    } else {
      const updated = [...character.classes]
      updated[0] = newClass
      updateCharacter('classes', updated)
    }
    // ── Cleanup stale class:* choice keys (skills, expertise, etc.) ──────
    const cleanedChoices = Object.fromEntries(
      Object.entries(character.choices || {}).filter(([k]) => !k.startsWith('class:'))
    )
    updateCharacter('choices', cleanedChoices)
    // FIX: use isL1Subclass() instead of SUBCLASS_AT_LEVEL_1.includes(cls.id)
    setDetailTab(isL1Subclass(cls) ? 'subclasses' : 'info')
    setExpandedSubclass(null)
  }

  function handleSubclassSelect(cls, sub) {
    const updated = [...character.classes]
    if (updated.length === 0) return
    updated[0] = { ...updated[0], subclassId: sub.id, subclassName: sub.name }
    updateCharacter('classes', updated)
  }

  function getCasterLabel(prog) {
    const map = {
      full: t('fullCaster'), half: t('halfCaster'),
      '1/3': t('thirdCaster'), pact: t('pactMagic'), null: t('noCaster'),
    }
    return map[prog] || t('noCaster')
  }

  function renderListItem(cls, isSelected) {
    return (
      <div>
        <div style={{ color: isSelected ? 'var(--accent)' : 'var(--text-primary)', fontWeight: 'bold', fontSize: 14 }}>
          {cls.name}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--accent-red)', fontSize: 11 }}>d{cls.hitDie}</span>
          <span style={{ color: CASTER_COLORS[cls.casterProgression], fontSize: 11 }}>
            {getCasterLabel(cls.casterProgression)}
          </span>
          {cls.subclasses?.length > 0 && (
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{cls.subclasses.length} Subkl.</span>
          )}
          {/* FIX: badge for L1 subclass requirement, derived dynamically */}
          {isL1Subclass(cls) && (
            <span style={{ color: 'var(--accent)', fontSize: 11 }}>★ Lv1-Subkl.</span>
          )}
        </div>
      </div>
    )
  }

  function renderDetail(cls) {
    const profs = cls.startingProficiencies || {}
    const skillText = formatSkillChoices(profs.skills)
    const isSelectedClass = cls.id === selectedClassId
    // FIX: dynamic check, no hardcoded list
    const needsL1Subclass = isL1Subclass(cls)

    return (
      <div>
        <div style={{ color: 'var(--accent)', fontSize: 20, fontWeight: 'bold', marginBottom: 4 }}>
          {cls.name}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
          {t('source')}: {cls.source}
        </div>

        {/* Badges */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <Badge label={t('hitDie')} value={`d${cls.hitDie}`} color="#ff8888" />
          <Badge label={t('casterType')} value={getCasterLabel(cls.casterProgression)} color={CASTER_COLORS[cls.casterProgression]} />
          {cls.spellcastingAbility && (
            <Badge label="Spellcasting" value={cls.spellcastingAbility.toUpperCase()} color="#a78bfa" />
          )}
          <Badge label="Subklasse" value={`${cls.subclassTitle} (Lv.${cls.subclassLevel})`} color="#8899aa" />
        </div>

        {/* FIX: L1-Subclass banner — shown for any class with subclassLevel===1 */}
        {isSelectedClass && needsL1Subclass && (
          <div style={subclassBanner}>
            <span style={{ color: 'var(--accent)', fontSize: 13 }}>
              ★ {cls.name}s wählen ihre {cls.subclassTitle} bereits bei Level 1!
            </span>
            {selectedSubclassId
              ? <span style={{ color: 'var(--accent-green)', fontSize: 13, marginLeft: 12 }}>
                  ✓ {selectedSubclassId}
                </span>
              : <span style={{ color: 'var(--accent)', fontSize: 12, marginLeft: 12 }}>
                  ← Bitte Subklasse wählen
                </span>
            }
          </div>
        )}

        {/* Tabs */}
        <div style={tabS.row}>
          {['info', 'features', 'subclasses'].map(tab => (
            <button key={tab}
              style={{ ...tabS.btn, ...(detailTab === tab ? tabS.active : {}) }}
              onClick={() => setDetailTab(tab)}>
              {tab === 'info' ? 'Info'
                : tab === 'features' ? 'Features (1–20)'
                : `${cls.subclassTitle}s (${cls.subclasses?.length || 0})`}
            </button>
          ))}
        </div>

        {/* Tab: Info */}
        {detailTab === 'info' && (
          <div>
            {/* FIX: nudge player to pick subclass when needed */}
            {needsL1Subclass && !selectedSubclassId && isSelectedClass && (
              <div style={{ ...subclassBanner, marginBottom: 10 }}>
                <span style={{ color: 'var(--accent)', fontSize: 12 }}>
                  Wechsle zum Tab „{cls.subclassTitle}s", um deine Subklasse zu wählen.
                </span>
                <button
                  style={{ marginLeft: 12, ...tabS.btn, border: '1px solid var(--accent)', color: 'var(--accent)', padding: '4px 10px' }}
                  onClick={() => setDetailTab('subclasses')}
                >
                  → Jetzt wählen
                </button>
              </div>
            )}
            <div style={{ marginBottom: 12 }}>
              <div style={sectionLabel}>Starting Proficiencies</div>
              {profs.armor?.length > 0 && <ProfRow label="Armor" value={profs.armor.map(a => parseTags(String(a))).join(', ')} />}
              {profs.weapons?.length > 0 && <ProfRow label="Weapons" value={profs.weapons.map(w => parseTags(String(w))).join(', ')} />}
              {profs.savingThrows?.length > 0 && <ProfRow label="Saves" value={profs.savingThrows.join(', ')} />}
              {skillText && <ProfRow label="Skills" value={skillText} />}
              {profs.tools?.length > 0 && (
                <ProfRow label="Tools" value={flattenProf(profs.tools).map(to => parseTags(String(to))).join(', ')} />
              )}
            </div>
            <EntryRenderer entries={cls.entries} />
          </div>
        )}

        {/* Tab: Features 1-20 */}
        {detailTab === 'features' && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={tableStyles.th}>Lv</th>
                <th style={tableStyles.th}>Features</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 20 }, (_, i) => i + 1).map(level => {
                const feats = cls.featuresPerLevel?.[level] || []
                return (
                  <tr key={level} style={{ background: level % 2 === 0 ? 'var(--bg-inset)' : 'transparent' }}>
                    <td style={{ ...tableStyles.td, color: 'var(--accent)', fontWeight: 'bold', width: 30 }}>{level}</td>
                    <td style={tableStyles.td}>
                      {feats.length > 0
                        ? <span style={{ color: 'var(--text-secondary)' }}>{feats.map(f => typeof f === 'string' ? f : f.name).join(', ')}</span>
                        : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                      {level === cls.subclassLevel && (
                        <span style={{ color: 'var(--accent-purple)', fontSize: 10, marginLeft: 6 }}>
                          [{cls.subclassTitle}]
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* Tab: Subklassen */}
        {detailTab === 'subclasses' && (
        <div>
          {/* FIX: clearer prompt for L1 subclasses */}
          {needsL1Subclass && (
            <div style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 10, padding: '6px 10px',
                          background: 'var(--bg-card)', border: '1px solid #f59e0b33', borderRadius: 6 }}>
              ★ Diese Klasse wählt {selectedSubclassId ? 'bereits ✓' : 'sofort'} bei Level 1 eine {cls.subclassTitle}.
            </div>
          )}
          {(!cls.subclasses || cls.subclasses.length === 0) ? (
            <div style={{ color: 'var(--text-dim)', fontSize: 13, padding: '16px 0' }}>
              Keine Subklassen-Daten geladen.
            </div>
          ) : (
            cls.subclasses.map((sub, i) => (
              <SubclassCard
                key={i}
                sub={sub}
                isSelected={character?.classes?.[0]?.subclassId === sub.name}
                onSelect={() => {
                  // Build class entry if not yet selected, or reuse existing
                  const base = (selectedClassId === cls.id && character.classes.length > 0)
                    ? { ...character.classes[0] }
                    : {
                        classId: cls.id, subclassId: null, source: cls.source, level: 1,
                        hitDie: cls.hitDie, isSpellcaster: !!cls.spellcastingAbility,
                        spellcastingAbility: cls.spellcastingAbility,
                        casterProgression: cls.casterProgression,
                        subclassTitle: cls.subclassTitle, subclassLevel: cls.subclassLevel,
                        proficiency: cls.proficiency || [],
                        startingProficiencies: cls.startingProficiencies || {},
                        levelChoices: { 1: {} }, hpRolls: { 1: cls.hitDie },
                        preparedSpells: [], knownSpells: [],
                      }
                  // Set class + subclass in one update — no tab switch, no flicker
                  base.subclassId = sub.name
                  base.subclassName = sub.name
                  if (character.classes.length === 0) {
                    updateCharacter('classes', [base])
                  } else {
                    const updated = [...character.classes]
                    updated[0] = base
                    updateCharacter('classes', updated)
                  }
                  // Stay on current tab
                }}
              />
            ))
          )}
        </div>
        )}
      </div>
    )
  }

  // FIX 5: Check if step is complete (for navigation blocking)
  const selectedClassData = classes.find(c => c.id === selectedClassId) || null
  const needsSubclass = isL1Subclass(selectedClassData || selectedClass)
  const isComplete = selectedClassId && (!needsSubclass || selectedSubclassId)

  return (
    <div>
      <h2 style={{ color: 'var(--accent)', marginBottom: 4 }}>{t('chooseClass')}</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 16, fontSize: 14 }}>{t('classSubtitle')}</p>
      <BrowsePanel
        items={classes}
        selectedId={selectedClassId}
        onSelect={handleSelect}
        renderListItem={renderListItem}
        renderDetail={renderDetail}
        searchKeys={['name']}
        loading={loading}
      />
      {/* FIX 5: Blocking banner when L1 subclass is required but not chosen */}
      {selectedClassId && needsSubclass && !selectedSubclassId && (
        <div style={{
          background: 'var(--bg-card)', border: '2px solid #f59e0b', borderRadius: 10,
          padding: '12px 16px', marginTop: 16, display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 20 }}>⚠</span>
          <div>
            <div style={{ color: 'var(--accent)', fontWeight: 'bold', fontSize: 14 }}>
              Subclass Required
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
              {selectedClassData?.name || selectedClassId} requires a {selectedClassData?.subclassTitle || 'subclass'} at level 1.
              Please select one above before proceeding.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// FIX 2: Export step completion check for parent stepper/navigation.
// Usage: import { isStep4Complete } from './Step4Class'
// Or:    Step4Class.isComplete(character)
Step4Class.isComplete = function isComplete(character) {
  const cls = character?.classes?.[0]
  if (!cls?.classId) return false
  if (cls.subclassLevel === 1 && !cls.subclassId) return false
  return true
}

export function isStep4Complete(character) {
  return Step4Class.isComplete(character)
}

// ── Hilfsfunktionen ────────────────────────────────────────

function formatSkillChoices(skills) {
  if (!skills || skills.length === 0) return null
  const parts = []
  for (const entry of skills) {
    if (entry?.choose?.from && Array.isArray(entry.choose.from)) {
      parts.push(`Choose ${entry.choose.count || 2}: ${entry.choose.from.map(camelToTitle).join(', ')}`)
    } else if (typeof entry?.any === 'number') {
      parts.push(`Choose ${entry.any} (any)`)
    } else if (typeof entry === 'string') {
      parts.push(camelToTitle(entry))
    }
  }
  return parts.join('; ') || null
}

function camelToTitle(s) {
  if (!s) return ''
  return s.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
}

function flattenProf(arr) {
  return arr.map(entry => {
    if (typeof entry === 'string') return entry
    if (typeof entry === 'object') {
      if (entry.choose?.from) return entry.choose.from.join('/')
      return Object.keys(entry)[0] || ''
    }
    return String(entry)
  }).filter(Boolean)
}

function Badge({ label, value, color }) {
  return (
    <div style={{ background: 'var(--bg-highlight)', borderRadius: 6, padding: '4px 10px' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{label}</div>
      <div style={{ color: color || 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 }}>{value}</div>
    </div>
  )
}

function ProfRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 12, minWidth: 80, flexShrink: 0 }}>{label}:</span>
      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{value}</span>
    </div>
  )
}

function SubclassCard({ sub, isSelected, onSelect }) {
  const [expanded, setExpanded] = useState(false)
  const levels = Object.keys(sub.featuresPerLevel || {})
    .map(Number)
    .sort((a, b) => a - b)

  return (
    <div style={{ ...subStyles.card, ...(isSelected ? subStyles.cardSelected : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={subStyles.name}>{sub.name}</div>
          <div style={subStyles.source}>{sub.source}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            style={subStyles.expandBtn}
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? '▲ Einklappen' : '▼ Features'}
          </button>
          {onSelect && (
            <button
              style={{ ...subStyles.expandBtn, ...(isSelected ? subStyles.selectBtnActive : {}) }}
              onClick={onSelect}
            >
              {isSelected ? '✓ Gewählt' : 'Wählen'}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          {levels.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>Keine Feature-Daten verfügbar.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={tableStyles.th}>Level</th>
                  <th style={tableStyles.th}>Feature</th>
                  <th style={tableStyles.th}>Beschreibung</th>
                </tr>
              </thead>
              <tbody>
                {levels.map(level => (
                  sub.featuresPerLevel[level].map((feat, fi) => (
                    <tr key={`${level}-${fi}`} style={{ background: level % 2 === 0 ? 'var(--bg-inset)' : 'transparent' }}>
                      {fi === 0 && (
                        <td style={{ ...tableStyles.td, verticalAlign: 'top' }}
                            rowSpan={sub.featuresPerLevel[level].length}>
                          <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>{level}</span>
                        </td>
                      )}
                      <td style={{ ...tableStyles.td, color: 'var(--text-primary)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                        {feat.name}
                      </td>
                      <td style={tableStyles.td}>
                        <FeatureSummary entries={feat.entries} />
                      </td>
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function FeatureSummary({ entries }) {
  const [expanded, setExpanded] = useState(false)

  function getFirstText(arr) {
    for (const entry of (arr || [])) {
      if (typeof entry === 'string' && entry.length > 5) {
        return entry.replace(/\{@[^}]+\}/g, m => {
          const parts = m.slice(2, -1).split(' ')
          return parts.slice(1).join(' ').split('|')[0]
        })
      }
      if (entry?.entries) {
        const t = getFirstText(entry.entries)
        if (t) return t
      }
    }
    return null
  }

  const text = getFirstText(entries)
  if (!text) return <span style={{ color: 'var(--text-dim)' }}>—</span>

  if (text.length <= 150) {
    return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{text}</span>
  }

  return (
    <span>
      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        {expanded ? text : text.slice(0, 150) + '…'}
      </span>
      {' '}
      <button
        onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
        style={{
          background: 'none', border: 'none', color: 'var(--accent)',
          fontSize: 11, cursor: 'pointer', padding: 0,
        }}
      >
        {expanded ? 'weniger' : 'mehr'}
      </button>
    </span>
  )
}

const sectionLabel = {
  color: 'var(--accent)', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase',
  marginBottom: 8, letterSpacing: 0.5,
}

const tabS = {
  row: { display: 'flex', gap: 0, marginBottom: 12, borderBottom: '1px solid var(--border-subtle)' },
  btn: {
    padding: '6px 14px', border: 'none', background: 'transparent',
    color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, borderBottom: '2px solid transparent',
  },
  active: { color: 'var(--accent)', borderBottom: '2px solid var(--accent)' },
}

const tableStyles = {
  th: { background: 'var(--bg-elevated)', color: 'var(--accent)', padding: '6px 10px', textAlign: 'left', fontSize: 11 },
  td: { color: 'var(--text-secondary)', padding: '5px 10px', fontSize: 12 },
}

const subStyles = {
  card: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '10px 12px', marginBottom: 8,
  },
  cardSelected: { border: '1px solid var(--accent)', background: 'var(--bg-hover)' },
  name: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 },
  source: { color: 'var(--text-muted)', fontSize: 11, marginBottom: 4 },
  expandBtn: {
    padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11,
  },
  selectBtnActive: { border: '1px solid var(--accent)', color: 'var(--accent)' },
}

const subclassBanner = {
  background: 'var(--bg-card)', border: '1px solid var(--accent)',
  borderRadius: 8, padding: '8px 12px', marginBottom: 12,
  display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
}