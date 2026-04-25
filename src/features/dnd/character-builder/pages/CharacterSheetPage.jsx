import { useState, useEffect } from 'react'
import { useNavigate, useParams } from '../lib/hashNav'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n'
import { computeCharacter } from '../lib/rulesEngine'
import { computeAbilityScores, computeModifiers } from '../lib/rulesEngine'
import { getProficiencyBonus, getTotalLevel, getModifier } from '../lib/characterModel'
import { downloadFoundryJSON } from '../lib/foundryExport'
import { parseTags } from '../lib/tagParser'
import EntryRenderer from '../components/ui/EntryRenderer'
import HeaderButtons from '../components/ui/HeaderButtons'
import CustomEditModal from '../components/ui/CustomEditModal'
import { undoLastLevelUp } from '../lib/levelUpEngine'

// ── Hilfsfunktionen ─────────────────────────────────────────

function formatToolName(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/'/g, "'")
    .replace(/\b\w/g, c => c.toUpperCase())
}

function formatSkillName(skill) {
  return skill.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
}

function modStr(n) { return n >= 0 ? `+${n}` : `${n}` }

function ordinal(n) {
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}

const ABILITY_LABELS = {
  str: 'Stärke', dex: 'Geschick', con: 'Konstitution',
  int: 'Intelligenz', wis: 'Weisheit', cha: 'Charisma',
}
const ABILITY_FULL_EN = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
}

const SKILL_ABILITY_MAP = {
  acrobatics: 'dex', animalHandling: 'wis', arcana: 'int', athletics: 'str',
  deception: 'cha', history: 'int', insight: 'wis', intimidation: 'cha',
  investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis',
  performance: 'cha', persuasion: 'cha', religion: 'int', sleightOfHand: 'dex',
  stealth: 'dex', survival: 'wis',
}

// ── Spell Slots berechnen ─────────────────────────────────────
function computeSpellSlots(character) {
  const classes = character.classes || []
  const SLOT_TABLE = {
    1:[2,0,0,0,0,0,0,0,0], 2:[3,0,0,0,0,0,0,0,0], 3:[4,2,0,0,0,0,0,0,0],
    4:[4,3,0,0,0,0,0,0,0], 5:[4,3,2,0,0,0,0,0,0], 6:[4,3,3,0,0,0,0,0,0],
    7:[4,3,3,1,0,0,0,0,0], 8:[4,3,3,2,0,0,0,0,0], 9:[4,3,3,3,1,0,0,0,0],
    10:[4,3,3,3,2,0,0,0,0],11:[4,3,3,3,2,1,0,0,0],12:[4,3,3,3,2,1,0,0,0],
    13:[4,3,3,3,2,1,1,0,0],14:[4,3,3,3,2,1,1,0,0],15:[4,3,3,3,2,1,1,1,0],
    16:[4,3,3,3,2,1,1,1,0],17:[4,3,3,3,2,1,1,1,1],18:[4,3,3,3,3,1,1,1,1],
    19:[4,3,3,3,3,2,1,1,1],20:[4,3,3,3,3,2,2,1,1],
  }
  const WARLOCK_TABLE = {
    1:{slots:1,level:1},2:{slots:2,level:1},3:{slots:2,level:2},4:{slots:2,level:2},
    5:{slots:2,level:3},6:{slots:2,level:3},7:{slots:2,level:4},8:{slots:2,level:4},
    9:{slots:2,level:5},10:{slots:2,level:5},11:{slots:3,level:5},12:{slots:3,level:5},
    13:{slots:3,level:5},14:{slots:3,level:5},15:{slots:3,level:5},16:{slots:3,level:5},
    17:{slots:4,level:5},18:{slots:4,level:5},19:{slots:4,level:5},20:{slots:4,level:5},
  }

  let casterLevel = 0
  let warlockSlots = null

  for (const cls of classes) {
    const prog = cls.casterProgression
    if (prog === 'full')      casterLevel += cls.level
    else if (prog === 'half' || prog === '1/2') casterLevel += Math.floor(cls.level / 2)
    else if (prog === '1/3')  casterLevel += Math.floor(cls.level / 3)
    else if (prog === 'pact') warlockSlots = WARLOCK_TABLE[cls.level] || null
  }

  const lvl = Math.min(20, Math.round(casterLevel))
  const slots = lvl > 0 ? SLOT_TABLE[lvl] : null
  return { slots, warlockSlots }
}

// ── Alle Zauber des Characters sammeln ───────────────────────
function getAllCharacterSpells(character) {
  const cantrips = []
  const spellsByLevel = {}
  const featSpells = []
  const racialSpells = []

  for (const cls of (character.classes || [])) {
    const lc = cls.levelChoices?.[1] || {}
    for (const s of (lc.cantrips || [])) {
      if (!cantrips.includes(s)) cantrips.push(s)
    }
    for (const s of (lc.startingSpells || [])) {
      const lvl = 1
      if (!spellsByLevel[lvl]) spellsByLevel[lvl] = []
      if (!spellsByLevel[lvl].includes(s)) spellsByLevel[lvl].push(s)
    }
  }

  for (const feat of (character.feats || [])) {
    const spells = feat.choices?.spells || []
    for (const sp of spells) {
      const name = typeof sp === 'string' ? sp : sp?.name
      const level = typeof sp === 'string' ? null : sp?.level
      if (!name) continue
      if (level === 0) {
        if (!cantrips.includes(name)) cantrips.push(name)
      } else if (level && level > 0) {
        if (!spellsByLevel[level]) spellsByLevel[level] = []
        if (!spellsByLevel[level].includes(name)) spellsByLevel[level].push(name)
      } else {
        if (!featSpells.includes(name)) featSpells.push(name)
      }
    }
  }

  for (const sp of (character.species?.spellChoices || [])) {
    const name = typeof sp === 'string' ? sp : sp?.name
    if (name && !racialSpells.includes(name)) racialSpells.push(name)
  }
  // Also include race/subrace spells from the species block
  for (const sp of (character.species?.raceSpells || [])) {
    const name = typeof sp === 'string' ? sp : sp?.name
    if (name && !racialSpells.includes(name)) racialSpells.push(name)
  }
  for (const sp of (character.species?.subraceSpells || [])) {
    const name = typeof sp === 'string' ? sp : sp?.name
    if (name && !racialSpells.includes(name)) racialSpells.push(name)
  }

  return { cantrips, spellsByLevel, featSpells, racialSpells }
}

// ── Feat-Boni sammeln ────────────────────────────────────────
function getFeatBonusSummary(character) {
  const result = []
  for (const feat of (character.feats || [])) {
    const entry = { name: feat.featId, source: feat.source, isOrigin: feat._isOriginFeat, bonuses: [], spells: [] }
    if (feat.abilityBonus) {
      for (const [key, val] of Object.entries(feat.abilityBonus)) {
        if (val) entry.bonuses.push(`+${val} ${key.toUpperCase()}`)
      }
    }
    if (feat.choices?.abilityBonus) {
      for (const [key, val] of Object.entries(feat.choices.abilityBonus)) {
        if (val) entry.bonuses.push(`+${val} ${key.toUpperCase()}`)
      }
    }
    const spells = feat.choices?.spells || []
    if (spells.length > 0) {
      entry.spells = spells.map(s => typeof s === 'string' ? s : s?.name).filter(Boolean)
    }
    result.push(entry)
  }
  return result
}

// ═══════════════════════════════════════════════════════════════
// HAUPTKOMPONENTE
// ═══════════════════════════════════════════════════════════════

export default function CharacterSheetPage({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [character, setCharacter] = useState(null)
  const [computed, setComputed] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showCustomEdit, setShowCustomEdit] = useState(false)

  useEffect(() => { loadCharacter() }, [id])

  async function loadCharacter() {
    const { data, error } = await supabase
      .from('characters').select('*').eq('id', id).eq('user_id', session.user.id).single()
    if (error || !data) { navigate('/'); return }

    // Check for unsaved backup from a failed level-up save
    try {
      const backupKey = `dndbuilder_backup_${id}`
      const backupRaw = localStorage.getItem(backupKey)
      if (backupRaw) {
        const backup = JSON.parse(backupRaw)
        const backupLevel = (backup.updated?.classes || []).reduce((s, c) => s + (c.level || 0), 0)
        const savedLevel = (data.data.classes || []).reduce((s, c) => s + (c.level || 0), 0)
        if (backupLevel !== savedLevel && backup.updated) {
          const age = Date.now() - new Date(backup.timestamp).getTime()
          if (age < 24 * 60 * 60 * 1000) { // less than 24h old
            const restore = window.confirm(
              `Ein nicht gespeichertes Level-Up wurde gefunden (${new Date(backup.timestamp).toLocaleString('de-DE')}).\n\n` +
              `Gespeichert: Level ${savedLevel}\nBackup: Level ${backupLevel}\n\nBackup wiederherstellen?`
            )
            if (restore) {
              const { error: restoreErr } = await supabase.from('characters')
                .update({ data: backup.updated, name: backup.updated.info.name })
                .eq('id', id).eq('user_id', session.user.id)
              if (!restoreErr) {
                localStorage.removeItem(backupKey)
                setCharacter(backup.updated)
                setComputed(computeCharacter(backup.updated))
                setLoading(false)
                return
              }
            }
          }
          localStorage.removeItem(backupKey)
        } else {
          localStorage.removeItem(backupKey) // stale backup, levels match
        }
      }
    } catch (_) { /* localStorage unavailable */ }

    setCharacter(data.data)
    setComputed(computeCharacter(data.data))
    setLoading(false)
  }

  async function updateCharacter(path, value) {
    setCharacter(prev => {
      const next = structuredClone(prev)
      const parts = path.split('.')
      let obj = next
      for (let i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]]) obj[parts[i]] = {}
        obj = obj[parts[i]]
      }
      obj[parts[parts.length - 1]] = value
      // Save to Supabase in background
      supabase.from('characters')
        .update({ data: next })
        .eq('id', id).eq('user_id', session.user.id)
        .then(({ error }) => { if (error) console.error('[Custom Save]', error) })
      setComputed(computeCharacter(next))
      return next
    })
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 80, fontSize: 16 }}>{t('loading')}</div>
  if (!character) return null

  const abilityScores = computeAbilityScores(character)
  const modifiers     = computeModifiers(abilityScores)
  const totalLevel    = getTotalLevel(character)
  const profBonus     = getProficiencyBonus(character)
  const hp            = computed?.hp || { max: 1, current: 1, temporary: 0 }
  const ac            = computed?.ac?.total || 10
  const initiative    = computed?.initiative ?? modifiers.dex
  const speed         = computed?.speed?.walk || character.species?.speed || 30
  const raceName      = character.species.raceId?.split('__')[0] || '—'
  const subraceName   = character.species.subraceId?.split('__')[0] || ''
  const speciesDisplay = subraceName ? `${subraceName} (${raceName})` : raceName
  const className     = character.classes.map(c => `${c.classId} ${c.level}`).join(' / ')
  const portrait      = character.appearance?.portrait

  const TABS = [
    { id: 'overview',    label: 'Overview'},
    { id: 'spells',      label: 'Spells'},
    { id: 'features',    label: 'Background & Feats'},
    { id: 'inventory',   label: 'Inventory'},
    { id: 'personality', label: 'Personality'},
  ]

  return (
    <div style={S.page}>
      {/* ═══ HEADER ═══ */}
      <div style={S.header}>
        <button style={S.headerBackBtn} onClick={() => navigate('/')}>
          ← Dashboard
        </button>

        <div style={S.headerCenter}>
          {portrait && (
            <img src={portrait} style={S.headerPortrait} alt="Portrait" />
          )}
          <div>
            <div style={S.headerName}>{character.info.name || 'Unbenannt'}</div>
            <div style={S.headerSubline}>
              {speciesDisplay} · {className} · Level {totalLevel}
              {character.info.alignment && ` · ${character.info.alignment}`}
            </div>
          </div>
        </div>

        <div style={S.headerRight}>
          <div style={{ position: 'relative' }}>
            <button style={S.exportBtn} onClick={() => setShowExportMenu(v => !v)}>
              ⬇ Export
            </button>
            {showExportMenu && (
              <div style={S.exportMenu}>
                <button style={S.exportMenuItem}
                  onClick={async () => { await downloadFoundryJSON(character); setShowExportMenu(false) }}>
                  🎲 FoundryVTT (.json)
                </button>
              </div>
            )}
          </div>
          <button style={S.levelUpBtn} onClick={() => navigate(`/character/${id}/levelup`)}>
            ⬆ Level Up
          </button>
          <button style={{ ...S.headerBtn, borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}
            onClick={() => setShowCustomEdit(true)}>
            ✨ Custom
          </button>
          {totalLevel === 1 && (
            <button style={S.headerBtn} onClick={() => navigate(`/character/${id}/edit`)}>
              ✏️ Bearbeiten
            </button>
          )}
          {(character.levelHistory || []).length > 0 && (
            <button style={{ ...S.headerBtn, borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}
              onClick={async () => {
                const h = character.levelHistory || []
                const last = h[h.length - 1]
                if (!last?.snapshot) return
                const cls = character.classes.find(c => c.classId === last.classId)
                const lc = cls?.levelChoices?.[last.classLevel] || {}
                const parts = [`${last.classId} Lv.${last.classLevel}`]
                if (lc.type === 'asi') parts.push('ASI: ' + Object.entries(lc.improvements||{}).map(([k,v])=>`${k.toUpperCase()} +${v}`).join(', '))
                if (lc.type === 'feat') parts.push(`Feat: ${lc.featId}`)
                if (lc.cantrips?.length) parts.push(`${lc.cantrips.length} Cantrips`)
                if (lc.knownSpells?.length) parts.push(`${lc.knownSpells.length} Spells`)
                if (lc.optionalFeatures?.length) parts.push(lc.optionalFeatures.map(f => f.name).join(', '))
                for (const [fn, sp] of Object.entries(lc.optFeatureSpells || {})) { if (sp?.length) parts.push(`${fn}: ${sp.join(', ')}`) }
                if (!window.confirm(`Level Down rückgängig machen?\n\n${parts.join('\n')}`)) return

                // Zentrale Engine-Funktion: graftet die Live-History korrekt zurück
                const restored = undoLastLevelUp(character)
                if (!restored) { alert('Kein Snapshot verfügbar.'); return }
                if (character.appearance?.portrait)
                  restored.appearance = { ...(restored.appearance || {}), portrait: character.appearance.portrait }

                try { localStorage.setItem(`dndbuilder_backup_${id}`, JSON.stringify({ timestamp: new Date().toISOString(), previous: character, updated: restored })) } catch (_) {}
                let saved = false
                for (let attempt = 1; attempt <= 3; attempt++) {
                  const { error: e } = await supabase.from('characters').update({ data: restored, name: restored.info.name })
                    .eq('id', id).eq('user_id', session.user.id)
                  if (!e) { saved = true; break }
                  if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500))
                }
                if (!saved) { alert('Level Down fehlgeschlagen. Dein Charakter ist lokal gesichert.'); return }
                try { localStorage.removeItem(`dndbuilder_backup_${id}`) } catch (_) {}
                loadCharacter()
              }}>
              ↩ Level Down
            </button>
          )}
          <HeaderButtons session={session} />
        </div>
      </div>

      {showCustomEdit && (
        <CustomEditModal
          onClose={() => setShowCustomEdit(false)}
          character={character}
          updateCharacter={updateCharacter}
        />
      )}


      {/* ═══ COMBAT STATS BAR ═══ */}
      <div style={S.combatBar}>
        <CombatStat label="AC" value={ac} color="#60a5fa" icon="🛡️" hint="AC" />
        <CombatStat label="Initiative" value={modStr(initiative)} color="#a78bfa" icon="⚡" />
        <CombatStat label="Movement" value={`${speed} ft.`} color="#34d399" icon="🏃" />
        <CombatStat label="HP" value={`${hp.current} / ${hp.max}`} color="#f87171" icon="❤️"
          sub={hp.temporary ? `+${hp.temporary} temp` : null} />
        <CombatStat label="Proficiency" value={modStr(profBonus)} color="#e2b96f" icon="🎯" hint="Prof. Bonus" />
        <CombatStat label="Passive Perception" value={computed?.passivePerception ?? 10} color="#8899aa" icon="👁️" />
      </div>

      {/* ═══ BODY ═══ */}
      <div style={S.body}>
        {/* ── SIDEBAR ── */}
        <div style={S.sidebar}>
          {/* Portrait */}
          {portrait && (
            <div style={S.sidePortrait}>
              <img src={portrait} style={S.sidePortraitImg} alt="Portrait" />
            </div>
          )}

          {/* ── Ability Scores ── */}
          <SideSection title="Ability Scores">
            <div style={S.abilityGrid}>
              {['str','dex','con','int','wis','cha'].map(key => {
                const score = abilityScores[key]
                const mod = modifiers[key]
                const base = character.abilityScores.base[key] || 8
                const racial = character.species?.abilityScoreImprovements?.[key] || 0
                const bg = character.background?.abilityScoreImprovements?.[key] || 0
                const featBonus = (character.feats || []).reduce((sum, f) => {
                  return sum + (f.abilityBonus?.[key] || 0) + (f.choices?.abilityBonus?.[key] || 0)
                }, 0)
                const hasBonuses = racial || bg || featBonus

                return (
                  <div key={key} style={S.abilityBox} title={
                    `Basis: ${base}` +
                    (racial ? ` | Spezies: ${racial > 0 ? '+' : ''}${racial}` : '') +
                    (bg ? ` | Background: ${bg > 0 ? '+' : ''}${bg}` : '') +
                    (featBonus ? ` | Feat: ${featBonus > 0 ? '+' : ''}${featBonus}` : '')
                  }>
                    <div style={S.abilityAbbr}>{key.toUpperCase()}</div>
                    <div style={S.abilityMod}>{modStr(mod)}</div>
                    <div style={S.abilityScore}>{score}</div>
                    {hasBonuses && (
                      <div style={S.abilityBreakdown}>
                        {base}
                        {racial !== 0 && <span style={{ color: 'var(--accent-green)' }}>{racial > 0 ? '+' : ''}{racial}</span>}
                        {bg !== 0 && <span style={{ color: 'var(--accent-purple)' }}>{bg > 0 ? '+' : ''}{bg}</span>}
                        {featBonus !== 0 && <span style={{ color: 'var(--accent)' }}>{featBonus > 0 ? '+' : ''}{featBonus}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </SideSection>

          {/* ── Saving Throws ── */}
          <SideSection title="Saving Throws">
            {computed && Object.entries(computed.savingThrows).map(([key, save]) => (
              <div key={key} style={S.saveRow}>
                <span style={{ ...S.profDot, background: save.proficient ? 'var(--accent)' : 'var(--border)' }} />
                <span style={S.saveName}>{key.toUpperCase()}</span>
                <span style={S.saveValue}>{modStr(save.total)}</span>
              </div>
            ))}
          </SideSection>

          {/* ── Skills ── */}
          <SideSection title="Skills">
            {computed && Object.entries(computed.skills).map(([skill, data]) => {
              const dotColor = data.proficiency === 'expertise' ? 'var(--accent)'
                : data.proficiency === 'proficient' ? 'var(--accent-green)' : 'var(--border)'
              const profLabel = data.proficiency === 'expertise' ? '★' : data.proficiency === 'proficient' ? '●' : '○'
              return (
                <div key={skill} style={S.skillRow}>
                  <span style={{ ...S.profDot, background: dotColor }} title={
                    data.proficiency === 'expertise' ? 'Expertise'
                    : data.proficiency === 'proficient' ? 'Proficient'
                    : 'Niot Proficient'
                  } />
                  <span style={S.skillName}>
                    {formatSkillName(skill)}
                    <span style={S.skillAbility}> ({data.ability.toUpperCase()})</span>
                  </span>
                  <span style={{ ...S.skillValue, color: data.proficiency !== 'none' ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                    {modStr(data.total)}
                  </span>
                </div>
              )
            })}
            <div style={S.sideHint}>
              <span style={{ color: 'var(--accent-green)' }}>● Proficient</span>
              {' · '}
              <span style={{ color: 'var(--accent)' }}>★ Expertise</span>
            </div>
          </SideSection>

          {/* ── Proficiencies Summary ── */}
          {computed?.proficiencies && (
            <SideSection title="Proficiencies">
              {computed.proficiencies.armor?.length > 0 && (
                <ProfBlock label="Armor" value={computed.proficiencies.armor.map(a => parseTags(String(a))).join(', ')} />
              )}
              {computed.proficiencies.weapons?.length > 0 && (
                <ProfBlock label="Weapons" value={computed.proficiencies.weapons.map(w => parseTags(String(w))).join(', ')} />
              )}
              {Object.keys(computed.proficiencies.tools || {}).length > 0 && (
                <ProfBlock label="Tools" value={Object.keys(computed.proficiencies.tools).map(formatToolName).join(', ')} />
              )}
              {computed.proficiencies.languages?.length > 0 && (
                <ProfBlock label="Languages" value={computed.proficiencies.languages.join(', ')} />
              )}
            </SideSection>
          )}

          {/* ── Senses ── */}
          <SideSection title="Sinne">
            <SenseRow label="Passive Perception" value={computed?.passivePerception ?? 10} />
            <SenseRow label="Passive Investigation" value={computed?.passiveInvestigation ?? 10} />
            <SenseRow label="Passive Insight" value={computed?.passiveInsight ?? 10} />
            {character.species?.darkvision && (
              <SenseRow label="Darksight" value={`${character.species.darkvision} ft.`} />
            )}
          </SideSection>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div style={S.main}>
          {/* Tab-Navigation */}
          <div style={S.tabs}>
            {TABS.map(tab => (
              <button key={tab.id}
                style={{ ...S.tab, ...(activeTab === tab.id ? S.tabActive : {}) }}
                onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>

          <div style={S.tabContent}>
            {activeTab === 'overview'    && <OverviewTab character={character} computed={computed} modifiers={modifiers} profBonus={profBonus} abilityScores={abilityScores} charId={id} session={session} onReload={loadCharacter} />}
            {activeTab === 'spells'      && <SpellsTab character={character} computed={computed} />}
            {activeTab === 'features'    && <FeaturesTab character={character} abilityScores={abilityScores} />}
            {activeTab === 'inventory'   && <InventoryTab character={character} />}
            {activeTab === 'personality' && <PersonalityTab character={character} />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════

function OverviewTab({ character, computed, modifiers, profBonus, abilityScores, charId, session, onReload }) {
  const totalLevel = getTotalLevel(character)

  return (
    <div style={S.tabBody}>
      {/* ── Charakter-Identität ── */}
      <Section title="Base Information">
        <div style={S.identityGrid}>
          <InfoCard label="Species"
            value={character.species.subraceId
              ? `${character.species.subraceId.split('__')[0]} (${character.species.raceId?.split('__')[0]})`
              : character.species.raceId?.split('__')[0] || '—'}
            hint={character.species.source ? `Quelle: ${character.species.source}` : null}
          />
          <InfoCard label="Background"
            value={character.background.backgroundId?.split('__')[0] || '—'}
            hint={character.background.source ? `Quelle: ${character.background.source}` : null}
          />
          <InfoCard label="Alignment"
            value={character.info.alignment || '—'}
          />
          <InfoCard label="Experience"
            value={character.info.experience || 0}
          />
          {character.info.player && (
            <InfoCard label="Player" value={character.info.player} />
          )}
          <InfoCard label="Edition"
            value={character.meta.edition === '5.5e' ? 'D&D 2024 (5.5e)' : 'D&D 2014 (5e)'}
          />
        </div>
      </Section>

      {/* ── Klassen-Übersicht ── */}
      <Section title="Class">
        {character.classes.map((c, i) => (
          <div key={i} style={S.classCard}>
            <div style={S.classCardHeader}>
              <div>
                <div style={S.classCardName}>{c.classId}</div>
                <div style={S.classCardLevel}>Level {c.level}</div>
              </div>
              <div style={S.classCardBadges}>
                <Badge color="#60a5fa" label={`d${c.hitDie}`} hint="Trefferwürfel" />
                {c.subclassId && (
                  <Badge color="#a78bfa" label={c.subclassId.split('__')[0]} hint={c.subclassTitle || 'Subklasse'} />
                )}
                {c.spellcastingAbility && (
                  <Badge color="#f59e0b" label={`Zaubern (${c.spellcastingAbility.toUpperCase()})`} hint="Zauberattribut" />
                )}
              </div>
            </div>
            <div style={S.classCardDetails}>
              <DetailChip label="Hit Dice" value={`${c.level}d${c.hitDie}`} />
              {c.casterProgression && (
                <DetailChip label="Spell Progression"
                  value={c.casterProgression === 'full' ? 'Full Caster'
                    : (c.casterProgression === 'half' || c.casterProgression === '1/2') ? 'Half-Caster'
                    : c.casterProgression === '1/3' ? 'Third-Caster'
                    : c.casterProgression === 'pact' ? 'Pact-Magic'
                    : c.casterProgression}
                />
              )}
              {c.subclassLevel && c.subclassLevel > 1 && !c.subclassId && (
                <DetailChip label="Subclass at" value={`Level ${c.subclassLevel}`} />
              )}
            </div>
          </div>
        ))}
      </Section>

      {/* ── Trefferpunkte Details ── */}
      <Section title="Hit Points">
        <div style={S.hpSection}>
          <div style={S.hpMain}>
            <div style={S.hpLabel}>Max HP</div>
            <div style={S.hpValue}>{computed?.hp?.max || '—'}</div>
          </div>
          <div style={S.hpDetails}>
            <DetailChip label="Method"
              value={character.hpPreference?.method === 'roll' ? 'Roll' : 'Average'} />
            {character.classes[0] && (
              <DetailChip label="Level 1"
                value={`${character.classes[0].hitDie} (Max) + ${modStr(getModifier(abilityScores.con))} CON`} />
            )}
            <DetailChip label="Hit Dice"
              value={character.classes.map(c => `${c.level}d${c.hitDie}`).join(' + ')} />
          </div>
        </div>

        {/* Death Saves Tracker */}
        <div style={S.deathSaves}>
          <div style={S.deathSaveRow}>
            <span style={S.deathSaveLabel}>✓ Successes</span>
            {[0,1,2].map(i => (
              <span key={i} style={{
                ...S.deathSaveDot,
                background: (character.status?.deathSaves?.successes || 0) > i ? 'var(--accent-green)' : 'var(--border)',
              }} />
            ))}
          </div>
          <div style={S.deathSaveRow}>
            <span style={S.deathSaveLabel}>✗ Failures</span>
            {[0,1,2].map(i => (
              <span key={i} style={{
                ...S.deathSaveDot,
                background: (character.status?.deathSaves?.failures || 0) > i ? 'var(--accent-red)' : 'var(--border)',
              }} />
            ))}
          </div>
        </div>
      </Section>

      {/* ── Angriffe ── */}
      {computed?.attacks?.length > 0 && (
        <Section title="Attacks">
          <div style={S.attackTableWrap}>
            <table style={S.attackTable}>
              <thead>
                <tr>
                  <th style={S.th}>Name</th>
                  <th style={S.th}>Angriff</th>
                  <th style={S.th}>Schaden</th>
                  <th style={S.th}>Typ</th>
                  <th style={S.th}>Reichweite</th>
                </tr>
              </thead>
              <tbody>
                {computed.attacks.map((atk, i) => (
                  <tr key={i}>
                    <td style={S.td}>{atk.name}</td>
                    <td style={{ ...S.td, color: 'var(--accent-blue)', fontWeight: 'bold' }}>{atk.attackDisplay}</td>
                    <td style={{ ...S.td, color: 'var(--accent-red)' }}>{atk.damage}</td>
                    <td style={S.td}>{atk.damageType}</td>
                    <td style={S.td}>{atk.range}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ── Spellcasting-Schnellübersicht ── */}
      {computed?.spellcasting && Object.keys(computed.spellcasting).length > 0 && (
        <Section title="Spellcasting">
          {Object.entries(computed.spellcasting).map(([cls, data]) => (
            <div key={cls} style={S.spellcastRow}>
              <span style={S.spellcastClass}>{cls}</span>
              <DetailChip label="Ability" value={data.ability.toUpperCase()} />
              <DetailChip label="Spell-Attack" value={data.spellAttackDisplay} />
              <DetailChip label="Spell-DC" value={data.spellSaveDC} />
            </div>
          ))}
        </Section>
      )}

      {/* ── Klassenressourcen ── */}
      {computed?.resources?.length > 0 && (
        <Section title="Class Ressources">
          <div style={S.resourceGrid}>
            {computed.resources.map((res, i) => (
              <div key={i} style={S.resourceBox}>
                <div style={S.resourceName}>{res.name}</div>
                <div style={S.resourceValue}>
                  {res.type === 'pool' ? `${res.max} HP Pool`
                    : res.type === 'passive' ? (res.value || res.die || '—')
                    : `${res.max} / ${res.max}`}
                </div>
                <div style={S.resourceRecharge}>
                  {res.type === 'passive' ? 'Passiv'
                    : res.recharge === 'short_rest' ? '↻ Short Rest'
                    : '↻ Long Rest'}
                  {res.die && ` · ${res.die}`}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Level History ── */}
      {(character.levelHistory || []).length > 0 && (
        <Section title="Level History">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[...(character.levelHistory || [])].reverse().map((entry, i) => {
              // Find what was chosen at this level
              const cls = character.classes.find(c => c.classId === entry.classId)
              const lc = cls?.levelChoices?.[entry.classLevel] || {}
              const details = []
              if (lc.type === 'asi') {
                const parts = Object.entries(lc.improvements || {}).map(([k,v]) => `${k.toUpperCase()} +${v}`)
                if (parts.length > 0) details.push(`ASI: ${parts.join(', ')}`)
              }
              if (lc.type === 'feat' && lc.featId) details.push(`Feat: ${lc.featId}`)
              if (lc.cantrips?.length > 0) details.push(`Cantrips: ${lc.cantrips.join(', ')}`)
              if (lc.knownSpells?.length > 0) details.push(`Spells: ${lc.knownSpells.join(', ')}`)
              if (lc.swappedSpell) details.push(`Tausch: ${lc.swappedSpell.oldSpell} → ${lc.swappedSpell.newSpell}`)
              if (lc.optionalFeatures?.length > 0) details.push(lc.optionalFeatures.map(f => f.name).join(', '))
              for (const [featName, spNames] of Object.entries(lc.optFeatureSpells || {})) {
                if (spNames?.length > 0) details.push(`${featName}: ${spNames.join(', ')}`)
              }
              const cfc = lc.classFeatureChoices || {}
              if (cfc.favoredEnemy) details.push(`Favored Enemy: ${cfc.favoredEnemy}`)
              if (cfc.favoredTerrain) details.push(`Favored Terrain: ${cfc.favoredTerrain}`)
              return (
                <div key={i} style={{
                  padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 8,
                  border: i === 0 ? '1px solid #ff888844' : '1px solid #2a4a6a',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 }}>
                        {entry.classId} Lv.{entry.classLevel}
                        <span style={{ color: 'var(--text-muted)', fontWeight: 'normal', marginLeft: 8, fontSize: 11 }}>
                          Gesamt Lv.{entry.totalLevel} • {new Date(entry.timestamp).toLocaleDateString('de-DE')}
                        </span>
                      </div>
                      {details.length > 0 && (
                        <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginTop: 3 }}>{details.join(' • ')}</div>
                      )}
                    </div>
                    {i === 0 && entry.snapshot && (
                      <button style={{
                        padding: '4px 10px', borderRadius: 6, border: '1px solid var(--accent-red)',
                        background: 'transparent', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 11,
                      }} onClick={async () => {
                        const snap = structuredClone(entry.snapshot)
                        if (character.appearance?.portrait)
                          snap.appearance = { ...(snap.appearance || {}), portrait: character.appearance.portrait }
                        await supabase.from('characters').update({ data: snap, name: snap.info.name })
                          .eq('id', charId).eq('user_id', session.user.id)
                        onReload()
                      }}>↩ Rückgängig</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// FEATURES TAB (Herkunft, Spezies, Background, Feats)
// ═══════════════════════════════════════════════════════════════

function FeaturesTab({ character, abilityScores }) {
  const featBonuses = getFeatBonusSummary(character)
  const [featDataMap, setFeatDataMap] = useState({})
  const [expandedFeat, setExpandedFeat] = useState(null)

  // Load feat data for descriptions
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { loadFeatList } = await import('../lib/dataLoader')
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
    <div style={S.tabBody}>
      {/* ── Spezies / Rasse ── */}
      <Section title="Species">
        <div style={S.featureCard}>
          <div style={S.featureCardHeader}>
            <div style={S.featureCardName}>{raceName}{subraceName ? ` — ${subraceName}` : ''}</div>
            {character.species.source && (
              <div style={S.featureCardSource}>{character.species.source}</div>
            )}
          </div>
          <div style={S.featureCardBody}>
            {/* Grundlegende Rassen-Eigenschaften */}
            <div style={S.traitGrid}>
              {character.species.speed && (
                <TraitPill label="Movement" value={`${character.species.speed} ft.`} />
              )}
              {character.species.size && (
                <TraitPill label="Size" value={
                  character.species.size === 'M' ? 'Mittel' :
                  character.species.size === 'S' ? 'Klein' :
                  character.species.size === 'L' ? 'Groß' :
                  character.species.size === 'T' ? 'Winzig' : character.species.size
                } />
              )}
              {character.species.darkvision && (
                <TraitPill label="Darksight" value={`${character.species.darkvision} ft.`} />
              )}
              {character.species.naturalArmor && (
                <TraitPill label="Natural Armor" value="Ja" />
              )}
            </div>

            {/* ASI von Rasse */}
            {character.species.abilityScoreImprovements &&
              Object.values(character.species.abilityScoreImprovements).some(v => v !== 0) && (
              <div style={S.asiBlock}>
                <div style={S.asiLabel}>Attributsboni:</div>
                <div style={S.asiValues}>
                  {Object.entries(character.species.abilityScoreImprovements)
                    .filter(([, v]) => v !== 0)
                    .map(([k, v]) => (
                      <span key={k} style={S.asiBadge}>
                        {v > 0 ? '+' : ''}{v} {k.toUpperCase()}
                      </span>
                    ))}
                </div>
              </div>
            )}

            {/* Extra Sprachen */}
            {character.species.extraLanguages?.length > 0 && (
              <div style={S.traitLine}>
                <span style={S.traitLineLabel}>Zusätzliche Sprachen:</span>
                <span style={S.traitLineValue}>{character.species.extraLanguages.join(', ')}</span>
              </div>
            )}

            {/* Rassenzauber */}
            {(character.species.raceSpells?.length > 0 || character.species.subraceSpells?.length > 0) && (
              <div style={S.traitLine}>
                <span style={S.traitLineLabel}>Rassenzauber:</span>
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
            {character.background.source && (
              <div style={S.featureCardSource}>{character.background.source}</div>
            )}
          </div>
          <div style={S.featureCardBody}>
            {character.background.skillProficiencies?.length > 0 && (
              <div style={S.traitLine}>
                <span style={S.traitLineLabel}>Fertigkeiten:</span>
                <span style={S.traitLineValue}>
                  {character.background.skillProficiencies.map(s => formatSkillName(s)).join(', ')}
                </span>
              </div>
            )}
            {character.background.toolProficiencies?.length > 0 && (
              <div style={S.traitLine}>
                <span style={S.traitLineLabel}>Werkzeuge:</span>
                <span style={S.traitLineValue}>
                  {character.background.toolProficiencies.map(formatToolName).join(', ')}
                </span>
              </div>
            )}
            {character.background.languages?.length > 0 && (
              <div style={S.traitLine}>
                <span style={S.traitLineLabel}>Sprachen:</span>
                <span style={S.traitLineValue}>{character.background.languages.join(', ')}</span>
              </div>
            )}
            {character.background.feat && (
              <div style={S.traitLine}>
                <span style={S.traitLineLabel}>Origin-Feat:</span>
                <span style={{ ...S.traitLineValue, color: 'var(--accent-purple)' }}>
                  ⭐ {character.background.feat.name || character.background.feat}
                </span>
              </div>
            )}

            {/* Background ASI (5.5e) */}
            {character.background.abilityScoreImprovements &&
              Object.values(character.background.abilityScoreImprovements).some(v => v !== 0) && (
              <div style={S.asiBlock}>
                <div style={S.asiLabel}>Attributsboni (Background):</div>
                <div style={S.asiValues}>
                  {Object.entries(character.background.abilityScoreImprovements)
                    .filter(([, v]) => v !== 0)
                    .map(([k, v]) => (
                      <span key={k} style={{ ...S.asiBadge, background: 'var(--accent-purple)', borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}>
                        {v > 0 ? '+' : ''}{v} {k.toUpperCase()}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ── Klassen-Fertigkeiten ── */}
      {cls && (
        <Section title={`Class-Skills (${cls.classId})`}>
          {cls.levelChoices?.[1]?.skillProficiencies?.length > 0 && (
            <div style={S.traitLine}>
              <span style={S.traitLineLabel}>Chosen Skills:</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {cls.levelChoices[1].skillProficiencies.map((skill, i) => (
                  <span key={i} style={S.skillBadge}>
                    ✓ {formatSkillName(skill)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {cls.levelChoices?.[1]?.cantrips?.length > 0 && (
            <div style={{ ...S.traitLine, marginTop: 12 }}>
              <span style={S.traitLineLabel}>Chosen Cantrips:</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {cls.levelChoices[1].cantrips.map((name, i) => (
                  <span key={i} style={{ ...S.skillBadge, color: 'var(--accent-blue)', borderColor: 'var(--accent-blue)' }}>
                    ✦ {name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {cls.levelChoices?.[1]?.startingSpells?.length > 0 && (
            <div style={{ ...S.traitLine, marginTop: 12 }}>
              <span style={S.traitLineLabel}>Starting-Spells:</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {cls.levelChoices[1].startingSpells.map((name, i) => (
                  <span key={i} style={{ ...S.skillBadge, color: 'var(--accent-purple)', borderColor: 'var(--accent-purple)' }}>
                    ★ {name}
                  </span>
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
                  <span style={{ color: 'var(--text-dim)', fontSize: 11, marginLeft: 6, cursor: 'pointer' }}>{isExpanded ? '▲' : '▼'}</span>
                </div>
                <div style={S.featCardSource}>{feat.source}</div>
              </div>
              {(feat.bonuses.length > 0 || feat.spells.length > 0) && (
                <div style={S.featCardBonuses}>
                  {feat.bonuses.map((b, j) => (
                    <span key={j} style={S.featBonusBadge}>{b}</span>
                  ))}
                  {feat.spells.map((sp, j) => (
                    <span key={`sp${j}`} style={{ ...S.featBonusBadge, borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>
                      🔮 {sp}
                    </span>
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

          {/* Custom Feats */}
          {(character.custom?.feats || []).map(feat => {
            const isExpanded = expandedFeat === `custom_${feat._id}`
            const bonuses = Object.entries(feat.abilityBonus || {}).map(([a, v]) => `${a.toUpperCase()} +${v}`)
            return (
              <div key={feat._id} style={S.featCard}>
                <div style={S.featCardHeader} onClick={() => setExpandedFeat(isExpanded ? null : `custom_${feat._id}`)}>
                  <div style={S.featCardName}>
                    <span style={{ ...S.originTag, background: '#a78bfa33' }}>✨ CUSTOM</span>
                    {feat.name}
                    <span style={{ color: 'var(--text-dim)', fontSize: 11, marginLeft: 6, cursor: 'pointer' }}>{isExpanded ? '▲' : '▼'}</span>
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

// ═══════════════════════════════════════════════════════════════
// SPELLS TAB
// ═══════════════════════════════════════════════════════════════

function SpellsTab({ character, computed }) {
  const hasSpellcasting = character.classes.some(c => c.spellcastingAbility)
  const { slots, warlockSlots } = computeSpellSlots(character)
  const { cantrips, spellsByLevel, featSpells, racialSpells } = getAllCharacterSpells(character)
  const usedSlots = character.status?.usedSpellSlots || {}

  const customSpells = character.custom?.spells || []

  const hasAnySpells = cantrips.length > 0
    || Object.keys(spellsByLevel).length > 0
    || featSpells.length > 0
    || racialSpells.length > 0
    || customSpells.length > 0

  if (!hasSpellcasting && !hasAnySpells) {
    return (
      <div style={S.tabBody}>
        <div style={S.emptyState}>
          <div style={S.emptyTitle}>No Spellcasting</div>
          <div style={S.emptyDesc}>
            No Spell Slots on this Class
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={S.tabBody}>
      {/* ── Spellcasting Stats ── */}
      {computed?.spellcasting && Object.keys(computed.spellcasting).length > 0 && (
        <Section title="Spellcasting Overview">
          {Object.entries(computed.spellcasting).map(([clsName, sc]) => (
            <div key={clsName} style={S.spellcastRow}>
              <span style={S.spellcastClass}>{clsName}</span>
              <DetailChip label="Ability" value={sc.ability.toUpperCase()} />
              <DetailChip label="Spell-Attack" value={sc.spellAttackDisplay} />
              <DetailChip label="Spell-DC" value={sc.spellSaveDC} />
            </div>
          ))}
        </Section>
      )}

      {/* ── Spell Slots ── */}
      {slots && (
        <Section title="Spell Slots">
          <div style={S.slotGrid}>
            {slots.map((max, i) => {
              const level = i + 1
              if (max === 0) return null
              const used = usedSlots[level] || 0
              const remaining = max - used
              return (
                <div key={level} style={S.slotBox}>
                  <div style={S.slotLevel}>{ordinal(level)} Level</div>
                  <div style={{ ...S.slotCount, color: remaining > 0 ? 'var(--accent)' : 'var(--accent-red)' }}>
                    {remaining} / {max}
                  </div>
                  <div style={S.slotDots}>
                    {Array.from({ length: max }, (_, j) => (
                      <span key={j} style={{
                        ...S.slotDot,
                        background: j < remaining ? 'var(--accent)' : 'var(--border)',
                      }} />
                    ))}
                  </div>
                </div>
              )
            }).filter(Boolean)}
          </div>
        </Section>
      )}

      {/* ── Warlock Pact Slots ── */}
      {warlockSlots && (
        <Section title="Pact-Magic">
          <div style={S.pactInfo}>
            <DetailChip label="Slot-Level" value={ordinal(warlockSlots.level)} />
            <DetailChip label="Slot Amount" value={warlockSlots.slots} />
            <div style={S.sideHint}>Restored after Short Rest</div>
          </div>
        </Section>
      )}

      {/* ── Cantrips ── */}
      {cantrips.length > 0 && (
        <Section title={`Cantrips (${cantrips.length})`}>
          <div style={S.spellListGrid}>
            {cantrips.map((name, i) => (
              <SpellPill key={i} level={0} name={name} />
            ))}
          </div>
        </Section>
      )}

      {/* ── Spells by Level ── */}
      {Object.entries(spellsByLevel).sort(([a], [b]) => Number(a) - Number(b)).map(([lvl, spellNames]) => (
        <Section key={lvl} title={`${ordinal(Number(lvl))} Level-Spells (${spellNames.length})`}>
          <div style={S.spellListGrid}>
            {spellNames.map((name, i) => (
              <SpellPill key={i} level={Number(lvl)} name={name} />
            ))}
          </div>
        </Section>
      ))}

      {/* ── Feat Spells ── */}
      {featSpells.length > 0 && (
        <Section title={`Feat-Spells (${featSpells.length})`}>
          <div style={S.spellListGrid}>
            {featSpells.map((name, i) => (
              <SpellPill key={i} level="F" name={name} color="#a78bfa" />
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            {character.feats.filter(f => (f.choices?.spells || []).length > 0).map(feat => {
              const spellNames = (feat.choices.spells || [])
                .map(s => typeof s === 'string' ? s : s?.name).filter(Boolean)
              return (
                <div key={feat.featId} style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 2 }}>
                  <span style={{ color: 'var(--accent-purple)', fontWeight: 'bold' }}>↳ {feat.featId}:</span> {spellNames.join(', ')}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* ── Racial / Innate Spells ── */}
      {racialSpells.length > 0 && (
        <Section title={`Species-Spells (${racialSpells.length})`}>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>
            Erhalten durch: {character.species.raceId?.split('__')[0]}
            {character.species.subraceId ? ` (${character.species.subraceId.split('__')[0]})` : ''}
          </div>
          <div style={S.spellListGrid}>
            {racialSpells.map((name, i) => (
              <SpellPill key={i} level="R" name={name} color="#34d399" />
            ))}
          </div>
        </Section>
      )}

      {/* ── Custom Spells ── */}
      {(character.custom?.spells || []).length > 0 && (
        <Section title={`Custom Spells (${character.custom.spells.length})`}>
          <div style={S.spellListGrid}>
            {character.custom.spells.map((spell, i) => (
              <SpellPill key={i} level={spell.level || '✨'} name={spell.name} color="var(--accent-purple)" />
            ))}
          </div>
          {character.custom.spells.some(s => s.grantedBy) && (
            <div style={{ marginTop: 8 }}>
              {character.custom.spells.filter(s => s.grantedBy).map(s => (
                <div key={s._id} style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 2 }}>
                  <span style={{ color: 'var(--accent-purple)', fontWeight: 'bold' }}>↳ {s.name}:</span> {s.grantedBy}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// INVENTORY TAB
// ═══════════════════════════════════════════════════════════════

function InventoryTab({ character }) {
  const currency = character.inventory?.currency || {}
  const regularItems = character.inventory?.items || []
  const customItems = (character.custom?.items || []).map(i => ({ ...i, _isCustom: true }))
  const items = [...regularItems, ...customItems]
  const totalGP = (currency.pp || 0) * 10 + (currency.gp || 0) + (currency.ep || 0) * 0.5
    + (currency.sp || 0) * 0.1 + (currency.cp || 0) * 0.01

  return (
    <div style={S.tabBody}>
      <Section title="Currency">
        <div style={S.currencyRow}>
          {[
            ['cp', 'Copper', '#b87333'],
            ['sp', 'Silver', '#c0c0c0'],
            ['ep', 'Electrum', '#7ec8e3'],
            ['gp', 'Gold', 'var(--accent)'],
            ['pp', 'Platin', '#e5e5e5'],
          ].map(([k, l, c]) => (
            <div key={k} style={S.currencyBox}>
              <div style={{ ...S.currencyValue, color: c }}>{currency[k] || 0}</div>
              <div style={S.currencyLabel}>{l}</div>
            </div>
          ))}
        </div>
        {totalGP > 0 && (
          <div style={S.totalGP}>≈ {totalGP.toFixed(1)} GP Gesamtwert</div>
        )}
      </Section>

      <Section title={`Equipment (${items.length})`}>
        {items.length === 0 ? (
          <div style={S.emptyState}>
            <div style={S.emptyTitle}>Empty</div>
            <div style={S.emptyDesc}>No items</div>
          </div>
        ) : (
          <div style={S.itemList}>
            {items.map((item, i) => (
              <div key={i} style={S.itemRow}>
                <div style={S.itemInfo}>
                  <span style={S.itemName}>{item.customName || item.name}</span>
                  {item._isCustom && <span style={{ color: 'var(--accent-purple)', fontSize: 10 }}>✨</span>}
                  {(item.isWeapon || item.isArmor || item.isShield) && (
                    <span style={S.itemType}>
                      {item.isWeapon ? '⚔️' : item.isArmor ? '🛡️' : '🔰'}
                    </span>
                  )}
                </div>
                <div style={S.itemMeta}>
                  {item.quantity > 1 && <span style={S.itemQty}>×{item.quantity}</span>}
                  {item.equipped && <span style={S.itemEquipped}>Angelegt</span>}
                  {item.attuned && <span style={S.itemAttuned}>Eingestimmt</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Attunement">
        <div style={S.attunementInfo}>
          <span>Attuned: {items.filter(i => i.attuned).length} / {character.inventory?.attunementSlots || 3}</span>
          <span style={S.sideHint}>Max. 3 magische Attunements</span>
        </div>
      </Section>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PERSONALITY TAB
// ═══════════════════════════════════════════════════════════════

function PersonalityTab({ character }) {
  const portrait = character.appearance?.portrait
  const p = character.personality || {}
  const a = character.appearance || {}

  const appearanceFields = [
    { label: 'Age', value: a.age },
    { label: 'Height', value: a.height },
    { label: 'Weight', value: a.weight },
    { label: 'Eyes', value: a.eyes },
    { label: 'Hair', value: a.hair },
    { label: 'Skin', value: a.skin },
  ].filter(f => f.value)

  const personalityFields = [
    { label: 'Personality Traits', value: p.traits, icon: '🎭' },
    { label: 'Ideals', value: p.ideals, icon: '⚖️' },
    { label: 'Bonds', value: p.bonds, icon: '🔗' },
    { label: 'Weaknesses', value: p.flaws, icon: '💔' },
  ]

  return (
    <div style={S.tabBody}>
      {/* ── Aussehen ── */}
      <Section title="Appearance">
        <div style={S.appearanceSection}>
          {portrait && (
            <div style={S.bigPortraitWrap}>
              <img src={portrait} style={S.bigPortrait} alt="Portrait" />
            </div>
          )}
          <div style={S.appearanceDetails}>
            {appearanceFields.length > 0 ? (
              <div style={S.appearanceGrid}>
                {appearanceFields.map(f => (
                  <div key={f.label} style={S.appearanceItem}>
                    <div style={S.appearanceLabel}>{f.label}</div>
                    <div style={S.appearanceValue}>{f.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={S.sideHint}>Keine Äußerlichkeiten eingetragen</div>
            )}
            {a.description && (
              <div style={{ marginTop: 12 }}>
                <div style={S.appearanceLabel}>Beschreibung</div>
                <div style={S.textBlock}>{a.description}</div>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ── Persönlichkeit ── */}
      <Section title="Personality">
        {personalityFields.some(f => f.value) ? (
          <div style={S.personalityGrid}>
            {personalityFields.map(f => f.value && (
              <div key={f.label} style={S.personalityCard}>
                <div style={S.personalityCardHeader}>
                  <span>{f.icon}</span>
                  <span style={S.personalityCardLabel}>{f.label}</span>
                </div>
                <div style={S.personalityCardText}>{f.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={S.sideHint}>No personality traits.</div>
        )}
      </Section>

      {/* ── Hintergrundgeschichte ── */}
      <Section title="Backstory">
        {p.backstory ? (
          <div style={S.textBlock}>{p.backstory}</div>
        ) : (
          <div style={S.sideHint}>No Backstory</div>
        )}
      </Section>

      {/* ── Notizen & Beziehungen ── */}
      {(p.notes || p.organizations || p.allies || p.enemies || p.treasure) && (
        <Section title="Notes, events and Connections">
          {p.organizations && <TextFieldBlock label="Organizations" value={p.organizations} />}
          {p.allies && <TextFieldBlock label="Allies" value={p.allies} />}
          {p.enemies && <TextFieldBlock label="Enemies" value={p.enemies} />}
          {p.treasure && <TextFieldBlock label="Treasure" value={p.treasure} />}
          {p.notes && <TextFieldBlock label="Notes" value={p.notes} />}
        </Section>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// HILFSKOMPONENTEN
// ═══════════════════════════════════════════════════════════════

function Section({ title, children }) {
  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>{title}</div>
      {children}
    </div>
  )
}

function SideSection({ title, children }) {
  return (
    <div style={S.sideSection}>
      <div style={S.sideSectionTitle}>{title}</div>
      {children}
    </div>
  )
}

function CombatStat({ label, value, color, icon, hint, sub }) {
  return (
    <div style={S.combatStat}>
      <div style={{ fontSize: 16 }}>{icon}</div>
      <div style={{ ...S.combatStatValue, color }}>{value}</div>
      <div style={S.combatStatLabel}>{label}</div>
      {sub && <div style={S.combatStatSub}>{sub}</div>}
    </div>
  )
}

function InfoCard({ label, value, hint }) {
  return (
    <div style={S.infoCard}>
      <div style={S.infoCardLabel}>{label}</div>
      <div style={S.infoCardValue}>{value}</div>
      {hint && <div style={S.infoCardHint}>{hint}</div>}
    </div>
  )
}

function Badge({ color, label, hint }) {
  return (
    <span style={{ ...S.badge, borderColor: color + '66', color }} title={hint}>
      {label}
    </span>
  )
}

function DetailChip({ label, value }) {
  return (
    <div style={S.detailChip}>
      <span style={S.detailChipLabel}>{label}: </span>
      <span style={S.detailChipValue}>{value}</span>
    </div>
  )
}

function TraitPill({ label, value }) {
  return (
    <div style={S.traitPill}>
      <div style={S.traitPillLabel}>{label}</div>
      <div style={S.traitPillValue}>{value}</div>
    </div>
  )
}

function ProfBlock({ label, value }) {
  return (
    <div style={S.profBlock}>
      <span style={S.profBlockLabel}>{label}: </span>
      <span style={S.profBlockValue}>{value}</span>
    </div>
  )
}

function SenseRow({ label, value }) {
  return (
    <div style={S.senseRow}>
      <span style={S.senseName}>{label}</span>
      <span style={S.senseValue}>{value}</span>
    </div>
  )
}

function SpellPill({ level, name, color }) {
  const lvlLabel = level === 0 ? 'C' : level === 'F' ? 'F' : level === 'R' ? 'R' : String(level)
  const badgeColor = color || (level === 0 ? 'var(--accent-blue)' : 'var(--accent-purple)')
  return (
    <div style={S.spellPill}>
      <span style={{ ...S.spellPillLevel, background: badgeColor + '22', color: badgeColor }}>
        {lvlLabel}
      </span>
      <span style={S.spellPillName}>{name}</span>
    </div>
  )
}

function TextFieldBlock({ label, value }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={S.appearanceLabel}>{label}</div>
      <div style={S.textBlock}>{value}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

const S = {
  // ── Page ──
  page: {
    minHeight: '100vh', background: 'var(--bg-page)', color: 'var(--text-primary)',
    display: 'flex', flexDirection: 'column',
  },

  // ── Header ──
  header: {
    background: 'var(--bg-surface)', padding: '10px 20px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    borderBottom: '2px solid var(--border)', flexShrink: 0, gap: 12, flexWrap: 'wrap',
  },
  headerBackBtn: {
    padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13,
    whiteSpace: 'nowrap',
  },
  headerCenter: { display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 200 },
  headerPortrait: {
    width: 42, height: 42, borderRadius: 8, objectFit: 'cover',
    border: '2px solid var(--accent)',
  },
  headerName: { color: 'var(--accent)', fontWeight: 'bold', fontSize: 18 },
  headerSubline: { color: 'var(--text-muted)', fontSize: 12, marginTop: 2 },
  headerRight: { display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 },
  headerBtn: {
    padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13,
  },
  exportBtn: {
    padding: '7px 14px', borderRadius: 6, border: '1px solid var(--accent-blue)',
    background: 'transparent', color: 'var(--accent-blue)', cursor: 'pointer', fontSize: 13,
  },
  exportMenu: {
    position: 'absolute', top: '110%', right: 0, background: 'var(--bg-surface)',
    border: '1px solid var(--border)', borderRadius: 8, padding: 4, zIndex: 100, minWidth: 180,
  },
  exportMenuItem: {
    display: 'block', width: '100%', padding: '8px 14px', border: 'none',
    background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13,
    textAlign: 'left', borderRadius: 6,
  },
  levelUpBtn: {
    padding: '7px 14px', borderRadius: 6, border: 'none',
    background: 'var(--accent)', color: 'var(--bg-deep)', cursor: 'pointer', fontSize: 13, fontWeight: 'bold',
  },

  // ── Combat Bar ──
  combatBar: {
    display: 'flex', background: 'var(--bg-panel)',
    borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap',
  },
  combatStat: {
    flex: 1, minWidth: 100, padding: '10px 12px', textAlign: 'center',
    borderRight: '1px solid var(--border-subtle)',
  },
  combatStatValue: { fontSize: 22, fontWeight: 'bold', marginTop: 2 },
  combatStatLabel: { color: 'var(--text-muted)', fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  combatStatSub: { color: 'var(--accent-green)', fontSize: 10 },

  // ── Body ──
  body: { display: 'flex', flex: 1, overflow: 'hidden' },

  // ── Sidebar ──
  sidebar: {
    width: 250, flexShrink: 0, background: 'var(--bg-card)',
    borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '12px',
  },
  sidePortrait: { marginBottom: 16, textAlign: 'center' },
  sidePortraitImg: {
    width: 150, height: 150, objectFit: 'cover', borderRadius: 12,
    border: '2px solid var(--border)',
  },
  sideSection: { marginBottom: 18 },
  sideSectionTitle: {
    color: 'var(--accent)', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid var(--border-subtle)',
  },
  sideHint: { color: 'var(--text-dim)', fontSize: 10, marginTop: 6, fontStyle: 'italic' },

  // ── Ability Scores ──
  abilityGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 },
  abilityBox: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '8px 4px', textAlign: 'center', transition: 'border-color 0.2s',
    cursor: 'default',
  },
  abilityAbbr: { color: 'var(--text-muted)', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
  abilityMod: { color: 'var(--accent)', fontSize: 18, fontWeight: 'bold' },
  abilityScore: { color: 'var(--text-secondary)', fontSize: 12 },
  abilityBreakdown: {
    display: 'flex', gap: 2, justifyContent: 'center', marginTop: 2,
    fontSize: 9, color: 'var(--text-muted)',
  },
  abilityLegend: {
    display: 'flex', gap: 8, justifyContent: 'center', marginTop: 6,
    fontSize: 9,
  },

  // ── Saving Throws ──
  saveRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  profDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  saveName: { color: 'var(--text-muted)', fontSize: 12, flex: 1 },
  saveValue: { color: 'var(--text-primary)', fontSize: 12, fontWeight: 'bold' },

  // ── Skills ──
  skillRow: { display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 },
  skillName: { color: 'var(--text-muted)', fontSize: 11, flex: 1 },
  skillAbility: { color: 'var(--text-dim)', fontSize: 10 },
  skillValue: { fontSize: 11, fontWeight: 'bold' },

  // ── Proficiencies ──
  profBlock: { marginBottom: 6 },
  profBlockLabel: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 'bold' },
  profBlockValue: { color: 'var(--text-secondary)', fontSize: 11 },

  // ── Senses ──
  senseRow: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 },
  senseName: { color: 'var(--text-muted)', fontSize: 11 },
  senseValue: { color: 'var(--text-primary)', fontSize: 11, fontWeight: 'bold' },

  // ── Main Content ──
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  tabs: {
    display: 'flex', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
    flexShrink: 0, overflowX: 'auto',
  },
  tab: {
    padding: '12px 18px', border: 'none', background: 'transparent',
    color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, borderBottom: '2px solid transparent',
    whiteSpace: 'nowrap', transition: 'color 0.2s',
  },
  tabActive: { color: 'var(--accent)', borderBottom: '2px solid var(--accent)' },
  tabContent: { flex: 1, overflowY: 'auto' },
  tabBody: { padding: '20px 24px' },

  // ── Section ──
  section: { marginBottom: 28 },
  sectionTitle: {
    color: 'var(--accent)', fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: 12, paddingBottom: 6,
    borderBottom: '1px solid var(--border-subtle)',
  },

  // ── Identity Grid ──
  identityGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10,
  },
  infoCard: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '10px 14px',
  },
  infoCardLabel: { color: 'var(--text-muted)', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoCardValue: { color: 'var(--text-primary)', fontSize: 15, fontWeight: 'bold', marginTop: 2 },
  infoCardHint: { color: 'var(--text-dim)', fontSize: 10, marginTop: 2 },

  // ── Class Cards ──
  classCard: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10,
    padding: '14px 18px', marginBottom: 8,
  },
  classCardHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    gap: 12, flexWrap: 'wrap',
  },
  classCardName: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 18 },
  classCardLevel: { color: 'var(--accent)', fontSize: 13, marginTop: 2 },
  classCardBadges: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  classCardDetails: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 },
  badge: {
    border: '1px solid', borderRadius: 6, padding: '3px 10px',
    fontSize: 12, fontWeight: 'bold',
  },
  detailChip: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '4px 10px', fontSize: 12,
  },
  detailChipLabel: { color: 'var(--text-muted)' },
  detailChipValue: { color: 'var(--accent)', fontWeight: 'bold' },

  // ── HP Section ──
  hpSection: { display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' },
  hpMain: {
    background: 'var(--bg-elevated)', border: '2px solid #f87171', borderRadius: 12,
    padding: '16px 24px', textAlign: 'center', minWidth: 100,
  },
  hpLabel: { color: 'var(--accent-red)', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase' },
  hpValue: { color: 'var(--text-primary)', fontSize: 32, fontWeight: 'bold' },
  hpDetails: { display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1 },

  // ── Death Saves ──
  deathSaves: {
    display: 'flex', gap: 20, marginTop: 16, padding: '10px 14px',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
  },
  deathSaveRow: { display: 'flex', alignItems: 'center', gap: 6 },
  deathSaveLabel: { color: 'var(--text-muted)', fontSize: 12, marginRight: 4 },
  deathSaveDot: { width: 14, height: 14, borderRadius: '50%', border: '1px solid #3a5a7a' },

  // ── Attacks ──
  attackTableWrap: { overflowX: 'auto' },
  attackTable: { width: '100%', borderCollapse: 'collapse', minWidth: 500 },
  th: {
    background: 'var(--bg-elevated)', color: 'var(--accent)', padding: '8px 12px',
    textAlign: 'left', fontSize: 12, fontWeight: 'bold',
  },
  td: { color: 'var(--text-secondary)', padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 },

  // ── Spellcasting ──
  spellcastRow: {
    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
    flexWrap: 'wrap',
  },
  spellcastClass: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 14, minWidth: 80 },

  // ── Resources ──
  resourceGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 },
  resourceBox: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '10px 14px',
  },
  resourceName: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13, marginBottom: 4 },
  resourceValue: { color: 'var(--accent)', fontSize: 16, fontWeight: 'bold' },
  resourceRecharge: { color: 'var(--text-muted)', fontSize: 11, marginTop: 2 },

  // ── Spell Slots ──
  slotGrid: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  slotBox: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '8px 14px', textAlign: 'center', minWidth: 80,
  },
  slotLevel: { color: 'var(--text-muted)', fontSize: 10, marginBottom: 4, fontWeight: 'bold' },
  slotCount: { fontWeight: 'bold', fontSize: 16 },
  slotDots: { display: 'flex', gap: 3, justifyContent: 'center', marginTop: 4 },
  slotDot: { width: 8, height: 8, borderRadius: '50%' },

  // ── Pact ──
  pactInfo: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },

  // ── Spell List ──
  spellListGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 },
  spellPill: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px',
  },
  spellPillLevel: {
    fontSize: 10, fontWeight: 'bold', padding: '2px 6px', borderRadius: 4, flexShrink: 0,
  },
  spellPillName: { color: 'var(--text-secondary)', fontSize: 13 },

  // ── Features ──
  featureCard: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10,
    overflow: 'hidden', marginBottom: 8,
  },
  featureCardHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
  },
  featureCardName: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 16 },
  featureCardSource: { color: 'var(--text-muted)', fontSize: 11 },
  featureCardBody: { padding: '12px 16px' },

  traitGrid: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  traitPill: {
    background: 'var(--bg-highlight)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '4px 10px', textAlign: 'center',
  },
  traitPillLabel: { color: 'var(--text-muted)', fontSize: 10 },
  traitPillValue: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 },

  traitLine: { marginBottom: 6 },
  traitLineLabel: { color: 'var(--text-muted)', fontSize: 12, fontWeight: 'bold', marginRight: 6 },
  traitLineValue: { color: 'var(--text-secondary)', fontSize: 13 },

  asiBlock: { marginTop: 8, marginBottom: 4 },
  asiLabel: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 'bold', marginBottom: 4 },
  asiValues: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  asiBadge: {
    background: 'var(--accent-green)', border: '1px solid #34d399', color: 'var(--accent-green)',
    borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 'bold',
  },

  skillBadge: {
    background: 'var(--border-subtle)', border: '1px solid #69db7c44', borderRadius: 6,
    padding: '4px 10px', color: 'var(--accent-green)', fontSize: 12,
  },

  featurePlaceholder: {
    color: 'var(--text-dim)', fontSize: 13, fontStyle: 'italic', padding: '8px 0', marginTop: 8,
  },

  // ── Feat Cards ──
  featCard: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '12px 16px', marginBottom: 8,
  },
  featCardHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
  },
  featCardName: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 },
  featCardSource: { color: 'var(--text-muted)', fontSize: 11 },
  featCardBonuses: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 },
  featBonusBadge: {
    background: 'var(--bg-hover)', border: '1px solid var(--accent-purple)', borderRadius: 6,
    padding: '2px 8px', color: 'var(--accent-purple)', fontSize: 12,
  },
  originTag: {
    background: 'var(--accent-purple)', color: 'var(--accent-purple)', fontSize: 9, fontWeight: 'bold',
    padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.5,
  },

  // ── Currency ──
  currencyRow: { display: 'flex', gap: 10 },
  currencyBox: {
    flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: 10, textAlign: 'center',
  },
  currencyLabel: { color: 'var(--text-muted)', fontSize: 11, marginTop: 2 },
  currencyValue: { fontWeight: 'bold', fontSize: 20 },
  totalGP: { color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', marginTop: 8 },

  // ── Items ──
  itemList: { borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' },
  itemRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 14px', borderBottom: '1px solid var(--border-subtle)',
    background: 'var(--bg-elevated)',
  },
  itemInfo: { display: 'flex', alignItems: 'center', gap: 8 },
  itemName: { color: 'var(--text-secondary)', fontSize: 13 },
  itemType: { fontSize: 12 },
  itemMeta: { display: 'flex', gap: 6 },
  itemQty: { color: 'var(--text-muted)', fontSize: 12 },
  itemEquipped: {
    background: 'var(--border-subtle)', color: 'var(--accent-green)', fontSize: 11,
    padding: '2px 8px', borderRadius: 4,
  },
  itemAttuned: {
    background: 'var(--bg-hover)', color: 'var(--accent-purple)', fontSize: 11,
    padding: '2px 8px', borderRadius: 4,
  },
  attunementInfo: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '10px 14px', display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', color: 'var(--text-secondary)', fontSize: 13,
  },

  // ── Personality ──
  appearanceSection: { display: 'flex', gap: 20, flexWrap: 'wrap' },
  bigPortraitWrap: { flexShrink: 0 },
  bigPortrait: {
    width: 180, height: 180, objectFit: 'cover', borderRadius: 12,
    border: '2px solid var(--border)',
  },
  appearanceDetails: { flex: 1, minWidth: 200 },
  appearanceGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 },
  appearanceItem: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '6px 10px',
  },
  appearanceLabel: { color: 'var(--text-muted)', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5 },
  appearanceValue: { color: 'var(--text-primary)', fontSize: 14, marginTop: 2 },
  personalityGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 },
  personalityCard: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '12px 14px',
  },
  personalityCardHeader: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 },
  personalityCardLabel: { color: 'var(--accent)', fontSize: 12, fontWeight: 'bold' },
  personalityCardText: { color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' },
  textBlock: {
    color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '12px 16px',
  },

  // ── Empty State ──
  emptyState: { textAlign: 'center', padding: '32px 16px' },
  emptyIcon: { fontSize: 40, marginBottom: 8 },
  emptyTitle: { color: 'var(--text-muted)', fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  emptyDesc: { color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.5 },
}