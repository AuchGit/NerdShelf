import { useState, useEffect, useMemo } from 'react'
import { loadBackgroundList, loadFeatList } from '../../../lib/dataLoader'
import { useLanguage } from '../../../lib/i18n'
import BrowsePanel from '../../ui/BrowsePanel'
import EntryRenderer from '../../ui/EntryRenderer'
import FiveEToolsLink from '../../ui/FiveEToolsLink'
import HoverDetailTooltip from '../../ui/HoverDetailTooltip'

// Extrahiert Skill-Namen aus 5etools skillProficiencies format
function extractSkills(skillProfs) {
  const names = []
  for (const entry of (skillProfs || [])) {
    if (typeof entry === 'object') {
      for (const [key, val] of Object.entries(entry)) {
        if (val === true && key !== 'choose') names.push(key)
      }
    }
  }
  return names
}

// Extrahiert Tool-Namen aus 5etools toolProficiencies format
// Format: [{"thieves' tools": true}] oder [{"artisan's tools": {"choose": {...}}}]
function extractTools(toolProfs) {
  const names = []
  for (const entry of (toolProfs || [])) {
    if (typeof entry === 'string') {
      names.push(entry)
      continue
    }
    if (typeof entry === 'object') {
      for (const [key, val] of Object.entries(entry)) {
        if (key === 'choose') continue
        // val === true → feste Proficiency
        if (val === true) {
          names.push(key)
        } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          // z.B. {"artisan's tools": {"choose": {count:1, from:[...]}}}
          // Nur hinzufügen wenn kein "choose" → feste Vergabe
          if (!val.choose) names.push(key)
        }
      }
    }
  }
  return names
}

export default function Step5Background({ character, updateCharacter }) {
  const { t } = useLanguage()
  const [backgrounds, setBackgrounds] = useState([])
  const [loading, setLoading] = useState(true)
  // Feat-Catalog lazy: brauchen wir für (a) Hover-Tooltip auf dem Feat-
  // Namen im Detail-Panel und (b) den Choice-Picker unter dem Picker
  // wenn das Background-Feat (5.5e) Skill/Tool/Language/Ability-
  // Auswahlen verlangt.
  const [allFeats, setAllFeats] = useState([])

  useEffect(() => {
    setLoading(true)
    loadBackgroundList(character.meta.edition).then(data => {
      setBackgrounds(data)
      setLoading(false)
    })
    loadFeatList(character.meta.edition).then(fs => setAllFeats(fs || []))
      .catch(() => setAllFeats([]))
  }, [character.meta.edition])

  // Map: lower(name) → feat-Datensatz (für Hover + Choice-Picker)
  const featByName = useMemo(() => {
    const m = new Map()
    for (const f of (allFeats || [])) {
      if (f?.name) m.set(String(f.name).toLowerCase(), f)
    }
    return m
  }, [allFeats])

  function handleSelect(bg) {
    updateCharacter('background.backgroundId', bg.id)
    updateCharacter('background.source', bg.source)
    updateCharacter('background.skillProficiencies', extractSkills(bg.skillProficiencies))
    updateCharacter('background.toolProficiencies', extractTools(bg.toolProficiencies))

    // ── Fixed languages from background ─────────────────────────────────
    const fixedLangs = []
    for (const entry of (bg.languageProficiencies || [])) {
      if (!entry || typeof entry !== 'object') continue
      for (const [k, v] of Object.entries(entry)) {
        if (v === true && k !== 'choose' && k !== 'any' && k !== 'anyStandard') fixedLangs.push(k)
      }
    }
    updateCharacter('background.languages', fixedLangs)

    // ── Background ASI (5.5e): reset on bg change so user re-picks ──────
    updateCharacter('background.abilityScoreImprovements', {})
    updateCharacter('background.asiWeightedMode', 0)
    updateCharacter('background.asiWeightedPicks', {})

    // ── Background feat (5.5e): store ref AND add to character.feats[] ───
    // bg.feats is e.g. [{ name: "Savage Attacker", source: "XPHB" }]
    const bgFeat = bg.feats?.[0] || null
    const oldBgFeat = (character.feats || []).find(f => f.chosenAt?.source === 'background')
    updateCharacter('background.feat', bgFeat)
    // Remove any previously added background-sourced feat, then add the new one
    const featsWithoutBg = (character.feats || []).filter(f => f.chosenAt?.source !== 'background')
    if (bgFeat?.name) {
      updateCharacter('feats', [...featsWithoutBg, {
        featId: bgFeat.name,
        source: bgFeat.source || bg.source,
        chosenAt: { level: 1, source: 'background' },
        _isOriginFeat: false,
        abilityBonus: {},
        choices: {},
        additionalSpells: [],
      }])
    } else {
      updateCharacter('feats', featsWithoutBg)
    }

    // Clear old feat choices when background changes
    updateCharacter('background.featChoices', {})

    // ── Cleanup stale background:* AND old bg feat:* choice keys ────────
    const oldFeatPrefix = oldBgFeat
      ? `feat:${(oldBgFeat.featId || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}:`
      : null
    const cleaned = Object.fromEntries(
      Object.entries(character.choices || {}).filter(([k]) => {
        if (k.startsWith('background:')) return false
        if (oldFeatPrefix && k.startsWith(oldFeatPrefix)) return false
        return true
      })
    )
    updateCharacter('choices', cleaned)
  }

  function renderListItem(bg, isSelected) {
    const skills = extractSkills(bg.skillProficiencies)
    const tools  = extractTools(bg.toolProficiencies)
    return (
      <div>
        <div style={{ color: isSelected ? 'var(--accent)' : 'var(--text-primary)', fontWeight: 'bold', fontSize: 14 }}>
          {bg.name}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
          {bg.source}
          {skills.length > 0 && ` • ${skills.join(', ')}`}
          {tools.length > 0 && ` • Tools: ${tools.join(', ')}`}
        </div>
      </div>
    )
  }

  function renderDetail(bg) {
    const skills = extractSkills(bg.skillProficiencies)
    const tools  = extractTools(bg.toolProficiencies)
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
          <div style={{ color: 'var(--accent)', fontSize: 22, fontWeight: 'bold' }}>{bg.name}</div>
          <FiveEToolsLink kind="background" name={bg.name} source={bg.source} edition={character.meta?.edition} />
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 16 }}>{t('source')}: {bg.source}</div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {skills.length > 0 && (
            <div style={detailStyles.badge}>
              <div style={detailStyles.badgeLabel}>{t('skills')}</div>
              <div style={detailStyles.badgeValue}>{skills.join(', ')}</div>
            </div>
          )}
          {tools.length > 0 && (
            <div style={detailStyles.badge}>
              <div style={detailStyles.badgeLabel}>{t('tools')}</div>
              <div style={detailStyles.badgeValue}>{tools.join(', ')}</div>
            </div>
          )}
          {bg.languageProficiencies?.length > 0 && (
            <div style={detailStyles.badge}>
              <div style={detailStyles.badgeLabel}>Languages</div>
              <div style={detailStyles.badgeValue}>+{bg.languageProficiencies.length}</div>
            </div>
          )}
          {character.meta.edition === '5.5e' && bg.feats?.length > 0 && (() => {
            const featRef = bg.feats[0]
            const featData = featByName.get(String(featRef.name || '').toLowerCase())
            const tooltipContent = featData ? (
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-purple)', marginBottom: 6 }}>
                  ⭐ {featData.name}
                  {featData.source && (
                    <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-dim)' }}>{featData.source}</span>
                  )}
                </div>
                {featData.category && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                    Kategorie: {featData.category}
                  </div>
                )}
                {Array.isArray(featData.entries) && featData.entries.length > 0 && (
                  <EntryRenderer entries={featData.entries} />
                )}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {featRef.name || 'Feat'} (Daten werden geladen…)
              </div>
            )
            return (
              <HoverDetailTooltip
                content={tooltipContent}
                maxWidth={520}
                pinTitle={`Feat · ${featData?.name || featRef.name}`}
                pinKey={`feat:${(featData?.name || featRef.name).toLowerCase()}`}
              >
                <div style={{ ...detailStyles.badge, borderColor: 'var(--accent-purple)', cursor: 'help' }}>
                  <div style={detailStyles.badgeLabel}>{t('givesFeat')}</div>
                  <div style={{ ...detailStyles.badgeValue, color: 'var(--accent-purple)' }}>
                    ⭐ {featRef.name}
                  </div>
                </div>
              </HoverDetailTooltip>
            )
          })()}
        </div>

        <EntryRenderer entries={bg.entries} />
      </div>
    )
  }

  const subtitle = character.meta.edition === '5.5e'
    ? `${t('bgSubtitle')} ${t('bgSubtitle55e')}`
    : t('bgSubtitle')

  // Aktuelles Background-Feat-Datenset für den Choice-Picker unter
  // dem BrowsePanel ableiten. Der Picker rendert nur wenn auch
  // tatsächlich Choices nötig sind (skill/tool/language Auswahl).
  const selectedBg = backgrounds.find(b => b.id === character.background?.backgroundId)
  const bgFeatRef = selectedBg?.feats?.[0] || null
  const bgFeatData = bgFeatRef
    ? featByName.get(String(bgFeatRef.name || '').toLowerCase())
    : null

  return (
    <div>
      <h2 style={{ color: 'var(--accent)', marginBottom: 4 }}>{t('chooseBackground')}</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 16, fontSize: 14 }}>{subtitle}</p>
      <BrowsePanel
        items={backgrounds}
        selectedId={character.background.backgroundId}
        onSelect={handleSelect}
        renderListItem={renderListItem}
        renderDetail={renderDetail}
        searchKeys={['name', 'source']}
        loading={loading}
      />
      {character.meta.edition === '5.5e' && bgFeatData && (
        <BackgroundFeatChoices
          feat={bgFeatData}
          character={character}
          updateCharacter={updateCharacter}
        />
      )}
    </div>
  )
}

// ── Background-Feat Choice-Picker ───────────────────────────
// 5.5e Background-Feats können verschiedene Auswahlen erfordern:
//   • skillProficiencies mit choose-from (Skilled: 3 Skills)
//   • toolProficiencies mit choose-from
//   • languageProficiencies mit choose-from (Linguist: 3 Sprachen)
//   • ability (Ability-Bonus-Wahl bei einigen ASI-Feats)
// Reads/writes via character.choices unter Keys `feat:<feat-id>:<type>:<idx>`.
// Magic Initiate's Spell-Choices laufen weiterhin über Step6 / Step7 —
// dort gibt es schon den vollwertigen Spell-Picker.
function BackgroundFeatChoices({ feat, character, updateCharacter }) {
  const featSlug = String(feat.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const choices = character.choices || {}

  function choiceKey(kind, idx) {
    return `feat:${featSlug}:${kind}:${idx}`
  }
  function setChoice(key, value) {
    const next = { ...(character.choices || {}) }
    if (value == null || (Array.isArray(value) && value.length === 0)) {
      delete next[key]
    } else {
      next[key] = value
    }
    updateCharacter('choices', next)
  }

  // Sammle Choice-Specs aus den feat-Daten. Format-Variationen aus
  // 5etools: skillProficiencies = [{ choose: { from: [...], count: N } }, …]
  // oder [{ "athletics": true, "history": true, choose: {...} }].
  const choiceSpecs = []
  const extractChoose = (arr, kind, label) => {
    if (!Array.isArray(arr)) return
    arr.forEach((entry, idx) => {
      if (!entry || typeof entry !== 'object') return
      const ch = entry.choose
      if (!ch) return
      const from = Array.isArray(ch.from) ? ch.from : (Array.isArray(ch) ? ch : null)
      const count = ch.count || 1
      if (!from || from.length === 0) return
      choiceSpecs.push({ kind, label, idx, options: from, count })
    })
  }
  extractChoose(feat.skillProficiencies,    'skill',    'Skill')
  extractChoose(feat.toolProficiencies,     'tool',     'Werkzeug')
  extractChoose(feat.languageProficiencies, 'language', 'Sprache')
  extractChoose(feat.ability,               'ability',  'Ability')

  if (choiceSpecs.length === 0) {
    return (
      <div style={featStyles.wrap}>
        <div style={featStyles.title}>⭐ {feat.name}</div>
        <div style={featStyles.hint}>
          Dieses Feat verlangt keine zusätzlichen Choices — die Effekte werden automatisch angewendet.
        </div>
      </div>
    )
  }

  return (
    <div style={featStyles.wrap}>
      <div style={featStyles.title}>⭐ {feat.name} — Auswahlen</div>
      <div style={featStyles.hint}>
        Dieses Feat verlangt Auswahlen — wähle unten was dein Charakter bekommt.
      </div>
      {choiceSpecs.map(spec => {
        const key = choiceKey(spec.kind, spec.idx)
        const selected = Array.isArray(choices[key]) ? choices[key] : (choices[key] ? [choices[key]] : [])
        function toggle(opt) {
          const has = selected.includes(opt)
          let next
          if (has) next = selected.filter(x => x !== opt)
          else if (selected.length < spec.count) next = [...selected, opt]
          else if (spec.count === 1) next = [opt]
          else return
          setChoice(key, spec.count === 1 ? (next[0] || null) : next)
        }
        return (
          <div key={`${spec.kind}:${spec.idx}`} style={featStyles.specBlock}>
            <div style={featStyles.specHeader}>
              {spec.label} — {spec.count > 1 ? `${selected.length}/${spec.count}` : 'wählen'}
            </div>
            <div style={featStyles.chipGrid}>
              {spec.options.map(opt => {
                const isSel = selected.includes(opt)
                const cap = String(opt).charAt(0).toUpperCase() + String(opt).slice(1)
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggle(opt)}
                    style={{
                      ...featStyles.chip,
                      ...(isSel ? featStyles.chipSel : {}),
                    }}
                  >{cap}{isSel ? ' ✓' : ''}</button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const featStyles = {
  wrap: {
    marginTop: 20, padding: 16,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--accent-purple)',
    borderRadius: 12,
  },
  title: { color: 'var(--accent-purple)', fontSize: 14, fontWeight: 700, marginBottom: 4 },
  hint: { color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 },
  specBlock: { marginBottom: 12 },
  specHeader: {
    fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)',
    textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6,
  },
  chipGrid: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: {
    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    color: 'var(--text-secondary)',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  chipSel: {
    border: '1px solid var(--accent)',
    background: 'color-mix(in srgb, var(--accent) 22%, transparent)',
    color: 'var(--accent)',
  },
}

const detailStyles = {
  badge: {
    background: 'var(--bg-highlight)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '4px 10px',
  },
  badgeLabel: { color: 'var(--text-muted)', fontSize: 10 },
  badgeValue: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 },
}