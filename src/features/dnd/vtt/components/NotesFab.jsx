// Notes FAB — a small button next to the dice button (bottom-right) that opens
// the player's character notes as an overlay (mirrors the dice tray pattern,
// inkl. Verschieben per Kopfzeile — Position bleibt in localStorage erhalten).
// Debounced save through applyOwnCharacter so it syncs like the sheet.
import { useEffect, useRef, useState } from 'react';
import { useVtt } from '../state/useVtt';
import { applyOwnCharacter } from '../sync/characterBinding';

const POS_KEY = 'nerdshelf:vttNotesPos';

function setPath(obj, path, value) {
  const keys = path.split('.'); let o = obj;
  for (let i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = value;
}

// Position IMMER im sichtbaren Bereich halten: eine auf dem 2K-Monitor
// gespeicherte Position lag auf 1080p AUSSERHALB des Screens — das Fenster
// (inkl. Würfelanimation) war dann unsichtbar. Clamp bei Laden, Ziehen und
// Fenster-Resize; mindestens die Kopfzeile bleibt greifbar.
function clampPos(p) {
  if (!p) return p;
  const W = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const H = typeof window !== 'undefined' ? window.innerHeight : 800;
  return { x: Math.max(0, Math.min(p.x, W - 90)), y: Math.max(0, Math.min(p.y, H - 60)) };
}

export default function NotesFab() {
  const myId = useVtt((s) => s.ui.myCharacterId);
  const chars = useVtt((s) => s.ui.characters || {});
  const character = myId != null ? chars[myId]?.data : null;
  const [open, setOpen] = useState(false);
  const [v, setV] = useState('');
  const t = useRef(null);
  // Verschieben per Kopfzeile (wie der Würfeltray); null = Default unten rechts.
  const [pos, setPos] = useState(() => {
    try { return clampPos(JSON.parse(localStorage.getItem(POS_KEY))) || null; } catch { return null; }
  });
  const drag = useRef(null);

  useEffect(() => () => clearTimeout(t.current), []);
  useEffect(() => {
    const move = (e) => { const d = drag.current; if (!d) return; setPos(clampPos({ x: e.clientX - d.dx, y: e.clientY - d.dy })); };
    const up = () => { drag.current = null; };
    const onResize = () => setPos((p) => clampPos(p));
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); window.removeEventListener('resize', onResize); };
  }, []);
  useEffect(() => { if (pos) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ } } }, [pos]);
  if (myId == null || !character) return null;

  // Refresh the draft from the latest saved notes each time the panel opens.
  const openPanel = () => { setV(character?.personality?.notes || ''); setOpen(true); };

  const onChange = (e) => {
    const val = e.target.value;
    setV(val);
    clearTimeout(t.current);
    t.current = setTimeout(() => applyOwnCharacter(myId, (d) => setPath(d, 'personality.notes', val)), 500);
  };

  const onHeadDown = (e) => {
    const r = e.currentTarget.parentElement.getBoundingClientRect();
    const base = pos || { x: r.left, y: r.top };
    if (!pos) setPos(base);
    drag.current = { dx: e.clientX - base.x, dy: e.clientY - base.y };
  };

  if (!open) return <button style={S.fab} onClick={openPanel} title="Notizen">📝</button>;
  const style = pos ? { ...S.wrap, left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : S.wrap;
  return (
    <div style={style}>
      <div style={S.head} onMouseDown={onHeadDown} title="Ziehen zum Verschieben">
        <span style={{ fontWeight: 700 }}>📝 Notizen</span>
        <button style={S.x} onMouseDown={(e) => e.stopPropagation()} onClick={() => setOpen(false)}>×</button>
      </div>
      <textarea value={v} onChange={onChange} placeholder="Notizen…" style={S.area} />
    </div>
  );
}

const S = {
  // Sits just left of the dice FAB (which is right:16, 44px wide).
  fab: { position: 'absolute', right: 68, bottom: 16, zIndex: 25, width: 44, height: 44, borderRadius: '50%', border: '1px solid var(--color-border)', background: 'color-mix(in srgb, var(--color-bg-elevated) 92%, transparent)', color: 'var(--color-text)', fontSize: 20, cursor: 'pointer', boxShadow: '0 4px 16px #0007' },
  wrap: { position: 'absolute', right: 68, bottom: 16, zIndex: 26, width: 300, background: 'color-mix(in srgb, var(--color-bg-elevated) 96%, transparent)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg,10px)', boxShadow: '0 8px 30px #000a', overflow: 'hidden' },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--color-border)', cursor: 'move', userSelect: 'none' },
  x: { background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 16 },
  area: { width: '100%', boxSizing: 'border-box', minHeight: 180, resize: 'vertical', background: 'var(--color-surface)', color: 'var(--color-text)', border: 'none', padding: '8px 10px', fontFamily: 'inherit', fontSize: 'var(--fs-sm)', lineHeight: 1.4, outline: 'none' },
};
