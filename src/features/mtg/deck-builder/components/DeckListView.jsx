import { useSettings } from '../context/SettingsContext';
import { getTypeGroup } from '../services/scryfall';
import CardItem from './CardItem';
import { CardToolbar } from './CardList';
import './DeckListView.css';

const SIZE_TO_MIN = { small: '110px', medium: '150px', large: '195px' };

const GROUP_ORDER = [
  'Creatures', 'Planeswalkers', 'Instants', 'Sorceries',
  'Enchantments', 'Artifacts', 'Lands', 'Other',
];

function organizeByType(deck) {
  const groups = {};
  for (const entry of Object.values(deck)) {
    const g = getTypeGroup(entry.card);
    if (!groups[g]) groups[g] = [];
    groups[g].push(entry);
  }
  return GROUP_ORDER
    .filter(g => groups[g])
    .map(g => ({
      label: g,
      entries: groups[g].sort((a, b) => a.card.name.localeCompare(b.card.name)),
      count: groups[g].reduce((s, e) => s + e.count, 0),
    }));
}

function Section({ title, total, deck, gridStyle, onHoverCard, onPinCard, isFavorite, onToggleFavorite }) {
  if (Object.keys(deck).length === 0) return null;
  const groups = organizeByType(deck);
  return (
    <div className="dlv-section">
      <div className="dlv-section-hdr">
        <span>{title}</span>
        <span className="dlv-section-count">{total}</span>
      </div>
      {groups.map(({ label, entries, count }) => (
        <div key={label} className="dlv-group">
          <div className="dlv-group-hdr">
            <span>{label}</span>
            <span className="dlv-group-count">{count}</span>
          </div>
          <div className="card-grid" style={gridStyle}>
            {entries.map(({ card, count: c }) => (
              <CardItem
                key={card.id}
                card={card}
                onAdd={() => {}}
                deckCount={c}
                onHover={onHoverCard}
                onHoverEnd={() => onHoverCard?.(null)}
                onPin={onPinCard}
                isFavorite={isFavorite ? isFavorite(card.id) : false}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DeckListView({
  mainboard, sideboard,
  onHoverCard, onPinCard,
  viewMode, setViewMode,
  isFavorite, onToggleFavorite,
}) {
  const { settings, updateSetting } = useSettings();

  const minWidth = SIZE_TO_MIN[settings.cardSize] ?? '150px';
  const gridStyle = settings.cardsPerRow === 'auto'
    ? { gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}, 1fr))` }
    : { gridTemplateColumns: `repeat(${settings.cardsPerRow}, 1fr)` };

  const mainTotal = Object.values(mainboard).reduce((s, e) => s + e.count, 0);
  const sideTotal = Object.values(sideboard).reduce((s, e) => s + e.count, 0);
  const isEmpty = mainTotal === 0 && sideTotal === 0;

  return (
    <div className="dlv-outer">
      <div className="dlv-scroll">
        {isEmpty ? (
          <div className="list-state">
            <div className="list-state-icon">⊕</div>
            <div className="list-state-title">Decklist ist leer</div>
            <div className="list-state-msg">
              Wechsel in den Edit-Modus, um Karten hinzuzufügen.
            </div>
          </div>
        ) : (
          <>
            <Section
              title="Mainboard"
              total={mainTotal}
              deck={mainboard}
              gridStyle={gridStyle}
              onHoverCard={onHoverCard}
              onPinCard={onPinCard}
              isFavorite={isFavorite}
              onToggleFavorite={onToggleFavorite}
            />
            <Section
              title="Sideboard"
              total={sideTotal}
              deck={sideboard}
              gridStyle={gridStyle}
              onHoverCard={onHoverCard}
              onPinCard={onPinCard}
              isFavorite={isFavorite}
              onToggleFavorite={onToggleFavorite}
            />
          </>
        )}
      </div>
      <CardToolbar
        settings={settings} updateSetting={updateSetting}
        viewMode={viewMode} setViewMode={setViewMode}
      />
    </div>
  );
}
