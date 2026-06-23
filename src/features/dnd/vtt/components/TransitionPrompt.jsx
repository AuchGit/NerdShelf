// Shown when a token steps on a transition field with several exits — the
// player picks where to come out. (One-exit fields travel automatically.)
import { Panel, Button } from '../../../../shared/ui';
import { useVtt, useActiveMap } from '../state/useVtt';
import { travelToken } from '../state/actions';

export default function TransitionPrompt({ tokenId, transitionId, onClose }) {
  const tr = useVtt((s) => s.transitions[transitionId]);
  const map = useActiveMap();
  if (!tr || !map) return null;
  const levelName = (id) => (map.levels || []).find((l) => l.id === id)?.name || id;

  return (
    <div style={S.backdrop} onClick={onClose}>
      <Panel padding="md" style={{ minWidth: 220 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Wohin?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(tr.exits || []).map((ex, i) => (
            <Button key={i} fullWidth onClick={() => { travelToken(tokenId, ex, map.grid); onClose(); }}>
              → {levelName(ex.toLevel)} (Feld {ex.col}, {ex.row})
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
