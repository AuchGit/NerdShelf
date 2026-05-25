// src/features/mtg/deck-builder/MtgDashboard.jsx
import { useState, useEffect, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../core/supabase/client';
import { useAuth } from '../../../core/auth/AuthContext';
import { Panel, ActionSheet } from '../../../shared/ui';
import DashboardLayout from '../../../shared/dashboard/DashboardLayout';
import { useMtgPriceSettings } from './services/priceThresholds';
import MtgSubNav from './components/MtgSubNav';
import { ShareTokenBadge } from '../../../shared/tokens';
import { ImportedSection, useImports } from '../../../shared/imports';
import { ShareButton, useDeepLinkImport } from '../../../shared/sharing';
import { readList, writeList, invalidate, subscribe } from '../../../shared/cache/listCache';
import useLongPress from '../../../shared/hooks/useLongPress';
import usePwaMobile from '../../../shared/hooks/usePwaMobile';

const COLOR_STYLE = {
  W: '#e0b352', U: '#4a8fd9', B: '#8a7fa8',
  R: '#e06a5a', G: '#6ab06a', C: '#808080',
};
const COLOR_LABEL = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };

// Subtle 1px ring around text — only applied when a cover image sits behind
// the card, so the text stays readable across light and dark artworks.
const TEXT_SHADOW = '0 0 2px var(--color-bg-elevated), 0 0 2px var(--color-bg-elevated)';

// Default category order for known formats; rest sort alphabetically after these
const FORMAT_ORDER = [
  'Standard', 'Modern', 'Pioneer', 'Pauper', 'Legacy', 'Vintage',
  'Commander', 'Brawl', 'Historic', 'Limited', 'Cube',
];

export default function MtgDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Show cached decks instantly on re-navigation; the background refetch
  // below updates silently. Skip the spinner entirely when cache is warm.
  const cacheKey = user ? `mtg_decks:${user.id}` : null;
  const cached = cacheKey ? readList(cacheKey) : null;
  const [decks, setDecks] = useState(() => cached ?? []);
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState(null);
  const [importStatus, setImportStatus] = useState(null);   // shared-link feedback
  const imports = useImports({ domain: 'mtg_deck' });

  // Deep link: `<APP>/mtg/?import=<token>` → auto-add the shared deck.
  useDeepLinkImport({
    param: 'import',
    onToken: async (token) => {
      try {
        const r = await imports.add(token);
        setImportStatus({ ok: true, msg: `„${r.entityName}" hinzugefügt.` });
      } catch (e) {
        setImportStatus({ ok: false, msg: e.message || String(e) });
      }
      setTimeout(() => setImportStatus(null), 4000);
    },
  });

  const loadDecks = useCallback(async () => {
    if (!user) return;
    // No setLoading(true) here — initial value already reflects cache
    // presence, and a background refetch shouldn't blink the spinner.
    const { data, error: err } = await supabase
      .from('mtg_decks')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (err) {
      setError(err.message);
    } else {
      const rows = data || [];
      setDecks(rows);
      writeList(`mtg_decks:${user.id}`, rows);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { loadDecks(); }, [loadDecks]);

  // Pick up invalidations from other components (currently only this
  // dashboard writes, but the subscription is cheap insurance for future
  // call sites — e.g. an import path that ends here).
  useEffect(() => {
    if (!cacheKey) return;
    return subscribe(cacheKey, (next) => {
      if (next === null) loadDecks();
      else setDecks(next);
    });
  }, [cacheKey, loadDecks]);

  async function handleDelete(deckId, deckName) {
    if (!window.confirm(`Deck "${deckName}" wirklich löschen?`)) return;
    const { error: err } = await supabase
      .from('mtg_decks')
      .delete()
      .eq('id', deckId)
      .eq('user_id', user.id);
    if (err) { alert(`Löschen fehlgeschlagen: ${err.message}`); return; }
    if (cacheKey) invalidate(cacheKey);
    loadDecks();
  }

  async function handleDuplicate(deck) {
    if (!user) return;
    const baseName = deck.name || 'Unbenanntes Deck';
    const newName = `${baseName} (Kopie)`;
    // Strip share_token so the DB trigger mints a fresh one — the
    // unique index would otherwise reject the insert. id / timestamps
    // are stripped too so the row gets defaults rather than overwriting
    // them with the source row's values.
    const { id: _ignore, created_at: _c, updated_at: _u, share_token: _t, ...rest } = deck;
    const payload = {
      ...rest,
      user_id: user.id,
      name: newName,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = await supabase
      .from('mtg_decks')
      .insert(payload)
      .select()
      .single();
    if (err) { alert(`Duplizieren fehlgeschlagen: ${err.message}`); return; }
    if (cacheKey) invalidate(cacheKey);
    loadDecks();
  }

  return (
    <>
      <MtgSubNav />
      {error && (
        <div style={{
          maxWidth: 1200, margin: '0 auto',
          padding: 'var(--space-3) var(--space-5)',
          color: 'var(--color-danger)',
        }}>
          Fehler beim Laden: {error}
        </div>
      )}
      {importStatus && (
        <div style={{
          maxWidth: 1200, margin: '0 auto',
          padding: 'var(--space-2) var(--space-5)',
          fontSize: 'var(--fs-sm)',
          color: importStatus.ok ? 'var(--color-success)' : 'var(--color-danger)',
        }}>
          {importStatus.ok ? '✓ ' : '⚠ '}{importStatus.msg}
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
            onDuplicate={() => handleDuplicate(deck)}
          />
        )}
      />

      <ImportedSection
        title="Importierte Decks"
        entities={imports.entities}
        owners={imports.owners}
        loading={imports.loading}
        tableMissing={imports.tableMissing}
        domain="mtg_deck"
        onImport={imports.add}
        onRemove={imports.remove}
        getSubCategory={(deck) => deck.format || 'Kein Format'}
        subCategoryOrder={FORMAT_ORDER}
        storageKey="mtg-imports-collapsed"
        renderItem={(deck, ctx) => (
          <DeckCard
            key={deck.id}
            deck={deck}
            onOpen={() => navigate(`/mtg/deck/view/${deck.share_token}`)}
            onRemove={ctx.onRemove}
            readOnly
            ownerName={ctx.ownerName}
          />
        )}
      />
    </>
  );
}

// memo: deck objects are heavy (full Scryfall card data inside data.mainboard)
// and the parent Dashboard re-renders for many unrelated reasons (form
// state, hover, etc.). Skipping render unless the deck reference actually
// changes is a big win on dashboards with 10+ decks.
const DeckCard = memo(function DeckCard({ deck, onOpen, onDelete, onDuplicate, readOnly = false, ownerName, onRemove }) {
  const data = deck.data || {};
  const priceSettings = useMtgPriceSettings();
  const { isPwaMobile } = usePwaMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Long-press surfaces the same delete/duplicate actions that desktop
  // exposes via the icon buttons in the card's top-right corner. We keep
  // those buttons visible on desktop and rely on long-press on PWA mobile
  // (where the icons feel cramped and tap-prone).
  const longPress = useLongPress(() => setSheetOpen(true), { enabled: isPwaMobile });
  const mainCount = Object.values(data.mainboard || {}).reduce((s, e) => s + (e.count || 0), 0);
  const sideCount = Object.values(data.sideboard || {}).reduce((s, e) => s + (e.count || 0), 0);

  // Total deck price (Cardmarket EUR via Scryfall): commander + main + side
  const eurOf = (card) => {
    const raw = card?.prices?.eur ?? card?.prices?.eur_foil;
    const n = raw == null ? null : Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const sumEur = (entries) =>
    Object.values(entries || {}).reduce((s, e) => {
      const p = eurOf(e?.card);
      return p != null ? s + p * (e.count || 0) : s;
    }, 0);
  const totalEur =
    sumEur(data.mainboard) +
    sumEur(data.sideboard) +
    (data.commander ? (eurOf(data.commander) || 0) : 0);

  const overDeckThreshold =
    priceSettings.deckEnabled
    && priceSettings.deckThresholdEur > 0
    && totalEur > priceSettings.deckThresholdEur;

  // Aggregate colors
  const colorCounts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const { card, count } of Object.values(data.mainboard || {})) {
    if (!card?.colors || card.colors.length === 0) colorCounts.C += count;
    else for (const c of card.colors) if (colorCounts[c] !== undefined) colorCounts[c] += count;
  }
  // Sort: WUBRG entries by count desc, then colorless at the end (regardless of count)
  const colorEntries = Object.entries(colorCounts)
    .filter(([c, v]) => v > 0 && c !== 'C')
    .sort((a, b) => b[1] - a[1]);
  if (colorCounts.C > 0) colorEntries.push(['C', colorCounts.C]);
  const totalColored = colorEntries.reduce((s, [, v]) => s + v, 0);

  // Cover artwork: look up the chosen card in commander / main / side, prefer art_crop image
  const coverId = data.coverCardId;
  let coverArt = null;
  if (coverId) {
    const cmd = data.commander && data.commander.id === coverId ? data.commander : null;
    const entry = data.mainboard?.[coverId] || data.sideboard?.[coverId];
    const cardObj = cmd || entry?.card;
    if (cardObj) {
      coverArt =
        cardObj.image_uris?.art_crop ||
        cardObj.card_faces?.[0]?.image_uris?.art_crop ||
        cardObj.image_uris?.normal ||
        cardObj.card_faces?.[0]?.image_uris?.normal ||
        null;
    }
  }

  return (
    <Panel
      {...longPress}
      style={{
        display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        isolation: 'isolate',
        transition: 'transform var(--transition), border-color var(--transition)',
        borderColor: overDeckThreshold ? 'var(--color-danger, #e06a5a)' : undefined,
      }}
      onClick={onOpen}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = overDeckThreshold
        ? 'var(--color-danger, #e06a5a)'
        : 'var(--color-accent)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = overDeckThreshold
        ? 'var(--color-danger, #e06a5a)'
        : 'var(--color-border)'}
    >
      {coverArt && (
        <>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', inset: 0,
              backgroundImage: `url(${coverArt})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              opacity: 0.55,
              zIndex: -2,
              pointerEvents: 'none',
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-bg-elevated) 25%, transparent) 0%, color-mix(in srgb, var(--color-bg-elevated) 55%, transparent) 100%)',
              zIndex: -1,
              pointerEvents: 'none',
            }}
          />
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)',
            marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            textShadow: coverArt ? TEXT_SHADOW : undefined,
          }}>
            {deck.name || 'Unbenanntes Deck'}
          </div>
          {deck.format && (
            <div style={{
              display: 'inline-block', fontSize: 'var(--fs-xs)',
              color: 'var(--color-text-muted)', textTransform: 'uppercase',
              letterSpacing: 0.5,
              textShadow: coverArt ? TEXT_SHADOW : undefined,
            }}>
              {deck.format}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {readOnly ? (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--color-text-dim)', cursor: 'pointer',
                padding: 4, borderRadius: 4, fontSize: 16,
              }}
              title="Import entfernen"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-dim)'}
            >⊘</button>
          ) : (
            <>
              {onDuplicate && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--color-text-dim)', cursor: 'pointer',
                    padding: 4, borderRadius: 4, fontSize: 14,
                  }}
                  title="Deck duplizieren"
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-accent)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-dim)'}
                >⎘</button>
              )}
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
            </>
          )}
        </div>
      </div>

      {readOnly && ownerName && (
        <div style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--color-text-dim)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          textShadow: coverArt ? TEXT_SHADOW : undefined,
        }}>
          👁 Nur lesen · von {ownerName}
        </div>
      )}

      <div style={{
        display: 'flex', gap: 'var(--space-4)', color: 'var(--color-text-muted)',
        fontSize: 'var(--fs-sm)',
        textShadow: coverArt ? TEXT_SHADOW : undefined,
        alignItems: 'center', flexWrap: 'wrap',
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
        {totalEur > 0 && (
          <div
            title={overDeckThreshold
              ? `Über deinem Limit von ${priceSettings.deckThresholdEur.toFixed(2)} €`
              : 'Cardmarket Trend (EUR via Scryfall)'}
            style={{
              marginLeft: 'auto',
              color: overDeckThreshold
                ? 'var(--color-danger, #e06a5a)'
                : 'var(--color-accent, #d4a017)',
              fontWeight: 'var(--fw-semibold)',
              fontVariantNumeric: 'tabular-nums',
              textShadow: coverArt ? TEXT_SHADOW : undefined,
            }}
          >
            {overDeckThreshold && '⚠ '}≈ {totalEur.toFixed(2)} €
          </div>
        )}
      </div>

      <ColorBar entries={colorEntries} total={totalColored} />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        fontSize: 'var(--fs-xs)', color: 'var(--color-text-dim)',
        borderTop: '1px solid var(--color-border)',
        paddingTop: 'var(--space-2)',
        textShadow: coverArt ? TEXT_SHADOW : undefined,
      }}>
        <span>Aktualisiert: {new Date(deck.updated_at).toLocaleDateString('de-DE')}</span>
        <span style={{ flex: 1 }} />
        {deck.share_token && (
          <>
            <ShareTokenBadge token={deck.share_token} label="Deck-Token" compact />
            <ShareButton kind="mtg_deck" token={deck.share_token} name={deck.name} compact />
          </>
        )}
      </div>

      {/* Long-press menu — PWA mobile only. Desktop keeps the existing
          inline icon buttons in the top-right of the card. */}
      <ActionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={deck.name || 'Deck'}
        items={[
          { id: 'open',  label: 'Öffnen',     icon: '↗', onSelect: () => onOpen?.() },
          { id: 'dup',   label: 'Duplizieren', icon: '⎘', onSelect: () => onDuplicate?.() },
          { id: 'del',   label: 'Löschen',     icon: '🗑', danger: true,
            onSelect: () => onDelete?.() },
        ]}
      />
    </Panel>
  );
}, (a, b) => (
  a.deck === b.deck
  && a.readOnly === b.readOnly
  && a.ownerName === b.ownerName
));

function ColorBar({ entries, total }) {
  if (!entries.length || total === 0) {
    return (
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-dim)', minHeight: 10 }}>
        Leeres Deck
      </div>
    );
  }

  // Cumulative start position (0..1) for each segment so we can place a count
  // label exactly where the colour begins on the bar.
  let acc = 0;
  const labels = entries.map(([c, n]) => {
    const startPct = (acc / total) * 100;
    acc += n;
    return { c, n, startPct };
  });

  return (
    <div
      role="img"
      aria-label={entries.map(([c, n]) => `${COLOR_LABEL[c]} ${n}`).join(', ')}
      style={{ position: 'relative', paddingTop: 14 }}
    >
      {/* Count labels anchored at each segment's left edge */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 12, pointerEvents: 'none' }}>
        {labels.map(({ c, n, startPct }) => (
          <span
            key={c}
            title={`${COLOR_LABEL[c]}: ${n} (${Math.round((n / total) * 100)}%)`}
            style={{
              position: 'absolute',
              left: `${startPct}%`,
              transform: startPct > 92 ? 'translateX(-100%)' : 'translateX(-2px)',
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1,
              color: COLOR_STYLE[c],
              textShadow: '0 0 3px var(--color-bg-elevated), 0 0 3px var(--color-bg-elevated)',
              whiteSpace: 'nowrap',
            }}
          >
            {n}
          </span>
        ))}
      </div>

      {/* The bar itself */}
      <div
        style={{
          display: 'flex',
          height: 10,
          borderRadius: 999,
          overflow: 'hidden',
          background: 'var(--color-bg-sunken)',
          border: '1px solid var(--color-border)',
        }}
      >
        {entries.map(([c, n]) => (
          <div
            key={c}
            title={`${COLOR_LABEL[c]}: ${n} (${Math.round((n / total) * 100)}%)`}
            style={{
              flex: n,
              background: COLOR_STYLE[c],
              minWidth: 4,
            }}
          />
        ))}
      </div>
    </div>
  );
}