// GenericJsonEditor.jsx
//
// Fallback-Editor für Kinds ohne dedizierte Form (Backgrounds /
// Creatures / Features). Zeigt Name + Source + Entries + alles andere
// als raw-JSON-Textarea damit der Spieler 5etools-konforme Felder
// manuell setzen kann. Wer die Vorlage über "Aus Vorlage laden" pickt
// bekommt alle Felder vorbefüllt und muss nur anpassen.

import { useState, useMemo, useEffect } from 'react'
import EntryRenderer from '../../../character-builder/components/ui/EntryRenderer'

export default function GenericJsonEditor({ entry, onSave, onCancel }) {
  const [name, setName] = useState(entry.name || '')
  const [source, setSource] = useState(entry.source || 'HB')

  // Restliche Felder als JSON-Textarea — alles AUSSER name, source,
  // entries und _localMeta wird hier editiert.
  const initialRest = useMemo(() => {
    const { name: _n, source: _s, entries: _e, _localMeta: _m, ...rest } = entry
    return JSON.stringify(rest, null, 2)
  }, [entry])
  const [restJson, setRestJson] = useState(initialRest)
  useEffect(() => { setRestJson(initialRest) }, [initialRest])

  const initialEntries = useMemo(() => {
    if (!Array.isArray(entry.entries)) return ''
    return entry.entries.map(e => typeof e === 'string' ? e : JSON.stringify(e, null, 2)).join('\n\n')
  }, [entry])
  const [entriesText, setEntriesText] = useState(initialEntries)

  const [jsonError, setJsonError] = useState(null)

  function commit() {
    let parsedRest = {}
    try {
      parsedRest = JSON.parse(restJson || '{}')
    } catch (e) {
      setJsonError('JSON-Fehler im Extra-Felder-Block: ' + e.message)
      return
    }
    // Entries: jede Doppelzeile = Eintrag. Wenn ein Eintrag mit `{` startet
    // wird er als JSON-Objekt geparsed (5etools list/table-Blöcke).
    const entries = []
    for (const chunk of entriesText.split(/\n\n+/)) {
      const t = chunk.trim()
      if (!t) continue
      if (t.startsWith('{') || t.startsWith('[')) {
        try { entries.push(JSON.parse(t)) }
        catch { entries.push(t) }
      } else {
        entries.push(t)
      }
    }
    setJsonError(null)
    onSave({
      ...parsedRest,
      name: name.trim() || 'Unbenannt',
      source: source.trim() || 'HB',
      entries,
      _localMeta: entry._localMeta || {},
    })
  }

  // Live-Preview der Entries (falls valid).
  const previewEntries = useMemo(() => {
    const arr = []
    for (const chunk of entriesText.split(/\n\n+/)) {
      const t = chunk.trim()
      if (!t) continue
      if (t.startsWith('{') || t.startsWith('[')) {
        try { arr.push(JSON.parse(t)) } catch { arr.push(t) }
      } else arr.push(t)
    }
    return arr
  }, [entriesText])

  return (
    <div style={ed.wrap}>
      <div style={ed.headerRow}>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="Name" style={{ ...ed.input, flex: 1, fontSize: 18, fontWeight: 700 }} />
        <input value={source} onChange={e => setSource(e.target.value)}
          placeholder="Source (z.B. HB-MILES)" style={{ ...ed.input, width: 160 }} />
      </div>

      <div style={ed.section}>
        <div style={ed.label}>Beschreibung (Entries)</div>
        <div style={ed.hint}>
          Jeder Absatz wird ein eigener Eintrag. Für Listen/Tabellen ein
          JSON-Objekt (5etools-Shape) als Block einfügen.
        </div>
        <textarea value={entriesText} onChange={e => setEntriesText(e.target.value)}
          rows={10} style={{ ...ed.textarea, fontFamily: 'inherit' }} />
      </div>

      <div style={ed.section}>
        <div style={ed.label}>Extra-Felder (5etools-Shape, JSON)</div>
        <div style={ed.hint}>
          Alle weiteren Felder die 5etools für diese Kind definiert (level,
          skillProficiencies, ability, ac, hp, cr, …). JSON wird beim
          Speichern auf Validität geprüft.
        </div>
        <textarea value={restJson} onChange={e => setRestJson(e.target.value)}
          rows={14} style={{ ...ed.textarea, fontFamily: 'var(--font-mono, monospace)' }} />
      </div>

      {jsonError && <div style={ed.error}>{jsonError}</div>}

      <div style={ed.preview}>
        <div style={ed.label}>Vorschau</div>
        <div style={{
          padding: '10px 14px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)', borderRadius: 8,
        }}>
          <div style={{ fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>
            {name || '(unbenannt)'}
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-dim)' }}>{source}</span>
          </div>
          {previewEntries.length > 0 && <EntryRenderer entries={previewEntries} />}
        </div>
      </div>

      <div style={ed.footer}>
        <button type="button" onClick={onCancel} style={ed.cancelBtn}>Abbrechen</button>
        <button type="button" onClick={commit} style={ed.saveBtn}>Speichern</button>
      </div>
    </div>
  )
}

const ed = {
  wrap: {
    padding: 20, borderRadius: 12,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    marginBottom: 16,
  },
  headerRow: { display: 'flex', gap: 8, marginBottom: 16 },
  section: { marginBottom: 16 },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  hint: { fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 },
  input: {
    padding: '8px 12px', fontSize: 13,
    background: 'var(--bg-inset)', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 6,
    fontFamily: 'inherit',
  },
  textarea: {
    width: '100%', padding: '8px 12px', fontSize: 12,
    background: 'var(--bg-inset)', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 6,
    lineHeight: 1.5, resize: 'vertical',
  },
  error: {
    padding: '8px 12px', borderRadius: 6,
    background: 'color-mix(in srgb, var(--accent-red) 14%, transparent)',
    border: '1px solid var(--accent-red)',
    color: 'var(--accent-red)', fontSize: 12, marginBottom: 12,
  },
  preview: { marginBottom: 16 },
  footer: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  cancelBtn: {
    padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'transparent', color: 'var(--text-secondary)',
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
  },
  saveBtn: {
    padding: '8px 20px', borderRadius: 8, border: '2px solid var(--accent)',
    background: 'var(--accent)', color: 'var(--bg-base, #111)',
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
  },
}
