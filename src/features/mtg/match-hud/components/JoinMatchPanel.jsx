// src/features/mtg/match-hud/components/JoinMatchPanel.jsx
//
// Two-step join flow:
//   1. User enters the join code → we look up the match.
//   2. We display the match meta + a deck picker + colour picker → user
//      confirms and we insert their match_players row.
//
// The deck picker is optional (a user might join without a deck), but if
// they do pick one it shows up below their name on the live tile.

import { useEffect, useState } from 'react';
import { supabase } from '../../../../core/supabase/client';
import { Button, Panel } from '../../../../shared/ui';
import { findMatchByCode } from '../services/matchApi';
import { normaliseCode, formatCode } from '../services/matchCodes';
import { pickAvailableColor } from '../services/playerColors';
import ColorPicker from './ColorPicker';

export default function JoinMatchPanel({
  user,
  defaultName = '',
  presetCode = '',
  busy = false,
  onJoin,
  onCancel,
}) {
  const [code, setCode] = useState(presetCode || '');
  const [name, setName] = useState(defaultName);
  const [color, setColor] = useState('blue');
  const [deck, setDeck] = useState(null);   // { id, name } | null
  const [decks, setDecks] = useState([]);
  const [match, setMatch] = useState(null);
  const [lookupErr, setLookupErr] = useState(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  // Pre-fill the join code from the URL if the user landed via a share link.
  useEffect(() => {
    if (presetCode) setCode(normaliseCode(presetCode));
  }, [presetCode]);

  // Load the user's decks so they can pick one to bring to the table. We
  // request only the fields we actually display — no need to pull the full
  // mainboard/sideboard payload.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('mtg_decks')
        .select('id, name, format')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      if (!cancelled) setDecks(data || []);
    })();
    return () => { cancelled = true; };
  }, [user]);

  async function handleLookup(e) {
    e?.preventDefault?.();
    const c = normaliseCode(code);
    if (c.length < 4) { setLookupErr('Code zu kurz'); return; }
    setLookupBusy(true);
    setLookupErr(null);
    const { data, error } = await findMatchByCode(c);
    setLookupBusy(false);
    if (error)        { setLookupErr(error.message); return; }
    if (!data)        { setLookupErr('Kein Match mit diesem Code'); return; }
    setMatch(data);
    // Auto-pick a free colour if the default clashes (best-effort — we
    // don't have the player list here, so the picker still lets you change).
    setColor(pickAvailableColor([]));
  }

  function handleJoin(e) {
    e?.preventDefault?.();
    if (!match) return;
    onJoin?.({
      match,
      playerName: name.trim(),
      color,
      deckId: deck?.id || null,
      deckName: deck?.name || '',
    });
  }

  if (!match) {
    return (
      <Panel padding="lg" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <form onSubmit={handleLookup} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div>
            <Label>Join-Code</Label>
            <input
              className="mh-code-input"
              value={code}
              onChange={(e) => setCode(normaliseCode(e.target.value))}
              placeholder="ABC123"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              maxLength={7}
              inputMode="text"
            />
          </div>
          {lookupErr && (
            <div style={{ color: 'var(--color-danger)', fontSize: 'var(--fs-sm)' }}>{lookupErr}</div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {onCancel && <Button type="button" variant="ghost" size="lg" onClick={onCancel}>Abbrechen</Button>}
            <Button type="submit" size="lg" disabled={lookupBusy || code.length < 4} style={{ flex: 1 }}>
              {lookupBusy ? 'Suche…' : 'Weiter'}
            </Button>
          </div>
        </form>
      </Panel>
    );
  }

  return (
    <Panel padding="lg" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
        Match gefunden: <strong style={{ color: 'var(--color-text)' }}>{formatCode(match.join_code)}</strong>
        <span style={{ marginLeft: 'var(--space-2)' }}>· Start: {match.starting_life} Leben</span>
      </div>

      <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
          <Label>Deck (optional)</Label>
          <select
            value={deck?.id || ''}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return setDeck(null);
              const found = decks.find(d => d.id === id);
              setDeck(found ? { id: found.id, name: found.name } : null);
            }}
            style={{ width: '100%' }}
          >
            <option value="">— Ohne Deck beitreten —</option>
            {decks.map(d => (
              <option key={d.id} value={d.id}>
                {d.name || 'Unbenanntes Deck'}{d.format ? ` · ${d.format}` : ''}
              </option>
            ))}
          </select>
          <div style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--fs-xs)',
            color: 'var(--color-text-dim)',
          }}>
            Du kannst auch ohne Deck beitreten — der Eintrag bleibt dann einfach leer.
          </div>
        </div>

        <div>
          <Label>Deine Farbe</Label>
          <ColorPicker value={color} onChange={setColor} />
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button type="button" variant="ghost" size="lg" onClick={() => setMatch(null)}>Zurück</Button>
          <Button type="submit" size="lg" disabled={busy} style={{ flex: 1 }}>
            {busy ? 'Trete bei…' : 'Match beitreten'}
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
