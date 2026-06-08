// GrantSpellPicker.jsx
//
// Multi-Select-Spell-Picker mit Suche + Edition-Switch. Lädt sowohl
// existing 5etools-Spells als auch user-erstelltes Homebrew (via
// loadSpellList das beides merged). Liefert pro Spell ein
// { spellName, source } Object zurück.

import { useState, useEffect, useMemo } from 'react'
import { loadSpellList } from '../../../character-builder/lib/dataLoader'

const MODE_OPTS = [
  { v: 'known',    l: 'Always known (kein Slot)' },
  { v: 'innate',   l: '1× per Day (kein Slot)' },
  { v: 'prepared', l: 'Always prepared (verbraucht Slot)' },
]

export default function GrantSpellPicker({ grants = [], onChange, defaultEdition = '5.5e' }) {
  const [pickerOpen, setPickerOpen] = useState(false)

  function addGrant(spell) {
    if (!spell) return
    if (grants.some(g => g.spellName.toLowerCase() === spell.name.toLowerCase())) return
    onChange([
      ...grants,
      { spellName: spell.name, source: spell.source || '', mode: 'known', level: 1 },
    ])
    setPickerOpen(false)
  }
  function removeGrant(name) {
    onChange(grants.filter(g => g.spellName.toLowerCase() !== name.toLowerCase()))
  }
  function setMode(name, mode) {
    onChange(grants.map(g =>
      g.spellName.toLowerCase() === name.toLowerCase() ? { ...g, mode } : g,
    ))
  }
  function setLevel(name, level) {
    const lvl = Math.max(1, Math.min(20, parseInt(level, 10) || 1))
    onChange(grants.map(g =>
      g.spellName.toLowerCase() === name.toLowerCase() ? { ...g, level: lvl } : g,
    ))
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {grants.length === 0 && (
          <div style={{ color: '#9aa3b4', fontSize: 12 }}>
            Keine Spells gewährt. "+ Spell hinzufügen" um einen zu wählen.
          </div>
        )}
        {grants.map(g => (
          <div key={g.spellName} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 6,
            background: '#0f1115',
            border: '1px solid #2a3040',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#e6e8ee', fontSize: 13, fontWeight: 600 }}>
                {g.spellName}
                {g.source && (
                  <span style={{ marginLeft: 8, color: '#6b7386', fontSize: 11, fontWeight: 400 }}>
                    {g.source}
                  </span>
                )}
              </div>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#9aa3b4', fontSize: 11 }}>
              ab L
              <input type="number" min="1" max="20" value={g.level || 1}
                onChange={e => setLevel(g.spellName, e.target.value)}
                style={{
                  width: 44, padding: '4px 6px', fontSize: 11,
                  background: '#171a21', color: '#e6e8ee',
                  border: '1px solid #2a3040', borderRadius: 4,
                  fontFamily: 'inherit', textAlign: 'center',
                }}
                title="Charakter-Level ab dem dieser Spell aktiv wird (5etools-Konvention)"
              />
            </label>
            <select value={g.mode} onChange={e => setMode(g.spellName, e.target.value)}
              style={{
                padding: '4px 8px', fontSize: 11,
                background: '#171a21', color: '#e6e8ee',
                border: '1px solid #2a3040', borderRadius: 4,
                fontFamily: 'inherit',
              }}>
              {MODE_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            <button type="button" onClick={() => removeGrant(g.spellName)}
              style={{
                padding: '4px 10px', borderRadius: 4,
                background: 'transparent', color: '#f7768e',
                border: '1px solid #2a3040', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 12,
              }}
            >×</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setPickerOpen(true)}
        style={{
          marginTop: 8, padding: '6px 14px', borderRadius: 6,
          background: '#7aa2f7', color: '#0f1115',
          border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
        }}
      >+ Spell hinzufügen</button>
      {pickerOpen && (
        <SpellPickerModal
          defaultEdition={defaultEdition}
          alreadyAdded={new Set(grants.map(g => g.spellName.toLowerCase()))}
          onPick={addGrant}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

function SpellPickerModal({ defaultEdition, alreadyAdded, onPick, onCancel }) {
  const [edition, setEdition] = useState(defaultEdition)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadSpellList(edition).then(list => {
      if (!cancelled) {
        setItems(list || [])
        setLoading(false)
      }
    }).catch(() => { if (!cancelled) { setItems([]); setLoading(false) } })
    return () => { cancelled = true }
  }, [edition])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let arr = (items || []).filter(i => i?.name)
    if (levelFilter !== null) arr = arr.filter(i => i.level === levelFilter)
    if (q) arr = arr.filter(i => String(i.name).toLowerCase().includes(q))
    return arr.slice(0, 200)
  }, [items, search, levelFilter])

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#171a21', border: '1px solid #2a3040', borderRadius: 12,
        padding: 16, width: 'min(580px, 92vw)', maxHeight: '80vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e6e8ee' }}>Spell wählen</div>
          <button type="button" onClick={onCancel} style={{
            padding: '4px 12px', borderRadius: 6, background: 'transparent',
            color: '#9aa3b4', border: '1px solid #2a3040', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
          }}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          <select value={edition} onChange={e => setEdition(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 12, background: '#0f1115', color: '#e6e8ee', border: '1px solid #2a3040', borderRadius: 6 }}>
            <option value="5e">5e (PHB / TCE / …)</option>
            <option value="5.5e">5.5e (XPHB)</option>
          </select>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Suchen…"
            style={{ flex: 1, padding: '6px 10px', fontSize: 12, background: '#0f1115', color: '#e6e8ee', border: '1px solid #2a3040', borderRadius: 6, fontFamily: 'inherit' }} />
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setLevelFilter(null)}
            style={lvlChip(levelFilter === null)}>Alle</button>
          {[0,1,2,3,4,5,6,7,8,9].map(lv => (
            <button key={lv} type="button" onClick={() => setLevelFilter(levelFilter === lv ? null : lv)}
              style={lvlChip(levelFilter === lv)}>{lv === 0 ? 'C' : 'L' + lv}</button>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: '50vh', overflowY: 'auto' }}>
          {loading ? <div style={{ color: '#9aa3b4' }}>Lädt…</div>
            : filtered.length === 0 ? <div style={{ color: '#9aa3b4' }}>Nichts gefunden.</div>
            : filtered.map((sp, i) => {
              const already = alreadyAdded.has(sp.name.toLowerCase())
              return (
                <button key={`${sp.name}-${i}`} type="button"
                  disabled={already}
                  onClick={() => onPick(sp)}
                  style={{
                    textAlign: 'left', padding: '6px 10px', borderRadius: 4,
                    background: already ? '#0a0c10' : '#0f1115',
                    color: already ? '#6b7386' : '#e6e8ee',
                    border: '1px solid #2a3040',
                    cursor: already ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', fontSize: 12,
                    opacity: already ? 0.5 : 1,
                  }}>
                  <span style={{ fontWeight: 600 }}>{sp.name}</span>
                  <span style={{ marginLeft: 8, color: '#6b7386', fontSize: 10 }}>
                    {sp.level === 0 ? 'Cantrip' : `L${sp.level}`} · {sp.school || '?'} · {sp.source}
                    {already ? ' · (bereits)' : ''}
                  </span>
                </button>
              )
            })
          }
        </div>
      </div>
    </div>
  )
}

function lvlChip(active) {
  return {
    padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 700,
    background: active ? '#7aa2f7' : 'transparent',
    color: active ? '#0f1115' : '#9aa3b4',
    border: `1px solid ${active ? '#7aa2f7' : '#2a3040'}`,
    cursor: 'pointer', fontFamily: 'inherit',
  }
}
