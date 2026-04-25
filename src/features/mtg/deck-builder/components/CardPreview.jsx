import { getCardImage, getManaCost, parseManaCost } from '../services/scryfall';
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

export default function CardPreview({ card, isStale, pinned, onPin, onUnpin }) {
  if (!card) return <EmptyPreview />;

  const imageUrl  = getCardImage(card, 'large') || getCardImage(card, 'normal');
  const manaCost  = getManaCost(card);
  const manaSyms  = parseManaCost(manaCost);

  const oracle    = card.oracle_text       ?? card.card_faces?.[0]?.oracle_text ?? '';
  const flavor    = card.flavor_text       ?? card.card_faces?.[0]?.flavor_text ?? '';
  const power     = card.power             ?? card.card_faces?.[0]?.power;
  const toughness = card.toughness         ?? card.card_faces?.[0]?.toughness;
  const loyalty   = card.loyalty           ?? card.card_faces?.[0]?.loyalty;
  const defense   = card.defense           ?? card.card_faces?.[0]?.defense;

  const rColor     = RARITY_COLOR[card.rarity] ?? '#808080';
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
          {pinned ? '📌 Gepinnt' : '📌 Pinnen'}
        </button>
      </div>

      {/* Card image */}
      <div className="cp-image-wrap">
        {imageUrl
          ? <img src={imageUrl} alt={card.name} className="cp-image" />
          : <div className="cp-image-fallback">{card.name}</div>
        }
      </div>

      {/* Card details */}
      <div className="cp-info">
        <div className="cp-name-row">
          <span className="cp-name">{card.name}</span>
          <span className="cp-cost">
            {manaSyms.map((s, i) => <ManaSymbol key={i} symbol={s} size="sm" />)}
          </span>
        </div>

        <div className="cp-type">{card.type_line}</div>

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
          {card.cmc != null && (
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
