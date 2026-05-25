// src/features/mtg/match-hud/components/CreateLocalMatchPanel.jsx
//
// "Local match" creation form. Stripped down compared to the remote
// version: no name, no color, no join code. Just player count + starting
// life. The resulting match is purely client-side (no DB row) and lives
// at /mtg/match/local — every tile is interactive on the shared device.

import { useState } from 'react';
import { Button, Panel } from '../../../../shared/ui';

const LIFE_PRESETS = [20, 30, 40];
const PLAYER_COUNTS = [2, 3, 4, 5, 6];

export default function CreateLocalMatchPanel({ busy = false, onCreate, onCancel }) {
  const [players, setPlayers] = useState(4);
  const [life, setLife] = useState(20);
  const [custom, setCustom] = useState('');

  const effectiveLife = (() => {
    if (custom.trim() !== '') {
      const n = parseInt(custom, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return life;
  })();

  function handleSubmit(e) {
    e.preventDefault();
    if (!effectiveLife) return;
    onCreate?.({ players, startingLife: effectiveLife });
  }

  return (
    <Panel padding="lg" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)' }}>
          Lokales Match
        </h2>
        <p style={{ marginTop: 'var(--space-2)', color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
          Ein Match auf einem Gerät — Handy in die Tischmitte legen, jeder bedient seine Kachel.
          Farben werden automatisch vergeben, kein Login pro Spieler nötig.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div>
          <Label>Spieleranzahl</Label>
          <div className="mh-life-options">
            {PLAYER_COUNTS.map(n => (
              <button
                key={n}
                type="button"
                className={`mh-life-option ${players === n ? 'is-active' : ''}`}
                onClick={() => setPlayers(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label>Startleben</Label>
          <div className="mh-life-options" style={{ marginBottom: 'var(--space-2)' }}>
            {LIFE_PRESETS.map(p => (
              <button
                key={p}
                type="button"
                className={`mh-life-option ${effectiveLife === p && custom.trim() === '' ? 'is-active' : ''}`}
                onClick={() => { setLife(p); setCustom(''); }}
              >
                {p}
              </button>
            ))}
          </div>
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            placeholder="Eigener Wert…"
            inputMode="numeric"
            pattern="[0-9]*"
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {onCancel && (
            <Button type="button" variant="ghost" size="lg" onClick={onCancel}>Abbrechen</Button>
          )}
          <Button type="submit" size="lg" disabled={busy || !effectiveLife} style={{ flex: 1 }}>
            Match starten
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function Label({ children }) {
  return (
    <div style={{
      fontSize: 'var(--fs-sm)',
      color: 'var(--color-text-muted)',
      fontWeight: 'var(--fw-semibold)',
      marginBottom: 'var(--space-2)',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    }}>{children}</div>
  );
}
