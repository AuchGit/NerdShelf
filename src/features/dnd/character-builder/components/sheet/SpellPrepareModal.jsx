// SpellPrepareModal.jsx
//
// Modal Spell-Vorbereitung. Wird über die per-Klasse-Pille im Spells-
// Spalten-Header geöffnet. Kommt in zwei Varianten:
//   • Standard ("Prepare ClassName")   — Cleric, Druid, Paladin,
//     Artificer, Ranger: zeigt die volle Klassen-Spell-Liste bis
//     zum max. preparbaren Level, Toggle pro Spell.
//   • Spellbook (Wizard)               — zeigt nur was im Spellbook
//     steht (cls.knownSpells), plus ein "+ Lernen"-Knopf der ein
//     Sub-Modal mit allen scribebaren Wizard-Spells öffnet (Kosten
//     gemäß 5e RAW: 50gp × Level, halbiert bei Subclass-Savant).
//
// Cross-Class-Markierungen: pro Spell-Zeile zeigen wir die Kürzel
// der ANDEREN Caster-Klassen die diesen Spell auch auf ihrer Liste
// haben — gefüllt wenn dort prepped, hohl wenn nur verfügbar.

import { useEffect, useMemo, useState } from 'react'
import { SheetModal } from './SheetKit'
import { loadSpellList } from '../../lib/dataLoader'
import { getScribingDiscounts, getScribingCost } from '../../lib/wizardScribing'
import { collectCharacterSpells } from '../../lib/sheetUtils'
import { useExtraSpellNames } from '../../lib/useExtraSpellNames'
import EntryRendererLazy from '../ui/EntryRenderer'

export default function SpellPrepareModal({
  open, onClose,
  character, computed, classId,
  casterClasses, classAbbr,
  preparedByClass,
  maxSpellLvl,
  updateCharacter, applyCharacter,
  prepWithClass,
}) {
  const edition = character?.meta?.edition || '5e'
  const isWizard = classId === 'Wizard'
  const cc = casterClasses.find(c => c.classId === classId)
  const max = cc?.info?.maxPrepared || 0
  const current = (preparedByClass[classId] || []).length

  // Wizard-Klasse aus dem Charakter (für knownSpells = Spellbook).
  const wizardCls = useMemo(
    () => (character?.classes || []).find(c => c.classId === 'Wizard') || null,
    [character?.classes],
  )

  // Spell-Katalog laden — brauchen wir für Cross-Class-Listen + Wizard-
  // Lernen-Submenu. Modal-only, also lazy.
  const [allSpells, setAllSpells] = useState([])
  const [spellMap,  setSpellMap]  = useState(null)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    loadSpellList(edition).then(list => {
      if (cancelled) return
      const m = new Map()
      for (const s of list) m.set(s.name.toLowerCase(), s)
      setSpellMap(m)
      setAllSpells(list)
    }).catch(() => { if (!cancelled) { setSpellMap(new Map()); setAllSpells([]) } })
    return () => { cancelled = true }
  }, [open, edition])

  // Discounts werden datengetrieben aus den hydrierten Subclass-
  // Features gelesen — Evocation Savant etc.
  const scribingDiscounts = useMemo(() => getScribingDiscounts(character), [character])

  // Always-prepared Spells (race/feat/subclass-domain/etc. grants):
  // erscheinen IM Picker — visuell durch eine andere Toggle-Farbe vom
  // normalen Class-List-Spell unterschieden. Können zusätzlich
  // prepped werden damit der Spieler einen Slot dafür reserviert.
  const alwaysPreparedSet = useMemo(() => {
    const set = new Set()
    for (const entry of (collectCharacterSpells(character) || [])) {
      // granted=true ⇒ race / feat / subclass-domain / custom: always-castable
      if (entry?.granted && entry?.name) set.add(entry.name.toLowerCase())
    }
    return set
  }, [character])

  // Homebrew-Spell-Listen: Zauber, die dieser Charakter zusätzlich zur
  // offiziellen Klassenliste vorbereiten darf — direkt zugeordnet oder über
  // eine Homebrew-Rasse / einen Background / ein Feature / ein Item.
  const extraSpellNames = useExtraSpellNames(character, classId)

  // ── Spell-Pool für diesen Modal ─────────────────────────────
  // Wizard: nur Spellbook-Einträge (knownSpells).
  // Andere prepared Caster: alle Klassen-Listen-Spells ≤ maxSpellLvl,
  // PLUS alle always-prepared Spells (auch wenn nicht auf der
  // Klassenliste — z.B. Hellish Rebuke via Tiefling für eine Cleric).
  const visibleSpells = useMemo(() => {
    if (!spellMap) return []
    if (isWizard) {
      const names = wizardCls?.knownSpells || []
      const wizSpells = names
        .map(n => spellMap.get(String(n).toLowerCase()))
        .filter(Boolean)
        .filter(s => (s.level ?? 0) > 0)
      // Auch Wizard kann always-prepared Spells haben (Tome of the
      // Stilled Tongue, racial …). Mit reinmischen — genauso die Zauber
      // aus zugeordneten Homebrew-Spell-Listen (sie erweitern den Zugriff
      // unabhängig vom Spellbook).
      const seen = new Set(wizSpells.map(s => s.name.toLowerCase()))
      for (const lower of [...alwaysPreparedSet, ...extraSpellNames]) {
        if (seen.has(lower)) continue
        const sp = spellMap.get(lower)
        if (sp && (sp.level ?? 0) > 0) { wizSpells.push(sp); seen.add(lower) }
      }
      return wizSpells
    }
    const want = String(classId).toLowerCase()
    const onClassList = (allSpells || []).filter(s =>
      (s.level ?? 0) > 0 &&
      (s.level ?? 0) <= maxSpellLvl &&
      (s.classes || []).some(cn => String(cn).toLowerCase() === want),
    )
    // Always-prepared Spells die NICHT auf der Klassenliste stehen
    // werden zusätzlich angehängt — der maxSpellLvl-Cap gilt aber,
    // damit eine L9-Race-Granted-Spell den Cleric-L1 Modal nicht
    // mit unzugänglichen Optionen flutet.
    const seen = new Set(onClassList.map(s => s.name.toLowerCase()))
    const extras = []
    for (const lower of [...alwaysPreparedSet, ...extraSpellNames]) {
      if (seen.has(lower)) continue
      const sp = spellMap.get(lower)
      if (sp && (sp.level ?? 0) > 0 && (sp.level ?? 0) <= maxSpellLvl) { extras.push(sp); seen.add(lower) }
    }
    return [...onClassList, ...extras]
  }, [spellMap, allSpells, isWizard, wizardCls, classId, maxSpellLvl, alwaysPreparedSet, extraSpellNames])

  // Sortierung: prepared zuerst, dann nach Level, dann alphabetisch.
  const sorted = useMemo(() => {
    const myPrepSet = new Set((preparedByClass[classId] || []).map(n => n.toLowerCase()))
    return [...visibleSpells].sort((a, b) => {
      const ap = myPrepSet.has(a.name.toLowerCase()) ? 0 : 1
      const bp = myPrepSet.has(b.name.toLowerCase()) ? 0 : 1
      if (ap !== bp) return ap - bp
      if (a.level !== b.level) return a.level - b.level
      return a.name.localeCompare(b.name)
    })
  }, [visibleSpells, preparedByClass, classId])

  // ── Filter / Suche ─────────────────────────────────────────
  const [searchText, setSearchText] = useState('')
  const [levelFilter, setLevelFilter] = useState(null)
  const [concFilter,  setConcFilter]  = useState(false)
  const [ritFilter,   setRitFilter]   = useState(false)
  // Levels die in der visibleSpells-Liste tatsächlich vorkommen.
  const availableLevels = useMemo(() => {
    const set = new Set(visibleSpells.map(s => s.level))
    return [...set].sort((a, b) => a - b)
  }, [visibleSpells])
  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    return sorted.filter(s => {
      if (q && !s.name.toLowerCase().includes(q)) return false
      if (levelFilter !== null && s.level !== levelFilter) return false
      if (concFilter && !s.concentration) return false
      if (ritFilter && !s.ritual) return false
      return true
    })
  }, [sorted, searchText, levelFilter, concFilter, ritFilter])

  function isPreppedByMe(spellName) {
    return (preparedByClass[classId] || []).some(n => n.toLowerCase() === spellName.toLowerCase())
  }
  function togglePrep(spellName, spellLevel) {
    if (spellLevel === 0) return
    // Vorhandenes prepWithClass aus dem Parent: kümmert sich um
    // Mutually-Exclusive zwischen Klassen.
    prepWithClass({ key: spellName.toLowerCase(), spell: { name: spellName, level: spellLevel }, always: false, knownByClass: new Set([classId]) }, classId)
  }

  // ── Wizard "+ Lernen"-Sub-Modal ─────────────────────────────
  const [learningOpen, setLearningOpen] = useState(false)
  // Inline-Spell-Expand: ein Spell pro Modal kann seine Description
  // aufgeklappt zeigen. Klick irgendwo auf die Spell-Zeile (außer dem
  // Prep-Toggle / Cross-Class-Pills) toggled.
  const [expandedSpell, setExpandedSpell] = useState(null)

  return (
    <>
      <SheetModal
        open={open}
        onClose={onClose}
        title={
          isWizard
            ? `${classId} · Spellbook${max ? ` (${current}/${max} prepared)` : ''}`
            : `${classId} · Prepare${max ? ` (${current}/${max})` : ''}`
        }
        width={720}
        footer={
          isWizard ? (
            <button
              type="button"
              onClick={() => setLearningOpen(true)}
              style={btnPrimary}
              title="Neuen Zauber ins Spellbook lernen (kostet Gold)"
            >+ Lernen</button>
          ) : null
        }
      >
        {!spellMap ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 2px' }}>Lade Spell-Liste…</div>
        ) : sorted.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 2px' }}>
            {isWizard
              ? 'Spellbook ist leer — nutze "+ Lernen" um den ersten Zauber zu lernen.'
              : 'Keine Spells auf der Klassenliste verfügbar.'}
          </div>
        ) : (
          <>
            {/* Suche + Level/Konz/Ritual-Filter */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              <input
                type="text" value={searchText}
                onChange={e => setSearchText(e.target.value)}
                placeholder="Spell suchen…"
                style={{
                  width: '100%', padding: '6px 10px', fontSize: 12,
                  background: 'var(--bg-inset)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', borderRadius: 6,
                  fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                <button type="button" onClick={() => setLevelFilter(null)} style={filterChip(levelFilter === null)}>Alle</button>
                {availableLevels.map(lv => (
                  <button key={lv} type="button"
                    onClick={() => setLevelFilter(levelFilter === lv ? null : lv)}
                    style={filterChip(levelFilter === lv)}
                  >L{lv}</button>
                ))}
                <span style={{ width: 8 }} />
                <button type="button"
                  onClick={() => setConcFilter(v => !v)}
                  style={filterChip(concFilter)}
                  title="Nur Konzentrations-Spells"
                >K Konz.</button>
                <button type="button"
                  onClick={() => setRitFilter(v => !v)}
                  style={filterChip(ritFilter)}
                  title="Nur Ritual-Spells"
                >R Ritual</button>
                <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontSize: 11, alignSelf: 'center' }}>
                  {filtered.length} / {sorted.length}
                </span>
              </div>
            </div>
            {filtered.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 2px' }}>
                Keine Spells passen zu den Filtern.
              </div>
            ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filtered.map(sp => {
              const prepped = isPreppedByMe(sp.name)
              const isAlways = alwaysPreparedSet.has(sp.name.toLowerCase())
              const overPrepLimit = !prepped && max > 0 && current >= max
              // Cross-Class-Marker: andere Caster-Klassen, die diesen
              // Spell auch auf ihrer Liste haben. Gefüllt = dort
              // prepared, hohl = nur verfügbar. Wizard-Spells aus dem
              // Spellbook werden weiterhin gegen die generische
              // 5etools-Klassenliste geprüft, weil sie für Cross-Class
              // (z.B. "Cleric hat den auch") gleich behandelt werden.
              const otherClasses = casterClasses
                .filter(c => c.classId !== classId)
                .filter(c => (sp.classes || []).some(cn => String(cn).toLowerCase() === c.classId.toLowerCase()))
              const isExpanded = expandedSpell === sp.name
              return (
                <div key={sp.name} style={{ display: 'flex', flexDirection: 'column' }}>
                  <div
                    style={{ ...spellRow, cursor: 'pointer' }}
                    onClick={() => setExpandedSpell(prev => prev === sp.name ? null : sp.name)}
                  >
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); togglePrep(sp.name, sp.level) }}
                      disabled={overPrepLimit}
                      style={togglePill(prepped, overPrepLimit, isAlways)}
                      title={isAlways
                        ? (prepped
                            ? 'Always Prepared (race/feat/feature) — zusätzlich vorbereitet · klick zum Entfernen'
                            : 'Always Prepared (race/feat/feature) — klick um zusätzlich zu preparen')
                        : prepped ? 'Prepared — klick zum Unpreparen'
                        : overPrepLimit ? 'Prep-Limit erreicht'
                        : 'Klick zum Preparen'}
                    >{isAlways ? '◆' : prepped ? '●' : '○'}</button>
                    <span style={spellName}>{sp.name}</span>
                    <span style={spellLevelTag}>L{sp.level}</span>
                    {otherClasses.length > 0 && (
                      <span style={{ display: 'inline-flex', gap: 2 }}>
                        {otherClasses.map(c => {
                          const cid = c.classId
                          const preppedThere = (preparedByClass[cid] || []).some(n => n.toLowerCase() === sp.name.toLowerCase())
                          return (
                            <span
                              key={cid}
                              style={crossClassPill(preppedThere)}
                              title={preppedThere
                                ? `${cid} hat ${sp.name} prepared`
                                : `${cid} hat ${sp.name} auf der Klassenliste`}
                            >{classAbbr[cid] || cid.slice(0, 1).toUpperCase()}</span>
                          )
                        })}
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontSize: 11 }}>
                      {isExpanded ? '▼' : '▶'}
                    </span>
                  </div>
                  {isExpanded && (
                    <div style={{
                      padding: '6px 10px 10px 36px',
                      fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)',
                      borderLeft: '2px solid var(--border-subtle)',
                      marginLeft: 12,
                    }}>
                      <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
                        {[
                          sp.castingTime && `Cast ${sp.castingTime}`,
                          sp.range && `Range ${sp.range}`,
                          sp.duration && `Duration ${sp.duration}`,
                          sp.school && `School ${sp.school}`,
                        ].filter(Boolean).join(' · ')}
                      </div>
                      {Array.isArray(sp.entries) && sp.entries.length > 0 && (
                        <EntryRendererLazy entries={sp.entries} />
                      )}
                      {Array.isArray(sp.entriesHigherLevel) && sp.entriesHigherLevel.length > 0 && (
                        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border-subtle)' }}>
                          <EntryRendererLazy entries={
                            sp.entriesHigherLevel.length === 1
                              && sp.entriesHigherLevel[0]?.entries
                              && sp.entriesHigherLevel[0]?.type === 'entries'
                              ? sp.entriesHigherLevel[0].entries
                              : sp.entriesHigherLevel
                          } />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            </div>
            )}
          </>
        )}
      </SheetModal>

      {isWizard && (
        <ScribeNewSpellSubmodal
          open={learningOpen}
          onClose={() => setLearningOpen(false)}
          character={character}
          wizardCls={wizardCls}
          allSpells={allSpells}
          spellMap={spellMap}
          discounts={scribingDiscounts}
          updateCharacter={updateCharacter}
          applyCharacter={applyCharacter}
        />
      )}
    </>
  )
}

// ── Wizard "+ Lernen"-Sub-Modal ────────────────────────────────
// Listet alle Wizard-Spells die NICHT im Spellbook sind, mit
// 5e-RAW-Kosten (50gp × Level, halbiert wenn der Subclass-Savant
// die School matcht). Klick "Lernen" → Gold abziehen, Spell zum
// Spellbook hinzufügen.
function ScribeNewSpellSubmodal({
  open, onClose,
  character, wizardCls,
  allSpells, spellMap, discounts,
  updateCharacter, applyCharacter,
}) {
  const [search, setSearch] = useState('')
  const [filterLevel, setFilterLevel] = useState('all')

  // Bereits gelernt → ausblenden. Lowercased Set für O(1)-Lookup.
  const knownSet = useMemo(() => {
    const s = new Set()
    for (const n of (wizardCls?.knownSpells || [])) s.add(String(n).toLowerCase())
    return s
  }, [wizardCls])

  // Max-Level den der Wizard scribed darf = Spell-Slot-Level den er
  // sich casten könnte. Hier vereinfacht ans Class-Level gekoppelt:
  // Spell-Level = ceil(classLevel / 2), gecappt bei 9.
  // (Echte 5e-Regel: nur Spells für die du auch Slots hast. Beim
  // Wizard ist das genau diese Formel.)
  const wizardLevel = wizardCls?.level || 0
  const maxScribeLevel = Math.min(9, Math.ceil(wizardLevel / 2))

  const availableSpells = useMemo(() => {
    return (allSpells || []).filter(sp => {
      if ((sp.level ?? 0) < 1 || (sp.level ?? 0) > maxScribeLevel) return false
      if (!(sp.classes || []).some(cn => String(cn).toLowerCase() === 'wizard')) return false
      if (knownSet.has(sp.name.toLowerCase())) return false
      if (search && !sp.name.toLowerCase().includes(search.toLowerCase())) return false
      if (filterLevel !== 'all' && sp.level !== Number(filterLevel)) return false
      return true
    }).sort((a, b) => (a.level - b.level) || a.name.localeCompare(b.name))
  }, [allSpells, knownSet, maxScribeLevel, search, filterLevel])

  const playerGold = character?.inventory?.currency?.gp || 0

  function learnSpell(sp) {
    const cost = getScribingCost(sp, discounts)
    if (!cost) return
    if (playerGold < cost.gp) {
      window.alert(`Nicht genug Gold (${playerGold} gp) — Kosten: ${cost.gp} gp.`)
      return
    }
    if (!applyCharacter) return
    applyCharacter(d => {
      if (!d.inventory) d.inventory = { currency: {} }
      if (!d.inventory.currency) d.inventory.currency = {}
      d.inventory.currency.gp = Math.max(0, (d.inventory.currency.gp || 0) - cost.gp)
      const wcls = (d.classes || []).find(c => c.classId === 'Wizard')
      if (wcls) {
        wcls.knownSpells = [...(wcls.knownSpells || []), sp.name]
      }
    }, { changedPaths: ['inventory.currency.gp', 'classes'] })
  }

  if (!spellMap) return null

  return (
    <SheetModal
      open={open}
      onClose={onClose}
      title={`Neuen Zauber lernen — Gold: ${playerGold} gp`}
      width={760}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text" placeholder="Suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={searchInput}
        />
        <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)} style={searchInput}>
          <option value="all">Alle Levels</option>
          {Array.from({ length: maxScribeLevel }, (_, i) => i + 1).map(lv => (
            <option key={lv} value={lv}>Level {lv}</option>
          ))}
        </select>
        {discounts.halvedSchools.size > 0 && (
          <span style={{ fontSize: 11, color: 'var(--accent-green)' }}>
            Halbe Kosten: {[...discounts.halvedSchools].join(', ')}
          </span>
        )}
      </div>
      {availableSpells.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 2px' }}>
          Keine Spells, die in dein Spellbook passen.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 480, overflowY: 'auto' }}>
          {availableSpells.map(sp => {
            const cost = getScribingCost(sp, discounts)
            const canAfford = cost && playerGold >= cost.gp
            return (
              <div key={sp.name} style={spellRow}>
                <span style={spellName}>{sp.name}</span>
                <span style={spellLevelTag}>L{sp.level}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {String(sp.school || '').toUpperCase()}
                </span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    color: cost?.halved ? 'var(--accent-green)' : 'var(--text-primary)',
                  }}>
                    {cost ? `${cost.gp} gp` : '—'}{cost?.halved ? ' ½' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => learnSpell(sp)}
                    disabled={!canAfford}
                    style={canAfford ? btnPrimary : btnDisabled}
                    title={canAfford ? `Lernen für ${cost.gp} gp` : 'Nicht genug Gold'}
                  >Lernen</button>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </SheetModal>
  )
}

// ── Styles ──────────────────────────────────────────────────────
const spellRow = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '4px 8px', borderRadius: 6,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)',
  fontSize: 12,
}
const spellName = { flex: 1, minWidth: 0, fontWeight: 600, color: 'var(--text-primary)' }
const spellLevelTag = {
  fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
  padding: '1px 6px', borderRadius: 4,
  background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)',
}
function togglePill(active, disabled, isAlways = false) {
  // Always-prepared: blau (◆). Spieler kann zusätzlich preparen ⇒
  // dann zeigt die Pille FÜLLUNG blau plus den Rahmen gelb-bestätigt.
  // Normaler Prep: grün (●).
  const baseColor = isAlways ? 'var(--accent-blue)' : 'var(--accent-green)'
  const filledTextColor = 'var(--bg-base, #111)'
  return {
    width: 20, height: 20, borderRadius: '50%',
    background: active ? baseColor : 'transparent',
    color: active ? filledTextColor : (disabled ? 'var(--text-dim)' : baseColor),
    border: `1.5px solid ${disabled ? 'var(--text-dim)' : baseColor}`,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 13, lineHeight: 1, fontWeight: 700,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, fontFamily: 'inherit',
    opacity: disabled ? 0.4 : 1,
  }
}
function crossClassPill(preppedThere) {
  return {
    minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
    background: preppedThere ? 'var(--accent)' : 'transparent',
    color: preppedThere ? 'var(--bg-base, #111)' : 'var(--text-dim)',
    border: `1px solid ${preppedThere ? 'var(--accent)' : 'var(--text-dim)'}`,
    fontSize: 9, fontWeight: 800,
    lineHeight: 1, fontFamily: 'inherit',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
}
const btnPrimary = {
  padding: '4px 10px', fontSize: 11, fontWeight: 700,
  background: 'var(--accent)', color: 'var(--bg-base, #111)',
  border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
}
const btnDisabled = {
  ...btnPrimary, background: 'var(--bg-elevated)', color: 'var(--text-dim)',
  cursor: 'not-allowed', opacity: 0.6,
}
const searchInput = {
  padding: '4px 8px', fontSize: 12,
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'inherit',
}
function filterChip(active) {
  return {
    padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 700,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    cursor: 'pointer', fontFamily: 'inherit',
  }
}
