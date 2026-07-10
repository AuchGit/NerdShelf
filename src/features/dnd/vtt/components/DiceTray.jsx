// Dice tray — a draggable bottom-right widget (position persists). Roll single
// dice (buttons) or a full formula (e.g. 2d6+4, 1d4+2d6+5) typed or built up.
// Real 3D dice (three.js, lazy chunk) tumble and settle in the tray. If WebGL
// is unavailable or a roll exceeds 12 dice, we skip the 3D scene and just show
// the numeric result — there is no 2D dice widget anymore. Either way the
// result is mathematically random; the animation only visualises it.
import { useEffect, useRef, useState } from 'react';
import Dice3D from './Dice3D';
import { emitRollResult } from '../lib/rollDice';
import { useVtt } from '../state/useVtt';
import { logRoll } from '../state/actions';

const DICE = [4, 6, 8, 10, 12, 20, 100];
const POS_KEY = 'nerdshelf:vttDicePos';

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

const rid = () => 'd' + Math.random().toString(36).slice(2, 8);
// Ein d100 wird wie ECHTE Perzentilwürfel dargestellt: ein Zehner-Würfel
// (00,10,…,90) + ein Einer-Würfel (0–9). 00+0 = 100. Der Zehner trägt den
// vollen Wert für die Summe, der Einer 0 (kein Doppelzählen).
function diceFor(sides, r) {
  if (sides === 100) {
    return [
      { id: rid(), sides: 10, result: (Math.floor(r / 10) % 10) * 10, value: r, faceSet: 'd100tens' },
      { id: rid(), sides: 10, result: r % 10, value: 0, faceSet: 'd100units' },
    ];
  }
  return [{ id: rid(), sides, result: r, value: r }];
}
// mode: 'adv' | 'dis' (roll the d20 twice, keep higher/lower) | 'crit' (double
// every dice term's count — the classic crit rule, modifiers stay) | null.
function rollFormula(terms, mode) {
  const dice = []; let total = 0;
  const crit = mode === 'crit';
  const adv = mode === 'adv'; const dis = mode === 'dis';
  let d20Done = false;
  for (const t of terms) {
    if (t.kind === 'mod') { total += t.value; continue; }
    let count = crit ? t.count * 2 : t.count;
    if ((adv || dis) && t.sides === 20 && !d20Done) {
      d20Done = true;
      const r1 = 1 + Math.floor(Math.random() * 20);
      const r2 = 1 + Math.floor(Math.random() * 20);
      const keep = adv ? Math.max(r1, r2) : Math.min(r1, r2);
      const drop = adv ? Math.min(r1, r2) : Math.max(r1, r2);
      dice.push({ id: rid(), sides: 20, result: keep, value: keep });
      dice.push({ id: rid(), sides: 20, result: drop, value: 0, dropped: true });
      total += t.sign * keep;
      count -= 1; // one d20 consumed by the advantage pair
    }
    for (let i = 0; i < count; i++) {
      const r = 1 + Math.floor(Math.random() * t.sides);
      dice.push(...diceFor(t.sides, r));
      total += t.sign * r;
    }
  }
  return { dice, total, mode: mode || null };
}

export default function DiceTray() {
  const [open, setOpen] = useState(false);
  // One state holds the current roll; randomness lives inside the setState
  // updater (deferred), keeping render pure.
  const [roll, setRoll] = useState({ dice: [], total: null });
  const dice = roll.dice;
  const total = roll.total;
  const mode = roll.mode; // 'adv' | 'dis' | 'crit' | null
  const [formula, setFormula] = useState('');
  // Dice3D meldet Fallback MIT Grund (string) — wird sichtbar angezeigt,
  // damit "3D geht nicht" diagnostizierbar ist statt still nur Zahlen zu zeigen.
  const [webglBroken, setWebglBroken] = useState(null);
  // Wer würfelt hier? DM heißt „DM", Spieler nach ihrem gebundenen Charakter
  // (Name + Portrait fürs Würfelprotokoll). Rolls mit expliziter Quelle
  // (Statblock-Token, Initiative) überschreiben das per detail.src.
  const rollerName = useVtt((s) => (s.session.role === 'dm' ? 'DM'
    : (s.ui.myCharacterId != null ? (s.ui.characters?.[s.ui.myCharacterId]?.data?.info?.name || s.ui.characters?.[s.ui.myCharacterId]?.name) : null) || 'Spieler'));
  const rollerPortrait = useVtt((s) => (s.session.role === 'dm' ? null
    : (s.ui.myCharacterId != null ? (s.ui.characters?.[s.ui.myCharacterId]?.data?.appearance?.portrait || null) : null)));
  const [pos, setPos] = useState(() => {
    try { return JSON.parse(localStorage.getItem(POS_KEY)) || null; } catch { return null; }
  });
  const drag = useRef(null);
  useEffect(() => {
    const move = (e) => { const d = drag.current; if (!d) return; setPos({ x: e.clientX - d.dx, y: e.clientY - d.dy }); };
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  // Persist the tray position whenever it changes (cheap; survives reloads).
  useEffect(() => { if (pos) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ } } }, [pos]);

  // Ergebnis erst NACH der Animation zeigen.
  const [revealed, setRevealed] = useState(false);
  // Formel am WURF festhalten (fürs Protokoll) — das Eingabefeld kann sich
  // danach ändern.
  const rollOne = (sides) => { setRevealed(false); setRoll(() => ({ dice: diceFor(sides, 1 + Math.floor(Math.random() * sides)), total: null, formula: `1d${sides}` })); };
  const rollFromFormula = () => {
    const terms = parseFormula(formula); if (!terms) return;
    setRevealed(false); setRoll(() => ({ ...rollFormula(terms), formula }));
  };
  const appendDie = (sides) => setFormula((f) => {
    const m = f.match(new RegExp(`(\\d+)d${sides}(?!\\d)`));
    if (m) return f.replace(m[0], `${+m[1] + 1}d${sides}`);
    return f ? `${f}+1d${sides}` : `1d${sides}`;
  });
  // Einen Würfel dieser Seitenzahl aus der Formel entfernen (Term ganz weg bei 0).
  const removeDie = (sides) => setFormula((f) => {
    const m = f.match(new RegExp(`(\\d+)d${sides}(?!\\d)`));
    if (!m) return f;
    const cnt = +m[1] - 1;
    let nf = cnt <= 0
      ? f.replace(new RegExp(`([+\\-]?)\\s*${m[1]}d${sides}(?!\\d)`), '')
      : f.replace(m[0], `${cnt}d${sides}`);
    return nf.replace(/^\s*\+/, '').replace(/\+\s*\+/g, '+').trim();
  });
  const clear = () => setRoll({ dice: [], total: null });

  // Externer Wurf: Roll-Pills (Statblock, Spieler-Aktionen, Zauber) schicken
  // `vtt:roll` mit einer Formel (z.B. "1d20+11") + Label + optionalem Modus.
  // Kommt AUCH per BroadcastChannel an, damit ein Klick im ausgeklappten
  // Sheet-Fenster (Popout, eigener DOM) den Tray im VTT-Fenster erreicht. Ein
  // Nonce dedupliziert, falls beide Wege im selben Fenster ankommen.
  const lastRollId = useRef(null);
  useEffect(() => {
    const handle = (detail) => {
      if (!detail) return;
      if (detail.id && detail.id === lastRollId.current) return; // schon gewürfelt
      lastRollId.current = detail.id || null;
      const f = String(detail.formula || '').trim();
      const terms = parseFormula(f);
      if (!terms) return;
      setOpen(true);
      setFormula(f);
      setRevealed(false); setRoll(() => ({ ...rollFormula(terms, detail.mode || null), captureId: detail.captureId || null, label: detail.label || '', formula: f, src: detail.src || null, parts: detail.parts || null }));
    };
    const onRoll = (e) => handle(e.detail);
    window.addEventListener('vtt:roll', onRoll);
    let ch = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try { ch = new BroadcastChannel('nerdshelf:vtt-roll'); ch.onmessage = (e) => handle(e.data); } catch { ch = null; }
    }
    return () => { window.removeEventListener('vtt:roll', onRoll); try { ch?.close(); } catch { /* ignore */ } };
  }, []);

  // Ergebnis-Reveal: 3D meldet Fertigstellung (onDone); ohne 3D (WebGL kaputt
  // oder >12 Würfel) nach kurzer Verzögerung. Das Ergebnis wird ohnehin nur bei
  // dice.length > 0 angezeigt, der Leer-Fall braucht also nichts zu setzen.
  const use3d = !webglBroken && dice.length > 0 && dice.length <= 12;
  useEffect(() => {
    if (dice.length === 0 || use3d) return undefined; // 3D → wartet auf onDone
    const t = setTimeout(() => setRevealed(true), 500);
    return () => clearTimeout(t);
  }, [dice, use3d]);

  // Ergebnis-Rückmeldung: gehörte der Wurf zu einer captureId (z.B. eine
  // automatische Initiative), melden wir das Gesamtergebnis NACH der Animation
  // zurück (rollForResult löst dann auf). Einmal pro Wurf.
  const emittedRef = useRef(null);
  useEffect(() => {
    if (revealed && roll.captureId && roll.total != null && emittedRef.current !== roll.captureId) {
      emittedRef.current = roll.captureId;
      // Natürliche Einzelergebnisse mitschicken (ohne verworfene Vorteils-Würfel)
      // → Batch-Würfe (z.B. „8d20" Initiative) lassen sich pro Würfel zuordnen.
      const perDie = (roll.dice || []).filter((d) => !d.dropped).map((d) => d.value ?? d.result);
      emitRollResult(roll.captureId, roll.total, roll.label, perDie);
    }
  }, [revealed, roll]);

  // Würfelprotokoll: jeden AUFGEDECKTEN Wurf genau einmal loggen (synct an
  // alle; der DM liest es in der Roll-Log-Sidebar).
  const loggedRef = useRef(null);
  useEffect(() => {
    if (!revealed || !dice.length) return;
    const key = dice[0].id;
    if (loggedRef.current === key) return;
    loggedRef.current = key;
    const nat = dice.filter((d) => !d.dropped).map((d) => d.value ?? d.result);
    logRoll({
      name: roll.src?.name || rollerName,
      portrait: roll.src ? (roll.src.portrait || null) : rollerPortrait,
      label: roll.label || '',
      formula: roll.formula || '',
      mode: roll.mode || null,
      total: roll.total != null ? roll.total : nat.reduce((s, v) => s + v, 0),
      dice: nat,
      types: partTotals(roll.parts, nat, roll.mode) || undefined,
    });
  }, [revealed, dice, roll, rollerName, rollerPortrait]);

  // Prefetch the heavy 3D chunks the moment the tray opens, so the FIRST roll
  // animates instantly instead of waiting on the lazy import.
  useEffect(() => {
    if (open) { import('three').catch(() => {}); import('cannon-es').catch(() => {}); }
  }, [open]);

  if (!open) return <button style={S.fab} onClick={() => setOpen(true)} title="Würfel">🎲</button>;

  const style = pos ? { ...S.wrap, left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : S.wrap;
  const onTitleDown = (e) => {
    const r = e.currentTarget.parentElement.getBoundingClientRect();
    const base = pos || { x: r.left, y: r.top };
    if (!pos) setPos(base);
    drag.current = { dx: e.clientX - base.x, dy: e.clientY - base.y };
  };
  const sum = dice.reduce((s, d) => s + (d.value ?? d.result), 0);

  return (
    <div style={style}>
      <div style={S.head} onMouseDown={onTitleDown} title="Ziehen zum Verschieben">
        <span style={{ fontWeight: 700 }}>🎲 Würfel</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {dice.length > 0 && <button style={S.smallBtn} onClick={clear} onMouseDown={(e) => e.stopPropagation()}>Leeren</button>}
          <button style={S.smallBtn} onClick={() => setOpen(false)} onMouseDown={(e) => e.stopPropagation()}>×</button>
        </div>
      </div>
      <div style={S.picker}>
        {DICE.map((s) => (
          <div key={s} style={S.dieCell}>
            <button style={S.dieName} onClick={() => rollOne(s)} title={`d${s} sofort würfeln`}>d{s}</button>
            <div style={S.pmRow}>
              <button style={S.pmBtn} onClick={() => removeDie(s)} title={`ein d${s} aus der Formel`}>−</button>
              <button style={S.pmBtn} onClick={() => appendDie(s)} title={`ein d${s} zur Formel`}>+</button>
            </div>
          </div>
        ))}
      </div>
      <div style={S.formulaRow}>
        <input value={formula} onChange={(e) => setFormula(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') rollFromFormula(); }}
          placeholder="z.B. 2d6+4 — mit + / − aufbauen" spellCheck={false} style={S.formula} />
        <button style={S.rollBtn} onClick={rollFromFormula} disabled={!parseFormula(formula)}>Roll</button>
      </div>
      <div style={S.tray}>
        {dice.length === 0
          ? <span style={S.hint}>Würfel wählen oder Formel eingeben…</span>
          : use3d
            // key = roll identity → every roll remounts the scene for a fresh throw
            ? <Dice3D key={dice[0].id} dice={dice.map((d) => ({ sides: d.sides, result: d.result, faceSet: d.faceSet }))}
                onDone={() => setRevealed(true)}
                onFallback={(reason) => { setWebglBroken(reason || 'unbekannt'); }} />
            // Kein 3D (WebGL kaputt / zu viele Würfel): nur die nackten Werte.
            : <div style={S.plainRow}>{dice.map((d) => (
                <span key={d.id} style={{ ...S.plainDie, color: (d.faceSet ? DIE_COLOR[100] : DIE_COLOR[d.sides]) || 'var(--color-accent)' }}>
                  {faceText(d.faceSet, d.result)}
                </span>
              ))}</div>}
      </div>
      {webglBroken && (
        <div style={S.fallbackNote}>
          ⚠ 3D nicht verfügbar: {webglBroken}{' '}
          <button style={{ ...S.smallBtn, marginLeft: 4 }} onClick={() => setWebglBroken(null)}>Nochmal versuchen</button>
        </div>
      )}
      {/* Ergebnis erst NACH der Animation (revealed). */}
      {revealed && dice.length > 0 && (
        <div style={S.total}>
          {mode && <span style={S.modeTag}>{MODE_LABEL[mode]}</span>}
          {total != null ? <>Ergebnis: <b>{total}</b></> : <>Summe: <b>{sum}</b></>}
          {(() => {
            const bt = partTotals(roll.parts, dice.filter((d) => !d.dropped).map((d) => d.value ?? d.result), mode);
            return bt ? <div style={S.typeLine}>{bt.map((b) => `${b.total}${b.type ? ` ${b.type}` : ''}`).join(' · ')}</div> : null;
          })()}
        </div>
      )}
    </div>
  );
}

// Anzeige eines Würfelwerts (nur noch für den Zahlen-Fallback ohne 3D):
// Perzentil-Zehner zeigen 00–90, sonst der nackte Wert.
function faceText(faceSet, v) {
  if (faceSet === 'd100tens') return String(v).padStart(2, '0');
  return String(v);
}

// Mehrteilige Würfe: die natürlichen Würfel in Formel-Reihenfolge den Teilen
// zuordnen → Subtotal pro Teil, gruppiert nach Schadenstyp. Krit verdoppelt
// die Würfelzahl jedes Teils (rollFormula macht dasselbe). d100-Teile (zwei
// Würfel pro Wurf) wären mehrdeutig → dann kein Breakdown.
function partTotals(parts, nat, mode) {
  if (!Array.isArray(parts) || parts.length < 2) return null;
  let i = 0;
  const byType = new Map();
  for (const p of parts) {
    const terms = parseFormula(p.formula);
    if (!terms) return null;
    let sub = 0;
    for (const t of terms) {
      if (t.kind === 'mod') { sub += t.value; continue; }
      if (t.sides === 100) return null;
      const n = mode === 'crit' ? t.count * 2 : t.count;
      for (let k = 0; k < n; k++) sub += t.sign * (nat[i++] ?? 0);
    }
    const key = p.type || '';
    byType.set(key, (byType.get(key) || 0) + sub);
  }
  return [...byType.entries()].map(([type, total]) => ({ type, total }));
}

const DIE_COLOR = { 4: '#ef5da8', 6: '#4ade80', 8: '#38bdf8', 10: '#a78bfa', 12: '#fb923c', 20: '#facc15', 100: '#f87171' };
const MODE_LABEL = { adv: 'Vorteil', dis: 'Nachteil', crit: 'Kritisch' };

const S = {
  fab: { position: 'absolute', right: 16, bottom: 16, zIndex: 25, width: 44, height: 44, borderRadius: '50%', border: '1px solid var(--color-border)', background: 'color-mix(in srgb, var(--color-bg-elevated) 92%, transparent)', color: 'var(--color-text)', fontSize: 22, cursor: 'pointer', boxShadow: '0 4px 16px #0007' },
  wrap: { position: 'absolute', right: 16, bottom: 16, zIndex: 25, width: 362, background: 'color-mix(in srgb, var(--color-bg-elevated) 96%, transparent)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg,10px)', boxShadow: '0 8px 30px #000a', overflow: 'hidden' },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--color-border)', cursor: 'move', userSelect: 'none' },
  smallBtn: { background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '1px 7px' },
  picker: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, padding: '8px 8px 4px' },
  dieCell: { display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 3 },
  dieName: { background: 'transparent', border: 'none', color: 'var(--color-text)', cursor: 'pointer', fontWeight: 800, fontSize: 'var(--fs-sm)', padding: '2px 0' },
  pmRow: { display: 'flex', gap: 3 },
  pmBtn: { flex: 1, padding: '1px 0', background: 'var(--color-bg-sunken)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', fontWeight: 800, fontSize: 13, lineHeight: 1.1 },
  formulaRow: { display: 'flex', gap: 4, padding: '4px 8px 8px' },
  formula: { flex: 1, minWidth: 0, padding: '5px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)' },
  rollBtn: { padding: '5px 10px', background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700 },
  tray: { minHeight: 76, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', padding: 10, margin: '0 8px 8px', background: 'radial-gradient(ellipse at 50% 120%, #2a2f3a, #15171b)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', perspective: 600 },
  hint: { color: 'var(--color-text-muted)', fontSize: 11, alignSelf: 'center', margin: '0 auto' },
  plainRow: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'center', margin: '0 auto' },
  plainDie: { fontSize: 22, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' },
  total: { padding: '0 10px 10px', textAlign: 'right', fontSize: 'var(--fs-sm)' },
  typeLine: { fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 },
  modeTag: { display: 'inline-block', marginRight: 6, padding: '0 6px', borderRadius: 999, fontSize: 10, fontWeight: 800, color: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)' },
  fallbackNote: { padding: '0 10px 8px', fontSize: 10, lineHeight: 1.5, color: 'var(--color-warning,#e0af68)' },
};
