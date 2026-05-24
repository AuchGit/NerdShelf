import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from '../lib/hashNav'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n'
import { computeCharacter, computeAbilityScores, computeModifiers } from '../lib/rulesEngine'
import { getProficiencyBonus, getTotalLevel } from '../lib/characterModel'
import { downloadFoundryJSON } from '../lib/foundryExport'
import { parseTags } from '../lib/tagParser'
import { undoLastLevelUp } from '../lib/levelUpEngine'
import HeaderButtons from '../components/ui/HeaderButtons'
import CustomEditModal from '../components/ui/CustomEditModal'
import usePwaMobile from '../../../../shared/hooks/usePwaMobile'
import { ActionSheet } from '../../../../shared/ui'
import { SideSection, ProfBlock, SenseRow } from '../components/sheet/SheetKit'
import { S } from '../components/sheet/sheetStyles'
import OverviewTab from '../components/sheet/OverviewTab'
import SpellsTab from '../components/sheet/SpellsTab'
import InventoryTab from '../components/sheet/InventoryTab'
import FeaturesTab from '../components/sheet/FeaturesTab'
import PersonalityTab from '../components/sheet/PersonalityTab'
import { modStr, formatToolName, formatSkillName } from '../lib/sheetUtils'
import './CharacterSheetPage.css'

const TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'spells',      label: 'Spells' },
  { id: 'inventory',   label: 'Inventory' },
  { id: 'features',    label: 'Features' },
  { id: 'personality', label: 'Personality' },
]

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function CharacterSheetPage({ session, readOnly = false, characterId, campaignId, fromSession = false }) {
  const params = useParams()
  const id = characterId || params.id
  // Sheet opened from the GM session overview should return there rather than
  // to the campaign detail — keeps the GM in their session flow.
  const backTo = readOnly && campaignId
    ? (fromSession ? `/campaign/${campaignId}/session` : `/campaign/${campaignId}`)
    : '/'
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [character, setCharacter] = useState(null)
  const [computed, setComputed] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showCustomEdit, setShowCustomEdit] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const { isPwaMobile } = usePwaMobile()
  const saveTimer = useRef(null)
  const portraitRef = useRef(null)

  useEffect(() => { loadCharacter() }, [id])
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  async function loadCharacter() {
    // Read-only (GM) load relies on RLS: the GM may SELECT member characters
    // but never filters by user_id. The owner path keeps the user_id filter.
    let query = supabase.from('dnd_characters').select('*').eq('id', id)
    if (!readOnly) query = query.eq('user_id', session.user.id)
    const { data, error } = await query.single()
    if (error || !data) { navigate(backTo); return }

    // Read-only viewers never touch the level-up backup machinery.
    if (readOnly) {
      setCharacter(data.data)
      setComputed(computeCharacter(data.data))
      setLoading(false)
      return
    }

    // Restore an unsaved level-up backup if one is newer than the saved data.
    try {
      const backupKey = `dndbuilder_backup_${id}`
      const backupRaw = localStorage.getItem(backupKey)
      if (backupRaw) {
        const backup = JSON.parse(backupRaw)
        const backupLevel = (backup.updated?.classes || []).reduce((s, c) => s + (c.level || 0), 0)
        const savedLevel = (data.data.classes || []).reduce((s, c) => s + (c.level || 0), 0)
        if (backupLevel !== savedLevel && backup.updated) {
          const age = Date.now() - new Date(backup.timestamp).getTime()
          if (age < 24 * 60 * 60 * 1000) {
            const restore = window.confirm(
              `Ein nicht gespeichertes Level-Up wurde gefunden (${new Date(backup.timestamp).toLocaleString('de-DE')}).\n\n` +
              `Gespeichert: Level ${savedLevel}\nBackup: Level ${backupLevel}\n\nBackup wiederherstellen?`
            )
            if (restore) {
              const { error: restoreErr } = await supabase.from('dnd_characters')
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
          localStorage.removeItem(backupKey)
        }
      }
    } catch { /* localStorage unavailable */ }

    setCharacter(data.data)
    setComputed(computeCharacter(data.data))
    setLoading(false)
  }

  // ── Persistence ───────────────────────────────────────────
  // Debounced so rapid in-play edits (HP ticks, slot pips) collapse
  // into a single Supabase write.
  function queueSave(next) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      supabase.from('dnd_characters')
        .update({ data: next, name: next.info?.name || '' })
        .eq('id', id).eq('user_id', session.user.id)
        .then(({ error }) => { if (error) console.error('[Sheet Save]', error) })
    }, 700)
  }

  // Apply an arbitrary mutation to a fresh draft, recompute, persist.
  // In read-only (GM) mode every mutation is a no-op — nothing is editable.
  function applyCharacter(mutator) {
    if (readOnly) return
    setCharacter(prev => {
      const next = structuredClone(prev)
      mutator(next)
      setComputed(computeCharacter(next))
      queueSave(next)
      return next
    })
  }

  // Set a single dotted path (creates intermediate objects as needed).
  function updateCharacter(path, value) {
    applyCharacter(d => {
      const parts = path.split('.')
      let obj = d
      for (let i = 0; i < parts.length - 1; i++) {
        if (obj[parts[i]] == null || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {}
        obj = obj[parts[i]]
      }
      obj[parts[parts.length - 1]] = value
    })
  }

  // ── Rests ─────────────────────────────────────────────────
  function shortRest() {
    if (!window.confirm('Take a short rest? Restores Pact Magic slots and short-rest resources.')) return
    applyCharacter(d => {
      if (!d.status) d.status = {}
      d.status.usedPactSlots = 0
      const used = { ...(d.status.usedResources || {}) }
      for (const res of (computed?.resources || [])) {
        if (res.recharge === 'short_rest') delete used[res.id]
      }
      d.status.usedResources = used
    })
  }

  function longRest() {
    if (!window.confirm('Take a long rest? Restores HP, spell slots and all resources.')) return
    const maxHp = Math.max(1, (computed?.hp?.max || 1) + (character.status?.maxHpBonus || 0))
    applyCharacter(d => {
      if (!d.status) d.status = {}
      d.status.usedSpellSlots = {}
      d.status.usedPactSlots = 0
      d.status.usedResources = {}
      d.status.currentHp = maxHp
      d.status.temporaryHp = 0
      d.status.deathSaves = { successes: 0, failures: 0 }
      d.status.concentration = null
    })
  }

  // ── Portrait ──────────────────────────────────────────────
  function handlePortrait(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => updateCharacter('appearance.portrait', ev.target.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  function commitName() {
    setEditingName(false)
    const v = nameDraft.trim()
    if (v && v !== character.info.name) updateCharacter('info.name', v)
  }

  // ── Level Down (unchanged behaviour) ──────────────────────
  async function levelDown() {
    const h = character.levelHistory || []
    const last = h[h.length - 1]
    if (!last?.snapshot) return
    const cls = character.classes.find(c => c.classId === last.classId)
    const lc = cls?.levelChoices?.[last.classLevel] || {}
    const parts = [`${last.classId} Lv.${last.classLevel}`]
    if (lc.type === 'asi') parts.push('ASI: ' + Object.entries(lc.improvements || {}).map(([k, v]) => `${k.toUpperCase()} +${v}`).join(', '))
    if (lc.type === 'feat') parts.push(`Feat: ${lc.featId}`)
    if (lc.cantrips?.length) parts.push(`${lc.cantrips.length} Cantrips`)
    if (lc.knownSpells?.length) parts.push(`${lc.knownSpells.length} Spells`)
    if (lc.optionalFeatures?.length) parts.push(lc.optionalFeatures.map(f => f.name).join(', '))
    for (const [fn, sp] of Object.entries(lc.optFeatureSpells || {})) { if (sp?.length) parts.push(`${fn}: ${sp.join(', ')}`) }
    if (!window.confirm(`Level Down rückgängig machen?\n\n${parts.join('\n')}`)) return

    const restored = undoLastLevelUp(character)
    if (!restored) { alert('Kein Snapshot verfügbar.'); return }
    if (character.appearance?.portrait)
      restored.appearance = { ...(restored.appearance || {}), portrait: character.appearance.portrait }

    try { localStorage.setItem(`dndbuilder_backup_${id}`, JSON.stringify({ timestamp: new Date().toISOString(), previous: character, updated: restored })) } catch { /* ignore */ }
    let saved = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error: e } = await supabase.from('dnd_characters').update({ data: restored, name: restored.info.name })
        .eq('id', id).eq('user_id', session.user.id)
      if (!e) { saved = true; break }
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500))
    }
    if (!saved) { alert('Level Down fehlgeschlagen. Dein Charakter ist lokal gesichert.'); return }
    try { localStorage.removeItem(`dndbuilder_backup_${id}`) } catch { /* ignore */ }
    loadCharacter()
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 80, fontSize: 16 }}>{t('loading')}</div>
  if (!character) return null

  const abilityScores = computeAbilityScores(character)
  const modifiers     = computeModifiers(abilityScores)
  const totalLevel    = getTotalLevel(character)
  const profBonus     = getProficiencyBonus(character)
  // Effective max HP = rules-engine max + a manual adjustment the player can
  // tweak on the sheet (magic items, Aid, DM rulings, …).
  const baseMaxHp     = computed?.hp?.max || 1
  const maxHpBonus    = character.status?.maxHpBonus || 0
  const effMaxHp      = Math.max(1, baseMaxHp + maxHpBonus)
  const hp            = {
    max: effMaxHp,
    current: character.status?.currentHp ?? effMaxHp,
    temporary: character.status?.temporaryHp || 0,
  }
  const ac            = computed?.ac?.total || 10
  const initiative    = computed?.initiative ?? modifiers.dex
  const speed         = computed?.speed?.walk || character.species?.speed || 30
  const raceName      = character.species.raceId?.split('__')[0] || '—'
  const subraceName   = character.species.subraceId?.split('__')[0] || ''
  const speciesDisplay = subraceName ? `${subraceName} (${raceName})` : raceName
  const className     = character.classes.map(c => `${c.classId} ${c.level}`).join(' / ')
  const portrait      = character.appearance?.portrait
  const inspiration   = character.status?.inspiration || character.info?.inspiration || false

  return (
    <div className="dnd-sheet-root" style={S.page}>
      <input ref={portraitRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePortrait} />

      {/* ═══ HEADER ═══ */}
      {isPwaMobile ? (
        <div data-pwa-target="dnd-sheet-header" style={S.headerMobile}>
          <button type="button" style={S.headerIconBtn} onClick={() => navigate(backTo)} aria-label="Zurück" title="Zurück">←</button>
          <div style={S.headerMobileTitle}>
            {portrait
              ? <img src={portrait} style={S.headerMobilePortrait} alt="" onClick={readOnly ? undefined : () => portraitRef.current?.click()} />
              : <div style={{ ...S.headerMobilePortrait, ...S.headerPortraitEmpty, width: 34, height: 34, fontSize: 14 }} onClick={readOnly ? undefined : () => portraitRef.current?.click()}>+</div>}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ ...S.headerName, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {character.info.name || 'Unbenannt'}
              </div>
              <div style={{ ...S.headerSubline, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {className} · L{totalLevel}{readOnly ? ' · Nur Lesen' : ''}
              </div>
            </div>
          </div>
          <button type="button" style={S.headerIconBtn} onClick={() => setShowMobileMenu(true)} aria-label="Optionen" title="Optionen">⋯</button>
        </div>
      ) : (
        <div data-pwa-target="dnd-sheet-header" style={S.header}>
          <button style={S.headerBackBtn} onClick={() => navigate(backTo)}>
            {readOnly && campaignId ? '← Campaign' : '← Dashboard'}
          </button>

          <div style={S.headerCenter}>
            {portrait
              ? <img src={portrait} style={S.headerPortrait} alt="Portrait" title={readOnly ? '' : 'Portrait ändern'} onClick={readOnly ? undefined : () => portraitRef.current?.click()} />
              : (readOnly
                  ? <div style={S.headerPortraitEmpty}>—</div>
                  : <div style={S.headerPortraitEmpty} title="Portrait hinzufügen" onClick={() => portraitRef.current?.click()}>+</div>)}
            <div style={{ minWidth: 0 }}>
              {readOnly ? (
                <div style={S.headerName}>{character.info.name || 'Unbenannt'}</div>
              ) : editingName ? (
                <input
                  autoFocus value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false) }}
                  style={S.headerNameInput}
                />
              ) : (
                <div style={{ ...S.headerName, cursor: 'pointer' }} title="Name ändern"
                  onClick={() => { setNameDraft(character.info.name || ''); setEditingName(true) }}>
                  {character.info.name || 'Unbenannt'} <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>✎</span>
                </div>
              )}
              <div style={S.headerSubline}>
                {speciesDisplay} · {className} · Level {totalLevel}
                {character.info.alignment && ` · ${character.info.alignment}`}
                {readOnly && <span style={{ color: 'var(--accent-yellow)' }}> · Spielleiter-Ansicht (Nur Lesen)</span>}
              </div>
            </div>
          </div>

          <div style={S.headerRight}>
            <div style={{ position: 'relative' }}>
              <button style={S.exportBtn} onClick={() => setShowExportMenu(v => !v)}>Export</button>
              {showExportMenu && (
                <div style={S.exportMenu}>
                  <button style={S.exportMenuItem}
                    onClick={async () => { await downloadFoundryJSON(character); setShowExportMenu(false) }}>
                    FoundryVTT (.json)
                  </button>
                </div>
              )}
            </div>
            {!readOnly && (
              <>
                <button style={S.levelUpBtn} onClick={() => navigate(`/character/${id}/levelup`)}>Level Up</button>
                <button style={{ ...S.headerBtn, borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}
                  onClick={() => setShowCustomEdit(true)}>Custom</button>
                {totalLevel === 1 && (
                  <button style={S.headerBtn} onClick={() => navigate(`/character/${id}/edit`)}>Bearbeiten</button>
                )}
                {(character.levelHistory || []).length > 0 && (
                  <button style={{ ...S.headerBtn, borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}
                    onClick={levelDown}>Level Down</button>
                )}
              </>
            )}
            <HeaderButtons session={session} />
          </div>
        </div>
      )}

      {/* Mobile overflow menu */}
      <ActionSheet
        open={showMobileMenu}
        onClose={() => setShowMobileMenu(false)}
        title={character.info.name || 'Charakter'}
        items={readOnly ? [
          { id: 'export', label: 'Foundry-Export', icon: '⬇',
            onSelect: async () => { await downloadFoundryJSON(character) } },
        ] : [
          { id: 'rename', label: 'Name ändern', icon: 'Aa',
            onSelect: () => {
              const v = window.prompt('Charaktername:', character.info.name || '')
              if (v != null && v.trim()) updateCharacter('info.name', v.trim())
            } },
          { id: 'portrait', label: 'Portrait ändern', icon: '▣',
            onSelect: () => portraitRef.current?.click() },
          { id: 'levelup', label: 'Level Up', icon: '＋',
            onSelect: () => navigate(`/character/${id}/levelup`) },
          { id: 'custom', label: 'Custom Edit', icon: '✦',
            onSelect: () => setShowCustomEdit(true) },
          ...(totalLevel === 1 ? [{
            id: 'edit', label: 'Bearbeiten', icon: '✎',
            onSelect: () => navigate(`/character/${id}/edit`),
          }] : []),
          { id: 'export', label: 'Foundry-Export', icon: '⬇',
            onSelect: async () => { await downloadFoundryJSON(character) } },
          ...((character.levelHistory || []).length > 0 ? [{
            id: 'leveldown', label: 'Level Down', icon: '↩', danger: true,
            onSelect: levelDown,
          }] : []),
        ]}
      />

      {showCustomEdit && (
        <CustomEditModal
          onClose={() => setShowCustomEdit(false)}
          character={character}
          updateCharacter={updateCharacter}
        />
      )}

      {/* ═══ COMBAT BAR ═══ */}
      <div style={S.combatBar}>
        <CombatStat label="Armor Class" value={ac} color="var(--accent-blue)" />
        <CombatStat label="Initiative" value={modStr(initiative)} color="var(--accent-purple)" />
        <CombatStat label="Speed" value={`${speed} ft.`} color="var(--accent-green)" />
        <CombatStat label="Hit Points" value={`${hp.current}/${hp.max}`} color="var(--accent-red)"
          sub={hp.temporary ? `+${hp.temporary} temp` : null} onClick={() => setActiveTab('overview')} />
        <CombatStat label="Proficiency" value={modStr(profBonus)} color="var(--accent-yellow)" />
        <CombatStat label="Passive Perception" value={computed?.passivePerception ?? 10} color="var(--text-muted)" />
      </div>

      {/* ═══ PLAY TOOLBAR ═══ */}
      {readOnly ? (
        <div style={{ ...S.playBar, color: 'var(--accent-yellow)', fontSize: 12 }}>
          Spielleiter-Ansicht — schreibgeschützt. Änderungen werden nicht gespeichert.
        </div>
      ) : (
        <div style={S.playBar}>
          <button type="button" style={S.playBtn} onClick={shortRest}>Short Rest</button>
          <button type="button" style={S.playBtn} onClick={longRest}>Long Rest</button>
          <button type="button"
            style={{
              ...S.playBtn,
              borderColor: inspiration ? 'var(--accent-yellow)' : 'var(--border)',
              color: inspiration ? 'var(--accent-yellow)' : 'var(--text-secondary)',
            }}
            onClick={() => updateCharacter('status.inspiration', !inspiration)}>
            Inspiration: {inspiration ? 'On' : 'Off'}
          </button>
        </div>
      )}

      {/* ═══ BODY ═══ */}
      <div className="dnd-sheet-body" style={S.body}>
        {/* ── SIDEBAR ── */}
        <div className="dnd-sheet-sidebar" style={S.sidebar}>
          {portrait && (
            <div style={S.sidePortrait}>
              <img src={portrait} style={S.sidePortraitImg} alt="Portrait" className="dnd-sheet-portrait"
                onClick={() => portraitRef.current?.click()} title="Portrait ändern" />
            </div>
          )}

          <SideSection title="Ability Scores" defaultOpen>
            <div style={S.abilityGrid}>
              {['str','dex','con','int','wis','cha'].map(key => {
                const score = abilityScores[key]
                const mod = modifiers[key]
                const base = character.abilityScores.base[key] || 8
                const racial = character.species?.abilityScoreImprovements?.[key] || 0
                const bg = character.background?.abilityScoreImprovements?.[key] || 0
                const featBonus = (character.feats || []).reduce((sum, f) =>
                  sum + (f.abilityBonus?.[key] || 0) + (f.choices?.abilityBonus?.[key] || 0), 0)
                const hasBonuses = racial || bg || featBonus
                return (
                  <div key={key} style={S.abilityBox}>
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

          <SideSection title="Saving Throws">
            {computed && Object.entries(computed.savingThrows).map(([key, save]) => (
              <div key={key} style={S.saveRow}>
                <span style={{ ...S.profDot, background: save.proficient ? 'var(--accent)' : 'var(--border-strong)' }} />
                <span style={S.saveName}>{key.toUpperCase()}</span>
                <span style={S.saveValue}>{modStr(save.total)}</span>
              </div>
            ))}
          </SideSection>

          <SideSection title="Skills">
            {computed && Object.entries(computed.skills).map(([skill, data]) => {
              const dotColor = data.proficiency === 'expertise' ? 'var(--accent)'
                : data.proficiency === 'proficient' ? 'var(--accent-green)' : 'var(--border-strong)'
              return (
                <div key={skill} style={S.skillRow}>
                  <span style={{ ...S.profDot, background: dotColor }} title={
                    data.proficiency === 'expertise' ? 'Expertise'
                    : data.proficiency === 'proficient' ? 'Proficient' : 'Not Proficient'
                  } />
                  <span style={S.skillName}>
                    {formatSkillName(skill)}
                    <span style={S.skillAbility}> ({data.ability.toUpperCase()})</span>
                  </span>
                  <span style={{ ...S.skillValue, color: data.proficiency ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                    {modStr(data.total)}
                  </span>
                </div>
              )
            })}
            <div style={S.sideHint}>
              <span style={{ color: 'var(--accent-green)' }}>● Proficient</span>
              {' · '}
              <span style={{ color: 'var(--accent)' }}>● Expertise</span>
            </div>
          </SideSection>

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

          <SideSection title="Senses">
            <SenseRow label="Passive Perception" value={computed?.passivePerception ?? 10} />
            <SenseRow label="Passive Investigation" value={computed?.passiveInvestigation ?? 10} />
            <SenseRow label="Passive Insight" value={computed?.passiveInsight ?? 10} />
            {character.species?.darkvision && (
              <SenseRow label="Darkvision" value={`${character.species.darkvision} ft.`} />
            )}
          </SideSection>
        </div>

        {/* ── MAIN ── */}
        <div className="dnd-sheet-main" style={S.main}>
          <div data-pwa-target="dnd-sheet-tabs" style={S.tabs}>
            {TABS.map(tab => (
              <button key={tab.id}
                style={{ ...S.tab, ...(activeTab === tab.id ? S.tabActive : {}) }}
                onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>

          <div style={S.tabContent}>
            {activeTab === 'overview' && (
              <OverviewTab character={character} computed={computed} abilityScores={abilityScores}
                hp={hp} updateCharacter={updateCharacter} applyCharacter={applyCharacter}
                charId={id} session={session} onReload={loadCharacter} />
            )}
            {activeTab === 'spells' && (
              <SpellsTab character={character} computed={computed}
                updateCharacter={updateCharacter} applyCharacter={applyCharacter} />
            )}
            {activeTab === 'inventory' && (
              <InventoryTab character={character} computed={computed}
                updateCharacter={updateCharacter} applyCharacter={applyCharacter} />
            )}
            {activeTab === 'features' && <FeaturesTab character={character} />}
            {activeTab === 'personality' && (
              <PersonalityTab character={character} updateCharacter={updateCharacter} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// COMBAT STAT
// ═══════════════════════════════════════════════════════════════

function CombatStat({ label, value, color, sub, onClick }) {
  return (
    <div
      style={{ ...S.combatStat, ...(onClick ? S.combatStatBtn : {}) }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      title={onClick ? 'Zu den Trefferpunkten' : undefined}
    >
      <div style={{ ...S.combatStatValue, color }}>{value}</div>
      <div style={S.combatStatLabel}>{label}</div>
      {sub && <div style={S.combatStatSub}>{sub}</div>}
    </div>
  )
}
