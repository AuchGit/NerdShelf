import { useState, useEffect } from 'react'
import { loadBackgroundList } from '../../../lib/dataLoader'
import { useLanguage } from '../../../lib/i18n'
import BrowsePanel from '../../ui/BrowsePanel'
import EntryRenderer from '../../ui/EntryRenderer'

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

  useEffect(() => {
    setLoading(true)
    loadBackgroundList(character.meta.edition).then(data => {
      setBackgrounds(data)
      setLoading(false)
    })
  }, [character.meta.edition])

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
          {tools.length > 0 && ` • 🔧 ${tools.join(', ')}`}
        </div>
      </div>
    )
  }

  function renderDetail(bg) {
    const skills = extractSkills(bg.skillProficiencies)
    const tools  = extractTools(bg.toolProficiencies)
    return (
      <div>
        <div style={{ color: 'var(--accent)', fontSize: 22, fontWeight: 'bold', marginBottom: 4 }}>{bg.name}</div>
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
          {character.meta.edition === '5.5e' && bg.feats?.length > 0 && (
            <div style={{ ...detailStyles.badge, borderColor: 'var(--accent-purple)' }}>
              <div style={detailStyles.badgeLabel}>{t('givesFeat')}</div>
              <div style={{ ...detailStyles.badgeValue, color: 'var(--accent-purple)' }}>⭐ Ja</div>
            </div>
          )}
        </div>

        <EntryRenderer entries={bg.entries} />
      </div>
    )
  }

  const subtitle = character.meta.edition === '5.5e'
    ? `${t('bgSubtitle')} ${t('bgSubtitle55e')}`
    : t('bgSubtitle')

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
    </div>
  )
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