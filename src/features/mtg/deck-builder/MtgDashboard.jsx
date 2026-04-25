// src/features/mtg/deck-builder/MtgDashboard.jsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../core/supabase/client';
import { useAuth } from '../../../core/auth/AuthContext';
import { Panel } from '../../../shared/ui';
import DashboardLayout from '../../../shared/dashboard/DashboardLayout';

const COLOR_STYLE = {
  W: '#e0b352', U: '#4a8fd9', B: '#8a7fa8',
  R: '#e06a5a', G: '#6ab06a', C: '#808080',
};
const COLOR_LABEL = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };

// Default category order for known formats; rest sort alphabetically after these
const FORMAT_ORDER = [
  'Standard', 'Modern', 'Pioneer', 'Pauper', 'Legacy', 'Vintage',
  'Commander', 'Brawl', 'Historic', 'Limited', 'Cube',
];

export default function MtgDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadDecks = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from('mtg_decks')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (err) setError(err.message);
    else setDecks(data || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadDecks(); }, [loadDecks]);

  async function handleDelete(deckId, deckName) {
    if (!window.confirm(`Deck "${deckName}" wirklich löschen?`)) return;
    const { error: err } = await supabase
      .from('mtg_decks')
      .delete()
      .eq('id', deckId)
      .eq('user_id', user.id);
    if (err) alert(`Löschen fehlgeschlagen: ${err.message}`);
    else loadDecks();
  }

  return (
    <>
      {error && (
        <div style={{
          maxWidth: 1200, margin: '0 auto',
          padding: 'var(--space-3) var(--space-5)',
          color: 'var(--color-danger)',
        }}>
          Fehler beim Laden: {error}
        </div>
      )}
      <DashboardLayout
        title="Meine Decks"
        newButtonLabel="+ Neues Deck"
        onNew={() => navigate('/mtg/deck/new')}
        items={decks}
        loading={loading}
        getCategory={(deck) => deck.format || 'Kein Format'}
        categoryOrder={FORMAT_ORDER}
        storageKey="mtg-dashboard-collapsed"
        emptyIcon="✦"
        emptyTitle="Noch keine Decks"
        emptyDescription="Erstelle dein erstes Deck, um loszulegen."
        renderItem={(deck) => (
          <DeckCard
            key={deck.id}
            deck={deck}
            onOpen={() => navigate(`/mtg/deck/${deck.id}`)}
            onDelete={() => handleDelete(deck.id, deck.name)}
          />
        )}
      />
    </>
  );
}

function DeckCard({ deck, onOpen, onDelete }) {
  const data = deck.data || {};
  const mainCount = Object.values(data.mainboard || {}).reduce((s, e) => s + (e.count || 0), 0);
  const sideCount = Object.values(data.sideboard || {}).reduce((s, e) => s + (e.count || 0), 0);

  // Aggregate colors
  const colorCounts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const { card, count } of Object.values(data.mainboard || {})) {
    if (!card?.colors || card.colors.length === 0) colorCounts.C += count;
    else for (const c of card.colors) if (colorCounts[c] !== undefined) colorCounts[c] += count;
  }
  const activeColors = Object.entries(colorCounts).filter(([, v]) => v > 0);

  return (
    <Panel
      style={{
        display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
        cursor: 'pointer',
        transition: 'transform var(--transition), border-color var(--transition)',
      }}
      onClick={onOpen}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--color-accent)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)',
            marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {deck.name || 'Unbenanntes Deck'}
          </div>
          {deck.format && (
            <div style={{
              display: 'inline-block', fontSize: 'var(--fs-xs)',
              color: 'var(--color-text-muted)', textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}>
              {deck.format}
            </div>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{
            background: 'transparent', border: 'none',
            color: 'var(--color-text-dim)', cursor: 'pointer',
            padding: 4, borderRadius: 4, fontSize: 16,
          }}
          title="Deck löschen"
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-dim)'}
        >✕</button>
      </div>

      <div style={{
        display: 'flex', gap: 'var(--space-4)', color: 'var(--color-text-muted)',
        fontSize: 'var(--fs-sm)',
      }}>
        <div>
          <span style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-semibold)' }}>
            {mainCount}
          </span>
          {' '}Mainboard
        </div>
        {sideCount > 0 && (
          <div>
            <span style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-semibold)' }}>
              {sideCount}
            </span>
            {' '}Sideboard
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, alignItems: 'center', minHeight: 24, flexWrap: 'wrap' }}>
        {activeColors.length === 0 ? (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-dim)' }}>
            Leeres Deck
          </span>
        ) : activeColors.map(([c, count]) => (
          <div
            key={c}
            title={`${COLOR_LABEL[c]}: ${count}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 999,
              background: `${COLOR_STYLE[c]}22`,
              border: `1px solid ${COLOR_STYLE[c]}66`,
              fontSize: 'var(--fs-xs)',
              color: 'var(--color-text)',
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: COLOR_STYLE[c],
            }} />
            {count}
          </div>
        ))}
      </div>

      <div style={{
        fontSize: 'var(--fs-xs)', color: 'var(--color-text-dim)',
        borderTop: '1px solid var(--color-border)',
        paddingTop: 'var(--space-2)',
      }}>
        Aktualisiert: {new Date(deck.updated_at).toLocaleDateString('de-DE')}
      </div>
    </Panel>
  );
}