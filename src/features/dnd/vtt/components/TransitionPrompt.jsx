// Shown when a token steps on a transition field with several exits — the
// player picks where to come out. (One-exit fields travel automatically.)
import { Panel, Button } from '../../../../shared/ui';
import { useVtt, useActiveMap } from '../state/useVtt';
import { travelToken } from '../state/actions';

export default function TransitionPrompt({ tokenId, transitionId, onClose }) {
  const tr = useVtt((s) => s.transitions[transitionId]);
  const all = useVtt((s) => s.transitions);
  const map = useActiveMap();
  if (!tr || !map) return null;
  const floorLabel = (id) => {
    const l = (map.levels || []).find((x) => x.id === id);
    const f = l ? (l.floor ?? 0) : 0;
    return f === 0 ? 'EG' : f > 0 ? `OG ${f}` : `UG ${-f}`;
  };
  // Zielname aus dem verbundenen Feld (falls es dort eins gibt), sonst Ebene.
  const exitLabel = (ex) => {
    const target = Object.values(all).find((t) => t.mapId === tr.mapId && (t.level || null) === ex.toLevel && t.col === ex.col && t.row === ex.row);
    const nm = target?.name || (map.levels || []).find((l) => l.id === ex.toLevel)?.name || 'Ziel';
    return `${nm} — ${floorLabel(ex.toLevel)}`;
  };

  return (
    <div style={S.backdrop} onClick={onClose}>
      <Panel padding="md" style={{ minWidth: 220 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Wohin{tr.name ? ` von „${tr.name}"` : ''}?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(tr.exits || []).map((ex, i) => (
            <Button key={i} fullWidth onClick={() => { travelToken(tokenId, ex, map.grid); onClose(); }}>
              → {exitLabel(ex)}
            </Button>
          ))}
        </div>
        <Button variant="ghost" size="sm" fullWidth style={{ marginTop: 8 }} onClick={onClose}>Abbrechen</Button>
      </Panel>
    </div>
  );
}

const S = {
  backdrop: { position: 'fixed', inset: 0, background: '#0008', display: 'grid', placeItems: 'center', zIndex: 1100 },
};
