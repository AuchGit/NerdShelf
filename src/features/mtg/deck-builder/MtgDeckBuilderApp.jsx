// src/features/mtg/deck-builder/MtgDeckBuilderApp.jsx
import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../../core/supabase/client';
import { useAuth } from '../../../core/auth/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import CardSearch    from './components/CardSearch';
import CardList      from './components/CardList';
import DeckListView  from './components/DeckListView';
import DeckPanel     from './components/DeckPanel';
import CardPreview   from './components/CardPreview';
import CollapsibleRail from './components/CollapsibleRail';
// Heavy modals — load on first open. Pulling these eagerly added a lot
// of weight to the initial deck-builder JS (DeckAnalyzer especially —
// it pulls in mana-curve / color-stats code that's only opened on demand).
const ImportDeckModal   = lazy(() => import('./components/ImportDeckModal'));
const CoverPickerModal  = lazy(() => import('./components/CoverPickerModal'));
const DeckAnalyzerModal = lazy(() => import('./components/DeckAnalyzerModal'));
import useWindowWidth from '../../../shared/hooks/useWindowWidth';
import usePwaMobile from '../../../shared/hooks/usePwaMobile';
import MtgDeckBuilderMobile from './pwa/MtgDeckBuilderMobile';
import { useScryfall } from './hooks/useScryfall';
import { useFavorites } from './hooks/useFavorites';
import { useMtgInventory } from './hooks/useMtgInventory';
import { newShareToken } from '../../../shared/tokens';
import { filterFavorites } from './services/favoritesFilter';
import { copyDecklistToClipboard } from './services/deckExport';
import './MtgDeckBuilder.css';
import './App.css';

// Standard MTG formats. value '' = no filter, value 'limited' is a label-only entry (no Scryfall filter).
export const MTG_FORMATS = [
  { value: '',            label: '(Kein Format)' },
  { value: 'standard',    label: 'Standard'      },
  { value: 'pioneer',     label: 'Pioneer'       },
  { value: 'modern',      label: 'Modern'        },
  { value: 'legacy',      label: 'Legacy'        },
  { value: 'vintage',     label: 'Vintage'       },
  { value: 'pauper',      label: 'Pauper'        },
  { value: 'commander',   label: 'Commander'     },
  { value: 'brawl',       label: 'Brawl'         },
  { value: 'historic',    label: 'Historic'      },
  { value: 'alchemy',     label: 'Alchemy'       },
  { value: 'penny',       label: 'Penny'         },
  { value: 'oathbreaker', label: 'Oathbreaker'   },
  { value: 'limited',     label: 'Limited'       },
];

// Formats that should NOT trigger a Scryfall legal:<x> filter.
const FORMATS_WITHOUT_FILTER = new Set(['', 'limited']);

export default function MtgDeckBuilderApp() {
  const { deckId } = useParams();             // undefined for /mtg/deck/new
  const navigate = useNavigate();
  const { user } = useAuth();

  // ── Deck meta ─────────────────────────────────────────
  const [deckName, setDeckName] = useState('Unbenanntes Deck');
  const [deckFormat, setDeckFormat] = useState('');
  const [mainboard, setMainboard] = useState({});
  const [sideboard, setSideboard] = useState({});
  // "Ideas" — an unlimited pool of candidate cards the player is
  // considering for this deck. They DON'T count against the deck's
  // 60/15 limits, but they DO feed the cross-deck wishlist so the
  // user can buy them alongside their actual playable list.
  const [ideas, setIdeas] = useState({});
  const [coverCardId, setCoverCardId] = useState(null);
  // Per-deck share token (see src/shared/tokens). Persists across saves;
  // we mint one only when the deck is created (or migrated from a row
  // that pre-dates the share_token column).
  const [shareToken, setShareToken] = useState(null);
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [commander, setCommander] = useState(null);   // full Scryfall card object | null

  const isCommanderFormat = deckFormat === 'commander';
  // While in commander format with no commander chosen yet, the search
  // results are restricted to commander-eligible cards and the next added
  // card becomes the commander instead of going to the mainboard.
  const commanderPickMode = isCommanderFormat && !commander;
  const [loadingDeck, setLoadingDeck] = useState(!!deckId);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [showAnalyzer, setShowAnalyzer] = useState(false);
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
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');

  // ── Preview state ────────────────────────────────────
  const [hoveredCard,  setHoveredCard]  = useState(null);
  // pinned holds { card, faceIndex } | null. faceIndex is the face that was
  // right-clicked (0 by default; 0/1 for double-faced cards).
  const [pinned,       setPinned]       = useState(null);
  const [lastSeenCard, setLastSeenCard] = useState(null);
  const pinnedCard = pinned?.card ?? null;

  // ── View/Edit toggle ────────────────────────────────
  const [viewMode, setViewMode] = useState('edit');

  // ── Favorites ───────────────────────────────────────
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const favs = useFavorites();

  // ── Inventory (shared across NerdShelf domains) ────────
  // The shared inventory hook is scoped to domain='mtg'; wh40k's hook uses
  // its own scope, so the two collections are isolated.
  const inv = useMtgInventory();
  const [showOwnedOnly, setShowOwnedOnly] = useState(false);
  const incOwnedCard = useCallback(
    (card) => inv.adjustQuantity(card.id, +1, card.name || ''),
    [inv]
  );
  const decOwnedCard = useCallback(
    (card) => inv.adjustQuantity(card.id, -1, card.name || ''),
    [inv]
  );
  // Trigger fetch of full favorite cards when toggle is enabled
  useEffect(() => {
    if (showFavoritesOnly && favs.favoriteCards === null) {
      favs.loadFavoriteCards();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFavoritesOnly, favs.favoriteCards]);

  // Same idea for "Karten aus Sammlung": when the toggle flips on, bulk-
  // resolve every owned id to its full Scryfall card so the user can
  // browse their collection without an active search. inv.ownedCards is
  // a cache that survives toggling off/on; it's invalidated when the
  // collection itself changes (add/remove a card).
  useEffect(() => {
    if (showOwnedOnly && inv.ownedCards === null) {
      inv.loadOwnedCards();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOwnedOnly, inv.ownedCards]);

  // Effective format passed to Scryfall: explicit CardSearch override wins,
  // otherwise the deck-level format (unless it's a non-filterable value like "limited").
  const deckFormatForFilter = FORMATS_WITHOUT_FILTER.has(deckFormat) ? '' : deckFormat;
  const effectiveFormat = format || deckFormatForFilter;

  // When a commander is set in commander format, force the search to that
  // commander's color identity (overrides the colour picker).
  const commanderIdentity = (isCommanderFormat && commander)
    ? (commander.color_identity || [])
    : null;

  const scryfall = useScryfall({
    query, searchMode, colors, colorMode, cardType, sortOrder, sortDir, showLands,
    rarity, cmcMin, cmcMax, subtype, format: effectiveFormat, setCode,
    priceMin, priceMax,
    commanderIdentity,
    commanderPick: commanderPickMode,
  });

  // When "favorites only" / "owned only" is active, replace Scryfall
  // search results with a client-side filtered view backed by data we
  // hold locally (favs.favoriteCards / inv.ownedCards). Both lists are
  // bulk-resolved from Scryfall on first toggle and cached.
  //
  // When BOTH toggles are on, the source is the intersection (owned ∩
  // favorited) so the filter composes the same way it did before.
  const showingFavs  = showFavoritesOnly;
  const showingOwned = showOwnedOnly;
  const favCardsBase = favs.favoriteCards || [];
  const ownCardsBase = inv.ownedCards     || [];

  let clientSource = null;
  if (showingFavs && showingOwned) {
    clientSource = favCardsBase.filter(c => inv.isOwned(c.id));
  } else if (showingFavs) {
    clientSource = favCardsBase;
  } else if (showingOwned) {
    clientSource = ownCardsBase;
  }

  const clientFiltered = clientSource
    ? filterFavorites(clientSource, {
        query, searchMode, colors, colorMode, cardType, showLands,
        rarity, cmcMin, cmcMax, subtype, format: effectiveFormat, setCode,
        priceMin, priceMax,
        sortOrder, sortDir,
        commanderPick: commanderPickMode,
        commanderIdentity,
      })
    : null;

  const usingClient = showingFavs || showingOwned;
  const cards       = usingClient ? clientFiltered : scryfall.cards;
  const loading     = showingFavs ? favs.loading
                    : showingOwned ? (inv.ownedCardsLoading || inv.loading)
                    : scryfall.loading;
  const error       = showingFavs ? favs.error
                    : showingOwned ? (inv.ownedCardsError || inv.error)
                    : scryfall.error;
  const hasMore     = usingClient ? false : scryfall.hasMore;
  const totalCards  = usingClient ? (clientFiltered?.length ?? 0) : scryfall.totalCards;
  const loadMore    = scryfall.loadMore;

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
      // Normalize legacy free-text format values (e.g. "Modern") to dropdown slugs ("modern").
      const rawFormat = (data.format || '').toLowerCase().trim();
      const matchedFormat = MTG_FORMATS.find(f => f.value === rawFormat);
      setDeckFormat(matchedFormat ? matchedFormat.value : '');
      setMainboard(data.data?.mainboard || {});
      setSideboard(data.data?.sideboard || {});
      setIdeas(data.data?.ideas || {});
      setCoverCardId(data.data?.coverCardId || null);
      setCommander(data.data?.commander || null);
      setShareToken(data.share_token || null);
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
  }, [mainboard, sideboard, ideas, deckName, deckFormat, coverCardId, commander]);

  // ── Singleton helper ─────────────────────────────────
  // In Commander, every non-basic-land card is capped at 1 copy.
  function isBasicLand(card) {
    const t = (card?.type_line || '').toLowerCase();
    return t.includes('basic') && t.includes('land');
  }

  // ── Commander handler (defined before addToMain because addToMain
  // references it when in commander-pick mode) ────────────────────────
  const setCommanderCard = useCallback((card) => {
    setCommander(card);
    if (card && !coverCardId) setCoverCardId(card.id);
    if (!card && coverCardId && commander && coverCardId === commander.id) {
      setCoverCardId(null);
    }
  }, [coverCardId, commander]);

  // ── Mainboard mutations ──────────────────────────────
  const addToMain = useCallback((card) => {
    // Commander pick mode: clicking a card sets it as the Commander
    // instead of adding to the mainboard.
    if (commanderPickMode) {
      setCommanderCard(card);
      return;
    }
    setMainboard(prev => {
      const existing = prev[card.id];
      // Commander singleton rule: non-basic-lands stay capped at 1
      if (isCommanderFormat && existing && !isBasicLand(card)) {
        return prev;
      }
      return {
        ...prev,
        [card.id]: existing
          ? { ...existing, count: existing.count + 1 }
          : { card, count: 1 },
      };
    });
  }, [isCommanderFormat, commanderPickMode, setCommanderCard]);

  const updateMainCount = useCallback((cardId, delta) => {
    setMainboard(prev => {
      const entry = prev[cardId];
      if (!entry) return prev;
      // Commander singleton: don't allow +1 on a non-basic-land already at 1
      if (isCommanderFormat && delta > 0 && entry.count >= 1 && !isBasicLand(entry.card)) {
        return prev;
      }
      const next = entry.count + delta;
      if (next <= 0) {
        const { [cardId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [cardId]: { ...entry, count: next } };
    });
  }, [isCommanderFormat]);

  const removeMain = useCallback((cardId) => {
    setMainboard(prev => {
      const { [cardId]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  // ── Add directly to sideboard (from search results) ─────
  const addToSide = useCallback((card) => {
    setSideboard(prev => {
      const existing = prev[card.id];
      const mainHas = mainboard[card.id];
      // Commander singleton: total non-basic-land copies across both zones ≤ 1
      if (isCommanderFormat && !isBasicLand(card)) {
        if (existing) return prev;
        if (mainHas) return prev;
      }
      return {
        ...prev,
        [card.id]: existing
          ? { ...existing, count: existing.count + 1 }
          : { card, count: 1 },
      };
    });
  }, [isCommanderFormat, mainboard]);

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

  // ── Ideas mutations (unlimited pool, no singleton rule) ──
  // Ideas are NOT subject to the commander singleton rule — they're a
  // scratchpad of cards the user wants to remember to buy/test.
  const addToIdeas = useCallback((card) => {
    setIdeas(prev => {
      const existing = prev[card.id];
      return {
        ...prev,
        [card.id]: existing
          ? { ...existing, count: existing.count + 1 }
          : { card, count: 1 },
      };
    });
  }, []);
  const updateIdeasCount = useCallback((cardId, delta) => {
    setIdeas(prev => {
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
  const removeIdeas = useCallback((cardId) => {
    setIdeas(prev => {
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
      // Commander singleton: don't transfer if already in main and not a basic land
      const mainAlready = mainboard[cardId];
      if (isCommanderFormat && mainAlready && !isBasicLand(entry.card)) return prev;
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
  }, [isCommanderFormat, mainboard]);

  // Move 1 copy out of ideas into the mainboard (respects commander singleton).
  const moveIdeasToMainboard = useCallback((cardId) => {
    setIdeas(prev => {
      const entry = prev[cardId];
      if (!entry) return prev;
      const mainAlready = mainboard[cardId];
      if (isCommanderFormat && mainAlready && !isBasicLand(entry.card)) return prev;
      const newCount = entry.count - 1;
      const nextIdeas = { ...prev };
      if (newCount <= 0) delete nextIdeas[cardId];
      else nextIdeas[cardId] = { ...entry, count: newCount };
      setMainboard(main => {
        const m = main[cardId];
        return {
          ...main,
          [cardId]: m
            ? { ...m, count: m.count + 1 }
            : { card: entry.card, count: 1 },
        };
      });
      return nextIdeas;
    });
  }, [isCommanderFormat, mainboard]);

  // ── Remaining 3 movers so every tab has both a left- and a right-
  //    arrow target (the user wants the full 3-cycle: a card can hop
  //    directly to any other zone without going through a sub-menu).
  //    Pattern: each move pulls 1 copy from the source zone and pushes
  //    it into the destination. Singleton rules apply to mainboard
  //    only (ideas + sideboard have no singleton constraint).
  const moveMainToIdeas = useCallback((cardId) => {
    setMainboard(prev => {
      const entry = prev[cardId];
      if (!entry) return prev;
      const newCount = entry.count - 1;
      const nextMain = { ...prev };
      if (newCount <= 0) delete nextMain[cardId];
      else nextMain[cardId] = { ...entry, count: newCount };
      setIdeas(ide => {
        const i = ide[cardId];
        return {
          ...ide,
          [cardId]: i
            ? { ...i, count: i.count + 1 }
            : { card: entry.card, count: 1 },
        };
      });
      return nextMain;
    });
  }, []);

  const moveSideToIdeas = useCallback((cardId) => {
    setSideboard(prev => {
      const entry = prev[cardId];
      if (!entry) return prev;
      const newCount = entry.count - 1;
      const nextSide = { ...prev };
      if (newCount <= 0) delete nextSide[cardId];
      else nextSide[cardId] = { ...entry, count: newCount };
      setIdeas(ide => {
        const i = ide[cardId];
        return {
          ...ide,
          [cardId]: i
            ? { ...i, count: i.count + 1 }
            : { card: entry.card, count: 1 },
        };
      });
      return nextSide;
    });
  }, []);

  const moveIdeasToSide = useCallback((cardId) => {
    setIdeas(prev => {
      const entry = prev[cardId];
      if (!entry) return prev;
      const newCount = entry.count - 1;
      const nextIdeas = { ...prev };
      if (newCount <= 0) delete nextIdeas[cardId];
      else nextIdeas[cardId] = { ...entry, count: newCount };
      setSideboard(side => {
        const s = side[cardId];
        return {
          ...side,
          [cardId]: s
            ? { ...s, count: s.count + 1 }
            : { card: entry.card, count: 1 },
        };
      });
      return nextIdeas;
    });
  }, []);

  const clearDeck = useCallback(() => {
    setMainboard({});
    setSideboard({});
    setIdeas({});
  }, []);

  // We still pass a deck-shaped object to CardList because CardItem reads deckCount from it.
  // Combine main+side+ideas counts so the badge reflects total presence in the deck.
  const combinedForCardList = {};
  for (const id of Object.keys(mainboard)) {
    combinedForCardList[id] = { count: mainboard[id].count + (sideboard[id]?.count || 0) + (ideas[id]?.count || 0) };
  }
  for (const id of Object.keys(sideboard)) {
    if (!combinedForCardList[id]) {
      combinedForCardList[id] = { count: sideboard[id].count + (ideas[id]?.count || 0) };
    }
  }
  for (const id of Object.keys(ideas)) {
    if (!combinedForCardList[id]) {
      combinedForCardList[id] = { count: ideas[id].count };
    }
  }

  // ── Preview handlers ─────────────────────────────────
  // Pin semantics:
  //   - no card pinned     → pin this card+face
  //   - other card pinned  → switch to this card+face
  //   - same card, other face → switch face
  //   - same card+face     → unpin
  const handlePin = useCallback((card, faceIndex = 0) => {
    if (!card) return;
    setPinned(prev => {
      if (!prev) return { card, faceIndex };
      if (prev.card.id !== card.id) return { card, faceIndex };
      if (prev.faceIndex !== faceIndex) return { card, faceIndex };
      return null;
    });
  }, []);
  const handleUnpin = useCallback(() => setPinned(null), []);

  // ── Save ─────────────────────────────────────────────
  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setSaveStatus(null);
    // Mint a token if this deck has never been saved (or migrated from a
    // row that pre-dates the column). The token is permanent — once set,
    // it stays put through every subsequent save.
    const tokenForSave = shareToken || newShareToken();
    if (!shareToken) setShareToken(tokenForSave);
    const payload = {
      user_id: user.id,
      name: deckName.trim() || 'Unbenanntes Deck',
      format: deckFormat || null,
      data: { mainboard, sideboard, ideas, coverCardId, commander },
      share_token: tokenForSave,
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

  // (setCommanderCard moved above addToMain to avoid TDZ in its dep array)

  // ── Responsive layout mode ───────────────────────────
  const { mtgMode } = useWindowWidth();
  const previewAsRail = mtgMode !== 'full';
  const deckAsRail    = mtgMode === 'both-rails';
  const { isPwaMobile } = usePwaMobile();

  const previewPanel = (
    <CardPreview
      card={displayCard}
      isStale={isStale}
      pinned={!!pinned}
      pinnedFaceIndex={pinned?.faceIndex ?? null}
      onPin={() => handlePin(hoveredCard || pinned?.card, 0)}
      onUnpin={handleUnpin}
    />
  );

  const deckPanelEl = (
    <DeckPanel
      mainboard={mainboard}
      sideboard={sideboard}
      ideas={ideas}
      commander={commander}
      onUpdateMainCount={updateMainCount}
      onRemoveMain={removeMain}
      onClearDeck={clearDeck}
      onUpdateSideCount={updateSideCount}
      onRemoveSide={removeSide}
      onUpdateIdeasCount={updateIdeasCount}
      onRemoveIdeas={removeIdeas}
      // ── per-tab arrow movers ────────────────────────
      // Mainboard ← Ideen | → Sideboard
      // Sideboard ← Mainboard | → Ideen
      // Ideen     ← Sideboard | → Mainboard
      onMainToIdeas={moveMainToIdeas}
      onMainToSide={moveToSideboard}
      onSideToMain={moveToMainboard}
      onSideToIdeas={moveSideToIdeas}
      onIdeasToSide={moveIdeasToSide}
      onIdeasToMain={moveIdeasToMainboard}
      onHoverCard={setHoveredCard}
      onPinCard={handlePin}
      onExportDeck={handleExport}
      onAnalyzeDeck={() => setShowAnalyzer(true)}
    />
  );

  const mainCount = Object.values(mainboard).reduce((s, e) => s + (e.count || 0), 0);
  const sideCount = Object.values(sideboard).reduce((s, e) => s + (e.count || 0), 0);

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

  // Pre-build the CardSearch / CardList / DeckListView / DeckPanel /
  // CardPreview panels so both the mobile shell AND the desktop layout
  // below can reference them by JSX node. Keeps the data wiring in one
  // place — the mobile component just composes them differently.
  const cardSearchEl = (
    <CardSearch
      deckFormatLabel={MTG_FORMATS.find(f => f.value === deckFormat)?.label || ''}
      showFavoritesOnly={showFavoritesOnly}
      setShowFavoritesOnly={setShowFavoritesOnly}
      showOwnedOnly={showOwnedOnly}
      setShowOwnedOnly={setShowOwnedOnly}
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
      priceMin={priceMin}     setPriceMin={setPriceMin}
      priceMax={priceMax}     setPriceMax={setPriceMax}
      totalCards={totalCards}
      loading={loading}
    />
  );
  const cardListEl = (
    <CardList
      cards={cards || []}
      loading={loading}
      error={error}
      hasMore={hasMore}
      onLoadMore={loadMore}
      onAddCard={addToMain}
      onAddSideCard={addToSide}
      onAddIdeasCard={addToIdeas}
      deck={combinedForCardList}
      onHoverCard={setHoveredCard}
      onPinCard={handlePin}
      pinnedCard={pinnedCard}
      viewMode={viewMode}
      setViewMode={setViewMode}
      isFavorite={favs.isFavorite}
      onToggleFavorite={favs.toggleFavorite}
      getOwnedQty={inv.getQuantity}
      onIncOwned={incOwnedCard}
      onDecOwned={decOwnedCard}
    />
  );
  const deckListViewEl = (
    <DeckListView
      mainboard={mainboard}
      sideboard={sideboard}
      onHoverCard={setHoveredCard}
      onPinCard={handlePin}
      viewMode={viewMode}
      setViewMode={setViewMode}
      isFavorite={favs.isFavorite}
      onToggleFavorite={favs.toggleFavorite}
    />
  );

  // PWA on a phone → drop into the dedicated mobile shell. The desktop
  // 3-column layout below is left untouched.
  if (isPwaMobile) {
    return (
      <SettingsProvider>
        <MtgDeckBuilderMobile
          navigate={navigate}
          deckName={deckName} setDeckName={setDeckName}
          deckFormat={deckFormat} setDeckFormat={setDeckFormat}
          formats={MTG_FORMATS}
          coverCardId={coverCardId} onOpenCoverPicker={() => setShowCoverPicker(true)}
          commander={commander} isCommanderFormat={isCommanderFormat}
          onRemoveCommander={setCommanderCard}
          saving={saving} saveStatus={saveStatus} exportStatus={exportStatus} dirty={dirty}
          onSave={handleSave}
          onImport={() => setShowImport(true)}
          onExport={handleExport}
          onAnalyze={() => setShowAnalyzer(true)}
          searchPanel={cardSearchEl}
          cardListPanel={cardListEl}
          deckListViewPanel={deckListViewEl}
          deckPanelEl={deckPanelEl}
          previewPanel={previewPanel}
          viewMode={viewMode} setViewMode={setViewMode}
          mainCount={mainCount} sideCount={sideCount}
          pinnedCard={pinnedCard}
        />
        <Suspense fallback={null}>
          {showImport && (
            <ImportDeckModal
              open
              onClose={() => setShowImport(false)}
              onImport={handleImport}
            />
          )}
          {showCoverPicker && (
            <CoverPickerModal
              open
              onClose={() => setShowCoverPicker(false)}
              mainboard={mainboard}
              sideboard={sideboard}
              currentCoverId={coverCardId}
              onPick={(id) => setCoverCardId(id)}
            />
          )}
          {showAnalyzer && (
            <DeckAnalyzerModal
              open
              onClose={() => setShowAnalyzer(false)}
              mainboard={mainboard}
              commander={commander}
              deckFormat={deckFormat}
              onApplyLands={(nextMainboard) => setMainboard(nextMainboard)}
            />
          )}
        </Suspense>
      </SettingsProvider>
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
              <select
                value={deckFormat}
                onChange={(e) => setDeckFormat(e.target.value)}
                title="Deck-Format — filtert die Kartensuche auf legale Karten"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  padding: '4px 8px',
                  fontSize: 12,
                  color: 'var(--text-mid)',
                  fontFamily: 'inherit',
                  width: 160,
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                {MTG_FORMATS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <button
                onClick={() => setShowCoverPicker(true)}
                title="Cover-Karte für die Dashboard-Anzeige wählen"
                style={{
                  background: coverCardId ? 'var(--accent)' : 'transparent',
                  border: `1px solid ${coverCardId ? 'var(--accent)' : 'var(--border)'}`,
                  color: coverCardId ? 'var(--bg-deep, #000)' : 'var(--text-mid)',
                  padding: '4px 10px', borderRadius: 6,
                  fontSize: 12, cursor: 'pointer',
                }}
              >
                {coverCardId ? '✦ Cover' : 'Cover…'}
              </button>
              {isCommanderFormat && commander && (
                <button
                  onClick={() => {
                    if (window.confirm(`Commander "${commander.name}" entfernen? Du kannst dann einen neuen aus der Suche wählen.`)) {
                      setCommanderCard(null);
                    }
                  }}
                  title="Commander entfernen / wechseln"
                  style={{
                    background: 'var(--accent)',
                    border: '1px solid var(--accent)',
                    color: 'var(--bg-deep, #000)',
                    padding: '4px 10px', borderRadius: 6,
                    fontSize: 12, cursor: 'pointer',
                    maxWidth: 220,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  ♛ {commander.name}
                </button>
              )}
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
            {previewAsRail ? (
              <CollapsibleRail side="left" label="Vorschau" expandedWidth={285}>
                {previewPanel}
              </CollapsibleRail>
            ) : (
              <aside className="preview-section">{previewPanel}</aside>
            )}

            <section className="search-section">
              <CardSearch
                deckFormatLabel={MTG_FORMATS.find(f => f.value === deckFormat)?.label || ''}
                showFavoritesOnly={showFavoritesOnly}
                setShowFavoritesOnly={setShowFavoritesOnly}
                showOwnedOnly={showOwnedOnly}
                setShowOwnedOnly={setShowOwnedOnly}
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
                priceMin={priceMin}     setPriceMin={setPriceMin}
                priceMax={priceMax}     setPriceMax={setPriceMax}
                totalCards={totalCards}
                loading={loading}
              />
              {viewMode === 'edit' ? (
                <CardList
                  cards={cards || []}
                  loading={loading}
                  error={error}
                  hasMore={hasMore}
                  onLoadMore={loadMore}
                  onAddCard={addToMain}
                  onAddSideCard={addToSide}
                  onAddIdeasCard={addToIdeas}
                  deck={combinedForCardList}
                  onHoverCard={setHoveredCard}
                  onPinCard={handlePin}
                  pinnedCard={pinnedCard}
                  viewMode={viewMode}
                  setViewMode={setViewMode}
                  isFavorite={favs.isFavorite}
                  onToggleFavorite={favs.toggleFavorite}
                  getOwnedQty={inv.getQuantity}
                  onIncOwned={incOwnedCard}
                  onDecOwned={decOwnedCard}
                />
              ) : (
                <DeckListView
                  mainboard={mainboard}
                  sideboard={sideboard}
                  onHoverCard={setHoveredCard}
                  onPinCard={handlePin}
                  viewMode={viewMode}
                  setViewMode={setViewMode}
                  isFavorite={favs.isFavorite}
                  onToggleFavorite={favs.toggleFavorite}
                />
              )}
            </section>

            {deckAsRail ? (
              <CollapsibleRail
                side="right"
                label={`Deck · ${mainCount}${sideCount ? ` + ${sideCount}` : ''}`}
                expandedWidth={320}
              >
                {deckPanelEl}
              </CollapsibleRail>
            ) : (
              <aside className="deck-section">{deckPanelEl}</aside>
            )}
          </main>
        </div>

        <Suspense fallback={null}>
          {showImport && (
            <ImportDeckModal
              open
              onClose={() => setShowImport(false)}
              onImport={handleImport}
            />
          )}
          {showCoverPicker && (
            <CoverPickerModal
              open
              onClose={() => setShowCoverPicker(false)}
              mainboard={mainboard}
              sideboard={sideboard}
              currentCoverId={coverCardId}
              onPick={(id) => setCoverCardId(id)}
            />
          )}
          {showAnalyzer && (
            <DeckAnalyzerModal
              open
              onClose={() => setShowAnalyzer(false)}
              mainboard={mainboard}
              commander={commander}
              deckFormat={deckFormat}
              onApplyLands={(nextMainboard) => setMainboard(nextMainboard)}
            />
          )}
        </Suspense>
      </div>
    </SettingsProvider>
  );
}
