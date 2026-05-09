// src/shared/search/SearchBar.jsx
//
// Lightweight, theme-aware text input with a leading magnifier and trailing
// clear button. Visual language matches the MTG CardSearch input so the
// search surface across the app feels consistent without coupling features.

export default function SearchBar({
  value,
  onChange,
  placeholder = 'Suchen…',
  autoFocus = false,
  style,
}) {
  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 200,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 'var(--space-3)',
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--color-text-dim)',
          fontSize: 'var(--fs-md)',
          pointerEvents: 'none',
        }}
      >
        ⚲
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        style={{
          width: '100%',
          padding: '8px 36px 8px 32px',
          fontSize: 'var(--fs-md)',
          minHeight: 36,
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Suche löschen"
          style={{
            position: 'absolute',
            right: 4,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: 'var(--color-text-dim)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
