// Editor for the selected terrain object (DM): type, height, player visibility,
// move (grid steps), toggle individual perimeter edges (open passages for
// future climb/movement), and delete. Shown top-center while a terrain object
// is selected (click its cells with the Auswahl tool).
import { Panel, Button } from '../../../../shared/ui';
import { useVtt, useIsDM, useActiveMap } from '../state/useVtt';
import { updateTerrain, removeTerrain, moveTerrain, setTerrainEdgeEdit, selectTerrain } from '../state/actions';

export default function TerrainEditor() {
  const isDM = useIsDM();
  const id = useVtt((s) => s.ui.selectedTerrainId);
  const edgeEdit = useVtt((s) => s.ui.terrainEdgeEdit);
  const map = useActiveMap();
  const obj = id ? (map?.terrain || []).find((t) => t.id === id && Array.isArray(t.cells)) : null;
  if (!isDM || !obj) return null;

  return (
    <Panel padding="sm">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>Gelände ({obj.cells.length} Felder)</span>
        <span style={{ cursor: 'pointer', color: 'var(--color-text-muted)' }} onClick={() => selectTerrain(null)}>✕</span>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button style={{ ...S.chip, ...(obj.kind === 'climb' ? S.active : null) }} onClick={() => updateTerrain(id, { kind: 'climb' })}>⛰ Klettern</button>
        <button style={{ ...S.chip, ...(obj.kind === 'difficult' ? S.active : null) }} onClick={() => updateTerrain(id, { kind: 'difficult', ft: 0 })}>▦ Schwierig</button>
      </div>

      {obj.kind === 'climb' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>Höhe</span>
          <button style={S.chip} onClick={() => updateTerrain(id, { ft: (obj.ft || 0) - 5 })}>−</button>
          <b style={{ minWidth: 48, textAlign: 'center' }}>{obj.ft > 0 ? '+' : ''}{obj.ft || 0} ft</b>
          <button style={S.chip} onClick={() => updateTerrain(id, { ft: (obj.ft || 0) + 5 })}>+</button>
        </div>
      )}

      <label style={S.check}>
        <input type="checkbox" checked={obj.visible !== false} onChange={(e) => updateTerrain(id, { visible: e.target.checked })} />
        Für Spieler sichtbar
      </label>

      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', margin: '8px 0 4px' }}>Verschieben</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 28px)', gap: 3, justifyContent: 'center' }}>
        <span />
        <button style={S.chip} onClick={() => moveTerrain(id, 0, -1)}>▲</button>
        <span />
        <button style={S.chip} onClick={() => moveTerrain(id, -1, 0)}>◀</button>
        <span />
        <button style={S.chip} onClick={() => moveTerrain(id, 1, 0)}>▶</button>
        <span />
        <button style={S.chip} onClick={() => moveTerrain(id, 0, 1)}>▼</button>
        <span />
      </div>

      <button style={{ ...S.edge, ...(edgeEdit ? S.active : null) }} onClick={() => setTerrainEdgeEdit(!edgeEdit)}>
        {edgeEdit ? '✓ Kanten-Modus aktiv' : '✎ Kanten bearbeiten'}
      </button>
      {edgeEdit && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>Klicke einen Außenrand, um ihn zu öffnen/schließen (grün = offen, z.B. Leiter/Treppe).</div>}

      <Button size="sm" variant="danger" fullWidth style={{ marginTop: 10 }} onClick={() => removeTerrain(id)}>Gelände löschen</Button>
    </Panel>
  );
}

const S = {
  chip: { padding: '5px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  active: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: '1px solid var(--color-accent)' },
  check: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)' },
  edge: { width: '100%', marginTop: 10, padding: '6px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
};
