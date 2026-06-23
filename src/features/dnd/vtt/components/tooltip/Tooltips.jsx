// Pinnable tooltips for the VTT.
//
// Wrap any element in <Pinnable title render>…</Pinnable>: hovering shows a
// detailed floating card; RIGHT-CLICK pins that card as a draggable, closable
// overlay so a player can keep several reference cards open while they play.
//
// One <TooltipProvider> wraps the VTT and one <TooltipLayer/> renders the hover
// card + all pinned cards above everything. State is purely client-side UI
// (never synced) and lives here, not in the shared VTT store.
import { useState, useCallback, useRef, useEffect } from 'react';
import { TooltipCtx, useTooltips } from './tooltipContext';

// eslint-disable-next-line react-refresh/only-export-components
export { useTooltips };

export function TooltipProvider({ children }) {
  const [hover, setHover] = useState(null); // { title, render, rect }
  const [pins, setPins] = useState([]);     // [{ id, title, render, x, y }]
  const show = useCallback((data) => setHover(data), []);
  const hide = useCallback(() => setHover(null), []);
  const pin = useCallback((data, x, y) => {
    setHover(null);
    setPins((p) => [...p, { id: 'tip_' + Math.random().toString(36).slice(2, 8), ...data, x, y }]);
  }, []);
  const closePin = useCallback((id) => setPins((p) => p.filter((t) => t.id !== id)), []);
  const movePin = useCallback((id, x, y) => setPins((p) => p.map((t) => (t.id === id ? { ...t, x, y } : t))), []);
  return <TooltipCtx.Provider value={{ show, hide, pin, closePin, movePin, hover, pins }}>{children}</TooltipCtx.Provider>;
}

// Attach hover + right-click-to-pin to any element. `render` is a function
// returning the card body JSX (lazy, so it only builds when shown).
export function Pinnable({ title, render, children, as = 'span', style, className }) {
  const tt = useTooltips();
  if (!tt) return children;
  const onMove = (e) => tt.show({ title, render, x: e.clientX, y: e.clientY });
  const onLeave = () => tt.hide();
  const onContextMenu = (e) => { e.preventDefault(); e.stopPropagation(); tt.pin({ title, render }, e.clientX, e.clientY); };
  const Tag = as;
  return <Tag style={{ display: 'contents', ...style }} className={className} onMouseEnter={onMove} onMouseMove={onMove} onMouseLeave={onLeave} onContextMenu={onContextMenu}>{children}</Tag>;
}

export function TooltipLayer() {
  const tt = useTooltips();
  if (!tt) return null;
  return (
    <>
      {tt.hover && <HoverCard hover={tt.hover} />}
      {tt.pins.map((p) => <PinnedCard key={p.id} pin={p} onClose={() => tt.closePin(p.id)} onMove={tt.movePin} />)}
    </>
  );
}

// Hover card: anchored near the cursor, never interactive.
function HoverCard({ hover }) {
  const W = 320;
  const left = Math.max(12, Math.min((hover.x || 0) + 14, window.innerWidth - W - 12));
  const nearBottom = (hover.y || 0) + 300 > window.innerHeight;
  const top = nearBottom ? undefined : (hover.y || 0) + 16;
  const bottom = nearBottom ? (window.innerHeight - (hover.y || 0) + 16) : undefined;
  return (
    <div style={{ ...S.card, left, top, bottom, width: W, pointerEvents: 'none', maxHeight: 280, overflow: 'hidden' }}>
      <div style={S.head}><span style={S.title}>{hover.title}</span></div>
      <div style={S.body}>{hover.render?.()}</div>
      <div style={S.hint}>Rechtsklick: anheften</div>
    </div>
  );
}

// Pinned card: draggable by its header, closable, scrollable body.
function PinnedCard({ pin, onClose, onMove }) {
  const drag = useRef(null);
  useEffect(() => {
    const move = (e) => { const d = drag.current; if (!d) return; onMove(pin.id, e.clientX - d.dx, e.clientY - d.dy); };
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [pin.id, onMove]);
  const onDown = (e) => { drag.current = { dx: e.clientX - pin.x, dy: e.clientY - pin.y }; };
  const left = Math.max(8, Math.min(pin.x, window.innerWidth - 332));
  const top = Math.max(8, Math.min(pin.y, window.innerHeight - 80));
  return (
    <div style={{ ...S.card, left, top, width: 320, maxHeight: '60vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ ...S.head, cursor: 'move' }} onMouseDown={onDown}>
        <span style={S.title}>{pin.title}</span>
        <button style={S.close} onClick={onClose} title="Schließen">×</button>
      </div>
      <div style={{ ...S.body, overflowY: 'auto' }}>{pin.render?.()}</div>
    </div>
  );
}

const S = {
  card: { position: 'fixed', zIndex: 4000, background: 'var(--color-bg-elevated, #1a1d23)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg, 10px)', boxShadow: '0 8px 30px #000b', fontSize: 'var(--fs-sm)', color: 'var(--color-text)' },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--color-border)' },
  title: { fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  body: { padding: '8px 10px', lineHeight: 1.4 },
  hint: { padding: '3px 10px 6px', fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 },
  close: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 },
};
