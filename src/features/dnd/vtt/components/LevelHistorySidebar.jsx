// Level-history category — the character's level-up timeline (read-only).
// Reuses the levelHistory the builder records on each level-up:
//   { totalLevel, classId, classLevel, timestamp }
import { useVtt } from '../state/useVtt';

export default function LevelHistorySidebar() {
  const myId = useVtt((s) => s.ui.myCharacterId);
  const chars = useVtt((s) => s.ui.characters || {});
  const character = myId != null ? chars[myId]?.data : null;
  if (!character) return <div style={S.muted}>Kein Charakter geladen.</div>;
  const history = character.levelHistory || [];
  if (history.length === 0) return <div style={S.muted}>Keine Level-Historie vorhanden.</div>;

  return (
    <div style={S.list}>
      {[...history].reverse().map((e, i) => (
        <div key={history.length - i} style={S.row}>
          <div style={S.lvl}>{e.totalLevel}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={S.title}>{e.classId}{e.classLevel ? ` ${e.classLevel}` : ''}</div>
            <div style={S.meta}>Gesamtstufe {e.totalLevel}{e.timestamp ? ` · ${fmtDate(e.timestamp)}` : ''}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString(); } catch { return ''; }
}

const S = {
  muted: { color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: 6, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' },
  lvl: { width: 30, height: 30, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', fontWeight: 800 },
  title: { fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: { fontSize: 11, color: 'var(--color-text-muted)' },
};
