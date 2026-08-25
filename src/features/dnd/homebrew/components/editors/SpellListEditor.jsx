// SpellListEditor.jsx
//
// Editor für eine Homebrew-SPELL-LISTE: eine benannte Sammlung von
// Zaubern, die die wählbaren Zauber eines Charakters erweitert.
//
// Die Liste wirkt dort, wo ein Spieler Zauber wählt:
//   • Prepared Caster → die Zauber erscheinen im Vorbereiten-Dialog
//   • Known Caster    → beim Lernen (Level-Up / Charaktererstellung)
//
// An den Charakter kommt sie entweder direkt (Sheet) oder über einen
// anderen Homebrew-Eintrag (Rasse / Background / Feature / Item), der sie
// referenziert — siehe lib/characterSpellLists.js.

import { useEffect, useMemo, useState } from 'react'
import { Section, ek } from './editorKit'
import { loadSpellList, loadClassList } from '../../../character-builder/lib/dataLoader'

const LEVEL_LABEL = (l) => (l === 0 ? 'Cantrip' : `Grad ${l}`)

export default function SpellListEditor({ entry, onSave, onCancel }) {
  const [name, setName] = useState(entry?.name || '')
  const [source, setSource] = useState(entry?.source || 'HB')
  const [description, setDescription] = useState(
    Array.isArray(entry?.entries) ? entry.entries.filter(e => typeof e === 'string').join('\n\n') : '',
  )
  // Zaubernamen im Original-Casing merken; verglichen wird lowercase.
  const [spells, setSpells] = useState(() => (entry?.spells || []).map(String))
  const [classes, setClasses] = useState(() => (entry?.classes || []).map(String))

  const [edition, setEdition] = useState('5.5e')
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState(null)

  // Katalog samt der Edition speichern, für die er geladen wurde — so ist
  // „lädt gerade" ein abgeleiteter Zustand und beim Editionswechsel blitzt
  // nie kurz der Katalog der alten Edition auf.
  const [data, setData] = useState(null) // { edition, catalog, classOpts }
  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadSpellList(edition).catch(() => []),
      loadClassList(edition).catch(() => []),
    ]).then(([sp, cl]) => {
      if (cancelled) return
      setData({
        edition,
        catalog: sp || [],
        classOpts: [...new Set((cl || []).map(c => c?.name).filter(Boolean))].sort(),
      })
    })
    return () => { cancelled = true }
  }, [edition])
  const ready = data?.edition === edition
  const loading = !ready
  const catalog = useMemo(() => (ready ? data.catalog : []), [ready, data])
  const classOpts = useMemo(() => (ready ? data.classOpts : []), [ready, data])

  const chosen = useMemo(() => new Set(spells.map(s => s.toLowerCase())), [spells])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = catalog
    if (levelFilter !== null) list = list.filter(s => (s.level ?? 0) === levelFilter)
    if (q) list = list.filter(s => String(s.name).toLowerCase().includes(q))
    // Gewählte zuerst, damit man die Auswahl im Blick behält.
    return [...list].sort((a, b) => {
      const ac = chosen.has(String(a.name).toLowerCase()) ? 0 : 1
      const bc = chosen.has(String(b.name).toLowerCase()) ? 0 : 1
      if (ac !== bc) return ac - bc
      if ((a.level ?? 0) !== (b.level ?? 0)) return (a.level ?? 0) - (b.level ?? 0)
      return String(a.name).localeCompare(String(b.name))
    }).slice(0, 300)
  }, [catalog, search, levelFilter, chosen])

  const availableLevels = useMemo(
    () => [...new Set(catalog.map(s => s.level ?? 0))].sort((a, b) => a - b),
    [catalog],
  )

  function toggleSpell(spellName) {
    const lower = String(spellName).toLowerCase()
    setSpells(cur => (cur.some(s => s.toLowerCase() === lower)
      ? cur.filter(s => s.toLowerCase() !== lower)
      : [...cur, String(spellName)]))
  }
  function toggleClass(c) {
    setClasses(cur => (cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c]))
  }

  function commit() {
    if (!name.trim()) { alert('Bitte einen Namen für die Liste eingeben.'); return }
    const out = {
      name: name.trim(),
      source: source.trim() || 'HB',
      spells,
      _localMeta: entry?._localMeta || {},
    }
    if (classes.length) out.classes = classes
    if (description.trim()) {
      out.entries = description.split(/\n\n+/).map(s => s.trim()).filter(Boolean)
    }
    // spellListIds ergeben an einer Liste keinen Sinn, aber ein über den
    // JSON-Editor gesetztes Feld soll nicht stillschweigend verloren gehen.
    if (Array.isArray(entry?.spellListIds) && entry.spellListIds.length) {
      out.spellListIds = entry.spellListIds
    }
    onSave(out)
  }

  return (
    <div style={ek.wrap}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="Name der Liste (z.B. Grimoire des Barons)"
          style={{ ...ek.input, flex: 1, fontSize: 18, fontWeight: 700 }} />
        <input value={source} onChange={e => setSource(e.target.value)}
          placeholder="Source" style={{ ...ek.input, width: 160 }} />
      </div>

      <Section title="Wirkung" accent="#9ece6a"
        subtitle="Wo diese Liste greift, sobald ein Charakter sie hat">
        <div style={{ fontSize: 12, color: '#9aa3b4', lineHeight: 1.6 }}>
          Vorbereitende Zauberwirker (Cleric, Druid, Paladin, Ranger, Artificer)
          können die Zauber im Vorbereiten-Dialog auswählen. Klassen, die Zauber
          fest lernen (Bard, Sorcerer, Warlock, Wizard), bekommen sie beim
          Level-Up und bei der Charaktererstellung zur Auswahl angeboten.
          <br />
          Zuordnen kannst du die Liste direkt am Charakter oder — dauerhaft —
          an einer Homebrew-Rasse, einem Background, einem Feature oder einem
          Item: wer den Eintrag hat, bekommt die Zauber automatisch dazu.
        </div>
      </Section>

      <Section title="Klassen-Beschränkung (optional)" accent="#7aa2f7"
        subtitle={classes.length
          ? 'Die Liste erweitert nur die gewählten Klassen.'
          : 'Ohne Auswahl gilt die Liste für jede Zauberklasse des Charakters.'}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {classOpts.map(c => (
            <button key={c} type="button" onClick={() => toggleClass(c)}
              style={classes.includes(c) ? ek.chipOn : ek.chip}>{c}</button>
          ))}
        </div>
      </Section>

      <Section title={`Zauber (${spells.length})`} accent="#b07afe"
        subtitle="Aus dem vollständigen Katalog wählen — eigene Homebrew-Zauber stehen mit drin"
        actions={spells.length > 0 && (
          <button type="button" onClick={() => setSpells([])} style={ek.miniBtn}>Alle entfernen</button>
        )}>
        {spells.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
            {spells.map(s => (
              <button key={s} type="button" onClick={() => toggleSpell(s)}
                title="Aus der Liste entfernen" style={ek.chipOn}>{s} ×</button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          <select value={edition} onChange={e => setEdition(e.target.value)} style={{ ...ek.input, width: 150 }}>
            <option value="5e">5e (PHB / TCE)</option>
            <option value="5.5e">5.5e (XPHB)</option>
          </select>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Zauber suchen…" style={{ ...ek.input, flex: 1, minWidth: 160 }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          <button type="button" onClick={() => setLevelFilter(null)}
            style={levelFilter === null ? ek.chipOn : ek.chip}>Alle</button>
          {availableLevels.map(l => (
            <button key={l} type="button" onClick={() => setLevelFilter(l)}
              style={levelFilter === l ? ek.chipOn : ek.chip}>{LEVEL_LABEL(l)}</button>
          ))}
        </div>

        {loading ? (
          <div style={ek.empty}>Lädt Zauber-Katalog…</div>
        ) : filtered.length === 0 ? (
          <div style={ek.empty}>Kein Zauber gefunden.</div>
        ) : (
          <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filtered.map(s => {
              const on = chosen.has(String(s.name).toLowerCase())
              return (
                <button key={s.id || `${s.name}-${s.source}`} type="button"
                  onClick={() => toggleSpell(s.name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                    padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 12,
                    background: on ? 'color-mix(in srgb, #b07afe 18%, transparent)' : '#0f1115',
                    border: `1px solid ${on ? '#b07afe' : '#2a3040'}`,
                    color: on ? '#e6e8ee' : '#9aa3b4',
                  }}>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: on ? 700 : 400 }}>{s.name}</span>
                  <span style={{ fontSize: 10, color: '#6b7386', flexShrink: 0 }}>
                    {LEVEL_LABEL(s.level ?? 0)}{s.source ? ` · ${s.source}` : ''}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </Section>

      <Section title="Beschreibung (optional)" accent="#9aa3b4">
        <textarea value={description} onChange={e => setDescription(e.target.value)}
          rows={3} placeholder="Woher stammt diese Liste? (nur Fluff — keine Mechanik)"
          style={{ ...ek.input, resize: 'vertical' }} />
      </Section>

      <div style={ek.footer}>
        <button type="button" onClick={onCancel} style={ek.cancelBtn}>Abbrechen</button>
        <button type="button" onClick={commit} style={ek.saveBtn}>Speichern</button>
      </div>
    </div>
  )
}
