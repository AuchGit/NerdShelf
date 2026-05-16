// src/shared/ui/ActionSheet.jsx
//
// iOS-style bottom action sheet. Use for:
//   - long-press menus on a card / list item
//   - "more options" overflow menus on mobile
//   - destructive confirmation flows where a centred modal would feel
//     heavyweight
//
// Pass an array of `items` each with { id, label, icon?, danger?, onSelect }.
// The sheet self-closes after onSelect runs unless the handler returns false.
//
// Visually it's bound to the styles declared in `shared/pwa/pwa.css`; this
// component renders the structure + dismiss logic only.

import { useEffect } from 'react';

export default function ActionSheet({ open, onClose, title, items = [] }) {
  // ESC closes (useful in dev on desktop, also keyboards on iPad).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="pwa-sheet-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="pwa-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Aktionen'}
      >
        <div className="pwa-sheet-grip" aria-hidden="true" />
        {title && <div className="pwa-sheet-title">{title}</div>}
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            className={`pwa-sheet-item ${item.danger ? 'pwa-sheet-item-danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              const result = item.onSelect?.();
              if (result !== false) onClose?.();
            }}
          >
            {item.icon && <span className="pwa-sheet-item-icon">{item.icon}</span>}
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.hint && (
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
                {item.hint}
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
