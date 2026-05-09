// src/features/wh40k/pages/UnitBrowserPage.jsx
//
// Standalone unit browser. Same filtering / grid / detail layout as the
// army builder, minus the army roster. Useful for shopping & reference.

import { useMemo, useState } from 'react';
import { useWh40kData } from '../hooks/useWh40kData';
import { useWh40kFavorites } from '../hooks/useWh40kFavorites';
import { useWh40kInventory } from '../hooks/useWh40kInventory';
import { emptyFilters, filterAndSortUnits } from '../services/filterUnits';
import UnitFilters from '../components/UnitFilters';
import UnitGrid from '../components/UnitGrid';
import UnitDetail from '../components/UnitDetail';

export default function UnitBrowserPage() {
  const { data, loading, error } = useWh40kData();
  const favs = useWh40kFavorites();
  const inv = useWh40kInventory();
  const [filters, setFilters] = useState(() => emptyFilters());
  const [selectedId, setSelectedId] = useState(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    return filterAndSortUnits(data.units, filters, {
      isFavorite: favs.isFavorite,
      isOwned: inv.isOwned,
    });
  }, [data, filters, favs.isFavorite, inv.isOwned]);

  const selectedUnit = data && selectedId ? data.unitsById[selectedId] : null;
  const selectedFaction = selectedUnit ? data?.factionsById[selectedUnit.factionId] : null;

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>
        Lade Einheiten…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-danger)' }}>
        Fehler beim Laden der 40K-Daten: {error}
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 'var(--space-5)',
        maxWidth: 1400,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 'var(--fs-2xl)', fontWeight: 'var(--fw-semibold)' }}>
        Einheiten
      </h1>
      <UnitFilters
        filters={filters}
        setFilters={setFilters}
        factions={data.factions}
        allKeywords={data.allKeywords}
        totalCount={data.units.length}
        shownCount={filtered.length}
        loading={loading}
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: selectedUnit ? 'minmax(0, 1fr) minmax(280px, 380px)' : '1fr',
          gap: 'var(--space-4)',
          alignItems: 'start',
        }}
      >
        <UnitGrid
          units={filtered}
          factionsById={data.factionsById}
          selectedId={selectedId}
          onSelect={(u) => setSelectedId(prev => prev === u.id ? null : u.id)}
          isFavorite={favs.isFavorite}
          onToggleFavorite={favs.toggleFavorite}
          getOwned={inv.getQuantity}
          onIncOwned={(u) => inv.adjustQuantity(u.id, +1, u.name)}
          onDecOwned={(u) => inv.adjustQuantity(u.id, -1, u.name)}
        />
        {selectedUnit && (
          <UnitDetail unit={selectedUnit} faction={selectedFaction} />
        )}
      </div>
    </div>
  );
}
