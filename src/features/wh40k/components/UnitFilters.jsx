// src/features/wh40k/components/UnitFilters.jsx
//
// Filter UI for the unit browser. Mirrors the MTG CardSearch layout:
//   - Top row: text search + reset button
//   - Filter row: faction chips + role chips + favourite/owned toggles
//   - Advanced collapsible: keywords + points range + sort

import { useMemo, useState } from 'react';
import { SearchBar } from '../../../shared/search';
import { FilterChip } from '../../../shared/filters';

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

export default function UnitFilters({
  filters,
  setFilters,
  factions,
  allKeywords,
  totalCount,
  shownCount,
  loading,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const set = (patch) => setFilters(prev => ({ ...prev, ...patch }));

  const toggleFaction = (id) => set({
    factionIds: filters.factionIds.includes(id)
      ? filters.factionIds.filter(x => x !== id)
      : [...filters.factionIds, id],
  });
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
    filters.ownedOnly;

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
  }));

  const sortedKeywords = useMemo(() => allKeywords.slice(), [allKeywords]);

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
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxHeight: 160, overflowY: 'auto' }}>
              {sortedKeywords.map(kw => (
                <FilterChip
                  key={kw}
                  active={filters.keywords.includes(kw)}
                  onClick={() => toggleKeyword(kw)}
                >
                  {kw}
                </FilterChip>
              ))}
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
