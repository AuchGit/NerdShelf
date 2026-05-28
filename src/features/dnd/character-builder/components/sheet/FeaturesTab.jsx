// components/sheet/FeaturesTab.jsx
// Species / background / class skills / feats — reference display.

import { useState, useEffect, useMemo } from 'react'
import EntryRenderer from '../ui/EntryRenderer'
import FiveEToolsLink from '../ui/FiveEToolsLink'
import { Section, TraitPill } from './SheetKit'
import { S } from './sheetStyles'
import { formatToolName, formatSkillName } from '../../lib/sheetUtils'
import { parseFeatureChoices } from '../../lib/choiceParser'

function getFeatBonusSummary(character) {
  const result = []
  for (const feat of (character.feats || [])) {
    // "Origin" badge in the list = either the race-granted feat (5e
    // Variant Human style, stored as _isOriginFeat) OR the 5.5e
    // background feat (stored via chosenAt.source === 'background'
    // by Step5Background). Both are taken at character creation and
    // are conceptually the same slot.
    const isOrigin = !!feat._isOriginFeat || feat.chosenAt?.source === 'background'
    const entry = { name: feat.featId, source: feat.source, isOrigin, bonuses: [], spells: [] }
    for (const [key, val] of Object.entries(feat.abilityBonus || {})) {
      if (val) entry.bonuses.push(`+${val} ${key.toUpperCase()}`)
    }
    for (const [key, val] of Object.entries(feat.choices?.abilityBonus || {})) {
      if (val) entry.bonuses.push(`+${val} ${key.toUpperCase()}`)
    }
    const spells = feat.choices?.spells || []
    if (spells.length > 0) {
      entry.spells = spells.map(s => typeof s === 'string' ? s : s?.name).filter(Boolean)
    }
    result.push(entry)
  }
  return result
}

const SIZE_LABELS = { M: 'Medium', S: 'Small', L: 'Large', T: 'Tiny', H: 'Huge' }

export default function FeaturesTab({ character, updateCharacter }) {
  const featBonuses = getFeatBonusSummary(character)
  const [featDataMap, setFeatDataMap] = useState({})
  const [expandedFeat, setExpandedFeat] = useState(null)

  // Unresolved subclass-feature choices. CharacterSheetPage attaches
  // `character.__activeFeatures` = [{name, entries, classId, …}]; we
  // run each through parseFeatureChoices and surface any that the
  // player hasn't decided yet. The picker writes to
  // `cls.featureChoices[featureName]` which computeProficiencies
  // applies on the next compute pass.
  const unresolvedChoices = useMemo(() => {
    const list = []
    const features = character?.__activeFeatures || []
    for (const f of features) {
      const choices = parseFeatureChoices(f)
      if (choices.length === 0) continue
      const cls = (character.classes || []).find(c => c.classId === f.classId)
      const stored = cls?.featureChoices || {}
      for (const ch of choices) {
        const current = stored[f.name]
        if (current && current.id === ch.id) continue
        list.push({ classId: f.classId, featureName: f.name, choice: ch, current: current || null })
      }
    }
    return list
  }, [character])

  function setFeatureChoice(classId, featureName, choiceDescriptor, value) {
    const idx = (character.classes || []).findIndex(c => c.classId === classId)
    if (idx < 0) return
    updateCharacter(`classes.${idx}.featureChoices.${featureName}`, {
      id: choiceDescriptor.id,
      type: choiceDescriptor.type,
      value,
    })
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { loadFeatList } = await import('../../lib/dataLoader')
      const feats = await loadFeatList(character.meta?.edition || '5e')
      if (cancelled) return
      const map = {}
      for (const f of feats) map[f.name] = f
      setFeatDataMap(map)
    }
    load()
    return () => { cancelled = true }
  }, [character.meta?.edition])

  const raceName = character.species.raceId?.split('__')[0] || '—'
  const subraceName = character.species.subraceId?.split('__')[0] || ''
  const bgId = character.background.backgroundId?.split('__')[0] || '—'
  const cls = character.classes[0]

  return (
    <div className="dnd-sheet-tab-body" style={S.tabBody}>
      {/* ── Open class/subclass feature choices ──
          Fey Wanderer's "pick a skill", Gloom Stalker's "Iron Mind",
          and every similar 5.5e pattern. The picker surfaces here so
          a character whose subclass got selected before the picker
          existed can resolve their missing choices without going
          back through level-up. */}
      {updateCharacter && unresolvedChoices.length > 0 && (
        <Section title="Offene Entscheidungen">
          {unresolvedChoices.map(({ classId, featureName, choice, current }) => (
            <div key={`${classId}-${featureName}-${choice.id}`} style={S.featureCard}>
              <div style={S.featureCardHeader}>
                <div style={S.featureCardName}>{featureName}</div>
                <div style={S.featureCardSource}>{classId}</div>
              </div>
              <div style={S.featureCardBody}>
                <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 6 }}>
                  {choice.label}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {choice.options.map(opt => {
                    const isSel = current?.value === opt.value
                    return (
                      <button key={opt.value} type="button"
                        onClick={() => setFeatureChoice(classId, featureName, choice, opt.value)}
                        style={{
                          padding: '4px 10px', borderRadius: 999, fontSize: 12,
                          cursor: 'pointer', fontFamily: 'inherit',
                          background: isSel ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'transparent',
                          border: `1px solid ${isSel ? 'var(--accent)' : 'var(--border)'}`,
                          color: isSel ? 'var(--accent)' : 'var(--text-secondary)',
                        }}>
                        {isSel && '✓ '}{opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* ── Species ── */}
      <Section title="Species">
        <div style={S.featureCard}>
          <div style={S.featureCardHeader}>
            <div style={S.featureCardName}>{raceName}{subraceName ? ` — ${subraceName}` : ''}</div>
            {character.species.source && <div style={S.featureCardSource}>{character.species.source}</div>}
          </div>
          <div style={S.featureCardBody}>
            <div style={S.traitGrid}>
              {character.species.speed && <TraitPill label="Speed" value={`${character.species.speed} ft.`} />}
              {character.species.size && (
                <TraitPill label="Size" value={SIZE_LABELS[character.species.size] || character.species.size} />
              )}
              {character.species.darkvision && <TraitPill label="Darkvision" value={`${character.species.darkvision} ft.`} />}
              {character.species.naturalArmor && <TraitPill label="Natural Armor" value="Yes" />}
            </div>

            {character.species.abilityScoreImprovements &&
              Object.values(character.species.abilityScoreImprovements).some(v => v !== 0) && (
              <div style={S.asiBlock}>
                <div style={S.asiLabel}>Ability bonuses:</div>
                <div style={S.asiValues}>
                  {Object.entries(character.species.abilityScoreImprovements)
                    .filter(([, v]) => v !== 0)
                    .map(([k, v]) => (
                      <span key={k} style={S.asiBadge}>{v > 0 ? '+' : ''}{v} {k.toUpperCase()}</span>
                    ))}
                </div>
              </div>
            )}

            {character.species.extraLanguages?.length > 0 && (
              <div style={S.traitLine}>
                <span style={S.traitLineLabel}>Extra languages:</span>
                <span style={S.traitLineValue}>{character.species.extraLanguages.join(', ')}</span>
              </div>
            )}

            {(character.species.raceSpells?.length > 0 || character.species.subraceSpells?.length > 0) && (
              <div style={S.traitLine}>
                <span style={S.traitLineLabel}>Species spells:</span>
                <span style={S.traitLineValue}>
                  {[...(character.species.raceSpells || []), ...(character.species.subraceSpells || [])]
                    .map(s => typeof s === 'string' ? s : s?.name).filter(Boolean).join(', ')}
                </span>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ── Background ── */}
      <Section title="Background">
        <div style={S.featureCard}>
          <div style={S.featureCardHeader}>
            <div style={S.featureCardName}>{bgId}</div>
            {character.background.source && <div style={S.featureCardSource}>{character.background.source}</div>}
          </div>
          <div style={S.featureCardBody}>
            {character.background.skillProficiencies?.length > 0 && (
              <div style={S.traitLine}>
                <span style={S.traitLineLabel}>Skills:</span>
                <span style={S.traitLineValue}>
                  {character.background.skillProficiencies.map(s => formatSkillName(s)).join(', ')}
                </span>
              </div>
            )}
            {character.background.toolProficiencies?.length > 0 && (
              <div style={S.traitLine}>
                <span style={S.traitLineLabel}>Tools:</span>
                <span style={S.traitLineValue}>
                  {character.background.toolProficiencies.map(formatToolName).join(', ')}
                </span>
              </div>
            )}
            {character.background.languages?.length > 0 && (
              <div style={S.traitLine}>
                <span style={S.traitLineLabel}>Languages:</span>
                <span style={S.traitLineValue}>{character.background.languages.join(', ')}</span>
              </div>
            )}
            {character.background.feat && (
              <div style={S.traitLine}>
                <span style={S.traitLineLabel}>Origin feat:</span>
                <span style={{ ...S.traitLineValue, color: 'var(--accent-purple)' }}>
                  {character.background.feat.name || character.background.feat}
                </span>
              </div>
            )}
            {character.background.abilityScoreImprovements &&
              Object.values(character.background.abilityScoreImprovements).some(v => v !== 0) && (
              <div style={S.asiBlock}>
                <div style={S.asiLabel}>Ability bonuses (background):</div>
                <div style={S.asiValues}>
                  {Object.entries(character.background.abilityScoreImprovements)
                    .filter(([, v]) => v !== 0)
                    .map(([k, v]) => (
                      <span key={k} style={{ ...S.asiBadge, background: 'var(--bg-hover)', borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}>
                        {v > 0 ? '+' : ''}{v} {k.toUpperCase()}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ── Class skills ── */}
      {cls && (
        <Section title={`Class Choices (${cls.classId})`}>
          {cls.levelChoices?.[1]?.skillProficiencies?.length > 0 && (
            <div style={S.traitLine}>
              <span style={S.traitLineLabel}>Chosen skills:</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {cls.levelChoices[1].skillProficiencies.map((skill, i) => (
                  <span key={i} style={S.skillBadge}>{formatSkillName(skill)}</span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* ── Feats ── */}
      {(featBonuses.length > 0 || (character.custom?.feats || []).length > 0) && (
        <Section title="Feats">
          {featBonuses.map((feat, i) => {
            const fd = featDataMap[feat.name]
            const isExpanded = expandedFeat === feat.name
            return (
              <div key={i} style={S.featCard}>
                <div style={S.featCardHeader} onClick={() => setExpandedFeat(isExpanded ? null : feat.name)}>
                  <div style={S.featCardName}>
                    {feat.isOrigin && <span style={S.originTag}>ORIGIN</span>}
                    {feat.name}
                    <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {feat.source && (
                      <span onClick={(e) => e.stopPropagation()}>
                        <FiveEToolsLink kind="feat" name={feat.name} source={feat.source} edition={character.meta?.edition} compact />
                      </span>
                    )}
                    <div style={S.featCardSource}>{feat.source}</div>
                  </div>
                </div>
                {(feat.bonuses.length > 0 || feat.spells.length > 0) && (
                  <div style={S.featCardBonuses}>
                    {feat.bonuses.map((b, j) => <span key={j} style={S.featBonusBadge}>{b}</span>)}
                    {feat.spells.map((sp, j) => (
                      <span key={`sp${j}`} style={{ ...S.featBonusBadge, borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>{sp}</span>
                    ))}
                  </div>
                )}
                {isExpanded && fd?.entries && (
                  <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--bg-inset)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                    <EntryRenderer entries={fd.entries} />
                  </div>
                )}
              </div>
            )
          })}

          {(character.custom?.feats || []).map(feat => {
            const isExpanded = expandedFeat === `custom_${feat._id}`
            const bonuses = Object.entries(feat.abilityBonus || {}).map(([a, v]) => `${a.toUpperCase()} +${v}`)
            return (
              <div key={feat._id} style={S.featCard}>
                <div style={S.featCardHeader} onClick={() => setExpandedFeat(isExpanded ? null : `custom_${feat._id}`)}>
                  <div style={S.featCardName}>
                    <span style={S.originTag}>CUSTOM</span>
                    {feat.name}
                    <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                  <div style={S.featCardSource}>{feat.source || 'Custom'}</div>
                </div>
                {bonuses.length > 0 && (
                  <div style={S.featCardBonuses}>
                    {bonuses.map((b, j) => <span key={j} style={S.featBonusBadge}>{b}</span>)}
                  </div>
                )}
                {isExpanded && feat.description && (
                  <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--bg-inset)', borderRadius: 8, border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
                    {feat.description}
                  </div>
                )}
              </div>
            )
          })}
        </Section>
      )}
    </div>
  )
}
