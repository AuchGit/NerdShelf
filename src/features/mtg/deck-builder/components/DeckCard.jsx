// src/features/mtg/deck-builder/components/DeckCard.jsx
import { getCardImage, getManaCost, parseManaCost, getCardPriceEur, formatEur } from '../services/scryfall';
import { useMtgPriceSettings } from '../services/priceThresholds';
import ManaSymbol from './ManaSymbol';
import './DeckCard.css';

export default function DeckCard({
  card, count,
  onIncrease, onDecrease, onRemove,
  // Left-side arrow → "send card the OTHER way" (e.g. ← Ideen).
  // Right-side arrow → "send card forward" (e.g. → Sideboard).
  // Both are independent so the deck-panel can wire them per-tab and
  // a card always has both shortcuts available.
  onMoveLeft,
  onMoveRight,
  moveLeftTitle,
  moveRightTitle,
  onHover,          // optional: (card) => void
  onPin,            // optional: (card) => void — right-click pins to preview
}) {
  const manaCost = getManaCost(card);
  const manaSyms = parseManaCost(manaCost);
  const imageUrl = getCardImage(card);
  const priceEur = getCardPriceEur(card);
  const priceLine = priceEur != null
    ? (count > 1
        ? `${formatEur(priceEur)} · ∑ ${formatEur(priceEur * count)}`
        : formatEur(priceEur))
    : null;
  const priceSettings = useMtgPriceSettings();
  const overCardThreshold =
    priceSettings.cardEnabled
    && priceSettings.cardThresholdEur > 0
    && priceEur != null
    && priceEur > priceSettings.cardThresholdEur;

  const handleContextMenu = (e) => {
    if (!onPin) return;
    e.preventDefault();
    onPin(card);
  };

  return (
    <div
      className="deck-card"
      onMouseEnter={() => onHover?.(card)}
      onMouseLeave={() => onHover?.(null)}
      onContextMenu={handleContextMenu}
      title={onPin ? 'Rechtsklick: in Vorschau pinnen' : undefined}
      style={overCardThreshold ? {
        borderLeft: '3px solid var(--color-danger, #e06a5a)',
        background: 'color-mix(in srgb, var(--color-danger, #e06a5a) 6%, transparent)',
      } : undefined}
    >
      {/* Left-side move arrow — sits BEFORE the thumbnail so it reads
          as "move this card LEFT (out of this zone)". Hidden when the
          handler isn't supplied (e.g. for cards that have no logical
          left-target like a CommanderRow). */}
      {onMoveLeft && (
        <button
          type="button"
          className="dc-btn dc-move-arrow dc-move-arrow--left"
          onClick={onMoveLeft}
          title={moveLeftTitle || 'Nach links verschieben'}
        >←</button>
      )}

      <div className="dc-thumb">
        {imageUrl && <img src={imageUrl} alt={card.name} loading="lazy" />}
        {!imageUrl && <div className="dc-thumb-fallback">?</div>}
      </div>

      <div className="dc-info">
        <div className="dc-name">{card.name}</div>
        <div className="dc-sub">
          <span className="dc-type">{card.type_line?.split('—')[0].trim()}</span>
          <span className="dc-mana">
            {manaSyms.map((s, i) => <ManaSymbol key={i} symbol={s} size="xs" />)}
          </span>
        </div>
        {priceLine && (
          <div
            title={overCardThreshold
              ? `Über deinem Karten-Limit von ${formatEur(priceSettings.cardThresholdEur)}`
              : 'Cardmarket Trend (EUR via Scryfall)'}
            style={{
              fontSize: 10,
              color: overCardThreshold ? 'var(--color-danger, #e06a5a)' : 'var(--text-mid, #888)',
              fontWeight: overCardThreshold ? 700 : 400,
              marginTop: 2,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {overCardThreshold && '⚠ '}{priceLine}
          </div>
        )}
      </div>

      <div className="dc-controls">
        <button className="dc-btn" onClick={onDecrease} title="Eins weniger">−</button>
        <span className="dc-count">{count}</span>
        <button className="dc-btn" onClick={onIncrease} title="Eins mehr">+</button>
        {onMoveRight && (
          <button
            className="dc-btn dc-move-arrow dc-move-arrow--right"
            onClick={onMoveRight}
            title={moveRightTitle || 'Nach rechts verschieben'}
          >→</button>
        )}
        <button className="dc-btn dc-remove" onClick={onRemove} title="Alle entfernen">✕</button>
      </div>
    </div>
  );
}
