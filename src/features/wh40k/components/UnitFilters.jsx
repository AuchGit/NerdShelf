// src/features/wh40k/components/UnitFilters.jsx
//
// Filter UI for the unit browser. Mirrors the MTG CardSearch layout:
//   - Top row: text search + reset button
//   - Filter row: faction chips + role chips + favourite/owned toggles
//   - Advanced collapsible: keywords + points range + sort

import { useMemo, useState } from 'react';
import { SearchBar } from '../../../shared/search';
import { FilterChip } from '../../../shared/filters';
import { getSubfactions, resolveSubfaction } from '../services/subfactions';

const ROLES = [
  { id: 'character',  label: 'Charakter' },
  { id: 'battleline', label: 'Battleline' },
  { id: 'infantry',   label: 'Infanterie' },
  { id: 'vehicle',    label: 'Fahrzeug' },
  { id: 'monster',    label: 'Monster' },
];

const SORT_OPTIONS = [
  { value: 'name',    label: 'Name'    },
  { value: 'points',  label: 'Punkte'  },
  { value: 'role',    label: 'Rolle'   },
  { value: 'faction', label: 'Fraktion'},
];

// A keyword that appears on fewer than this many units is almost always a
// unit-instance name (the dataset stores every unit's own name as a
// keyword, which floods the picker with ~900 single-use tags). Hiding
// these by default turns the keyword filter from "scroll through 1400
// entries" into "pick from ~170 actually-useful army-wide tags".
const COMMON_KEYWORD_MIN = 5;

export default function UnitFilters({
  filters,
  setFilters,
  factions,
  allKeywords,
  keywordCounts,        // global counts across the whole dataset (used as fallback)
  scopedUnits,          // units passing every filter EXCEPT keyword filter —
                        // when provided, chip counts reflect "how many results
                        // does this tag actually give me right now", which is
                        // what the user usually means when they look at the
                        // chip list (e.g. "Daemon" on an Astra Militarum army
                        // should show 0, not the global 149)
  totalCount,
  shownCount,
  loading,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [kwSearch, setKwSearch] = useState('');
  const [showAllKw, setShowAllKw] = useState(false);

  // Per-scope keyword counts. If the caller passes `scopedUnits`, we
  // recompute counts from that subset so empty-result chips disappear
  // and the badge numbers match what the user will actually see if they
  // click the chip. Falls back to the global `keywordCounts` from the
  // data hook when no scope is provided.
  const scopedCounts = useMemo(() => {
    if (!Array.isArray(scopedUnits)) return null;
    const m = Object.create(null);
    for (const u of scopedUnits) {
      for (const k of u.keywords || []) {
        m[k] = (m[k] || 0) + 1;
      }
    }
    return m;
  }, [scopedUnits]);

  const effectiveCounts = scopedCounts || keywordCounts || {};
  const usingScope = !!scopedCounts;

  const set = (patch) => setFilters(prev => ({ ...prev, ...patch }));

  // When the user switches faction we also need to clear the subfaction
  // picker — its peer-keywords list is bound to the old faction and
  // wouldn't make sense for the new one.
  const toggleFaction = (id) => {
    const nextFactionIds = filters.factionIds.includes(id)
      ? filters.factionIds.filter(x => x !== id)
      : [...filters.factionIds, id];
    const patch = { factionIds: nextFactionIds };
    if (filters.subfaction && (
      nextFactionIds.length !== 1 ||
      nextFactionIds[0] !== filters.subfaction.factionId
    )) {
      patch.subfaction = null;
    }
    set(patch);
  };

  // Subfaction picker — visible only when exactly one faction is active
  // and the curated lookup has entries for it. The active subfaction
  // lives in `filters.subfaction` (a structured object), not in the
  // generic keyword filter, because chapter-style picks need an
  // OR-rule that the keyword filter (which is strict AND) can't model.
  const subfactionFactionId = filters.factionIds.length === 1 ? filters.factionIds[0] : null;
  const subfactionOptions = subfactionFactionId ? getSubfactions(subfactionFactionId) : null;
  const activeSubfactionKeyword =
    filters.subfaction && filters.subfaction.factionId === subfactionFactionId
      ? filters.subfaction.keyword
      : null;

  const pickSubfaction = (keyword) => {
    if (!subfactionFactionId) return;
    if (activeSubfactionKeyword === keyword) {
      set({ subfaction: null });
      return;
    }
    const entry = resolveSubfaction(subfactionFactionId, keyword);
    if (!entry) return;
    set({
      subfaction: {
        factionId: subfactionFactionId,
        keyword: entry.keyword,
        mode: entry.mode,
        peerKeywords: entry.peerKeywords,
      },
    });
  };
  const toggleRole = (id) => set({
    roles: filters.roles.includes(id)
      ? filters.roles.filter(x => x !== id)
      : [...filters.roles, id],
  });
  const toggleKeyword = (kw) => set({
    keywords: filters.keywords.includes(kw)
      ? filters.keywords.filter(x => x !== kw)
      : [...filters.keywords, kw],
  });

  const hasFilters =
    filters.query ||
    filters.factionIds.length ||
    filters.roles.length ||
    filters.keywords.length ||
    filters.pointsMin != null ||
    filters.pointsMax != null ||
    filters.favoritesOnly ||
    filters.ownedOnly ||
    filters.subfaction;

  const reset = () => setFilters(prev => ({
    ...prev,
    query: '',
    factionIds: [],
    roles: [],
    keywords: [],
    pointsMin: null,
    pointsMax: null,
    favoritesOnly: false,
    ownedOnly: false,
    subfaction: null,
  }));

  // Sort by usage frequency desc, then alphabetically. Active keywords are
  // pinned to the top so users can always see / un-toggle their current
  // selection regardless of search/common-filter state. Chips with a
  // zero in-scope count are hidden unless they're the currently-selected
  // tag (the user needs to be able to un-pick what they picked).
  const filteredKeywords = useMemo(() => {
    const q = kwSearch.trim().toLowerCase();
    const activeSet = new Set(filters.keywords);

    const base = allKeywords.filter(kw => {
      if (activeSet.has(kw)) return true;             // always keep active
      const count = effectiveCounts[kw] || 0;
      if (usingScope && count === 0) return false;    // empty-result tag
      if (!showAllKw && count < COMMON_KEYWORD_MIN) return false;
      if (q && !kw.toLowerCase().includes(q)) return false;
      return true;
    });

    base.sort((a, b) => {
      const aActive = activeSet.has(a), bActive = activeSet.has(b);
      if (aActive !== bActive) return aActive ? -1 : 1;
      const ca = effectiveCounts[a] || 0, cb = effectiveCounts[b] || 0;
      if (ca !== cb) return cb - ca;
      return a.localeCompare(b);
    });
    return base;
  }, [allKeywords, effectiveCounts, usingScope, kwSearch, showAllKw, filters.keywords]);

  const hiddenKwCount = useMemo(() => {
    if (showAllKw) return 0;
    let n = 0;
    for (const kw of allKeywords) {
      const count = effectiveCounts[kw] || 0;
      if (usingScope && count === 0) continue;        // not a "hidden rare", just out of scope
      if (count < COMMON_KEYWORD_MIN) n++;
    }
    return n;
  }, [allKeywords, effectiveCounts, usingScope, showAllKw]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      {/* Row 1: search + status + reset */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <SearchBar
          value={filters.query}
          onChange={(v) => set({ query: v })}
          placeholder="Einheiten suchen…"
        />
        <FilterChip
          active={filters.favoritesOnly}
          onClick={() => set({ favoritesOnly: !filters.favoritesOnly })}
          title="Nur Favoriten anzeigen"
        >
          ★ Favoriten
        </FilterChip>
        <FilterChip
          active={filters.ownedOnly}
          onClick={() => set({ ownedOnly: !filters.ownedOnly })}
          title="Nur eigene Einheiten anzeigen"
        >
          ◉ Sammlung
        </FilterChip>
        {hasFilters && (
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '6px 10px',
              minHeight: 28,
              background: 'transparent',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-sm)',
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Row 2: factions */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {factions.map(f => (
          <FilterChip
            key={f.id}
            active={filters.factionIds.includes(f.id)}
            onClick={() => toggleFaction(f.id)}
            title={f.name}
            style={
              filters.factionIds.includes(f.id) && f.color
                ? { background: f.color, borderColor: f.color }
                : undefined
            }
          >
            <span style={{ marginRight: 4 }}>{f.icon}</span>
            {f.shortName}
          </FilterChip>
        ))}
      </div>

      {/* Row 2b: subfaction quick picker — only when one faction is
          active AND the curated lookup knows that faction. Auswahl
          schreibt einen Subfaction-Keyword in den keyword-Filter; das
          existierende Keyword-Filterpanel sieht das genauso wie eine
          Hand-Auswahl. */}
      {subfactionOptions && subfactionOptions.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 'var(--fs-xs)',
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            color: 'var(--color-text-muted)',
            fontWeight: 'var(--fw-semibold)',
            marginRight: 2,
          }}>
            Subfaction
          </span>
          <FilterChip
            active={activeSubfactionKeyword == null}
            onClick={() => activeSubfactionKeyword && pickSubfaction(activeSubfactionKeyword)}
            title="Alle Subfactions zeigen"
          >
            Alle
          </FilterChip>
          {subfactionOptions.map(opt => {
            const mode = opt.mode || 'category';
            const hint = mode === 'chapter'
              ? `${opt.label}-Armee: ${opt.keyword}-spezifische Datasheets + alle chapter-agnostischen`
              : `${opt.label}: nur Einheiten mit Keyword „${opt.keyword}"`;
            return (
              <FilterChip
                key={opt.id}
                active={activeSubfactionKeyword === opt.keyword}
                onClick={() => pickSubfaction(opt.keyword)}
                title={hint}
              >
                {opt.label}
              </FilterChip>
            );
          })}
        </div>
      )}

      {/* Row 3: roles + sort */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {ROLES.map(r => (
          <FilterChip
            key={r.id}
            active={filters.roles.includes(r.id)}
            onClick={() => toggleRole(r.id)}
          >
            {r.label}
          </FilterChip>
        ))}
        <div style={{ flex: 1 }} />
        <select
          value={filters.sortKey}
          onChange={(e) => set({ sortKey: e.target.value })}
          style={selectStyle}
          title="Sortieren nach"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => set({ sortDir: filters.sortDir === 'asc' ? 'desc' : 'asc' })}
          style={{
            ...selectStyle,
            width: 36,
            cursor: 'pointer',
            padding: '6px 0',
          }}
          title={filters.sortDir === 'asc' ? 'Aufsteigend' : 'Absteigend'}
        >
          {filters.sortDir === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      {/* Advanced */}
      <button
        type="button"
        onClick={() => setShowAdvanced(v => !v)}
        style={{
          alignSelf: 'flex-start',
          background: 'transparent',
          border: 'none',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--fs-sm)',
          cursor: 'pointer',
          padding: '4px 0',
        }}
      >
        {showAdvanced ? '▲' : '▼'} Erweiterte Filter{filters.keywords.length > 0 ? ` (${filters.keywords.length})` : ''}
      </button>

      {showAdvanced && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div>
            <div style={advLabelStyle}>Punkte</div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input
                type="number"
                value={filters.pointsMin ?? ''}
                onChange={(e) => set({ pointsMin: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="Min"
                style={numInputStyle}
                min={0}
              />
              <span style={{ color: 'var(--color-text-muted)' }}>–</span>
              <input
                type="number"
                value={filters.pointsMax ?? ''}
                onChange={(e) => set({ pointsMax: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="Max"
                style={numInputStyle}
                min={0}
              />
            </div>
          </div>

          <div>
            <div style={advLabelStyle}>Schlüsselwörter</div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              <input
                type="search"
                value={kwSearch}
                onChange={(e) => setKwSearch(e.target.value)}
                placeholder="Schlüsselwort suchen…"
                style={{
                  flex: 1,
                  minWidth: 160,
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '6px 8px',
                  fontSize: 'var(--fs-sm)',
                  fontFamily: 'inherit',
                  minHeight: 28,
                }}
              />
              <FilterChip
                active={showAllKw}
                onClick={() => setShowAllKw(v => !v)}
                title={showAllKw
                  ? 'Aktuell werden alle Tags gezeigt (inkl. Einheiten-Eigennamen)'
                  : `${hiddenKwCount} seltene Tags (Eigennamen, <${COMMON_KEYWORD_MIN}× genutzt) ausgeblendet`}
              >
                {showAllKw ? `Alle (${allKeywords.length})` : `Häufige (${allKeywords.length - hiddenKwCount})`}
              </FilterChip>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxHeight: 200, overflowY: 'auto' }}>
              {filteredKeywords.length === 0 ? (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-xs)', padding: '4px 2px' }}>
                  Keine passenden Tags{kwSearch ? ` für „${kwSearch}“` : ''}.
                </div>
              ) : filteredKeywords.map(kw => {
                const count = effectiveCounts[kw];
                return (
                  <FilterChip
                    key={kw}
                    active={filters.keywords.includes(kw)}
                    onClick={() => toggleKeyword(kw)}
                    title={count != null
                      ? `${kw} — ${count} Einheit${count === 1 ? '' : 'en'}${usingScope ? ' im aktuellen Filter' : ''}`
                      : kw}
                  >
                    {kw}
                    {count != null && (
                      <span style={{ marginLeft: 4, opacity: 0.55, fontSize: '0.85em' }}>
                        {count}
                      </span>
                    )}
                  </FilterChip>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--color-text-muted)',
          paddingTop: 'var(--space-1)',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        {loading
          ? 'Lade Einheiten…'
          : `${shownCount} von ${totalCount} Einheiten`}
      </div>
    </div>
  );
}

const selectStyle = {
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '6px 8px',
  fontSize: 'var(--fs-sm)',
  minHeight: 28,
};

const advLabelStyle = {
  fontSize: 'var(--fs-xs)',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: 'var(--color-text-muted)',
  marginBottom: 'var(--space-1)',
  fontWeight: 'var(--fw-semibold)',
};

const numInputStyle = {
  width: 90,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '6px 8px',
  fontSize: 'var(--fs-sm)',
  minHeight: 28,
};
