// Editor for the selected wall(s) (DM). Die Wand-KINDS sind nur PRESETS für
// drei Block-Toggles (Bewegung/Licht/Sicht): ein Preset setzt kind und löscht
// alle Overrides; die Checkboxen zeigen das effektive Verhalten und schreiben
// bei Änderung einen per-Wand-Override. Sicht hat zwei ft-Felder: ab welcher
// Nähe man durchsieht (0 = nie) und wie weit dahinter (0 = unbegrenzt).
// Mehrfachauswahl (Shift-Klick / Doppelklick = Loop) ändert alle gemeinsam.
import { useState } from 'react';
import { Panel, Button } from '../../../../shared/ui';
import { useVtt, useIsDM } from '../state/useVtt';
import { updateWall, removeWall, selectWall, extendWall } from '../state/actions';
import { wallBaseBlocks, wallPeekFt } from '../lib/constants';
import { useWallPresets } from '../lib/presets';

export default function WallEditor() {
  const isDM = useIsDM();
  const id = useVtt((s) => s.ui.selectedWallId);
  const selectedIds = useVtt((s) => s.ui.selectedWallIds || []);
  const wall = useVtt((s) => (id ? s.walls[id] : null));
  const [more, setMore] = useState(false);
  const presets = useWallPresets();
  if (!isDM || !wall) return null;

  // When several walls are selected (double-click a loop/chain), every edit
  // applies to ALL of them at once; otherwise just the one.
  const ids = selectedIds.length > 1 ? selectedIds : [id];
  const apply = (patch) => ids.forEach((wid) => updateWall(wid, patch));
  const multi = ids.length > 1;

  // Effektive Toggle-Werte: Override gewinnt, sonst Preset-Default.
  const base = wallBaseBlocks(wall.kind);
  const effMove = wall.blockMove ?? base.move;
  const effLight = wall.blockLight ?? base.light;
  const effSight = wall.blockSight ?? base.sight;
  const peek = wallPeekFt(wall);
  const far = wall.seeFarFt || 0;

  const num = (v) => Math.max(0, Math.round(+v || 0));

  return (
    <Panel padding="sm">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>{multi ? `Wände (${ids.length})` : 'Wand'}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{multi ? 'Doppelklick = ganzer Loop' : 'Endpunkte ziehen · Entf löscht'}</span>
      </div>

      {/* Presets: setzen kind + Overrides (kompaktes Chip-Grid). Built-ins
          löschen die Overrides (Preset-Default greift); eigene Presets aus den
          VTT-Einstellungen schreiben ihre Block-Overrides explizit. */}
      <div style={S.lbl}>Preset (setzt die Toggles)</div>
      <div style={S.presetGrid}>
        {presets.map((p) => (
          <button key={p.id} title={p.label}
            onClick={() => apply(p.custom
              ? { kind: 'both', ...p.overrides }
              : { kind: p.kind, blockMove: null, blockLight: null, blockSight: null, seeOutFt: null, seeFarFt: null })}
            style={{ ...S.preset, ...((p.builtin && wall.kind === p.kind && wall.blockMove == null && wall.blockLight == null && wall.blockSight == null) ? S.presetOn : null) }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: p.color, flexShrink: 0 }} />
            <span style={S.presetTxt}>{p.label}</span>
          </button>
        ))}
      </div>

      {/* Effektive Block-Toggles (Override pro Wand). */}
      <div style={{ ...S.lbl, marginTop: 8 }}>Blockiert</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={S.check} title="Tokens können diese Wand nicht überqueren">
          <input type="checkbox" checked={effMove} onChange={(e) => apply({ blockMove: e.target.checked })} />
          Bewegung
        </label>
        <label style={S.check} title="Lichtquellen werfen an dieser Wand Schatten">
          <input type="checkbox" checked={effLight} onChange={(e) => apply({ blockLight: e.target.checked })} />
          Licht
        </label>
        <label style={S.check} title="Sichtlinie endet an dieser Wand">
          <input type="checkbox" checked={effSight} onChange={(e) => apply({ blockSight: e.target.checked })} />
          Sicht
        </label>
      </div>
      {effSight && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={S.ftRow} title="Steht ein Token näher als diese Distanz an der Wand, sieht es hindurch (Busch/Hecke). 0 = nie durchsehen, egal wie nah.">
            <span style={S.ftLbl}>Durchsehen ab Nähe (ft) — 0 = nie</span>
            <input type="number" min="0" step="5" value={peek} onChange={(e) => apply({ seeOutFt: num(e.target.value) })} style={S.ftInput} />
          </label>
          {peek > 0 && (
            <label style={S.ftRow} title="Wie weit man beim Durchsehen HINTER die Wand sieht. 0 = unbegrenzt.">
              <span style={S.ftLbl}>Sichtweite dahinter (ft) — 0 = frei</span>
              <input type="number" min="0" step="5" value={far} onChange={(e) => apply({ seeFarFt: num(e.target.value) || null })} style={S.ftInput} />
            </label>
          )}
        </div>
      )}

      {wall.kind === 'door' && (
        <label style={S.check2}>
          <input type="checkbox" checked={!!wall.open} onChange={(e) => apply({ open: e.target.checked })} />
          Tür offen (blockt nichts)
        </label>
      )}

      {wall.kind === 'window' && (
        <>
          <label style={S.check2} title="Nur ein OFFENES Fenster lässt Licht ungehindert durch. Geschlossen blockt es Licht — außer es ist milchig (gedimmt) oder farbig (getönt). Sicht geht immer durch.">
            <input type="checkbox" checked={!!wall.open} onChange={(e) => apply({ open: e.target.checked })} />
            Fenster offen (lässt Licht durch)
          </label>
          <label style={S.check2} title="Milchglas: Licht passiert das geschlossene Fenster, aber eine Stufe gedämpft (hell → dim dahinter).">
            <input type="checkbox" checked={!!wall.milky} onChange={(e) => apply({ milky: e.target.checked })} />
            Milchglas (dämpft Licht)
          </label>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}
            title="Buntglas: Licht passiert das geschlossene Fenster gedimmt und in dieser Farbe getönt. Ohne Farbe = klares Glas (geschlossen blockt Licht).">
            <span style={S.lbl}>Glasfarbe</span>
            <input type="color" value={wall.color || '#88ccff'} onChange={(e) => apply({ color: e.target.value })}
              style={{ width: 34, height: 24, padding: 0, border: '1px solid var(--color-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer' }} />
            {wall.color
              ? <button style={S.miniBtn} onClick={() => apply({ color: null })}>Klar (transparent)</button>
              : <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>klar</span>}
          </div>
        </>
      )}

      {/* Selten gebrauchte Optionen ausgeklappt halten → Menü bleibt kompakt. */}
      <button style={S.moreToggle} onClick={() => setMore((m) => !m)}>{more ? '▾' : '▸'} Erweitert</button>
      {more && (
        <>
          <div style={S.lbl}>Höhe (ft) — 0 = volle Wand; erhöhte Token sehen über niedrigere Wände</div>
          <input type="number" min="0" step="5" value={wall.heightFt ?? 0}
            onChange={(e) => apply({ heightFt: num(e.target.value) })} style={S.ftInput} />
          {(wall.kind === 'door' || wall.kind === 'window') && (
            <div style={{ marginTop: 8 }}>
              <div style={S.lbl}>Anzeigebreite ({Math.round((wall.widthCells ?? 0.7) * 100)}% Feld)</div>
              <input type="range" min="0.2" max="2" step="0.1" value={wall.widthCells ?? 0.7}
                onChange={(e) => apply({ widthCells: +e.target.value })} style={{ width: '100%' }} />
            </div>
          )}
          <label style={S.check2} title="Geschlossener Loop ohne Dach: erhöhte Token können hineinsehen (sonst überdacht = kein Einblick)">
            <input type="checkbox" checked={!!wall.noRoof} onChange={(e) => apply({ noRoof: e.target.checked })} />
            Loop ohne Dach (von oben einsehbar)
          </label>
          <label style={S.check2} title="Loop von außen einsehbar: man sieht alles im Loop, der Schatten fällt nur dahinter (z. B. niedrige Mauer, Geländer)">
            <input type="checkbox" checked={!!wall.seeThrough} onChange={(e) => apply({ seeThrough: e.target.checked })} />
            Von außen einsehbar (Schatten nur dahinter)
          </label>
        </>
      )}

      {!multi && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <Button size="sm" variant="secondary" fullWidth onClick={() => extendWall(wall, 'b')}>Abzweigung ab Ende</Button>
          <Button size="sm" variant="secondary" fullWidth onClick={() => extendWall(wall, 'a')}>ab Anfang</Button>
        </div>
      )}
      <Button size="sm" variant="danger" fullWidth style={{ marginTop: 6 }}
        onClick={() => { ids.forEach((wid) => removeWall(wid)); selectWall(null); }}>{multi ? `${ids.length} Wände löschen` : 'Wand löschen'}</Button>
    </Panel>
  );
}

const S = {
  lbl: { fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', marginBottom: 4 },
  presetGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 },
  preset: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 11, textAlign: 'left', minWidth: 0 },
  presetOn: { border: '1px solid var(--color-accent)', color: 'var(--color-accent)' },
  presetTxt: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  check: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-sm)', cursor: 'pointer' },
  check2: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', marginTop: 8, cursor: 'pointer' },
  ftRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  ftLbl: { fontSize: 11, color: 'var(--color-text-muted)' },
  ftInput: { width: 70, padding: '3px 6px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' },
  miniBtn: { fontSize: 11, padding: '2px 8px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer' },
  moreToggle: { display: 'block', marginTop: 10, background: 'transparent', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600, padding: 0 },
};
