// Toast stack (bottom-center, above the bottom bar): surfaces failures and
// confirmations from anywhere in the VTT (lib/toast.js bus). Auto-dismisses;
// click removes immediately.
import { useEffect, useState } from 'react';
import { subscribeToasts } from '../lib/toast';

const TTL_MS = 6000;

export default function Toasts() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => subscribeToasts((t) => {
    setToasts((list) => [...list.slice(-4), t]); // max 5 sichtbar
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), TTL_MS);
  }), []);
  if (!toasts.length) return null;
  return (
    <div style={S.wrap}>
      {toasts.map((t) => (
        <div key={t.id} style={{ ...S.toast, ...TONES[t.tone] }} onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))}>
          <span style={S.icon}>{ICONS[t.tone] || 'ℹ'}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

const ICONS = { error: '⚠', warning: '⚠', info: 'ℹ', success: '✓' };
const TONES = {
  error: { borderColor: 'var(--color-danger)', color: 'var(--color-danger)' },
  warning: { borderColor: 'var(--color-warning,#e0af68)', color: 'var(--color-warning,#e0af68)' },
  info: { borderColor: 'var(--color-border)', color: 'var(--color-text)' },
  success: { borderColor: 'var(--accent-green,#4ade80)', color: 'var(--accent-green,#4ade80)' },
};
const S = {
  wrap: { position: 'absolute', bottom: 150, left: '50%', transform: 'translateX(-50%)', zIndex: 3000, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', pointerEvents: 'none' },
  toast: { pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 8, maxWidth: 'min(520px, 80vw)', padding: '8px 14px', background: 'var(--color-bg-elevated)', border: '1px solid', borderRadius: 'var(--radius-md)', boxShadow: '0 6px 24px #0008', fontSize: 'var(--fs-sm)', cursor: 'pointer' },
  icon: { fontWeight: 800 },
};
