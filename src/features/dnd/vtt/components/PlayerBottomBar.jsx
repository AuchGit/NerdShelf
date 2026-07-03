// Player bottom bar — the always-there play surface for your own character.
// Big, touch-friendly controls for the things you use every turn: HP, spell
// slots, class resources, inspiration, and Short/Long Rest. Everything writes
// through patchCombat (the dnd_patch_combat_state RPC), so the VTT, the GM
// session view and the character sheet all stay in lock-step.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useVtt } from '../state/useVtt';
import { patchCombat, applyOwnCharacter } from '../sync/characterBinding';
import { useVttComputed } from '../lib/computedCharacter';
import { computeSpellSlots } from '../../character-builder/lib/sheetUtils';
import { CombatEconomy, CombatActionsExplorer, FavoritesSection } from '../../character-builder/components/sheet/OverviewTab';
import { Pinnable } from './tooltip/Tooltips';
import Specials from './Specials';

// Stackable bottom-bar panels (open upward; last-opened sits on top).
const PANEL_LABELS = { actions: '⚔ Aktionen', specials: '✨ Specials', items: '🎒 Items', favorites: '★ Favoriten' };

// Inventory quick-access items (the sheet's `quickAccess` flag) — potions,
// scrolls, anything the player pinned for one-click use at the table.
function quickAccessItems(character) {
  const all = [...(character.inventory?.items || []), ...(character.custom?.items || [])];
  return all.filter((it) => it && it.quickAccess);
}
function itemDetail(it) {
  if (typeof it.description === 'string' && it.description.trim()) return it.description.replace(/\{@\w+ ([^}|]*)[^}]*\}/g, '$1');
  if (Array.isArray(it.entries)) return it.entries.filter((e) => typeof e === 'string').join('\n\n');
  return '';
}

// Combat-state keys the dnd_patch_combat_state RPC accepts (mirrors the sheet).
const COMBAT_KEYS = ['currentHp', 'temporaryHp', 'conditions', 'deathSaves', 'concentration', 'economy', 'markedWeapons', 'maxHpBonus', 'inspiration', 'usedResources', 'usedSpellSlots', 'usedPactSlots', 'hitDiceUsed'];
function statusPatch(status) {
  const p = {}; for (const k of COMBAT_KEYS) if (k in (status || {})) p[k] = status[k]; return p;
}
function setPath(obj, path, value) {
  const keys = path.split('.'); let o = obj;
  for (let i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = value;
}

export default function PlayerBottomBar() {
  const chars = useVtt((s) => s.ui.characters || {});
  const myId = useVtt((s) => s.ui.myCharacterId);
  const [dmg, setDmg] = useState('');
  const [openPanels, setOpenPanels] = useState([]); // panel ids in open order (last = top)
  const [panelH, setPanelH] = useState({});         // id -> height px
  const [barH, setBarH] = useState(140);
  const [dragging, setDragging] = useState(false);  // 'bar' | { id } | false
  const startRef = useRef({ y: 0, h: 0 });
  const contentRefs = useRef({});                    // id -> content el (to clamp height to content)
  useEffect(() => {
    if (!dragging) return undefined;
    const move = (e) => {
      if (dragging === 'bar') { setBarH(Math.max(88, Math.min(380, startRef.current.h + (startRef.current.y - e.clientY)))); return; }
      const id = dragging.id;
      const el = contentRefs.current[id];
      // Don't let a panel grow past its own content (no empty space).
      const contentMax = el ? el.scrollHeight + 14 : 99999;
      const max = Math.min(window.innerHeight - 150, contentMax);
      setPanelH((h) => ({ ...h, [id]: Math.max(110, Math.min(max, startRef.current.h + (startRef.current.y - e.clientY))) }));
    };
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [dragging]);
  const startResize = (e) => { startRef.current = { y: e.clientY, h: barH }; setDragging('bar'); };
  const startPanelResize = (id, e) => { e.preventDefault(); startRef.current = { y: e.clientY, h: panelH[id] || 300 }; setDragging({ id }); };
  const togglePanel = (id) => setOpenPanels((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const ch = myId != null ? chars[myId] : null;
  const character = ch?.data || null;
  // Voll hydratisiert (Klassendaten + aktive Features) — sonst fehlen
  // Feature-Tabellen-Ressourcen wie Superiority/Energy Dice und
  // tabellenskalierte Zähler in der Ressourcen-Leiste.
  const computed = useVttComputed(character);

  const slots = useMemo(() => (character ? computeSpellSlots(character) : null), [character]);
  if (!character || !computed) return null;

  const status = character.status || {};
  const max = computed.hp?.max ?? 0;
  const cur = status.currentHp ?? max;
  const temp = status.temporaryHp || 0;
  const patch = (p) => patchCombat(myId, p);
  // Sheet-style writers for the embedded Action/Favorites components. Combat
  // state goes through the fast patchCombat RPC (whitelisted keys, GM sees it
  // live). Everything ELSE the sheet components write — favorites pins,
  // category sort order, colour markers, custom notes, item charges — is NOT in
  // that whitelist and would be silently dropped ('Pfeile/Pin machen nichts'),
  // so those changes route through the full own-character write instead.
  const applyCharacter = (mutator) => {
    const draft = typeof structuredClone === 'function' ? structuredClone(character) : JSON.parse(JSON.stringify(character));
    if (!draft.status) draft.status = {};
    mutator(draft);
    const strip = (c) => {
      const { status, ...rest } = c || {};
      const st = { ...(status || {}) };
      for (const k of COMBAT_KEYS) delete st[k];
      return JSON.stringify({ ...rest, status: st });
    };
    if (strip(draft) !== strip(character)) {
      applyOwnCharacter(myId, mutator); // full write covers status + the rest
      return;
    }
    patch(statusPatch(draft.status));
  };
  const updateCharacter = (path, value) => applyCharacter((d) => setPath(d, path, value));

  // ── HP (damage soaks temp first; heal clamps to max) ──
  const applyDelta = (sign) => {
    const n = Math.max(0, parseInt(dmg, 10) || 0);
    if (!n) return;
    if (sign < 0) {
      let t = temp; let d = n;
      if (t > 0) { const a = Math.min(t, d); t -= a; d -= a; }
      patch({ temporaryHp: t, currentHp: Math.max(0, cur - d) });
    } else {
      patch({ currentHp: Math.min(max, cur + n) });
    }
    setDmg('');
  };

  // ── Spell slots ──
  const used = status.usedSpellSlots || {};
  const slotLevels = [];
  for (let i = 0; i < (slots?.slots?.length || 0); i++) {
    const m = slots.slots[i];
    if (m > 0) slotLevels.push({ lvl: i + 1, max: m, used: used[i + 1] || 0 });
  }
  const setSlot = (lvl, n) => patch({ usedSpellSlots: { ...used, [lvl]: n } });
  const pact = slots?.warlockSlots;
  const pactUsed = status.usedPactSlots || 0;

  // ── Class resources ──
  const resources = computed.resources || [];
  const usedRes = status.usedResources || {};
  const setRes = (id, n) => patch({ usedResources: { ...usedRes, [id]: n } });

  const inspiration = !!(status.inspiration || character.info?.inspiration);

  // ── Quick-access items: consume/add one, equip/unequip — all through the
  // owner full-character path so sheet + VTT stay in lock-step. ──
  const quickItems = quickAccessItems(character);
  const mutateQuickItem = (it, fn) => applyOwnCharacter(myId, (d) => {
    for (const bucket of ['inventory', 'custom']) {
      const arr = d[bucket]?.items;
      if (!Array.isArray(arr)) continue;
      const t = arr.find((x) => (x.id || x._id || x.name) === (it.id || it._id || it.name));
      if (t) { fn(t); return; }
    }
  });
  const consumeQuickItem = (it) => mutateQuickItem(it, (t) => { if ((t.quantity ?? 1) > 0) t.quantity = (t.quantity ?? 1) - 1; });
  const addQuickItem = (it) => mutateQuickItem(it, (t) => { t.quantity = (t.quantity ?? 1) + 1; });
  const toggleEquipItem = (it) => mutateQuickItem(it, (t) => { t.equipped = !t.equipped; });

  // ── Rests ──
  const shortRest = () => {
    const nextRes = { ...usedRes };
    for (const r of resources) if (r.recharge === 'short_rest') nextRes[r.id] = 0;
    patch({ usedPactSlots: 0, usedResources: nextRes });
  };
  const longRest = () => {
    const hitDiceUsed = { ...(status.hitDiceUsed || {}) };
    for (const cls of (character.classes || [])) {
      const recover = Math.ceil((cls.level || 0) / 2);
      hitDiceUsed[cls.classId] = Math.max(0, (hitDiceUsed[cls.classId] || 0) - recover);
    }
    patch({
      currentHp: max, temporaryHp: 0,
      usedSpellSlots: {}, usedPactSlots: 0, usedResources: {},
      deathSaves: { successes: 0, failures: 0 },
      concentration: null,
      economy: { action: false, bonusAction: false, reaction: false },
      hitDiceUsed,
    });
  };

  const hpPct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  const hpColor = cur <= 0 || hpPct < 25 ? 'var(--color-danger)' : hpPct < 50 ? 'var(--color-warning,#d98e00)' : 'var(--accent-green,#4ade80)';

  const ac = computed.ac?.total ?? '—';

  // Content for each stackable panel (reuses the sheet's components).
  const renderPanel = (id) => {
    if (id === 'actions') return <CombatActionsExplorer character={character} computed={computed} applyCharacter={applyCharacter} embedded columns />;
    if (id === 'specials') return <Specials />;
    if (id === 'items') return <ItemsPanel items={quickItems} consume={consumeQuickItem} addOne={addQuickItem} toggleEquip={toggleEquipItem} />;
    if (id === 'favorites') return <FavoritesSection character={character} computed={computed} applyCharacter={applyCharacter} columns={4} />;
    return null;
  };
  // Which toggle buttons to offer (Items only when there are quick items).
  const panelButtons = ['actions', 'specials', ...(quickItems.length ? ['items'] : []), 'favorites'];

  // Inspiration highlights the whole bar (gold border/glow) so you always see it.
  const barStyle = inspiration
    ? { ...S.bar, height: barH, borderColor: 'var(--color-warning,#e0af68)', boxShadow: '0 -4px 20px #0007, 0 0 0 1px var(--color-warning,#e0af68), 0 0 18px -2px var(--color-warning,#e0af68)' }
    : { ...S.bar, height: barH };

  return (
    <div style={barStyle}>
      {openPanels.length > 0 && (
        <div style={S.panelStack}>
          {/* Reverse so the LAST-opened panel sits on top, first-opened at the bottom. */}
          {[...openPanels].reverse().map((id) => (
            <div key={id} style={inspiration ? { ...S.panel, ...S.panelInsp } : S.panel}>
              <div style={S.panelHead} onMouseDown={(e) => startPanelResize(id, e)} title="Höhe ziehen">
                <span style={S.panelTitle}>{PANEL_LABELS[id]}</span>
                <span style={{ flex: 1 }} />
                <span style={S.panelClose} onMouseDown={(e) => e.stopPropagation()} onClick={() => togglePanel(id)} title="Schließen">✕</span>
              </div>
              {/* Fits its content (no empty space); drag the header to cap the
                  height — beyond the content it just scrolls. */}
              <div style={{ ...S.panelScroll, maxHeight: panelH[id] || 300 }} ref={(el) => { contentRefs.current[id] = el; }}>
                {renderPanel(id)}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={S.handle} onMouseDown={startResize} title="Höhe ziehen (vergrößern/verkleinern)">
        <div style={{ width: 44, height: 4, borderRadius: 2, background: 'var(--color-border)' }} />
      </div>
      <div style={S.row}>
      {/* AC — click toggles Inspiration; the badge (and whole bar) glow when held.
          Short/Long Rest sit directly under it. */}
      <Group label={inspiration ? 'AC · INSPIRATION' : 'AC (Klick = Insp)'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={inspiration ? { ...S.acBadge, ...S.acInsp } : S.acBadge}
            onClick={() => patch({ inspiration: !inspiration })}
            onDoubleClick={() => window.dispatchEvent(new CustomEvent('vtt:center-token', { detail: { characterId: myId } }))}
            title={(inspiration ? 'Inspiration aktiv — Klick entfernt sie' : 'Klick: Inspiration setzen') + ' · Doppelklick: Kamera auf mein Token'}>
            🛡 <b style={{ fontSize: 20 }}>{ac}</b>
            {inspiration && <span style={{ color: 'var(--color-warning,#e0af68)', fontWeight: 800 }}>◆</span>}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={{ ...S.rest, flex: 1, padding: '4px 0' }} onClick={shortRest} title="Short Rest — Pact-Slots & Short-Rest-Ressourcen">SR</button>
            <button style={{ ...S.rest, ...S.restLong, flex: 1, padding: '4px 0' }} onClick={longRest} title="Long Rest — HP, Slots, Ressourcen, halbe Hit Dice">LR</button>
          </div>
        </div>
      </Group>

      {/* HP */}
      <Group label="HP">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ minWidth: 90 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <b style={{ fontSize: 22, color: hpColor }}>{cur}</b>
              <span style={{ color: 'var(--color-text-muted)' }}>/ {max}</span>
              {temp > 0 && <span style={{ color: 'var(--accent-green,#4ade80)', fontWeight: 700 }}>+{temp}</span>}
            </div>
            <div style={S.hpTrack}><div style={{ ...S.hpFill, width: `${hpPct}%`, background: hpColor }} /></div>
          </div>
          <div style={S.dmgGroup}>
            <button style={S.dmgBtn} onClick={() => applyDelta(-1)} title="Schaden">−</button>
            <input type="number" min="0" value={dmg} onChange={(e) => setDmg(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyDelta(+1); }} placeholder="±" style={S.dmgInput} />
            <button style={S.healBtn} onClick={() => applyDelta(+1)} title="Heilung">+</button>
          </div>
        </div>
      </Group>

      {/* Spell slots */}
      {(slotLevels.length > 0 || (pact && pact.slots > 0)) && (
        <Group label="Slots">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {slotLevels.map((s) => (
              <SlotPips key={s.lvl} label={`L${s.lvl}`} max={s.max} used={s.used} onSet={(n) => setSlot(s.lvl, n)} />
            ))}
            {pact && pact.slots > 0 && (
              <SlotPips label={`Pact L${pact.level}`} max={pact.slots} used={pactUsed} color="var(--color-accent)"
                onSet={(n) => patch({ usedPactSlots: n })} />
            )}
          </div>
        </Group>
      )}

      {/* Class resources */}
      {resources.length > 0 && (
        <Group label="Ressourcen">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {resources.map((r) => (
              <SlotPips key={r.id} label={r.name} title={r.name} max={r.max} used={usedRes[r.id] || 0}
                color="var(--color-orange,#ff9533)" onSet={(n) => setRes(r.id, n)} />
            ))}
          </div>
        </Group>
      )}

      {/* Action economy + panel toggles (Actions / Features-Maneuvers / Items).
          Each opens as a bar that stacks upward; toggling moves it to the top. */}
      <Group label="Bereiche" grow>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <CombatEconomy value={status.economy || {}} character={character} onChange={(next) => updateCharacter('status.economy', next)} />
          {/* Die Panel-Buttons strecken sich über den Rest der Bar — kein toter
              Platz rechts, große Klickflächen. */}
          {panelButtons.map((id) => (
            <button key={id} style={{ ...(openPanels.includes(id) ? S.inspOn : S.rest), flex: '1 1 110px', textAlign: 'center', minWidth: 0, whiteSpace: 'nowrap' }}
              onClick={() => togglePanel(id)} title={PANEL_LABELS[id]}>{PANEL_LABELS[id]}</button>
          ))}
        </div>
      </Group>
      </div>
    </div>
  );
}

function Group({ label, children, grow }) {
  return (
    <div style={grow ? { ...S.group, flex: '1 1 280px', minWidth: 0 } : S.group}>
      <div style={S.groupLbl}>{label}</div>
      {children}
    </div>
  );
}

// Items panel content — quick-access items in a roomy wrap (moved out of the bar
// so the bar doesn't overflow). − consumes, + adds one, An/Ab equips gear.
function ItemsPanel({ items, consume, addOne, toggleEquip }) {
  if (!items.length) return <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', padding: 8 }}>Keine Quick-Access-Items. Markiere Items im Charakterbogen als Quick-Access.</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8, padding: 8 }}>
      {items.map((it) => (
        <Pinnable key={it.id || it.name} title={it.name} render={() => <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{itemDetail(it) || '—'}</div>}>
          <div style={{ ...S.qa, ...(it.equipped ? S.qaEquipped : null) }}>
            <span style={S.qaName}>{it.name}</span>
            <span style={S.qaQty}>{it.quantity ?? 1}</span>
            <button style={S.qaUse} title="Einen verbrauchen" onClick={() => consume(it)}>−</button>
            <button style={{ ...S.qaUse, color: 'var(--accent-green,#4ade80)' }} title="Einen hinzufügen" onClick={() => addOne(it)}>+</button>
            <button style={{ ...S.qaEquip, ...(it.equipped ? S.qaEquipOn : null) }}
              title={it.equipped ? 'Angelegt — Klick legt ab' : 'Nicht angelegt — Klick legt an'}
              onClick={() => toggleEquip(it)}>{it.equipped ? 'Ab' : 'An'}</button>
          </div>
        </Pinnable>
      ))}
    </div>
  );
}

// Click pip n → set used to n (or n-1 if already exactly n, to toggle back).
function SlotPips({ label, max, used, color = 'var(--color-accent)', onSet, title }) {
  return (
    <div style={{ textAlign: 'center' }} title={title || label}>
      <div style={S.pipLbl}>{label}</div>
      <div style={{ display: 'flex', gap: 3 }}>
        {Array.from({ length: max }, (_, i) => {
          const filled = i < (max - used); // show remaining as filled
          return (
            <button key={i} onClick={() => onSet(max - (i + 1) === used ? max - i : max - (i + 1))}
              title={`${max - used}/${max}`}
              style={{ width: 14, height: 18, borderRadius: 3, cursor: 'pointer', border: `1.5px solid ${color}`, background: filled ? color : 'transparent', padding: 0 }} />
          );
        })}
      </div>
    </div>
  );
}


const S = {
  // Centered, resizable bar (drag the top handle to grow/shrink).
  bar: { position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 0, width: 'min(1320px, calc(100% - 80px))', zIndex: 24, display: 'flex', flexDirection: 'column', background: 'color-mix(in srgb, var(--color-bg-elevated) 95%, transparent)', backdropFilter: 'blur(4px)', border: '1px solid var(--color-border)', borderBottom: 'none', borderRadius: '12px 12px 0 0', boxShadow: '0 -4px 20px #0007' },
  handle: { height: 10, flexShrink: 0, cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  // Wrap onto multiple lines instead of scrolling sideways; the bar is resizable
  // taller (drag the handle) when wrapping needs more room.
  row: { flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', alignContent: 'center', flexWrap: 'wrap', gap: '6px 18px', padding: '4px 16px 8px', overflowX: 'hidden', overflowY: 'auto' },
  group: { display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 },
  groupLbl: { fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 },
  hpTrack: { height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 2 },
  hpFill: { height: '100%', transition: 'width 150ms' },
  dmgGroup: { display: 'flex', alignItems: 'center', height: 30, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--color-surface)' },
  dmgBtn: { width: 28, height: '100%', border: 'none', background: 'transparent', color: 'var(--color-danger)', fontSize: 18, fontWeight: 800, cursor: 'pointer' },
  healBtn: { width: 28, height: '100%', border: 'none', background: 'transparent', color: 'var(--accent-green,#4ade80)', fontSize: 18, fontWeight: 800, cursor: 'pointer' },
  dmgInput: { width: 44, height: '100%', border: 'none', borderLeft: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text)', textAlign: 'center', fontWeight: 700, outline: 'none' },
  pipLbl: { fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 2, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  acBadge: { display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)', cursor: 'pointer' },
  acInsp: { border: '1px solid var(--color-warning,#e0af68)', background: 'color-mix(in srgb, var(--color-warning,#e0af68) 18%, transparent)', boxShadow: '0 0 10px -2px var(--color-warning,#e0af68)' },
  qa: { display: 'flex', alignItems: 'center', gap: 4, padding: '4px 4px 4px 8px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', cursor: 'default', width: '100%', minWidth: 0, boxSizing: 'border-box' },
  qaName: { fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  qaQty: { fontSize: 10, fontWeight: 700, color: 'var(--color-accent)', minWidth: 12, textAlign: 'center' },
  qaUse: { width: 18, height: 18, border: '1px solid var(--color-border)', borderRadius: 4, background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer', fontWeight: 800, lineHeight: 1, padding: 0 },
  qaEquip: { height: 18, padding: '0 5px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontWeight: 700, fontSize: 9, lineHeight: 1 },
  qaEquipOn: { borderColor: 'var(--color-accent)', color: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' },
  qaEquipped: { borderColor: 'var(--color-accent)' },
  // Stacked panels above the bar (column: first child = top = last-opened).
  panelStack: { position: 'absolute', bottom: '100%', left: 0, right: 0, display: 'flex', flexDirection: 'column' },
  panel: { display: 'flex', flexDirection: 'column', background: 'color-mix(in srgb, var(--color-bg-elevated) 97%, transparent)', border: '1px solid var(--color-border)', borderBottom: 'none', borderRadius: '12px 12px 0 0', boxShadow: '0 -6px 24px #0008', overflow: 'hidden' },
  // Inspiration vergoldet ALLE offenen Flächen, nicht nur die Bar selbst.
  panelInsp: { borderColor: 'var(--color-warning,#e0af68)', boxShadow: '0 -6px 24px #0008, 0 0 0 1px var(--color-warning,#e0af68), 0 0 18px -2px var(--color-warning,#e0af68)' },
  panelHead: { display: 'flex', alignItems: 'center', gap: 8, height: 24, flexShrink: 0, padding: '0 10px', cursor: 'ns-resize', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' },
  panelTitle: { fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 },
  panelClose: { cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 13, padding: '0 2px' },
  panelScroll: { overflowY: 'auto', padding: '6px 10px 10px' },
  inspOn: { flexShrink: 0, padding: '7px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-warning,#e0af68)', background: 'color-mix(in srgb, var(--color-warning,#e0af68) 20%, transparent)', color: 'var(--color-warning,#e0af68)', fontWeight: 700, cursor: 'pointer', fontSize: 'var(--fs-md)' },
  inspOff: { flexShrink: 0, padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontWeight: 700, cursor: 'pointer' },
  rest: { flexShrink: 0, padding: '7px 13px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontWeight: 800, cursor: 'pointer', fontSize: 'var(--fs-md)' },
  restLong: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: '1px solid var(--color-accent)' },
};
