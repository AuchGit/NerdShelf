// components/sheet/InventoryTab.jsx
// Live inventory: item CRUD, equip / attune, containers (backpacks & pouches),
// currency, and a database browser. Equipping weapons / armor flows straight
// into the rules engine (AC, attacks) — finesse weapons use the higher of STR / DEX.

import { useState, useEffect, useMemo } from 'react'
import EntryRenderer from '../ui/EntryRenderer'
import {
  Section, EmptyState, Btn, SheetModal, FormRow, TextInput, TextArea, SelectInput,
  Checkbox, Stepper,
} from './SheetKit'
import { S } from './sheetStyles'
import {
  ITEM_TYPES, WEAPON_PROPERTIES, DAMAGE_TYPES, COIN_TYPES, totalGoldValue,
  isContainerItem, itemKey, itemTypeMeta, isSingletonItem,
} from '../../lib/sheetUtils'
import {
  getAvailableMarkingRules, weaponEligibleForMark, setWeaponMark,
} from '../../lib/weaponMarkingRules'

// 5etools weapon-property codes -> readable names (so finesse etc. work).
const PROP_CODE_MAP = {
  F: 'Finesse', V: 'Versatile', L: 'Light', H: 'Heavy', '2H': 'Two-Handed',
  T: 'Thrown', A: 'Ammunition', R: 'Reach', LD: 'Loading', S: 'Special',
  RLD: 'Reload', BF: 'Burst Fire', N: 'Net', AF: 'Ammunition',
}
function normProperty(p) {
  let raw = typeof p === 'string' ? p : (p?.name || p?.uid || '')
  const code = raw.split('|')[0].toUpperCase()
  return PROP_CODE_MAP[code] || raw.split('|')[0]
}

function blankItem() {
  return {
    name: '', type: 'G', quantity: 1, weight: null, value: null,
    ac: null, strength: null, dmg1: '', dmgType: 'slashing', weaponCategory: 'simple',
    range: '', properties: [], rarity: 'common', description: '',
    equipped: false, attuned: false, isContainer: false,
    isWeapon: false, isArmor: false,
  }
}

export default function InventoryTab({ character, updateCharacter, applyCharacter }) {
  const [editing, setEditing] = useState(null)   // { item, isNew }
  const [browsing, setBrowsing] = useState(false)
  const edition = character.meta?.edition || '5e'

  const currency = character.inventory?.currency || {}

  // Weapon-marking rules currently available to this character (Hex
  // Warrior etc.). Empty for non-Hexblade / non-pact characters — the
  // ItemRow won't even show the marking UI in that case.
  const markingRules = useMemo(() => getAvailableMarkingRules(character),
    [character.classes, character.feats])
  const markedWeapons = character.status?.markedWeapons || {}
  function toggleMark(ruleId, weaponId) {
    const cur = markedWeapons[ruleId]
    const next = setWeaponMark(character, ruleId, cur === weaponId ? null : weaponId)
    updateCharacter('status.markedWeapons', next)
  }

  // ── Unified item list (tag each item with its store + stable key) ──
  const items = useMemo(() => {
    const reg = (character.inventory?.items || []).map(i => ({ ...i, _store: 'inventory', _key: itemKey(i) }))
    const cus = (character.custom?.items || []).map(i => ({ ...i, _store: 'custom', _key: itemKey(i) }))
    return [...reg, ...cus]
  }, [character.inventory?.items, character.custom?.items])

  const containers = items.filter(isContainerItem)
  const containerKeys = new Set(containers.map(c => c._key))

  function itemsIn(containerKey) {
    return items.filter(i => i.containerId === containerKey && i._key !== containerKey)
  }
  const carried = items.filter(i =>
    !isContainerItem(i) && (!i.containerId || !containerKeys.has(i.containerId))
  )

  // One-shot migration: any pre-existing singleton with quantity > 1 from
  // before the split-on-add rule is silently fanned out into N separate
  // rows so the rest of the UI (no Stepper, per-instance equip/attune) is
  // consistent. Idempotent — once split, the condition is false and the
  // effect no-ops on subsequent renders.
  useEffect(() => {
    const needsSplit = items.some(i => isSingletonItem(i) && (i.quantity || 1) > 1)
    if (!needsSplit) return
    applyCharacter(d => {
      ensureStores(d)
      for (const store of ['inventory', 'custom']) {
        const arr = d[store]?.items
        if (!arr) continue
        const next = []
        for (const it of arr) {
          if (isSingletonItem(it) && (it.quantity || 1) > 1) {
            const n = it.quantity
            // First copy keeps the original id + equipped/attuned flags so
            // anything referencing the row (containerId chains, attack
            // wiring) survives the migration. Extra copies get fresh ids
            // and a clean equipped/attuned state.
            next.push({ ...it, quantity: 1 })
            for (let i = 1; i < n; i++) {
              next.push({
                ...it,
                id: crypto.randomUUID(),
                quantity: 1,
                equipped: false,
                attuned: false,
              })
            }
          } else {
            next.push(it)
          }
        }
        d[store].items = next
      }
    })
    // applyCharacter is stable; `items` covers all the data this depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  // ── Mutations ──────────────────────────────────────────────
  // Guarantees the inventory / custom containers exist on the draft.
  function ensureStores(d) {
    if (!d.inventory) d.inventory = { items: [], currency: {} }
    if (!d.inventory.items) d.inventory.items = []
    if (!d.custom) d.custom = { items: [] }
    if (!d.custom.items) d.custom.items = []
  }

  function patchItem(item, changes) {
    applyCharacter(d => {
      ensureStores(d)
      const arr = item._store === 'custom' ? d.custom.items : d.inventory.items
      const idx = arr.findIndex(x => itemKey(x) === item._key)
      if (idx >= 0) arr[idx] = { ...arr[idx], ...changes }
    })
  }

  function removeItem(item) {
    if (!window.confirm(`Remove ${item.customName || item.name}?`)) return
    applyCharacter(d => {
      ensureStores(d)
      if (item._store === 'custom') {
        d.custom.items = d.custom.items.filter(x => itemKey(x) !== item._key)
      } else {
        d.inventory.items = d.inventory.items.filter(x => itemKey(x) !== item._key)
      }
      // Orphaned children fall back to Carried.
      for (const arr of [d.inventory.items, d.custom.items]) {
        for (const x of arr) { if (x.containerId === item._key) x.containerId = null }
      }
    })
  }

  function saveItem(form, existing) {
    const meta = itemTypeMeta(form.type)
    const clean = {
      ...form,
      isWeapon: !!meta.isWeapon,
      isArmor: !!meta.isArmor,
      isShield: form.type === 'S',
    }
    const singleton = isSingletonItem(clean)
    const requestedQty = Math.max(1, parseInt(clean.quantity, 10) || 1)

    if (existing) {
      // Singletons must stay at qty 1 — the modal hides the field but if
      // the form somehow carries a higher number, normalise it. Any extra
      // copies the user wants get added through the "Add Item" flow again.
      patchItem(existing, { ...clean, quantity: singleton ? 1 : requestedQty })
    } else {
      applyCharacter(d => {
        ensureStores(d)
        const base = { ...clean, grantedBy: 'manual' }
        if (singleton) {
          // Split into N separate rows so each can be equipped / attuned
          // / placed in a different container independently. The first
          // one inherits the form's equipped/attuned state; the rest do not.
          for (let i = 0; i < requestedQty; i++) {
            d.inventory.items.push({
              ...base, id: crypto.randomUUID(), quantity: 1,
              equipped: i === 0 ? !!base.equipped : false,
              attuned:  i === 0 ? !!base.attuned  : false,
            })
          }
        } else {
          d.inventory.items.push({ ...base, id: crypto.randomUUID(), quantity: requestedQty })
        }
      })
    }
    setEditing(null)
  }

  function addFromData(entry) {
    const properties = (entry.property || []).map(normProperty).filter(Boolean)
    const meta = itemTypeMeta(entry.type)
    const base = {
      grantedBy: 'manual',
      name: entry.name, source: entry.source || 'PHB',
      type: entry.type || 'G',
      weight: entry.weight ?? null, value: entry.value ?? null,
      ac: entry.ac ?? null, strength: entry.strength ?? null,
      dmg1: entry.dmg1 || '', dmgType: entry.dmgType || '',
      weaponCategory: entry.weaponCategory || null,
      range: typeof entry.range === 'string' ? entry.range : '',
      properties, rarity: entry.rarity || 'common',
      equipped: false, attuned: false,
      isWeapon: !!meta.isWeapon || !!entry.isWeapon,
      isArmor: !!meta.isArmor || !!entry.isArmor,
      isShield: entry.type === 'S',
      isContainer: isContainerItem(entry),
    }
    // The browser modal adds one row per click; if it ever gains a
    // quantity input, the same singleton-split logic from saveItem would
    // apply here too.
    applyCharacter(d => {
      ensureStores(d)
      d.inventory.items.push({ ...base, id: crypto.randomUUID(), quantity: 1 })
    })
  }

  function moveItem(item, targetKey) {
    patchItem(item, { containerId: targetKey || null })
  }

  const moveOptions = (item) => [
    { value: '', label: 'Carried' },
    ...containers.filter(c => c._key !== item._key).map(c => ({ value: c._key, label: c.customName || c.name })),
  ]

  const attunedCount = items.filter(i => i.attuned).length
  const attuneMax = character.inventory?.attunementSlots || 3

  return (
    <div className="dnd-sheet-tab-body" style={S.tabBody}>
      {/* ── Currency ── */}
      <Section title="Currency">
        <div style={S.currencyRow}>
          {COIN_TYPES.map(({ key, label, color }) => (
            <div key={key} style={S.currencyBox}>
              <div style={{ ...S.currencyLabel, color }}>{label}</div>
              <Stepper
                value={currency[key] || 0} min={0} max={999999}
                onChange={v => updateCharacter(`inventory.currency.${key}`, v)}
              />
            </div>
          ))}
        </div>
        <div style={S.totalGP}>Total value: {totalGoldValue(currency).toFixed(2)} gp</div>
      </Section>

      {/* ── Equipment ── */}
      <Section
        title={`Equipment (${items.length})`}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={() => setBrowsing(true)}>Browse Database</Btn>
            <Btn variant="primary" onClick={() => setEditing({ item: blankItem(), isNew: true })}>Add Item</Btn>
          </div>
        }
      >
        {items.length === 0 && <EmptyState title="No items" desc="Add an item or browse the database." />}

        {/* Multi-column grid: each container group + the "Carried" bucket tile
            side-by-side on wide viewports (auto-fit at ~360px min). On phones
            this collapses to a single column — same look as before. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
          {containers.map(container => {
            const contents = itemsIn(container._key)
            return (
              <div key={container._key} style={{ ...S.containerGroup, marginBottom: 0 }}>
                <div style={S.containerHead}>
                  <span style={{ color: 'var(--accent-yellow)', fontSize: 13 }}>▣</span>
                  <span style={S.containerTitle}>{container.customName || container.name}</span>
                  <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{contents.length} items</span>
                  <ItemActions
                    item={container} moveOptions={moveOptions(container)}
                    onMove={k => moveItem(container, k)} onPatch={patchItem}
                    onEdit={() => setEditing({ item: container, isNew: false })}
                    onRemove={() => removeItem(container)}
                  />
                </div>
                {contents.length === 0 ? (
                  <div style={{ padding: '8px 12px', color: 'var(--text-dim)', fontSize: 12, background: 'var(--bg-elevated)' }}>
                    Empty — use the move dropdown on an item to place it here.
                  </div>
                ) : contents.map(it => (
                  <ItemRow key={it._key} item={it} moveOptions={moveOptions(it)}
                    onMove={k => moveItem(it, k)} onPatch={patchItem}
                    onEdit={() => setEditing({ item: it, isNew: false })}
                    onRemove={() => removeItem(it)}
                    character={character}
                    markingRules={markingRules}
                    markedWeapons={markedWeapons}
                    onToggleMark={toggleMark} />
                ))}
              </div>
            )
          })}

          {/* Carried (loose) */}
          {carried.length > 0 && (
            <div style={{ ...S.containerGroup, marginBottom: 0 }}>
              <div style={S.containerHead}>
                <span style={S.containerTitle}>Carried</span>
              </div>
              {carried.map(it => (
                <ItemRow key={it._key} item={it} moveOptions={moveOptions(it)}
                  onMove={k => moveItem(it, k)} onPatch={patchItem}
                  onEdit={() => setEditing({ item: it, isNew: false })}
                  onRemove={() => removeItem(it)}
                  character={character}
                  markingRules={markingRules}
                  markedWeapons={markedWeapons}
                  onToggleMark={toggleMark} />
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* ── Attunement ── */}
      <Section title="Attunement">
        <div style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '10px 14px', display: 'flex', justifyContent: 'space-between',
          color: 'var(--text-secondary)', fontSize: 13, flexWrap: 'wrap', gap: 8,
        }}>
          <span>Attuned items: {attunedCount} / {attuneMax}</span>
          {attunedCount > attuneMax && <span style={{ color: 'var(--accent-red)' }}>Over attunement limit</span>}
        </div>
      </Section>

      {editing && (
        <ItemFormModal
          item={editing.item} isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onSave={form => saveItem(form, editing.isNew ? null : editing.item)}
        />
      )}
      {browsing && (
        <ItemBrowseModal
          edition={edition}
          existingNames={new Set(items.map(i => (i.name || '').toLowerCase()))}
          onClose={() => setBrowsing(false)}
          onAdd={addFromData}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// ITEM ROW
// ═══════════════════════════════════════════════════════════════

function ItemActions({ item, moveOptions, onMove, onEdit, onRemove }) {
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
      <select style={S.miniSelect} value={item.containerId || ''} onChange={e => onMove(e.target.value)}>
        {moveOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button type="button" style={S.miniBtn} title="Edit" onClick={onEdit}>✎</button>
      <button type="button" style={{ ...S.miniBtn, color: 'var(--accent-red)' }} title="Remove" onClick={onRemove}>✕</button>
    </div>
  )
}

function ItemRow({ item, moveOptions, onMove, onPatch, onEdit, onRemove,
                   character, markingRules = [], markedWeapons = {}, onToggleMark }) {
  const [open, setOpen] = useState(false)
  const meta = itemTypeMeta(item.type)
  const canEquip = meta.isWeapon || meta.isArmor || item.type === 'S'
  const singleton = isSingletonItem(item)

  // Only weapons can be marked, and only when a rule actually allows it.
  // We filter to eligible rules per-weapon so Hex Warrior won't suggest
  // a two-handed maul as a target, etc.
  const eligibleRules = (item.isWeapon ? markingRules : [])
    .filter(r => weaponEligibleForMark(item, r, character))
  const activeMarks = item.isWeapon
    ? Object.entries(markedWeapons).filter(([, wId]) => wId === item.id).map(([id]) => id)
    : []
  return (
    <div>
      <div style={S.itemRow}>
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
          <div style={S.itemName}>
            {item.customName || item.name}
            {item._isCustom && <span style={{ color: 'var(--accent-purple)', fontSize: 10, marginLeft: 6 }}>CUSTOM</span>}
            {activeMarks.length > 0 && (
              <span style={{
                marginLeft: 8, padding: '1px 7px', fontSize: 10, fontWeight: 600,
                color: 'var(--accent-purple)',
                border: '1px solid var(--accent-purple)',
                borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.5,
              }} title="Diese Waffe ist markiert">
                {activeMarks.length === 1
                  ? markingRules.find(r => r.id === activeMarks[0])?.label || 'Marked'
                  : `${activeMarks.length} marks`}
              </span>
            )}
          </div>
          <div style={S.itemSub}>
            {meta.label}
            {item.dmg1 ? ` · ${item.dmg1} ${item.dmgType || ''}` : ''}
            {item.ac ? ` · AC ${item.ac}` : ''}
            {item.equipped ? ' · Equipped' : ''}
            {item.attuned ? ' · Attuned' : ''}
          </div>
        </div>
        {/* Singleton items (weapons, armor, shields) live one-per-row so
            each can be equipped / attuned independently — no stepper. */}
        {!singleton && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <Stepper value={item.quantity || 1} min={1} max={9999} width={36}
              onChange={v => onPatch(item, { quantity: v })} />
          </div>
        )}
      </div>
      {open && (
        <div style={{ padding: '8px 12px 12px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
            {canEquip && <Checkbox checked={item.equipped} label="Equipped" onChange={v => onPatch(item, { equipped: v })} />}
            <Checkbox checked={item.attuned} label="Attuned" onChange={v => onPatch(item, { attuned: v })} />
          </div>
          {item.properties?.length > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
              {item.properties.map((p, i) => <span key={i} style={S.itemTag}>{p}</span>)}
            </div>
          )}
          {item.description && (
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: 8, whiteSpace: 'pre-wrap' }}>
              {item.description}
            </div>
          )}
          {(item.isWeapon || item.isArmor) && (
            <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 8 }}>
              {item.isWeapon
                ? 'Equip to add this weapon to Attacks & Actions. Finesse weapons use the higher of STR / DEX.'
                : 'Equip to apply this armor / shield to your AC.'}
            </div>
          )}
          {item.isWeapon && eligibleRules.length > 0 && (
            <div style={{
              marginBottom: 10, padding: '8px 10px',
              background: 'var(--bg-inset)',
              border: '1px solid var(--border-subtle)', borderRadius: 6,
            }}>
              <div style={{
                fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: 0.5, marginBottom: 6, fontWeight: 600,
              }}>Markierungen</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {eligibleRules.map(rule => {
                  const isActive = markedWeapons[rule.id] === item.id
                  const usedByOther = markedWeapons[rule.id] && markedWeapons[rule.id] !== item.id
                  return (
                    <button
                      key={rule.id}
                      type="button"
                      title={rule.note + (usedByOther ? '\n\n(Aktuell auf einer anderen Waffe — Klick wechselt zur aktuellen Waffe.)' : '')}
                      onClick={() => onToggleMark?.(rule.id, item.id)}
                      style={{
                        padding: '4px 10px', borderRadius: 999, fontSize: 11,
                        fontFamily: 'inherit', cursor: 'pointer',
                        border: `1px solid ${isActive ? 'var(--accent-purple)' : 'var(--border)'}`,
                        background: isActive ? 'color-mix(in srgb, var(--accent-purple) 22%, transparent)' : 'transparent',
                        color: isActive ? 'var(--accent-purple)' : 'var(--text-secondary)',
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      {isActive ? '✓ ' : ''}{rule.label}
                      {usedByOther && !isActive && <span style={{ opacity: 0.5, marginLeft: 4 }}>(belegt)</span>}
                    </button>
                  )
                })}
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 6, lineHeight: 1.4 }}>
                Markierungen ändern Angriff / Schaden dynamisch nach den Klassen-Regeln (siehe Tooltip pro Markierung).
              </div>
            </div>
          )}
          <ItemActions item={item} moveOptions={moveOptions} onMove={onMove} onPatch={onPatch} onEdit={onEdit} onRemove={onRemove} />
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// ITEM FORM MODAL (create / edit)
// ═══════════════════════════════════════════════════════════════

function ItemFormModal({ item, isNew, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ ...blankItem(), ...item }))
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const meta = itemTypeMeta(form.type)
  const isWeapon = meta.isWeapon
  const isArmor = meta.isArmor
  const singleton = isSingletonItem(form)

  function toggleProp(p) {
    const has = (form.properties || []).includes(p)
    set('properties', has ? form.properties.filter(x => x !== p) : [...(form.properties || []), p])
  }

  return (
    <SheetModal
      open onClose={onClose}
      title={isNew ? 'Add Item' : 'Edit Item'}
      width={580}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={!form.name?.trim()} onClick={() => onSave(form)}>Save</Btn>
        </>
      }
    >
      <FormRow label="Name">
        <TextInput value={form.name} onChange={v => set('name', v)} placeholder="Item name" autoFocus />
      </FormRow>

      <div style={{ display: 'grid', gridTemplateColumns: singleton ? '1fr' : '1fr 1fr', gap: 10 }}>
        <FormRow label="Type">
          <SelectInput value={form.type} onChange={v => set('type', v)}
            options={ITEM_TYPES.map(t => ({ value: t.id, label: t.label }))} />
        </FormRow>
        {!singleton && (
          <FormRow label="Quantity">
            <TextInput type="number" min={1} value={form.quantity} onChange={v => set('quantity', parseInt(v, 10) || 1)} />
          </FormRow>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <FormRow label="Weight (lb)">
          <TextInput type="number" step="0.1" value={form.weight ?? ''} onChange={v => set('weight', v === '' ? null : parseFloat(v))} />
        </FormRow>
        <FormRow label="Value (gp)">
          <TextInput type="number" step="0.1" value={form.value != null ? form.value / 100 : ''}
            onChange={v => set('value', v === '' ? null : Math.round(parseFloat(v) * 100))} />
        </FormRow>
      </div>

      {isWeapon && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <FormRow label="Damage">
              <TextInput value={form.dmg1} onChange={v => set('dmg1', v)} placeholder="1d8" />
            </FormRow>
            <FormRow label="Damage Type">
              <SelectInput value={form.dmgType} onChange={v => set('dmgType', v)}
                options={DAMAGE_TYPES.map(d => ({ value: d, label: d }))} />
            </FormRow>
            <FormRow label="Category">
              <SelectInput value={form.weaponCategory || 'simple'} onChange={v => set('weaponCategory', v)}
                options={[{ value: 'simple', label: 'Simple' }, { value: 'martial', label: 'Martial' }]} />
            </FormRow>
          </div>
          <FormRow label="Properties" hint="Finesse weapons automatically use the higher of STR / DEX.">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {WEAPON_PROPERTIES.map(p => {
                const on = (form.properties || []).includes(p)
                return (
                  <button key={p} type="button" onClick={() => toggleProp(p)}
                    style={{
                      ...S.miniBtn, padding: '4px 10px',
                      borderColor: on ? 'var(--accent)' : 'var(--border)',
                      color: on ? 'var(--accent)' : 'var(--text-muted)',
                      background: on ? 'var(--bg-highlight)' : 'var(--bg-card)',
                    }}>
                    {p}
                  </button>
                )
              })}
            </div>
          </FormRow>
          {(form.properties || []).includes('Ammunition') && (
            <FormRow label="Range">
              <TextInput value={form.range} onChange={v => set('range', v)} placeholder="80/320" />
            </FormRow>
          )}
        </>
      )}

      {isArmor && form.type !== 'S' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <FormRow label="Base AC">
            <TextInput type="number" value={form.ac ?? ''} onChange={v => set('ac', v === '' ? null : parseInt(v, 10))} />
          </FormRow>
          <FormRow label="Min STR (heavy armor)">
            <TextInput type="number" value={form.strength ?? ''} onChange={v => set('strength', v === '' ? null : parseInt(v, 10))} />
          </FormRow>
        </div>
      )}
      {form.type === 'S' && (
        <FormRow label="Shield AC bonus" hint="Standard shields grant +2 AC when equipped.">
          <TextInput type="number" value={form.ac ?? 2} onChange={v => set('ac', parseInt(v, 10) || 2)} />
        </FormRow>
      )}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '4px 0 12px' }}>
        {(isWeapon || isArmor) && (
          <Checkbox checked={form.equipped} label="Equipped" onChange={v => set('equipped', v)} />
        )}
        <Checkbox checked={form.attuned} label="Attuned" onChange={v => set('attuned', v)} />
        <Checkbox checked={form.isContainer} label="Is a container (backpack / pouch)" onChange={v => set('isContainer', v)} />
      </div>

      <FormRow label="Description">
        <TextArea value={form.description} onChange={v => set('description', v)} rows={3} placeholder="Optional notes" />
      </FormRow>
    </SheetModal>
  )
}

// ═══════════════════════════════════════════════════════════════
// ITEM BROWSE MODAL (SRD database)
// ═══════════════════════════════════════════════════════════════

function ItemBrowseModal({ edition, existingNames, onClose, onAdd }) {
  const [allItems, setAllItems] = useState(null)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { loadItemIndex } = await import('../../lib/dataLoader')
      const list = await loadItemIndex(edition)
      if (!cancelled) setAllItems(list)
    }
    load()
    return () => { cancelled = true }
  }, [edition])

  const filtered = useMemo(() => {
    if (!allItems) return []
    if (!search.trim()) return allItems.slice(0, 60)
    const q = search.toLowerCase()
    return allItems.filter(i => i.name.toLowerCase().includes(q)).slice(0, 60)
  }, [allItems, search])

  return (
    <SheetModal open onClose={onClose} title="Browse Item Database" width={600}
      footer={<Btn variant="ghost" onClick={onClose}>Close</Btn>}>
      <TextInput value={search} onChange={setSearch} placeholder="Search items..." autoFocus />
      <div style={{ marginTop: 10, maxHeight: 440, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}>
        {allItems === null && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Loading database...</div>}
        {allItems !== null && filtered.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>No results</div>
        )}
        {filtered.map((entry, i) => {
          const key = entry.name + entry.source + i
          const added = existingNames.has((entry.name || '').toLowerCase())
          const isOpen = expanded === key
          const props = (entry.property || []).map(normProperty).filter(Boolean)
          return (
            <div key={key}>
              <div style={{ ...S.itemRow }}>
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                  onClick={() => setExpanded(isOpen ? null : key)}>
                  <div style={S.itemName}>
                    {entry.name}
                    <span style={{ color: 'var(--text-dim)', fontSize: 11, marginLeft: 6 }}>{isOpen ? '▲' : '▼'}</span>
                  </div>
                  <div style={S.itemSub}>
                    {itemTypeMeta(entry.type).label} · {entry.source}
                    {entry.dmg1 ? ` · ${entry.dmg1} ${entry.dmgType || ''}` : ''}
                    {entry.ac ? ` · AC ${entry.ac}` : ''}
                    {entry.rarity && entry.rarity !== 'none' ? ` · ${entry.rarity}` : ''}
                  </div>
                </div>
                <Btn variant={added ? 'ghost' : 'primary'} disabled={added}
                  style={{ padding: '5px 12px', fontSize: 12 }}
                  onClick={() => onAdd(entry)}>
                  {added ? 'Added' : 'Add'}
                </Btn>
              </div>
              {isOpen && (
                <div style={{ padding: '8px 12px 12px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: 'var(--text-muted)', fontSize: 11, marginBottom: 6 }}>
                    {entry.weight != null && <span>Weight: {entry.weight} lb</span>}
                    {entry.value != null && <span>Value: {(entry.value / 100).toFixed(2)} gp</span>}
                    {entry.strength ? <span>Min STR: {entry.strength}</span> : null}
                  </div>
                  {props.length > 0 && (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
                      {props.map((p, j) => <span key={j} style={S.itemTag}>{p}</span>)}
                    </div>
                  )}
                  {entry.entries?.length > 0 ? (
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
                      <EntryRenderer entries={entry.entries} />
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-dim)', fontSize: 12, fontStyle: 'italic' }}>
                      No description available for this item.
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {filtered.length === 60 && (
          <div style={{ padding: 8, textAlign: 'center', color: 'var(--text-dim)', fontSize: 11 }}>
            Refine your search to see more.
          </div>
        )}
      </div>
    </SheetModal>
  )
}
