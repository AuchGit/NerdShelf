// src/features/mtg/match-hud/components/CreateMatchPanel.jsx
//
// "Start a new match" form. Choose a starting life (preset or custom) and the
// creator's player colour. On submit, the parent calls into matchApi to
// insert the match row and bounces to /mtg/match/:joinCode.

import { useState } from 'react';
import { Button, Panel } from '../../../../shared/ui';
import ColorPicker from './ColorPicker';

const PRESETS = [20, 30, 40];

export default function CreateMatchPanel({
  busy = false,
  defaultName = '',
  defaultColor = 'red',
  onCreate,
  onCancel,
}) {
  const [life, setLife] = useState(20);
  const [custom, setCustom] = useState('');
  const [name, setName] = useState(defaultName);
  const [color, setColor] = useState(defaultColor);

  // Resolve the actual starting life: a preset chip *or* a non-empty custom
  // value (custom takes precedence so users can override after picking).
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
    onCreate?.({
      startingLife: effectiveLife,
      playerName: name.trim(),
      color,
    });
  }

  return (
    <Panel padding="lg" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div>
          <Label>Startleben</Label>
          <div className="mh-life-options" style={{ marginBottom: 'var(--space-2)' }}>
            {PRESETS.map(p => (
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

        <div>
          <Label>Dein Anzeigename</Label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. Miles"
            maxLength={32}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <Label>Deine Farbe</Label>
          <ColorPicker value={color} onChange={setColor} />
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {onCancel && (
            <Button type="button" variant="ghost" size="lg" onClick={onCancel}>Abbrechen</Button>
          )}
          <Button type="submit" size="lg" disabled={busy || !effectiveLife} style={{ flex: 1 }}>
            {busy ? 'Erstelle…' : 'Match starten'}
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
