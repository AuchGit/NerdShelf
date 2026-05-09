// src/features/wh40k/components/UnitGrid.jsx
//
// Responsive grid + lightweight pagination ("show more") for the unit
// browser. The seed dataset is small enough that virtualization isn't
// strictly required, so we use simple chunked rendering — fast on
// mid-range hardware up to a few thousand units.
//
// TODO(perf): if the imported dataset grows past ~2k units, swap the
// chunked render for a windowed list (e.g. react-virtual / @tanstack/virtual).

import { useEffect, useRef, useState } from 'react';
import UnitCard from './UnitCard';

const PAGE = 60;

export default function UnitGrid({
  units,
  factionsById,
  selectedId,
  onSelect,
  isFavorite,
  onToggleFavorite,
  getOwned,
  onIncOwned,
  onDecOwned,
  onAdd,
  inArmyCount,
  emptyMessage = 'Keine Einheiten gefunden.',
}) {
  const [shown, setShown] = useState(PAGE);
  const sentinelRef = useRef(null);

  // Reset visible window whenever the underlying list changes (filters apply,
  // faction switch, …). Without this, paging through to row 600 then changing
  // faction would leave you scrolled inside an empty list.
  useEffect(() => { setShown(PAGE); }, [units]);

  // IntersectionObserver-driven auto-loadmore — UX matches MTG's infinite list
  useEffect(() => {
    if (!sentinelRef.current) return;
    const el = sentinelRef.current;
    const obs = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setShown(s => Math.min(s + PAGE, units.length));
        }
      }
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [units.length]);

  if (units.length === 0) {
    return (
      <div
        style={{
          padding: 'var(--space-6)',
          textAlign: 'center',
          color: 'var(--color-text-muted)',
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 'var(--space-2)' }}>✺</div>
        {emptyMessage}
      </div>
    );
  }

  const visible = units.slice(0, shown);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 'var(--space-3)',
        }}
      >
        {visible.map(u => (
          <UnitCard
            key={u.id}
            unit={u}
            faction={factionsById[u.factionId]}
            selected={selectedId === u.id}
            onSelect={onSelect}
            isFavorite={isFavorite?.(u.id)}
            onToggleFavorite={onToggleFavorite}
            ownedQty={getOwned?.(u.id) || 0}
            onIncOwned={onIncOwned}
            onDecOwned={onDecOwned}
            onAdd={onAdd}
            inArmyCount={inArmyCount?.(u.id) || 0}
          />
        ))}
      </div>
      {shown < units.length && (
        <div
          ref={sentinelRef}
          style={{
            padding: 'var(--space-3)',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          Lade mehr… ({shown}/{units.length})
        </div>
      )}
    </div>
  );
}
