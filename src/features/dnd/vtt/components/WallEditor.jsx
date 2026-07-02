// Editor for the selected wall (DM). Change kind, toggle a door open/closed,
// delete. Endpoints are dragged on the canvas; this is the precise/extra
// controls. Shown in the sidebar when a wall is selected (click a wall with the
// Auswahl tool).
import { Panel, Button } from '../../../../shared/ui';
import { useVtt, useIsDM } from '../state/useVtt';
import { updateWall, removeWall, selectWall, extendWall } from '../state/actions';
import { WALL_TYPES } from '../lib/constants';

export default function WallEditor() {
  const isDM = useIsDM();
  const id = useVtt((s) => s.ui.selectedWallId);
  const selectedIds = useVtt((s) => s.ui.selectedWallIds || []);
  const wall = useVtt((s) => (id ? s.walls[id] : null));
  if (!isDM || !wall) return null;

  // When several walls are selected (double-click a loop/chain), every edit
  // applies to ALL of them at once; otherwise just the one.
  const ids = selectedIds.length > 1 ? selectedIds : [id];
  const apply = (patch) => ids.forEach((wid) => updateWall(wid, patch));
  const multi = ids.length > 1;

  return (
    <Panel padding="sm">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>{multi ? `Wände (${ids.length})` : 'Wand'}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{multi ? 'Doppelklick = ganzer Loop' : 'Endpunkte ziehen · Entf löscht'}</span>
      </div>

      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', marginBottom: 4 }}>Typ</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {Object.entries(WALL_TYPES).map(([k, def]) => (
          <button key={k} onClick={() => apply({ kind: k })}
            style={{ ...S.row, ...(wall.kind === k ? S.active : null) }}>
            <span style={{ width: 12, height: 12, borderRadius: 2, background: def.color }} />
            {def.label}
          </button>
        ))}
      </div>

      {wall.kind === 'door' && (
        <label style={S.check}>
          <input type="checkbox" checked={!!wall.open} onChange={(e) => apply({ open: e.target.checked })} />
          Tür offen (blockt nichts)
        </label>
      )}

      {wall.kind === 'window' && (
        <>
          <label style={S.check} title="Fenster lassen Sicht & Licht immer durch; offen ist rein optisch (invertiertes Symbol).">
            <input type="checkbox" checked={!!wall.open} onChange={(e) => apply({ open: e.target.checked })} />
            Fenster offen (Symbol invertiert)
          </label>
          <label style={S.check} title="Milchglas: helles Licht wird beim Durchscheinen eine Stufe gedämpft (hell → dim dahinter); Dämmerlicht bleibt. Bei offenem Fenster ohne Wirkung.">
            <input type="checkbox" checked={!!wall.milky} onChange={(e) => apply({ milky: e.target.checked })} />
            Milchglas (dämpft Licht)
          </label>
        </>
      )}

      {(wall.kind === 'door' || wall.kind === 'window') && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', marginBottom: 4 }}>
            Anzeigebreite ({Math.round((wall.widthCells ?? 0.7) * 100)}% Feld)
          </div>
          <input type="range" min="0.2" max="2" step="0.1" value={wall.widthCells ?? 0.7}
            onChange={(e) => apply({ widthCells: +e.target.value })} style={{ width: '100%' }} />
        </div>
      )}

      {wall.kind === 'cover' && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', marginBottom: 4 }}>
            Sicht von innen (ft) — wer so nah am Busch steht, sieht raus
          </div>
          <input type="number" min="0" step="5" value={wall.seeOutFt ?? 5}
            onChange={(e) => apply({ seeOutFt: Math.max(0, +e.target.value || 0) })}
            style={{ width: 80, padding: '4px 6px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }} />
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', marginBottom: 4 }}>
          Höhe (ft) — 0 = volle Wand; erhöhte Token sehen über niedrigere Wände
        </div>
        <input type="number" min="0" step="5" value={wall.heightFt ?? 0}
          onChange={(e) => apply({ heightFt: Math.max(0, +e.target.value || 0) })}
          style={{ width: 80, padding: '4px 6px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }} />
      </div>

      <label style={{ ...S.check, marginTop: 8 }} title="Geschlossener Loop ohne Dach: erhöhte Token können hineinsehen (sonst überdacht = kein Einblick)">
        <input type="checkbox" checked={!!wall.noRoof} onChange={(e) => apply({ noRoof: e.target.checked })} />
        Loop ohne Dach (von oben einsehbar)
      </label>

      <label style={{ ...S.check, marginTop: 8 }} title="Loop von außen einsehbar: man sieht alles im Loop, der Schatten fällt nur dahinter (z. B. niedrige Mauer, Geländer)">
        <input type="checkbox" checked={!!wall.seeThrough} onChange={(e) => apply({ seeThrough: e.target.checked })} />
        Von außen einsehbar (Schatten nur dahinter)
      </label>

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
  row: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)', textAlign: 'left' },
  active: { border: '1px solid var(--color-accent)', color: 'var(--color-accent)' },
  check: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', marginTop: 8 },
};
