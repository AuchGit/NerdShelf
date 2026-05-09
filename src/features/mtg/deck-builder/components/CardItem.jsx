import { useState } from 'react';
import {
  getManaCost, parseManaCost, getCardLayout, getCardFaces,
  getCardPriceEur, formatEur,
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
  card, onAdd, onAddSide, deckCount, onHover, onHoverEnd, onPin,
  isFavorite = false, onToggleFavorite,
  ownedQty = 0, onIncOwned, onDecOwned,
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

  const handleSideClick = (e) => {
    e.stopPropagation();
    onAddSide?.(card);
  };

  const handleAddClick = (e) => {
    e.stopPropagation();
    onAdd?.(card);
  };

  const handleIncOwnedClick = (e) => {
    e.stopPropagation();
    onIncOwned?.(card);
  };

  const handleDecOwnedClick = (e) => {
    e.stopPropagation();
    onDecOwned?.(card);
  };

  const priceEur = getCardPriceEur(card);
  const priceLabel = priceEur != null ? formatEur(priceEur) : null;

  // Hover overlay shared across all card layouts: stacked "+ Hinzufügen" / "+ SB"
  // / "+ Sammlung" / "− Sammlung". Inventory buttons are gated on the handlers
  // being supplied so non-builder views (favorites/etc.) stay click-clean.
  const hoverOverlay = (
    <div className="card-hover-overlay">
      <button
        type="button"
        className="card-hover-btn"
        onClick={handleAddClick}
        title="Ins Mainboard hinzufügen"
      >
        + Hinzufügen
      </button>
      {onAddSide && (
        <button
          type="button"
          className="card-hover-btn"
          onClick={handleSideClick}
          title="Direkt ins Sideboard"
        >
          + Sideboard
        </button>
      )}
      {onIncOwned && (
        <button
          type="button"
          className="card-hover-btn card-hover-btn--inv"
          onClick={handleIncOwnedClick}
          title="Eine Kopie zur Sammlung hinzufügen"
        >
          + Sammlung
        </button>
      )}
      {onDecOwned && ownedQty > 0 && (
        <button
          type="button"
          className="card-hover-btn card-hover-btn--inv"
          onClick={handleDecOwnedClick}
          title="Eine Kopie aus der Sammlung entfernen"
        >
          − Sammlung
        </button>
      )}
    </div>
  );

  const [imgLoaded, setImgLoaded] = useState(false);
  // Whether the loaded split-card image is naturally landscape (Scryfall returns
  // most modern split layouts pre-rotated to landscape — only legacy printings
  // come through as portrait that needs the -90° rotation).
  const [splitIsLandscape, setSplitIsLandscape] = useState(false);
  const normalImageUrl = layout === 'normal' ? faces[0]?.image_uri : null;

  const handleSplitLoad = (e) => {
    setImgLoaded(true);
    const t = e.currentTarget;
    setSplitIsLandscape(t.naturalWidth >= t.naturalHeight);
  };

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
          {ownedQty > 0 && <span className="owned-badge" title={`${ownedQty} in deiner Sammlung`}>◉ {ownedQty}</span>}
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
          {hoverOverlay}
        </div>
      )}

      {layout === 'split' && (
        <div className={`card-img-wrap card-img-wrap--split ${splitIsLandscape ? 'is-landscape' : 'is-portrait'}`}>
          {!imgLoaded && <div className="card-img-skeleton" />}
          {faces[0]?.image_uri ? (
            <img
              src={faces[0].image_uri}
              alt={card.name}
              className={`card-img ${imgLoaded ? 'loaded' : ''}`}
              loading="lazy"
              onLoad={handleSplitLoad}
            />
          ) : (
            <div className="card-img-fallback">
              <span>{card.name}</span>
            </div>
          )}
          {deckCount > 0 && <span className="deck-badge">{deckCount}</span>}
          {ownedQty > 0 && <span className="owned-badge" title={`${ownedQty} in deiner Sammlung`}>◉ {ownedQty}</span>}
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
          {hoverOverlay}
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
          {ownedQty > 0 && <span className="owned-badge" title={`${ownedQty} in deiner Sammlung`}>◉ {ownedQty}</span>}
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
          {hoverOverlay}
        </div>
      )}

      <div className="card-meta">
        <div className="card-meta-top">
          <span className="card-name">{card.name}</span>
          <span className="card-cost">
            {manaSyms.map((s, i) => <ManaSymbol key={i} symbol={s} size="xs" />)}
          </span>
        </div>
        <div
          style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            gap: 6,
          }}
        >
          <span className="card-type">{card.type_line}</span>
          {priceLabel && (
            <span
              title="Cardmarket Trend (EUR via Scryfall)"
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--text-mid, #888)',
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {priceLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
