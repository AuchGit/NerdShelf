import { useState } from 'react';
import {
  getManaCost, parseManaCost, getCardLayout, getCardFaces,
} from '../services/scryfall';
import ManaSymbol from './ManaSymbol';
import './CardItem.css';

function FaceImage({ face, alt, onClick, className = '' }) {
  const [loaded, setLoaded] = useState(false);
  const url = face?.image_uri;
  return (
    <div
      className={`card-img-wrap ${className}`}
      onContextMenu={onClick}
    >
      {!loaded && <div className="card-img-skeleton" />}
      {url ? (
        <img
          src={url}
          alt={alt}
          className={`card-img ${loaded ? 'loaded' : ''}`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
        />
      ) : (
        <div className="card-img-fallback">
          <span>{alt}</span>
        </div>
      )}
    </div>
  );
}

export default function CardItem({
  card, onAdd, deckCount, onHover, onHoverEnd, onPin,
  isFavorite = false, onToggleFavorite,
}) {
  const layout = getCardLayout(card);
  const faces  = getCardFaces(card);
  const isWide = layout === 'split' || layout === 'double_faced';

  const manaCost = getManaCost(card);
  const manaSyms = parseManaCost(manaCost);

  const handleContextMenu = (e) => {
    e.preventDefault();
    onPin?.(card);
  };

  // Right-click on a specific face of a double-faced card pins that face index
  const handleFaceContext = (faceIndex) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    onPin?.(card, faceIndex);
  };

  const handleStarClick = (e) => {
    e.stopPropagation();
    onToggleFavorite?.(card);
  };

  const [imgLoaded, setImgLoaded] = useState(false);
  const normalImageUrl = layout === 'normal' ? faces[0]?.image_uri : null;

  return (
    <div
      className={`card-item ${isFavorite ? 'is-favorite' : ''} ${isWide ? 'card-tile-wide' : ''} card-layout-${layout}`}
      onClick={() => onAdd(card)}
      onMouseEnter={() => onHover?.(card)}
      onMouseLeave={() => onHoverEnd?.()}
      onContextMenu={handleContextMenu}
    >
      {layout === 'normal' && (
        <div className="card-img-wrap">
          {!imgLoaded && <div className="card-img-skeleton" />}
          {normalImageUrl ? (
            <img
              src={normalImageUrl}
              alt={card.name}
              className={`card-img ${imgLoaded ? 'loaded' : ''}`}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
            />
          ) : (
            <div className="card-img-fallback">
              <span>{card.name}</span>
            </div>
          )}
          {deckCount > 0 && <span className="deck-badge">{deckCount}</span>}
          {onToggleFavorite && (
            <button
              type="button"
              className={`fav-star ${isFavorite ? 'active' : ''}`}
              onClick={handleStarClick}
              title={isFavorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
              aria-label={isFavorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
            >
              {isFavorite ? '★' : '☆'}
            </button>
          )}
          <div className="card-hover-overlay">
            <span>+ Hinzufügen</span>
          </div>
        </div>
      )}

      {layout === 'split' && (
        <div className="card-img-wrap card-img-wrap--split">
          {!imgLoaded && <div className="card-img-skeleton" />}
          {faces[0]?.image_uri ? (
            <img
              src={faces[0].image_uri}
              alt={card.name}
              className={`card-img ${imgLoaded ? 'loaded' : ''}`}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
            />
          ) : (
            <div className="card-img-fallback">
              <span>{card.name}</span>
            </div>
          )}
          {deckCount > 0 && <span className="deck-badge">{deckCount}</span>}
          {onToggleFavorite && (
            <button
              type="button"
              className={`fav-star ${isFavorite ? 'active' : ''}`}
              onClick={handleStarClick}
              title={isFavorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
            >
              {isFavorite ? '★' : '☆'}
            </button>
          )}
          <div className="card-hover-overlay">
            <span>+ Hinzufügen</span>
          </div>
        </div>
      )}

      {layout === 'double_faced' && (
        <div className="card-faces">
          <FaceImage
            face={faces[0]}
            alt={faces[0]?.name || card.name}
            onClick={handleFaceContext(0)}
          />
          <FaceImage
            face={faces[1]}
            alt={faces[1]?.name || card.name}
            onClick={handleFaceContext(1)}
          />
          {deckCount > 0 && <span className="deck-badge">{deckCount}</span>}
          {onToggleFavorite && (
            <button
              type="button"
              className={`fav-star ${isFavorite ? 'active' : ''}`}
              onClick={handleStarClick}
              title={isFavorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
            >
              {isFavorite ? '★' : '☆'}
            </button>
          )}
          <div className="card-hover-overlay">
            <span>+ Hinzufügen</span>
          </div>
        </div>
      )}

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
