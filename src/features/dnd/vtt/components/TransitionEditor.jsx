// Editor für eine ausgewählte Treppe/Leiter/Portal (DM). Eigenes SCHWEBENDES
// Fenster: per Kopfzeile verschiebbar, mit ✕ schließbar (hebt die Auswahl auf)
// und durch erneutes Anklicken des Feldes auf der Karte wieder öffenbar.
// Benennen + mit anderen Feldern GLEICHER Art verbinden (Treppe↔Treppe,
// Leiter↔Leiter, Portal↔Portal). Portale verbinden auch auf demselben Layer.
// Mehrere Ziele → der Spieler wählt beim Betreten (TransitionPrompt).
import { useEffect, useRef, useState } from 'react';
import { useVtt, useActiveMap } from '../state/useVtt';
import { updateTransition, removeTransition, selectTransition, toggleTransitionLink } from '../state/actions';
import { TRANSITION_KINDS } from '../lib/constants';

const floorLabel = (f) => (f === 0 ? 'EG' : f > 0 ? `OG ${f}` : `UG ${-f}`);

export default function TransitionEditor() {
  const id = useVtt((s) => s.ui.selectedTransitionId);
  const tr = useVtt((s) => (id ? s.transitions[id] : null));
  const all = useVtt((s) => s.transitions);
  const map = useActiveMap();
  const [pos, setPos] = useState(null); // erste Öffnung → default-Position
  const dragRef = useRef(null);

  useEffect(() => {
    const move = (e) => { if (dragRef.current) setPos({ x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy }); };
    const up = () => { dragRef.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && id) selectTransition(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);

  if (!tr || !map) return null;

  const levelFloor = (lvlId) => {
    const l = (map.levels || []).find((x) => x.id === lvlId);
    return l ? (l.floor ?? 0) : 0;
  };
  // Nur Felder DERSELBEN Art, derselben Karte, alle Ebenen (Portale auch gleich).
  const others = Object.values(all).filter((t) => t.id !== tr.id && t.mapId === tr.mapId && t.kind === tr.kind);
  const isLinked = (o) => (tr.exits || []).some((e) => e.toLevel === o.level && e.col === o.col && e.row === o.row);

  const startDrag = (e) => {
    const base = pos || { x: window.innerWidth / 2 - 140, y: 96 };
    if (!pos) setPos(base);
    dragRef.current = { dx: e.clientX - base.x, dy: e.clientY - base.y };
  };
  const style = pos
    ? { ...S.wrap, left: pos.x, top: pos.y }
    : { ...S.wrap, left: '50%', top: 96, transform: 'translateX(-50%)' };

  return (
    <div style={style}>
      <div style={S.head} onMouseDown={startDrag} title="Ziehen zum Verschieben">
        <span style={{ fontWeight: 700 }}>🚪 {TRANSITION_KINDS[tr.kind] || 'Übergang'} · {floorLabel(levelFloor(tr.level))}</span>
        <span style={S.x} onMouseDown={(e) => e.stopPropagation()} onClick={() => selectTransition(null)} title="Schließen (Feld erneut anklicken öffnet wieder)">✕</span>
      </div>
      <div style={S.body}>
        <input value={tr.name || ''} onChange={(e) => updateTransition(tr.id, { name: e.target.value })}
          placeholder="Name (z. B. Treppenhaus)" style={S.input} />
        <div style={S.sub}>Verbinden mit — Spieler wählt bei mehreren Zielen:</div>
        <div style={S.list}>
          {others.length === 0 && <div style={S.muted}>Noch keine anderen {TRANSITION_KINDS[tr.kind]}-Felder. Platziere weitere.</div>}
          {others.map((o) => (
            <label key={o.id} style={S.item}>
              <input type="checkbox" checked={isLinked(o)} onChange={() => toggleTransitionLink(tr.id, o.id)} />
              <span style={{ flex: 1 }}>{o.name || TRANSITION_KINDS[o.kind] || 'Feld'}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{floorLabel(levelFloor(o.level))}</span>
            </label>
          ))}
        </div>
        <button style={S.remove} onClick={() => { removeTransition(tr.id); selectTransition(null); }}>Entfernen</button>
      </div>
    </div>
  );
}

const S = {
  wrap: { position: 'absolute', zIndex: 60, minWidth: 250, maxWidth: 320, background: 'color-mix(in srgb, var(--color-bg-elevated) 97%, transparent)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg,10px)', boxShadow: '0 10px 34px #000a', overflow: 'hidden' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--color-border)', cursor: 'move', userSelect: 'none', background: 'var(--color-surface)' },
  x: { cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 14, padding: '0 4px' },
  body: { padding: 10 },
  input: { width: '100%', boxSizing: 'border-box', padding: '5px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 8 },
  sub: { fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 },
  list: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 220, overflowY: 'auto' },
  item: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, background: 'var(--color-surface)', fontSize: 'var(--fs-sm)', cursor: 'pointer' },
  muted: { color: 'var(--color-text-muted)', fontSize: 11, padding: '4px 0' },
  remove: { width: '100%', marginTop: 8, padding: '6px', background: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
};
