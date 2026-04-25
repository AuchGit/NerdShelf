// src/features/mtg/deck-builder/components/DeckCard.jsx
import { getCardImage, getManaCost, parseManaCost } from '../services/scryfall';
import ManaSymbol from './ManaSymbol';
import './DeckCard.css';

export default function DeckCard({
  card, count,
  onIncrease, onDecrease, onRemove,
  onMove,          // optional: () => void — shows ↕ arrow
  moveTitle,       // optional tooltip for the move button
  onHover,         // optional: (card) => void
  onPin,           // optional: (card) => void — right-click pins to preview
}) {
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
      onMouseEnter={() => onHover?.(card)}
      onMouseLeave={() => onHover?.(null)}
      onContextMenu={handleContextMenu}
      title={onPin ? 'Rechtsklick: in Vorschau pinnen' : undefined}
    >
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
      </div>

      <div className="dc-controls">
        <button className="dc-btn" onClick={onDecrease} title="Eins weniger">−</button>
        <span className="dc-count">{count}</span>
        <button className="dc-btn" onClick={onIncrease} title="Eins mehr">+</button>
        {onMove && (
          <button className="dc-btn" onClick={onMove} title={moveTitle || 'Verschieben'}>↕</button>
        )}
        <button className="dc-btn dc-remove" onClick={onRemove} title="Alle entfernen">✕</button>
      </div>
    </div>
  );
}
