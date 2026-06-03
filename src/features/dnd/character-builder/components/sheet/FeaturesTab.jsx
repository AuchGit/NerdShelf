// components/sheet/FeaturesTab.jsx
// Species / background / class skills / feats — reference display.

import { useState, useEffect, useMemo } from 'react'
import EntryRenderer from '../ui/EntryRenderer'
import FiveEToolsLink from '../ui/FiveEToolsLink'
import { Section, TraitPill, CardColorPicker } from './SheetKit'
import { getColorMarker, setColorMarker, colorStripeStyle } from '../../lib/cardColors'
import { getCustomNote, setCustomNote } from '../../lib/customNotes'
import { DEFAULT_PILL_COLORS } from '../../lib/pillColors'
import { S } from './sheetStyles'
import { formatToolName, formatSkillName } from '../../lib/sheetUtils'
import { parseFeatureChoices } from '../../lib/choiceParser'
import { favoriteKey } from '../../lib/favorites'
import { FavoriteToggle } from './OverviewTab'
import { parseFeatureEffect } from '../../lib/featureEffectParser'
import { DAMAGE_TYPE_COLOR } from '../../lib/spellEffectParser'

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

export default function FeaturesTab({ character, updateCharacter, applyCharacter, expanded, setExpanded }) {
  const featBonuses = getFeatBonusSummary(character)
  const [featDataMap, setFeatDataMap] = useState({})
  const [expandedFeat, setExpandedFeat] = useState(null)
  // ExpandedSet wird vom Parent geliefert (CharacterSheetPage hält den
  // Set damit er Tab-Switches überlebt). Fallback auf lokalen State
  // wenn die Props mal nicht gesetzt sind (z.B. anderer Aufrufer in
  // der GM-Session-Ansicht).
  const [localExpanded, setLocalExpanded] = useState(() => new Set())
  const expandedSet = expanded || localExpanded
  const toggleExpand = (key) => {
    const next = new Set(expandedSet)
    if (next.has(key)) next.delete(key); else next.add(key)
    if (setExpanded) setExpanded(next); else setLocalExpanded(next)
  }

  // Unresolved subclass-feature choices. CharacterSheetPage attaches
  // `character.__activeFeatures` = [{name, entries, classId, …}]; we
  // run each through parseFeatureChoices and surface any that the
  // player hasn't decided yet. The picker writes to
  // `cls.featureChoices[featureName]` which computeProficiencies
  // applies on the next compute pass.
  //
  // Expertise pickers have dynamic options (the character's current
  // skill proficiencies) so we resolve them here against the current
  // skill set; everything else uses the static `options` list the
  // parser returned.
  const proficientSkillsByClass = useMemo(() => {
    // We don't have computed here, so derive from the proficiency
    // tags on character.classes / background / race the same way the
    // engine would aggregate. Keep this scoped to anything the parent
    // already knows about: chosen class skills, expertise picks
    // already made, background skills, and the catch-all per-feature
    // choices.
    const set = new Set()
    for (const s of (character.background?.skillProficiencies || [])) set.add(s)
    for (const cls of (character.classes || [])) {
      for (const lc of Object.values(cls.levelChoices || {})) {
        for (const s of (lc.skillProficiencies || [])) set.add(s)
      }
    }
    for (const [k, v] of Object.entries(character.choices || {})) {
      if (!k.includes(':skill:')) continue
      const arr = Array.isArray(v) ? v : [v]
      for (const s of arr) if (s) set.add(s)
    }
    return [...set]
  }, [character])

  // Resolved-state map keyed by the choice descriptor's id so the
  // same-named feature at different class levels (Bard Expertise
  // L3 + L10, Rogue Expertise L1 + L6) doesn't share a slot. Storage
  // path on the character is `cls.featureChoices[choice.id]`.
  const unresolvedChoices = useMemo(() => {
    const list = []
    const features = character?.__activeFeatures || []
    for (const f of features) {
      const choices = parseFeatureChoices(f)
      if (choices.length === 0) continue
      const cls = (character.classes || []).find(c => c.classId === f.classId)
      const stored = cls?.featureChoices || {}
      for (const ch of choices) {
        const current = stored[ch.id]
        if (ch.type === 'expertise') {
          if (current?.id === ch.id && Array.isArray(current.value)
              && current.value.length >= ch.count) continue
        } else {
          if (current?.id === ch.id && current.value != null) continue
        }
        list.push({ classId: f.classId, featureName: f.name, level: f.level, choice: ch, current: current || null })
      }
    }
    return list
  }, [character])

  function setFeatureChoice(classId, choiceDescriptor, value) {
    const idx = (character.classes || []).findIndex(c => c.classId === classId)
    if (idx < 0) return
    updateCharacter(`classes.${idx}.featureChoices.${choiceDescriptor.id}`, {
      id: choiceDescriptor.id,
      type: choiceDescriptor.type,
      value,
    })
  }

  function toggleExpertise(classId, choiceDescriptor, skill, currentArr) {
    const cur = Array.isArray(currentArr) ? [...currentArr] : []
    const has = cur.includes(skill)
    if (has) {
      const next = cur.filter(s => s !== skill)
      setFeatureChoice(classId, choiceDescriptor, next)
      return
    }
    if (cur.length >= choiceDescriptor.count) return
    setFeatureChoice(classId, choiceDescriptor, [...cur, skill])
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

  // Pull the active background's `entries` so we can render its
  // feature text inline. 5e backgrounds have a named feature
  // (Soldier → Military Rank, Acolyte → Shelter of the Faithful);
  // 5.5e backgrounds replaced that with an Origin Feat — both end up
  // here as collapsible cards driven by whatever the data file
  // declares.
  const [bgEntries, setBgEntries] = useState(null)
  useEffect(() => {
    let cancelled = false
    async function load() {
      const id = character.background?.backgroundId
      if (!id) { setBgEntries(null); return }
      const { loadBackgroundList } = await import('../../lib/dataLoader')
      const list = await loadBackgroundList(character.meta?.edition || '5e')
      if (cancelled) return
      const match = list.find(b => b.id === id || b.name === id.split('__')[0])
      setBgEntries(match?.entries || null)
    }
    load()
    return () => { cancelled = true }
  }, [character.meta?.edition, character.background?.backgroundId])

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
          {unresolvedChoices.map(({ classId, featureName, level, choice, current }) => (
            <div key={`${classId}-${choice.id}`} style={S.featureCard}>
              <div style={S.featureCardHeader}>
                <div style={S.featureCardName}>
                  {featureName}{level ? ` (Lv ${level})` : ''}
                </div>
                <div style={S.featureCardSource}>{classId}</div>
              </div>
              <div style={S.featureCardBody}>
                <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 6 }}>
                  {choice.label}
                </div>
                {choice.type === 'expertise' ? (
                  // Expertise picker: options come from the character's
                  // currently-proficient skills (you can only Expert
                  // something you're already Proficient in). Multi-
                  // select up to `choice.count`. Empty list → show a
                  // hint so the player knows why nothing's clickable.
                  proficientSkillsByClass.length === 0 ? (
                    <div style={{ color: 'var(--text-dim)', fontSize: 12, fontStyle: 'italic' }}>
                      Keine Skill-Proficiencies gefunden — wähle erst Klassen-Skills.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {proficientSkillsByClass.map(skill => {
                        const curArr = Array.isArray(current?.value) ? current.value : []
                        const isSel = curArr.includes(skill)
                        const atCap = !isSel && curArr.length >= choice.count
                        return (
                          <button key={skill} type="button"
                            disabled={atCap}
                            onClick={() => toggleExpertise(classId, choice, skill, curArr)}
                            style={{
                              padding: '4px 10px', borderRadius: 999, fontSize: 12,
                              cursor: atCap ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                              opacity: atCap ? 0.4 : 1,
                              background: isSel ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'transparent',
                              border: `1px solid ${isSel ? 'var(--accent)' : 'var(--border)'}`,
                              color: isSel ? 'var(--accent)' : 'var(--text-secondary)',
                            }}>
                            {isSel && '✓ '}{formatSkillName(skill)}
                          </button>
                        )
                      })}
                    </div>
                  )
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {choice.options.map(opt => {
                      const isSel = current?.value === opt.value
                      return (
                        <button key={opt.value} type="button"
                          onClick={() => setFeatureChoice(classId, choice, opt.value)}
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
                )}
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

            {/* Full race + subrace trait list, collapsible. Hydrated
                by CharacterSheetPage's loadRaceTraits — the source of
                truth that drives the synthetic note scanner too. */}
            {(character.species.__traits || []).length > 0 && (
              <div style={{ marginTop: 12 }}>
                {character.species.__traits.map(tr => {
                  const key = `sp-${tr.name}`
                  return (
                    <ExpandableEntryCard
                      key={key}
                      title={tr.name}
                      entries={tr.entries}
                      favKey={favoriteKey('trait', tr.name)}
                      character={character}
                      applyCharacter={applyCharacter}
                      edition={character.meta?.edition}
                      fiveeLink={raceName && character.species.source
                        ? { kind: 'race', name: raceName, source: character.species.source }
                        : null}
                      expandKey={key}
                      isExpanded={expandedSet.has(key)}
                      onToggle={toggleExpand}
                    />
                  )
                })}
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

            {/* Background feature blocks — 5etools nests them as
                `{ name, type: 'entries', entries: […] }` items inside
                the top-level `entries` array, e.g. Soldier's "Feature:
                Military Rank". 5.5e backgrounds skip these in favour
                of the Origin Feat (rendered in the Feats section). */}
            {Array.isArray(bgEntries) && (() => {
              const features = bgEntries.filter(e =>
                e && typeof e === 'object' && e.type === 'entries' && e.name && Array.isArray(e.entries)
              )
              if (features.length === 0) return null
              return (
                <div style={{ marginTop: 12 }}>
                  {features.map((feat, i) => {
                    const cleanName = feat.name.replace(/^Feature:\s*/i, '')
                    const key = `bg-${feat.name}-${i}`
                    return (
                      <ExpandableEntryCard
                        key={key}
                        title={cleanName}
                        entries={feat.entries}
                        favKey={favoriteKey('feature', `Background:${cleanName}:`)}
                        character={character}
                        applyCharacter={applyCharacter}
                        edition={character.meta?.edition}
                        fiveeLink={bgId && character.background.source
                          ? { kind: 'background', name: bgId, source: character.background.source }
                          : null}
                        expandKey={key}
                        isExpanded={expandedSet.has(key)}
                        onToggle={toggleExpand}
                      />
                    )
                  })}
                </div>
              )
            })()}
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

      {/* ── Class & Subclass Features ── */}
      {/* Hydrated into character.__activeFeatures by CharacterSheetPage's
          collectActiveClassFeatures pass (XPHB-preferred for 5.5e). One
          collapsible card per feature so the player can read the rule
          text on demand without leaving the sheet. */}
      {(() => {
        const features = character?.__activeFeatures || []
        if (features.length === 0) return null
        const byClass = new Map()
        for (const f of features) {
          const k = f.classId || '—'
          if (!byClass.has(k)) byClass.set(k, [])
          byClass.get(k).push(f)
        }
        for (const list of byClass.values()) {
          list.sort((a, b) => (a.level || 0) - (b.level || 0) || a.name.localeCompare(b.name))
        }
        return (
          <Section title="Class Features">
            {[...byClass.entries()].map(([classId, list]) => (
              <div key={classId} style={{ marginBottom: 12 }}>
                <div style={S.featureCardSource}>{classId}</div>
                {list.map(f => {
                  const key = `cf-${classId}-${f.name}-${f.level || 0}`
                  return (
                    <ExpandableEntryCard
                      key={key}
                      title={f.name}
                      badge={f.level ? `Lv ${f.level}` : null}
                      entries={f.entries}
                      favKey={favoriteKey('feature', `${classId}:${f.name}:${f.level || ''}`)}
                      character={character}
                      applyCharacter={applyCharacter}
                      edition={character.meta?.edition}
                      fiveeLink={f.source
                        ? { kind: 'class', name: classId, source: f.source }
                        : null}
                      classId={classId}
                      level={f.level || null}
                      expandKey={key}
                      isExpanded={expandedSet.has(key)}
                      onToggle={toggleExpand}
                    />
                  )
                })}
              </div>
            ))}
          </Section>
        )
      })()}

      {/* ── Feats ── */}
      {(featBonuses.length > 0 || (character.custom?.feats || []).length > 0) && (
        <Section title="Feats">
          {featBonuses.map((feat, i) => {
            const fd = featDataMap[feat.name]
            const isExpanded = expandedFeat === feat.name
            return (
              <div key={i} style={S.featCard}>
                <div style={S.featCardHeader} onClick={() => setExpandedFeat(isExpanded ? null : feat.name)}>
                  <div style={{ ...S.featCardName, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <FavoriteToggle
                      favKey={favoriteKey('feat', feat.name)}
                      character={character}
                      applyCharacter={applyCharacter}
                    />
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

// Collapsible card showing a feature name and (when expanded) its
// 5etools-style entries rendered to HTML. Used for class features and
// species traits so the player can pull the rule text inline without
// jumping to an external reference.
function ExpandableEntryCard({
  title, entries, badge, favKey, character, applyCharacter, fiveeLink, edition,
  expandKey, isExpanded, onToggle,
  classId, level,
}) {
  // Smart-Pill-Extraktion: dieselben Pills die schon in der Action-
  // Spalte gerendert werden — Trigger / Damage / Uses / Class-Level-
  // skalierte Dice — werden auch im Features-Tab als Quick-Glance-
  // Info im Card-Header gezeigt. Datengetrieben aus den entries,
  // kein Featurename hardcoded.
  const fx = parseFeatureEffect(
    { name: title, entries, classId: classId || null, level: level || null },
    character,
    Math.ceil(((character?.classes || []).reduce((s, c) => s + (c.level || 0), 0)) / 4) + 1,
  )
  // Wenn der Parent expandKey + isExpanded + onToggle gibt, läuft der
  // Toggle gegen den Parent-State (überlebt Tab-Wechsel). Sonst
  // fallback auf lokalen State (z.B. wenn die Card im GM-Session-
  // Sheet ohne Parent-Set verwendet wird).
  const [localOpen, setLocalOpen] = useState(false)
  const controlled = !!expandKey && typeof onToggle === 'function'
  const open = controlled ? !!isExpanded : localOpen
  const setOpen = controlled
    ? () => onToggle(expandKey)
    : (next) => setLocalOpen(typeof next === 'function' ? next(localOpen) : next)
  const hasBody = Array.isArray(entries) && entries.length > 0
  // Color-Marker: persistiert über favKey (gleicher composite-Key
  // wie Favoriten — so kann derselbe Feature-Eintrag gleichzeitig
  // gefavt UND farbgetaggt werden).
  const markerKey = favKey || null
  const markerColor = markerKey ? getColorMarker(character, markerKey) : null
  // Custom-Note (Pill-Text + Pill-Color + optional Notes-Body).
  const note = markerKey ? getCustomNote(character, markerKey) : null
  const [viewMode, setViewMode] = useState('desc')
  const notePillColor = note?.pillColor || markerColor || 'var(--accent)'
  return (
    <div style={{ ...S.featCard, ...(colorStripeStyle(markerColor) || {}) }}>
      <div
        style={{ ...S.featCardHeader, cursor: hasBody ? 'pointer' : 'default' }}
        onClick={() => hasBody && setOpen(o => !o)}
      >
        <div style={{ ...S.featCardName, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {favKey && (
            <FavoriteToggle favKey={favKey} character={character} applyCharacter={applyCharacter} />
          )}
          {title}
          {badge && (
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-dim)' }}>{badge}</span>
          )}
          {/* Smart-Pills aus parseFeatureEffect — gleiche Form wie in
              der Action-Spalte (Trigger / Damage / Uses). Werden hier
              im Card-Header gezeigt damit der Spieler die wichtigsten
              Mechanik-Eckdaten lesen kann ohne aufzuklappen. */}
          {Array.isArray(fx?.pills) && fx.pills.map(p => {
            const color = p.kind === 'trigger'
              ? 'var(--accent-yellow)'
              : p.kind === 'uses'
                ? 'var(--accent-green)'
                : (p.damageType && DAMAGE_TYPE_COLOR[p.damageType]) || 'var(--accent-red)'
            return (
              <span key={`fx-${p.kind}-${p.label}`} title={p.title} style={{
                fontSize: 10, fontWeight: 700, padding: '1px 7px',
                borderRadius: 999, marginLeft: 6,
                border: `1px solid ${color}`,
                color,
                background: `color-mix(in srgb, ${color} 10%, transparent)`,
                whiteSpace: 'nowrap',
              }}>
                {p.label}
              </span>
            )
          })}
          {/* Custom-Note-Pille — vom Player gesetzter Hinweis in
              Form einer farbigen Pille im Card-Header. Persistiert
              via setCustomNote → character.customNotes[markerKey]. */}
          {note?.pillText && (
            <span style={{
              padding: '1px 6px', borderRadius: 4,
              fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
              border: `1px solid ${notePillColor}`,
              color: notePillColor,
              background: `color-mix(in srgb, ${notePillColor} 14%, transparent)`,
              marginLeft: 6, whiteSpace: 'nowrap',
            }}
            title={note.pillText}>{note.pillText}</span>
          )}
          {hasBody && (
            <span style={{ color: 'var(--text-dim)', fontSize: 11, marginLeft: 6 }}>
              {open ? '▲' : '▼'}
            </span>
          )}
        </div>
      </div>
      {open && (hasBody || markerKey) && (
        <div
          style={{ marginTop: 8, padding: '10px 14px', background: 'var(--bg-inset)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Desc/Notes-Toggle. Klein und kompakt, kein Emoji — nur
              Text-Labels. Hidden wenn keine entries vorhanden sind
              (dann ist immer notes der einzige sinnvolle View). */}
          {markerKey && hasBody && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
              <div style={viewToggleWrap}>
                <button type="button"
                  onClick={() => setViewMode('desc')}
                  style={viewToggleBtn(viewMode === 'desc')}>Desc</button>
                <button type="button"
                  onClick={() => setViewMode('notes')}
                  style={viewToggleBtn(viewMode === 'notes')}>Notes</button>
              </div>
            </div>
          )}
          {viewMode === 'desc' && hasBody && <EntryRenderer entries={entries} />}
          {(viewMode === 'notes' || !hasBody) && markerKey && (
            <textarea
              value={note?.body || ''}
              placeholder="Deine Notizen zu diesem Eintrag …"
              onChange={(e) => setCustomNote(applyCharacter, markerKey, { body: e.target.value })}
              style={{
                width: '100%', minHeight: 90,
                padding: '6px 8px', fontSize: 12, lineHeight: 1.45,
                background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)', borderRadius: 6,
                fontFamily: 'inherit', resize: 'vertical',
              }}
            />
          )}
          {/* Pill-Editor: kurzer Hinweis-Text + Farbe. Farbe kann
              entweder eine der Settings-Farben oder ein custom-hex
              sein (über CardColorPicker, der die TAG_COLORS-Palette
              anbietet). Drei kleine Inputs in einer Zeile. */}
          {markerKey && (
            <div style={{
              marginTop: 10, display: 'flex',
              alignItems: 'center', gap: 8, flexWrap: 'wrap',
              paddingTop: 8, borderTop: '1px dashed var(--border-subtle)',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pill:</span>
              <input
                type="text"
                value={note?.pillText || ''}
                placeholder="kurzer Hinweis"
                onChange={(e) => setCustomNote(applyCharacter, markerKey, { pillText: e.target.value })}
                style={{
                  flex: 1, minWidth: 100, padding: '3px 8px', fontSize: 11,
                  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)', borderRadius: 4,
                  fontFamily: 'inherit',
                }}
              />
              <input
                type="color"
                value={note?.pillColor || markerColor || '#888888'}
                onChange={(e) => setCustomNote(applyCharacter, markerKey, { pillColor: e.target.value })}
                title="Pill-Farbe"
                style={{
                  width: 24, height: 22, padding: 0,
                  background: 'transparent',
                  border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Stripe:</span>
              <CardColorPicker
                color={markerColor}
                onChange={(c) => setColorMarker(applyCharacter, markerKey, c)}
                compact
              />
              {fiveeLink && (
                <span style={{ marginLeft: 'auto' }}>
                  <FiveEToolsLink {...fiveeLink} edition={edition} compact />
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// View-Toggle-Styles fuer den Desc/Notes-Switch im Expanded-Body.
// Kompakt, symbol-frei (nur Text-Labels), Settings-konsistent.
const viewToggleWrap = {
  display: 'inline-flex',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  overflow: 'hidden',
}
function viewToggleBtn(active) {
  return {
    padding: '2px 8px', fontSize: 10, fontWeight: 700,
    letterSpacing: 0.3, textTransform: 'uppercase',
    background: active ? 'var(--color-surface, var(--bg-card))' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
  }
}
