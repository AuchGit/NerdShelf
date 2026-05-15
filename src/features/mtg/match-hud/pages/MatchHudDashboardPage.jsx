// src/features/mtg/match-hud/pages/MatchHudDashboardPage.jsx
//
// Landing page for the Match HUD feature. Three modes the user can be in:
//   - 'idle'   → two big cards: "Create" + "Join". This is the default
//                landing state once they click the MTG sub-nav tab.
//   - 'create' → CreateMatchPanel; on submit we insert a match row and
//                bounce to the live session.
//   - 'join'   → JoinMatchPanel; on submit we upsert the user's player
//                row and bounce to the live session.
//
// We also list "active matches" the user is already part of, with a quick
// rejoin link — phone closes and reopens during a game, this matters.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import MtgSubNav from '../../deck-builder/components/MtgSubNav';
import { useAuth } from '../../../../core/auth/AuthContext';
import { Panel } from '../../../../shared/ui';
import { createMatch, joinMatch, listUserMatches } from '../services/matchApi';
import { formatCode } from '../services/matchCodes';
import CreateMatchPanel from '../components/CreateMatchPanel';
import JoinMatchPanel from '../components/JoinMatchPanel';
import '../MatchHud.css';

export default function MatchHudDashboardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, playerName } = useAuth();
  const [mode, setMode] = useState(() => {
    // Allow deep-linking to the join flow from a shared URL like
    // /mtg/match?code=ABC123 — convenient for messaging the join code over
    // chat without writing the full UI flow.
    if (searchParams.get('code')) return 'join';
    return 'idle';
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [recent, setRecent] = useState([]);

  // Load the user's active matches (created or joined) for the rejoin list.
  const reload = useCallback(async () => {
    if (!user) return;
    const { data } = await listUserMatches({ userId: user.id });
    setRecent(data || []);
  }, [user]);
  useEffect(() => { reload(); }, [reload]);

  async function handleCreate({ startingLife, playerName: name, color }) {
    if (!user) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await createMatch({ userId: user.id, startingLife });
    if (error || !data) {
      setBusy(false);
      setErr(error?.message || 'Konnte Match nicht erstellen');
      return;
    }
    // Auto-join the creator so they show up as the first player.
    const { error: joinErr } = await joinMatch({
      matchId: data.id,
      userId: user.id,
      playerName: name || playerName || '',
      color: color || 'red',
      startingLife,
    });
    setBusy(false);
    if (joinErr) {
      setErr(joinErr.message);
      return;
    }
    navigate(`/mtg/match/${data.join_code}`);
  }

  async function handleJoin({ match, playerName: name, color, deckId, deckName }) {
    if (!user || !match) return;
    setBusy(true);
    setErr(null);
    const { error } = await joinMatch({
      matchId: match.id,
      userId: user.id,
      playerName: name || playerName || '',
      color,
      deckId,
      deckName,
      startingLife: match.starting_life,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    navigate(`/mtg/match/${match.join_code}`);
  }

  return (
    <>
      <MtgSubNav />
      <div style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: 'var(--space-5) clamp(var(--space-3), 3vw, var(--space-5))',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-5)',
      }}>
        <header>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-2xl)',
            fontWeight: 'var(--fw-semibold)',
          }}>Match HUD</h1>
          <p style={{ marginTop: 'var(--space-2)', color: 'var(--color-text-muted)', fontSize: 'var(--fs-md)' }}>
            Lebenspunkte, Poison-Counter und Decks in Echtzeit für alle Spieler am Tisch — direkt vom Handy.
          </p>
        </header>

        {err && (
          <Panel padding="md" style={{ borderColor: 'var(--color-danger)' }}>
            <span style={{ color: 'var(--color-danger)' }}>{err}</span>
          </Panel>
        )}

        {mode === 'idle' && (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 'var(--space-4)',
            }}>
              <ActionCard
                title="Neues Match"
                description="Lege Startleben fest und teile deinen Join-Code mit den anderen Spielern."
                icon="✦"
                onClick={() => setMode('create')}
              />
              <ActionCard
                title="Match beitreten"
                description="Gib den Join-Code ein und wähle dein Deck und deine Farbe."
                icon="↵"
                onClick={() => setMode('join')}
              />
            </div>

            {recent.length > 0 && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <h2 style={{
                  fontSize: 'var(--fs-md)',
                  margin: 0,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: 'var(--color-text-muted)',
                  fontWeight: 'var(--fw-semibold)',
                }}>Deine Matches</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {recent.map(m => (
                    <RecentRow
                      key={m.id}
                      match={m}
                      onOpen={() => navigate(`/mtg/match/${m.join_code}`)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {mode === 'create' && (
          <CreateMatchPanel
            busy={busy}
            defaultName={playerName || ''}
            onCreate={handleCreate}
            onCancel={() => setMode('idle')}
          />
        )}

        {mode === 'join' && (
          <JoinMatchPanel
            user={user}
            busy={busy}
            defaultName={playerName || ''}
            presetCode={searchParams.get('code') || ''}
            onJoin={handleJoin}
            onCancel={() => setMode('idle')}
          />
        )}
      </div>
    </>
  );
}

function ActionCard({ title, description, icon, onClick }) {
  return (
    <Panel
      padding="lg"
      onClick={onClick}
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        transition: 'border-color var(--transition), transform var(--transition)',
      }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--color-accent)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
    >
      <div style={{ fontSize: 32, lineHeight: 1, color: 'var(--color-accent)' }}>{icon}</div>
      <div style={{
        fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)',
        color: 'var(--color-text)',
      }}>{title}</div>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>{description}</div>
    </Panel>
  );
}

function RecentRow({ match, onOpen }) {
  return (
    <Panel
      padding="sm"
      onClick={onOpen}
      style={{
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        transition: 'border-color var(--transition)',
      }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--color-accent)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
    >
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontWeight: 'var(--fw-bold)',
        letterSpacing: 1.5,
        fontSize: 'var(--fs-md)',
        padding: '4px 10px',
        background: 'var(--color-bg-sunken)',
        borderRadius: 'var(--radius-sm)',
      }}>{formatCode(match.join_code)}</span>
      <span style={{ flex: 1, color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
        {match.starting_life} Leben · {match.status === 'ended' ? 'beendet' : 'aktiv'}
      </span>
      <span style={{ color: 'var(--color-text-dim)', fontSize: 'var(--fs-xs)' }}>
        {match.updated_at ? new Date(match.updated_at).toLocaleString('de-DE') : ''}
      </span>
    </Panel>
  );
}
