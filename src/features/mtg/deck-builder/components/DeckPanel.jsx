// src/features/mtg/deck-builder/components/DeckPanel.jsx
import { useState } from 'react';
import DeckCard from './DeckCard';
import { getTypeGroup } from '../services/scryfall';
import './DeckPanel.css';

const GROUP_ORDER = [
  'Creatures', 'Planeswalkers', 'Instants', 'Sorceries',
  'Enchantments', 'Artifacts', 'Lands', 'Other',
];

const SORT_OPTIONS = [
  { id: 'type',   label: 'Typ' },
  { id: 'name',   label: 'Name' },
  { id: 'cmc',    label: 'Manakosten' },
  { id: 'color',  label: 'Farbe' },
  { id: 'rarity', label: 'Seltenheit' },
];

const COLOR_LABEL = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };
const COLOR_STYLE = {
  W: '#f5e9a0', U: '#1a78cc', B: '#6040a0', R: '#cc3020', G: '#1a6e28', C: '#808080',
};

const RARITY_ORDER = { mythic: 0, rare: 1, uncommon: 2, common: 3, special: 4, bonus: 5 };
const RARITY_LABEL = {
  mythic: 'Mythic', rare: 'Rare', uncommon: 'Uncommon',
  common: 'Common', special: 'Special', bonus: 'Bonus',
};

// Map a card to a primary color group for the 'color' sort
function colorGroup(card) {
  const cs = card.colors || [];
  if (cs.length === 0) return 'C';
  if (cs.length > 1)   return 'M';   // multicolor
  return cs[0];                       // 'W' | 'U' | 'B' | 'R' | 'G'
}
const COLOR_GROUP_ORDER = ['W', 'U', 'B', 'R', 'G', 'M', 'C'];
const COLOR_GROUP_LABEL = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green',
  M: 'Multicolor', C: 'Colorless',
};

function manaValue(card) {
  const v = card.cmc;
  return typeof v === 'number' ? v : (Number(v) || 0);
}

/** Group + sort entries based on active sort mode. Returns an array of
 *  `{ groupLabel, groupCount, entries }` ready to render. */
function organizeDeck(deck, sortMode) {
  const entries = Object.values(deck);

  if (sortMode === 'type') {
    const groups = {};
    for (const e of entries) {
      const g = getTypeGroup(e.card);
      if (!groups[g]) groups[g] = [];
      groups[g].push(e);
    }
    return GROUP_ORDER
      .filter(g => groups[g])
      .map(g => ({
        groupLabel: g,
        entries: groups[g].sort((a, b) => a.card.name.localeCompare(b.card.name)),
        groupCount: groups[g].reduce((s, e) => s + e.count, 0),
      }));
  }

  if (sortMode === 'color') {
    const groups = {};
    for (const e of entries) {
      const g = colorGroup(e.card);
      if (!groups[g]) groups[g] = [];
      groups[g].push(e);
    }
    return COLOR_GROUP_ORDER
      .filter(g => groups[g])
      .map(g => ({
        groupLabel: COLOR_GROUP_LABEL[g],
        entries: groups[g].sort((a, b) => a.card.name.localeCompare(b.card.name)),
        groupCount: groups[g].reduce((s, e) => s + e.count, 0),
      }));
  }

  if (sortMode === 'rarity') {
    const groups = {};
    for (const e of entries) {
      const r = e.card.rarity || 'common';
      if (!groups[r]) groups[r] = [];
      groups[r].push(e);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => (RARITY_ORDER[a] ?? 99) - (RARITY_ORDER[b] ?? 99))
      .map(([r, es]) => ({
        groupLabel: RARITY_LABEL[r] || r,
        entries: es.sort((a, b) => a.card.name.localeCompare(b.card.name)),
        groupCount: es.reduce((s, e) => s + e.count, 0),
      }));
  }

  if (sortMode === 'cmc') {
    // Group by integer mana value; lands get their own bucket at the end
    const groups = {};
    for (const e of entries) {
      const isLand = e.card.type_line?.includes('Land');
      const key = isLand ? 'Land' : String(Math.floor(manaValue(e.card)));
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    }
    const numericKeys = Object.keys(groups)
      .filter(k => k !== 'Land')
      .sort((a, b) => Number(a) - Number(b));
    const ordered = numericKeys.map(k => [k, groups[k]]);
    if (groups['Land']) ordered.push(['Land', groups['Land']]);
    return ordered.map(([k, es]) => ({
      groupLabel: k === 'Land' ? 'Land' : `${k} CMC`,
      entries: es.sort((a, b) =>
        manaValue(a.card) - manaValue(b.card) || a.card.name.localeCompare(b.card.name)
      ),
      groupCount: es.reduce((s, e) => s + e.count, 0),
    }));
  }

  // sortMode === 'name' → single flat list
  return [{
    groupLabel: null,
    entries: entries.sort((a, b) => a.card.name.localeCompare(b.card.name)),
    groupCount: entries.reduce((s, e) => s + e.count, 0),
  }];
}

function getManaStats(deck) {
  const counts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const { card, count } of Object.values(deck)) {
    if (!card.colors) continue;
    for (const c of card.colors) {
      if (counts[c] !== undefined) counts[c] += count;
    }
    if (card.colors.length === 0) counts.C += count;
  }
  return counts;
}

export default function DeckPanel({
  mainboard,
  sideboard,
  onUpdateMainCount,
  onRemoveMain,
  onClearDeck,
  onUpdateSideCount,
  onRemoveSide,
  onMoveToSideboard,
  onMoveToMainboard,
  onHoverCard,
  onPinCard,
  onExportDeck,
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [tab, setTab] = useState('main');
  const [sortMode, setSortMode] = useState('type');

  const mainEntries = Object.values(mainboard);
  const sideEntries = Object.values(sideboard);
  const mainTotal   = mainEntries.reduce((s, e) => s + e.count, 0);
  const sideTotal   = sideEntries.reduce((s, e) => s + e.count, 0);

  const activeDeck = tab === 'main' ? mainboard : sideboard;
  const organized  = organizeDeck(activeDeck, sortMode);

  const manaStats   = getManaStats(mainboard);
  const maxMana     = Math.max(...Object.values(manaStats), 1);

  const handleClear = () => {
    if (confirmClear) {
      onClearDeck();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 2500);
    }
  };

  return (
    <div className="deck-panel">
      {/* Header */}
      <div className="dp-header">
        <div className="dp-title">
          <span className="dp-icon">⚔</span>
          <span>Deck</span>
        </div>
        <div className="dp-header-right">
          {onExportDeck && (mainTotal > 0 || sideTotal > 0) && (
            <button
              className="dp-clear-btn dp-export-btn"
              onClick={onExportDeck}
              title="Decklist als Text in die Zwischenablage"
            >Export</button>
          )}
          {(mainTotal > 0 || sideTotal > 0) && (
            <button
              className={`dp-clear-btn ${confirmClear ? 'confirm' : ''}`}
              onClick={handleClear}
            >
              {confirmClear ? 'Sicher?' : 'Clear'}
            </button>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="dp-tabs">
        <button
          className={`dp-tab ${tab === 'main' ? 'active' : ''}`}
          onClick={() => setTab('main')}
        >
          Mainboard <span className="dp-tab-count">{mainTotal}/60</span>
        </button>
        <button
          className={`dp-tab ${tab === 'side' ? 'active' : ''}`}
          onClick={() => setTab('side')}
        >
          Sideboard <span className="dp-tab-count">{sideTotal}/15</span>
        </button>
      </div>

      {/* Sort selector */}
      <div className="dp-sort">
        <span className="dp-sort-label">Sortieren:</span>
        <div className="dp-sort-pills">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.id}
              className={`dp-sort-pill ${sortMode === opt.id ? 'active' : ''}`}
              onClick={() => setSortMode(opt.id)}
            >{opt.label}</button>
          ))}
        </div>
      </div>

      {/* Progress bar for active section */}
      <div className="dp-progress-wrap">
        <div
          className="dp-progress-bar"
          style={{
            width: tab === 'main'
              ? `${Math.min((mainTotal / 60) * 100, 100)}%`
              : `${Math.min((sideTotal / 15) * 100, 100)}%`,
          }}
        />
      </div>

      {/* Mana curve mini stats (only for mainboard) */}
      {tab === 'main' && mainTotal > 0 && (
        <div className="dp-mana-stats">
          {Object.entries(manaStats)
            .filter(([, v]) => v > 0)
            .map(([color, count]) => (
              <div key={color} className="dp-mana-bar-wrap" title={`${COLOR_LABEL[color]}: ${count}`}>
                <div
                  className="dp-mana-bar"
                  style={{
                    height: `${Math.round((count / maxMana) * 24)}px`,
                    background: COLOR_STYLE[color],
                    minHeight: '4px',
                  }}
                />
                <span className="dp-mana-label" style={{ color: COLOR_STYLE[color] }}>{color}</span>
              </div>
            ))}
        </div>
      )}

      {/* List */}
      {(tab === 'main' ? mainTotal : sideTotal) === 0 ? (
        <div className="dp-empty">
          <div className="dp-empty-icon">⊕</div>
          <div>{tab === 'main'
            ? 'Klicke Karten in der Suche, um sie hinzuzufügen'
            : 'Leeres Sideboard'}</div>
          {tab === 'side' && (
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-lo)', marginTop: 6 }}>
              Über das ↕ Symbol bei einer Main-Karte verschieben
            </div>
          )}
        </div>
      ) : (
        <div className="dp-list">
          {organized.map((group, gi) => (
            <div key={group.groupLabel ?? `g${gi}`} className="dp-group">
              {group.groupLabel && (
                <div className="dp-group-hdr">
                  <span>{group.groupLabel}</span>
                  <span className="dp-group-count">{group.groupCount}</span>
                </div>
              )}
              {group.entries.map(({ card, count }) => (
                <DeckCard
                  key={card.id}
                  card={card}
                  count={count}
                  onIncrease={() =>
                    tab === 'main'
                      ? onUpdateMainCount(card.id, 1)
                      : onUpdateSideCount(card.id, 1)
                  }
                  onDecrease={() =>
                    tab === 'main'
                      ? onUpdateMainCount(card.id, -1)
                      : onUpdateSideCount(card.id, -1)
                  }
                  onRemove={() =>
                    tab === 'main' ? onRemoveMain(card.id) : onRemoveSide(card.id)
                  }
                  onMove={() =>
                    tab === 'main'
                      ? onMoveToSideboard(card.id)
                      : onMoveToMainboard(card.id)
                  }
                  moveTitle={tab === 'main' ? 'Ins Sideboard' : 'Ins Mainboard'}
                  onHover={onHoverCard}
                  onPin={onPinCard}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
