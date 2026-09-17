import { useState } from 'react';
import { searchTags } from '../services/scryfallTags';
import './CardSearch.css';
import usePwaMobile from '../../../../shared/hooks/usePwaMobile';

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
  { value: 'eur',      label: 'Preis'   },
];

// colorMode options: any=at least one, all=includes all, exact=exactly these
const COLOR_MODES = [
  { id: 'any',   label: 'any', title: 'Mindestens eine der Farben' },
  { id: 'all',   label: 'all',  title: 'Alle Farben enthalten'      },
  { id: 'exact', label: 'exact',  title: 'Genau diese Farben'         },
];

const COLLAPSE_KEY = 'mtg:search-collapsed';

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
  priceMin,   setPriceMin,
  priceMax,   setPriceMax,
  totalCards, loading,
  deckFormatLabel,
  showFavoritesOnly = false, setShowFavoritesOnly,
  showOwnedOnly = false, setShowOwnedOnly,
  // Scryfall oracle tags: selected [{ slug, label }] + the shared tag index
  // ({ status, index, error, load } from useOracleTags). Optional.
  tags = [], setTags, tagIndex,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  // On a phone the filter rows eat the screen the cards need. Collapsing
  // keeps what you actually reach for — the search field and the colour /
  // land / favourite / collection pills — and folds the rest away. Per
  // device, like the other display preferences.
  const { isPwaMobile } = usePwaMobile();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const compact = isPwaMobile && collapsed;
  const toggleCollapsed = () => setCollapsed(prev => {
    const next = !prev;
    try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

  const toggleColor = (id) =>
    setColors(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);

  const toggleRarity = (id) =>
    setRarity(prev => prev === id ? '' : id);

  const hasBasicFilters    = query || colors.length > 0 || cardType || showLands || tags.length > 0;
  const hasAdvancedFilters = rarity || cmcMin || cmcMax || subtype || format || setCode || priceMin || priceMax;
  const hasFilters         = hasBasicFilters || hasAdvancedFilters;

  const handleClear = () => {
    setQuery(''); setColors([]); setCardType(''); setShowLands(false);
    setRarity(''); setCmcMin(''); setCmcMax('');
    setSubtype(''); setFormat(''); setSetCode('');
    setPriceMin?.(''); setPriceMax?.('');
    setTags?.([]);
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

        {!compact && <div className="mode-toggle">
          <button
            className={`mode-btn ${searchMode === 'name' ? 'active' : ''}`}
            onClick={() => setSearchMode('name')}
          >Name</button>
          <button
            className={`mode-btn ${searchMode === 'oracle' ? 'active' : ''}`}
            onClick={() => setSearchMode('oracle')}
          >Oracle</button>
        </div>}
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

          {/* Inventory (owned-only) toggle — pairs with the green badge on
              cards. Filters the current result set client-side; combinable
              with the favorites toggle. */}
          {setShowOwnedOnly && (
            <button
              className={`inv-pip ${showOwnedOnly ? 'active' : ''}`}
              title={showOwnedOnly ? 'Zeigt nur Karten aus deiner Sammlung' : 'Nur Sammlung anzeigen'}
              onClick={() => setShowOwnedOnly(prev => !prev)}
              aria-pressed={showOwnedOnly}
            >◉</button>
          )}
        </div>

        {/* Color mode — only visible when colors are selected */}
        {!compact && colors.length > 1 && (
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
        {!compact && <select
          className="type-select"
          value={cardType}
          onChange={e => setCardType(e.target.value)}
        >
          {TYPES.map(t => (
            <option key={t} value={t}>{t || 'Alle Typen'}</option>
          ))}
        </select>}

        {/* Sort order + direction */}
        {!compact && <div className="sort-group">
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
        </div>}

        {hasFilters && (
          <button className="reset-btn" onClick={handleClear} title="Alle Filter zurücksetzen">
            Reset
          </button>
        )}

        {isPwaMobile && (
          <button
            type="button"
            className="filter-collapse"
            onClick={toggleCollapsed}
            aria-expanded={!compact}
            title={compact ? 'Filter und Sortierung zeigen' : 'Filter und Sortierung ausblenden'}
          >
            Filter <span className="adv-arrow">{compact ? '▼' : '▲'}</span>
          </button>
        )}
      </div>

      {/* ── Row 3: Scryfall oracle tags ── */}
      {!compact && setTags && (
        <TagFilter tags={tags} setTags={setTags} tagIndex={tagIndex} />
      )}

      {/* ── Advanced toggle ── */}
      {!compact && <button
        className={`advanced-toggle ${showAdvanced ? 'open' : ''} ${hasAdvancedFilters ? 'has-filters' : ''}`}
        onClick={() => setShowAdvanced(v => !v)}
      >
        <span>Erweiterte Filter</span>
        {hasAdvancedFilters && <span className="adv-dot" />}
        <span className="adv-arrow">{showAdvanced ? '▲' : '▼'}</span>
      </button>}

      {/* ── Advanced filters ── */}
      {!compact && showAdvanced && (
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
            <span className="adv-label">Preis (€)</span>
            <div className="cmc-group">
              <input
                type="number"
                className="cmc-input"
                placeholder="Min"
                min={0} step={0.01}
                value={priceMin ?? ''}
                onChange={e => setPriceMin?.(e.target.value)}
              />
              <span className="cmc-dash">–</span>
              <input
                type="number"
                className="cmc-input"
                placeholder="Max"
                min={0} step={0.01}
                value={priceMax ?? ''}
                onChange={e => setPriceMax?.(e.target.value)}
              />
            </div>
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

/**
 * Tag filter row: selected tags as removable chips plus an input with
 * autocomplete over the Scryfall Tagger tags. The tag data loads on first
 * focus (or earlier, when the preview asked for it).
 */
function TagFilter({ tags, setTags, tagIndex }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const status = tagIndex?.status;
  const index = tagIndex?.index;
  const suggestions = open && index
    ? searchTags(index, text, { limit: 8, exclude: tags.map(t => t.slug) })
    : [];

  const add = (t) => {
    setTags(prev => (prev.some(x => x.slug === t.slug) ? prev : [...prev, { slug: t.slug, label: t.label }]));
    setText('');
    setActive(0);
  };
  const remove = (slug) => setTags(prev => prev.filter(t => t.slug !== slug));

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => Math.min(a + 1, Math.max(suggestions.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && suggestions[active]) {
      e.preventDefault();
      add(suggestions[active]);
    } else if (e.key === 'Backspace' && !text && tags.length > 0) {
      remove(tags[tags.length - 1].slug);
    } else if (e.key === 'Escape') {
      setOpen(false);
      e.currentTarget.blur();
    }
  };

  let dropdown = null;
  if (open && !index && status === 'loading') {
    dropdown = <div className="tag-suggest-note">Tags werden geladen…</div>;
  } else if (open && !index && status === 'error') {
    dropdown = <div className="tag-suggest-note">Tags nicht verfügbar: {tagIndex.error}</div>;
  } else if (suggestions.length > 0) {
    dropdown = suggestions.map((t, i) => (
      <button
        key={t.slug}
        type="button"
        role="option"
        aria-selected={i === active}
        className={`tag-suggest-item ${i === active ? 'is-active' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => setActive(i)}
        onClick={() => add(t)}
        title={t.description || undefined}
      >
        <span className="tag-suggest-label">{t.label}</span>
        <span className="tag-suggest-count">{t.count.toLocaleString()}</span>
      </button>
    ));
  } else if (open && index && text.trim()) {
    dropdown = <div className="tag-suggest-note">Kein Tag gefunden.</div>;
  }

  return (
    <div className="tag-row">
      <span className="tag-row-label" title="Tags aus dem Scryfall Tagger — was eine Karte tut, z. B. ramp oder removal">
        Tags
      </span>
      {tags.map(t => (
        <button
          key={t.slug}
          type="button"
          className="tag-chip"
          onClick={() => remove(t.slug)}
          title="Tag-Filter entfernen"
        >
          {t.label}<span className="tag-chip-x" aria-hidden="true">✕</span>
        </button>
      ))}
      <div className="tag-input-wrap">
        <input
          type="text"
          className="tag-input"
          value={text}
          placeholder={tags.length ? '+ Tag' : 'Tag suchen, z. B. ramp, removal…'}
          onChange={(e) => { setText(e.target.value); setActive(0); setOpen(true); }}
          onFocus={() => { setOpen(true); if (status === 'idle' || status === 'error') tagIndex?.load?.(); }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={!!dropdown}
        />
        {dropdown && <div className="tag-suggest" role="listbox">{dropdown}</div>}
      </div>
    </div>
  );
}
