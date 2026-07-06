// Schwebendes, VERSCHIEBBARES Dock für die Objekt-Editoren (Zone/Wand/Licht/
// Terrain). Per Kopfzeile ziehen, mit ✕ schließen (hebt die Auswahl auf).
// Es wird immer nur der Editor des gerade ausgewählten Objekts angezeigt.
import { useEffect, useRef, useState } from 'react';
import { clearObjectSelection } from '../state/actions';
import ZoneEditor from './ZoneEditor';
import WallEditor from './WallEditor';
import LightEditor from './LightEditor';
import TerrainEditor from './TerrainEditor';

export default function ContextEditorDock() {
  const [pos, setPos] = useState(null);
  const dragRef = useRef(null);

  useEffect(() => {
    const move = (e) => { if (dragRef.current) setPos({ x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy }); };
    const up = () => { dragRef.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') clearObjectSelection(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const startDrag = (e) => {
    const base = pos || { x: window.innerWidth / 2 - 150, y: 96 };
    if (!pos) setPos(base);
    dragRef.current = { dx: e.clientX - base.x, dy: e.clientY - base.y };
  };
  const style = pos ? { ...S.wrap, left: pos.x, top: pos.y } : { ...S.wrap, left: '50%', top: 96, transform: 'translateX(-50%)' };

  return (
    <div style={style}>
      <div style={S.head} onMouseDown={startDrag} title="Ziehen zum Verschieben">
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Bearbeiten</span>
        <span style={S.x} onMouseDown={(e) => e.stopPropagation()} onClick={() => clearObjectSelection()} title="Schließen (Esc)">✕</span>
      </div>
      <div style={S.body}>
        <ZoneEditor />
        <WallEditor />
        <LightEditor />
        <TerrainEditor />
      </div>
    </div>
  );
}

const S = {
  wrap: { position: 'absolute', zIndex: 60, minWidth: 260, maxWidth: 340, background: 'color-mix(in srgb, var(--color-bg-elevated) 97%, transparent)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg,10px)', boxShadow: '0 10px 34px #000a', overflow: 'hidden' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--color-border)', cursor: 'move', userSelect: 'none', background: 'var(--color-surface)' },
  x: { cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 14, padding: '0 4px' },
  body: { padding: 10 },
};
