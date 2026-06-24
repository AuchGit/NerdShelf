// Foundry-style initiative overlay across the top of the map. Shows each
// combatant's token portrait in order with their initiative value; the active
// turn is highlighted. Visible only while combat is active. The DM gets
// prev/next controls; clicking a portrait selects that token on the map.
import { useVtt, useIsDM, useSession } from '../state/useVtt';
import { setInitiative, selectToken } from '../state/actions';

function controlsToken(t, uid) {
  if (!t) return false;
  const ctl = t.controllers || [];
  return (t.kind === 'player' && t.ownerId === uid) || ctl.includes(uid) || ctl.includes('all');
}

export default function InitiativeBar() {
  const init = useVtt((s) => s.initiative);
  const tokens = useVtt((s) => s.tokens);
  const isDM = useIsDM();
  const session = useSession();
  if (!init.active || !init.order.length) return null;

  const step = (dir) => {
    let i = init.activeIndex + dir;
    let round = init.round;
    if (i >= init.order.length) { i = 0; round++; }
    if (i < 0) { i = init.order.length - 1; round = Math.max(1, round - 1); }
    setInitiative({ ...init, activeIndex: i, round });
  };

  return (
    <div style={S.wrap}>
      <div style={S.round}>Runde<br /><b style={{ fontSize: 18 }}>{init.round}</b></div>
      {isDM && <button style={S.nav} onClick={() => step(-1)} title="Vorheriger">◀</button>}
      <div style={S.list}>
        {init.order.map((e, i) => {
          const t = tokens[e.tokenId];
          const active = i === init.activeIndex;
          const next = !active && i === (init.activeIndex + 1) % init.order.length;
          const mine = controlsToken(t, session.userId);
          // From the viewer's perspective: GREEN = it's MY turn, RED = someone
          // else's turn, YELLOW = I'm up next. The DM (controls all) keeps the
          // neutral accent for the active turn.
          const activeStyle = (!isDM && mine) ? S.activeMine : (!isDM ? S.activeOther : S.active);
          const bg = t?.imageUrl
            ? { backgroundImage: `url(${t.imageUrl})` }
            : { background: t?.color || '#556' };
          return (
            <div key={e.id} onClick={() => t && selectToken(e.tokenId)}
              style={{ ...S.item, ...bg, ...(active ? activeStyle : next ? S.next : null) }}
              title={active ? `${e.name} — am Zug${mine ? ' (du!)' : ''}` : next ? `${e.name} — als Nächstes${mine ? ' (du!)' : ''}` : e.name}>
              {!t?.imageUrl && <div style={S.initial}>{(e.name || '?').slice(0, 1).toUpperCase()}</div>}
              {next && <div style={{ ...S.nextTag, ...(mine ? S.nextTagMine : null) }}>{mine ? 'du bist nächste' : 'nächste'}</div>}
              <div style={S.val}>{e.value}</div>
              <div style={S.caption}>
                <div style={S.nameTxt}>{e.name}</div>
                {t?.hp != null && t?.hpMax ? <div style={S.hp}>{t.hp}/{t.hpMax}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
      {isDM && <button style={S.nav} onClick={() => step(1)} title="Nächster">▶</button>}
    </div>
  );
}

const S = {
  wrap: { position: 'absolute', top: 100, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'rgba(15,17,21,0.85)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', backdropFilter: 'blur(4px)', zIndex: 50, maxWidth: '90%' },
  round: { textAlign: 'center', fontSize: 10, color: 'var(--color-text-muted)', lineHeight: 1.1, padding: '0 4px' },
  nav: { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', width: 32, height: 58 },
  list: { display: 'flex', gap: 7, overflowX: 'auto', padding: '2px' },
  // Each combatant = a rectangle filled with the token image (cover), text on top.
  item: { position: 'relative', width: 76, height: 96, borderRadius: 9, overflow: 'hidden', cursor: 'pointer', border: '2px solid transparent', flexShrink: 0, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: 'inset 0 0 0 1px #0006' },
  active: { border: '3px solid var(--color-accent)', boxShadow: '0 0 12px var(--color-accent)', transform: 'translateY(-2px)' },
  activeMine: { border: '3px solid #43d17a', boxShadow: '0 0 14px #43d17a', transform: 'translateY(-2px)' },
  activeOther: { border: '3px solid #e5484d', boxShadow: '0 0 12px #e5484d', transform: 'translateY(-2px)' },
  next: { border: '2px dashed #e0af68', boxShadow: '0 0 8px -2px #e0af68' },
  nextTag: { position: 'absolute', top: 2, left: 2, fontSize: 8, fontWeight: 800, color: '#1a1a1a', background: '#e0af68', borderRadius: 4, padding: '0 4px', textTransform: 'uppercase' },
  nextTagMine: { background: '#ffd24a' },
  initial: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 32 },
  val: { position: 'absolute', top: 2, right: 2, minWidth: 20, textAlign: 'center', padding: '0 4px', fontSize: 13, fontWeight: 800, color: '#fff', background: 'rgba(0,0,0,0.6)', borderRadius: 6 },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: '10px 3px 3px', background: 'linear-gradient(transparent, rgba(0,0,0,0.85))' },
  nameTxt: { fontSize: 10, fontWeight: 700, color: '#fff', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.15 },
  hp: { fontSize: 10, color: '#cfe0ff', textAlign: 'center', lineHeight: 1.15 },
};
