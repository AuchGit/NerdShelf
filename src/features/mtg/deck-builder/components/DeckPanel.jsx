// src/features/mtg/deck-builder/components/DeckPanel.jsx
import { useState } from 'react';
import DeckCard from './DeckCard';
import ManaSymbol from './ManaSymbol';
import { getTypeGroup, getCardImage, getManaCost, parseManaCost, getCardPriceEur, formatEur } from '../services/scryfall';
import { useMtgPriceSettings } from '../services/priceThresholds';
import './DeckCard.css';
import './DeckPanel.css';

const GROUP_ORDER = [
  'Creatures', 'Planeswalkers', 'Instants', 'Sorceries',
  'Enchantments', 'Artifacts', 'Lands', 'Other',
];

const SORT_OPTIONS = [
  { id: 'type',   label: 'Typ' },
  { id: 'name',   label: 'Name' },
  { id: 'cmc',    label: 'Manakosten' },
  { id: 'color',  label: 'Farbe' },
  { id: 'rarity', label: 'Seltenheit' },
];

const COLOR_LABEL = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };
const COLOR_STYLE = {
  W: '#f5e9a0', U: '#1a78cc', B: '#6040a0', R: '#cc3020', G: '#1a6e28', C: '#808080',
};

const RARITY_ORDER = { mythic: 0, rare: 1, uncommon: 2, common: 3, special: 4, bonus: 5 };
const RARITY_LABEL = {
  mythic: 'Mythic', rare: 'Rare', uncommon: 'Uncommon',
  common: 'Common', special: 'Special', bonus: 'Bonus',
};

// Map a card to a primary color group for the 'color' sort
function colorGroup(card) {
  const cs = card.colors || [];
  if (cs.length === 0) return 'C';
  if (cs.length > 1)   return 'M';   // multicolor
  return cs[0];                       // 'W' | 'U' | 'B' | 'R' | 'G'
}
const COLOR_GROUP_ORDER = ['W', 'U', 'B', 'R', 'G', 'M', 'C'];
const COLOR_GROUP_LABEL = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green',
  M: 'Multicolor', C: 'Colorless',
};

function manaValue(card) {
  const v = card.cmc;
  return typeof v === 'number' ? v : (Number(v) || 0);
}

/** Group + sort entries based on active sort mode. Returns an array of
 *  `{ groupLabel, groupCount, entries }` ready to render. */
function organizeDeck(deck, sortMode) {
  const entries = Object.values(deck);

  if (sortMode === 'type') {
    const groups = {};
    for (const e of entries) {
      const g = getTypeGroup(e.card);
      if (!groups[g]) groups[g] = [];
      groups[g].push(e);
    }
    return GROUP_ORDER
      .filter(g => groups[g])
      .map(g => ({
        groupLabel: g,
        entries: groups[g].sort((a, b) => a.card.name.localeCompare(b.card.name)),
        groupCount: groups[g].reduce((s, e) => s + e.count, 0),
      }));
  }

  if (sortMode === 'color') {
    const groups = {};
    for (const e of entries) {
      const g = colorGroup(e.card);
      if (!groups[g]) groups[g] = [];
      groups[g].push(e);
    }
    return COLOR_GROUP_ORDER
      .filter(g => groups[g])
      .map(g => ({
        groupLabel: COLOR_GROUP_LABEL[g],
        entries: groups[g].sort((a, b) => a.card.name.localeCompare(b.card.name)),
        groupCount: groups[g].reduce((s, e) => s + e.count, 0),
      }));
  }

  if (sortMode === 'rarity') {
    const groups = {};
    for (const e of entries) {
      const r = e.card.rarity || 'common';
      if (!groups[r]) groups[r] = [];
      groups[r].push(e);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => (RARITY_ORDER[a] ?? 99) - (RARITY_ORDER[b] ?? 99))
      .map(([r, es]) => ({
        groupLabel: RARITY_LABEL[r] || r,
        entries: es.sort((a, b) => a.card.name.localeCompare(b.card.name)),
        groupCount: es.reduce((s, e) => s + e.count, 0),
      }));
  }

  if (sortMode === 'cmc') {
    // Group by integer mana value; lands get their own bucket at the end
    const groups = {};
    for (const e of entries) {
      const isLand = e.card.type_line?.includes('Land');
      const key = isLand ? 'Land' : String(Math.floor(manaValue(e.card)));
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    }
    const numericKeys = Object.keys(groups)
      .filter(k => k !== 'Land')
      .sort((a, b) => Number(a) - Number(b));
    const ordered = numericKeys.map(k => [k, groups[k]]);
    if (groups['Land']) ordered.push(['Land', groups['Land']]);
    return ordered.map(([k, es]) => ({
      groupLabel: k === 'Land' ? 'Land' : `${k} CMC`,
      entries: es.sort((a, b) =>
        manaValue(a.card) - manaValue(b.card) || a.card.name.localeCompare(b.card.name)
      ),
      groupCount: es.reduce((s, e) => s + e.count, 0),
    }));
  }

  // sortMode === 'name' → single flat list
  return [{
    groupLabel: null,
    entries: entries.sort((a, b) => a.card.name.localeCompare(b.card.name)),
    groupCount: entries.reduce((s, e) => s + e.count, 0),
  }];
}

function getManaStats(deck) {
  const counts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const { card, count } of Object.values(deck)) {
    if (!card.colors) continue;
    for (const c of card.colors) {
      if (counts[c] !== undefined) counts[c] += count;
    }
    if (card.colors.length === 0) counts.C += count;
  }
  return counts;
}

export default function DeckPanel({
  mainboard,
  sideboard,
  ideas = {},
  commander,           // optional: full Scryfall card object | null
  onUpdateMainCount,
  onRemoveMain,
  onClearDeck,
  onUpdateSideCount,
  onRemoveSide,
  onUpdateIdeasCount,
  onRemoveIdeas,
  // Six explicit movers — one per (from, to) pair. The deck panel
  // chooses two per tab so the user gets a left- AND right-arrow on
  // every card. Pattern (cyclic):
  //   Mainboard ← Ideen   | → Sideboard
  //   Sideboard ← Mainboard | → Ideen
  //   Ideen     ← Sideboard | → Mainboard
  onMainToIdeas,
  onMainToSide,
  onSideToMain,
  onSideToIdeas,
  onIdeasToSide,
  onIdeasToMain,
  onHoverCard,
  onPinCard,
  onExportDeck,
  onAnalyzeDeck,
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [tab, setTab] = useState('main');
  const [sortMode, setSortMode] = useState('type');
  const priceSettings = useMtgPriceSettings();

  const mainEntries = Object.values(mainboard);
  const sideEntries = Object.values(sideboard);
  const ideaEntries = Object.values(ideas);
  const mainTotal   = mainEntries.reduce((s, e) => s + e.count, 0);
  const sideTotal   = sideEntries.reduce((s, e) => s + e.count, 0);
  const ideaTotal   = ideaEntries.reduce((s, e) => s + e.count, 0);

  // Total deck price (Cardmarket EUR via Scryfall): commander + main + side.
  // Ideas DON'T contribute to the deck-price — they're a separate
  // "would like to test" pool and live in the wishlist, not the deck.
  const sumEur = (entries) =>
    entries.reduce((s, e) => {
      const p = getCardPriceEur(e.card);
      return p != null ? s + p * e.count : s;
    }, 0);
  const mainEur      = sumEur(mainEntries);
  const sideEur      = sumEur(sideEntries);
  const ideasEur     = sumEur(ideaEntries);
  const commanderEur = commander ? (getCardPriceEur(commander) ?? 0) : 0;
  const totalEur     = mainEur + sideEur + commanderEur;

  const deckOverThreshold =
    priceSettings.deckEnabled
    && priceSettings.deckThresholdEur > 0
    && totalEur > priceSettings.deckThresholdEur;

  const activeDeck = tab === 'main' ? mainboard
                   : tab === 'side' ? sideboard
                   : ideas;
  const organized  = organizeDeck(activeDeck, sortMode);

  const manaStats   = getManaStats(mainboard);
  const maxMana     = Math.max(...Object.values(manaStats), 1);

  const handleClear = () => {
    if (confirmClear) {
      onClearDeck();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 2500);
    }
  };

  return (
    <div className="deck-panel">
      {/* Header */}
      <div className="dp-header">
        <div className="dp-title">
          <span className="dp-icon">⚔</span>
          <span>Deck</span>
          {totalEur > 0 && (
            <span
              title={`Cardmarket Trend (EUR) — Mainboard ${formatEur(mainEur)}${sideEur ? ` · Sideboard ${formatEur(sideEur)}` : ''}${commander ? ` · Commander ${formatEur(commanderEur)}` : ''}`}
              style={{
                marginLeft: 8,
                fontSize: 11,
                color: deckOverThreshold ? 'var(--color-danger, #e06a5a)' : 'var(--accent, #d4a017)',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              ≈ {formatEur(totalEur)}
            </span>
          )}
          {deckOverThreshold && (
            <span
              title={`Über deinem Limit von ${formatEur(priceSettings.deckThresholdEur)} (Einstellungen → MTG)`}
              style={{
                marginLeft: 6,
                fontSize: 10,
                color: 'var(--color-danger, #e06a5a)',
                fontWeight: 700,
                letterSpacing: 0.5,
              }}
            >
              ⚠ Limit überschritten
            </span>
          )}
        </div>
        <div className="dp-header-right">
          {onAnalyzeDeck && (mainTotal > 0) && (
            <button
              className="dp-clear-btn dp-export-btn"
              onClick={onAnalyzeDeck}
              title="Mana-Basis-Vorschlag und Konsistenz-Simulation"
            >Analyse</button>
          )}
          {onExportDeck && (mainTotal > 0 || sideTotal > 0) && (
            <button
              className="dp-clear-btn dp-export-btn"
              onClick={onExportDeck}
              title="Decklist als Text in die Zwischenablage"
            >Export</button>
          )}
          {(mainTotal > 0 || sideTotal > 0) && (
            <button
              className={`dp-clear-btn ${confirmClear ? 'confirm' : ''}`}
              onClick={handleClear}
            >
              {confirmClear ? 'Sicher?' : 'Clear'}
            </button>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="dp-tabs">
        <button
          className={`dp-tab ${tab === 'main' ? 'active' : ''}`}
          onClick={() => setTab('main')}
        >
          Mainboard <span className="dp-tab-count">{mainTotal}/60</span>
        </button>
        <button
          className={`dp-tab ${tab === 'side' ? 'active' : ''}`}
          onClick={() => setTab('side')}
        >
          Sideboard <span className="dp-tab-count">{sideTotal}/15</span>
        </button>
        <button
          className={`dp-tab ${tab === 'ideas' ? 'active' : ''}`}
          onClick={() => setTab('ideas')}
          title="Ideen — unbegrenzter Pool, fließt in die Wunschliste"
        >
          Ideen <span className="dp-tab-count">{ideaTotal}</span>
        </button>
      </div>

      {/* Sort selector */}
      <div className="dp-sort">
        <span className="dp-sort-label">Sortieren:</span>
        <div className="dp-sort-pills">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.id}
              className={`dp-sort-pill ${sortMode === opt.id ? 'active' : ''}`}
              onClick={() => setSortMode(opt.id)}
            >{opt.label}</button>
          ))}
        </div>
      </div>

      {/* Progress bar for active section — ideas pool has no cap so
          show the relative-to-deck fill instead (capped at 100%). */}
      <div className="dp-progress-wrap">
        <div
          className="dp-progress-bar"
          style={{
            width: tab === 'main'
              ? `${Math.min((mainTotal / 60) * 100, 100)}%`
              : tab === 'side'
                ? `${Math.min((sideTotal / 15) * 100, 100)}%`
                : `${Math.min((ideaTotal / 30) * 100, 100)}%`,
          }}
        />
      </div>

      {/* Mana curve mini stats (only for mainboard) */}
      {tab === 'main' && mainTotal > 0 && (
        <div className="dp-mana-stats">
          {Object.entries(manaStats)
            .filter(([, v]) => v > 0)
            .map(([color, count]) => (
              <div key={color} className="dp-mana-bar-wrap" title={`${COLOR_LABEL[color]}: ${count}`}>
                <div
                  className="dp-mana-bar"
                  style={{
                    height: `${Math.round((count / maxMana) * 24)}px`,
                    background: COLOR_STYLE[color],
                    minHeight: '4px',
                  }}
                />
                <span className="dp-mana-label" style={{ color: COLOR_STYLE[color] }}>{color}</span>
              </div>
            ))}
        </div>
      )}

      {/* List */}
      {tab === 'main' && commander && (
        <CommanderRow
          card={commander}
          onHover={onHoverCard}
          onPin={onPinCard}
        />
      )}
      {(tab === 'main' ? mainTotal : tab === 'side' ? sideTotal : ideaTotal) === 0 ? (
        (tab === 'main' && commander) ? null : (
          <div className="dp-empty">
            <div className="dp-empty-icon">⊕</div>
            <div>{
              tab === 'main' ? 'Klicke Karten in der Suche, um sie hinzuzufügen' :
              tab === 'side' ? 'Leeres Sideboard' :
              'Noch keine Ideen'
            }</div>
            {tab === 'side' && (
              <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-lo)', marginTop: 6 }}>
                Über das ↕ Symbol bei einer Main-Karte verschieben
              </div>
            )}
            {tab === 'ideas' && (
              <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-lo)', marginTop: 6 }}>
                Karten landen über das ↕ Symbol hier — fließen in die Wunschliste, zählen aber nicht zum 60/15-Limit.
              </div>
            )}
          </div>
        )
      ) : (
        <div className="dp-list">
          {organized.map((group, gi) => (
            <div key={group.groupLabel ?? `g${gi}`} className="dp-group">
              {group.groupLabel && (
                <div className="dp-group-hdr">
                  <span>{group.groupLabel}</span>
                  <span className="dp-group-count">{group.groupCount}</span>
                </div>
              )}
              {group.entries.map(({ card, count }) => {
                // Resolve the (left, right) handler pair + their
                // tooltip labels based on the active tab.
                let onLeft, onRight, leftLabel, rightLabel;
                if (tab === 'main') {
                  onLeft  = onMainToIdeas ? () => onMainToIdeas(card.id) : null;
                  onRight = onMainToSide  ? () => onMainToSide(card.id)  : null;
                  leftLabel  = 'In die Ideen';
                  rightLabel = 'Ins Sideboard';
                } else if (tab === 'side') {
                  onLeft  = onSideToMain   ? () => onSideToMain(card.id)   : null;
                  onRight = onSideToIdeas  ? () => onSideToIdeas(card.id)  : null;
                  leftLabel  = 'Ins Mainboard';
                  rightLabel = 'In die Ideen';
                } else { // ideas
                  onLeft  = onIdeasToSide  ? () => onIdeasToSide(card.id)  : null;
                  onRight = onIdeasToMain  ? () => onIdeasToMain(card.id)  : null;
                  leftLabel  = 'Ins Sideboard';
                  rightLabel = 'Ins Mainboard';
                }
                return (
                  <DeckCard
                    key={card.id}
                    card={card}
                    count={count}
                    onIncrease={() => {
                      if (tab === 'main')  onUpdateMainCount(card.id, 1);
                      else if (tab === 'side') onUpdateSideCount(card.id, 1);
                      else                  onUpdateIdeasCount?.(card.id, 1);
                    }}
                    onDecrease={() => {
                      if (tab === 'main')  onUpdateMainCount(card.id, -1);
                      else if (tab === 'side') onUpdateSideCount(card.id, -1);
                      else                  onUpdateIdeasCount?.(card.id, -1);
                    }}
                    onRemove={() => {
                      if (tab === 'main')  onRemoveMain(card.id);
                      else if (tab === 'side') onRemoveSide(card.id);
                      else                  onRemoveIdeas?.(card.id);
                    }}
                    onMoveLeft={onLeft}
                    onMoveRight={onRight}
                    moveLeftTitle={leftLabel}
                    moveRightTitle={rightLabel}
                    onHover={onHoverCard}
                    onPin={onPinCard}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Commander row — pinned at the very top of the mainboard list. Reuses the
 * .deck-card visual style for consistency, but replaces the count controls
 * with a "♛ Commander" badge. Right-click pins the card to the preview.
 */
function CommanderRow({ card, onHover, onPin }) {
  const manaCost = getManaCost(card);
  const manaSyms = parseManaCost(manaCost);
  const imageUrl = getCardImage(card);

  const handleContextMenu = (e) => {
    if (!onPin) return;
    e.preventDefault();
    onPin(card);
  };

  return (
    <div
      className="deck-card"
      style={{
        marginBottom: 6,
        borderLeft: '3px solid var(--accent, #d4a017)',
        background: 'color-mix(in srgb, var(--accent, #d4a017) 8%, transparent)',
      }}
      onMouseEnter={() => onHover?.(card)}
      onMouseLeave={() => onHover?.(null)}
      onContextMenu={handleContextMenu}
      title="Commander · Rechtsklick: in Vorschau pinnen"
    >
      <div className="dc-thumb">
        {imageUrl
          ? <img src={imageUrl} alt={card.name} loading="lazy" />
          : <div className="dc-thumb-fallback">?</div>}
      </div>

      <div className="dc-info">
        <div className="dc-name">{card.name}</div>
        <div className="dc-sub">
          <span className="dc-type">{card.type_line?.split('—')[0].trim()}</span>
          <span className="dc-mana">
            {manaSyms.map((s, i) => <ManaSymbol key={i} symbol={s} size="xs" />)}
          </span>
        </div>
      </div>

      <div
        className="dc-controls"
        style={{
          color: 'var(--accent, #d4a017)',
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: 0.5,
          padding: '0 6px',
          whiteSpace: 'nowrap',
        }}
      >
        ♛ COMMANDER
      </div>
    </div>
  );
}
