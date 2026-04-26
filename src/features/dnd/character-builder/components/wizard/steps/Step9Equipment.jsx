// components/steps/Step9Equipment.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Equipment selection step.
//
// Top:    Starting equipment from class + background (A/B/C option choice)
// Middle: Current inventory with equip/unequip
// Bottom: Item browser with search, type filter, rarity filter
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react'
import { loadItemIndex, loadClassList, loadBackgroundList, parseStartingEquipment, resolveItemRef } from '../../../lib/dataLoader'
import { useLanguage } from '../../../lib/i18n'

// ── Constants ──────────────────────────────────────────────────────────────────

const TYPE_LABELS = {
  M:  'Melee Weapon',  R:  'Ranged Weapon',
  LA: 'Light Armor',   MA: 'Medium Armor', HA: 'Heavy Armor', S: 'Shield',
  G:  'Adventuring Gear', AT: 'Artisan Tools', INS: 'Instrument',
  P:  'Potion',        SC: 'Scroll',       RG: 'Ring',  WD: 'Wand', RD: 'Rod',
  OTH:'Other',         SCF:'Spellcasting Focus',
}

const DAMAGE_TYPE = {
  S: 'Slashing', P: 'Piercing', B: 'Bludgeoning', N: 'Necrotic',
  R: 'Radiant',  F: 'Fire',     C: 'Cold',         L: 'Lightning',
  T: 'Thunder',  O: 'Poison',   A: 'Acid',         I: 'Psychic',
}

// Weapon property abbreviations → display labels (shown in dropdowns)
const WEAPON_PROP = {
  F: 'Finesse', '2H': 'Zweihand', V: 'Vielseitig', H: 'Schwer',
  L: 'Leicht', T: 'Wurf', R: 'Reichweite', A: 'Munition', LD: 'Laden', S: 'Spezial',
}

// Format a short tag string for dropdown display
function itemDropdownLabel(item) {
  const parts = [item.name]
  const tags = []
  if (item.isWeapon && item.dmg1) tags.push(`${item.dmg1} ${DAMAGE_TYPE[item.dmgType] || ''}`.trim())
  // Weapon properties: finesse, two-handed, etc.
  if (item.property?.length > 0) {
    for (const p of item.property) {
      const code = String(p).split('|')[0].toUpperCase()
      if (WEAPON_PROP[code]) tags.push(WEAPON_PROP[code])
    }
  }
  // Armor: STR requirement
  if (item.isArmor && item.strength) tags.push(`STR ${item.strength}`)
  // Armor: stealth disadvantage
  if (item.isArmor && item.stealth) tags.push('Stealth ✕')
  // Armor: AC
  if (item.isArmor && item.ac) tags.push(`AC ${item.ac}`)
  if (tags.length > 0) parts.push(`(${tags.join(', ')})`)
  return parts.join(' ')
}

const RARITY_COLORS = {
  mundane:    'var(--text-muted)', none: 'var(--text-muted)',
  common:     'var(--text-secondary)',
  uncommon:   'var(--accent-green)',
  rare:       'var(--accent-blue)',
  'very rare':'var(--accent-purple)',
  legendary:  'var(--accent)',
  artifact:   'var(--accent-red)',
}

const FILTER_CATEGORIES = [
  { id: 'all',     label: 'Alle' },
  { id: 'weapon',  label: 'Waffen' },
  { id: 'armor',   label: 'Rüstung' },
  { id: 'gear',    label: 'Ausrüstung' },
  { id: 'magic',   label: 'Magisch' },
]

const FILTER_RARITIES = [
  { id: 'all',        label: 'Alle Raritäten' },
  { id: 'mundane',    label: 'Mundane' },
  { id: 'common',     label: 'Common' },
  { id: 'uncommon',   label: 'Uncommon' },
  { id: 'rare',       label: 'Rare' },
  { id: 'very rare',  label: 'Very Rare' },
  { id: 'legendary',  label: 'Legendary' },
  { id: 'artifact',   label: 'Artifact' },
]

function cpToGP(cp) { return Math.floor((cp || 0) / 100) }
function gpToCP(gp) { return (gp || 0) * 100 }

function stripTags(str) {
  return String(str || '')
    .replace(/\{@[a-z]+\s+([^|}]+)(?:\|[^}]*)?\}/gi, (_, inner) => inner.trim())
    .replace(/@[a-z]+\s+\S+/gi, '')
    .trim()
}

function getItemDescription(item) {
  if (!item?.entries?.length) return null
  return item.entries
    .map(e => typeof e === 'string' ? stripTags(e) : '')
    .filter(Boolean)
    .join(' ')
    .slice(0, 300)
}

let _idCounter = 0
function nextId() { return `item_${Date.now()}_${_idCounter++}` }

// ── Main Component ─────────────────────────────────────────────────────────────

export default function Step9Equipment({ character, updateCharacter }) {
  const { t } = useLanguage()
  const edition = character.meta.edition
  const cls     = character.classes[0]

  // ── Data loading ──────────────────────────────────────────────────────────
  const [itemIndex, setItemIndex] = useState([])
  const [classData, setClassData] = useState(null)
  const [bgData,    setBgData]    = useState(null)
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [items, classes, bgs] = await Promise.all([
        loadItemIndex(edition),
        loadClassList(edition),
        loadBackgroundList(edition),
      ])
      if (cancelled) return
      setItemIndex(items)
      const c = classes.find(c => c.id === cls?.classId)
      setClassData(c || null)
      const b = bgs.find(b => b.id === character.background.backgroundId)
      setBgData(b || null)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [edition, cls?.classId, character.background.backgroundId])

  // ── Parse starting equipment ──────────────────────────────────────────────
  const classEquip = useMemo(() => {
    if (!classData?.startingEquipment) return { groups: [], entries: [], isPackageChoice: false }
    return parseStartingEquipment(classData.startingEquipment, itemIndex)
  }, [classData, itemIndex])

  const bgEquip = useMemo(() => {
    if (!bgData?.startingEquipment) return { groups: [], entries: [], isPackageChoice: false }
    return parseStartingEquipment(bgData.startingEquipment, itemIndex)
  }, [bgData, itemIndex])

  // Per-group choices: { groupIndex: 'A' }
  // Restore from character on revisit
  const [equipChoices, setEquipChoices] = useState(
    character.inventory.startingEquipmentChoices || {}
  )

  // Picks for placeholder items like "Any Simple Weapon": { "gIdx:optKey:itemIdx": itemName }
  const [placeholderPicks, setPlaceholderPicks] = useState(
    character.inventory.startingEquipmentPickerChoices || {}
  )

  // ── Item browser state ────────────────────────────────────────────────────
  const [search,    setSearch]    = useState('')
  const [category,  setCategory]  = useState('all')
  const [rarity,    setRarity]    = useState('all')
  const [viewItem,  setViewItem]  = useState(null)
  const [goldInput, setGoldInput] = useState('')

  // ── Filtered items for browser ────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    let items = itemIndex.filter(i => !i._isMagicVariant) // hide variant templates
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(i => i.name.toLowerCase().includes(q))
    }
    if (category !== 'all') {
      if (category === 'weapon') items = items.filter(i => i.isWeapon)
      else if (category === 'armor') items = items.filter(i => i.isArmor)
      else if (category === 'gear') items = items.filter(i => i.isGear && !isMagicRarity(i.rarity))
      else if (category === 'magic') items = items.filter(i => isMagicRarity(i.rarity))
    }
    if (rarity !== 'all') {
      const r = rarity.toLowerCase()
      items = items.filter(i => (i.rarity || 'none').toLowerCase() === r ||
        (r === 'mundane' && ['none','mundane'].includes((i.rarity||'').toLowerCase())))
    }
    return items.slice(0, 100) // cap for performance
  }, [itemIndex, search, category, rarity])

  // ── Handlers ──────────────────────────────────────────────────────────────

  // Returns filtered itemIndex for a given equipmentType string (base/mundane items only)
  function getItemsForEquipType(equipmentType) {
    if (!equipmentType) return []
    return itemIndex.filter(item => {
      if (isMagicRarity(item.rarity)) return false
      if (equipmentType === 'weaponMartialMelee')  return item.weaponCategory === 'martial' && item.type === 'M'
      if (equipmentType === 'weaponMartialRanged') return item.weaponCategory === 'martial' && item.type === 'R'
      if (equipmentType === 'weaponMartial')       return item.weaponCategory === 'martial'
      if (equipmentType === 'weaponSimple')        return item.weaponCategory === 'simple'
      if (equipmentType === 'weaponSimpleMelee')   return item.weaponCategory === 'simple' && item.type === 'M'
      if (equipmentType === 'weaponSimpleRanged')  return item.weaponCategory === 'simple' && item.type === 'R'
      // Spellcasting focus types: focusSpellcastingArcane → scfType "arcane", etc.
      if (equipmentType.startsWith('focusSpellcasting')) {
        const sub = equipmentType.replace('focusSpellcasting', '').toLowerCase()
        return item.type === 'SCF' && item.scfType && item.scfType.toLowerCase() === sub
      }
      // Musical instruments
      if (equipmentType === 'instrumentMusical') return item.type === 'INS'
      return false
    }).sort((a, b) => a.name.localeCompare(b.name))
  }

  // Expand a pack into its individual contents, or return [item] if not a pack
  function expandItemForInventory(item, source) {
    if (!item.packContents || item.packContents.length === 0) {
      return [makeInventoryItem(item, source)]
    }
    const result = []
    for (const c of item.packContents) {
      if (typeof c === 'string') {
        const resolved = resolveItemRef(c, itemIndex)
        if (resolved) result.push(makeInventoryItem({ ...resolved, quantity: 1, displayName: resolved.name }, source))
      } else if (c.item) {
        const resolved = resolveItemRef(c.item, itemIndex)
        if (resolved) result.push(makeInventoryItem({ ...resolved, quantity: c.quantity || 1, displayName: resolved.name }, source))
        else result.push(makeInventoryItem({ name: c.item.split('|')[0].trim(), quantity: c.quantity || 1, rarity: 'none', isWeapon: false, isArmor: false, isGear: true }, source))
      } else if (c.special) {
        result.push(makeInventoryItem({ name: c.special, quantity: 1, rarity: 'none', isWeapon: false, isArmor: false, isGear: true }, source))
      }
    }
    return result
  }

  // Resolve pack contents to display strings like ["Backpack", "Candle ×5", …]
  function resolvePackContentsDisplay(packContents) {
    return packContents.map(c => {
      if (typeof c === 'string') {
        const name = c.split('|')[0].trim()
        const found = itemIndex.find(i => i.name.toLowerCase() === name.toLowerCase())
        return found ? found.name : name
      }
      if (c.item) {
        const name = c.item.split('|')[0].trim()
        const found = itemIndex.find(i => i.name.toLowerCase() === name.toLowerCase())
        const label = found ? found.name : name
        return c.quantity > 1 ? `${c.quantity}× ${label}` : label
      }
      if (c.special) return c.special
      return null
    }).filter(Boolean)
  }

  // Rebuild entire starting-equipment inventory from current choices + picks
  function rebuildInventory(newChoices, newPicks) {
    const manualItems = (character.inventory.items || []).filter(i => i.grantedBy === 'manual')
    const classItems = []
    let totalGold = 0

    for (const [gIdxStr, chosenKey] of Object.entries(newChoices)) {
      const gIdx = parseInt(gIdxStr)
      const group = classEquip.groups[gIdx]
      if (!group) continue
      const opt = group.options.find(o => o.key === chosenKey)
      if (!opt) continue
      totalGold += opt.gold || 0
      opt.items.forEach((item, iIdx) => {
        if (item.isPlaceholder) {
          const pickedName = newPicks[`${gIdx}:${chosenKey}:${iIdx}`]
          if (pickedName) {
            const resolved = itemIndex.find(i => i.name === pickedName) || { name: pickedName, rarity: 'none', isWeapon: true, isArmor: false, isGear: false }
            classItems.push(makeInventoryItem({ ...resolved, quantity: item.quantity, displayName: resolved.name }, 'class'))
          }
        } else {
          classItems.push(...expandItemForInventory(item, 'class'))
        }
      })
    }
    for (const item of classEquip.mandatoryItems || []) {
      classItems.push(...expandItemForInventory(item, 'class'))
    }

    const bgItems = []
    if (bgEquip.groups.length > 0) {
      const bgGroup = bgEquip.groups[0]
      const bgOpt = bgGroup?.options?.find(o => o.key === 'A') || bgGroup?.options?.[0]
      if (bgOpt) {
        totalGold += bgOpt.gold || 0
        bgOpt.items.forEach((item, iIdx) => {
          if (item.isPlaceholder) {
            const pickedName = newPicks[`bg:A:${iIdx}`]
            if (pickedName) {
              const resolved = itemIndex.find(i => i.name === pickedName) || { name: pickedName, rarity: 'none', isWeapon: true, isArmor: false, isGear: false }
              bgItems.push(makeInventoryItem({ ...resolved, quantity: item.quantity, displayName: resolved.name }, 'background'))
            }
          } else {
            bgItems.push(...expandItemForInventory(item, 'background'))
          }
        })
      }
    }
    for (const item of bgEquip.mandatoryItems || []) {
      bgItems.push(...expandItemForInventory(item, 'background'))
    }

    updateCharacter('inventory.items', [...classItems, ...bgItems, ...manualItems])
    updateCharacter('inventory.currency', { ...character.inventory.currency, gp: cpToGP(totalGold) })
  }

  function selectGroupOption(groupIdx, key) {
    const newChoices = { ...equipChoices }
    if (newChoices[groupIdx] === key) {
      delete newChoices[groupIdx]
    } else {
      newChoices[groupIdx] = key
    }
    setEquipChoices(newChoices)
    updateCharacter('inventory.startingEquipmentChoices', newChoices)
    rebuildInventory(newChoices, placeholderPicks)
  }

  function handlePlaceholderPick(pickKey, itemName) {
    const newPicks = { ...placeholderPicks, [pickKey]: itemName }
    setPlaceholderPicks(newPicks)
    updateCharacter('inventory.startingEquipmentPickerChoices', newPicks)
    rebuildInventory(equipChoices, newPicks)
  }

  function makeInventoryItem(item, grantedBy) {
    return {
      id: nextId(),
      itemId: item.name,
      source: item.source || '',
      name: item.displayName || item.name,
      quantity: item.quantity || 1,
      equipped: item.isArmor || item.isWeapon || false,
      attuned: false,
      grantedBy,
      type: item.type || null,
      weight: item.weight ?? null,
      value: item.value ?? null,
      ac: item.ac ?? null,
      dmg1: item.dmg1 || null,
      dmgType: item.dmgType || null,
      weaponCategory: item.weaponCategory || null,
      isWeapon: item.isWeapon || false,
      isArmor: item.isArmor || false,
      rarity: item.rarity || 'none',
      properties: item.property || [],
    }
  }

  function addItemToInventory(item) {
    const newItem = {
      id: nextId(),
      itemId: item.name,
      source: item.source || '',
      name: item.name,
      quantity: 1,
      equipped: false,
      attuned: false,
      grantedBy: 'manual',
      type: item.type || null,
      weight: item.weight ?? null,
      value: item.value ?? null,
      ac: item.ac ?? null,
      dmg1: item.dmg1 || null,
      dmgType: item.dmgType || null,
      weaponCategory: item.weaponCategory || null,
      isWeapon: item.isWeapon || false,
      isArmor: item.isArmor || false,
      rarity: item.rarity || 'none',
      properties: item.property || [],
    }
    updateCharacter('inventory.items', [...(character.inventory.items || []), newItem])
  }

  function removeItem(id) {
    updateCharacter('inventory.items', (character.inventory.items || []).filter(i => i.id !== id))
  }

  function toggleEquip(id) {
    updateCharacter('inventory.items', (character.inventory.items || []).map(i =>
      i.id === id ? { ...i, equipped: !i.equipped } : i
    ))
  }

  function updateQuantity(id, delta) {
    updateCharacter('inventory.items', (character.inventory.items || []).map(i => {
      if (i.id !== id) return i
      const next = Math.max(0, (i.quantity || 1) + delta)
      return next === 0 ? null : { ...i, quantity: next }
    }).filter(Boolean))
  }

  function setGold(gp) {
    const n = parseInt(gp)
    if (isNaN(n) || n < 0) return
    updateCharacter('inventory.currency', { ...character.inventory.currency, gp: n })
  }

  if (loading) {
    return (
      <div style={S.container}>
        <h2 style={S.title}>Equipment</h2>
        <div style={{ color: 'var(--accent)', textAlign: 'center', padding: 40 }}>Lade Items...</div>
      </div>
    )
  }

  const inventoryItems = character.inventory.items || []
  const totalWeight = inventoryItems.reduce((sum, i) => sum + (i.weight || 0) * (i.quantity || 1), 0)

  return (
    <div style={S.container}>
      <h2 style={S.title}>Equipment & Inventar</h2>
      <p style={S.subtitle}>
        Wähle deine Startausrüstung und füge weitere Items hinzu.
        Gegenstände höherer Seltenheit nur mit DM-Absprache.
      </p>

      {/* ── 1. Starting Equipment ─────────────────────────────────────────── */}
      {classEquip.groups.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionTitle}>
            Startausrüstung — {cls?.classId || 'Klasse'}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
            {classEquip.isPackageChoice
              ? 'Wähle eines der folgenden Pakete:'
              : 'Wähle eine Option pro Gruppe:'}
          </div>

          {classEquip.groups.map((group, gIdx) => (
            <div key={gIdx} style={{ marginBottom: classEquip.groups.length > 1 ? 14 : 0 }}>
              {classEquip.groups.length > 1 && (
                <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 'bold', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Wahl {gIdx + 1}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {group.options.map(opt => {
                  const isSel = equipChoices[gIdx] === opt.key
                  const goldGP = cpToGP(opt.gold)
                  return (
                    <div key={opt.key}
                      onClick={() => selectGroupOption(gIdx, opt.key)}
                      style={{
                        ...S.optionCard,
                        ...(isSel ? S.optionCardSelected : {}),
                      }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: opt.items.length > 0 ? 6 : 0 }}>
                        <span style={{
                          ...S.optionBadge,
                          background: isSel ? 'var(--accent)' : 'var(--border)',
                          color: isSel ? 'var(--bg-deep)' : 'var(--text-muted)',
                          flexShrink: 0,
                          marginTop: 2,
                        }}>{opt.key}</span>
                        {opt.items.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, flex: 1 }}>
                            {opt.items.map((item, i) => {
                              if (item.isPlaceholder) {
                                const pickKey = `${gIdx}:${opt.key}:${i}`
                                const pickedName = placeholderPicks[pickKey]
                                const pickedItem = pickedName ? itemIndex.find(x => x.name === pickedName) : null
                                const choices = getItemsForEquipType(item.equipmentType)
                                return (
                                  <div key={i} onClick={e => e.stopPropagation()}
                                       style={{ ...S.itemPill, padding: '6px 10px', minWidth: 160, display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg-inset)', borderColor: isSel ? 'var(--border)' : 'var(--bg-highlight)' }}>
                                    <div style={{ color: 'var(--text-muted)', fontSize: 11, fontStyle: 'italic' }}>{item.displayName}</div>
                                    {isSel ? (
                                      <select
                                        value={pickedName || ''}
                                        onChange={e => handlePlaceholderPick(pickKey, e.target.value)}
                                        style={{ fontSize: 11, background: 'var(--bg-card)', color: pickedName ? 'var(--text-secondary)' : 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 6px' }}>
                                        <option value=''>— auswählen —</option>
                                        {choices.map(w => (
                                          <option key={w.name} value={w.name}>
                                            {itemDropdownLabel(w)}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>nach Wahl</div>
                                    )}
                                    {pickedItem && (
                                      <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                                        {[pickedItem.dmg1 && `${pickedItem.dmg1} ${DAMAGE_TYPE[pickedItem.dmgType] || ''}`.trim(), pickedItem.weight && `${pickedItem.weight} lb`].filter(Boolean).join(' · ')}
                                      </div>
                                    )}
                                  </div>
                                )
                              }
                              const details = [
                                item.dmg1 && `${item.dmg1}${item.dmgType ? ' ' + (DAMAGE_TYPE[item.dmgType] || item.dmgType) : ''}`,
                                item.isArmor && item.ac && `AC ${item.ac}`,
                                item.weight && `${item.weight} lb`,
                              ].filter(Boolean).join(' · ')
                              const isPack = item.packContents && item.packContents.length > 0
                              return (
                                <div key={i} style={{ ...S.itemPill, padding: '5px 9px', display: 'flex', flexDirection: 'column', gap: 2, ...(isPack ? { minWidth: 180 } : {}) }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    {item.isWeapon && <span style={{ fontSize: 10 }}>⚔</span>}
                                    {item.isArmor && <span style={{ fontSize: 10 }}>◊</span>}
                                    {isPack && <span style={{ fontSize: 10 }}>▤</span>}
                                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                      {item.quantity > 1 ? `${item.quantity}× ` : ''}{item.displayName || item.name}
                                    </span>
                                  </div>
                                  {details && !isPack && <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{details}</div>}
                                  {isPack && (
                                    <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                                      {resolvePackContentsDisplay(item.packContents).join(' · ')}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                        {goldGP > 0 && (
                          <span style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                            {goldGP} GP
                          </span>
                        )}
                        {isSel && <span style={{ color: 'var(--accent-green)', fontSize: 12, fontWeight: 'bold' }}>✓</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Human-readable description */}
          {classEquip.entries.length > 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 10, fontStyle: 'italic' }}>
              {stripTags(classEquip.entries[0])}
            </div>
          )}
        </div>
      )}

      {/* ── 2. Current Inventory ──────────────────────────────────────────── */}
      <div style={S.section}>
        <div style={{ ...S.sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Inventar ({inventoryItems.length} Items)</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 'normal', textTransform: 'none' }}>
            Gewicht: {totalWeight.toFixed(1)} lb
          </span>
        </div>

        {/* Gold */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '8px 12px', background: 'var(--bg-inset)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 'bold', fontSize: 15 }}>
            {character.inventory.currency?.gp || 0} GP
          </span>
          <input
            type="number" min="0"
            style={{ ...S.goldInput, marginLeft: 'auto' }}
            value={goldInput}
            placeholder="GP ändern"
            onChange={e => setGoldInput(e.target.value)}
            onBlur={() => {
              if (goldInput.trim()) setGold(parseInt(goldInput) || 0)
              setGoldInput('')
            }}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
          />
        </div>

        {inventoryItems.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 20, fontSize: 13 }}>
            Keine Items. Wähle eine Startausrüstung oder füge Items aus dem Browser hinzu.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {inventoryItems.map(item => (
              <InventoryRow key={item.id} item={item}
                onToggleEquip={() => toggleEquip(item.id)}
                onRemove={() => removeItem(item.id)}
                onQuantityChange={delta => updateQuantity(item.id, delta)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── 3. Item Browser ──────────────────────────────────────────────── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Item Browser</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 10 }}>
          Suche und füge Items hinzu.
          <span style={{ color: 'var(--accent)', marginLeft: 6 }}>
            ⚠ Magische Items nur mit DM-Absprache
          </span>
        </div>

        {/* Search + Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input
            style={S.searchInput}
            placeholder="Item suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select style={S.filterSelect} value={category} onChange={e => setCategory(e.target.value)}>
            {FILTER_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select style={S.filterSelect} value={rarity} onChange={e => setRarity(e.target.value)}>
            {FILTER_RARITIES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>

        {/* Results */}
        <div style={S.browserGrid}>
          {filteredItems.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 20, gridColumn: '1/-1' }}>
              Keine Items gefunden.
            </div>
          ) : (
            filteredItems.map(item => (
              <BrowserItem key={`${item.name}__${item.source}`} item={item}
                isViewing={viewItem?.name === item.name}
                onView={() => setViewItem(viewItem?.name === item.name ? null : item)}
                onAdd={() => addItemToInventory(item)}
              />
            ))
          )}
        </div>

        {/* Item Detail Panel */}
        {viewItem && (
          <div style={S.detailPanel}>
            <ItemDetail item={viewItem} onAdd={() => addItemToInventory(viewItem)} />
          </div>
        )}

        {filteredItems.length >= 100 && (
          <div style={{ color: 'var(--text-dim)', fontSize: 11, textAlign: 'center', marginTop: 8 }}>
            Zeige erste 100 Ergebnisse — verfeinere die Suche für mehr
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-Components ─────────────────────────────────────────────────────────────

function InventoryRow({ item, onToggleEquip, onRemove, onQuantityChange }) {
  const rarityColor = RARITY_COLORS[item.rarity] || 'var(--text-muted)'
  const isMagic = isMagicRarity(item.rarity)

  return (
    <div style={S.invRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: rarityColor, fontWeight: 'bold', fontSize: 13 }}>
            {item.isWeapon && '⚔ '}{item.isArmor && '◊ '}
            {item.name}
          </span>
          {isMagic && <span style={{ fontSize: 10, color: rarityColor, background: 'var(--bg-inset)', padding: '1px 5px', borderRadius: 3 }}>{item.rarity}</span>}
          {item.grantedBy !== 'manual' && (
            <span style={S.sourceTag}>{item.grantedBy}</span>
          )}
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 2 }}>
          {item.isWeapon && item.dmg1 && `${item.dmg1} ${DAMAGE_TYPE[item.dmgType] || ''}`}
          {item.isArmor && item.ac && `AC ${item.ac}`}
          {item.weight ? ` • ${item.weight} lb` : ''}
          {item.quantity > 1 ? ` • ×${item.quantity}` : ''}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {item.quantity > 1 && (
          <>
            <button style={S.tinyBtn} onClick={() => onQuantityChange(-1)}>−</button>
            <span style={{ color: 'var(--text-muted)', fontSize: 12, minWidth: 20, textAlign: 'center' }}>{item.quantity}</span>
            <button style={S.tinyBtn} onClick={() => onQuantityChange(1)}>+</button>
          </>
        )}
        {(item.isWeapon || item.isArmor) && (
          <button
            onClick={onToggleEquip}
            style={{ ...S.equipBtn, ...(item.equipped ? S.equipBtnActive : {}) }}>
            {item.equipped ? '✓ Angelegt' : 'Anlegen'}
          </button>
        )}
        <button style={S.removeBtn} onClick={onRemove}>✕</button>
      </div>
    </div>
  )
}

function BrowserItem({ item, isViewing, onView, onAdd }) {
  const rarityColor = RARITY_COLORS[item.rarity] || 'var(--text-muted)'
  const isMagic = isMagicRarity(item.rarity)
  const typeLabel = getTypeLabel(item)

  return (
    <div style={{ ...S.browserCard, ...(isViewing ? S.browserCardViewing : {}) }}
         onClick={onView}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: rarityColor, fontWeight: 'bold', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.name}
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 2 }}>
            {typeLabel}
            {item.isWeapon && item.dmg1 && ` • ${item.dmg1}`}
            {item.isArmor && item.ac && ` • AC ${item.ac}`}
            {item.value ? ` • ${cpToGP(item.value)} GP` : ''}
          </div>
        </div>
        <button style={S.addBtn} onClick={e => { e.stopPropagation(); onAdd() }}
                title="Zum Inventar hinzufügen">+</button>
      </div>
      {isMagic && (
        <div style={{ fontSize: 9, color: 'var(--accent)', marginTop: 3 }}>⚠ DM-Absprache</div>
      )}
    </div>
  )
}

function ItemDetail({ item, onAdd }) {
  const rarityColor = RARITY_COLORS[item.rarity] || 'var(--text-muted)'
  const desc = getItemDescription(item)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ color: rarityColor, fontWeight: 'bold', fontSize: 16 }}>{item.name}</div>
        <button style={{ ...S.addBtn, fontSize: 13, padding: '4px 12px' }}
                onClick={onAdd}>+ Hinzufügen</button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ ...S.detailBadge }}>{getTypeLabel(item)}</span>
        {item.rarity && item.rarity !== 'none' && item.rarity !== 'mundane' && (
          <span style={{ ...S.detailBadge, color: rarityColor, borderColor: rarityColor }}>
            {item.rarity}
          </span>
        )}
        {item.reqAttune && <span style={{ ...S.detailBadge, color: 'var(--accent-purple)', borderColor: 'var(--accent-purple)' }}>Attunement</span>}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10, fontSize: 12, color: 'var(--text-muted)' }}>
        {item.isWeapon && item.dmg1 && <span>Damage: <strong style={{ color: 'var(--text-primary)' }}>{item.dmg1} {DAMAGE_TYPE[item.dmgType] || ''}</strong></span>}
        {item.isArmor && item.ac && <span>AC: <strong style={{ color: 'var(--text-primary)' }}>{item.ac}</strong></span>}
        {item.strength && <span>STR min: <strong style={{ color: 'var(--accent-red)' }}>{item.strength}</strong></span>}
        {item.stealth && <span style={{ color: 'var(--accent-red)' }}>Stealth Disadvantage</span>}
        {item.weight && <span>Weight: {item.weight} lb</span>}
        {item.value && <span>Cost: {cpToGP(item.value)} GP</span>}
        {item.weaponCategory && <span>{item.weaponCategory}</span>}
        {item.range && <span>Range: {item.range}</span>}
      </div>

      {desc && (
        <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.6, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
          {desc}
        </div>
      )}

      {isMagicRarity(item.rarity) && (
        <div style={{ marginTop: 10, padding: '6px 10px', background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: 6 }}>
          <span style={{ color: 'var(--accent)', fontSize: 12 }}>
            ⚠ Magische Items nur mit Absprache des DM hinzufügen
          </span>
        </div>
      )}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function isMagicRarity(rarity) {
  return rarity && !['none', 'mundane', 'unknown'].includes((rarity || '').toLowerCase())
}

function getTypeLabel(item) {
  if (!item.type) {
    if (item.isWeapon) return item.weaponCategory === 'martial' ? 'Martial Weapon' : 'Simple Weapon'
    if (item.isArmor) return 'Armor'
    return 'Gear'
  }
  // Handle compound types like "G|XPHB"
  const baseType = item.type.split('|')[0]
  return TYPE_LABELS[baseType] || baseType
}

// ── Styles ──────────────────────────────────────────────────────────────────────

const S = {
  container:   { maxWidth: 860, margin: '0 auto', padding: 16 },
  title:       { color: 'var(--accent)', marginBottom: 4 },
  subtitle:    { color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 },
  section: {
    background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 12,
    padding: 16, marginBottom: 20,
  },
  sectionTitle: {
    color: 'var(--accent)', fontWeight: 'bold', fontSize: 13,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 10, paddingBottom: 4, borderBottom: '1px solid var(--border-subtle)',
  },

  // Starting equipment
  optionCard: {
    background: 'var(--bg-elevated)', border: '2px solid var(--border)', borderRadius: 8,
    padding: '10px 14px', cursor: 'pointer', transition: 'all 0.15s',
  },
  optionCardSelected: { border: '2px solid var(--accent)', background: 'var(--bg-hover)' },
  optionBadge: {
    width: 26, height: 26, borderRadius: 6, display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 13,
  },
  itemPill: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '3px 8px', fontSize: 11, color: 'var(--text-secondary)',
  },

  // Inventory
  invRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 10px', background: 'var(--bg-panel)', borderRadius: 6,
    border: '1px solid var(--border-subtle)',
  },
  sourceTag: {
    fontSize: 9, background: 'var(--bg-hover)', color: 'var(--text-dim)',
    padding: '1px 5px', borderRadius: 3,
  },
  tinyBtn: {
    width: 22, height: 22, borderRadius: 4, border: '1px solid var(--border)',
    background: 'var(--bg-surface)', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  equipBtn: {
    padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-surface)', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer',
  },
  equipBtnActive: { border: '1px solid var(--accent-green)', color: 'var(--accent-green)', background: 'var(--bg-card)' },
  removeBtn: {
    width: 22, height: 22, borderRadius: 4, border: '1px solid #3a2a2a',
    background: 'var(--bg-card)', color: 'var(--accent-red)', fontSize: 12, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },

  // Gold
  goldInput: {
    padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-surface)', color: 'var(--accent)', fontSize: 13, width: 100,
  },

  // Browser
  searchInput: {
    flex: 1, minWidth: 160, padding: '7px 10px', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13,
  },
  filterSelect: {
    padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-surface)', color: 'var(--text-muted)', fontSize: 12,
  },
  browserGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
    gap: 6, maxHeight: 360, overflowY: 'auto',
    padding: '4px 0',
  },
  browserCard: {
    background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', borderRadius: 6,
    padding: '8px 10px', cursor: 'pointer', transition: 'all 0.12s',
  },
  browserCardViewing: { border: '1px solid var(--accent)', background: 'var(--bg-hover)' },
  addBtn: {
    background: 'var(--bg-highlight)', border: '1px solid #2a6a4a', borderRadius: 4,
    color: 'var(--accent-green)', fontSize: 16, cursor: 'pointer',
    width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },

  // Detail panel
  detailPanel: {
    marginTop: 12, padding: 14, background: 'var(--bg-elevated)', borderRadius: 8,
    border: '1px solid var(--border)',
  },
  detailBadge: {
    padding: '2px 8px', borderRadius: 4, fontSize: 11,
    border: '1px solid var(--border)', color: 'var(--text-muted)',
  },
}