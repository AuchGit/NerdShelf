// src/shared/tokens/ShareTokenBadge.jsx
//
// Click-to-copy share-token chip. Used in dashboards and entity headers
// to surface the unique identifier of a deck / army / character. The
// chip auto-formats the token (`X3Q9-F4MV-7K2H`) and gives a brief
// "Kopiert" pulse on success so the user knows the click registered.

import { useState } from 'react';
import { formatToken, copyToken } from './shareToken';

export default function ShareTokenBadge({ token, label = 'Token', compact = false, style }) {
  const [copied, setCopied] = useState(false);
  if (!token) return null;

  const handleCopy = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    const ok = await copyToken(token);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`${label} kopieren — ${formatToken(token)}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: compact ? '1px 6px' : '2px 8px',
        background: copied
          ? 'color-mix(in srgb, var(--color-success) 18%, transparent)'
          : 'var(--color-bg-sunken)',
        color: copied ? 'var(--color-success)' : 'var(--color-text-muted)',
        border: `1px solid ${copied ? 'var(--color-success)' : 'var(--color-border)'}`,
        borderRadius: 999,
        fontSize: compact ? 10 : 'var(--fs-xs)',
        fontFamily: 'var(--font-mono)',
        letterSpacing: 0.4,
        cursor: 'pointer',
        transition: 'background var(--transition), color var(--transition), border-color var(--transition)',
        ...style,
      }}
    >
      <span aria-hidden="true">{copied ? '✓' : '⌗'}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {copied ? 'Kopiert' : formatToken(token)}
      </span>
    </button>
  );
}
