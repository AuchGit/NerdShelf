// HomebrewPage.jsx
//
// Local-first Homebrew-Editor. Tab pro Kind (Items, Spells,
// Backgrounds, Creatures, Features). Pro Tab eine Liste der eigenen
// Einträge + "Neu anlegen" + "Aus Template laden". Edit öffnet eine
// strukturierte Form (5etools-Shape) damit der Eintrag direkt vom
// Programm konsumiert werden kann.

import { useState, useEffect, useMemo, useCallback } from 'react'
import DndSubNav from '../../character-builder/components/ui/DndSubNav'
import {
  HOMEBREW_KINDS,
  listHomebrew,
  saveHomebrew,
  deleteHomebrew,
} from '../lib/homebrewStore'
import {
  loadItemIndex,
  loadSpellList,
  loadBackgroundList,
  loadRaceList,
  loadOptionalFeatureList,
  loadCreatureList,
} from '../../character-builder/lib/dataLoader'
import ItemEditor from '../components/editors/ItemEditor'
import SpellEditor from '../components/editors/SpellEditor'
import FeatureEditor from '../components/editors/FeatureEditor'
import RaceEditor from '../components/editors/RaceEditor'
import BackgroundEditor from '../components/editors/BackgroundEditor'
import CreatureEditor from '../components/editors/CreatureEditor'
import GenericJsonEditor from '../components/editors/GenericJsonEditor'
import EntryRenderer from '../../character-builder/components/ui/EntryRenderer'
import { listPublic, importPublic } from '../lib/homebrewSync'
import { setHomebrewPublic, ensureShareToken, revokeShareToken, importByToken } from '../lib/homebrewStore'
import { validationCounts } from '../lib/homebrewValidate'

const KIND_LABELS = {
  items:       'Items',
  spells:      'Spells',
  backgrounds: 'Backgrounds',
  races:       'Races',
  creatures:   'Creatures',
  features:    'Features',
}

const KIND_DESC = {
  items:       'Eigene Waffen, Rüstung, Magic Items, Gegenstände — erscheinen in Item-Pickern und auf dem Sheet',
  spells:      'Eigene Cantrips / Spells (alle Level) — erscheinen in den Spell-Pickern der zugewiesenen Klassen',
  backgrounds: 'Eigene Backgrounds inkl. Skill/Tool/Language-Grants',
  races:       'Eigene Rassen mit Ability-Bonus, Speed, Profs, Granted Spells und Traits',
  creatures:   'Eigene Monster / NPCs — im VTT-Monster-Panel als Statblock und Token nutzbar',
  features:    'Eigene Class- / Subclass- / Race-Features — aktiv auf Sheet und im VTT (Aktionen, Rider, Ressourcen)',
}

const DEFAULT_KIND = 'items'

export default function HomebrewPage({ session }) {
  const [kind, setKind] = useState(DEFAULT_KIND)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  // Erzwungener Roh-JSON-Modus (Power-User): editiert JEDEN Kind-Eintrag
  // als 5etools-JSON — für Felder, die der strukturierte Editor nicht kennt.
  const [editingJson, setEditingJson] = useState(false)
  const [templatePicker, setTemplatePicker] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [search, setSearch] = useState('')
  // Zähler pro Tab (aus dem Store-Cache — nach Mutationen neu geladen).
  const [counts, setCounts] = useState({})

  const reloadCounts = useCallback(async () => {
    const next = {}
    for (const k of HOMEBREW_KINDS) {
      try { next[k] = (await listHomebrew(k)).length } catch { next[k] = 0 }
    }
    setCounts(next)
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await listHomebrew(kind)
      setEntries(list)
    } finally { setLoading(false) }
    reloadCounts()
  }, [kind, reloadCounts])

  useEffect(() => { reload() }, [reload])

  async function handleSave(entry) {
    // Zentrale Prüfung für ALLE Editoren: Fehler blockieren (der Eintrag
    // käme sonst nirgends an), Hinweise werden nur bestätigt — Homebrew
    // soll nicht bevormunden, aber auch nicht stumm ins Leere laufen.
    const { errors, warnings, list } = validationCounts(kind, entry)
    if (errors > 0) {
      alert('Der Eintrag kann so nicht verwendet werden:\n\n'
        + list.filter(v => v.level === 'error').map(v => `• ${v.msg}`).join('\n'))
      return
    }
    if (warnings > 0) {
      const ok = window.confirm('Hinweise zu diesem Eintrag:\n\n'
        + list.filter(v => v.level === 'warn').map(v => `• ${v.msg}`).join('\n')
        + '\n\nTrotzdem speichern?')
      if (!ok) return
    }
    try {
      await saveHomebrew(kind, entry)
    } catch (e) {
      alert('Speichern fehlgeschlagen: ' + (e?.message || e))
      return
    }
    setEditing(null)
    setEditingJson(false)
    await reload()
  }

  async function handleDuplicate(entry) {
    const clone = JSON.parse(JSON.stringify(entry))
    delete clone._localMeta
    clone.name = `${entry.name || 'Eintrag'} (Kopie)`
    try {
      await saveHomebrew(kind, clone)
      await reload()
    } catch (e) { alert('Duplizieren fehlgeschlagen: ' + (e?.message || e)) }
  }

  async function handleDelete(entry) {
    const id = entry?._localMeta?.id
    if (!id) return
    if (!window.confirm(`„${entry.name}" wirklich löschen?`)) return
    await deleteHomebrew(kind, id)
    await reload()
  }

  function newBlank() {
    const userTag = (session?.user?.email || 'me').split('@')[0].toUpperCase().slice(0, 8)
    const source = `HB-${userTag}`
    if (kind === 'items') return { name: 'Neues Item', source, type: 'G', rarity: 'none', entries: [''] }
    if (kind === 'spells') return { name: 'Neuer Spell', source, level: 0, school: 'E', time: [{ number: 1, unit: 'action' }], range: { type: 'point', distance: { type: 'self' } }, components: { v: true }, duration: [{ type: 'instant' }], classes: [], entries: [''] }
    if (kind === 'backgrounds') return { name: 'Neuer Background', source, skillProficiencies: [], languageProficiencies: [], entries: [''] }
    if (kind === 'races') return { name: 'Neue Rasse', source, size: ['M'], speed: { walk: 30 } }
    if (kind === 'creatures') return { name: 'Neue Kreatur', source, size: ['M'], type: 'humanoid', alignment: ['N'], ac: [10], hp: { average: 10, formula: '1d8 + 2' }, speed: { walk: 30 }, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cr: '1/4', entries: [''] }
    return { name: 'Neues Feature', source, level: 1, entries: [''] }
  }

  function startNew() { setEditingJson(false); setEditing(newBlank()) }

  function startEdit(entry) { setEditingJson(false); setEditing(entry) }

  function startEditJson(entry) { setEditingJson(true); setEditing(entry) }

  function openTemplatePicker() { setTemplatePicker(true) }

  async function pickTemplate(tmpl) {
    setTemplatePicker(false)
    // Kopie machen — neues source-Tag + entferne _localMeta damit es als
    // neuer Eintrag gespeichert wird.
    const userTag = (session?.user?.email || 'me').split('@')[0].toUpperCase().slice(0, 8)
    const clone = JSON.parse(JSON.stringify(tmpl))
    clone.source = `HB-${userTag}`
    clone.name = `${tmpl.name} (Custom)`
    delete clone._localMeta
    delete clone._isHomebrew
    setEditing(clone)
  }

  const Editor = useMemo(() => {
    if (editingJson) return GenericJsonEditor
    if (kind === 'items') return ItemEditor
    if (kind === 'spells') return SpellEditor
    if (kind === 'features') return FeatureEditor
    if (kind === 'races') return RaceEditor
    if (kind === 'backgrounds') return BackgroundEditor
    if (kind === 'creatures') return CreatureEditor
    return GenericJsonEditor
  }, [kind, editingJson])

  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(e =>
      String(e.name || '').toLowerCase().includes(q)
      || String(e.source || '').toLowerCase().includes(q),
    )
  }, [entries, search])

  return (
    <div style={{ minHeight: '100vh' }}>
      <DndSubNav active="homebrew" />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>
        <h1 style={S.h1}>Homebrew</h1>
        <p style={S.subtitle}>
          Eigene Items, Spells, Backgrounds, Rassen, Creatures und Features im
          5etools-Format — in der Cloud gespeichert und direkt vom Programm
          konsumiert: sie tauchen in den Pickern des Charakter-Builders, auf dem
          Sheet und im VTT auf. Über „Aus Vorlage laden" startest du mit einem
          offiziellen Eintrag als Basis.
        </p>

        {/* Kind-Tabs */}
        <div style={S.kindTabs}>
          {HOMEBREW_KINDS.map(k => (
            <button
              key={k}
              type="button"
              onClick={() => { setKind(k); setEditing(null); setEditingJson(false); setSearch('') }}
              style={k === kind ? S.kindTabActive : S.kindTab}
            >{KIND_LABELS[k]}{counts[k] > 0 ? ` (${counts[k]})` : ''}</button>
          ))}
        </div>

        <p style={S.kindDesc}>{KIND_DESC[kind]}</p>

        {/* Editor (falls offen) */}
        {editing ? (
          <Editor
            entry={editing}
            onCancel={() => { setEditing(null); setEditingJson(false) }}
            onSave={handleSave}
          />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <button type="button" onClick={startNew} style={S.primaryBtn}>+ Neu anlegen</button>
              {(kind === 'items' || kind === 'spells' || kind === 'backgrounds' || kind === 'races' || kind === 'features' || kind === 'creatures') && (
                <button type="button" onClick={openTemplatePicker} style={S.secondaryBtn}>
                  Aus Vorlage laden …
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button type="button" style={S.secondaryBtn}
                title="Eintrag per Share-Token aus der Cloud importieren"
                onClick={async () => {
                  const tok = window.prompt('Share-Token eintippen:')
                  if (!tok) return
                  try {
                    await importByToken(tok.trim())
                    await reload()
                    alert('Eintrag erfolgreich importiert.')
                  } catch (e) {
                    alert('Import fehlgeschlagen: ' + (e?.message || e))
                  }
                }}
              >Token importieren</button>
              <button type="button" style={S.secondaryBtn}
                title="Öffentliche Einträge anderer Spieler durchstöbern"
                onClick={() => setLibraryOpen(true)}
              >Library</button>
            </div>

            {entries.length > 3 && (
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Nach Name oder Source filtern…"
                style={{ ...S.input, width: '100%', marginBottom: 10 }} />
            )}

            {loading ? (
              <div style={{ color: 'var(--text-muted)' }}>Lädt…</div>
            ) : entries.length === 0 ? (
              <div style={{
                padding: 24, textAlign: 'center',
                background: 'var(--bg-elevated)',
                border: '1px dashed var(--border)', borderRadius: 12,
                color: 'var(--text-muted)',
              }}>
                Noch keine eigenen {KIND_LABELS[kind]}. Lege einen ersten Eintrag an
                oder starte über „Aus Vorlage laden" mit einem offiziellen Eintrag als Basis.
              </div>
            ) : visibleEntries.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', padding: 12 }}>
                Kein Eintrag passt auf „{search}".
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visibleEntries.map(e => (
                  <EntryRow key={e._localMeta?.id} entry={e}
                    kind={kind}
                    onEdit={() => startEdit(e)}
                    onEditJson={() => startEditJson(e)}
                    onDuplicate={() => handleDuplicate(e)}
                    onDelete={() => handleDelete(e)}
                    onTogglePublic={async () => {
                      const next = !e._localMeta?.public
                      try {
                        await setHomebrewPublic(kind, e._localMeta?.id, next)
                        await reload()
                      } catch (err) { alert('Public-Toggle fehlgeschlagen: ' + (err?.message || err)) }
                    }}
                    onShare={async () => {
                      try {
                        const tok = await ensureShareToken(kind, e._localMeta?.id)
                        try { await navigator.clipboard.writeText(tok) } catch {/*ignore*/}
                        await reload()
                        alert(`Share-Token: ${tok}\n\n(In die Zwischenablage kopiert. Andere können den Token unter "Token importieren" eintippen.)`)
                      } catch (err) { alert('Token-Generierung fehlgeschlagen: ' + (err?.message || err)) }
                    }}
                    onRevokeShare={async () => {
                      if (!window.confirm('Token wirklich widerrufen? Bisherige Empfänger verlieren den Zugriff.')) return
                      try {
                        await revokeShareToken(kind, e._localMeta?.id)
                        await reload()
                      } catch (err) { alert('Revoke fehlgeschlagen: ' + (err?.message || err)) }
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {templatePicker && (
          <TemplatePickerModal
            kind={kind}
            onCancel={() => setTemplatePicker(false)}
            onPick={pickTemplate}
          />
        )}

        {libraryOpen && (
          <LibraryModal
            kind={kind}
            onClose={() => setLibraryOpen(false)}
            onImported={async () => { await reload() }}
          />
        )}
      </div>
    </div>
  )
}

// ── Pro-Eintrag-Zeile ────────────────────────────────────────
// Zusammenfassung pro Kind aus den Feldern, die auch die Konsumenten
// lesen — bei Spells sind das vor allem die Klassen-Zuweisungen, weil sie
// darüber entscheiden, ob der Eintrag überhaupt in einem Picker auftaucht.
function summarize(kind, entry) {
  const parts = []
  if (kind === 'items') {
    if (entry.rarity && entry.rarity !== 'none') parts.push(entry.rarity)
    if (entry.type) parts.push(String(entry.type).split('|')[0])
    if (entry.dmg1) parts.push(`${entry.dmg1}${entry.dmgType ? ` ${entry.dmgType}` : ''}`)
    if (entry.ac) parts.push(`AC ${entry.ac}`)
  } else if (kind === 'spells') {
    parts.push(entry.level === 0 ? 'Cantrip' : `Level ${entry.level ?? '?'}`)
    if (entry.school) parts.push(entry.school)
    const cls = Array.isArray(entry.classes) ? entry.classes : []
    parts.push(cls.length ? cls.join(', ') : 'keine Klasse')
  } else if (kind === 'races') {
    const size = Array.isArray(entry.size) ? entry.size[0] : entry.size
    if (size) parts.push(size)
    if (entry.speed?.walk) parts.push(`${entry.speed.walk} ft.`)
    if (entry.darkvision) parts.push(`Darkvision ${entry.darkvision}`)
  } else if (kind === 'creatures') {
    parts.push(`CR ${typeof entry.cr === 'object' ? entry.cr?.cr : (entry.cr ?? '?')}`)
    if (entry.type) parts.push(typeof entry.type === 'object' ? entry.type.type : entry.type)
  } else if (kind === 'backgrounds') {
    const n = (entry.skillProficiencies || []).length
    if (n) parts.push(`${n} Skill-Block${n > 1 ? 'e' : ''}`)
  } else if (kind === 'features') {
    parts.push(entry.className || 'klassenfrei')
    parts.push(`L${entry.level ?? '?'}`)
  }
  return parts.filter(Boolean).join(' · ')
}

function EntryRow({ entry, kind, onEdit, onEditJson, onDuplicate, onDelete, onTogglePublic, onShare, onRevokeShare }) {
  const meta = entry._localMeta || {}
  const updated = meta.updated ? new Date(meta.updated).toLocaleString('de-DE') : '—'
  const isPublic = !!meta.public
  const token = meta.token || null
  const summary = summarize(kind, entry)
  const { errors, warnings, list } = validationCounts(kind, entry)
  const issueText = list.map(v => `${v.level === 'error' ? '[Fehler]' : '[Hinweis]'} ${v.msg}`).join('\n')

  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
      padding: '10px 14px',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 10,
    }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
          {entry.name || '(unbenannt)'}
          {isPublic && (
            <span title="Öffentlich geteilt — andere Spieler finden diesen Eintrag in der Library"
              style={S.badgeBlue}>public</span>
          )}
          {token && (
            <span title="Share-Token — andere können den Eintrag damit importieren"
              style={S.badgeToken}>{token}</span>
          )}
          {errors > 0 && (
            <span title={issueText} style={S.badgeError}>
              {errors} Fehler
            </span>
          )}
          {errors === 0 && warnings > 0 && (
            <span title={issueText} style={S.badgeWarn}>
              {warnings} Hinweis{warnings > 1 ? 'e' : ''}
            </span>
          )}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          {summary}{summary ? ' · ' : ''}{entry.source || 'HB'} · zuletzt {updated}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={onTogglePublic} style={isPublic ? { ...S.smallBtn, borderColor: '#7aa2f7', color: '#7aa2f7' } : S.smallBtn}
          title={isPublic
            ? 'Öffentlich → privat schalten'
            : 'Eintrag in der Public Library sichtbar machen'}
        >{isPublic ? 'Public: an' : 'Public: aus'}</button>
        {token ? (
          <button type="button" onClick={onRevokeShare} style={{ ...S.smallBtn, color: 'var(--accent-red)' }}
            title="Share-Token widerrufen — bisherige Empfänger verlieren den Zugriff"
          >Token widerrufen</button>
        ) : (
          <button type="button" onClick={onShare} style={S.smallBtn}
            title="Share-Token generieren — andere können den Eintrag damit importieren"
          >Token teilen</button>
        )}
        <button type="button" onClick={onDuplicate} style={S.smallBtn}
          title="Kopie anlegen — praktisch als Basis für eine Variante">Duplizieren</button>
        <button type="button" onClick={onEditJson} style={S.smallBtn}
          title="Roh-JSON bearbeiten — für Felder, die der strukturierte Editor nicht abdeckt">JSON</button>
        <button type="button" onClick={onEdit} style={S.smallBtn}>Bearbeiten</button>
        <button type="button" onClick={onDelete} style={{ ...S.smallBtn, color: 'var(--accent-red)' }}>Löschen</button>
      </div>
    </div>
  )
}

// ── Public Library Modal ─────────────────────────────────────
function LibraryModal({ kind, onClose, onImported }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [importing, setImporting] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listPublic(kind).then(list => {
      if (!cancelled) { setItems(list || []); setLoading(false) }
    }).catch(e => {
      if (!cancelled) {
        console.warn('[library] load failed', e)
        setItems([])
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [kind])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(i =>
      String(i.name || '').toLowerCase().includes(q)
      || String(i.author || '').toLowerCase().includes(q),
    )
  }, [items, search])

  async function doImport(row) {
    setImporting(row.id)
    try {
      await importPublic(kind, row)
      onImported?.()
    } catch (e) {
      alert('Import fehlgeschlagen: ' + (e?.message || e))
    } finally {
      setImporting(null)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#171a21', border: '1px solid #2a3040', borderRadius: 12,
        padding: 16, width: 'min(700px, 92vw)', maxHeight: '85vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e6e8ee' }}>
            Public Library — {KIND_LABELS[kind]}
          </div>
          <button type="button" onClick={onClose} style={S.smallBtn}>×</button>
        </div>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Nach Name oder Autor suchen…"
          style={{
            width: '100%', padding: '8px 12px', fontSize: 13, marginBottom: 10,
            background: '#0f1115', color: '#e6e8ee',
            border: '1px solid #2a3040', borderRadius: 6, fontFamily: 'inherit',
          }} />
        {loading ? (
          <div style={{ color: '#9aa3b4' }}>Lädt Library…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: '#9aa3b4', padding: 20, textAlign: 'center' }}>
            Noch nichts in der Library für diese Kategorie.
            <br />Andere Spieler müssen erst etwas öffentlich teilen.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(row => (
              <div key={row.id} style={{
                display: 'flex', gap: 10, alignItems: 'center',
                padding: '8px 12px', borderRadius: 6,
                background: '#0f1115', border: '1px solid #2a3040',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#e6e8ee', fontSize: 13, fontWeight: 700,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{row.name}
                    <span style={{ marginLeft: 8, fontSize: 10, color: '#6b7386', fontWeight: 400 }}>
                      {row.source || 'HB'}
                    </span>
                  </div>
                  <div style={{ color: '#9aa3b4', fontSize: 11 }}>
                    von <b>{row.author || '(anonym)'}</b> · zuletzt {row.updated_at ? new Date(row.updated_at).toLocaleString('de-DE') : '—'}
                  </div>
                </div>
                <button type="button" onClick={() => doImport(row)}
                  disabled={importing === row.id}
                  style={{
                    padding: '6px 14px', borderRadius: 6,
                    background: '#7aa2f7', color: '#0f1115',
                    border: 'none', cursor: importing === row.id ? 'wait' : 'pointer',
                    fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                  }}
                >{importing === row.id ? '…' : '+ Importieren'}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Template-Picker: lädt existing 5etools-Daten und filtert ──
function TemplatePickerModal({ kind, onCancel, onPick }) {
  const [edition, setEdition] = useState('5.5e')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const loader = kind === 'items' ? loadItemIndex
      : kind === 'spells' ? loadSpellList
      : kind === 'backgrounds' ? loadBackgroundList
      : kind === 'races' ? loadRaceList
      : kind === 'features' ? loadOptionalFeatureList
      : kind === 'creatures' ? loadCreatureList
      : null
    if (!loader) { setItems([]); setLoading(false); return }
    loader(edition).then(list => {
      if (!cancelled) {
        setItems(list || [])
        setLoading(false)
      }
    }).catch(() => { if (!cancelled) { setItems([]); setLoading(false) } })
    return () => { cancelled = true }
  }, [kind, edition])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    // Erste Stufe: schmeiß alles raus was kein lesbares Feld hat
    // (defensive: manche items-Index-Einträge sind nur Refs).
    const usable = (items || []).filter(i => i && i.name && String(i.name).trim().length > 0)
    if (!q) return usable.slice(0, 100)
    return usable.filter(i => String(i.name).toLowerCase().includes(q)).slice(0, 100)
  }, [items, search])

  return (
    <div style={S.modalOverlay} onClick={onCancel}>
      <div style={S.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Vorlage wählen ({KIND_LABELS[kind]})</div>
          <button type="button" onClick={onCancel} style={S.smallBtn}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <select value={edition} onChange={e => setEdition(e.target.value)} style={S.input}>
            <option value="5e">5e (PHB / TCE / …)</option>
            <option value="5.5e">5.5e (XPHB)</option>
          </select>
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Suchen…" style={{ ...S.input, flex: 1 }}
          />
        </div>
        <div style={{ maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {loading ? <div style={{ color: 'var(--text-muted)' }}>Lädt…</div>
            : filtered.length === 0 ? <div style={{ color: 'var(--text-muted)' }}>Nichts gefunden.</div>
            : filtered.map((it, i) => (
              <TemplateRow key={`${it.name}-${i}`} item={it} kind={kind} onPick={() => onPick(it)} />
            ))
          }
        </div>
      </div>
    </div>
  )
}

// ── Template-Row mit ausklappbarer Vorschau ─────────────────
// HARDCODED Farben (mit !important via inline style) damit auch ohne
// jegliche CSS-Variablen alles sichtbar bleibt. Wir hatten ein Problem
// wo --bg-card etc. nicht resolved haben → komplett unsichtbare rows.
function TemplateRow({ item, kind, onPick }) {
  const [expanded, setExpanded] = useState(false)
  const summaryParts = []
  if (kind === 'items') {
    if (item.rarity && item.rarity !== 'none') summaryParts.push(item.rarity)
    if (item.type) summaryParts.push(String(item.type).split('|')[0])
    if (item.dmg1) summaryParts.push(`${item.dmg1}${item.dmgType ? ' ' + item.dmgType : ''}`)
    if (item.ac) summaryParts.push(`AC ${item.ac}`)
    if (item.reqAttune) summaryParts.push('Attunement')
  } else if (kind === 'spells') {
    summaryParts.push(item.level === 0 ? 'Cantrip' : `Level ${item.level ?? '?'}`)
    if (item.school) summaryParts.push(item.school)
    if (item.castingTime) summaryParts.push(item.castingTime)
  } else if (kind === 'backgrounds') {
    const skillN = (item.skillProficiencies || []).length
    if (skillN) summaryParts.push(`${skillN} Skill-Choice${skillN > 1 ? 's' : ''}`)
    const featN = (item.feats || []).length
    if (featN) summaryParts.push(`${featN} Feat`)
  } else if (kind === 'races') {
    const size = Array.isArray(item.size) ? item.size[0] : item.size
    if (size) summaryParts.push({ T:'Tiny',S:'Small',M:'Medium',L:'Large',H:'Huge',G:'Gargantuan' }[size] || size)
    if (item.speed?.walk) summaryParts.push(`Speed ${item.speed.walk}`)
    if (item.darkvision) summaryParts.push(`Darkvision ${item.darkvision}`)
    if (Array.isArray(item.additionalSpells) && item.additionalSpells.length > 0) summaryParts.push('Spells')
  } else if (kind === 'features') {
    if (item.level != null) summaryParts.push(`L${item.level}`)
    if (item.featureType) summaryParts.push(Array.isArray(item.featureType) ? item.featureType.join('/') : item.featureType)
    if (item.prerequisite) summaryParts.push('hat Prereq')
  } else if (kind === 'creatures') {
    const size = Array.isArray(item.size) ? item.size[0] : item.size
    if (size) summaryParts.push({ T:'Tiny',S:'Small',M:'Medium',L:'Large',H:'Huge',G:'Gargantuan' }[size] || size)
    if (item.cr) summaryParts.push(`CR ${typeof item.cr === 'object' ? item.cr.cr : item.cr}`)
    if (item.type) summaryParts.push(typeof item.type === 'object' ? item.type.type : item.type)
  }
  const summary = summaryParts.join(' · ')
  const entries = Array.isArray(item.entries) ? item.entries : []
  const higher  = Array.isArray(item.entriesHigherLevel) ? item.entriesHigherLevel : []
  const displayName = typeof item.name === 'string' && item.name.trim()
    ? item.name : '(unbenannt)'
  const displaySource = typeof item.source === 'string' ? item.source : ''

  // Inline FALLBACK colors (Dark-Theme defaults). Wenn CSS-Variablen
  // greifen, kein Problem; wenn nicht, sind diese Farben mindestens da.
  const NAME_COLOR = '#e6e8ee'
  const MUTED_COLOR = '#9aa3b4'
  const DIM_COLOR = '#6b7386'
  const BORDER_COLOR = '#2a3040'
  const ROW_BG = '#171a21'
  const ACCENT = '#7aa2f7'

  return (
    <div style={{
      border: `1px solid ${BORDER_COLOR}`,
      borderRadius: 6,
      background: ROW_BG,
      overflow: 'hidden',
      minHeight: 44,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        minHeight: 36,
      }}>
        <button type="button" onClick={() => setExpanded(v => !v)}
          style={{
            padding: '4px 10px', borderRadius: 4, minWidth: 32, minHeight: 28,
            background: 'transparent', border: `1px solid ${BORDER_COLOR}`,
            color: NAME_COLOR, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 12,
          }}
        >{expanded ? '▾' : '▸'}</button>
        <div style={{ flex: '1 1 0%', minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: NAME_COLOR,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            lineHeight: 1.4,
          }}>
            {displayName}
            {displaySource && (
              <span style={{ marginLeft: 8, color: DIM_COLOR, fontSize: 11, fontWeight: 400 }}>
                {displaySource}
              </span>
            )}
          </div>
          {summary && (
            <div style={{ color: MUTED_COLOR, fontSize: 11, lineHeight: 1.3 }}>
              {summary}
            </div>
          )}
        </div>
        <button type="button" onClick={onPick}
          style={{
            padding: '6px 14px', borderRadius: 6, minHeight: 30,
            background: ACCENT, color: '#0f1115',
            border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
            flexShrink: 0,
          }}
        >Übernehmen</button>
      </div>
      {expanded && (
        <div style={{
          padding: '10px 14px',
          borderTop: `1px solid ${BORDER_COLOR}`,
          background: '#0f1115',
          maxHeight: 400, overflowY: 'auto',
          fontSize: 12, color: NAME_COLOR,
        }}>
          {entries.length > 0 ? (
            <EntryRenderer entries={entries} />
          ) : (
            <div style={{ color: DIM_COLOR }}>
              Keine Description-Text verfügbar — Felder (Stats / Damage / Properties / etc.) werden trotzdem alle kopiert wenn du "Übernehmen" klickst.
            </div>
          )}
          {higher.length > 0 && (
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px dashed ${BORDER_COLOR}` }}>
              <EntryRenderer entries={higher} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const S = {
  h1: { color: 'var(--accent)', marginBottom: 4, marginTop: 0 },
  subtitle: { color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 },
  kindTabs: { display: 'flex', gap: 4, marginBottom: 4, borderBottom: '1px solid var(--border)' },
  kindTab: {
    padding: '8px 16px', border: 'none', borderBottom: '2px solid transparent',
    background: 'transparent', color: 'var(--text-muted)',
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
    marginBottom: -1,
  },
  kindTabActive: {
    padding: '8px 16px', border: 'none',
    borderBottom: '2px solid var(--accent)',
    background: 'transparent', color: 'var(--accent)',
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
    marginBottom: -1,
  },
  kindDesc: { color: 'var(--text-dim)', fontSize: 12, marginTop: 8, marginBottom: 20 },
  primaryBtn: {
    padding: '8px 16px', borderRadius: 8, border: '2px solid var(--accent)',
    background: 'var(--accent)', color: 'var(--bg-base, #111)',
    cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
  },
  secondaryBtn: {
    padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
  },
  smallBtn: {
    padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
  },
  badgeBlue: {
    marginLeft: 8, padding: '1px 6px', borderRadius: 4,
    border: '1px solid #7aa2f7', color: '#7aa2f7',
    fontSize: 9, fontWeight: 700, verticalAlign: 'middle',
  },
  badgeToken: {
    marginLeft: 4, padding: '1px 6px', borderRadius: 4,
    border: '1px solid #b07afe', color: '#b07afe',
    fontSize: 9, fontWeight: 700, verticalAlign: 'middle',
    fontFamily: 'monospace',
  },
  badgeError: {
    marginLeft: 4, padding: '1px 6px', borderRadius: 4,
    border: '1px solid #f7768e', color: '#f7768e',
    fontSize: 9, fontWeight: 700, verticalAlign: 'middle', cursor: 'help',
  },
  badgeWarn: {
    marginLeft: 4, padding: '1px 6px', borderRadius: 4,
    border: '1px solid #e0af68', color: '#e0af68',
    fontSize: 9, fontWeight: 700, verticalAlign: 'middle', cursor: 'help',
  },
  input: {
    padding: '6px 10px', fontSize: 12,
    background: 'var(--bg-inset)', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 6,
    fontFamily: 'inherit',
  },
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modalCard: {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
    padding: 16, width: 'min(640px, 92vw)', maxHeight: '85vh', overflowY: 'auto',
  },
}
