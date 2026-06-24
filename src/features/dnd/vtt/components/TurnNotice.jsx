// Center-screen turn hints for players: a big "Your turn" when it's your turn,
// and a "Next turn" heads-up when you're up next. Both dismiss on the next
// interaction. The DM doesn't get them (they drive the tracker).
import { useEffect, useRef, useState } from 'react';
import { useVtt, useSession } from '../state/useVtt';
import { patchCombat } from '../sync/characterBinding';

function controlsToken(token, uid) {
  if (!token) return false;
  const ctl = token.controllers || [];
  return (token.kind === 'player' && token.ownerId === uid) || ctl.includes(uid) || ctl.includes('all');
}

export default function TurnNotice() {
  const init = useVtt((s) => s.initiative);
  const tokens = useVtt((s) => s.tokens);
  const session = useSession();
  const [dismissed, setDismissed] = useState(null);
  const resetKeyRef = useRef(null);

  const len = init?.order?.length || 0;
  const activeTokenId = init?.active && len ? init.order[init.activeIndex]?.tokenId : null;
  const nextTokenId = init?.active && len ? init.order[(init.activeIndex + 1) % len]?.tokenId : null;
  const mine = session.role !== 'dm' && controlsToken(tokens[activeTokenId], session.userId);
  const nextMine = session.role !== 'dm' && !mine && controlsToken(tokens[nextTokenId], session.userId);
  const mode = mine ? 'turn' : nextMine ? 'next' : null;
  // Key changes when the active combatant / round changes (so each turn re-shows).
  const turnKey = init?.active ? `${activeTokenId}:${init.round}:${init.activeIndex}` : null;
  const show = !!(mode && turnKey && dismissed !== turnKey);

  // Start of MY turn → automatically refresh the action economy (action / bonus
  // / reaction) so D&D's "you regain your actions at the start of your turn"
  // happens when the DM advances initiative back to me. Once per turn.
  useEffect(() => {
    if (!mine || !turnKey || resetKeyRef.current === turnKey) return;
    resetKeyRef.current = turnKey;
    const charId = tokens[activeTokenId]?.characterId;
    if (charId != null) patchCombat(charId, { economy: { action: false, bonusAction: false, reaction: false } });
  }, [mine, turnKey, activeTokenId, tokens]);

  useEffect(() => {
    if (!show) return undefined;
    const dismiss = () => setDismissed(turnKey);
    window.addEventListener('pointerdown', dismiss, { once: true });
    window.addEventListener('keydown', dismiss, { once: true });
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', dismiss); };
  }, [show, turnKey]);

  if (!show) return null;
  const isTurn = mode === 'turn';
  const accent = isTurn ? '#43d17a' : '#ffd24a';
  const name = tokens[isTurn ? activeTokenId : nextTokenId]?.name || 'Your character';
  return (
    <div style={S.wrap}>
      <div style={{ ...S.badge, border: `3px solid ${accent}`, boxShadow: `0 0 60px -8px ${accent}` }}>
        <div style={{ ...S.title, color: accent }}>{isTurn ? 'Your turn' : 'Next turn'}</div>
        <div style={S.sub}>{name} — round {init.round}. {isTurn ? 'Click anywhere to continue.' : 'Get ready — you’re up next.'}</div>
      </div>
    </div>
  );
}

const S = {
  wrap: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 80 },
  badge: { pointerEvents: 'none', textAlign: 'center', padding: '30px 64px', borderRadius: 20, background: 'rgba(15,17,21,0.92)' },
  title: { fontSize: 56, fontWeight: 900, letterSpacing: 1, lineHeight: 1 },
  sub: { marginTop: 12, fontSize: 18, color: 'var(--color-text-muted)' },
};
