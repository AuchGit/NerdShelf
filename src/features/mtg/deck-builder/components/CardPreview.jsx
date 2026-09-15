import { useEffect, useState } from 'react';
import { parseManaCost, getCardLayout, getCardFaces } from '../services/scryfall';
import useLocalizedCard from '../hooks/useLocalizedCard';
import { printingLabel } from '../services/deckPrintings';
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

const TAGS_COLLAPSED = 10;

function TagList({ tags, status, activeSlugs, onToggle, expanded, onExpand }) {
  const active = new Set(activeSlugs);
  const visible = expanded ? tags : tags.slice(0, TAGS_COLLAPSED);
  const hidden = tags.length - visible.length;

  let body;
  if (tags.length > 0) {
    body = (
      <div className="cp-tag-list">
        {visible.map(t => {
          const on = active.has(t.slug);
          return (
            <button
              key={t.slug}
              type="button"
              className={`cp-tag ${on ? 'is-active' : ''}`}
              onClick={() => onToggle(t)}
              aria-pressed={on}
              title={on
                ? 'Aus der Suche entfernen'
                : `${t.description ? `${t.description}\n\n` : ''}Nach „${t.label}" suchen (${t.count.toLocaleString()} Karten)`}
            >{t.label}</button>
          );
        })}
        {hidden > 0 && (
          <button type="button" className="cp-tag cp-tag-more" onClick={onExpand}>
            +{hidden} mehr
          </button>
        )}
      </div>
    );
  } else if (status === 'loading' || status === 'idle') {
    body = <div className="cp-tags-note">Tags werden geladen…</div>;
  } else if (status === 'error') {
    body = <div className="cp-tags-note">Tags gerade nicht verfügbar.</div>;
  } else {
    body = <div className="cp-tags-note">Keine Tags für diese Karte.</div>;
  }

  return (
    <div className="cp-tags">
      <div className="cp-tags-head">Tags</div>
      {body}
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
  card: cardProp, isStale, pinned, onPin, onUnpin,
  pinnedFaceIndex = null,
  // Artwork choice for this deck (optional): the chosen printing summary
  // or null, plus the handlers to open the picker / reset to standard.
  printing = null, onChooseArtwork, onResetArtwork,
  // Scryfall oracle tags (optional): the card's tags, the index status,
  // which tags are active search filters, and the toggle / load handlers.
  tags = [], tagStatus = 'idle', activeTagSlugs = [], onToggleTag, onLoadTags,
}) {
  // Shown in the card language from the MTG settings when that printing
  // exists in it; identical to the passed card for English (the default).
  const card = useLocalizedCard(cardProp);
  // Face shown for double-faced cards. A pick only counts for the card /
  // pinned face it was made on — a new card starts at its pinned face or 0.
  const faceKey = `${card?.id}|${pinned ? 1 : 0}|${pinnedFaceIndex}`;
  const [facePick, setFacePick] = useState({ key: null, face: 0 });
  const currentFace = facePick.key === faceKey
    ? facePick.face
    : (pinned && pinnedFaceIndex != null ? pinnedFaceIndex : 0);
  const setCurrentFace = (updater) => setFacePick({
    key: faceKey,
    face: typeof updater === 'function' ? updater(currentFace) : updater,
  });
  // Card id whose full tag list is expanded (collapses again on the next card).
  const [tagsExpandedFor, setTagsExpandedFor] = useState(null);

  // First card on screen → fetch the tag data (cached after the first time).
  useEffect(() => {
    if (card && onToggleTag && tagStatus === 'idle') onLoadTags?.();
  }, [card, onToggleTag, tagStatus, onLoadTags]);

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

      {/* Artwork choice for this deck */}
      {onChooseArtwork && (
        <div className="cp-art-row">
          <span
            className={`cp-art-label ${printing ? 'is-custom' : ''}`}
            title={printing ? 'Feste Edition in diesem Deck' : 'Keine feste Edition gewählt'}
          >
            {printing ? printingLabel(printing) : 'Standard-Artwork'}
          </span>
          {printing && onResetArtwork && (
            <button
              type="button"
              className="cp-art-btn"
              onClick={onResetArtwork}
              title="Feste Edition entfernen"
            >Standard</button>
          )}
          <button
            type="button"
            className="cp-art-btn is-primary"
            onClick={onChooseArtwork}
          >Artwork wählen</button>
        </div>
      )}

      {/* Card details */}
      <div className="cp-info">
        <div className="cp-name-row">
          <span className="cp-name">
            {isDouble ? face?.name : (card.printed_name || card.name)}
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

        {/* Scryfall Tagger tags — click toggles the tag as search filter */}
        {onToggleTag && (
          <TagList
            tags={tags}
            status={tagStatus}
            activeSlugs={activeTagSlugs}
            onToggle={onToggleTag}
            expanded={tagsExpandedFor === card.id}
            onExpand={() => setTagsExpandedFor(card.id)}
          />
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
