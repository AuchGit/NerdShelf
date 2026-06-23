// Tool palette. Drives store.ui.tool which the renderer reads to decide what a
// canvas click does. Zone tool expands to a shape + color picker.
import { useTool, useVtt } from '../state/useVtt';
import { setTool, setZoneTool, setWallTool, setFogBrush, setFogErase } from '../state/actions';
import { ZONE_TYPES, ZONE_COLORS, WALL_TYPES } from '../lib/constants';
import Icon from './Icon';

// `iconSrc` points at public/Assets/vtt/*.svg; until a file exists the emoji
// fallback shows (see Icon.jsx).
const TOOLS = [
  { id: 'select', label: 'Auswahl', icon: '🖱', iconSrc: '/Assets/vtt/select.svg', hint: 'Auswählen & Tokens ziehen (Shift = frei) · WASD bewegt feldweise' },
  { id: 'ruler', label: 'Messen', icon: '📏', iconSrc: '/Assets/vtt/ruler.svg', hint: 'Distanz in ft messen' },
  { id: 'ping', label: 'Ping', icon: '📍', iconSrc: '/Assets/vtt/ping.svg', hint: 'Stelle markieren (auch Alt+Klick)' },
  { id: 'fog', label: 'Fog', icon: '🌫', iconSrc: '/Assets/vtt/fog.svg', hint: 'Aufdecken (DM) — Kreis-Pinsel: klicken/ziehen zum Malen', dmOnly: true },
  { id: 'walls', label: 'Wände', icon: '🧱', iconSrc: '/Assets/vtt/wall.svg', hint: 'Wände: klicken für Eckpunkte (zusammenhängend) · Rechtsklick/Esc/Enter beendet · Shift = frei', dmOnly: true },
  { id: 'light', label: 'Licht', icon: '💡', iconSrc: '/Assets/vtt/light.svg', hint: 'Lichtquelle setzen (klicken). Auswählen/verschieben/bearbeiten nur in diesem Tool; Spieler sehen nur den Schein.', dmOnly: true },
  { id: 'terrain', label: 'Gelände', icon: '⛰', iconSrc: '/Assets/vtt/terrain.svg', hint: 'Felder wählen (Box ziehen, Shift erweitert / Shift-Klick einzeln) und Höhe (Klettern) oder schwieriges Gelände zuweisen.', dmOnly: true },
];

const ZONE_SRC = { circle: '/Assets/vtt/zone-circle.svg', cone: '/Assets/vtt/zone-cone.svg', line: '/Assets/vtt/zone-line.svg', square: '/Assets/vtt/zone-square.svg' };

export default function Toolbar() {
  const tool = useTool();
  const isDM = useVtt((s) => s.session.role === 'dm');
  const zoneType = useVtt((s) => s.ui.zoneType);
  const zoneColor = useVtt((s) => s.ui.zoneColor);
  const wallKind = useVtt((s) => s.ui.wallKind);
  const fogErase = useVtt((s) => s.ui.fogErase);
  const fogBrush = useVtt((s) => s.ui.fogBrushCells);

  return (
    <div style={S.bar}>
      {TOOLS.filter((t) => !t.dmOnly || isDM).map((t) => (
        <button
          key={t.id}
          title={t.hint}
          onClick={() => setTool(t.id)}
          style={{ ...S.btn, ...(tool === t.id ? S.active : null) }}
        >
          <Icon src={t.iconSrc} emoji={t.icon} size={16} /> {t.label}
        </button>
      ))}

      <div style={S.sep} />
      <span style={S.muted}>Zone:</span>
      {Object.entries(ZONE_TYPES).map(([id, z]) => (
        <button
          key={id}
          title={z.label}
          onClick={() => setZoneTool(id)}
          style={{ ...S.btn, ...(tool === 'zone' && zoneType === id ? S.active : null) }}
        >
          <Icon src={ZONE_SRC[id]} emoji={ZONE_ICON[id]} size={14} /> {z.label.split(' ')[0]}
        </button>
      ))}
      <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
        {ZONE_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setZoneTool(zoneType, c)}
            title={c}
            style={{ width: 18, height: 18, borderRadius: 4, background: c, border: zoneColor === c ? '2px solid #fff' : '1px solid #0008', cursor: 'pointer' }}
          />
        ))}
      </div>

      {isDM && tool === 'fog' && (
        <>
          <div style={S.sep} />
          <span style={S.muted}>Fog:</span>
          <button onClick={() => setFogErase(false)} style={{ ...S.btn, ...(!fogErase ? S.active : null) }} title="Aufdecken (Fog entfernen)"><Icon src="/Assets/vtt/fog-reveal.svg" emoji="☀" size={14} /> Aufdecken</button>
          <button onClick={() => setFogErase(true)} style={{ ...S.btn, ...(fogErase ? S.active : null) }} title="Verbergen (Fog malen)"><Icon src="/Assets/vtt/fog-hide.svg" emoji="🌑" size={14} /> Verbergen</button>
          <span style={S.muted}>Größe</span>
          <input
            type="range" min="0.5" max="6" step="0.5"
            value={fogBrush ?? 1.5}
            onChange={(e) => setFogBrush(+e.target.value)}
            style={{ width: 90 }}
            title={`Pinselgröße: ${fogBrush ?? 1.5} Felder`}
          />
        </>
      )}

      {isDM && tool === 'walls' && (
        <>
          <div style={S.sep} />
          <span style={S.muted}>Wandtyp:</span>
          {Object.entries(WALL_TYPES).map(([id, w]) => (
            <button key={id} onClick={() => setWallTool(id)}
              style={{ ...S.btn, ...(wallKind === id ? S.active : null) }}>
              <span style={{ width: 12, height: 12, borderRadius: 2, background: w.color, display: 'inline-block' }} /> {w.label}
            </button>
          ))}
          {wallKind === 'door' && (
            <span style={S.muted}>Tür: zwei Klicks (auf Gitterpunkte) · Größe per Endpunkte/Kontextmenü</span>
          )}
        </>
      )}
    </div>
  );
}

const ZONE_ICON = { circle: '⭕', cone: '🔺', line: '➖', square: '⬛' };

const S = {
  bar: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-elevated)', flexWrap: 'wrap' },
  btn: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  active: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: '1px solid var(--color-accent)' },
  sep: { width: 1, height: 22, background: 'var(--color-border)', margin: '0 4px' },
  muted: { color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' },
};
