import { useState } from 'react';
import './CardSearch.css';

const COLORS = [
  { id: 'W', label: 'W', title: 'Weiß'    },
  { id: 'U', label: 'U', title: 'Blau'    },
  { id: 'B', label: 'B', title: 'Schwarz' },
  { id: 'R', label: 'R', title: 'Rot'     },
  { id: 'G', label: 'G', title: 'Grün'    },
  { id: 'C', label: 'C', title: 'Farblos' },
];

const TYPES = [
  '', 'Creature', 'Instant', 'Sorcery',
  'Enchantment', 'Artifact', 'Planeswalker', 'Battle',
];

const RARITIES = [
  { id: 'common',   label: 'C', title: 'Common'   },
  { id: 'uncommon', label: 'U', title: 'Uncommon'  },
  { id: 'rare',     label: 'R', title: 'Rare'      },
  { id: 'mythic',   label: 'M', title: 'Mythic'    },
];

const RARITY_COLORS = {
  common:   'var(--text-mid)',
  uncommon: '#a0c4d4',
  rare:     'var(--accent)',
  mythic:   '#e07828',
};

// Override-only list — empty means "use deck format (or none)".
const FORMATS = [
  '', 'standard', 'pioneer', 'modern', 'legacy',
  'vintage', 'pauper', 'commander', 'brawl',
  'historic', 'alchemy', 'penny', 'oathbreaker',
];

const SORT_OPTIONS = [
  { value: 'name',     label: 'Name'    },
  { value: 'color',    label: 'Farbe'   },
  { value: 'cmc',      label: 'Mana'    },
  { value: 'type',     label: 'Typ'     },
  { value: 'rarity',   label: 'Rarität' },
  { value: 'set',      label: 'Set'     },
  { value: 'released', label: 'Datum'   },
];

// colorMode options: any=at least one, all=includes all, exact=exactly these
const COLOR_MODES = [
  { id: 'any',   label: 'any', title: 'Mindestens eine der Farben' },
  { id: 'all',   label: 'all',  title: 'Alle Farben enthalten'      },
  { id: 'exact', label: 'exact',  title: 'Genau diese Farben'         },
];

export default function CardSearch({
  query,      setQuery,
  searchMode, setSearchMode,
  colors,     setColors,
  colorMode,  setColorMode,
  cardType,   setCardType,
  sortOrder,  setSortOrder,
  sortDir,    setSortDir,
  showLands,  setShowLands,
  rarity,     setRarity,
  cmcMin,     setCmcMin,
  cmcMax,     setCmcMax,
  subtype,    setSubtype,
  format,     setFormat,
  setCode,    setSetCode,
  totalCards, loading,
  deckFormatLabel,
  showFavoritesOnly = false, setShowFavoritesOnly,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const toggleColor = (id) =>
    setColors(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);

  const toggleRarity = (id) =>
    setRarity(prev => prev === id ? '' : id);

  const hasBasicFilters    = query || colors.length > 0 || cardType || showLands;
  const hasAdvancedFilters = rarity || cmcMin || cmcMax || subtype || format || setCode;
  const hasFilters         = hasBasicFilters || hasAdvancedFilters;

  const handleClear = () => {
    setQuery(''); setColors([]); setCardType(''); setShowLands(false);
    setRarity(''); setCmcMin(''); setCmcMax('');
    setSubtype(''); setFormat(''); setSetCode('');
  };

  return (
    <div className="card-search">
      {/* ── Row 1: Text search + mode toggle ── */}
      <div className="search-row">
        <div className="search-input-wrap">
          <span className="search-icon">⚲</span>
          <input
            type="text"
            className="search-input"
            placeholder={searchMode === 'oracle' ? 'Oracle-Text suchen…' : 'Kartennamen suchen…'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            spellCheck={false}
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')} title="Löschen">✕</button>
          )}
        </div>

        <div className="mode-toggle">
          <button
            className={`mode-btn ${searchMode === 'name' ? 'active' : ''}`}
            onClick={() => setSearchMode('name')}
          >Name</button>
          <button
            className={`mode-btn ${searchMode === 'oracle' ? 'active' : ''}`}
            onClick={() => setSearchMode('oracle')}
          >Oracle</button>
        </div>
      </div>

      {/* ── Row 2: Colors + colorMode + Land + Type + Sort + Dir + Reset ── */}
      <div className="filter-row">
        {/* Color pips */}
        <div className="color-group">
          {COLORS.map(({ id, label, title }) => (
            <button
              key={id}
              className={`color-pip pip-${id.toLowerCase()} ${colors.includes(id) ? 'active' : ''}`}
              title={title}
              onClick={() => toggleColor(id)}
            >{label}</button>
          ))}

          {/* Land toggle */}
          <button
            className={`land-pip ${showLands ? 'active' : ''}`}
            title={showLands ? 'Nur Länder anzeigen' : 'Länder ausgeblendet'}
            onClick={() => setShowLands(prev => !prev)}
          >L</button>

          {/* Favorites-only toggle */}
          {setShowFavoritesOnly && (
            <button
              className={`fav-pip ${showFavoritesOnly ? 'active' : ''}`}
              title={showFavoritesOnly ? 'Zeigt nur Favoriten' : 'Nur Favoriten anzeigen'}
              onClick={() => setShowFavoritesOnly(prev => !prev)}
              aria-pressed={showFavoritesOnly}
            >★</button>
          )}
        </div>

        {/* Color mode — only visible when colors are selected */}
        {colors.length > 1 && (
          <div className="color-mode-group">
            {COLOR_MODES.map(({ id, label, title }) => (
              <button
                key={id}
                className={`color-mode-btn ${colorMode === id ? 'active' : ''}`}
                title={title}
                onClick={() => setColorMode(id)}
              >{label}</button>
            ))}
          </div>
        )}

        {/* Type dropdown */}
        <select
          className="type-select"
          value={cardType}
          onChange={e => setCardType(e.target.value)}
        >
          {TYPES.map(t => (
            <option key={t} value={t}>{t || 'Alle Typen'}</option>
          ))}
        </select>

        {/* Sort order + direction */}
        <div className="sort-group">
          <select
            className="sort-select"
            value={sortOrder}
            onChange={e => setSortOrder(e.target.value)}
            title="Sortieren nach"
          >
            {SORT_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button
            className="sort-dir-btn"
            title={sortDir === 'asc' ? 'Aufsteigend' : 'Absteigend'}
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          >
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>

        {hasFilters && (
          <button className="reset-btn" onClick={handleClear} title="Alle Filter zurücksetzen">
            Reset
          </button>
        )}
      </div>

      {/* ── Advanced toggle ── */}
      <button
        className={`advanced-toggle ${showAdvanced ? 'open' : ''} ${hasAdvancedFilters ? 'has-filters' : ''}`}
        onClick={() => setShowAdvanced(v => !v)}
      >
        <span>Erweiterte Filter</span>
        {hasAdvancedFilters && <span className="adv-dot" />}
        <span className="adv-arrow">{showAdvanced ? '▲' : '▼'}</span>
      </button>

      {/* ── Advanced filters ── */}
      {showAdvanced && (
        <div className="advanced-filters">
          <div className="adv-row">
            <span className="adv-label">Rarität</span>
            <div className="rarity-group">
              {RARITIES.map(({ id, label, title }) => (
                <button
                  key={id}
                  className={`rarity-pip ${rarity === id ? 'active' : ''}`}
                  title={title}
                  style={{ '--r-color': RARITY_COLORS[id] }}
                  onClick={() => toggleRarity(id)}
                >{label}</button>
              ))}
            </div>
          </div>

          <div className="adv-row">
            <span className="adv-label">Manakosten</span>
            <div className="cmc-group">
              <input
                type="number"
                className="cmc-input"
                placeholder="Min"
                min={0} max={20}
                value={cmcMin}
                onChange={e => setCmcMin(e.target.value)}
              />
              <span className="cmc-dash">–</span>
              <input
                type="number"
                className="cmc-input"
                placeholder="Max"
                min={0} max={20}
                value={cmcMax}
                onChange={e => setCmcMax(e.target.value)}
              />
            </div>
          </div>

          <div className="adv-row">
            <span className="adv-label">Subtyp</span>
            <input
              type="text"
              className="adv-input"
              placeholder="z.B. Wizard, Dragon, Goblin…"
              value={subtype}
              onChange={e => setSubtype(e.target.value)}
              spellCheck={false}
            />
          </div>

          <div className="adv-row">
            <span className="adv-label">Format</span>
            <select
              className="adv-select"
              value={format}
              onChange={e => setFormat(e.target.value)}
              title="Override für die Suche. Leer = Deck-Format aus dem Header verwenden."
            >
              {FORMATS.map(f => (
                <option key={f} value={f}>
                  {f
                    ? f
                    : deckFormatLabel
                      ? `Deck-Format (${deckFormatLabel})`
                      : 'Alle Formate'}
                </option>
              ))}
            </select>
          </div>

          <div className="adv-row">
            <span className="adv-label">Set-Code</span>
            <input
              type="text"
              className="adv-input adv-input--short"
              placeholder="z.B. khm, dom, mh3…"
              value={setCode}
              onChange={e => setSetCode(e.target.value.toLowerCase().trim())}
              maxLength={6}
              spellCheck={false}
            />
          </div>
        </div>
      )}

      {/* ── Status bar ── */}
      <div className="search-status">
        {loading && (
          <span className="status-loading"><span className="spin">✦</span> Suche läuft…</span>
        )}
        {!loading && totalCards > 0 && (
          <span className="status-count">{totalCards.toLocaleString()} Karten gefunden</span>
        )}
        {!loading && !totalCards && hasFilters && (
          <span className="status-empty">Keine Ergebnisse</span>
        )}
      </div>
    </div>
  );
}
