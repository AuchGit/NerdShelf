// Contextual settings for the active DM tool, shown in the DM bottom bar while
// any tool other than "select" is active (replacing the party-passives view).
// The Toolbar stays a pure tool PICKER; everything tool-specific lives here.
import { useVtt } from '../state/useVtt';
import {
  setZoneTool, setZoneParam, setWallTool, setDoorDouble, setFogBrush, setFogErase, setFogMode,
  setLightMode, setDarkBrush, setLightDefaults, setTransitionTool, updateMap, clearDarkness,
  setTerrainKind, setTerrainHeight, setTerrainVisible, commitTerrain, eraseTerrainCells, clearTerrainSelection,
} from '../state/actions';
import { ZONE_TYPES, ZONE_COLORS, WALL_TYPES, LIGHT_PRESETS, FOG_MODES } from '../lib/constants';

const PARAM_LABEL = { radiusFt: 'Radius', sideFt: 'Seite', lengthFt: 'Länge', widthFt: 'Breite' };
import Icon from './Icon';

const ZONE_SRC = { circle: '/Assets/vtt/zone-circle.svg', cone: '/Assets/vtt/zone-cone.svg', line: '/Assets/vtt/zone-line.svg', square: '/Assets/vtt/zone-square.svg' };
const ZONE_ICON = { circle: '⭕', cone: '🔺', line: '➖', square: '⬛' };
// Typical light-glow colours for quick selection (torch, candle, daylight,
// moonlight, arcane, fel-green, hellfire).
const LIGHT_COLOR_PRESETS = [
  { label: 'Fackel', c: '#ffd9a0' }, { label: 'Kerze', c: '#ffb867' }, { label: 'Tageslicht', c: '#fff4e0' },
  { label: 'Mondlicht', c: '#bcd2ff' }, { label: 'Arkan', c: '#b98cff' }, { label: 'Gift-Grün', c: '#8fe36b' }, { label: 'Höllenfeuer', c: '#ff6a4d' },
];

export default function ToolSettings({ map }) {
  const tool = useVtt((s) => s.ui.tool);
  const ui = useVtt((s) => s.ui);

  return (
    <div style={S.wrap}>
      <span style={S.toolName}>{TOOL_LABEL[tool] || tool}</span>
      <div style={S.sep} />

      {tool === 'zone' && (
        <>
          <span style={S.muted}>Form:</span>
          {Object.entries(ZONE_TYPES).map(([id, z]) => (
            <button key={id} title={z.label} onClick={() => setZoneTool(id)}
              style={{ ...S.btn, ...(ui.zoneType === id ? S.active : null) }}>
              <Icon src={ZONE_SRC[id]} emoji={ZONE_ICON[id]} size={14} /> {z.label.split(' ')[0]}
            </button>
          ))}
          <span style={S.muted}>Farbe:</span>
          {ZONE_COLORS.map((c) => (
            <button key={c} onClick={() => setZoneTool(ui.zoneType, c)} title={c}
              style={{ width: 20, height: 20, borderRadius: 4, background: c, border: ui.zoneColor === c ? '2px solid #fff' : '1px solid #0008', cursor: 'pointer' }} />
          ))}
          <div style={S.sep} />
          {(ZONE_TYPES[ui.zoneType]?.params || []).filter((k) => k !== 'directionDeg').map((k) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)' }}>
              <span style={S.muted}>{PARAM_LABEL[k] || k}</span>
              <input type="number" min="5" step="5" value={ui.zoneParams?.[k] ?? 0}
                onChange={(e) => setZoneParam(k, Math.max(5, +e.target.value || 0))}
                style={{ ...S.numInput }} /><span style={S.muted}>ft</span>
            </label>
          ))}
          {ui.zoneType === 'cone' && <span style={S.hint}>Ziehen richtet den Kegel aus.</span>}
        </>
      )}

      {tool === 'walls' && (
        <>
          <span style={S.muted}>Wandtyp:</span>
          {Object.entries(WALL_TYPES).map(([id, w]) => (
            <button key={id} onClick={() => setWallTool(id)} style={{ ...S.btn, ...(ui.wallKind === id ? S.active : null) }}>
              <span style={{ width: 12, height: 12, borderRadius: 2, background: w.color, display: 'inline-block' }} /> {w.label}
            </button>
          ))}
          {ui.wallKind === 'door' && (
            <>
              <div style={S.sep} />
              <button onClick={() => setDoorDouble(false)} style={{ ...S.btn, ...(!ui.doorDouble ? S.active : null) }}>Einfach</button>
              <button onClick={() => setDoorDouble(true)} style={{ ...S.btn, ...(ui.doorDouble ? S.active : null) }}>Doppeltür</button>
            </>
          )}
        </>
      )}

      {tool === 'fog' && (
        <>
          {map && (
            <>
              <span style={S.muted}>Fog:</span>
              <select value={map.fogMode || (map.fogEnabled ? 'manual' : 'none')} onChange={(e) => setFogMode(map.id, e.target.value)} style={S.select}>
                {Object.entries(FOG_MODES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              <div style={S.sep} />
            </>
          )}
          <button onClick={() => setFogErase(false)} style={{ ...S.btn, ...(!ui.fogErase ? S.active : null) }} title="Aufdecken"><Icon src="/Assets/vtt/fog-reveal.svg" emoji="☀" size={14} /> Aufdecken</button>
          <button onClick={() => setFogErase(true)} style={{ ...S.btn, ...(ui.fogErase ? S.active : null) }} title="Verbergen"><Icon src="/Assets/vtt/fog-hide.svg" emoji="🌑" size={14} /> Verbergen</button>
          <span style={S.muted}>Größe</span>
          <input type="range" min="0.5" max="6" step="0.5" value={ui.fogBrushCells ?? 1.5} onChange={(e) => setFogBrush(+e.target.value)} style={{ width: 110 }} title={`Pinsel: ${ui.fogBrushCells ?? 1.5} Felder`} />
        </>
      )}

      {tool === 'light' && (
        <>
          <button onClick={() => setLightMode('light')} style={{ ...S.btn, ...((ui.lightMode || 'light') === 'light' ? S.active : null) }}>💡 Lichtpunkt</button>
          <button onClick={() => setLightMode('darkness')} style={{ ...S.btn, ...(ui.lightMode === 'darkness' ? S.active : null) }}>■ Dunkel malen</button>
          <button onClick={() => setLightMode('darkness-erase')} style={{ ...S.btn, ...(ui.lightMode === 'darkness-erase' ? S.active : null) }}>⌫ Radierer</button>
          {(ui.lightMode || 'light') === 'light' && (
            <>
              <div style={S.sep} />
              {Object.entries(LIGHT_PRESETS).map(([id, p]) => (
                <button key={id} style={S.btn} title={`${p.brightFt}/${p.dimFt} ft`} onClick={() => setLightDefaults({ brightFt: p.brightFt, dimFt: p.dimFt, color: p.color, preset: id, icon: p.icon })}>{p.label}</button>
              ))}
              <span style={S.muted}>Hell {(ui.lightDefaults || {}).brightFt ?? 20}ft</span>
              <input type="range" min="0" max="120" step="5" value={(ui.lightDefaults || {}).brightFt ?? 20} onChange={(e) => setLightDefaults({ brightFt: +e.target.value })} style={{ width: 90 }} />
              <span style={S.muted}>Dämmer {(ui.lightDefaults || {}).dimFt ?? 40}ft</span>
              <input type="range" min="0" max="120" step="5" value={(ui.lightDefaults || {}).dimFt ?? 40} onChange={(e) => setLightDefaults({ dimFt: +e.target.value })} style={{ width: 90 }} />
              <input type="color" value={(ui.lightDefaults || {}).color || '#ffd9a0'} onChange={(e) => setLightDefaults({ color: e.target.value })} title="Lichtfarbe (Schein)" style={{ width: 30, height: 28, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
              {LIGHT_COLOR_PRESETS.map((cp) => (
                <button key={cp.c} title={cp.label} onClick={() => setLightDefaults({ color: cp.c })}
                  style={{ width: 18, height: 18, borderRadius: '50%', background: cp.c, cursor: 'pointer', border: ((ui.lightDefaults || {}).color || '#ffd9a0') === cp.c ? '2px solid #fff' : '1px solid #0008', padding: 0 }} />
              ))}
              <span style={S.muted}>Höhe {(ui.lightDefaults || {}).heightFt ?? 0}ft</span>
              <input type="range" min="0" max="60" step="5" value={(ui.lightDefaults || {}).heightFt ?? 0} onChange={(e) => setLightDefaults({ heightFt: +e.target.value })} style={{ width: 70 }} />
            </>
          )}
          {(ui.lightMode === 'darkness' || ui.lightMode === 'darkness-erase') && (
            <>
              <span style={S.muted}>Pinsel</span>
              <input type="range" min="0.5" max="8" step="0.5" value={ui.darkBrushCells ?? 2} onChange={(e) => setDarkBrush(+e.target.value)} style={{ width: 100 }} title={`Pinsel: ${ui.darkBrushCells ?? 2} Felder`} />
              <button style={S.btn} onClick={() => clearDarkness()} title="Alle Dunkelflächen löschen">Alles löschen</button>
            </>
          )}
          {map && (
            <>
              <div style={S.sep} />
              <span style={S.muted}>Grundlicht:</span>
              <select value={map.lightBaseline || 'bright'} onChange={(e) => updateMap(map.id, { lightBaseline: e.target.value })} style={S.select}>
                <option value="bright">Hell</option>
                <option value="dim">Dämmrig</option>
                <option value="dark">Dunkel</option>
              </select>
              <span style={S.muted}>Kontrast</span>
              <input type="range" min="0" max="1" step="0.05" value={map.lightContrast ?? 0.5} onChange={(e) => updateMap(map.id, { lightContrast: +e.target.value })} style={{ width: 80 }} title="Kontrast zwischen Lichtstufen" />
              <span style={S.muted}>Weichheit</span>
              <input type="range" min="0" max="12" step="1" value={map.lightBlur ?? 0} onChange={(e) => updateMap(map.id, { lightBlur: +e.target.value })} style={{ width: 80 }} title="Weichheit der Übergänge (Blur)" />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Geschlossene Wand-Loops innen immer dunkel; Fenster/offene Türen lassen Grundlicht hinein.">
                <input type="checkbox" checked={!!map.enclosedDark} onChange={(e) => updateMap(map.id, { enclosedDark: e.target.checked })} />
                <span style={S.muted}>Räume dunkel</span>
              </label>
            </>
          )}
          <span style={S.hint}>Licht erhellt nur dort, wo Dunkelheit ist (Grundlicht „Dunkel/Dämmrig" oder gemalte Dunkelflächen).</span>
        </>
      )}

      {tool === 'transition' && (
        <>
          <span style={S.muted}>Typ:</span>
          <button onClick={() => setTransitionTool('stairs')} style={{ ...S.btn, ...(ui.transitionKind === 'stairs' ? S.active : null) }}>🪜 Treppe</button>
          <button onClick={() => setTransitionTool('ladder')} style={{ ...S.btn, ...(ui.transitionKind === 'ladder' ? S.active : null) }}>🪜 Leiter</button>
          <span style={S.hint}>Feld setzen; mit ausgewähltem Feld auf anderer Ebene klicken = verbinden.</span>
        </>
      )}

      {tool === 'terrain' && (
        <>
          <span style={S.muted}>Typ:</span>
          <button style={{ ...S.btn, ...((ui.terrainKind || 'climb') === 'climb' ? S.active : null) }} onClick={() => setTerrainKind('climb')}>⛰ Klettern (Höhe)</button>
          <button style={{ ...S.btn, ...(ui.terrainKind === 'difficult' ? S.active : null) }} onClick={() => setTerrainKind('difficult')}>▦ Schwieriges Gelände</button>
          {(ui.terrainKind || 'climb') === 'climb' && (
            <>
              <span style={S.muted}>Höhe</span>
              <button style={S.btn} onClick={() => setTerrainHeight((ui.terrainHeightFt || 0) - 5)}>−</button>
              <span style={{ minWidth: 44, textAlign: 'center', fontWeight: 700 }}>{ui.terrainHeightFt > 0 ? '+' : ''}{ui.terrainHeightFt} ft</span>
              <button style={S.btn} onClick={() => setTerrainHeight((ui.terrainHeightFt || 0) + 5)}>+</button>
            </>
          )}
          <div style={S.sep} />
          <button style={{ ...S.btn, ...S.active }} onClick={() => commitTerrain()} title="Auswahl als Gelände-Objekt speichern">✓ Fertig ({(ui.terrainSelection || []).length})</button>
          <button style={S.btn} onClick={() => eraseTerrainCells()} title="Gewählte Felder aus Gelände entfernen">Radieren</button>
          <button style={S.btn} onClick={() => clearTerrainSelection()} title="Auswahl leeren">Auswahl leeren</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)' }}>
            <input type="checkbox" checked={ui.terrainVisible !== false} onChange={(e) => setTerrainVisible(e.target.checked)} /> für Spieler sichtbar
          </label>
          <span style={S.hint}>Typ wählen → Felder ziehen (Shift erweitert) → „Fertig". Auswahl-Tool: Objekt anklicken zum Bearbeiten.</span>
        </>
      )}

      {(tool === 'ruler' || tool === 'ping') && <span style={S.hint}>{tool === 'ruler' ? 'Ziehen zum Messen (ft).' : 'Klicken zum Markieren (auch Alt+Klick).'}</span>}
    </div>
  );
}

const TOOL_LABEL = { zone: 'Zone', walls: 'Wände', fog: 'Fog', light: 'Licht', transition: 'Übergänge', terrain: 'Gelände', ruler: 'Messen', ping: 'Ping' };

const S = {
  wrap: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '4px 2px' },
  toolName: { fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, color: 'var(--color-accent)' },
  btn: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  active: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: '1px solid var(--color-accent)' },
  sep: { width: 1, height: 22, background: 'var(--color-border)', margin: '0 4px' },
  muted: { color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' },
  hint: { color: 'var(--color-text-muted)', fontSize: 11 },
  select: { padding: '4px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' },
  numInput: { width: 56, padding: '4px 6px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', textAlign: 'right' },
};
