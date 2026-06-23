// Player bottom bar — the always-there play surface for your own character.
// Big, touch-friendly controls for the things you use every turn: HP, spell
// slots, class resources, inspiration, and Short/Long Rest. Everything writes
// through patchCombat (the dnd_patch_combat_state RPC), so the VTT, the GM
// session view and the character sheet all stay in lock-step.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useVtt } from '../state/useVtt';
import { patchCombat, applyOwnCharacter } from '../sync/characterBinding';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';
import { computeSpellSlots } from '../../character-builder/lib/sheetUtils';
import { CombatEconomy, CombatActionsExplorer } from '../../character-builder/components/sheet/OverviewTab';
import { Pinnable } from './tooltip/Tooltips';

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
  const [actionsOpen, setActionsOpen] = useState(false);
  const [barH, setBarH] = useState(140); // resizable height (wraps instead of scrolling)
  const [actionsH, setActionsH] = useState(280); // resizable actions panel height
  const [dragging, setDragging] = useState(false); // 'bar' | 'actions' | false
  const startRef = useRef({ y: 0, h: 0 });
  useEffect(() => {
    if (!dragging) return undefined;
    const move = (e) => {
      if (dragging === 'actions') setActionsH(Math.max(120, Math.min(window.innerHeight - 160, startRef.current.h + (startRef.current.y - e.clientY))));
      else setBarH(Math.max(88, Math.min(380, startRef.current.h + (startRef.current.y - e.clientY))));
    };
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [dragging]);
  const startResize = (e) => { startRef.current = { y: e.clientY, h: barH }; setDragging('bar'); };
  const startActionsResize = (e) => { e.preventDefault(); startRef.current = { y: e.clientY, h: actionsH }; setDragging('actions'); };
  const ch = myId != null ? chars[myId] : null;
  const character = ch?.data || null;
  const computed = useMemo(() => {
    if (!character) return null;
    try { return computeCharacter(character); } catch { return null; }
  }, [character]);

  const slots = useMemo(() => (character ? computeSpellSlots(character) : null), [character]);
  if (!character || !computed) return null;

  const status = character.status || {};
  const max = computed.hp?.max ?? 0;
  const cur = status.currentHp ?? max;
  const temp = status.temporaryHp || 0;
  const patch = (p) => patchCombat(myId, p);
  // Sheet-style writers for the embedded Action components: mutate a draft, then
  // push the whitelisted combat-state through patchCombat (RPC).
  const applyCharacter = (mutator) => {
    const draft = typeof structuredClone === 'function' ? structuredClone(character) : JSON.parse(JSON.stringify(character));
    if (!draft.status) draft.status = {};
    mutator(draft);
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

  // ── Quick-access items (consume one on click) ──
  const quickItems = quickAccessItems(character);
  const consumeQuickItem = (it) => applyOwnCharacter(myId, (d) => {
    for (const bucket of ['inventory', 'custom']) {
      const arr = d[bucket]?.items;
      if (!Array.isArray(arr)) continue;
      const t = arr.find((x) => (x.id || x._id || x.name) === (it.id || it._id || it.name));
      if (t && (t.quantity ?? 1) > 0) { t.quantity = (t.quantity ?? 1) - 1; return; }
    }
  });

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

  // Inspiration highlights the whole bar (gold border/glow) so you always see it.
  const barStyle = inspiration
    ? { ...S.bar, height: barH, borderColor: 'var(--color-warning,#e0af68)', boxShadow: '0 -4px 20px #0007, 0 0 0 1px var(--color-warning,#e0af68), 0 0 18px -2px var(--color-warning,#e0af68)' }
    : { ...S.bar, height: barH };

  return (
    <div style={barStyle}>
      {actionsOpen && (
        <div style={{ ...S.actionsPanel, height: actionsH }}>
          <div style={S.actionsHandle} onMouseDown={startActionsResize} title="Höhe ziehen">
            <div style={{ width: 44, height: 4, borderRadius: 2, background: 'var(--color-border)' }} />
          </div>
          <div style={S.actionsScroll}>
            <CombatActionsExplorer character={character} computed={computed} applyCharacter={applyCharacter} embedded columns />
          </div>
        </div>
      )}
      <div style={S.handle} onMouseDown={startResize} title="Höhe ziehen (vergrößern/verkleinern)">
        <div style={{ width: 44, height: 4, borderRadius: 2, background: 'var(--color-border)' }} />
      </div>
      <div style={S.row}>
      {/* AC — click toggles Inspiration; the badge (and whole bar) glow when held */}
      <Group label={inspiration ? 'AC · INSPIRATION' : 'AC (Klick = Insp)'}>
        <div style={inspiration ? { ...S.acBadge, ...S.acInsp } : S.acBadge}
          onClick={() => patch({ inspiration: !inspiration })}
          title={inspiration ? 'Inspiration aktiv — Klick entfernt sie' : 'Klick: Inspiration setzen'}>
          🛡 <b style={{ fontSize: 20 }}>{ac}</b>
          {inspiration && <span style={{ color: 'var(--color-warning,#e0af68)', fontWeight: 800 }}>◆</span>}
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

      {/* Action economy + full action list (from the sheet's Overview tab) */}
      <Group label="Aktionen">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CombatEconomy value={status.economy || {}} character={character} onChange={(next) => updateCharacter('status.economy', next)} />
          <button style={actionsOpen ? S.inspOn : S.rest} onClick={() => setActionsOpen((o) => !o)} title="Aktionsliste (Action / Bonus / Reaction) mit Hinweisen">⚔ Aktionen</button>
        </div>
      </Group>

      {/* Quick-access items — potions/scrolls/etc. flagged on the sheet. */}
      {quickItems.length > 0 && (
        <Group label="Quick-Access">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 360 }}>
            {quickItems.map((it) => (
              <Pinnable key={it.id || it.name} title={it.name} render={() => <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{itemDetail(it) || '—'}</div>}>
                <div style={S.qa}>
                  <span style={S.qaName}>{it.name}</span>
                  <span style={S.qaQty}>{it.quantity ?? 1}</span>
                  <button style={S.qaUse} title="Verbrauchen" onClick={() => consumeQuickItem(it)}>−</button>
                </div>
              </Pinnable>
            ))}
          </div>
        </Group>
      )}

      <div style={{ flex: 1 }} />

      {/* Rests (Inspiration = AC badge above; Notizen = FAB neben dem Würfel) */}
      <button style={S.rest} onClick={shortRest} title="Short Rest — Pact-Slots & Short-Rest-Ressourcen">SR</button>
      <button style={{ ...S.rest, ...S.restLong }} onClick={longRest} title="Long Rest — HP, Slots, Ressourcen, halbe Hit Dice">LR</button>
      </div>
    </div>
  );
}

function Group({ label, children }) {
  return (
    <div style={S.group}>
      <div style={S.groupLbl}>{label}</div>
      {children}
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
  bar: { position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 0, width: 'min(1320px, calc(100% - 80px))', zIndex: 24, display: 'flex', flexDirection: 'column', background: 'rgba(15,17,21,0.95)', backdropFilter: 'blur(4px)', border: '1px solid var(--color-border)', borderBottom: 'none', borderRadius: '12px 12px 0 0', boxShadow: '0 -4px 20px #0007' },
  handle: { height: 10, flexShrink: 0, cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  // Wrap onto multiple lines instead of scrolling sideways; the bar is resizable
  // taller (drag the handle) when wrapping needs more room.
  row: { flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', alignContent: 'center', flexWrap: 'wrap', gap: '6px 18px', padding: '4px 16px 8px', overflowX: 'hidden', overflowY: 'auto' },
  group: { display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 },
  groupLbl: { fontSize: 8, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 },
  hpTrack: { height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 2 },
  hpFill: { height: '100%', transition: 'width 150ms' },
  dmgGroup: { display: 'flex', alignItems: 'center', height: 30, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--color-surface)' },
  dmgBtn: { width: 28, height: '100%', border: 'none', background: 'transparent', color: 'var(--color-danger)', fontSize: 18, fontWeight: 800, cursor: 'pointer' },
  healBtn: { width: 28, height: '100%', border: 'none', background: 'transparent', color: 'var(--accent-green,#4ade80)', fontSize: 18, fontWeight: 800, cursor: 'pointer' },
  dmgInput: { width: 44, height: '100%', border: 'none', borderLeft: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text)', textAlign: 'center', fontWeight: 700, outline: 'none' },
  pipLbl: { fontSize: 9, color: 'var(--color-text-muted)', marginBottom: 2, maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  acBadge: { display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)', cursor: 'pointer' },
  acInsp: { border: '1px solid var(--color-warning,#e0af68)', background: 'color-mix(in srgb, var(--color-warning,#e0af68) 18%, transparent)', boxShadow: '0 0 10px -2px var(--color-warning,#e0af68)' },
  qa: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 4px 2px 8px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', cursor: 'default', maxWidth: 150, flexShrink: 0 },
  qaName: { fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  qaQty: { fontSize: 10, fontWeight: 700, color: 'var(--color-accent)', minWidth: 12, textAlign: 'center' },
  qaUse: { width: 18, height: 18, border: '1px solid var(--color-border)', borderRadius: 4, background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer', fontWeight: 800, lineHeight: 1, padding: 0 },
  actionsPanel: { position: 'absolute', bottom: '100%', left: 0, right: 0, display: 'flex', flexDirection: 'column', background: 'rgba(15,17,21,0.97)', border: '1px solid var(--color-border)', borderRadius: '12px 12px 0 0', boxShadow: '0 -6px 24px #0008' },
  actionsHandle: { height: 12, flexShrink: 0, cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  actionsScroll: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 10px' },
  notesPanel: { position: 'absolute', bottom: '100%', right: 0, width: 360, maxWidth: '90%', background: 'rgba(15,17,21,0.97)', border: '1px solid var(--color-border)', borderRadius: '12px 12px 0 0', boxShadow: '0 -6px 24px #0008', padding: 10, zIndex: 1 },
  notesArea: { width: '100%', boxSizing: 'border-box', minHeight: 140, resize: 'vertical', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 8px', fontFamily: 'inherit', fontSize: 'var(--fs-sm)', lineHeight: 1.4 },
  inspOn: { flexShrink: 0, padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-warning,#e0af68)', background: 'color-mix(in srgb, var(--color-warning,#e0af68) 20%, transparent)', color: 'var(--color-warning,#e0af68)', fontWeight: 700, cursor: 'pointer' },
  inspOff: { flexShrink: 0, padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontWeight: 700, cursor: 'pointer' },
  rest: { flexShrink: 0, padding: '8px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontWeight: 800, cursor: 'pointer' },
  restLong: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: '1px solid var(--color-accent)' },
};
