// Editor for the selected light source (DM, light tool). Tune bright/dim radius
// (ft), color and on/off, or remove it. Shown at top-center while a light is
// selected; drag the light's marker on the map to move it.
import { Panel } from '../../../../shared/ui';
import { useVtt } from '../state/useVtt';
import { updateLight, removeLight, selectLight } from '../state/actions';
import { LIGHT_ICONS } from '../lib/constants';

export default function LightEditor() {
  const id = useVtt((s) => s.ui.selectedLightId);
  const light = useVtt((s) => (id ? s.lights[id] : null));
  if (!light) return null;

  const set = (patch) => updateLight(id, patch);
  return (
    <Panel padding="sm">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>💡 Lichtquelle</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
          <input type="checkbox" checked={light.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} /> an
        </label>
      </div>
      <Row label={`Hell (${light.brightFt} ft)`}>
        <input type="range" min="0" max="120" step="5" value={light.brightFt} onChange={(e) => set({ brightFt: +e.target.value })} style={{ width: '100%' }} />
      </Row>
      <Row label={`Dämmer (${light.dimFt} ft)`}>
        <input type="range" min="0" max="120" step="5" value={light.dimFt} onChange={(e) => set({ dimFt: +e.target.value })} style={{ width: '100%' }} />
      </Row>
      <Row label="Farbe">
        <input type="color" value={light.color || '#ffd9a0'} onChange={(e) => set({ color: e.target.value })} style={{ width: 40, height: 28, background: 'none', border: 'none', cursor: 'pointer' }} />
      </Row>
      <Row label={`Höhe (${light.heightFt || 0} ft) — scheint über niedrigere Wände`}>
        <input type="range" min="0" max="60" step="5" value={light.heightFt || 0} onChange={(e) => set({ heightFt: +e.target.value })} style={{ width: '100%' }} />
      </Row>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', marginBottom: 8 }}
        title="Zeigt einen Lichtschalter auf der Karte, den Spieler anklicken können, um dieses Licht an/aus zu schalten.">
        <input type="checkbox" checked={!!light.playerSwitch} onChange={(e) => set({ playerSwitch: e.target.checked })} />
        Spieler dürfen schalten (Lichtschalter)
      </label>
      <Row label="Symbol (auf Schalter / Marker)">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {Object.entries(LIGHT_ICONS).map(([key, ic]) => {
            const active = (light.icon || '') === ic.src || (key === '' && !light.icon);
            return (
              <button key={key} title={ic.label} onClick={() => set({ icon: key === '' ? null : ic.src })}
                style={{ ...S.iconBtn, ...(active ? S.iconActive : null) }}>
                <img src={ic.src} alt={ic.label} style={{ width: 18, height: 18, objectFit: 'contain' }} />
              </button>
            );
          })}
        </div>
      </Row>
      <button style={S.remove} onClick={() => { removeLight(id); selectLight(null); }}>Licht entfernen</button>
    </Panel>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  );
}

const S = {
  remove: { width: '100%', marginTop: 4, padding: '6px', background: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  iconBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, padding: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' },
  iconActive: { border: '1px solid var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)' },
};
