// "Du bist dran" prompt for players. When initiative advances to a token the
// player controls, a banner appears; it dismisses on the next click anywhere
// (or when the turn moves on). DM doesn't get it (they drive the tracker).
import { useEffect, useState } from 'react';
import { useVtt, useSession } from '../state/useVtt';

function controlsToken(token, uid) {
  if (!token) return false;
  const ctl = token.controllers || [];
  return (token.kind === 'player' && token.ownerId === uid) || ctl.includes(uid) || ctl.includes('all');
}

export default function TurnNotice() {
  const init = useVtt((s) => s.initiative);
  const tokens = useVtt((s) => s.tokens);
  const session = useSession();
  // Track which turn was dismissed; the banner shows whenever it's my turn and
  // I haven't dismissed THIS turn yet (derived — no setState-in-effect).
  const [dismissed, setDismissed] = useState(null);

  const len = init?.order?.length || 0;
  const activeTokenId = init?.active && len ? init.order[init.activeIndex]?.tokenId : null;
  const nextTokenId = init?.active && len ? init.order[(init.activeIndex + 1) % len]?.tokenId : null;
  const mine = session.role !== 'dm' && controlsToken(tokens[activeTokenId], session.userId);
  const nextMine = session.role !== 'dm' && !mine && controlsToken(tokens[nextTokenId], session.userId);
  // Key changes whenever the active combatant (or round) changes.
  const turnKey = init?.active ? `${activeTokenId}:${init.round}:${init.activeIndex}` : null;
  const show = !!(mine && turnKey && dismissed !== turnKey);

  // Dismiss on the next interaction anywhere (click / keypress / canvas action).
  useEffect(() => {
    if (!show) return undefined;
    const dismiss = () => setDismissed(turnKey);
    window.addEventListener('pointerdown', dismiss, { once: true });
    window.addEventListener('keydown', dismiss, { once: true });
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', dismiss); };
  }, [show, turnKey]);

  // Small unobtrusive "You're next" hint while waiting for your upcoming turn.
  if (nextMine) {
    return <div style={S.nextHint}>You&apos;re next</div>;
  }
  if (!show) return null;
  const name = tokens[activeTokenId]?.name || 'Your character';
  return (
    <div style={S.wrap}>
      <div style={S.badge}>
        <div style={S.title}>Your turn</div>
        <div style={S.sub}>{name} — round {init.round}. Click anywhere to continue.</div>
      </div>
    </div>
  );
}

const S = {
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 80 },
  badge: { pointerEvents: 'none', textAlign: 'center', padding: '18px 34px', borderRadius: 16, background: 'rgba(15,17,21,0.92)', border: '2px solid var(--color-accent)', boxShadow: '0 0 40px -6px var(--color-accent)', animation: 'none' },
  title: { fontSize: 30, fontWeight: 900, color: 'var(--color-accent)', letterSpacing: 0.5 },
  sub: { marginTop: 6, fontSize: 14, color: 'var(--color-text-muted)' },
  // Small corner hint shown while you are the next combatant up.
  nextHint: { position: 'absolute', top: 150, left: '50%', transform: 'translateX(-50%)', zIndex: 60, padding: '4px 12px', borderRadius: 999, background: 'rgba(15,17,21,0.85)', border: '1px solid var(--color-warning,#e0af68)', color: 'var(--color-warning,#e0af68)', fontSize: 12, fontWeight: 700, pointerEvents: 'none' },
};
