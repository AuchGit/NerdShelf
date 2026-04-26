// components/ui/CustomEditModal.jsx — Browse data, homebrew, ASI, with descriptions + feat choices
import { useState, useEffect, useMemo } from 'react'
import EntryRenderer from './EntryRenderer'

const SCHOOLS = [
  { id: 'A', label: 'Abjuration' }, { id: 'C', label: 'Conjuration' },
  { id: 'D', label: 'Divination' }, { id: 'E', label: 'Enchantment' },
  { id: 'V', label: 'Evocation' }, { id: 'I', label: 'Illusion' },
  { id: 'N', label: 'Necromancy' }, { id: 'T', label: 'Transmutation' },
]
const ITEM_TYPES = [
  { id: 'M', label: 'Nahkampfwaffe' }, { id: 'R', label: 'Fernkampfwaffe' },
  { id: 'LA', label: 'Leichte Rüstung' }, { id: 'MA', label: 'Mittlere Rüstung' },
  { id: 'HA', label: 'Schwere Rüstung' }, { id: 'S', label: 'Schild' },
  { id: 'G', label: 'Ausrüstung' }, { id: 'W', label: 'Wundersam' },
]
const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact']
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha']
const ABI_LABELS = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' }

export default function CustomEditModal({ onClose, character, updateCharacter }) {
  const [tab, setTab] = useState('spells')
  const custom = character.custom || { spells: [], feats: [], items: [], asi: {} }
  const [mode, setMode] = useState('list')
  const [editing, setEditing] = useState(null)
  const [expanded, setExpanded] = useState(null) // id of expanded entry

  const [allSpells, setAllSpells] = useState(null)
  const [allFeats, setAllFeats] = useState(null)
  const [allItems, setAllItems] = useState(null)
  const [search, setSearch] = useState('')
  const edition = character.meta?.edition || '5e'

  useEffect(() => { setMode('list'); setSearch(''); setEditing(null); setExpanded(null) }, [tab])

  async function loadData(type) {
    if (type === 'spells' && !allSpells) {
      const { loadSpellList } = await import('../../lib/dataLoader')
      setAllSpells(await loadSpellList(edition))
    }
    if (type === 'feats' && !allFeats) {
      const { loadFeatList } = await import('../../lib/dataLoader')
      setAllFeats(await loadFeatList(edition))
    }
    if (type === 'items' && !allItems) {
      const { loadItemIndex } = await import('../../lib/dataLoader')
      setAllItems(await loadItemIndex(edition))
    }
  }

  function save(category, items) { updateCharacter(`custom.${category}`, items) }

  function addFromData(entry) {
    const list = [...(custom[tab] || [])]
    if (tab === 'spells') {
      if (list.some(e => e.name === entry.name)) return
      list.push({
        _id: crypto.randomUUID(), _isCustom: true, _fromData: true,
        name: entry.name, level: entry.level ?? 0, school: entry.school || 'V',
        castingTime: entry.castingTime || '1 action', range: entry.range || 'Self',
        duration: entry.duration || 'Instantaneous',
        concentration: entry.concentration || false, ritual: entry.ritual || false,
        entries: entry.entries || [], entriesHigherLevel: entry.entriesHigherLevel || [],
        description: '', source: entry.source || 'PHB', grantedBy: '',
      })
    }
    if (tab === 'feats') {
      if (list.some(e => e.name === entry.name)) return
      list.push({
        _id: crypto.randomUUID(), _isCustom: true, _fromData: true,
        name: entry.name, source: entry.source || 'PHB',
        entries: entry.entries || [],
        ability: entry.ability || [],
        abilityBonus: {},
        additionalSpells: entry.additionalSpells || [],
        proficiencies: { skills: [], tools: [], weapons: [], armor: [] },
        description: '',
      })
    }
    if (tab === 'items') {
      list.push({
        _id: crypto.randomUUID(), _isCustom: true, _fromData: true,
        name: entry.name, type: entry.type || 'G', quantity: 1,
        weight: entry.weight ?? null, value: entry.value ?? null,
        ac: entry.ac ?? null, dmg1: entry.dmg1 || '', dmgType: entry.dmgType || '',
        weaponCategory: entry.weaponCategory || null,
        properties: entry.property || [], rarity: entry.rarity || 'common',
        equipped: false, attuned: false,
        entries: entry.entries || [],
        description: '', isWeapon: entry.isWeapon || false, isArmor: entry.isArmor || false,
      })
    }
    save(tab, list)
  }

  function removeEntry(id) {
    save(tab, (custom[tab] || []).filter(e => e._id !== id))
    if (editing?._id === id) setEditing(null)
  }

  function updateEntry(id, changes) {
    const list = (custom[tab] || []).map(e => e._id === id ? { ...e, ...changes } : e)
    save(tab, list)
  }

  function saveEditing() {
    if (!editing?.name?.trim()) return
    const list = [...(custom[tab] || [])]
    const idx = list.findIndex(e => e._id === editing._id)
    if (idx >= 0) list[idx] = editing
    else list.push(editing)
    save(tab, list)
    setEditing(null); setMode('list')
  }

  function adjustASI(ability, delta) {
    const asi = { ...(custom.asi || {}) }
    asi[ability] = (asi[ability] || 0) + delta
    if (asi[ability] === 0) delete asi[ability]
    updateCharacter('custom.asi', asi)
  }

  const filteredData = useMemo(() => {
    const src = tab === 'spells' ? allSpells : tab === 'feats' ? allFeats : allItems
    if (!src) return []
    if (!search.trim()) return src.slice(0, 50)
    const q = search.toLowerCase()
    return src.filter(e => e.name.toLowerCase().includes(q)).slice(0, 50)
  }, [tab, allSpells, allFeats, allItems, search])

  const entries = custom[tab] || []

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.header}>
          <span style={S.title}>✦ Custom hinzufügen / bearbeiten</span>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={S.tabs}>
          {[['spells', '✦ Zauber'], ['feats', '★ Feats'], ['items', 'Items'], ['asi', 'ASI']].map(([id, label]) => (
            <button key={id} style={{ ...S.tab, ...(tab === id ? S.tabActive : {}) }} onClick={() => setTab(id)}>
              {label}
              {id !== 'asi' && (custom[id] || []).length > 0 && <span style={S.badge}>{(custom[id] || []).length}</span>}
              {id === 'asi' && Object.keys(custom.asi || {}).length > 0 && <span style={S.badge}>{Object.keys(custom.asi || {}).length}</span>}
            </button>
          ))}
        </div>

        <div style={S.content}>

          {/* ════ ASI TAB ════ */}
          {tab === 'asi' && (
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 16 }}>
                Manuelle Ability Score Anpassungen (Manuals, Tomes, DM Boons)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {ABILITIES.map(ab => {
                  const val = (custom.asi || {})[ab] || 0
                  return (
                    <div key={ab} style={S.asiBox}>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 'bold' }}>{ABI_LABELS[ab]}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        <button style={S.asiBtn} onClick={() => adjustASI(ab, -1)}>−</button>
                        <div style={{ color: val > 0 ? 'var(--accent-green)' : val < 0 ? 'var(--accent-red)' : 'var(--text-dim)', fontSize: 18, fontWeight: 'bold', minWidth: 30, textAlign: 'center' }}>
                          {val > 0 ? `+${val}` : val}
                        </div>
                        <button style={S.asiBtn} onClick={() => adjustASI(ab, +1)}>+</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ════ LIST MODE ════ */}
          {tab !== 'asi' && mode === 'list' && (
            <>
              {entries.length === 0 && (
                <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 24, fontSize: 13 }}>
                  Keine Custom {tab === 'spells' ? 'Zauber' : tab === 'feats' ? 'Feats' : 'Items'}.
                </div>
              )}
              {entries.map(e => {
                const isExp = expanded === e._id
                return (
                  <div key={e._id} style={S.listItem}>
                    <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setExpanded(isExp ? null : e._id)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 }}>{e.name}</span>
                        {e._fromData && <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>§</span>}
                        <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>{isExp ? '▲' : '▼'}</span>
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                        {tab === 'spells' && `Lv ${e.level} · ${e.source}${e.grantedBy ? ` · ${e.grantedBy}` : ''}`}
                        {tab === 'feats' && (e.source || 'Custom')}
                        {tab === 'items' && `${e.rarity || ''}${e.equipped ? ' · Angelegt' : ''}`}
                      </div>
                    </div>
                    <button style={S.editBtn} onClick={() => { setEditing({ ...e }); setMode('homebrew') }}>✎</button>
                    <button style={S.delBtn} onClick={() => removeEntry(e._id)}>✕</button>

                    {/* Expanded description + choices */}
                    {isExp && (
                      <div style={S.expandedBlock}>
                        {/* Description */}
                        {(e.entries?.length > 0) && (
                          <div style={S.descBox}>
                            <EntryRenderer entries={e.entries} />
                            {e.entriesHigherLevel?.length > 0 && (
                              <div style={{ marginTop: 8 }}><EntryRenderer entries={e.entriesHigherLevel} /></div>
                            )}
                          </div>
                        )}
                        {e.description && !e.entries?.length && (
                          <div style={{ ...S.descBox, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>{e.description}</div>
                        )}

                        {/* Feat: ability choice */}
                        {tab === 'feats' && e.ability?.length > 0 && e.ability.some(a => a.choose) && (
                          <div style={S.choiceBlock}>
                            <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 'bold', marginBottom: 6 }}>Ability Score (+1):</div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {(e.ability[0].choose?.from || ABILITIES).map(ab => {
                                const picked = e.abilityBonus?.[ab]
                                const count = e.ability[0].choose?.count || 1
                                return (
                                  <button key={ab} onClick={() => {
                                    const next = { ...(e.abilityBonus || {}) }
                                    if (next[ab]) delete next[ab]
                                    else if (Object.keys(next).length < count) next[ab] = 1
                                    updateEntry(e._id, { abilityBonus: next })
                                  }} style={{
                                    ...S.abilBtn, borderColor: picked ? 'var(--accent)' : 'var(--border)',
                                    color: picked ? 'var(--accent)' : 'var(--text-muted)',
                                    background: picked ? 'var(--bg-highlight)' : 'transparent',
                                  }}>
                                    {ab.toUpperCase()}{picked ? ` +${picked}` : ''}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* Feat: granted by / source note */}
                        {tab === 'items' && (
                          <div style={S.choiceBlock}>
                            <div style={{ display: 'flex', gap: 12 }}>
                              <label style={S.check}><input type="checkbox" checked={e.equipped}
                                onChange={ev => updateEntry(e._id, { equipped: ev.target.checked })} /> Ausgerüstet</label>
                              <label style={S.check}><input type="checkbox" checked={e.attuned}
                                onChange={ev => updateEntry(e._id, { attuned: ev.target.checked })} /> Eingestimmt</label>
                            </div>
                          </div>
                        )}

                        {tab === 'spells' && (
                          <div style={S.choiceBlock}>
                            <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 'bold', marginBottom: 4 }}>Herkunft:</div>
                            <input style={{ ...S.input, fontSize: 12 }} value={e.grantedBy || ''} placeholder="z.B. Magic Item, DM Boon"
                              onChange={ev => updateEntry(e._id, { grantedBy: ev.target.value })} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button style={{ ...S.addBtn, flex: 1 }} onClick={() => { loadData(tab); setMode('data'); setSearch('') }}>
                  Aus Daten
                </button>
                <button style={{ ...S.addBtn, flex: 1 }} onClick={() => {
                  setEditing(tab === 'spells' ? emptySpell() : tab === 'feats' ? emptyFeat() : emptyItem())
                  setMode('homebrew')
                }}>
                  ✎ Homebrew
                </button>
              </div>
            </>
          )}

          {/* ════ DATA BROWSE MODE ════ */}
          {tab !== 'asi' && mode === 'data' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ color: 'var(--accent)', fontWeight: 'bold', fontSize: 14 }}>
                  {tab === 'spells' ? 'Zauber' : tab === 'feats' ? 'Feats' : 'Items'}
                </div>
                <button style={S.backBtn} onClick={() => setMode('list')}>← Zurück</button>
              </div>
              <input style={S.searchInput} placeholder="Suchen..." value={search}
                onChange={e => setSearch(e.target.value)} autoFocus />
              <div style={S.dataList}>
                {(tab === 'spells' ? allSpells : tab === 'feats' ? allFeats : allItems) === null
                  ? <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>Lade Daten...</div>
                  : filteredData.length === 0
                    ? <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 20 }}>Keine Ergebnisse</div>
                    : filteredData.map(entry => {
                        const alreadyAdded = entries.some(e => e.name === entry.name)
                        const isExp = expanded === `data_${entry.id || entry.name}`
                        return (
                          <div key={entry.id || entry.name} style={{ ...S.dataItem, opacity: alreadyAdded ? 0.4 : 1, flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, cursor: 'pointer', minWidth: 200 }}
                              onClick={() => setExpanded(isExp ? null : `data_${entry.id || entry.name}`)}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 'bold' }}>{entry.name}</span>
                                <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>{isExp ? '▲' : '▼'}</span>
                              </div>
                              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                                {tab === 'spells' && `Lv ${entry.level ?? 0} · ${entry.source}`}
                                {tab === 'feats' && (entry.source || '')}
                                {tab === 'items' && `${entry.type || '?'} · ${entry.rarity || 'common'}`}
                              </div>
                            </div>
                            <button style={S.addItemBtn} onClick={() => addFromData(entry)} disabled={alreadyAdded}>
                              {alreadyAdded ? '✓' : '+'}
                            </button>

                            {/* Expanded description */}
                            {isExp && entry.entries?.length > 0 && (
                              <div style={{ width: '100%', marginTop: 6 }}>
                                <div style={S.descBox}>
                                  <EntryRenderer entries={entry.entries} />
                                  {entry.entriesHigherLevel?.length > 0 && (
                                    <div style={{ marginTop: 8 }}><EntryRenderer entries={entry.entriesHigherLevel} /></div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                {filteredData.length === 50 && (
                  <div style={{ color: 'var(--text-dim)', fontSize: 11, textAlign: 'center', padding: 8 }}>Suche eingrenzen für mehr Ergebnisse</div>
                )}
              </div>
            </>
          )}

          {/* ════ HOMEBREW / EDIT MODE ════ */}
          {tab !== 'asi' && mode === 'homebrew' && editing && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ color: 'var(--accent)', fontWeight: 'bold', fontSize: 14 }}>
                  {entries.find(e => e._id === editing._id) ? 'Bearbeiten' : 'Homebrew'}
                </div>
                <button style={S.backBtn} onClick={() => { setEditing(null); setMode('list') }}>← Zurück</button>
              </div>
              {tab === 'spells' && <SpellForm data={editing} onChange={setEditing} />}
              {tab === 'feats' && <FeatForm data={editing} onChange={setEditing} />}
              {tab === 'items' && <ItemForm data={editing} onChange={setEditing} />}
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button style={S.cancelBtn} onClick={() => { setEditing(null); setMode('list') }}>Abbrechen</button>
                <button style={S.saveBtn} onClick={saveEditing} disabled={!editing.name?.trim()}>✓ Speichern</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const emptySpell = () => ({ _id: crypto.randomUUID(), _isCustom: true, name: '', level: 0, school: 'V', castingTime: '1 action', range: '60 ft.', duration: 'Instantaneous', concentration: false, ritual: false, description: '', source: 'Homebrew', grantedBy: '' })
const emptyFeat = () => ({ _id: crypto.randomUUID(), _isCustom: true, name: '', description: '', source: 'Homebrew', abilityBonus: {}, proficiencies: { skills: [], tools: [], weapons: [], armor: [] } })
const emptyItem = () => ({ _id: crypto.randomUUID(), _isCustom: true, name: '', type: 'G', quantity: 1, weight: null, value: null, ac: null, dmg1: '', dmgType: '', weaponCategory: null, properties: [], rarity: 'common', equipped: false, attuned: false, description: '', isWeapon: false, isArmor: false })

function SpellForm({ data, onChange }) {
  const set = (k, v) => onChange({ ...data, [k]: v })
  return (
    <div style={S.form}>
      <Row label="Name"><input style={S.input} value={data.name} onChange={e => set('name', e.target.value)} /></Row>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Row label="Level"><select style={S.input} value={data.level} onChange={e => set('level', parseInt(e.target.value))}>
          <option value={0}>Cantrip</option>{[1,2,3,4,5,6,7,8,9].map(l => <option key={l} value={l}>{l}</option>)}
        </select></Row>
        <Row label="Schule"><select style={S.input} value={data.school} onChange={e => set('school', e.target.value)}>
          {SCHOOLS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select></Row>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Row label="Wirkzeit"><input style={S.input} value={data.castingTime} onChange={e => set('castingTime', e.target.value)} /></Row>
        <Row label="Reichweite"><input style={S.input} value={data.range} onChange={e => set('range', e.target.value)} /></Row>
      </div>
      <Row label="Dauer"><input style={S.input} value={data.duration} onChange={e => set('duration', e.target.value)} /></Row>
      <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
        <label style={S.check}><input type="checkbox" checked={data.concentration} onChange={e => set('concentration', e.target.checked)} /> Konzentration</label>
        <label style={S.check}><input type="checkbox" checked={data.ritual} onChange={e => set('ritual', e.target.checked)} /> Ritual</label>
      </div>
      <Row label="Herkunft"><input style={S.input} value={data.grantedBy || ''} onChange={e => set('grantedBy', e.target.value)} placeholder="z.B. Magic Item, DM Boon" /></Row>
      <Row label="Beschreibung"><textarea style={{ ...S.input, minHeight: 60, resize: 'vertical' }} value={data.description} onChange={e => set('description', e.target.value)} /></Row>
    </div>
  )
}

function FeatForm({ data, onChange }) {
  const set = (k, v) => onChange({ ...data, [k]: v })
  const ab = data.abilityBonus || {}
  function toggleAb(a) { const n = { ...ab }; if (n[a]) delete n[a]; else n[a] = 1; set('abilityBonus', n) }
  return (
    <div style={S.form}>
      <Row label="Name"><input style={S.input} value={data.name} onChange={e => set('name', e.target.value)} /></Row>
      <Row label="Quelle"><input style={S.input} value={data.source} onChange={e => set('source', e.target.value)} /></Row>
      <Row label="Ability Bonus (+1)">
        <div style={{ display: 'flex', gap: 6 }}>
          {ABILITIES.map(a => (
            <button key={a} onClick={() => toggleAb(a)} style={{ ...S.abilBtn, borderColor: ab[a] ? 'var(--accent)' : 'var(--border)', color: ab[a] ? 'var(--accent)' : 'var(--text-muted)', background: ab[a] ? 'var(--bg-highlight)' : 'transparent' }}>
              {a.toUpperCase()}{ab[a] ? ` +${ab[a]}` : ''}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Beschreibung"><textarea style={{ ...S.input, minHeight: 80, resize: 'vertical' }} value={data.description} onChange={e => set('description', e.target.value)} /></Row>
    </div>
  )
}

function ItemForm({ data, onChange }) {
  const set = (k, v) => onChange({ ...data, [k]: v })
  const isW = ['M', 'R'].includes(data.type), isA = ['LA', 'MA', 'HA', 'S'].includes(data.type)
  function setType(t) { onChange({ ...data, type: t, isWeapon: ['M', 'R'].includes(t), isArmor: ['LA', 'MA', 'HA', 'S'].includes(t) }) }
  return (
    <div style={S.form}>
      <Row label="Name"><input style={S.input} value={data.name} onChange={e => set('name', e.target.value)} /></Row>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Row label="Typ"><select style={S.input} value={data.type} onChange={e => setType(e.target.value)}>{ITEM_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Row>
        <Row label="Seltenheit"><select style={S.input} value={data.rarity} onChange={e => set('rarity', e.target.value)}>{RARITIES.map(r => <option key={r} value={r}>{r}</option>)}</select></Row>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <Row label="Anzahl"><input style={S.input} type="number" min={1} value={data.quantity} onChange={e => set('quantity', parseInt(e.target.value) || 1)} /></Row>
        <Row label="Gewicht"><input style={S.input} type="number" step={0.1} value={data.weight || ''} onChange={e => set('weight', parseFloat(e.target.value) || null)} /></Row>
        <Row label="Wert (gp)"><input style={S.input} type="number" value={data.value ? data.value / 100 : ''} onChange={e => set('value', (parseFloat(e.target.value) || 0) * 100)} /></Row>
      </div>
      {isW && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Row label="Schaden"><input style={S.input} value={data.dmg1 || ''} onChange={e => set('dmg1', e.target.value)} placeholder="1d8" /></Row>
        <Row label="Typ"><input style={S.input} value={data.dmgType || ''} onChange={e => set('dmgType', e.target.value)} placeholder="S, P, B" /></Row>
      </div>}
      {isA && <Row label="AC"><input style={S.input} type="number" value={data.ac || ''} onChange={e => set('ac', parseInt(e.target.value) || null)} /></Row>}
      <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
        <label style={S.check}><input type="checkbox" checked={data.equipped} onChange={e => set('equipped', e.target.checked)} /> Ausgerüstet</label>
        <label style={S.check}><input type="checkbox" checked={data.attuned} onChange={e => set('attuned', e.target.checked)} /> Eingestimmt</label>
      </div>
      <Row label="Beschreibung"><textarea style={{ ...S.input, minHeight: 50, resize: 'vertical' }} value={data.description || ''} onChange={e => set('description', e.target.value)} /></Row>
    </div>
  )
}

function Row({ label, children }) {
  return <div style={{ marginBottom: 8 }}><div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 'bold', marginBottom: 3 }}>{label}</div>{children}</div>
}

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9998 },
  modal: { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, width: 580, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px var(--shadow)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' },
  title: { color: 'var(--accent)', fontSize: 17, fontWeight: 'bold' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer' },
  tabs: { display: 'flex', gap: 4, padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' },
  tab: { flex: 1, padding: '8px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 },
  tabActive: { background: 'var(--bg-highlight)', color: 'var(--accent)', borderColor: 'var(--accent)' },
  badge: { background: 'var(--accent)', color: 'var(--bg-deep)', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 'bold' },
  content: { padding: 20, overflowY: 'auto', flex: 1 },
  listItem: { padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 6, background: 'var(--bg-card)', display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' },
  editBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '4px 8px', flexShrink: 0 },
  delBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '4px 8px', color: 'var(--accent-red)', flexShrink: 0 },
  addBtn: { padding: 12, borderRadius: 8, border: '2px dashed var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, textAlign: 'center' },
  backBtn: { padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 },
  searchInput: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-inset)', color: 'var(--text-primary)', fontSize: 14, marginBottom: 10, boxSizing: 'border-box' },
  dataList: { maxHeight: 400, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--border)' },
  dataItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' },
  addItemBtn: { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 16, fontWeight: 'bold', flexShrink: 0 },
  expandedBlock: { width: '100%', marginTop: 8 },
  descBox: { padding: '10px 12px', background: 'var(--bg-inset)', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 13, lineHeight: 1.6 },
  choiceBlock: { marginTop: 8, padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' },
  form: { display: 'flex', flexDirection: 'column' },
  input: { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-inset)', color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' },
  check: { color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 },
  abilBtn: { padding: '4px 10px', borderRadius: 6, border: '1px solid', background: 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 'bold' },
  cancelBtn: { flex: 1, padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 },
  saveBtn: { flex: 2, padding: 10, borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--bg-deep)', fontWeight: 'bold', cursor: 'pointer', fontSize: 13 },
  asiBox: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', textAlign: 'center' },
  asiBtn: { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 16, fontWeight: 'bold' },
}
