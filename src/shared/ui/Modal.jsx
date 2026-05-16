// src/shared/ui/Modal.jsx
import { useEffect } from 'react';
import IconButton from './IconButton';

export default function Modal({ open, onClose, title, children, width = 520, footer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // data-modal-root / data-modal-card hooks let `pwa.css` re-style the modal
  // into a bottom sheet on PWA mobile WITHOUT changing the JSX. Desktop
  // CSS isn't touched, so layout there is unchanged.
  return (
    <div
      data-modal-root
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'var(--color-overlay)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
    >
      <div
        data-modal-card
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: width,
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column',
          maxHeight: '90vh',
        }}
      >
        <div style={{
          padding: 'var(--space-4) var(--space-5)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)' }}>{title}</h2>
          <IconButton onClick={onClose} aria-label="Close">✕</IconButton>
        </div>
        <div style={{ padding: 'var(--space-5)', overflow: 'auto', flex: 1 }}>{children}</div>
        {footer && (
          <div style={{
            padding: 'var(--space-4) var(--space-5)',
            borderTop: '1px solid var(--color-border)',
            display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)',
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
