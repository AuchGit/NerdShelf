import { useEffect, useState } from 'react';
import { parseManaCost, getCardLayout, getCardFaces } from '../services/scryfall';
import ManaSymbol from './ManaSymbol';
import './CardPreview.css';

const RARITY_COLOR = {
  common:   '#c8c8c8',
  uncommon: '#a0c4d4',
  rare:     '#d4a017',
  mythic:   '#e07828',
  special:  '#b060c0',
};

/** Splits oracle text into text and {SYMBOL} segments for inline rendering */
function OracleText({ text }) {
  if (!text) return null;
  return (
    <div className="cp-oracle">
      {text.split('\n').map((line, li) => (
        <p key={li}>
          {line.split(/(\{[^}]+\})/g).map((seg, si) => {
            const m = seg.match(/^\{([^}]+)\}$/);
            if (m) return <ManaSymbol key={si} symbol={m[1]} size="xs" />;
            return seg;
          })}
        </p>
      ))}
    </div>
  );
}

/** Shown when no card has ever been hovered */
function EmptyPreview() {
  return (
    <div className="cp-empty">
      <div className="cp-empty-symbol">✦</div>
      <div className="cp-empty-title">Kartenvorschau</div>
      <div className="cp-empty-hints">
        <span className="cp-hint-item">
          <span className="cp-hint-key">Hover</span>
          Karte anzeigen
        </span>
        <span className="cp-hint-item">
          <span className="cp-hint-key">Rechtsklick</span>
          Karte pinnen
        </span>
      </div>
      <div className="cp-empty-card-outline" />
    </div>
  );
}

export default function CardPreview({
  card, isStale, pinned, onPin, onUnpin,
  pinnedFaceIndex = null,
}) {
  const [currentFace, setCurrentFace] = useState(0);

  // Reset / sync currentFace when the card changes or a face is explicitly pinned
  useEffect(() => {
    if (pinned && pinnedFaceIndex != null) {
      setCurrentFace(pinnedFaceIndex);
    } else {
      setCurrentFace(0);
    }
  }, [card?.id, pinned, pinnedFaceIndex]);

  if (!card) return <EmptyPreview />;

  const layout    = getCardLayout(card);
  const faces     = getCardFaces(card);
  const isDouble  = layout === 'double_faced';
  const isSplit   = layout === 'split';
  const face      = faces[currentFace] || faces[0];

  const imageUrl  = face?.image_uri_large || face?.image_uri;
  const manaSyms  = parseManaCost(face?.mana_cost || '');
  const oracle    = face?.oracle_text || '';
  const flavor    = card.flavor_text ?? card.card_faces?.[currentFace]?.flavor_text ?? '';
  const power     = face?.power;
  const toughness = face?.toughness;
  const loyalty   = face?.loyalty;
  const defense   = card.defense ?? card.card_faces?.[currentFace]?.defense;

  const rColor      = RARITY_COLOR[card.rarity] ?? '#808080';
  const rarityLabel = card.rarity
    ? card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1)
    : '';

  return (
    <div className={`card-preview ${pinned ? 'is-pinned' : ''} ${isStale ? 'is-stale' : ''}`}>
      {/* Top bar: rarity + pin button */}
      <div className="cp-topbar">
        <span className="cp-rarity" style={{ color: rColor }}>{rarityLabel}</span>
        {isStale && <span className="cp-stale-label">Zuletzt gesehen</span>}
        <button
          className={`cp-pin-btn ${pinned ? 'active' : ''}`}
          onClick={pinned ? onUnpin : onPin}
          title={pinned ? 'Unpin' : 'Pinnen (Rechtsklick)'}
        >
          {pinned ? '◆ Gepinnt' : '◇ Pinnen'}
        </button>
      </div>

      {/* Card image */}
      <div className={`cp-image-wrap ${isSplit ? 'cp-image-wrap--split' : ''}`}>
        {imageUrl
          ? <img src={imageUrl} alt={face?.name || card.name} className="cp-image" />
          : <div className="cp-image-fallback">{card.name}</div>
        }
        {isDouble && (
          <button
            type="button"
            className="cp-flip-btn"
            onClick={() => setCurrentFace(f => (f === 0 ? 1 : 0))}
            title="Andere Seite zeigen"
            aria-label="Andere Seite zeigen"
          >↻</button>
        )}
      </div>

      {/* Card details */}
      <div className="cp-info">
        <div className="cp-name-row">
          <span className="cp-name">
            {isDouble ? face?.name : card.name}
          </span>
          <span className="cp-cost">
            {manaSyms.map((s, i) => <ManaSymbol key={i} symbol={s} size="sm" />)}
          </span>
        </div>

        {isDouble && (
          <div className="cp-face-indicator">
            Seite {currentFace + 1} von {faces.length}
          </div>
        )}

        <div className="cp-type">{face?.type_line || card.type_line}</div>

        {card.set_name && (
          <div className="cp-set">
            {card.set_name}
            {card.set && <span className="cp-set-code"> ({card.set.toUpperCase()})</span>}
          </div>
        )}

        {oracle && <OracleText text={oracle} />}

        {flavor && (
          <div className="cp-flavor">"{flavor}"</div>
        )}

        {/* Stats row */}
        <div className="cp-stats-row">
          {card.cmc != null && !isDouble && (
            <span className="cp-stat-chip">CMC {card.cmc}</span>
          )}
          {power != null && toughness != null && (
            <span className="cp-stat-chip cp-pt">{power}/{toughness}</span>
          )}
          {loyalty != null && (
            <span className="cp-stat-chip">Loyalty {loyalty}</span>
          )}
          {defense != null && (
            <span className="cp-stat-chip">Defense {defense}</span>
          )}
        </div>

        {/* Legalities snippet */}
        {card.legalities && (
          <div className="cp-legalities">
            {['standard','pioneer','modern','commander'].map(fmt => {
              const status = card.legalities[fmt];
              if (!status) return null;
              const legal = status === 'legal';
              return (
                <span key={fmt} className={`cp-legal-chip ${legal ? 'legal' : 'banned'}`}>
                  {fmt.charAt(0).toUpperCase() + fmt.slice(1)}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
