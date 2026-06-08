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
} from '../../character-builder/lib/dataLoader'
import ItemEditor from '../components/editors/ItemEditor'
import SpellEditor from '../components/editors/SpellEditor'
import FeatureEditor from '../components/editors/FeatureEditor'
import RaceEditor from '../components/editors/RaceEditor'
import GenericJsonEditor from '../components/editors/GenericJsonEditor'
import EntryRenderer from '../../character-builder/components/ui/EntryRenderer'
import { pushOne, pullAll } from '../lib/homebrewSync'

const KIND_LABELS = {
  items:       'Items',
  spells:      'Spells',
  backgrounds: 'Backgrounds',
  races:       'Races',
  creatures:   'Creatures',
  features:    'Features',
}

const KIND_DESC = {
  items:       'Eigene Waffen, Rüstung, Magic Items, Gegenstände',
  spells:      'Eigene Cantrips / Spells (alle Level)',
  backgrounds: 'Eigene Backgrounds inkl. Skill/Tool/Language-Grants',
  races:       'Eigene Rassen mit Ability-Bonus, Speed, Profs, Granted Spells und Traits',
  creatures:   'Eigene Monster / NPCs (für GM-Notizen — kein Engine-Konsumer)',
  features:    'Eigene Class- / Subclass- / Race-Features',
}

const DEFAULT_KIND = 'items'

export default function HomebrewPage({ session }) {
  const [kind, setKind] = useState(DEFAULT_KIND)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [templatePicker, setTemplatePicker] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await listHomebrew(kind)
      setEntries(list)
    } finally { setLoading(false) }
  }, [kind])

  useEffect(() => { reload() }, [reload])

  async function handleSave(entry) {
    await saveHomebrew(kind, entry)
    setEditing(null)
    await reload()
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

  function startNew() { setEditing(newBlank()) }

  function startEdit(entry) { setEditing(entry) }

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
    if (kind === 'items') return ItemEditor
    if (kind === 'spells') return SpellEditor
    if (kind === 'features') return FeatureEditor
    if (kind === 'races') return RaceEditor
    return GenericJsonEditor
  }, [kind])

  return (
    <div style={{ minHeight: '100vh' }}>
      <DndSubNav active="homebrew" />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>
        <h1 style={S.h1}>Homebrew</h1>
        <p style={S.subtitle}>
          Eigene Items, Spells, Backgrounds, Creatures und Features. Lokal
          gespeichert im 5etools-Format — direkt vom Programm konsumiert
          (Items / Spells / Backgrounds tauchen in den Pickern auf).
        </p>

        {/* Kind-Tabs */}
        <div style={S.kindTabs}>
          {HOMEBREW_KINDS.map(k => (
            <button
              key={k}
              type="button"
              onClick={() => { setKind(k); setEditing(null) }}
              style={k === kind ? S.kindTabActive : S.kindTab}
            >{KIND_LABELS[k]}</button>
          ))}
        </div>

        <p style={S.kindDesc}>{KIND_DESC[kind]}</p>

        {/* Editor (falls offen) */}
        {editing ? (
          <Editor
            entry={editing}
            onCancel={() => setEditing(null)}
            onSave={handleSave}
          />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <button type="button" onClick={startNew} style={S.primaryBtn}>+ Neu anlegen</button>
              {(kind === 'items' || kind === 'spells' || kind === 'backgrounds') && (
                <button type="button" onClick={openTemplatePicker} style={S.secondaryBtn}>
                  Aus Vorlage laden …
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button type="button" style={S.secondaryBtn}
                title="Lade Cloud-Stand und mische in lokale Liste"
                onClick={async () => {
                  try {
                    const n = await pullAll(kind)
                    alert(`${n} Einträge aus der Cloud geladen.`)
                    await reload()
                  } catch (e) { alert('Pull fehlgeschlagen: ' + (e?.message || e)) }
                }}
              >☁ Pull</button>
            </div>

            {loading ? (
              <div style={{ color: 'var(--text-muted)' }}>Lädt…</div>
            ) : entries.length === 0 ? (
              <div style={{
                padding: 24, textAlign: 'center',
                background: 'var(--bg-elevated)',
                border: '1px dashed var(--border)', borderRadius: 12,
                color: 'var(--text-muted)',
              }}>
                Noch keine eigenen {KIND_LABELS[kind]}. Lege einen ersten Eintrag an.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {entries.map(e => (
                  <EntryRow key={e._localMeta?.id} entry={e}
                    kind={kind}
                    onEdit={() => startEdit(e)}
                    onDelete={() => handleDelete(e)}
                    onSync={async () => {
                      try {
                        await pushOne(kind, e)
                        await reload()
                      } catch (err) { alert('Sync fehlgeschlagen: ' + (err?.message || err)) }
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
      </div>
    </div>
  )
}

// ── Pro-Eintrag-Zeile ────────────────────────────────────────
function EntryRow({ entry, kind, onEdit, onDelete, onSync }) {
  const meta = entry._localMeta || {}
  const updated = meta.updated ? new Date(meta.updated).toLocaleString('de-DE') : '—'
  const syncedAt = meta.synced ? new Date(meta.synced).toLocaleString('de-DE') : null
  const isSynced = !!meta.syncId
  const summary =
    kind === 'items'   ? `${entry.rarity || 'none'} · ${entry.type || '—'}` :
    kind === 'spells'  ? `Level ${entry.level ?? '?'} · ${entry.school || '?'}` :
    kind === 'creatures' ? `CR ${entry.cr || '?'} · ${entry.type || '?'}` :
    kind === 'backgrounds' ? `${(entry.skillProficiencies || []).length} Skill-Wahl(en)` :
    kind === 'features' ? `L${entry.level ?? '?'}` : ''

  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'center',
      padding: '10px 14px',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 10,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
          {entry.name || '(unbenannt)'}
          {isSynced && (
            <span title={`Mit Cloud synchronisiert${syncedAt ? ' am ' + syncedAt : ''}`}
              style={{
                marginLeft: 8, padding: '1px 6px', borderRadius: 4,
                border: '1px solid var(--accent-green)', color: 'var(--accent-green)',
                fontSize: 9, fontWeight: 700, verticalAlign: 'middle',
              }}>☁ synced</span>
          )}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          {summary} · {entry.source || 'HB'} · zuletzt {updated}
        </div>
      </div>
      <button type="button" onClick={onSync} style={S.smallBtn}
        title="In die Cloud hochladen (Supabase)">☁ Push</button>
      <button type="button" onClick={onEdit} style={S.smallBtn}>Bearbeiten</button>
      <button type="button" onClick={onDelete} style={{ ...S.smallBtn, color: 'var(--accent-red)' }}>Löschen</button>
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
