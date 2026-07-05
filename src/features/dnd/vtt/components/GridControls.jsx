// DM grid + fog controls for the active map. All edits go through setGrid /
// updateMap and sync to every client.
import { useState } from 'react';
import { setGrid, resetFog, setFogMode, updateMap, setLightMode, setTool, clearDarkness } from '../state/actions';
import { useVtt } from '../state/useVtt';
import { GRID_STYLES, FOG_MODES } from '../lib/constants';
import { fitGridToMap } from '../lib/geometry';

export default function GridControls({ map }) {
  const tool = useVtt((s) => s.ui.tool);
  const lightMode = useVtt((s) => s.ui.lightMode);
  const darkCount = (map.darkness || []).length;
  const g = map.grid;
  const patch = (p) => setGrid(map.id, p);
  const fogMode = map.fogMode || (map.fogEnabled ? 'manual' : 'none');

  // When "Karte auf volle Felder" is on, derive size/offset so an integer
  // number of cells covers the map exactly; the slider then tunes cell count.
  const onSize = (size) => {
    if (g.snapMapToGrid) {
      const fit = fitGridToMap(map.width, map.height, size);
      patch({ size: fit.size, offsetX: fit.offsetX, offsetY: fit.offsetY });
    } else {
      patch({ size });
    }
  };

  const toggleSnap = (on) => {
    if (on) {
      const fit = fitGridToMap(map.width, map.height, g.size);
      patch({ snapMapToGrid: true, size: fit.size, offsetX: fit.offsetX, offsetY: fit.offsetY });
    } else {
      patch({ snapMapToGrid: false });
    }
  };

  const cells = `${Math.round(map.width / g.size)} × ${Math.round(map.height / g.size)} Felder`;
  // Slider-Obergrenze an der Map-Größe orientieren: große (hochauflösende)
  // Maps brauchen entsprechend große Zellen — ein fixes 200px-Maximum machte
  // Grid-Vergrößern und „auf volle Felder snappen" dort unbenutzbar.
  const sliderMax = Math.max(240, Math.round(Math.max(map.width, map.height) / 4));

  return (
    <>
      <Row label={`Größe (${Math.round(g.size)} px) · ${cells}`}>
        <input type="range" min="20" max={sliderMax} value={Math.min(sliderMax, Math.round(g.size))} onChange={(e) => onSize(+e.target.value)} style={{ width: '100%' }} />
      </Row>

      {/* Exact calibration for standard battlemaps ("44x32 @ 72dpi"): type the
          cell pitch in px OR the column/row count — committed on Enter/blur (a
          per-keystroke commit clamped "72" to "82" mid-typing and made these
          values impossible to enter). Offset (below) aligns the origin. */}
      <Row label="Genau kalibrieren (z. B. 44×32 · 72 dpi)">
        {/* dpi always refers to the ORIGINAL image. If the import downscaled the
            map, convert via origWidth (stored in the grid) so typing the
            original's dpi still lands exactly on the compressed map. */}
        {(() => {
          const origScale = g.origWidth ? map.width / g.origWidth : 1;
          return (
            <div style={{ display: 'flex', gap: 6 }}>
              <CommitNum label="px/Feld (dpi)" value={Math.round(g.size / origScale)} min={8} max={4000}
                onCommit={(v) => onSize(v * origScale)} />
              <CommitNum label="Felder breit" value={Math.max(1, Math.round(map.width / g.size))} min={1} max={500}
                onCommit={(n) => onSize(map.width / n)} />
              <CommitNum label="Felder hoch" value={Math.max(1, Math.round(map.height / g.size))} min={1} max={500}
                onCommit={(n) => onSize(map.height / n)} />
            </div>
          );
        })()}
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '3px 0 0' }}>
          Eingabe mit Enter bestätigen. „72 dpi" = 72 px/Feld, bezogen auf die Originaldatei{g.origWidth && Math.round(map.width / g.origWidth * 100) !== 100 ? ' (wird automatisch auf die komprimierte Map umgerechnet)' : ''}.
        </p>
      </Row>

      <label style={S.check}>
        <input type="checkbox" checked={!!g.snapMapToGrid} onChange={(e) => toggleSnap(e.target.checked)} />
        Karte auf volle Felder snappen
      </label>

      {!g.snapMapToGrid && (
        <Row label={`Offset X/Y (${g.offsetX}, ${g.offsetY})`}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="range" min="0" max={Math.round(g.size)} value={g.offsetX} onChange={(e) => patch({ offsetX: +e.target.value })} style={{ flex: 1 }} />
            <input type="range" min="0" max={Math.round(g.size)} value={g.offsetY} onChange={(e) => patch({ offsetY: +e.target.value })} style={{ flex: 1 }} />
          </div>
        </Row>
      )}

      <Row label="Stil">
        <select value={g.style} onChange={(e) => patch({ style: e.target.value })} style={S.select}>
          {Object.entries(GRID_STYLES).map(([id, st]) => <option key={id} value={id}>{st.label}</option>)}
        </select>
      </Row>

      <Row label={`Dicke (${g.thickness}px)`}>
        <input type="range" min="1" max="6" step="0.5" value={g.thickness} onChange={(e) => patch({ thickness: +e.target.value })} style={{ width: '100%' }} />
      </Row>

      <Row label={`Deckkraft (${Math.round(g.opacity * 100)}%)`}>
        <input type="range" min="0" max="1" step="0.05" value={g.opacity} onChange={(e) => patch({ opacity: +e.target.value })} style={{ width: '100%' }} />
      </Row>

      <Row label="Farbe">
        <input type="color" value={g.color} onChange={(e) => patch({ color: e.target.value })} style={{ width: 40, height: 28, background: 'none', border: 'none' }} />
      </Row>

      <div style={{ borderTop: '1px solid var(--color-border)', margin: '10px 0 8px' }} />
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Fog of War</div>
      <Row label="Modus">
        <select value={fogMode} onChange={(e) => setFogMode(map.id, e.target.value)} style={S.select}>
          {Object.entries(FOG_MODES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </Row>
      {fogMode === 'manual' && (
        <button style={S.reset} onClick={() => resetFog(map.id)}>Fog zurücksetzen (alles verbergen)</button>
      )}
      {fogMode === 'dynamic' && (
        <>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
            Spieler sehen nur, was ihr Token durch lichtblockende Wände sieht. Wände mit dem 🧱-Tool ziehen.
          </p>
          <Row label="Erkundete Bereiche">
            <select value={map.memoryStyle || 'darkened'} onChange={(e) => updateMap(map.id, { memoryStyle: e.target.value })} style={S.select}>
              <option value="darkened">Abgedunkelt (Farbe bleibt)</option>
              <option value="grayscale">Schwarz-Weiß</option>
            </select>
          </Row>
          <Row label={`Abdunklung (${Math.round((map.memoryStrength ?? 0.55) * 100)}%)`}>
            <input type="range" min="0.1" max="0.9" step="0.05" value={map.memoryStrength ?? 0.55}
              onChange={(e) => updateMap(map.id, { memoryStrength: +e.target.value })} style={{ width: '100%' }} />
          </Row>
        </>
      )}

      <div style={{ borderTop: '1px solid var(--color-border)', margin: '10px 0 8px' }} />
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Beleuchtung</div>
      <label style={S.check}>
        <input
          type="checkbox"
          checked={map.lightingEnabled !== false}
          onChange={(e) => updateMap(map.id, { lightingEnabled: e.target.checked })}
        />
        Dynamisches Licht (Fackeln/Laternen + Schatten)
      </label>
      <Row label="Licht-Stil">
        <select value={map.lightStyle || 'modern'} onChange={(e) => updateMap(map.id, { lightStyle: e.target.value })} style={S.select}>
          <option value="modern">Modern (warmer, weicher Schein)</option>
          <option value="classic">Klassisch (klare Hell/Dämmer-Stufen)</option>
        </select>
      </Row>
      <Row label="Grundlicht (Baseline)">
        <select value={map.lightBaseline || 'bright'} onChange={(e) => updateMap(map.id, { lightBaseline: e.target.value })} style={S.select}>
          <option value="bright">Hell — alles sichtbar</option>
          <option value="dim">Dämmrig — Lichter erhellen</option>
          <option value="dark">Dunkel — nur Lichter erhellen</option>
        </select>
      </Row>
      <label style={S.check} title="Geschlossene Wand-Loops (auch mit Tür/Fenster) sind innen immer dunkel, egal wie hell es draußen ist. Fenster & offene Türen lassen etwas vom Grundlicht hineinscheinen.">
        <input
          type="checkbox"
          checked={!!map.enclosedDark}
          onChange={(e) => updateMap(map.id, { enclosedDark: e.target.checked })}
        />
        Geschlossene Räume immer dunkel (Licht fällt durch Fenster/Türen)
      </label>
      <Row label={`Dunkelflächen${darkCount ? ` (${darkCount})` : ''}`}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            style={{ ...S.modeBtn, ...(tool === 'light' && lightMode === 'darkness' ? S.modeActive : null) }}
            onClick={() => (tool === 'light' && lightMode === 'darkness' ? setTool('select') : setLightMode('darkness'))}
          >
            {tool === 'light' && lightMode === 'darkness' ? '■ Pinsel aktiv' : '■ Dunkel malen'}
          </button>
          {darkCount > 0 && <button style={S.reset} onClick={() => clearDarkness()}>Alle löschen</button>}
        </div>
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>Mit dem Pinsel malen (wie Fog); wird nur dort hell, wo ein Licht hinreicht. Pinsel/Radierer im Licht-Tool unten.</p>
      </Row>

      {(map.lightBaseline || 'bright') !== 'dark' && (
        <Row label={`Sonnenrichtung (${Math.round(((map.worldShadowDir ?? 135) + 180) % 360)}° — von wo das Licht kommt)`}>
          <input type="range" min="0" max="360" step="5" value={((map.worldShadowDir ?? 135) + 180) % 360}
            onChange={(e) => updateMap(map.id, { worldShadowDir: (+e.target.value + 180) % 360 })} style={{ width: '100%' }} />
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '2px 0 0' }}>Bestimmt, durch welche Fenster das Gebietslicht hereinscheint („Räume dunkel") und wohin der Welt-Schatten fällt.</p>
        </Row>
      )}
      {(map.lightBaseline || 'bright') !== 'dark' && (
        <label style={S.check} title="Wände werfen einen map-weiten Schatten in Sonnenrichtung — automatisch genau eine Lichtstufe dunkler als das Umgebungslicht (hell → dämmrig, dämmrig → dunkel). Platzierte Lichter erhellen den Schatten normal.">
          <input
            type="checkbox"
            checked={(map.worldShadowStrength ?? 0) > 0}
            onChange={(e) => updateMap(map.id, { worldShadowStrength: e.target.checked ? 1 : 0 })}
          />
          Welt-Schatten (eine Stufe dunkler als Umgebungslicht)
        </label>
      )}
    </>
  );
}

// Number input that keeps a local DRAFT while typing and only commits a
// clamped value on Enter/blur — so multi-digit values ("72") can actually be
// typed without the min-clamp rewriting them mid-keystroke.
function CommitNum({ label, value, min, max, onCommit }) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  // Follow external changes while not editing (render-time state adjustment —
  // the React-sanctioned alternative to a setState-in-effect).
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (!focused) setDraft(String(value));
  }
  const commit = () => {
    const n = parseFloat(draft);
    if (Number.isFinite(n)) onCommit(Math.max(min, Math.min(max, n)));
    else setDraft(String(value));
  };
  return (
    <label style={S.numLbl}>{label}
      <input type="number" min={min} max={max} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { commit(); e.target.blur(); } }}
        style={S.numIn} />
    </label>
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
  check: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', margin: '6px 0' },
  numLbl: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--color-text-muted)' },
  numIn: { width: '100%', boxSizing: 'border-box', padding: '4px 6px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' },
  select: { width: '100%', padding: '5px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' },
  reset: { width: '100%', marginTop: 6, padding: '5px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  modeBtn: { flex: 1, padding: '5px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  modeActive: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: '1px solid var(--color-accent)' },
};
