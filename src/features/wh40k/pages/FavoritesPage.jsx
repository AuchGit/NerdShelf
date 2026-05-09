// src/features/wh40k/pages/FavoritesPage.jsx
//
// Quick-access view of every unit the user has starred. Same UnitCard /
// UnitDetail components as the browser; only the source list differs.

import { useMemo, useState } from 'react';
import { useWh40kData } from '../hooks/useWh40kData';
import { useWh40kFavorites } from '../hooks/useWh40kFavorites';
import { useWh40kInventory } from '../hooks/useWh40kInventory';
import UnitGrid from '../components/UnitGrid';
import UnitDetail from '../components/UnitDetail';
import { SearchBar } from '../../../shared/search';

export default function FavoritesPage() {
  const { data, loading, error } = useWh40kData();
  const favs = useWh40kFavorites();
  const inv = useWh40kInventory();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const favoriteUnits = useMemo(() => {
    if (!data) return [];
    const list = data.units.filter(u => favs.ids.has(u.id));
    const q = query.trim().toLowerCase();
    return q
      ? list.filter(u => u.name.toLowerCase().includes(q))
      : list;
  }, [data, favs.ids, query]);

  const selectedUnit = data && selectedId ? data.unitsById[selectedId] : null;
  const selectedFaction = selectedUnit ? data?.factionsById[selectedUnit.factionId] : null;

  if (loading) return <PageMessage>Lade…</PageMessage>;
  if (error) return <PageMessage error>{error}</PageMessage>;

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
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--fs-2xl)', fontWeight: 'var(--fw-semibold)' }}>
          Favoriten
        </h1>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
          {favoriteUnits.length} markiert
        </span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <SearchBar value={query} onChange={setQuery} placeholder="Favoriten durchsuchen…" />
        </div>
      </div>
      {favoriteUnits.length === 0 ? (
        <div
          style={{
            padding: 'var(--space-7)',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 'var(--space-3)' }}>☆</div>
          <div style={{ fontSize: 'var(--fs-lg)' }}>Noch keine Favoriten</div>
          <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--fs-sm)' }}>
            Markiere Einheiten im Einheiten-Browser mit dem Stern-Symbol.
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: selectedUnit ? 'minmax(0, 1fr) minmax(280px, 380px)' : '1fr',
            gap: 'var(--space-4)',
            alignItems: 'start',
          }}
        >
          <UnitGrid
            units={favoriteUnits}
            factionsById={data.factionsById}
            selectedId={selectedId}
            onSelect={(u) => setSelectedId(prev => prev === u.id ? null : u.id)}
            isFavorite={favs.isFavorite}
            onToggleFavorite={favs.toggleFavorite}
            getOwned={inv.getQuantity}
            onIncOwned={(u) => inv.adjustQuantity(u.id, +1, u.name)}
            onDecOwned={(u) => inv.adjustQuantity(u.id, -1, u.name)}
          />
          {selectedUnit && <UnitDetail unit={selectedUnit} faction={selectedFaction} />}
        </div>
      )}
    </div>
  );
}

function PageMessage({ children, error = false }) {
  return (
    <div
      style={{
        padding: 60,
        textAlign: 'center',
        color: error ? 'var(--color-danger)' : 'var(--color-text-muted)',
      }}
    >
      {children}
    </div>
  );
}
