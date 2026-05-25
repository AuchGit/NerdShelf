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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import MtgSubNav from '../../deck-builder/components/MtgSubNav';
import { useAuth } from '../../../../core/auth/AuthContext';
import { Panel } from '../../../../shared/ui';
import {
  createMatch, joinMatch, listUserMatches,
  listOpenMatches, subscribeOpenMatchesChanges,
} from '../services/matchApi';
import { formatCode } from '../services/matchCodes';
import { getColor } from '../services/playerColors';
import CreateMatchPanel from '../components/CreateMatchPanel';
import JoinMatchPanel from '../components/JoinMatchPanel';
import CreateLocalMatchPanel from '../components/CreateLocalMatchPanel';
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
  const [open, setOpen] = useState([]);

  // Load the user's active matches (created or joined) for the rejoin list.
  const reload = useCallback(async () => {
    if (!user) return;
    const { data } = await listUserMatches({ userId: user.id });
    setRecent(data || []);
  }, [user]);
  useEffect(() => { reload(); }, [reload]);

  // Load the global list of "open" matches (status != ended, < 24h old)
  // and keep it live via a Supabase realtime subscription. We debounce
  // refetches because rapid HP / poison taps trigger postgres_changes on
  // mtg_match_players too, which we don't actually care to surface — we
  // only need the player COUNT to stay roughly current. 400 ms collapses
  // bursts into a single refetch.
  const refetchOpenRef = useRef(null);
  const scheduleRefetchOpen = useCallback(() => {
    if (refetchOpenRef.current) clearTimeout(refetchOpenRef.current);
    refetchOpenRef.current = setTimeout(async () => {
      refetchOpenRef.current = null;
      const { data } = await listOpenMatches({ limit: 40, hoursMax: 24 });
      setOpen(data || []);
    }, 400);
  }, []);
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    (async () => {
      const { data } = await listOpenMatches({ limit: 40, hoursMax: 24 });
      if (!cancelled) setOpen(data || []);
    })();
    const unsub = subscribeOpenMatchesChanges(() => {
      if (!cancelled) scheduleRefetchOpen();
    });
    return () => {
      cancelled = true;
      if (refetchOpenRef.current) clearTimeout(refetchOpenRef.current);
      unsub?.();
    };
  }, [user, scheduleRefetchOpen]);

  // Open matches the user is NOT in yet — the discovery grid. Matches
  // they already joined are surfaced in "Deine Matches" below, so we
  // dedupe to avoid showing the same row twice.
  const userMatchIds = new Set([
    ...recent.map(m => m.id),
    ...open
      .filter(m => (m.players_meta || []).some(p => p.user_id === user?.id))
      .map(m => m.id),
  ]);
  const discoverable = open.filter(m => !userMatchIds.has(m.id));

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
            {/* Discovery grid: every match still in lobby / live status
                that the user hasn't joined yet. Updates live via a
                Supabase realtime channel — newly created matches pop in
                without a reload, player counts adjust as people join. */}
            {discoverable.length > 0 && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <h2 style={sectionLabelStyle}>
                  Offene Matches <span style={{ color: 'var(--color-text-dim)' }}>·</span>{' '}
                  <span style={{ color: 'var(--color-text-muted)', fontWeight: 'var(--fw-medium)' }}>
                    {discoverable.length}
                  </span>
                </h2>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 'var(--space-3)',
                }}>
                  {discoverable.map(m => (
                    <OpenMatchCard
                      key={m.id}
                      match={m}
                      onJoin={() => navigate(`/mtg/match/${m.join_code}`)}
                    />
                  ))}
                </div>
              </section>
            )}

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
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
              <ActionCard
                title="Lokales Match"
                description="Ein Gerät für alle — Handy in die Tischmitte, jeder bedient seine Kachel."
                icon="◉"
                onClick={() => setMode('local')}
              />
            </div>

            {recent.length > 0 && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <h2 style={sectionLabelStyle}>Deine Matches</h2>
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

        {mode === 'local' && (
          <CreateLocalMatchPanel
            onCreate={({ players, startingLife }) => {
              navigate(`/mtg/match/local?players=${players}&life=${startingLife}`);
            }}
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

const sectionLabelStyle = {
  fontSize: 'var(--fs-md)',
  margin: 0,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'var(--color-text-muted)',
  fontWeight: 'var(--fw-semibold)',
};

function OpenMatchCard({ match, onJoin }) {
  // Colour dots derived from the player roster so a glance at the card
  // tells you how many people are at the table and which colours are
  // taken — useful for picking a non-clashing colour before tapping
  // join.
  const players = match.players_meta || [];
  const statusBadge = match.status === 'live'
    ? { label: 'Live', color: 'var(--color-success)' }
    : { label: 'Lobby', color: 'var(--color-warning)' };
  return (
    <Panel
      padding="md"
      onClick={onJoin}
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        transition: 'border-color var(--transition), transform var(--transition)',
      }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--color-accent)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 'var(--fw-bold)',
          letterSpacing: 1.5,
          fontSize: 'var(--fs-md)',
          padding: '4px 10px',
          background: 'var(--color-bg-sunken)',
          borderRadius: 'var(--radius-sm)',
        }}>{formatCode(match.join_code)}</span>
        <span style={{ flex: 1 }} />
        <span style={{
          fontSize: 'var(--fs-xs)',
          fontWeight: 'var(--fw-semibold)',
          color: statusBadge.color,
          padding: '2px 8px',
          borderRadius: 999,
          background: `color-mix(in srgb, ${statusBadge.color} 18%, transparent)`,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>{statusBadge.label}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {players.slice(0, 6).map(p => (
            <span
              key={p.id}
              title={p.player_name || 'Spieler'}
              style={{
                width: 16, height: 16, borderRadius: '50%',
                background: getColor(p.color).bg,
                border: '1px solid var(--color-border)',
                flexShrink: 0,
              }}
            />
          ))}
          {players.length > 6 && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
              +{players.length - 6}
            </span>
          )}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
          {match.player_count} Spieler · {match.starting_life} Leben
        </span>
      </div>

      <div style={{
        fontSize: 'var(--fs-xs)',
        color: 'var(--color-text-dim)',
        paddingTop: 'var(--space-1)',
        borderTop: '1px solid var(--color-border)',
      }}>
        {match.updated_at ? `Aktiv seit ${relativeTime(match.updated_at)}` : ''}
      </div>
    </Panel>
  );
}

function relativeTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1)  return 'gerade eben';
  if (min < 60) return `${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} Std`;
  return new Date(iso).toLocaleDateString('de-DE');
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
