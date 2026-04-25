// src/shared/ui/Input.jsx
export default function Input({ size = 'md', style, ...rest }) {
  const sizeStyles = {
    sm: { padding: '6px 10px', fontSize: 'var(--fs-sm)', minHeight: 28 },
    md: { padding: '8px 12px', fontSize: 'var(--fs-md)', minHeight: 36 },
    lg: { padding: '10px 14px', fontSize: 'var(--fs-lg)', minHeight: 44 },
  }[size];
  return (
    <input
      style={{
        ...sizeStyles,
        width: '100%',
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        ...style,
      }}
      {...rest}
    />
  );
}