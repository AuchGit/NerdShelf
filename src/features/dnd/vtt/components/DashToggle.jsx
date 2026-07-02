// A small "Dash" pill for whoever drives the active combatant (the controlling
// player, or the DM). The movement overlay shows only the normal speed range by
// default; HOVER this pill to preview the doubled Dash range, or CLICK to lock
// it on for the turn. Resets automatically when the turn moves on.
import { useEffect, useRef, useState } from 'react';
import { useVtt, useSession } from '../state/useVtt';
import { setShowDash } from '../state/actions';

function controlsToken(token, uid) {
  if (!token) return false;
  const ctl = token.controllers || [];
  return (token.kind === 'player' && token.ownerId === uid) || ctl.includes(uid) || ctl.includes('all');
}

export default function DashToggle() {
  const init = useVtt((s) => s.initiative);
  const tokens = useVtt((s) => s.tokens);
  const session = useSession();
  const [locked, setLocked] = useState(false);
  const [hover, setHover] = useState(false);
  const turnRef = useRef(null);

  const len = init?.order?.length || 0;
  const activeTokenId = init?.active && len ? init.order[init.activeIndex]?.tokenId : null;
  const isDM = session.role === 'dm';
  const drives = !!activeTokenId && (isDM || controlsToken(tokens[activeTokenId], session.userId));
  const turnKey = activeTokenId ? `${activeTokenId}:${init?.round}:${init?.activeIndex}` : null;

  // New turn (or no longer driving) → drop any lingering lock and overlay.
  useEffect(() => {
    if (turnRef.current !== turnKey) { turnRef.current = turnKey; setLocked(false); setHover(false); }
  }, [turnKey]);

  // The store flag the renderer reads follows lock OR hover; always cleared when
  // this pill isn't shown so a previous turn's Dash can't bleed through.
  useEffect(() => {
    setShowDash(drives && (locked || hover));
    return () => setShowDash(false);
  }, [drives, locked, hover]);

  if (!drives) return null;
  const on = locked || hover;
  return (
    <button
      style={{ ...S.pill, ...(on ? S.on : null) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => setLocked((v) => !v)}
      title="Dash: Bewegungsreichweite verdoppeln (Hover = Vorschau, Klick = fixieren)"
    >
      ⚡ Dash{locked ? ' ✓' : ''}
    </button>
  );
}

const S = {
  pill: {
    position: 'absolute', bottom: 150, left: '50%', transform: 'translateX(-50%)', zIndex: 70,
    background: 'color-mix(in srgb, var(--color-bg-elevated) 92%, transparent)', color: 'var(--color-text)', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)', padding: '6px 14px', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 700,
  },
  on: { borderColor: '#ffa53d', color: '#ffa53d', boxShadow: '0 0 12px -3px #ffa53d' },
};
