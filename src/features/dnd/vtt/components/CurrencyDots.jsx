// Compact currency display: one colored dot per coin type + amount. Editable
// (number) or read-only. Shared by the inventory sidebar and the character tab.
import { COIN_TYPES } from '../../character-builder/lib/sheetUtils';

export default function CurrencyDots({ currency, onChange, editable = true }) {
  const cur = currency || {};
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {[...COIN_TYPES].reverse().map((c) => (
        <span key={c.key} title={c.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: c.color, border: '1px solid #0006', flexShrink: 0 }} />
          {editable ? (
            <input type="number" min="0" value={cur[c.key] || 0}
              onChange={(e) => onChange?.(c.key, Math.max(0, e.target.value | 0))}
              style={{ width: 56, minWidth: 56, background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '1px 4px', fontWeight: 700, fontSize: 'var(--fs-sm)', textAlign: 'right' }} />
          ) : (
            <b style={{ fontSize: 'var(--fs-sm)' }}>{cur[c.key] || 0}</b>
          )}
          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>{c.key}</span>
        </span>
      ))}
    </div>
  );
}
