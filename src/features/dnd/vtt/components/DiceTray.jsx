// Dice tray — a draggable bottom-right widget (position persists). Roll single
// dice (buttons) or a full formula (e.g. 2d6+4, 1d4+2d6+5) typed or built up.
// By default real 3D dice (three.js, lazy chunk) tumble and settle in the tray;
// the CSS dice remain as the fallback (WebGL failure / 3D off / >12 dice).
// Either way the result is mathematically random — the animation only
// visualises it.
import { useEffect, useRef, useState } from 'react';
import Dice3D from './Dice3D';
import { useDice3d, setDice3d } from '../lib/vttPrefs';

const DICE = [4, 6, 8, 10, 12, 20, 100];
const POS_KEY = 'nerdshelf:vttDicePos';
const KEYFRAMES = `
@keyframes vtt-die-fall {
  0%   { transform: translateY(-240px) rotateX(0deg) rotateY(0deg) scale(0.5); opacity: 0; }
  15%  { opacity: 1; }
  70%  { transform: translateY(6px) rotateX(560deg) rotateY(380deg) scale(1.08); }
  84%  { transform: translateY(-5px) rotateX(640deg) rotateY(410deg) scale(0.98); }
  100% { transform: translateY(0) rotateX(720deg) rotateY(360deg) scale(1); }
}`;
let _styleInjected = false;
function injectStyle() {
  if (_styleInjected || typeof document === 'undefined') return;
  const el = document.createElement('style'); el.textContent = KEYFRAMES; document.head.appendChild(el); _styleInjected = true;
}

// Parse a dice formula like "1d4+2d6+5" → terms. Returns null if unparseable.
function parseFormula(str) {
  const s = String(str).replace(/\s+/g, '').toLowerCase();
  if (!s) return null;
  const re = /([+-]?)(\d*)d(\d+)|([+-]?\d+)/g;
  const terms = []; let m; let matchedTo = 0;
  while ((m = re.exec(s))) {
    if (m.index !== matchedTo) return null; // gap = invalid
    matchedTo = re.lastIndex;
    if (m[3]) { // NdM
      const sign = m[1] === '-' ? -1 : 1;
      terms.push({ kind: 'dice', sign, count: Math.min(50, Math.max(1, +(m[2] || 1))), sides: +m[3] });
    } else { // flat modifier
      terms.push({ kind: 'mod', value: +m[4] });
    }
  }
  if (matchedTo !== s.length || !terms.length) return null;
  return terms;
}

function rollFormula(terms) {
  const dice = []; let total = 0;
  for (const t of terms) {
    if (t.kind === 'mod') { total += t.value; continue; }
    for (let i = 0; i < t.count; i++) {
      const r = 1 + Math.floor(Math.random() * t.sides);
      dice.push({ id: 'd' + Math.random().toString(36).slice(2, 8), sides: t.sides, result: r });
      total += t.sign * r;
    }
  }
  return { dice, total };
}

export default function DiceTray() {
  const [open, setOpen] = useState(false);
  // One state holds the current roll; randomness lives inside the setState
  // updater (deferred), keeping render pure.
  const [roll, setRoll] = useState({ dice: [], total: null });
  const dice = roll.dice;
  const total = roll.total;
  const [formula, setFormula] = useState('');
  const want3d = useDice3d();
  // Dice3D meldet Fallback MIT Grund (string) — wird sichtbar angezeigt,
  // damit "3D geht nicht" diagnostizierbar ist statt still 2D zu zeigen.
  const [webglBroken, setWebglBroken] = useState(null);
  // Live-Statuszeile der 3D-Pipeline (Lade Module / Init / läuft) — zeigt
  // beim Hängen sichtbar WO es hängt.
  const [d3status, setD3status] = useState(null);
  const [pos, setPos] = useState(() => {
    try { return JSON.parse(localStorage.getItem(POS_KEY)) || null; } catch { return null; }
  });
  const drag = useRef(null);
  useEffect(injectStyle, []);
  useEffect(() => {
    const move = (e) => { const d = drag.current; if (!d) return; setPos({ x: e.clientX - d.dx, y: e.clientY - d.dy }); };
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  // Persist the tray position whenever it changes (cheap; survives reloads).
  useEffect(() => { if (pos) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ } } }, [pos]);

  const rollOne = (sides) => setRoll(() => ({ dice: [{ id: 'd' + Math.random().toString(36).slice(2, 8), sides, result: 1 + Math.floor(Math.random() * sides) }], total: null }));
  const rollFromFormula = () => {
    const terms = parseFormula(formula); if (!terms) return;
    setRoll(() => rollFormula(terms));
  };
  const appendDie = (sides) => setFormula((f) => {
    const m = f.match(new RegExp(`(\\d+)d${sides}(?!\\d)`));
    if (m) return f.replace(m[0], `${+m[1] + 1}d${sides}`);
    return f ? `${f}+1d${sides}` : `1d${sides}`;
  });
  const clear = () => setRoll({ dice: [], total: null });

  // Externer Wurf: Statblock-Angriffe/Zauber/Rettungswürfe schicken
  // `vtt:roll` mit einer Formel (z.B. "1d20+11" oder "4d10+5") + Label →
  // Tray öffnet sich und würfelt sofort.
  useEffect(() => {
    const onRoll = (e) => {
      const f = String(e.detail?.formula || '').trim();
      const terms = parseFormula(f);
      if (!terms) return;
      setOpen(true);
      setFormula(f);
      setRoll(() => rollFormula(terms));
    };
    window.addEventListener('vtt:roll', onRoll);
    return () => window.removeEventListener('vtt:roll', onRoll);
  }, []);

  // Prefetch the heavy 3D chunks the moment the tray opens, so the FIRST roll
  // animates instantly instead of waiting on the lazy import.
  useEffect(() => {
    if (open && want3d) { import('three').catch(() => {}); import('cannon-es').catch(() => {}); }
  }, [open, want3d]);

  if (!open) return <button style={S.fab} onClick={() => setOpen(true)} title="Würfel">🎲</button>;

  const style = pos ? { ...S.wrap, left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : S.wrap;
  const onTitleDown = (e) => {
    const r = e.currentTarget.parentElement.getBoundingClientRect();
    const base = pos || { x: r.left, y: r.top };
    if (!pos) setPos(base);
    drag.current = { dx: e.clientX - base.x, dy: e.clientY - base.y };
  };
  const sum = dice.reduce((s, d) => s + d.result, 0);

  return (
    <div style={style}>
      <div style={S.head} onMouseDown={onTitleDown} title="Ziehen zum Verschieben">
        <span style={{ fontWeight: 700 }}>🎲 Würfel</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{ ...S.smallBtn, ...(want3d && !webglBroken ? S.toggleOn : null) }}
            onClick={() => setDice3d(!want3d)} onMouseDown={(e) => e.stopPropagation()}
            title={want3d ? '3D-Würfel an — Klick schaltet auf klassische Anzeige' : 'Klassische Anzeige — Klick schaltet 3D-Würfel an'}>3D</button>
          {dice.length > 0 && <button style={S.smallBtn} onClick={clear} onMouseDown={(e) => e.stopPropagation()}>Leeren</button>}
          <button style={S.smallBtn} onClick={() => setOpen(false)} onMouseDown={(e) => e.stopPropagation()}>×</button>
        </div>
      </div>
      <div style={S.picker}>
        {DICE.map((s) => (
          <button key={s} style={S.dieBtn} onClick={() => rollOne(s)} onContextMenu={(e) => { e.preventDefault(); appendDie(s); }} title={`Links: d${s} würfeln · Rechts: zur Formel +`}>d{s}</button>
        ))}
      </div>
      <div style={S.formulaRow}>
        <input value={formula} onChange={(e) => setFormula(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') rollFromFormula(); }}
          placeholder="z.B. 2d6+4" spellCheck={false} style={S.formula} />
        <button style={S.rollBtn} onClick={rollFromFormula} disabled={!parseFormula(formula)}>Wurf</button>
      </div>
      <div style={S.tray}>
        {dice.length === 0
          ? <span style={S.hint}>Würfel wählen oder Formel eingeben…</span>
          : (want3d && !webglBroken && dice.length <= 12)
            // key = roll identity → every roll remounts the scene for a fresh throw
            ? <Dice3D key={dice[0].id} dice={dice.map((d) => ({ sides: d.sides, result: d.result }))}
                onStatus={setD3status}
                onFallback={(reason) => { setD3status(null); setWebglBroken(reason || 'unbekannt'); }} />
            : dice.map((d) => <Die key={d.id} sides={d.sides} result={d.result} />)}
      </div>
      {want3d && !webglBroken && d3status && (
        <div style={S.statusNote}>{d3status}</div>
      )}
      {want3d && webglBroken && (
        <div style={S.fallbackNote}>
          ⚠ 3D-Fallback: {webglBroken}{' '}
          <button style={{ ...S.smallBtn, marginLeft: 4 }} onClick={() => setWebglBroken(null)}>Nochmal versuchen</button>
        </div>
      )}
      {/* Bei 3D immer auch als Text — das Ergebnis darf nie an einer
          klemmenden Animation hängen. */}
      {(total != null || dice.length > 1 || (dice.length > 0 && want3d && !webglBroken)) && (
        <div style={S.total}>{total != null ? <>Ergebnis: <b>{total}</b></> : <>Summe: <b>{sum}</b></>}</div>
      )}
    </div>
  );
}

function Die({ sides, result }) {
  const [face, setFace] = useState(result);
  const timer = useRef(null);
  useEffect(() => {
    let n = 0;
    timer.current = setInterval(() => { n += 1; if (n >= 9) { clearInterval(timer.current); setFace(result); return; } setFace(1 + Math.floor(Math.random() * sides)); }, 70);
    return () => clearInterval(timer.current);
  }, [sides, result]);
  const color = DIE_COLOR[sides] || 'var(--color-accent)';
  return (
    <div style={{ ...S.die, animation: 'vtt-die-fall 0.85s cubic-bezier(.3,.8,.4,1) both', borderColor: color }}>
      <span style={{ ...S.dieFace, color }}>{face}</span>
      <span style={S.dieLabel}>d{sides}</span>
    </div>
  );
}

const DIE_COLOR = { 4: '#ef5da8', 6: '#4ade80', 8: '#38bdf8', 10: '#a78bfa', 12: '#fb923c', 20: '#facc15', 100: '#f87171' };

const S = {
  fab: { position: 'absolute', right: 16, bottom: 16, zIndex: 25, width: 44, height: 44, borderRadius: '50%', border: '1px solid var(--color-border)', background: 'color-mix(in srgb, var(--color-bg-elevated) 92%, transparent)', color: 'var(--color-text)', fontSize: 22, cursor: 'pointer', boxShadow: '0 4px 16px #0007' },
  wrap: { position: 'absolute', right: 16, bottom: 16, zIndex: 25, width: 250, background: 'color-mix(in srgb, var(--color-bg-elevated) 96%, transparent)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg,10px)', boxShadow: '0 8px 30px #000a', overflow: 'hidden' },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--color-border)', cursor: 'move', userSelect: 'none' },
  smallBtn: { background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '1px 7px' },
  toggleOn: { borderColor: 'var(--color-accent)', color: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' },
  picker: { display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 8px 4px' },
  dieBtn: { flex: '1 0 28%', padding: '5px 0', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700, fontSize: 'var(--fs-sm)' },
  formulaRow: { display: 'flex', gap: 4, padding: '4px 8px 8px' },
  formula: { flex: 1, minWidth: 0, padding: '5px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)' },
  rollBtn: { padding: '5px 10px', background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700 },
  tray: { minHeight: 76, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', padding: 10, margin: '0 8px 8px', background: 'radial-gradient(ellipse at 50% 120%, #2a2f3a, #15171b)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', perspective: 600 },
  hint: { color: 'var(--color-text-muted)', fontSize: 11, alignSelf: 'center', margin: '0 auto' },
  die: { width: 40, height: 40, display: 'grid', placeItems: 'center', position: 'relative', background: 'linear-gradient(145deg, #2c313c, #1a1d24)', border: '2px solid', borderRadius: 8, transformStyle: 'preserve-3d', boxShadow: '0 3px 8px #0008' },
  dieFace: { fontSize: 18, fontWeight: 800, lineHeight: 1 },
  dieLabel: { position: 'absolute', bottom: 1, right: 3, fontSize: 7, color: 'var(--color-text-muted)' },
  total: { padding: '0 10px 10px', textAlign: 'right', fontSize: 'var(--fs-sm)' },
  fallbackNote: { padding: '0 10px 8px', fontSize: 10, lineHeight: 1.5, color: 'var(--color-warning,#e0af68)' },
  statusNote: { padding: '0 10px 6px', fontSize: 10, color: 'var(--color-text-muted)' },
};
