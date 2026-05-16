// src/features/mtg/match-hud/pages/MatchHudSessionPage.jsx
//
// The live HUD. URL is /mtg/match/:joinCode. Responsibilities:
//   1. Resolve the join code → match → call into useMatchSession for state.
//   2. If the current user isn't in the match yet, show the JoinMatchPanel
//      inline (instead of a separate /join route). They tap a row, fill in
//      colour + name, and they're playing.
//   3. Render the player tiles in a layout adapted to the player count and
//      whose tile belongs to the current user (their own tile is larger).
//
// Layout rules (portrait phone, "own tile prominent"):
//   - 1 player  → fill screen.
//   - 2 players → 2/3 own + 1/3 opponent stacked.
//   - 3 players → own full-width on top, two below.
//   - 4+        → 2-column grid, own first.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../../core/auth/AuthContext';
import { Button, IconButton } from '../../../../shared/ui';
import { findMatchByCode, joinMatch } from '../services/matchApi';
import { formatCode } from '../services/matchCodes';
import useMatchSession from '../hooks/useMatchSession';
import usePwaMobile from '../../../../shared/hooks/usePwaMobile';
import useSwipe from '../../../../shared/hooks/useSwipe';
import PlayerTile from '../components/PlayerTile';
import PlayerSettingsModal from '../components/PlayerSettingsModal';
import JoinMatchPanel from '../components/JoinMatchPanel';
import '../MatchHud.css';

export default function MatchHudSessionPage() {
  const { joinCode } = useParams();
  const navigate = useNavigate();
  const { user, playerName } = useAuth();
  const { isPwaMobile } = usePwaMobile();

  // Resolve the code → match id. We could embed this in useMatchSession but
  // keeping the lookup outside lets us show the "not found" state cleanly.
  const [matchId, setMatchId] = useState(null);
  const [lookupErr, setLookupErr] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(true);

  useEffect(() => {
    if (!joinCode) return;
    let cancelled = false;
    setLookupLoading(true);
    (async () => {
      const { data, error } = await findMatchByCode(joinCode);
      if (cancelled) return;
      if (error)   { setLookupErr(error.message); setLookupLoading(false); return; }
      if (!data)   { setLookupErr('Match nicht gefunden'); setLookupLoading(false); return; }
      setMatchId(data.id);
      setLookupErr(null);
      setLookupLoading(false);
    })();
    return () => { cancelled = true; };
  }, [joinCode]);

  const session = useMatchSession(matchId, user?.id || null);
  const {
    match, me, others, presence, loading, error,
    adjustLife, adjustPoison, setLife, setPoison, setColor, setPlayerName, setDeck, leave,
  } = session;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);

  // Lock the page from scrolling ONLY while we're in the actual HUD. The
  // pre-game join screen is a regular column of form fields that may be
  // taller than the viewport on small phones — locking scroll there would
  // leave the user unable to reach the "Match beitreten" button.
  useEffect(() => {
    if (!me) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [me]);

  const allPlayers = useMemo(
    () => (me ? [me, ...others] : others),
    [me, others]
  );

  // ── Top-level loading / error ────────────────────────
  if (lookupLoading || loading) {
    return <Centered>Lade Match…</Centered>;
  }
  if (lookupErr || error) {
    return (
      <Centered>
        <div style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-3)' }}>
          {lookupErr || error}
        </div>
        <Button onClick={() => navigate('/mtg/match')}>Zurück</Button>
      </Centered>
    );
  }
  if (!match) {
    return (
      <Centered>
        <div style={{ marginBottom: 'var(--space-3)' }}>Match nicht verfügbar.</div>
        <Button onClick={() => navigate('/mtg/match')}>Zurück</Button>
      </Centered>
    );
  }

  // ── Not yet joined: show the join form for *this* match ──
  if (!me) {
    return (
      <div style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: 'var(--space-5) clamp(var(--space-3), 3vw, var(--space-5))',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
      }}>
        <div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
            Match-Code
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontWeight: 'var(--fw-bold)',
            fontSize: 'var(--fs-2xl)', letterSpacing: 4,
          }}>
            {formatCode(match.join_code)}
          </div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
            Startleben: {match.starting_life} · {allPlayers.length} Spieler bisher
          </div>
        </div>
        <JoinMatchPanel
          user={user}
          busy={joinBusy}
          defaultName={playerName || ''}
          presetCode={match.join_code}
          onCancel={() => navigate('/mtg/match')}
          onJoin={async ({ playerName: name, color, deckId, deckName }) => {
            setJoinBusy(true);
            await joinMatch({
              matchId: match.id,
              userId: user.id,
              playerName: name,
              color,
              deckId,
              deckName,
              startingLife: match.starting_life,
            });
            setJoinBusy(false);
          }}
        />
      </div>
    );
  }

  // ── In-match HUD ────────────────────────────────────
  const total = allPlayers.length;
  const gridClass = total === 1 ? 'mh-grid-one'
    : total === 2 ? 'mh-grid-two-own'
    : '';
  // Multiplayer 3+ uses default 2-column auto rows. We render own first so
  // it lands top-left, the visual "home" position on a phone.

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(match.join_code);
    } catch { /* ignore */ }
  }

  async function handleShare() {
    const url = `${window.location.origin}/mtg/match?code=${match.join_code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'MTG Match HUD', text: 'Tritt meinem Match bei', url });
        return;
      } catch { /* fall through */ }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch { /* ignore */ }
  }

  // Swipe-down on the header bar to leave the session — the native
  // "I'm done with this screen" gesture on iOS/Android. Only enabled in
  // PWA mobile mode so the desktop drag-to-select still works.
  const headerSwipe = useSwipe(
    { onSwipeDown: () => navigate('/mtg/match') },
    { enabled: isPwaMobile, minDistance: 50 }
  );

  return (
    <div className="mh-screen" data-mobile={isPwaMobile ? 'true' : 'false'}>
      <div
        className="mh-header"
        {...headerSwipe}
        style={{ touchAction: isPwaMobile ? 'pan-x' : undefined }}
      >
        {isPwaMobile && <span className="pwa-swipe-handle" aria-hidden="true" />}
        <IconButton
          aria-label="Zurück"
          onClick={() => navigate('/mtg/match')}
          style={{ color: 'var(--color-text)' }}
        >←</IconButton>
        <span style={{ color: 'var(--color-text-muted)' }}>Code</span>
        <button
          type="button"
          className="mh-header-code"
          onClick={handleCopyCode}
          title="Code kopieren"
          style={{ cursor: 'pointer', border: 'none', color: 'inherit' }}
        >
          {formatCode(match.join_code)}
        </button>
        <span style={{ color: 'var(--color-text-muted)' }}>· {total} Spieler</span>
        <div className="mh-header-actions">
          <IconButton aria-label="Teilen" onClick={handleShare} title="Code teilen">⤴</IconButton>
        </div>
      </div>

      <div className={`mh-grid ${gridClass}`}>
        {allPlayers.map(p => (
          <PlayerTile
            key={p.id}
            player={p}
            isOwn={p.user_id === user.id}
            isOnline={!!presence[p.user_id]}
            onLifeDelta={p.user_id === user.id ? adjustLife : undefined}
            onPoisonDelta={p.user_id === user.id ? adjustPoison : undefined}
            onOpenSelf={p.user_id === user.id ? () => setSettingsOpen(true) : undefined}
          />
        ))}
      </div>

      <PlayerSettingsModal
        open={settingsOpen}
        player={me}
        onClose={() => setSettingsOpen(false)}
        onSetColor={setColor}
        onSetName={setPlayerName}
        onSetDeck={setDeck}
        onSetLife={setLife}
        onSetPoison={setPoison}
        onLeave={async () => {
          setSettingsOpen(false);
          await leave();
          navigate('/mtg/match');
        }}
      />
    </div>
  );
}

function Centered({ children }) {
  return (
    <div style={{
      minHeight: '60vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      padding: 'var(--space-5)',
      color: 'var(--color-text-muted)',
      textAlign: 'center',
    }}>{children}</div>
  );
}
