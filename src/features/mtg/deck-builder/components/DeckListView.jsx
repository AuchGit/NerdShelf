import { useSettings } from '../context/settings';
import { organizeDeck } from '../services/deckOrganize';
import CardItem from './CardItem';
import { CardToolbar } from './CardList';
import './DeckListView.css';

const SIZE_TO_MIN = { small: '110px', medium: '150px', large: '195px' };

// Same sort modes as the deck panel, plus price.
const SORT_OPTIONS = [
  { id: 'type',   label: 'Typ' },
  { id: 'name',   label: 'Name' },
  { id: 'cmc',    label: 'Manakosten' },
  { id: 'color',  label: 'Farbe' },
  { id: 'rarity', label: 'Seltenheit' },
  { id: 'price',  label: 'Preis' },
];

function CardGrid({ entries, gridStyle, onHoverCard, onPinCard, isFavorite, onToggleFavorite }) {
  return (
    <div className="card-grid" style={gridStyle}>
      {entries.map(({ card, count: c }) => (
        <CardItem
          key={card.id}
          card={card}
          deckCount={c}
          onHover={onHoverCard}
          onHoverEnd={() => onHoverCard?.(null)}
          onPin={onPinCard}
          isFavorite={isFavorite ? isFavorite(card.id) : false}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </div>
  );
}

function Section({ title, total, deck, sortMode, thenMode, gridProps }) {
  if (Object.keys(deck).length === 0) return null;
  const groups = organizeDeck(deck, sortMode, thenMode);
  return (
    <div className="dlv-section">
      <div className="dlv-section-hdr">
        <span>{title}</span>
        <span className="dlv-section-count">{total}</span>
      </div>
      {groups.map(({ groupLabel, entries, groupCount, subgroups }, gi) => (
        <div key={groupLabel ?? `g${gi}`} className="dlv-group">
          {groupLabel && (
            <div className="dlv-group-hdr">
              <span>{groupLabel}</span>
              <span className="dlv-group-count">{groupCount}</span>
            </div>
          )}
          {subgroups
            ? subgroups.map(s => (
              <div key={s.label} className="dlv-subgroup">
                <div className="dlv-subgroup-hdr">
                  <span>{s.label}</span>
                  <span className="dlv-group-count">{s.count}</span>
                </div>
                <CardGrid entries={s.entries} {...gridProps} />
              </div>
            ))
            : <CardGrid entries={entries} {...gridProps} />}
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
  const sortMode = SORT_OPTIONS.some(o => o.id === settings.deckListSort)
    ? settings.deckListSort
    : 'type';
  const thenMode = SORT_OPTIONS.some(o => o.id === settings.deckListSort2) && settings.deckListSort2 !== sortMode
    ? settings.deckListSort2
    : '';
  const gridProps = { gridStyle, onHoverCard, onPinCard, isFavorite, onToggleFavorite };

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
            <div className="dlv-sort" role="group" aria-label="Sortierung">
              <span className="dlv-sort-label">Sortieren:</span>
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  className={`dlv-sort-pill ${sortMode === opt.id ? 'active' : ''}`}
                  onClick={() => updateSetting('deckListSort', opt.id)}
                  aria-pressed={sortMode === opt.id}
                >{opt.label}</button>
              ))}
              <label className="dlv-sort-then">
                <span className="dlv-sort-label">dann nach</span>
                <select
                  value={thenMode}
                  onChange={(e) => updateSetting('deckListSort2', e.target.value)}
                >
                  <option value="">–</option>
                  {SORT_OPTIONS.filter(o => o.id !== sortMode).map(o => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <Section
              title="Mainboard"
              total={mainTotal}
              deck={mainboard}
              sortMode={sortMode}
              thenMode={thenMode}
              gridProps={gridProps}
            />
            <Section
              title="Sideboard"
              total={sideTotal}
              deck={sideboard}
              sortMode={sortMode}
              thenMode={thenMode}
              gridProps={gridProps}
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
