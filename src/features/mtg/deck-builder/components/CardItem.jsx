import { useState } from 'react';
import { getCardImage, getManaCost, parseManaCost } from '../services/scryfall';
import ManaSymbol from './ManaSymbol';
import './CardItem.css';

export default function CardItem({ card, onAdd, deckCount, onHover, onHoverEnd, onPin }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const imageUrl = getCardImage(card);
  const manaCost = getManaCost(card);
  const manaSyms = parseManaCost(manaCost);

  const handleContextMenu = (e) => {
    e.preventDefault();
    onPin?.(card);
  };

  return (
    <div
      className="card-item"
      onClick={() => onAdd(card)}
      onMouseEnter={() => onHover?.(card)}
      onMouseLeave={() => onHoverEnd?.()}
      onContextMenu={handleContextMenu}
    >
      <div className="card-img-wrap">
        {!imgLoaded && <div className="card-img-skeleton" />}
        {imageUrl && (
          <img
            src={imageUrl}
            alt={card.name}
            className={`card-img ${imgLoaded ? 'loaded' : ''}`}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
          />
        )}
        {!imageUrl && (
          <div className="card-img-fallback">
            <span>{card.name}</span>
          </div>
        )}
        {deckCount > 0 && (
          <span className="deck-badge">{deckCount}</span>
        )}
        <div className="card-hover-overlay">
          <span>+ Hinzufügen</span>
        </div>
      </div>
      <div className="card-meta">
        <div className="card-meta-top">
          <span className="card-name">{card.name}</span>
          <span className="card-cost">
            {manaSyms.map((s, i) => <ManaSymbol key={i} symbol={s} size="xs" />)}
          </span>
        </div>
        <span className="card-type">{card.type_line}</span>
      </div>
    </div>
  );
}
