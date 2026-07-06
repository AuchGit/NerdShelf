// Editor für eine ausgewählte Treppe/Leiter/Portal (DM). Benennen und mit
// anderen Feldern verbinden — Treppen/Leitern über Stockwerke, Portale auch
// auf DEMSELBEN Layer. Sind mehrere Ziele verbunden, wählt der Spieler beim
// Betreten (TransitionPrompt).
import { useVtt, useActiveMap } from '../state/useVtt';
import { updateTransition, removeTransition, selectTransition, toggleTransitionLink } from '../state/actions';
import { TRANSITION_KINDS } from '../lib/constants';

const floorLabel = (f) => (f === 0 ? 'EG' : f > 0 ? `OG ${f}` : `UG ${-f}`);

export default function TransitionEditor() {
  const id = useVtt((s) => s.ui.selectedTransitionId);
  const tr = useVtt((s) => (id ? s.transitions[id] : null));
  const all = useVtt((s) => s.transitions);
  const map = useActiveMap();
  if (!tr || !map) return null;

  const levelFloor = (lvlId) => {
    const l = (map.levels || []).find((x) => x.id === lvlId);
    return l ? (l.floor ?? 0) : 0;
  };
  const myLabel = `${tr.name || TRANSITION_KINDS[tr.kind] || 'Feld'} — ${floorLabel(levelFloor(tr.level))}`;

  // Nur Felder DERSELBEN Art verbinden (Treppe↔Treppe, Leiter↔Leiter,
  // Portal↔Portal), derselben Karte, alle Ebenen (Portale auch gleicher Layer).
  const others = Object.values(all).filter((t) => t.id !== tr.id && t.mapId === tr.mapId && t.kind === tr.kind);
  const isLinked = (o) => (tr.exits || []).some((e) => e.toLevel === o.level && e.col === o.col && e.row === o.row);

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <span style={{ fontWeight: 700 }}>🚪 {TRANSITION_KINDS[tr.kind] || 'Übergang'}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{floorLabel(levelFloor(tr.level))}</span>
      </div>
      <input value={tr.name || ''} onChange={(e) => updateTransition(tr.id, { name: e.target.value })}
        placeholder="Name (z. B. Treppenhaus)" style={S.input} />
      <div style={S.sub}>Verbinden mit — Spieler wählt bei mehreren Zielen:</div>
      <div style={S.list}>
        {others.length === 0 && <div style={S.muted}>Noch keine anderen Felder. Platziere weitere Treppen/Portale.</div>}
        {others.map((o) => (
          <label key={o.id} style={S.item}>
            <input type="checkbox" checked={isLinked(o)} onChange={() => toggleTransitionLink(tr.id, o.id)} />
            <span style={{ flex: 1 }}>{o.name || TRANSITION_KINDS[o.kind] || 'Feld'}</span>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{floorLabel(levelFloor(o.level))}</span>
          </label>
        ))}
      </div>
      <button style={S.remove} onClick={() => { removeTransition(tr.id); selectTransition(null); }}>Entfernen</button>
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>{myLabel}</div>
    </div>
  );
}

const S = {
  wrap: { minWidth: 240, maxWidth: 300, background: 'color-mix(in srgb, var(--color-bg-elevated) 96%, transparent)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg,10px)', padding: 10, boxShadow: '0 8px 30px #0009' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  input: { width: '100%', boxSizing: 'border-box', padding: '5px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 8 },
  sub: { fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 },
  list: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflowY: 'auto' },
  item: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, background: 'var(--color-surface)', fontSize: 'var(--fs-sm)', cursor: 'pointer' },
  muted: { color: 'var(--color-text-muted)', fontSize: 11, padding: '4px 0' },
  remove: { width: '100%', marginTop: 8, padding: '6px', background: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
};
