import { useSettings } from '../context/SettingsContext';
import CardItem from './CardItem';
import './CardList.css';

const SIZE_OPTS = [
  { value: 'small',  label: 'S', minWidth: '110px' },
  { value: 'medium', label: 'M', minWidth: '150px' },
  { value: 'large',  label: 'L', minWidth: '195px' },
];

const COL_OPTS = [
  { value: 'auto', label: '∞' },
  { value: 2,      label: '2' },
  { value: 3,      label: '3' },
  { value: 4,      label: '4' },
  { value: 5,      label: '5' },
  { value: 6,      label: '6' },
];

export default function CardList({
  cards, loading, error, hasMore, onLoadMore, onAddCard, deck,
  onHoverCard, onPinCard, pinnedCard,
  viewMode, setViewMode,
}) {
  const { settings, updateSetting } = useSettings();

  const minWidth = SIZE_OPTS.find(s => s.value === settings.cardSize)?.minWidth ?? '150px';
  const gridStyle = settings.cardsPerRow === 'auto'
    ? { gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}, 1fr))` }
    : { gridTemplateColumns: `repeat(${settings.cardsPerRow}, 1fr)` };

  if (error) {
    return (
      <>
        <div className="list-state">
          <div className="list-state-icon">⚠</div>
          <div className="list-state-title">Suche fehlgeschlagen</div>
          <div className="list-state-msg">{error}</div>
        </div>
        <CardToolbar
          settings={settings} updateSetting={updateSetting}
          viewMode={viewMode} setViewMode={setViewMode}
        />
      </>
    );
  }

  if (!loading && cards.length === 0) {
    return (
      <>
        <div className="list-state">
          <div className="list-state-icon">✦</div>
          <div className="list-state-title">Die Bibliothek wartet</div>
          <div className="list-state-msg">
            Suche nach Kartennamen, Oracle-Text, Farbe oder Typ.
            <br />
            <em>Probier: „lightning bolt", „draw a card", Farben wählen…</em>
          </div>
        </div>
        <CardToolbar
          settings={settings} updateSetting={updateSetting}
          viewMode={viewMode} setViewMode={setViewMode}
        />
      </>
    );
  }

  return (
    <div className="card-list-outer">
      <div className="card-grid" style={gridStyle}>
        {cards.map(card => (
          <CardItem
            key={card.id}
            card={card}
            onAdd={onAddCard}
            deckCount={deck[card.id]?.count || 0}
            onHover={onHoverCard}
            onHoverEnd={() => onHoverCard?.(null)}
            onPin={onPinCard}
          />
        ))}
      </div>

      {loading && (
        <div className="list-loading">
          <span className="loading-rune">✦</span>
          <span className="loading-rune">✧</span>
          <span className="loading-rune">✦</span>
        </div>
      )}

      {!loading && hasMore && (
        <button className="load-more-btn" onClick={onLoadMore}>
          Mehr Karten laden
        </button>
      )}

      {!loading && !hasMore && cards.length > 0 && (
        <div className="list-end">— Ende der Ergebnisse —</div>
      )}

      <CardToolbar
        settings={settings} updateSetting={updateSetting}
        viewMode={viewMode} setViewMode={setViewMode}
      />
    </div>
  );
}

export function CardToolbar({ settings, updateSetting, viewMode, setViewMode }) {
  return (
    <div className="card-toolbar">
      <div className="toolbar-group">
        <span className="toolbar-label">Größe</span>
        <div className="toolbar-pills">
          {SIZE_OPTS.map(({ value, label }) => (
            <button
              key={value}
              className={`toolbar-pill ${settings.cardSize === value ? 'active' : ''}`}
              onClick={() => updateSetting('cardSize', value)}
              title={value}
            >{label}</button>
          ))}
        </div>
      </div>
      <div className="toolbar-divider" />
      <div className="toolbar-group">
        <span className="toolbar-label">Spalten</span>
        <div className="toolbar-pills">
          {COL_OPTS.map(({ value, label }) => (
            <button
              key={value}
              className={`toolbar-pill ${settings.cardsPerRow === value ? 'active' : ''}`}
              onClick={() => updateSetting('cardsPerRow', value)}
            >{label}</button>
          ))}
        </div>
      </div>

      {setViewMode && (
        <>
          <div className="toolbar-divider" />
          <div className="toolbar-group toolbar-group--right">
            <span className="toolbar-label">Modus</span>
            <div className="toolbar-pills">
              <button
                className={`toolbar-pill ${viewMode === 'edit' ? 'active' : ''}`}
                onClick={() => setViewMode('edit')}
                title="Suche & Karten hinzufügen"
              >Edit</button>
              <button
                className={`toolbar-pill ${viewMode === 'view' ? 'active' : ''}`}
                onClick={() => setViewMode('view')}
                title="Decklist als Liste anzeigen"
              >View</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
