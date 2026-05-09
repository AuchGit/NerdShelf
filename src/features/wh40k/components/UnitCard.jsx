// src/features/wh40k/components/UnitCard.jsx
//
// Compact unit summary card used in the unit browser grid and in favorites
// /inventory listings. Matches the spacing/border/hover language of MTG's
// CardItem so the two views feel like one app.

const ROLE_BADGE_COLORS = {
  character:  '#c8a74a',
  battleline: '#7aa2f7',
  infantry:   '#9ece6a',
  vehicle:    '#e0af68',
  monster:    '#f7768e',
};

function RoleBadge({ role }) {
  if (!role) return null;
  const color = ROLE_BADGE_COLORS[role] || 'var(--color-text-muted)';
  return (
    <span
      title={role}
      style={{
        display: 'inline-block',
        padding: '2px 6px',
        fontSize: 'var(--fs-xs)',
        fontWeight: 'var(--fw-semibold)',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        background: 'color-mix(in srgb, currentColor 14%, transparent)',
        color,
        border: `1px solid color-mix(in srgb, currentColor 35%, transparent)`,
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {role}
    </span>
  );
}

export default function UnitCard({
  unit,
  faction,
  isFavorite = false,
  onToggleFavorite,
  ownedQty = 0,
  onIncOwned,
  onDecOwned,
  onAdd,
  onSelect,
  selected = false,
  inArmyCount = 0,
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(unit)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(unit); }
      }}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: 'var(--space-3)',
        background: 'var(--color-bg-elevated)',
        border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-lg)',
        cursor: 'pointer',
        transition: 'border-color var(--transition), background var(--transition)',
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.borderColor = 'var(--color-accent)';
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.borderColor = 'var(--color-border)';
      }}
    >
      {/* faction stripe */}
      {faction && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0,
            height: 3,
            background: faction.color || 'var(--color-accent)',
            borderTopLeftRadius: 'var(--radius-lg)',
            borderTopRightRadius: 'var(--radius-lg)',
          }}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', minHeight: 28 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 'var(--fs-md)',
              fontWeight: 'var(--fw-semibold)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: 2,
            }}
          >
            {unit.name}
          </div>
          <div
            style={{
              fontSize: 'var(--fs-xs)',
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {faction?.shortName || faction?.name || ''}
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(unit); }}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
          title={isFavorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
          style={{
            background: 'transparent',
            border: 'none',
            color: isFavorite ? 'var(--color-warning)' : 'var(--color-text-dim)',
            cursor: 'pointer',
            fontSize: 'var(--fs-lg)',
            lineHeight: 1,
            padding: 2,
          }}
        >
          {isFavorite ? '★' : '☆'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <RoleBadge role={unit.role} />
        <span
          style={{
            fontSize: 'var(--fs-sm)',
            color: 'var(--color-text)',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 'var(--fw-semibold)',
          }}
        >
          {unit.points} Pkt
        </span>
        {unit.modelCounts?.length > 0 && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
            {unit.modelCounts.join('/')}× Modelle
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '2px 4px',
            background: 'var(--color-surface)',
          }}
          title="Eigene Modelle"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => onDecOwned?.(unit)}
            disabled={ownedQty <= 0}
            aria-label="Anzahl reduzieren"
            style={iconBtnStyle(ownedQty <= 0)}
          >−</button>
          <span
            style={{
              minWidth: 20,
              textAlign: 'center',
              fontSize: 'var(--fs-sm)',
              fontVariantNumeric: 'tabular-nums',
              color: ownedQty > 0 ? 'var(--color-success)' : 'var(--color-text-dim)',
              fontWeight: 'var(--fw-semibold)',
            }}
          >
            {ownedQty}
          </span>
          <button
            type="button"
            onClick={() => onIncOwned?.(unit)}
            aria-label="Anzahl erhöhen"
            style={iconBtnStyle(false)}
          >+</button>
        </div>

        <div style={{ flex: 1 }} />

        {onAdd && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAdd(unit); }}
            style={{
              padding: '4px 10px',
              fontSize: 'var(--fs-sm)',
              fontWeight: 'var(--fw-semibold)',
              background: 'var(--color-accent)',
              color: 'var(--color-accent-contrast)',
              border: '1px solid var(--color-accent)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
            title={inArmyCount > 0 ? `Bereits ${inArmyCount}× in der Armee` : 'Zur Armee hinzufügen'}
          >
            {inArmyCount > 0 ? `+ (${inArmyCount})` : '+ Armee'}
          </button>
        )}
      </div>
    </div>
  );
}

function iconBtnStyle(disabled) {
  return {
    width: 22,
    height: 22,
    background: 'transparent',
    border: 'none',
    color: disabled ? 'var(--color-text-dim)' : 'var(--color-text)',
    fontSize: 'var(--fs-md)',
    lineHeight: 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    borderRadius: 'var(--radius-sm)',
  };
}
