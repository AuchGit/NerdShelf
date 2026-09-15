// src/features/mtg/deck-builder/components/DeckPanel.jsx
import { useState } from 'react';
import DeckCard from './DeckCard';
import ManaSymbol from './ManaSymbol';
import { getCardImage, getManaCost, parseManaCost, getCardPriceEur, formatEur } from '../services/scryfall';
import { organizeDeck } from '../services/deckOrganize';
import { useMtgPriceSettings } from '../services/priceThresholds';
import './DeckCard.css';
import './DeckPanel.css';

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
  // Tokens the deck's cards create: { [key]: { key, card, count } }, the
  // cards creating each token, and the setter for the wanted count.
  tokens = null,
  tokenSources = {},
  onSetTokenCount,
  readOnly = false,    // shared decks: no editing controls
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
  const tokenEntries = Object.values(tokens || {});
  const tokenTotal  = tokenEntries.reduce((s, e) => s + e.count, 0);

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
  const commanderEur = commander ? (getCardPriceEur(commander) ?? 0) : 0;
  const totalEur     = mainEur + sideEur + commanderEur;

  const deckOverThreshold =
    priceSettings.deckEnabled
    && priceSettings.deckThresholdEur > 0
    && totalEur > priceSettings.deckThresholdEur;

  const activeDeck = tab === 'main' ? mainboard
                   : tab === 'side' ? sideboard
                   : tab === 'ideas' ? ideas
                   : (tokens || {});
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
          {!readOnly && onAnalyzeDeck && (mainTotal > 0) && (
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
          {!readOnly && (mainTotal > 0 || sideTotal > 0) && (
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
        {(tokenEntries.length > 0 || tab === 'tokens') && (
          <button
            className={`dp-tab ${tab === 'tokens' ? 'active' : ''}`}
            onClick={() => setTab('tokens')}
            title="Tokens, die Karten im Deck erzeugen — Anzahl für die Cardmarket-Liste"
          >
            Tokens <span className="dp-tab-count">{tokenTotal}</span>
          </button>
        )}
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
                : tab === 'ideas'
                  ? `${Math.min((ideaTotal / 30) * 100, 100)}%`
                  : '0%',
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
      {(tab === 'tokens' ? tokenEntries.length : tab === 'main' ? mainTotal : tab === 'side' ? sideTotal : ideaTotal) === 0 ? (
        (tab === 'main' && commander) ? null : (
          <div className="dp-empty">
            <div className="dp-empty-icon">⊕</div>
            <div>{
              tab === 'main' ? 'Klicke Karten in der Suche, um sie hinzuzufügen' :
              tab === 'side' ? 'Leeres Sideboard' :
              tab === 'ideas' ? 'Noch keine Ideen' :
              'Keine Karte im Deck erzeugt Tokens'
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
              {group.entries.map(({ card, count, key: tokenKey }) => {
                if (tab === 'tokens') {
                  const sources = tokenSources[tokenKey] || [];
                  return (
                    <DeckCard
                      key={tokenKey}
                      card={card}
                      count={count}
                      onIncrease={() => onSetTokenCount?.(tokenKey, count + 1)}
                      onDecrease={() => onSetTokenCount?.(tokenKey, count - 1)}
                      onRemove={() => onSetTokenCount?.(tokenKey, 0)}
                      removeTitle="Nicht kaufen (0)"
                      readOnly={readOnly}
                      note={sources.length > 0 ? `aus: ${sources.join(', ')}` : null}
                      onHover={onHoverCard}
                      onPin={onPinCard}
                    />
                  );
                }
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
                    readOnly={readOnly}
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
