// src/features/wh40k/pages/InventoryPage.jsx
//
// Collection / inventory view. Shows units the user owns (quantity > 0),
// grouped by faction with totals. Lets the user adjust quantities directly.

import { useMemo, useState } from 'react';
import { useWh40kData } from '../hooks/useWh40kData';
import { useWh40kFavorites } from '../hooks/useWh40kFavorites';
import { useWh40kInventory } from '../hooks/useWh40kInventory';
import { useWh40kSquads } from '../hooks/useWh40kSquads';
import UnitCard from '../components/UnitCard';
import SquadListPanel from '../components/SquadListPanel';
import SquadBuilderModal from '../components/SquadBuilderModal';
import { Button } from '../../../shared/ui';
import { SearchBar } from '../../../shared/search';
import { totalArmyPoints } from '../services/points';

export default function InventoryPage() {
  const { data, loading, error } = useWh40kData();
  const favs = useWh40kFavorites();
  const inv = useWh40kInventory();
  const squads = useWh40kSquads();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('units');             // 'units' | 'squads'
  const [squadModal, setSquadModal] = useState(null);  // null | {} | {edit: squad} | {lockedUnitId, factionFilter}

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
          <span>·</span>
          <span><strong style={{ color: 'var(--color-text)' }}>{squads.squads.length}</strong> Squads</span>
        </div>
        {tab === 'units' && (
          <div style={{ flex: 1, minWidth: 200 }}>
            <SearchBar value={query} onChange={setQuery} placeholder="Sammlung durchsuchen…" />
          </div>
        )}
      </div>

      <div
        data-pwa-target="inventory-tabs"
        role="tablist"
        style={{
          display: 'flex',
          gap: 4,
          padding: 4,
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          alignSelf: 'flex-start',
        }}
      >
        <TabBtn active={tab === 'units'} onClick={() => setTab('units')}>Einheiten</TabBtn>
        <TabBtn active={tab === 'squads'} onClick={() => setTab('squads')}>
          Squads {squads.squads.length > 0 && <span style={{ opacity: 0.7 }}>({squads.squads.length})</span>}
        </TabBtn>
      </div>

      {tab === 'squads' ? (
        <SquadListPanel
          squads={squads.squads}
          loading={squads.loading}
          tableMissing={squads.tableMissing}
          unitsById={data?.unitsById || {}}
          factionsById={data?.factionsById || {}}
          onEdit={(s) => setSquadModal({ edit: s })}
          onDuplicate={(s) => squads.duplicate(s.id)}
          onDelete={(s) => squads.remove(s.id)}
          onCreateNew={() => setSquadModal({})}
          emptyHint={'Lege Squads direkt im Einheiten-Tab über die Karte einer Einheit an, oder benutze „+ Neuer Squad".'}
        />
      ) : grouped.length === 0 ? (
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
                flexWrap: 'wrap',
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
              <span style={{ flex: 1 }} />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSquadModal({ factionFilter: g.faction?.id })}
              >
                + Squad aus {g.faction?.shortName || g.faction?.name || 'Fraktion'}
              </Button>
            </header>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 'var(--space-3)',
              }}
            >
              {g.units.map(u => (
                <div key={u.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <UnitCard
                    unit={u}
                    faction={g.faction}
                    isFavorite={favs.isFavorite(u.id)}
                    onToggleFavorite={favs.toggleFavorite}
                    ownedQty={inv.getQuantity(u.id)}
                    onIncOwned={(unit) => inv.adjustQuantity(unit.id, +1, unit.name)}
                    onDecOwned={(unit) => inv.adjustQuantity(unit.id, -1, unit.name)}
                  />
                  <button
                    type="button"
                    onClick={() => setSquadModal({ lockedUnitId: u.id, factionFilter: g.faction?.id })}
                    style={{
                      padding: '4px 8px',
                      fontSize: 'var(--fs-xs)',
                      background: 'transparent',
                      color: 'var(--color-text-muted)',
                      border: '1px dashed var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--color-accent)';
                      e.currentTarget.style.borderColor = 'var(--color-accent)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--color-text-muted)';
                      e.currentTarget.style.borderColor = 'var(--color-border)';
                    }}
                  >
                    ⛬ Squad aus dieser Einheit
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      <SquadBuilderModal
        open={!!squadModal}
        onClose={() => setSquadModal(null)}
        data={data}
        canonicalWargear={data?.canonical?.wargearOptions || []}
        initial={squadModal?.edit}
        lockedFirstUnitId={squadModal?.lockedUnitId}
        factionFilter={squadModal?.factionFilter}
        onSave={async (s) => {
          if (s.id) await squads.update(s.id, s);
          else await squads.create(s);
        }}
      />
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      style={{
        padding: '6px 14px',
        background: active ? 'var(--color-accent)' : 'transparent',
        color: active ? 'var(--color-accent-contrast)' : 'var(--color-text)',
        border: 'none',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--fs-sm)',
        fontWeight: active ? 'var(--fw-semibold)' : 'var(--fw-medium)',
        fontFamily: 'inherit',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {children}
    </button>
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
