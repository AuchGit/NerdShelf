// src/shared/filters/FilterChip.jsx
//
// Pill-shaped toggle chip used for multi-select filter rows (factions,
// keywords, roles, …). Shares the colour-pip semantic from the MTG search
// without copying the MTG-only colour identity styling.

export default function FilterChip({
  active = false,
  onClick,
  children,
  title,
  count,
  style,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: '6px 10px',
        minHeight: 28,
        background: active ? 'var(--color-accent)' : 'var(--color-surface)',
        color: active ? 'var(--color-accent-contrast)' : 'var(--color-text)',
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderRadius: 999,
        fontSize: 'var(--fs-sm)',
        fontWeight: active ? 'var(--fw-semibold)' : 'var(--fw-medium)',
        cursor: 'pointer',
        transition: 'background var(--transition), border-color var(--transition), color var(--transition)',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span>{children}</span>
      {count != null && (
        <span
          style={{
            background: active
              ? 'color-mix(in srgb, var(--color-accent-contrast) 25%, transparent)'
              : 'var(--color-bg-sunken)',
            color: 'inherit',
            padding: '0 6px',
            borderRadius: 999,
            fontSize: 'var(--fs-xs)',
            fontVariantNumeric: 'tabular-nums',
            opacity: 0.8,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
