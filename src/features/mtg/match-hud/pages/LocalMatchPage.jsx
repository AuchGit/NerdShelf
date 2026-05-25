// src/features/mtg/match-hud/pages/LocalMatchPage.jsx
//
// "Phone in the middle" match HUD. No DB, no realtime, no players list —
// just N equal tiles with auto-assigned colours, each touchable on the
// shared device. State lives in localStorage so an accidental browser
// reload doesn't wipe an active game.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PlayerTile from '../components/PlayerTile';
import { PLAYER_COLORS } from '../services/playerColors';
import '../MatchHud.css';

const STORAGE_KEY = 'nerdshelf_local_match_state';

// Each tile is identified by its colour (only thing visible) so the
// auto-assignment cycles through the curated palette in order.
function buildInitialPlayers(n, startingLife) {
  return Array.from({ length: n }, (_, i) => ({
    id: `local-${i}`,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length].id,
    life: startingLife,
    poison: 0,
  }));
}

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.players) || parsed.players.length === 0) return null;
    return parsed;
  } catch { return null; }
}

function saveStored(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export default function LocalMatchPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Resolve initial state in priority order:
  //   1. ?players= & ?life= query (the create panel just navigated here)
  //   2. Stored state from a previous run
  //   3. Sensible defaults (4 players, 20 life)
  const [state, setState] = useState(() => {
    const qpPlayers = parseInt(searchParams.get('players') || '', 10);
    const qpLife    = parseInt(searchParams.get('life')    || '', 10);
    if (Number.isFinite(qpPlayers) && qpPlayers >= 2 && qpPlayers <= 6) {
      const life = Number.isFinite(qpLife) && qpLife > 0 ? qpLife : 20;
      const fresh = { startingLife: life, players: buildInitialPlayers(qpPlayers, life) };
      saveStored(fresh);
      return fresh;
    }
    const stored = loadStored();
    if (stored) return stored;
    const life = Number.isFinite(qpLife) && qpLife > 0 ? qpLife : 20;
    return { startingLife: life, players: buildInitialPlayers(4, life) };
  });

  // Persist every change.
  useEffect(() => { saveStored(state); }, [state]);

  // Strip the query params after we've used them so a refresh doesn't
  // wipe in-progress edits with the original starting life.
  useEffect(() => {
    if (searchParams.has('players') || searchParams.has('life')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('players');
      url.searchParams.delete('life');
      window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adjustLife = useCallback((idx, delta) => {
    setState(s => ({
      ...s,
      players: s.players.map((p, i) => i === idx ? { ...p, life: p.life + delta } : p),
    }));
  }, []);

  const adjustPoison = useCallback((idx, delta) => {
    setState(s => ({
      ...s,
      players: s.players.map((p, i) =>
        i === idx ? { ...p, poison: Math.max(0, p.poison + delta) } : p
      ),
    }));
  }, []);

  function handleReset() {
    if (!window.confirm('Alle Leben + Poison-Counter zurücksetzen?')) return;
    setState(s => ({
      ...s,
      players: s.players.map(p => ({ ...p, life: s.startingLife, poison: 0 })),
    }));
  }

  function handleEnd() {
    if (!window.confirm('Match beenden?')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    navigate('/mtg/match');
  }

  const n = state.players.length;
  const gridClass = useMemo(() => `mh-grid-local-${Math.max(2, Math.min(6, n))}`, [n]);

  return (
    <div className="mh-screen">
      <div className="mh-header">
        <button
          type="button"
          aria-label="Zurück"
          onClick={() => navigate('/mtg/match')}
          style={{
            background: 'transparent', border: 'none', color: 'var(--color-text)',
            fontSize: 'var(--fs-lg)', cursor: 'pointer', padding: '4px 8px',
          }}
        >←</button>
        <span style={{ color: 'var(--color-text-muted)' }}>Lokal</span>
        <span style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-semibold)' }}>
          {n} Spieler · {state.startingLife} Leben
        </span>
        <div className="mh-header-actions">
          <button
            type="button"
            onClick={handleReset}
            style={{
              background: 'transparent', border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)', borderRadius: 'var(--radius-sm)',
              padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 'var(--fs-sm)',
            }}
            title="Alle Leben + Poison auf den Startwert"
          >↻ Reset</button>
          <button
            type="button"
            onClick={handleEnd}
            style={{
              background: 'transparent', border: '1px solid var(--color-danger)',
              color: 'var(--color-danger)', borderRadius: 'var(--radius-sm)',
              padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 'var(--fs-sm)',
            }}
            title="Match beenden und Stand verwerfen"
          >Beenden</button>
        </div>
      </div>

      <div className={`mh-grid ${gridClass}`}>
        {state.players.map((p, i) => (
          <PlayerTile
            key={p.id}
            player={p}
            isOwn
            hideMeta
            onLifeDelta={(d) => adjustLife(i, d)}
            onPoisonDelta={(d) => adjustPoison(i, d)}
          />
        ))}
      </div>
    </div>
  );
}
