// A floating image handout window over the map: draggable by its title bar,
// resizable, with the image fit inside. Used both for the DM's "shown to all"
// handout (synced) and for a player viewing a journal entry locally.
import { useEffect, useRef, useState } from 'react';

export default function HandoutOverlay({ entry, onClose, footer, initial }) {
  const [box, setBox] = useState(() => ({
    x: initial?.x ?? Math.max(40, (window.innerWidth - 520) / 2),
    y: initial?.y ?? Math.max(40, (window.innerHeight - 460) / 2),
    w: initial?.w ?? 520, h: initial?.h ?? 460,
  }));
  const drag = useRef(null);
  useEffect(() => {
    const move = (e) => {
      const d = drag.current; if (!d) return;
      if (d.mode === 'move') setBox((b) => ({ ...b, x: e.clientX - d.dx, y: e.clientY - d.dy }));
      else setBox((b) => ({ ...b, w: Math.max(240, d.w + (e.clientX - d.sx)), h: Math.max(200, d.h + (e.clientY - d.sy)) }));
    };
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  if (!entry) return null;
  const onTitleDown = (e) => { drag.current = { mode: 'move', dx: e.clientX - box.x, dy: e.clientY - box.y }; };
  const onResizeDown = (e) => { e.stopPropagation(); drag.current = { mode: 'resize', sx: e.clientX, sy: e.clientY, w: box.w, h: box.h }; };

  return (
    <div style={{ ...S.win, left: box.x, top: box.y, width: box.w, height: box.h }}>
      <div style={S.title} onMouseDown={onTitleDown}>
        <span style={S.titleText}>📜 {entry.title || 'Handout'}</span>
        <button style={S.close} onClick={onClose} title="Schließen">×</button>
      </div>
      <div style={S.body}>
        {entry.imageUrl && <img src={entry.imageUrl} alt={entry.title || ''} style={S.img} draggable={false} />}
        {entry.body && <div style={S.text}>{entry.body}</div>}
      </div>
      {footer && <div style={S.footer}>{footer}</div>}
      <div style={S.resize} onMouseDown={onResizeDown} title="Größe ziehen" />
    </div>
  );
}

const S = {
  win: { position: 'fixed', zIndex: 3500, display: 'flex', flexDirection: 'column', background: 'var(--color-bg-elevated, #1a1d23)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg, 10px)', boxShadow: '0 10px 40px #000c', overflow: 'hidden' },
  title: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--color-border)', cursor: 'move', flexShrink: 0, background: 'var(--color-surface)' },
  titleText: { fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  close: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 },
  body: { flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 8, background: '#0008' },
  img: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6 },
  text: { alignSelf: 'stretch', fontSize: 'var(--fs-sm)', color: 'var(--color-text)', lineHeight: 1.4, whiteSpace: 'pre-wrap' },
  footer: { flexShrink: 0, padding: '6px 10px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 8, justifyContent: 'flex-end', background: 'var(--color-surface)' },
  resize: { position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'nwse-resize', background: 'linear-gradient(135deg, transparent 50%, var(--color-border) 50%)' },
};
