// Levels panel (DM). Switch the floor being viewed/edited, add floors, and
// place stairs/ladder transition fields that move a token to another floor.
// Players don't see this — their view follows their own token's floor.
import { Button } from '../../../../shared/ui';
import { useVtt, useIsDM, useActiveMap, useTool } from '../state/useVtt';
import { addLevel, setActiveLevel, setTool, setTransitionTool } from '../state/actions';
import { TRANSITION_KINDS } from '../lib/constants';

export default function LevelPanel() {
  const isDM = useIsDM();
  const map = useActiveMap();
  const tool = useTool();
  const activeLevel = useVtt((s) => s.ui.activeLevel);
  const transitionKind = useVtt((s) => s.ui.transitionKind);
  if (!isDM || !map) return null;

  const levels = map.levels || [];
  const current = activeLevel || levels[0]?.id;
  const others = levels.filter((l) => l.id !== current);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {levels.map((l) => (
          <button key={l.id} onClick={() => setActiveLevel(l.id)}
            style={{ ...S.row, ...(l.id === current ? S.active : null) }}>
            {l.id === current ? '● ' : ''}{l.name}
          </button>
        ))}
      </div>
      <Button size="sm" variant="secondary" fullWidth style={{ marginTop: 6 }} onClick={() => addLevel(map.id)}>+ Ebene</Button>

      <div style={{ borderTop: '1px solid var(--color-border)', margin: '10px 0 8px' }} />
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Treppen / Leitern</div>
      {others.length === 0 ? (
        <p style={S.muted}>Erst eine zweite Ebene anlegen.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {Object.entries(TRANSITION_KINDS).map(([k, label]) => (
              <button key={k} onClick={() => setTransitionTool(k)}
                style={{ ...S.chip, ...(tool === 'transition' && transitionKind === k ? S.active : null) }}>{label}</button>
            ))}
          </div>
          <p style={S.muted}>
            1) Feld auf ein leeres Feld setzen (wird ausgewählt). 2) Auf eine andere Ebene
            wechseln und das Ausgangsfeld anklicken — beide werden verbunden (hin & zurück).
            Mehrere Ausgänge möglich → Spieler wählt beim Betreten. Vorhandenes Feld anklicken
            = auswählen, Entf = löschen.
          </p>
          {tool === 'transition' && <Button size="sm" variant="secondary" fullWidth onClick={() => setTool('select')}>Fertig</Button>}
        </>
      )}
    </>
  );
}

const S = {
  row: { padding: '6px 10px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)', textAlign: 'left' },
  active: { border: '1px solid var(--color-accent)', color: 'var(--color-accent)' },
  chip: { flex: 1, padding: '5px 0', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  select: { width: '100%', padding: '5px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 4 },
  muted: { color: 'var(--color-text-muted)', fontSize: 11, margin: '4px 0' },
};
