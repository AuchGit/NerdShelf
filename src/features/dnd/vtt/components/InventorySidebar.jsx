// VTT-native inventory: currency (colored dots), items grouped by category
// (incl. containers), each row expandable for details, with equip/attune,
// quantity ± and a ★ quick-access (favorite) toggle. Edits go through the owner
// full-character save. Full management (add from DB, splitting) stays on the sheet.
import { useEffect, useMemo, useState } from 'react';
import { useVtt } from '../state/useVtt';
import { applyOwnCharacter } from '../sync/characterBinding';
import { favoriteKey, isFavorite, toggleFavorite } from '../../character-builder/lib/favorites';
import { isContainerItem, itemTypeMeta } from '../../character-builder/lib/sheetUtils';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';
import { loadClassData } from '../../character-builder/lib/dataLoader';
import { WeaponMasteryPicker } from '../../character-builder/components/sheet/OverviewTab';
import CurrencyDots from './CurrencyDots';
import { Pinnable } from './tooltip/Tooltips';

function setPath(obj, path, value) {
  const keys = path.split('.'); let o = obj;
  for (let i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = value;
}

const CAT_ORDER = ['Waffen', 'Rüstung', 'Tränke', 'Schriftrollen', 'Magisch', 'Behälter', 'Sonstiges'];

function categoryOf(i) {
  if (isContainerItem(i)) return 'Behälter';
  const code = String(i.type || '').split('|')[0];
  if (i.isWeapon || code === 'M' || code === 'R') return 'Waffen';
  if (i.isArmor || code === 'LA' || code === 'MA' || code === 'HA' || code === 'S') return 'Rüstung';
  if (code === 'P') return 'Tränke';
  if (code === 'SC') return 'Schriftrollen';
  if (i.wondrous || (i.rarity && !['none', 'common', 'unknown'].includes(i.rarity))) return 'Magisch';
  return 'Sonstiges';
}
function isEquippable(i) {
  const code = String(i.type || '').split('|')[0];
  return i.isWeapon || i.isArmor || ['M', 'R', 'LA', 'MA', 'HA', 'S'].includes(code);
}
function details(i) {
  if (typeof i.description === 'string' && i.description.trim()) return strip(i.description);
  if (Array.isArray(i.entries)) return i.entries.filter((e) => typeof e === 'string').map(strip).join('\n\n');
  return '';
}
function strip(s) { return String(s).replace(/\{@\w+ ([^}]*)\}/g, (_, x) => String(x).split('|')[0]); }

export default function InventorySidebar() {
  const myId = useVtt((s) => s.ui.myCharacterId);
  const chars = useVtt((s) => s.ui.characters || {});
  const [q, setQ] = useState('');
  const [open, setOpen] = useState({}); // expanded item details by key
  const character = myId != null ? chars[myId]?.data : null;

  // Class-Daten für Weapon Mastery (die Slot-Anzahl kommt aus der
  // "Weapon Mastery"-Tabellenspalte — ohne classDataMap wäre sie 0 und
  // der Picker unsichtbar). Keyed auf die Klassen-Signatur.
  const classSig = (character?.classes || []).map((c) => `${c.classId}:${c.level || 1}`).join(',');
  const [classMap, setClassMap] = useState(null);
  useEffect(() => {
    const ids = [...new Set((character?.classes || []).map((c) => c.classId).filter(Boolean))];
    if (!ids.length) { setClassMap(null); return undefined; }
    let cancelled = false;
    const edition = character?.meta?.edition || '5e';
    Promise.all(ids.map((id) => loadClassData(edition, id).catch(() => null))).then((loaded) => {
      if (cancelled) return;
      const m = {};
      ids.forEach((id, i) => { if (loaded[i]) m[id] = loaded[i]; });
      setClassMap(m);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classSig, character?.meta?.edition]);
  const computed = useMemo(() => {
    if (!character) return null;
    try { return computeCharacter(character, classMap || {}); } catch { return null; }
  }, [character, classMap]);

  const groups = useMemo(() => {
    const inv = (character?.inventory?.items || []).map((i, ix) => ({ ...i, _s: 'inventory', _ix: ix }));
    const cus = (character?.custom?.items || []).map((i, ix) => ({ ...i, _s: 'custom', _ix: ix }));
    const all = [...inv, ...cus];
    const byCat = {};
    for (const it of all) (byCat[categoryOf(it)] ||= []).push(it);
    for (const k in byCat) byCat[k].sort((a, b) => (b.equipped ? 1 : 0) - (a.equipped ? 1 : 0));
    return byCat;
  }, [character]);

  if (!character) return <div style={S.muted}>Kein Charakter geladen.</div>;
  const apply = (m) => applyOwnCharacter(myId, m);
  const needle = q.trim().toLowerCase();

  const edit = (item, patch) => apply((d) => {
    const arr = item._s === 'custom' ? d.custom?.items : d.inventory?.items;
    if (!arr) return;
    let idx = item.id ? arr.findIndex((x) => x.id === item.id) : -1;
    if (idx < 0) idx = item._ix;
    if (arr[idx]) arr[idx] = { ...arr[idx], ...patch };
  });
  const setCoin = (k, v) => apply((d) => {
    if (!d.inventory) d.inventory = { items: [], currency: {} };
    if (!d.inventory.currency) d.inventory.currency = {};
    d.inventory.currency[k] = v;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <CurrencyDots currency={character.inventory?.currency} onChange={setCoin} />
      {/* 5.5e Weapon Mastery: gleiche Picker-Komponente wie auf dem Sheet —
          Picks landen via Owner-Write in classes[i].weaponMasteries. */}
      {computed?.weaponMastery?.perClass?.length > 0 && (
        <WeaponMasteryPicker character={character} computed={computed}
          updateCharacter={(path, value) => apply((d) => setPath(d, path, value))} />
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item suchen…" style={S.search} />

      {CAT_ORDER.filter((c) => groups[c]?.length).map((cat) => {
        const list = needle ? groups[cat].filter((i) => (i.name || '').toLowerCase().includes(needle)) : groups[cat];
        if (!list.length) return null;
        return (
          <div key={cat}>
            <div style={S.catHead}>{cat} <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>· {list.length}</span></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {list.map((item, i) => {
                const key = item.id || `${item._s}-${i}`;
                const favKey = favoriteKey('item', item.id);
                const fav = item.id ? isFavorite(character, favKey) : false;
                const expanded = !!open[key];
                const det = details(item);
                return (
                  <div key={key} style={{ ...S.row, ...(item.equipped ? S.rowEquipped : null) }}>
                    <div style={S.rowMain}>
                      <button style={S.star} title="Quick-Access (Favorit)" onClick={() => item.id && toggleFavorite(apply, favKey)}>{fav ? '★' : '☆'}</button>
                      <Pinnable title={item.name} render={() => (
                        <div>
                          <div style={S.meta}>{[itemTypeMeta(item.type).label, item.rarity && item.rarity !== 'none' ? item.rarity : null, item.weight ? `${item.weight} lb` : null, item.value ? `${item.value} gp` : null].filter(Boolean).join(' · ')}</div>
                          <div style={S.detailText}>{det || '—'}</div>
                        </div>
                      )}>
                        <button style={S.name} onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))} title="Details">
                          <span style={{ width: 10, color: 'var(--color-text-muted)' }}>{det ? (expanded ? '▾' : '▸') : ''}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                        </button>
                      </Pinnable>
                      <div style={S.qty}>
                        <button style={S.qtyBtn} onClick={() => edit(item, { quantity: Math.max(1, (item.quantity || 1) - 1) })}>−</button>
                        <span style={{ minWidth: 16, textAlign: 'center' }}>{item.quantity || 1}</span>
                        <button style={S.qtyBtn} onClick={() => edit(item, { quantity: (item.quantity || 1) + 1 })}>+</button>
                      </div>
                      {isEquippable(item) && <button title="An-/Ablegen" onClick={() => edit(item, { equipped: !item.equipped })} style={{ ...S.tag, ...(item.equipped ? S.tagOn : null) }}>E</button>}
                      {item.reqAttune && <button title="Attunement" onClick={() => edit(item, { attuned: !item.attuned })} style={{ ...S.tag, ...(item.attuned ? S.tagOn : null) }}>A</button>}
                    </div>
                    {expanded && (
                      <div style={S.details}>
                        <div style={S.meta}>
                          {itemTypeMeta(item.type).label}
                          {item.rarity && item.rarity !== 'none' ? ` · ${item.rarity}` : ''}
                          {item.weight ? ` · ${item.weight} lb` : ''}
                          {item.value ? ` · ${item.value} gp` : ''}
                        </div>
                        {det && <div style={S.detailText}>{det}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const S = {
  muted: { color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' },
  search: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)' },
  catHead: { fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-accent)', margin: '4px 0 3px' },
  row: { borderRadius: 'var(--radius-md)', border: '1px solid transparent', fontSize: 'var(--fs-sm)' },
  rowEquipped: { border: '1px solid var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' },
  rowMain: { display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px' },
  star: { background: 'transparent', border: 'none', color: 'var(--color-warning,#e0af68)', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 },
  name: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', color: 'var(--color-text)', font: 'inherit', textAlign: 'left', cursor: 'pointer', padding: 0 },
  qty: { display: 'flex', alignItems: 'center', gap: 2 },
  qtyBtn: { width: 18, height: 18, border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer', lineHeight: 1, padding: 0 },
  tag: { width: 20, height: 20, border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)', color: 'var(--color-text-muted)', cursor: 'pointer', fontWeight: 700, fontSize: 11, padding: 0 },
  tagOn: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: '1px solid var(--color-accent)' },
  details: { padding: '0 8px 6px 26px' },
  meta: { fontSize: 10, color: 'var(--color-text-muted)' },
  detailText: { fontSize: 11, lineHeight: 1.4, color: 'var(--color-text)', whiteSpace: 'pre-wrap', marginTop: 2 },
};
