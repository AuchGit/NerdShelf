// src/shared/ui/IconButton.jsx
export default function IconButton({ size = 'md', style, children, ...rest }) {
  const dim = { sm: 28, md: 32, lg: 40 }[size];
  return (
    <button
      style={{
        width: dim,
        height: dim,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        color: 'var(--color-text-muted)',
        border: '1px solid transparent',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'background var(--transition), color var(--transition)',
        fontSize: 16,
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--color-surface-hover)';
        e.currentTarget.style.color = 'var(--color-text)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--color-text-muted)';
      }}
      {...rest}
    >
      {children}
    </button>
  );
}