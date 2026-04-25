// src/shared/ui/Button.jsx
export default function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  fullWidth = false,
  style,
  children,
  ...rest
}) {
  const sizeStyles = {
    sm: { padding: '6px 12px', fontSize: 'var(--fs-sm)', minHeight: 28 },
    md: { padding: '8px 16px', fontSize: 'var(--fs-md)', minHeight: 36 },
    lg: { padding: '10px 20px', fontSize: 'var(--fs-lg)', minHeight: 44 },
  }[size];

  const variants = {
    primary: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: '1px solid var(--color-accent)' },
    secondary: { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
    ghost: { background: 'transparent', color: 'var(--color-text)', border: '1px solid transparent' },
    danger: { background: 'var(--color-danger)', color: '#fff', border: '1px solid var(--color-danger)' },
  }[variant];

  return (
    <button
      disabled={disabled}
      style={{
        ...sizeStyles,
        ...variants,
        width: fullWidth ? '100%' : undefined,
        borderRadius: 'var(--radius-md)',
        fontWeight: 'var(--fw-medium)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background var(--transition), border-color var(--transition), color var(--transition)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-2)',
        lineHeight: 1,
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}