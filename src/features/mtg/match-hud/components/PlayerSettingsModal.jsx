// src/features/mtg/match-hud/components/PlayerSettingsModal.jsx
//
// Per-player options dialog reachable from the gear icon on the user's own
// tile. Lets you rename, swap colour, swap deck, manually set life, or leave
// the match. Kept lightweight — taking the user away from the tabletop view
// for more than a few seconds is a UX regression.

import { useEffect, useState } from 'react';
import { supabase } from '../../../../core/supabase/client';
import { Button, Modal } from '../../../../shared/ui';
import { useAuth } from '../../../../core/auth/AuthContext';
import ColorPicker from './ColorPicker';

export default function PlayerSettingsModal({
  open,
  player,
  onClose,
  onSetColor,
  onSetName,
  onSetDeck,
  onSetLife,
  onSetPoison,
  onLeave,
}) {
  const { user } = useAuth();
  const [decks, setDecks] = useState([]);
  const [name, setName] = useState(player?.player_name || '');
  const [lifeStr, setLifeStr] = useState(String(player?.life ?? 20));
  const [poisonStr, setPoisonStr] = useState(String(player?.poison ?? 0));

  useEffect(() => {
    if (!open) return;
    setName(player?.player_name || '');
    setLifeStr(String(player?.life ?? 20));
    setPoisonStr(String(player?.poison ?? 0));
  }, [open, player]);

  useEffect(() => {
    if (!open || !user) return;
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
  }, [open, user]);

  if (!open || !player) return null;

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed !== player.player_name) onSetName?.(trimmed);
  };

  const commitLife = () => {
    const n = parseInt(lifeStr, 10);
    if (Number.isFinite(n) && n !== player.life) onSetLife?.(n);
  };

  const commitPoison = () => {
    const n = parseInt(poisonStr, 10);
    if (Number.isFinite(n) && n !== player.poison) onSetPoison?.(Math.max(0, n));
  };

  return (
    <Modal open={open} onClose={onClose} title="Deine Einstellungen" width={420}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            maxLength={32}
            style={{ width: '100%' }}
          />
        </Field>

        <Field label="Farbe">
          <ColorPicker value={player.color} onChange={onSetColor} />
        </Field>

        <Field label="Deck">
          <select
            value={player.deck_id || ''}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return onSetDeck?.({ deckId: null, deckName: '' });
              const found = decks.find(d => d.id === id);
              onSetDeck?.({ deckId: found?.id || null, deckName: found?.name || '' });
            }}
            style={{ width: '100%' }}
          >
            <option value="">— Ohne Deck —</option>
            {decks.map(d => (
              <option key={d.id} value={d.id}>
                {d.name || 'Unbenanntes Deck'}{d.format ? ` · ${d.format}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <Field label="Leben">
            <input
              value={lifeStr}
              onChange={(e) => setLifeStr(e.target.value.replace(/[^0-9-]/g, ''))}
              onBlur={commitLife}
              inputMode="numeric"
              style={{ width: '100%' }}
            />
          </Field>
          <Field label="Poison">
            <input
              value={poisonStr}
              onChange={(e) => setPoisonStr(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={commitPoison}
              inputMode="numeric"
              style={{ width: '100%' }}
            />
          </Field>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border)',
        }}>
          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              if (window.confirm('Match wirklich verlassen?')) onLeave?.();
            }}
            style={{ color: 'var(--color-danger)' }}
          >
            Match verlassen
          </Button>
          <Button onClick={onClose}>Schließen</Button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{
        fontSize: 'var(--fs-xs)',
        color: 'var(--color-text-muted)',
        fontWeight: 'var(--fw-semibold)',
        marginBottom: 'var(--space-2)',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}>{label}</div>
      {children}
    </div>
  );
}
