// VTT "overall settings" — personal, per-device display prefs (localStorage via
// vttPrefs). Opened from the gear in the VTT top bar. Not shared game state.
import { useIsDM } from '../state/useVtt';
import {
  useUiScale, setUiScale, useTokenBadgeScale, setTokenBadgeScale, useAcBadgeScale, setAcBadgeScale, useMemoryStyle, setMemoryStyle,
  useDmCursorLight, setDmCursorLight,
  useMemoryBrightness, setMemoryBrightness,
  useShowLightSwitches, setShowLightSwitches,
  useTerrainOpacity, setTerrainOpacity, useTerrainPattern, setTerrainPattern,
  useTerrainColor, setTerrainColor, useClimbHeightStyle, setClimbHeightStyle, useDifficultStyle, setDifficultStyle,
  useInitiativeRollEnabled, setInitiativeRollEnabled,
  usePingScale, setPingScale, usePingDurationS, setPingDurationS, useDmPingColor, setDmPingColor,
  useConnectionMode, setConnectionMode, useRelayUrl, setRelayUrl,
  useCustomWallPresets, setCustomWallPresets, useDisabledWallPresets, setDisabledWallPresets,
  useCustomLightPresets, setCustomLightPresets, useDisabledLightPresets, setDisabledLightPresets,
} from '../lib/vttPrefs';
import { WALL_TYPES, LIGHT_PRESETS } from '../lib/constants';

export default function VttSettings({ onClose }) {
  const uiScale = useUiScale();
  const badgeScale = useTokenBadgeScale();
  const acScale = useAcBadgeScale();
  const memoryStyle = useMemoryStyle();
  const memoryBrightness = useMemoryBrightness();
  const showSwitches = useShowLightSwitches();
  const tOpacity = useTerrainOpacity();
  const tPattern = useTerrainPattern();
  const tColor = useTerrainColor();
  const climb = useClimbHeightStyle();
  const difficult = useDifficultStyle();
  const initRoll = useInitiativeRollEnabled();
  const dmCursor = useDmCursorLight();
  const pingScale = usePingScale();
  const pingDur = usePingDurationS();
  const dmPingColor = useDmPingColor();
  const isDM = useIsDM();
  const connMode = useConnectionMode();
  const relayUrl = useRelayUrl();

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.panel} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <span style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>⚙ VTT-Einstellungen</span>
          <button style={S.x} onClick={onClose}>×</button>
        </div>
        <div style={S.body}>
          <Row label={`UI-Größe (${Math.round(uiScale * 100)}%)`}>
            <input type="range" min="0.7" max="1.6" step="0.05" value={uiScale} onChange={(e) => setUiScale(+e.target.value)} style={{ width: '100%' }} />
          </Row>
          <Row label={`Token-Badge-Größe (${Math.round(badgeScale * 100)}%) — Conditions/HP/AC-Badges für mich`}>
            <input type="range" min="0.4" max="2.5" step="0.1" value={badgeScale} onChange={(e) => setTokenBadgeScale(+e.target.value)} style={{ width: '100%' }} />
          </Row>
          <Row label={`AC-Badge-Größe (${Math.round(acScale * 100)}%) — zusätzlich nur für die AC-Badge`}>
            <input type="range" min="0.4" max="2.5" step="0.1" value={acScale} onChange={(e) => setAcBadgeScale(+e.target.value)} style={{ width: '100%' }} />
          </Row>
          <Row label={`Ping-Größe (${Math.round(pingScale * 100)}%) — wie groß/deutlich Pings bei mir erscheinen`}>
            <input type="range" min="0.5" max="2.5" step="0.1" value={pingScale} onChange={(e) => setPingScale(+e.target.value)} style={{ width: '100%' }} />
          </Row>
          <Row label={`Ping-Dauer (${pingDur.toFixed(1)} s) — wie lange meine eigenen Pings sichtbar bleiben`}>
            <input type="range" min="1" max="8" step="0.5" value={pingDur} onChange={(e) => setPingDurationS(+e.target.value)} style={{ width: '100%' }} />
          </Row>
          {isDM && (
            <Row label="DM-Ping-Farbe">
              <input type="color" value={dmPingColor} onChange={(e) => setDmPingColor(e.target.value)} style={{ width: 44, height: 28, background: 'none', border: 'none', cursor: 'pointer' }} />
            </Row>
          )}

          <div style={S.section}>Erkundeter Bereich (erinnert, nicht sichtbar)</div>
          <Row label="Darstellung">
            <div style={S.seg}>
              {[['darkened', 'Farbig'], ['grayscale', 'Schwarz-Weiß']].map(([v, l]) => (
                <button key={v} onClick={() => setMemoryStyle(v)} style={{ ...S.segBtn, ...(memoryStyle === v ? S.segOn : null) }}>{l}</button>
              ))}
            </div>
          </Row>
          <Row label={`Helligkeit (${Math.round(memoryBrightness * 100)}%)${memoryStyle === 'darkened' ? ' — max = Grundlicht der Karte' : ''}`}>
            <input type="range" min="0" max="1" step="0.05" value={memoryBrightness} onChange={(e) => setMemoryBrightness(+e.target.value)} style={{ width: '100%' }} />
          </Row>

          <label style={S.check}>
            <input type="checkbox" checked={showSwitches} onChange={(e) => setShowLightSwitches(e.target.checked)} />
            Lichtschalter auf der Karte anzeigen
          </label>

          <div style={S.section}>Geländedarstellung (für mich)</div>
          <Row label={`Deckkraft (${Math.round(tOpacity * 100)}%)`}>
            <input type="range" min="0" max="0.9" step="0.05" value={tOpacity} onChange={(e) => setTerrainOpacity(+e.target.value)} style={{ width: '100%' }} />
          </Row>
          <Row label="Muster">
            <div style={S.seg}>
              {[['fill', 'Fläche'], ['hatch', 'Schraffur'], ['dots', 'Punkte']].map(([v, l]) => (
                <button key={v} onClick={() => setTerrainPattern(v)} style={{ ...S.segBtn, ...(tPattern === v ? S.segOn : null) }}>{l}</button>
              ))}
            </div>
          </Row>
          <Row label="Farbe (leer = Standard je Typ)">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" value={tColor || '#ff9800'} onChange={(e) => setTerrainColor(e.target.value)} style={{ width: 40, height: 28, background: 'none', border: 'none', cursor: 'pointer' }} />
              {tColor && <button style={S.smallBtn} onClick={() => setTerrainColor('')}>Zurücksetzen</button>}
            </div>
          </Row>
          <Row label="Kletter-Höhe anzeigen">
            <div style={S.seg}>
              {[['loud', 'Sehr deutlich'], ['normal', 'Normal'], ['minimal', 'Minimal'], ['off', 'Aus']].map(([v, l]) => (
                <button key={v} onClick={() => setClimbHeightStyle(v)} style={{ ...S.segBtn, ...(climb === v ? S.segOn : null) }}>{l}</button>
              ))}
            </div>
          </Row>
          <Row label="Schwieriges Gelände anzeigen">
            <div style={S.seg}>
              {[['loud', 'Sehr deutlich'], ['normal', 'Normal'], ['minimal', 'Minimal'], ['off', 'Aus']].map(([v, l]) => (
                <button key={v} onClick={() => setDifficultStyle(v)} style={{ ...S.segBtn, ...(difficult === v ? S.segOn : null) }}>{l}</button>
              ))}
            </div>
          </Row>

          <div style={S.section}>Sonstiges</div>
          <label style={S.check} title="Nur für den DM und nur lokal sichtbar: ein warmer Lichtschein folgt dem Mauszeiger, um dunkle Ecken auszuleuchten.">
            <input type="checkbox" checked={dmCursor} onChange={(e) => setDmCursorLight(e.target.checked)} />
            DM-Mauslicht (dunkle Ecken unterm Cursor erhellen)
          </label>
          <label style={S.check}>
            <input type="checkbox" checked={initRoll} onChange={(e) => setInitiativeRollEnabled(e.target.checked)} />
            Würfel-Knopf in der Initiative-Leiste (d20 + Bonus)
          </label>
          <Row label="Verbindung">
            <div style={S.seg}>
              {[['supabase', 'Cloud'], ['relay', 'Direkt (Relay)']].map(([v, l]) => (
                <button key={v} onClick={() => setConnectionMode(v)} style={{ ...S.segBtn, ...(connMode === v ? S.segOn : null) }}>{l}</button>
              ))}
            </div>
            {connMode === 'relay' && (
              <input value={relayUrl} onChange={(e) => setRelayUrl(e.target.value)} placeholder="ws://192.168.x.x:7373" spellCheck={false}
                style={{ marginTop: 6, width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: 'var(--fs-sm)', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 6 }} />
            )}
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>Änderung greift beim nächsten VTT-Start.</div>
          </Row>

          {isDM && <PresetEditor />}
        </div>
      </div>
    </div>
  );
}

// ── Wand-/Licht-Preset-Verwaltung (DM/VTT-Setup, lokal) ──
// Built-ins lassen sich deaktivieren (verschwinden aus allen Pickern), eigene
// Presets anlegen/bearbeiten/löschen. Eigene Wand-Presets = Block-Toggles
// (kind 'both' + Overrides), eigene Licht-Presets = hell/dämmer/Farbe.
function PresetEditor() {
  const customWalls = useCustomWallPresets();
  const disabledWalls = useDisabledWallPresets();
  const customLights = useCustomLightPresets();
  const disabledLights = useDisabledLightPresets();

  const toggleBuiltin = (list, setList, id) => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const patchWall = (id, patch) => setCustomWallPresets(customWalls.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const patchLight = (id, patch) => setCustomLightPresets(customLights.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const rid = () => 'p' + Math.random().toString(36).slice(2, 8);

  return (
    <>
      <div style={S.section}>Wand-Presets (DM)</div>
      {Object.entries(WALL_TYPES).map(([id, def]) => (
        <label key={id} style={S.check} title="Deaktivierte Presets verschwinden aus den Wand-Pickern.">
          <input type="checkbox" checked={!disabledWalls.includes(id)} onChange={() => toggleBuiltin(disabledWalls, setDisabledWallPresets, id)} />
          <span style={{ width: 10, height: 10, borderRadius: 2, background: def.color, flexShrink: 0 }} />
          {def.label}
        </label>
      ))}
      {customWalls.map((p) => (
        <div key={p.id} style={S.presetRow}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="color" value={p.color || '#8899ff'} onChange={(e) => patchWall(p.id, { color: e.target.value })} style={S.colorIn} />
            <input value={p.label || ''} onChange={(e) => patchWall(p.id, { label: e.target.value })} placeholder="Name" style={S.textIn} />
            <button style={S.smallBtn} onClick={() => setCustomWallPresets(customWalls.filter((x) => x.id !== p.id))}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
            {[['blockMove', 'Bewegung'], ['blockLight', 'Licht'], ['blockSight', 'Sicht']].map(([k, l]) => (
              <label key={k} style={{ ...S.check, margin: 0 }}>
                <input type="checkbox" checked={!!p[k]} onChange={(e) => patchWall(p.id, { [k]: e.target.checked })} />
                {l}
              </label>
            ))}
          </div>
          {p.blockSight && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
              <label style={S.ftLbl} title="0 = nie durchsehen">Durchsehen ab (ft)
                <input type="number" min="0" step="5" value={p.seeOutFt || 0} onChange={(e) => patchWall(p.id, { seeOutFt: Math.max(0, +e.target.value || 0) })} style={S.numIn} />
              </label>
              {(p.seeOutFt || 0) > 0 && (
                <label style={S.ftLbl} title="0 = unbegrenzt">Sichtweite dahinter (ft)
                  <input type="number" min="0" step="5" value={p.seeFarFt || 0} onChange={(e) => patchWall(p.id, { seeFarFt: Math.max(0, +e.target.value || 0) })} style={S.numIn} />
                </label>
              )}
            </div>
          )}
        </div>
      ))}
      <button style={S.smallBtn} onClick={() => setCustomWallPresets([...customWalls, { id: rid(), label: 'Neues Preset', color: '#8899ff', blockMove: true, blockLight: true, blockSight: true }])}>
        + Wand-Preset
      </button>

      <div style={S.section}>Licht-Presets (DM)</div>
      {Object.entries(LIGHT_PRESETS).map(([id, def]) => (
        <label key={id} style={S.check} title="Deaktivierte Presets verschwinden aus den Licht-Pickern.">
          <input type="checkbox" checked={!disabledLights.includes(id)} onChange={() => toggleBuiltin(disabledLights, setDisabledLightPresets, id)} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: def.color, flexShrink: 0 }} />
          {def.label} <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>({def.brightFt}/{def.dimFt} ft)</span>
        </label>
      ))}
      {customLights.map((p) => (
        <div key={p.id} style={S.presetRow}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="color" value={p.color || '#ffd9a0'} onChange={(e) => patchLight(p.id, { color: e.target.value })} style={S.colorIn} />
            <input value={p.label || ''} onChange={(e) => patchLight(p.id, { label: e.target.value })} placeholder="Name" style={S.textIn} />
            <button style={S.smallBtn} onClick={() => setCustomLightPresets(customLights.filter((x) => x.id !== p.id))}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
            <label style={S.ftLbl}>Hell (ft)
              <input type="number" min="0" step="5" value={p.brightFt ?? 20} onChange={(e) => patchLight(p.id, { brightFt: Math.max(0, +e.target.value || 0) })} style={S.numIn} />
            </label>
            <label style={S.ftLbl}>Dämmer (ft)
              <input type="number" min="0" step="5" value={p.dimFt ?? 40} onChange={(e) => patchLight(p.id, { dimFt: Math.max(0, +e.target.value || 0) })} style={S.numIn} />
            </label>
          </div>
        </div>
      ))}
      <button style={S.smallBtn} onClick={() => setCustomLightPresets([...customLights, { id: rid(), label: 'Neues Licht', color: '#ffd9a0', brightFt: 20, dimFt: 40 }])}>
        + Licht-Preset
      </button>
    </>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const S = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  panel: { width: 'min(440px, 92vw)', maxHeight: '88vh', overflowY: 'auto', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 12px 48px #000b', padding: 16 },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  x: { background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 22, lineHeight: 1 },
  body: {},
  section: { fontWeight: 700, fontSize: 'var(--fs-sm)', margin: '14px 0 8px', paddingTop: 10, borderTop: '1px solid var(--color-border)' },
  seg: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  segBtn: { flex: 1, minWidth: 70, padding: '6px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  segOn: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: '1px solid var(--color-accent)' },
  check: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-sm)', margin: '8px 0' },
  smallBtn: { padding: '4px 8px', fontSize: 11, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' },
  presetRow: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 8px', margin: '6px 0', background: 'var(--color-bg-sunken)' },
  colorIn: { width: 28, height: 24, padding: 0, border: '1px solid var(--color-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', flexShrink: 0 },
  textIn: { flex: 1, minWidth: 0, padding: '3px 6px', fontSize: 'var(--fs-sm)', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 6 },
  ftLbl: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-text-muted)' },
  numIn: { width: 58, padding: '2px 5px', fontSize: 'var(--fs-sm)', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 6 },
};
