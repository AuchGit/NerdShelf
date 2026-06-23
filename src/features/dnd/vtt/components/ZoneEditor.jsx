// Editor panel for the currently selected zone/template. Precise numeric edit
// of size + direction, color, opacity, and delete. Complements the on-canvas
// drag-move + resize/rotate handles. Shown in the sidebar when a zone is
// selected (click a zone with the Auswahl tool).
import { Panel, Button } from '../../../../shared/ui';
import { useVtt } from '../state/useVtt';
import { updateZone, removeZone, selectZone } from '../state/actions';
import { ZONE_TYPES, ZONE_COLORS } from '../lib/constants';

export default function ZoneEditor() {
  const id = useVtt((s) => s.ui.selectedZoneId);
  const zone = useVtt((s) => (id ? s.zones[id] : null));
  if (!zone) return null;

  const p = zone.params || {};
  const setParam = (k, v) => updateZone(id, { params: { ...p, [k]: v } });

  return (
    <Panel padding="sm">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>{ZONE_TYPES[zone.type]?.label || 'Form'}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>WASD/Drag · Entf löscht</span>
      </div>

      {zone.type === 'circle' && <Num label="Radius (ft)" value={p.radiusFt} onChange={(v) => setParam('radiusFt', v)} />}
      {zone.type === 'square' && <Num label="Seite (ft)" value={p.sideFt} onChange={(v) => setParam('sideFt', v)} />}
      {zone.type === 'cone' && (
        <>
          <Num label="Länge (ft)" value={p.lengthFt} onChange={(v) => setParam('lengthFt', v)} />
          <Num label="Richtung (°)" value={Math.round(p.directionDeg)} step={5} onChange={(v) => setParam('directionDeg', v)} />
        </>
      )}
      {zone.type === 'line' && (
        <>
          <Num label="Länge (ft)" value={p.lengthFt} onChange={(v) => setParam('lengthFt', v)} />
          <Num label="Breite (ft)" value={p.widthFt} onChange={(v) => setParam('widthFt', v)} />
          <Num label="Richtung (°)" value={Math.round(p.directionDeg)} step={5} onChange={(v) => setParam('directionDeg', v)} />
        </>
      )}

      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', margin: '6px 0 4px' }}>Farbe</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {ZONE_COLORS.map((c) => (
          <button key={c} onClick={() => updateZone(id, { color: c })} title={c}
            style={{ width: 20, height: 20, borderRadius: 4, background: c, border: zone.color === c ? '2px solid #fff' : '1px solid #0008', cursor: 'pointer' }} />
        ))}
      </div>

      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', margin: '8px 0 2px' }}>
        Deckkraft ({Math.round((zone.opacity ?? 0.3) * 100)}%)
      </div>
      <input type="range" min="0.05" max="0.8" step="0.05" value={zone.opacity ?? 0.3}
        onChange={(e) => updateZone(id, { opacity: +e.target.value })} style={{ width: '100%' }} />

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', marginTop: 10 }}
        title="Form an Sichtwänden abschneiden (z. B. Feuerball hört an der Wand auf)">
        <input type="checkbox" checked={zone.losWalls !== false}
          onChange={(e) => updateZone(id, { losWalls: e.target.checked })} />
        Sichtwände beachten
      </label>

      <Button size="sm" variant="danger" fullWidth style={{ marginTop: 10 }}
        onClick={() => { removeZone(id); selectZone(null); }}>Form löschen</Button>
    </Panel>
  );
}

function Num({ label, value, step = 5, onChange }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', marginBottom: 3 }}>{label}</div>
      <input
        type="number" value={value ?? 0} step={step}
        onChange={(e) => onChange(+e.target.value)}
        style={{ width: '100%', padding: '5px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
      />
    </div>
  );
}
