// src/features/mtg/deck-builder/MtgDashboard.jsx
import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../core/supabase/client';
import { useAuth } from '../../../core/auth/AuthContext';
import { Panel, ActionSheet } from '../../../shared/ui';
import DashboardLayout from '../../../shared/dashboard/DashboardLayout';
import { useMtgPriceSettings } from './services/priceThresholds';
import { applyPrinting } from './services/deckPrintings';
import MtgSubNav from './components/MtgSubNav';
import { ShareTokenBadge, newShareToken } from '../../../shared/tokens';
import { ImportedSection, useImports } from '../../../shared/imports';
import { ShareButton, useDeepLinkImport } from '../../../shared/sharing';
import { readList, writeList, invalidate, subscribe } from '../../../shared/cache/listCache';
import useLongPress from '../../../shared/hooks/useLongPress';
import usePwaMobile from '../../../shared/hooks/usePwaMobile';
import usePublicDecks from './hooks/usePublicDecks';
import { newDeckVisibility } from './services/deckVisibility';
import { mergeSharedDecks } from './services/sharedDecks';
import { formatLabel } from './services/deckFormats';

const COLOR_STYLE = {
  W: '#e0b352', U: '#4a8fd9', B: '#8a7fa8',
  R: '#e06a5a', G: '#6ab06a', C: '#808080',
};
const COLOR_LABEL = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };

// Subtle 1px ring around text — only applied when a cover image sits behind
// the card, so the text stays readable across light and dark artworks.
const TEXT_SHADOW = '0 0 2px var(--color-bg-elevated), 0 0 2px var(--color-bg-elevated)';

// Phone: which of the two deck tabs is open. Per device.
const TAB_KEY = 'mtg:dashboard-tab';

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
  const publicDecks = usePublicDecks();
  const { isPwaMobile } = usePwaMobile();

  // "Mit mir geteilt": what I imported by token or link, plus what other
  // people shared with everybody.
  const shared = useMemo(
    () => mergeSharedDecks(imports.entities, publicDecks.decks),
    [imports.entities, publicDecks.decks],
  );
  const sharedOwners = useMemo(
    () => ({ ...publicDecks.owners, ...imports.owners }),
    [publicDecks.owners, imports.owners],
  );
  // Only an import can be removed from the list. A public deck stays until
  // its owner stops sharing it.
  const importedTokens = useMemo(
    () => new Set(imports.entities.map(e => e.share_token)),
    [imports.entities],
  );

  // Phone: own and shared decks as two tabs instead of one long page.
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem(TAB_KEY) === 'shared' ? 'shared' : 'own'; } catch { return 'own'; }
  });
  const chooseTab = (next) => {
    setTab(next);
    try { localStorage.setItem(TAB_KEY, next); } catch { /* ignore */ }
  };
  const showOwn = !isPwaMobile || tab === 'own';
  const showShared = !isPwaMobile || tab === 'shared';

  // Deep link: `<APP>/mtg/?import=<token>` → auto-add the shared deck.
  useDeepLinkImport({
    param: 'import',
    onToken: async (token) => {
      try {
        const r = await imports.add(token, { allowExisting: true });
        setImportStatus({ ok: true, msg: `„${r.entityName}" hinzugefügt.` });
        // Opened from a share link → show the deck right away.
        navigate(`/mtg/deck/view/${r.token}`);
      } catch (e) {
        setImportStatus({ ok: false, msg: e.message || String(e) });
      }
      setTimeout(() => setImportStatus(null), 4000);
    },
  });

  // No setLoading(true) on refetch — the initial value already reflects
  // cache presence, and a background refetch shouldn't blink the spinner.
  const fetchDecks = useCallback(async () => {
    if (!user) return null;
    return supabase
      .from('mtg_decks')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
  }, [user]);

  const applyDecks = useCallback((result) => {
    if (!result) return;
    const { data, error: err } = result;
    if (err) {
      setError(err.message);
    } else {
      const rows = data || [];
      setDecks(rows);
      writeList(`mtg_decks:${user.id}`, rows);
    }
    setLoading(false);
  }, [user]);

  const loadDecks = useCallback(async () => {
    applyDecks(await fetchDecks());
  }, [fetchDecks, applyDecks]);

  useEffect(() => {
    let cancelled = false;
    fetchDecks().then(result => { if (!cancelled) applyDecks(result); });
    return () => { cancelled = true; };
  }, [fetchDecks, applyDecks]);

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
    // A copy is its own deck and needs its own share token: the source
    // deck's token stays with the source, and the unique index would
    // reject the insert anyway. Minting here rather than leaving the
    // column empty for the database trigger keeps duplicating working
    // even where that trigger was never installed.
    // id / timestamps are dropped so the row gets fresh ones instead of
    // the source row's.
    // A copy is a new deck, so it starts with the default visibility from
    // the settings rather than inheriting the source's.
    const rest = { ...deck };
    delete rest.id;
    delete rest.created_at;
    delete rest.updated_at;
    delete rest.is_public;
    const payload = {
      ...rest,
      ...newDeckVisibility(),
      user_id: user.id,
      name: newName,
      share_token: newShareToken(),
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

  // "Mit allen teilen" on a tile. The tile flips at once; a failed save
  // flips it back and says why.
  async function handleTogglePublic(deckId, next) {
    if (!user) return;
    const setFlag = (value) => setDecks(prev =>
      prev.map(d => (d.id === deckId ? { ...d, is_public: value } : d)));
    setFlag(next);
    const { error: err } = await supabase
      .from('mtg_decks')
      .update({ is_public: next })
      .eq('id', deckId)
      .eq('user_id', user.id);
    if (err) {
      setFlag(!next);
      alert(/is_public/i.test(err.message)
        ? 'Das Teilen mit allen ist in der Datenbank noch nicht eingerichtet — scripts/mtg-public-decks.sql in Supabase ausführen.'
        : `Ändern fehlgeschlagen: ${err.message}`);
      return;
    }
    if (cacheKey) invalidate(cacheKey);
  }

  const tabBar = isPwaMobile && (
    <div role="tablist" aria-label="Decks" style={S_TABS}>
      {[
        { id: 'own', label: 'Eigene', count: decks.length },
        { id: 'shared', label: 'Mit mir geteilt', count: shared.length },
      ].map(t => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => chooseTab(t.id)}
          style={{ ...S_TAB, ...(tab === t.id ? S_TAB_ACTIVE : null) }}
        >
          {t.label}
          <span style={S_TAB_COUNT}>{t.count}</span>
        </button>
      ))}
    </div>
  );

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
      {tabBar}

      {showOwn && <DashboardLayout
        title="Meine Decks"
        newButtonLabel="+ Neues Deck"
        onNew={() => navigate('/mtg/deck/new')}
        importDomain="mtg_deck"
        onImportToken={imports.add}
        importBusy={imports.loading}
        items={decks}
        loading={loading}
        getCategory={(deck) => formatLabel(deck.format) || 'Kein Format'}
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
            onTogglePublic={() => handleTogglePublic(deck.id, !deck.is_public)}
          />
        )}
      />}

      {showShared && <ImportedSection
        title="Mit mir geteilt"
        entities={shared}
        owners={sharedOwners}
        loading={imports.loading || publicDecks.loading}
        tableMissing={imports.tableMissing}
        domain="mtg_deck"
        onImport={imports.add}
        // On the phone this tab is where you come to add one by token.
        showImportInput={isPwaMobile}
        emptyText="Noch nichts geteilt. Decks, die andere mit allen teilen, erscheinen hier von selbst — oder trag einen Token ein, den dir jemand geschickt hat."
        onRemove={imports.remove}
        getSubCategory={(deck) => formatLabel(deck.format) || 'Kein Format'}
        subCategoryOrder={FORMAT_ORDER}
        storageKey="mtg-imports-collapsed"
        renderItem={(deck, ctx) => (
          <DeckCard
            key={deck.id}
            deck={deck}
            onOpen={() => navigate(`/mtg/deck/view/${deck.share_token}`)}
            onRemove={importedTokens.has(deck.share_token) ? ctx.onRemove : undefined}
            readOnly
            ownerName={ctx.ownerName}
          />
        )}
      />}
    </>
  );
}

// memo: deck objects are heavy (full Scryfall card data inside data.mainboard)
// and the parent Dashboard re-renders for many unrelated reasons (form
// state, hover, etc.). Skipping render unless the deck reference actually
// changes is a big win on dashboards with 10+ decks.
const DeckCard = memo(function DeckCard({ deck, onOpen, onDelete, onDuplicate, onTogglePublic, readOnly = false, ownerName, onRemove }) {
  const data = deck.data || {};
  const priceSettings = useMtgPriceSettings();
  const { isPwaMobile } = usePwaMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Long-press surfaces the same delete/duplicate actions that desktop
  // exposes via the icon buttons in the card's top-right corner. We keep
  // those buttons visible on desktop and rely on long-press on PWA mobile
  // (where the icons feel cramped and tap-prone).
  const longPress = useLongPress(() => setSheetOpen(true), { enabled: isPwaMobile });
  // Someone else's deck on a phone: strip the tile down so more fit on one
  // screen. Nothing is lost that the deck itself doesn't show.
  const compact = readOnly && isPwaMobile;
  const mainCount = Object.values(data.mainboard || {}).reduce((s, e) => s + (e.count || 0), 0)
    + (data.commander ? 1 : 0);
  const sideCount = Object.values(data.sideboard || {}).reduce((s, e) => s + (e.count || 0), 0);

  // Total deck price (Cardmarket EUR via Scryfall): commander + main + side.
  // Cards with a chosen artwork use that printing's price.
  const printings = data.printings || {};
  const eurOf = (rawCard) => {
    const card = applyPrinting(rawCard, rawCard?.id ? printings[rawCard.id] : null);
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
  // Double-faced cards can be covered by their back side too.
  const coverFace = data.coverFaceIndex || 0;
  let coverArt = null;
  if (coverId) {
    const cmd = data.commander && data.commander.id === coverId ? data.commander : null;
    const entry = data.mainboard?.[coverId] || data.sideboard?.[coverId];
    const cardObj = applyPrinting(cmd || entry?.card, printings[coverId]);
    if (cardObj) {
      const face = cardObj.card_faces?.[coverFace]?.image_uris;
      coverArt =
        face?.art_crop ||
        face?.normal ||
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
        display: 'flex', flexDirection: 'column',
        gap: compact ? 'var(--space-2)' : 'var(--space-3)',
        ...(compact ? { padding: 'var(--space-3)' } : null),
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
              {formatLabel(deck.format)}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {readOnly ? (onRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--color-text-dim)', cursor: 'pointer',
                padding: 4, borderRadius: 4, fontSize: 16,
              }}
              title="Import entfernen"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-dim)'}
            >⊘</button>
          )) : (
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

      {!compact && (<div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        fontSize: 'var(--fs-xs)', color: 'var(--color-text-dim)',
        borderTop: '1px solid var(--color-border)',
        paddingTop: 'var(--space-2)',
        textShadow: coverArt ? TEXT_SHADOW : undefined,
        // Date, share toggle, token and share button don't fit one line on
        // a narrow phone tile.
        flexWrap: 'wrap',
        rowGap: 4,
      }}>
        <span>Aktualisiert: {new Date(deck.updated_at).toLocaleDateString('de-DE')}</span>
        {onTogglePublic && (
          <label
            onClick={(e) => e.stopPropagation()}
            title="Alle NerdShelf-Nutzer finden das Deck dann unter „Mit mir geteilt“. Link und Token funktionieren weiterhin."
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              cursor: 'pointer', whiteSpace: 'nowrap',
              color: deck.is_public ? 'var(--color-accent)' : undefined,
            }}
          >
            <input
              type="checkbox"
              checked={!!deck.is_public}
              onChange={() => onTogglePublic()}
              style={{ margin: 0 }}
            />
            Mit allen teilen
          </label>
        )}
        <span style={{ flex: 1 }} />
        {/* Your token, your link — not something to hand on from
            somebody else's deck. */}
        {!readOnly && deck.share_token && (
          <>
            <ShareTokenBadge token={deck.share_token} label="Deck-Token" compact />
            <ShareButton kind="mtg_deck" token={deck.share_token} name={deck.name} compact />
          </>
        )}
      </div>)}

      {/* Long-press menu — PWA mobile only. Desktop keeps the existing
          inline icon buttons in the top-right of the card. */}
      <ActionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={deck.name || 'Deck'}
        items={[
          { id: 'open',  label: 'Öffnen',     icon: '↗', onSelect: () => onOpen?.() },
          ...(onTogglePublic ? [{
            id: 'public',
            label: deck.is_public ? 'Nicht mehr mit allen teilen' : 'Mit allen teilen',
            icon: '⇄',
            onSelect: () => onTogglePublic(),
          }] : []),
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

const S_TABS = {
  display: 'flex', gap: 4, padding: 3,
  margin: 'var(--space-3) var(--space-4) 0',
  background: 'var(--color-bg-sunken)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
};
const S_TAB = {
  flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  minHeight: 40, padding: '6px 10px',
  background: 'transparent', border: 'none',
  borderRadius: 'calc(var(--radius-md) - 2px)',
  color: 'var(--color-text-muted)', fontFamily: 'inherit',
  fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)', cursor: 'pointer',
};
const S_TAB_ACTIVE = {
  background: 'var(--color-bg-elevated)', color: 'var(--color-text)',
  boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
};
const S_TAB_COUNT = {
  fontSize: 'var(--fs-xs)', color: 'var(--color-text-dim)',
  fontVariantNumeric: 'tabular-nums',
};

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
  const labels = [];
  let acc = 0;
  for (const [c, n] of entries) {
    labels.push({ c, n, startPct: (acc / total) * 100 });
    acc += n;
  }

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