// src/features/wh40k/pages/InventoryPage.jsx
//
// Collection / inventory view. Shows units the user owns (quantity > 0),
// grouped by faction with totals. Lets the user adjust quantities directly.

import { useMemo, useState } from 'react';
import { useWh40kData } from '../hooks/useWh40kData';
import { useWh40kFavorites } from '../hooks/useWh40kFavorites';
import { useWh40kInventory } from '../hooks/useWh40kInventory';
import UnitCard from '../components/UnitCard';
import { SearchBar } from '../../../shared/search';
import { totalArmyPoints } from '../services/points';

export default function InventoryPage() {
  const { data, loading, error } = useWh40kData();
  const favs = useWh40kFavorites();
  const inv = useWh40kInventory();
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    if (!data) return [];
    const ownedIds = [...inv.quantities.keys()];
    const q = query.trim().toLowerCase();
    const owned = ownedIds
      .map(id => data.unitsById[id])
      .filter(Boolean)
      .filter(u => !q || u.name.toLowerCase().includes(q));

    const byFaction = new Map();
    for (const u of owned) {
      if (!byFaction.has(u.factionId)) byFaction.set(u.factionId, []);
      byFaction.get(u.factionId).push(u);
    }
    return [...byFaction.entries()].map(([fid, units]) => ({
      faction: data.factionsById[fid],
      units: units.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [data, inv.quantities, query]);

  const totalUnitsOwned = useMemo(() => {
    let total = 0;
    for (const v of inv.quantities.values()) total += v;
    return total;
  }, [inv.quantities]);

  // Treat inventory like an "all-owned army" for quick portfolio value.
  const totalValuePts = useMemo(() => {
    if (!data) return 0;
    const entries = {};
    for (const [id, qty] of inv.quantities) entries[id] = { unitId: id, count: qty };
    return totalArmyPoints(entries, data.unitsById);
  }, [data, inv.quantities]);

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
      <div data-pwa-target="page-toolbar" style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--fs-2xl)', fontWeight: 'var(--fw-semibold)' }}>
          Sammlung
        </h1>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
          <span><strong style={{ color: 'var(--color-text)' }}>{totalUnitsOwned}</strong> Modelle/Einheiten</span>
          <span>·</span>
          <span><strong style={{ color: 'var(--color-text)' }}>{totalValuePts}</strong> Pkt</span>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <SearchBar value={query} onChange={setQuery} placeholder="Sammlung durchsuchen…" />
        </div>
      </div>

      {grouped.length === 0 ? (
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
          <div style={{ fontSize: 40, marginBottom: 'var(--space-3)' }}>◧</div>
          <div style={{ fontSize: 'var(--fs-lg)' }}>Sammlung ist leer</div>
          <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--fs-sm)' }}>
            Setze im Einheiten-Browser die Anzahl deiner Modelle, um sie hier zu sehen.
          </div>
        </div>
      ) : (
        grouped.map(g => (
          <section key={g.faction?.id || 'unknown'} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <header
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 'var(--space-2)',
                paddingBottom: 'var(--space-2)',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)' }}>
                {g.faction?.name || 'Unbekannt'}
              </span>
              <span
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-muted)',
                  padding: '2px 10px',
                  borderRadius: 999,
                  fontSize: 'var(--fs-xs)',
                  fontWeight: 'var(--fw-medium)',
                }}
              >
                {g.units.length}
              </span>
            </header>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 'var(--space-3)',
              }}
            >
              {g.units.map(u => (
                <UnitCard
                  key={u.id}
                  unit={u}
                  faction={g.faction}
                  isFavorite={favs.isFavorite(u.id)}
                  onToggleFavorite={favs.toggleFavorite}
                  ownedQty={inv.getQuantity(u.id)}
                  onIncOwned={(unit) => inv.adjustQuantity(unit.id, +1, unit.name)}
                  onDecOwned={(unit) => inv.adjustQuantity(unit.id, -1, unit.name)}
                />
              ))}
            </div>
          </section>
        ))
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
