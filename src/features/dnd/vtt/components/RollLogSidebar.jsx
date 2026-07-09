// DM-Würfelprotokoll: wer hat wann was mit welcher Formel gewürfelt und was kam
// raus. Jeder Client loggt seine eigenen Würfe (DiceTray → logRoll), der Log
// synct live über den Op-Broadcast — bewusst nicht persistiert (Sitzungs-Log;
// neue Clients starten leer). Neueste oben.
import { useVtt } from '../state/useVtt';

const MODE_LABEL = { adv: 'Vorteil', dis: 'Nachteil', crit: 'Krit' };

function timeOf(ts) {
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

export default function RollLogSidebar() {
  const log = useVtt((s) => s.rollLog || []);
  if (!log.length) {
    return <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>Noch keine Würfe in dieser Sitzung.</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {[...log].reverse().map((e) => (
        <div key={e.id} style={S.row}>
          <div style={S.top}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              {/* Portrait des würfelnden Tokens/Charakters — ohne Quelle KEIN
                  Platzhalter, einfach kein Bild. */}
              {e.portrait && <img src={e.portrait} alt="" style={S.portrait} />}
              <span style={S.name}>{e.name || '—'}</span>
            </span>
            <span style={S.time}>{timeOf(e.ts)}</span>
          </div>
          <div style={S.mid}>
            <span style={S.what}>
              {e.label ? `${e.label} · ` : ''}{e.formula}
              {e.mode && <span style={S.modeTag}>{MODE_LABEL[e.mode] || e.mode}</span>}
            </span>
            <span style={S.total}>{e.total}</span>
          </div>
          {Array.isArray(e.dice) && e.dice.length > 1 && (
            <div style={S.dice}>[{e.dice.join(', ')}]</div>
          )}
        </div>
      ))}
    </div>
  );
}

const S = {
  row: { padding: '4px 8px', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)' },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  name: { fontSize: 11, fontWeight: 700, color: 'var(--color-accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  portrait: { width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid var(--color-border)' },
  time: { fontSize: 10, color: 'var(--color-text-muted)' },
  mid: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  what: { fontSize: 'var(--fs-sm)', color: 'var(--color-text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  total: { fontSize: 15, fontWeight: 800, flexShrink: 0 },
  modeTag: { marginLeft: 6, padding: '0 5px', borderRadius: 999, fontSize: 9, fontWeight: 800, color: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)' },
  dice: { fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 },
};
