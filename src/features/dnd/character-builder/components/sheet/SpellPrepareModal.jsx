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

  // ── Spell-Pool für diesen Modal ─────────────────────────────
  // Wizard: nur Spellbook-Einträge (knownSpells).
  // Andere prepared Caster: alle Klassen-Listen-Spells ≤ maxSpellLvl.
  const visibleSpells = useMemo(() => {
    if (!spellMap) return []
    if (isWizard) {
      const names = wizardCls?.knownSpells || []
      return names
        .map(n => spellMap.get(String(n).toLowerCase()))
        .filter(Boolean)
        // Cantrips raus — die werden separat über cantripsKnown / das
        // Cantrip-Slot-System verwaltet, gehören nicht ins Spellbook.
        .filter(s => (s.level ?? 0) > 0)
    }
    const want = String(classId).toLowerCase()
    return (allSpells || []).filter(s =>
      (s.level ?? 0) > 0 &&
      (s.level ?? 0) <= maxSpellLvl &&
      (s.classes || []).some(cn => String(cn).toLowerCase() === want),
    )
  }, [spellMap, allSpells, isWizard, wizardCls, classId, maxSpellLvl])

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sorted.map(sp => {
              const prepped = isPreppedByMe(sp.name)
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
              return (
                <div key={sp.name} style={spellRow}>
                  <button
                    type="button"
                    onClick={() => togglePrep(sp.name, sp.level)}
                    disabled={overPrepLimit}
                    style={togglePill(prepped, overPrepLimit)}
                    title={prepped ? 'Prepared — klick zum Unpreparen'
                      : overPrepLimit ? 'Prep-Limit erreicht'
                      : 'Klick zum Preparen'}
                  >{prepped ? '●' : '○'}</button>
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
                </div>
              )
            })}
          </div>
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
function togglePill(active, disabled) {
  return {
    width: 20, height: 20, borderRadius: '50%',
    background: active ? 'var(--accent-green)' : 'transparent',
    color: active ? 'var(--bg-base, #111)' : (disabled ? 'var(--text-dim)' : 'var(--accent-green)'),
    border: `1.5px solid ${disabled ? 'var(--text-dim)' : 'var(--accent-green)'}`,
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
