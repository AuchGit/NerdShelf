// src/shared/ui/Panel.jsx
export default function Panel({ padding = 'md', style, children, ...rest }) {
  const pad = { sm: 'var(--space-3)', md: 'var(--space-4)', lg: 'var(--space-5)' }[padding];
  return (
    <div
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: pad,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}