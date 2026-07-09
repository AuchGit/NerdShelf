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
  useCustomWallPresets, setCustomWallPresets, useDisabledWallPresets, setDisabledWallPresets,
  useCustomLightPresets, setCustomLightPresets, useDisabledLightPresets, setDisabledLightPresets,
  useBuiltinWallEdits, setBuiltinWallEdits, useBuiltinLightEdits, setBuiltinLightEdits,
} from '../lib/vttPrefs';
import { WALL_TYPES, LIGHT_PRESETS, LIGHT_ICONS, wallBaseBlocks, DEFAULT_COVER_SEE_OUT_FT } from '../lib/constants';

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
          {/* Verbindungs-Auswahl entfernt: die Direktverbindung läuft automatisch
              (Session-Start → Relay announced → Spieler joinen; Stop → Cloud). */}

          {isDM && <PresetEditor />}
        </div>
      </div>
    </div>
  );
}

// ── Wand-/Licht-Preset-Verwaltung (DM/VTT-Setup, lokal) ──
// AUCH die Built-ins sind editierbar (Label/Farbe/Verhalten; Edits liegen als
// Partial über dem Default, „↺" setzt zurück) und einzeln deaktivierbar
// (verschwinden aus allen Pickern). Eigene Presets frei anlegen/löschen.
// Wand-Verhalten = Block-Toggles (werden als Overrides mitplatziert); Licht-
// Presets tragen zusätzlich „Spieler dürfen schalten" (playerSwitch).
function PresetEditor() {
  const customWalls = useCustomWallPresets();
  const disabledWalls = useDisabledWallPresets();
  const customLights = useCustomLightPresets();
  const disabledLights = useDisabledLightPresets();
  const wallEdits = useBuiltinWallEdits();
  const lightEdits = useBuiltinLightEdits();

  const toggleBuiltin = (list, setList, id) => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const patchCustomWall = (id, patch) => setCustomWallPresets(customWalls.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const patchCustomLight = (id, patch) => setCustomLightPresets(customLights.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const patchWallEdit = (id, patch) => setBuiltinWallEdits({ ...wallEdits, [id]: { ...(wallEdits[id] || {}), ...patch } });
  const patchLightEdit = (id, patch) => setBuiltinLightEdits({ ...lightEdits, [id]: { ...(lightEdits[id] || {}), ...patch } });
  const resetWallEdit = (id) => { const m = { ...wallEdits }; delete m[id]; setBuiltinWallEdits(m); };
  const resetLightEdit = (id) => { const m = { ...lightEdits }; delete m[id]; setBuiltinLightEdits(m); };
  const rid = () => 'p' + Math.random().toString(36).slice(2, 8);

  // Wand-Zeile: Built-ins zeigen effektive Werte (Default + Edit). Tür/Fenster
  // erscheinen hier gar nicht — sie sind keine Presets (eigenes Verhalten).
  const wallRow = (p) => {
    const isBuiltin = !p.custom;
    const def = isBuiltin ? WALL_TYPES[p.id] : null;
    const edit = isBuiltin ? (wallEdits[p.id] || {}) : null;
    const base = isBuiltin ? wallBaseBlocks(p.id) : null;
    const val = isBuiltin
      ? {
          label: edit.label ?? def.label, color: edit.color ?? def.color,
          blockMove: edit.blockMove ?? base.move, blockLight: edit.blockLight ?? base.light, blockSight: edit.blockSight ?? base.sight,
          seeOutFt: edit.seeOutFt ?? (p.id === 'cover' ? DEFAULT_COVER_SEE_OUT_FT : 0), seeFarFt: edit.seeFarFt ?? 0,
        }
      : p;
    const patch = isBuiltin ? (pt) => patchWallEdit(p.id, pt) : (pt) => patchCustomWall(p.id, pt);
    const disabled = isBuiltin && disabledWalls.includes(p.id);
    return (
      <div key={p.id} style={{ ...S.presetRow, ...(disabled ? { opacity: 0.5 } : null) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isBuiltin && (
            <input type="checkbox" checked={!disabled} title="Aktiv (im Picker sichtbar)"
              onChange={() => toggleBuiltin(disabledWalls, setDisabledWallPresets, p.id)} />
          )}
          <input type="color" value={val.color} onChange={(e) => patch({ color: e.target.value })} style={S.colorIn} />
          <input value={val.label} onChange={(e) => patch({ label: e.target.value })} placeholder="Name" style={S.textIn} />
          {isBuiltin
            ? (Object.keys(edit).length > 0 && <button style={S.smallBtn} title="Auf Standard zurücksetzen" onClick={() => resetWallEdit(p.id)}>↺</button>)
            : <button style={S.smallBtn} title="Löschen" onClick={() => setCustomWallPresets(customWalls.filter((x) => x.id !== p.id))}>✕</button>}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
          {[['blockMove', 'Bewegung'], ['blockLight', 'Licht'], ['blockSight', 'Sicht']].map(([k, l]) => (
            <label key={k} style={{ ...S.check, margin: 0 }}>
              <input type="checkbox" checked={!!val[k]} onChange={(e) => patch({ [k]: e.target.checked })} />
              {l}
            </label>
          ))}
        </div>
        {val.blockSight && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
            <label style={S.ftLbl} title="0 = nie durchsehen">Durchsehen ab (ft)
              <input type="number" min="0" step="5" value={val.seeOutFt || 0} onChange={(e) => patch({ seeOutFt: Math.max(0, +e.target.value || 0) })} style={S.numIn} />
            </label>
            {(val.seeOutFt || 0) > 0 && (
              <label style={S.ftLbl} title="0 = unbegrenzt">Sichtweite dahinter (ft)
                <input type="number" min="0" step="5" value={val.seeFarFt || 0} onChange={(e) => patch({ seeFarFt: Math.max(0, +e.target.value || 0) })} style={S.numIn} />
              </label>
            )}
          </div>
        )}
      </div>
    );
  };

  const lightRow = (p) => {
    const isBuiltin = !p.custom;
    const def = isBuiltin ? LIGHT_PRESETS[p.id] : null;
    const edit = isBuiltin ? (lightEdits[p.id] || {}) : null;
    const val = isBuiltin ? { ...def, ...edit } : p;
    const patch = isBuiltin ? (pt) => patchLightEdit(p.id, pt) : (pt) => patchCustomLight(p.id, pt);
    const disabled = isBuiltin && disabledLights.includes(p.id);
    return (
      <div key={p.id} style={{ ...S.presetRow, ...(disabled ? { opacity: 0.5 } : null) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isBuiltin && (
            <input type="checkbox" checked={!disabled} title="Aktiv (im Picker sichtbar)"
              onChange={() => toggleBuiltin(disabledLights, setDisabledLightPresets, p.id)} />
          )}
          <input type="color" value={val.color || '#ffd9a0'} onChange={(e) => patch({ color: e.target.value })} style={S.colorIn} />
          <input value={val.label || ''} onChange={(e) => patch({ label: e.target.value })} placeholder="Name" style={S.textIn} />
          {isBuiltin
            ? (Object.keys(edit).length > 0 && <button style={S.smallBtn} title="Auf Standard zurücksetzen" onClick={() => resetLightEdit(p.id)}>↺</button>)
            : <button style={S.smallBtn} title="Löschen" onClick={() => setCustomLightPresets(customLights.filter((x) => x.id !== p.id))}>✕</button>}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
          <label style={S.ftLbl}>Hell (ft)
            <input type="number" min="0" step="5" value={val.brightFt ?? 20} onChange={(e) => patch({ brightFt: Math.max(0, +e.target.value || 0) })} style={S.numIn} />
          </label>
          <label style={S.ftLbl}>Dämmer (ft)
            <input type="number" min="0" step="5" value={val.dimFt ?? 40} onChange={(e) => patch({ dimFt: Math.max(0, +e.target.value || 0) })} style={S.numIn} />
          </label>
          <label style={{ ...S.check, margin: 0 }} title="Dürfen Spieler dieses Licht über den Lichtschalter an-/ausmachen?">
            <input type="checkbox" checked={val.playerSwitch !== false} onChange={(e) => patch({ playerSwitch: e.target.checked })} />
            Spieler dürfen schalten
          </label>
        </div>
        {/* Karten-Symbol des Lichts (SVG) — Ø = keins (nur der Lichtschein). */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 }}>
          <span style={S.ftLbl}>Symbol</span>
          <button style={{ ...S.iconBtn, ...(!val.icon ? S.iconOn : null) }} title="Kein Symbol" onClick={() => patch({ icon: null })}>Ø</button>
          {Object.values(LIGHT_ICONS).map((ic) => (
            <button key={ic.src} style={{ ...S.iconBtn, ...(val.icon === ic.src ? S.iconOn : null) }} title={ic.label} onClick={() => patch({ icon: ic.src })}>
              <img src={ic.src} alt={ic.label} style={{ width: 14, height: 14, display: 'block' }} />
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <div style={S.section}>Wand-Presets (DM)</div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
        Tür und Fenster sind keine Presets (eigenes Verhalten) und immer verfügbar.
      </div>
      {Object.keys(WALL_TYPES).filter((id) => id !== 'door' && id !== 'window').map((id) => wallRow({ id }))}
      {customWalls.map((p) => wallRow({ ...p, custom: true }))}
      <button style={S.smallBtn} onClick={() => setCustomWallPresets([...customWalls, { id: rid(), label: 'Neues Preset', color: '#8899ff', blockMove: true, blockLight: true, blockSight: true }])}>
        + Wand-Preset
      </button>

      <div style={S.section}>Licht-Presets (DM)</div>
      {Object.keys(LIGHT_PRESETS).map((id) => lightRow({ id }))}
      {customLights.map((p) => lightRow({ ...p, custom: true }))}
      <button style={S.smallBtn} onClick={() => setCustomLightPresets([...customLights, { id: rid(), label: 'Neues Licht', color: '#ffd9a0', brightFt: 20, dimFt: 40, playerSwitch: true }])}>
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
  iconBtn: { width: 26, height: 24, display: 'grid', placeItems: 'center', padding: 0, fontSize: 11, background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer' },
  iconOn: { borderColor: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' },
};
