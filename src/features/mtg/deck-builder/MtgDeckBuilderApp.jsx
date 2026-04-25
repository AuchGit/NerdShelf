// src/features/mtg/deck-builder/MtgDeckBuilderApp.jsx
import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../../core/supabase/client';
import { useAuth } from '../../../core/auth/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import CardSearch  from './components/CardSearch';
import CardList    from './components/CardList';
import DeckPanel   from './components/DeckPanel';
import CardPreview from './components/CardPreview';
import ImportDeckModal from './components/ImportDeckModal';
import { useScryfall } from './hooks/useScryfall';
import { copyDecklistToClipboard } from './services/deckExport';
import './MtgDeckBuilder.css';
import './App.css';

export default function MtgDeckBuilderApp() {
  const { deckId } = useParams();             // undefined for /mtg/deck/new
  const navigate = useNavigate();
  const { user } = useAuth();

  // ── Deck meta ─────────────────────────────────────────
  const [deckName, setDeckName] = useState('Unbenanntes Deck');
  const [deckFormat, setDeckFormat] = useState('');
  const [mainboard, setMainboard] = useState({});
  const [sideboard, setSideboard] = useState({});
  const [loadingDeck, setLoadingDeck] = useState(!!deckId);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [exportStatus, setExportStatus] = useState(null);

  // track if deck has been dirty since last save
  const [dirty, setDirty] = useState(false);
  const skipDirtyRef = useRef(false);   // prevents initial-load marking dirty

  // ── Search state ─────────────────────────────────────
  const [query,      setQuery]      = useState('');
  const [searchMode, setSearchMode] = useState('name');
  const [colors,     setColors]     = useState([]);
  const [colorMode,  setColorMode]  = useState('any');
  const [cardType,   setCardType]   = useState('');
  const [sortOrder,  setSortOrder]  = useState('name');
  const [sortDir,    setSortDir]    = useState('asc');
  const [showLands,  setShowLands]  = useState(false);
  const [rarity,  setRarity]  = useState('');
  const [cmcMin,  setCmcMin]  = useState('');
  const [cmcMax,  setCmcMax]  = useState('');
  const [subtype, setSubtype] = useState('');
  const [format,  setFormat]  = useState('');
  const [setCode, setSetCode] = useState('');

  // ── Preview state ────────────────────────────────────
  const [hoveredCard,  setHoveredCard]  = useState(null);
  const [pinnedCard,   setPinnedCard]   = useState(null);
  const [lastSeenCard, setLastSeenCard] = useState(null);

  const { cards, loading, error, hasMore, totalCards, loadMore } = useScryfall({
    query, searchMode, colors, colorMode, cardType, sortOrder, sortDir, showLands,
    rarity, cmcMin, cmcMax, subtype, format, setCode,
  });

  const previewCard = pinnedCard || hoveredCard;
  useEffect(() => {
    if (previewCard) setLastSeenCard(previewCard);
  }, [previewCard]);

  const displayCard = previewCard || lastSeenCard;
  const isStale     = !previewCard && !!lastSeenCard;

  // ── Load existing deck ───────────────────────────────
  useEffect(() => {
    if (!deckId || !user) return;
    let cancelled = false;
    (async () => {
      setLoadingDeck(true);
      const { data, error: err } = await supabase
        .from('mtg_decks')
        .select('*')
        .eq('id', deckId)
        .eq('user_id', user.id)
        .single();
      if (cancelled) return;
      if (err) {
        setLoadError(err.message);
        setLoadingDeck(false);
        return;
      }
      skipDirtyRef.current = true;
      setDeckName(data.name || 'Unbenanntes Deck');
      setDeckFormat(data.format || '');
      setMainboard(data.data?.mainboard || {});
      setSideboard(data.data?.sideboard || {});
      setLoadingDeck(false);
      // allow dirty tracking to resume after next tick
      setTimeout(() => { skipDirtyRef.current = false; }, 0);
    })();
    return () => { cancelled = true; };
  }, [deckId, user]);

  // mark dirty whenever deck content changes (but not on initial load)
  useEffect(() => {
    if (skipDirtyRef.current) return;
    setDirty(true);
  }, [mainboard, sideboard, deckName, deckFormat]);

  // ── Mainboard mutations ──────────────────────────────
  const addToMain = useCallback((card) => {
    setMainboard(prev => {
      const existing = prev[card.id];
      return {
        ...prev,
        [card.id]: existing
          ? { ...existing, count: existing.count + 1 }
          : { card, count: 1 },
      };
    });
  }, []);

  const updateMainCount = useCallback((cardId, delta) => {
    setMainboard(prev => {
      const entry = prev[cardId];
      if (!entry) return prev;
      const next = entry.count + delta;
      if (next <= 0) {
        const { [cardId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [cardId]: { ...entry, count: next } };
    });
  }, []);

  const removeMain = useCallback((cardId) => {
    setMainboard(prev => {
      const { [cardId]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  // ── Sideboard mutations ──────────────────────────────
  const updateSideCount = useCallback((cardId, delta) => {
    setSideboard(prev => {
      const entry = prev[cardId];
      if (!entry) return prev;
      const next = entry.count + delta;
      if (next <= 0) {
        const { [cardId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [cardId]: { ...entry, count: next } };
    });
  }, []);

  const removeSide = useCallback((cardId) => {
    setSideboard(prev => {
      const { [cardId]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  // ── Transfer between main/side ───────────────────────
  const moveToSideboard = useCallback((cardId) => {
    setMainboard(prev => {
      const entry = prev[cardId];
      if (!entry) return prev;
      const newMainEntry = entry.count - 1;
      const nextMain = { ...prev };
      if (newMainEntry <= 0) delete nextMain[cardId];
      else nextMain[cardId] = { ...entry, count: newMainEntry };
      setSideboard(side => {
        const s = side[cardId];
        return {
          ...side,
          [cardId]: s
            ? { ...s, count: s.count + 1 }
            : { card: entry.card, count: 1 },
        };
      });
      return nextMain;
    });
  }, []);

  const moveToMainboard = useCallback((cardId) => {
    setSideboard(prev => {
      const entry = prev[cardId];
      if (!entry) return prev;
      const newSide = entry.count - 1;
      const nextSide = { ...prev };
      if (newSide <= 0) delete nextSide[cardId];
      else nextSide[cardId] = { ...entry, count: newSide };
      setMainboard(main => {
        const m = main[cardId];
        return {
          ...main,
          [cardId]: m
            ? { ...m, count: m.count + 1 }
            : { card: entry.card, count: 1 },
        };
      });
      return nextSide;
    });
  }, []);

  const clearDeck = useCallback(() => {
    setMainboard({});
    setSideboard({});
  }, []);

  // We still pass a deck-shaped object to CardList because CardItem reads deckCount from it.
  // Combine main+side counts so the badge reflects total presence in the deck.
  const combinedForCardList = {};
  for (const id of Object.keys(mainboard)) {
    combinedForCardList[id] = { count: mainboard[id].count + (sideboard[id]?.count || 0) };
  }
  for (const id of Object.keys(sideboard)) {
    if (!combinedForCardList[id]) {
      combinedForCardList[id] = { count: sideboard[id].count };
    }
  }

  // ── Preview handlers ─────────────────────────────────
  const handlePin = useCallback((card) => {
    setPinnedCard(prev => (prev?.id === card?.id ? null : card));
  }, []);
  const handleUnpin = useCallback(() => setPinnedCard(null), []);

  // ── Save ─────────────────────────────────────────────
  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setSaveStatus(null);
    const payload = {
      user_id: user.id,
      name: deckName.trim() || 'Unbenanntes Deck',
      format: deckFormat || null,
      data: { mainboard, sideboard },
      updated_at: new Date().toISOString(),
    };

    let result;
    if (deckId) {
      result = await supabase
        .from('mtg_decks')
        .update(payload)
        .eq('id', deckId)
        .eq('user_id', user.id)
        .select()
        .single();
    } else {
      result = await supabase
        .from('mtg_decks')
        .insert(payload)
        .select()
        .single();
    }

    setSaving(false);
    if (result.error) {
      setSaveStatus({ type: 'error', text: result.error.message });
      return;
    }
    setSaveStatus({ type: 'success', text: 'Gespeichert' });
    setDirty(false);
    setTimeout(() => setSaveStatus(null), 2000);

    if (!deckId && result.data?.id) {
      navigate(`/mtg/deck/${result.data.id}`, { replace: true });
    }
  }

  // ── Import / Export ──────────────────────────────────
  function handleImport({ mainboard: importedMain, sideboard: importedSide }) {
    setMainboard(importedMain);
    setSideboard(importedSide);
  }

  async function handleExport() {
    const ok = await copyDecklistToClipboard(mainboard, sideboard);
    setExportStatus(ok
      ? { type: 'success', text: 'In Zwischenablage kopiert' }
      : { type: 'error',   text: 'Kopieren fehlgeschlagen' }
    );
    setTimeout(() => setExportStatus(null), 2000);
  }

  // ── Render ───────────────────────────────────────────
  if (loadingDeck) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>
        Lade Deck…
      </div>
    );
  }
  if (loadError) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{ color: 'var(--color-danger)', marginBottom: 12 }}>Fehler: {loadError}</div>
        <button onClick={() => navigate('/mtg')}>Zurück zum Dashboard</button>
      </div>
    );
  }

  return (
    <SettingsProvider>
      <div className="mtg-deck-builder">
        <div className="app">
          <header className="app-header">
            <div className="header-brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={() => navigate('/mtg')}
                style={{
                  background: 'transparent', border: '1px solid var(--border)',
                  color: 'var(--text-mid)', padding: '4px 10px',
                  borderRadius: 6, fontSize: 12, cursor: 'pointer',
                }}
                title="Zurück zum Dashboard"
              >← Decks</button>
              <input
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
                placeholder="Deck-Name…"
                style={{
                  background: 'transparent',
                  border: '1px solid transparent',
                  padding: '4px 8px',
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'var(--text-hi)',
                  fontFamily: 'inherit',
                  minWidth: 180,
                  borderRadius: 6,
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--border-hi)'}
                onBlur={(e) => e.target.style.borderColor = 'transparent'}
              />
              <input
                value={deckFormat}
                onChange={(e) => setDeckFormat(e.target.value)}
                placeholder="Format (z.B. Modern)"
                style={{
                  background: 'transparent',
                  border: '1px solid transparent',
                  padding: '4px 8px',
                  fontSize: 12,
                  color: 'var(--text-mid)',
                  fontFamily: 'inherit',
                  width: 140,
                  borderRadius: 6,
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--border-hi)'}
                onBlur={(e) => e.target.style.borderColor = 'transparent'}
              />
            </div>
            <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {(saveStatus || exportStatus) && (
                <span style={{
                  fontSize: 12,
                  color: (saveStatus || exportStatus).type === 'error'
                    ? 'var(--color-danger)' : 'var(--color-success)',
                }}>
                  {(saveStatus || exportStatus).text}
                </span>
              )}
              <button
                onClick={() => setShowImport(true)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-mid)',
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >Importieren</button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  background: dirty ? 'var(--accent)' : 'transparent',
                  border: `1px solid ${dirty ? 'var(--accent)' : 'var(--border)'}`,
                  color: dirty ? 'var(--bg-deep, #000)' : 'var(--text-mid)',
                  padding: '6px 14px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: saving ? 'wait' : 'pointer',
                }}
              >{saving ? 'Speichere…' : dirty ? 'Speichern' : '✓ Gespeichert'}</button>
            </div>
          </header>

          <main className="app-main">
            <aside className="preview-section">
              <CardPreview
                card={displayCard}
                isStale={isStale}
                pinned={!!pinnedCard}
                onPin={() => handlePin(hoveredCard || pinnedCard)}
                onUnpin={handleUnpin}
              />
            </aside>

            <section className="search-section">
              <CardSearch
                query={query}           setQuery={setQuery}
                searchMode={searchMode} setSearchMode={setSearchMode}
                colors={colors}         setColors={setColors}
                colorMode={colorMode}   setColorMode={setColorMode}
                cardType={cardType}     setCardType={setCardType}
                sortOrder={sortOrder}   setSortOrder={setSortOrder}
                sortDir={sortDir}       setSortDir={setSortDir}
                showLands={showLands}   setShowLands={setShowLands}
                rarity={rarity}         setRarity={setRarity}
                cmcMin={cmcMin}         setCmcMin={setCmcMin}
                cmcMax={cmcMax}         setCmcMax={setCmcMax}
                subtype={subtype}       setSubtype={setSubtype}
                format={format}         setFormat={setFormat}
                setCode={setCode}       setSetCode={setSetCode}
                totalCards={totalCards}
                loading={loading}
              />
              <CardList
                cards={cards}
                loading={loading}
                error={error}
                hasMore={hasMore}
                onLoadMore={loadMore}
                onAddCard={addToMain}
                deck={combinedForCardList}
                onHoverCard={setHoveredCard}
                onPinCard={handlePin}
                pinnedCard={pinnedCard}
              />
            </section>

            <aside className="deck-section">
              <DeckPanel
                mainboard={mainboard}
                sideboard={sideboard}
                onUpdateMainCount={updateMainCount}
                onRemoveMain={removeMain}
                onClearDeck={clearDeck}
                onUpdateSideCount={updateSideCount}
                onRemoveSide={removeSide}
                onMoveToSideboard={moveToSideboard}
                onMoveToMainboard={moveToMainboard}
                onHoverCard={setHoveredCard}
                onPinCard={handlePin}
                onExportDeck={handleExport}
              />
            </aside>
          </main>
        </div>

        <ImportDeckModal
          open={showImport}
          onClose={() => setShowImport(false)}
          onImport={handleImport}
        />
      </div>
    </SettingsProvider>
  );
}
