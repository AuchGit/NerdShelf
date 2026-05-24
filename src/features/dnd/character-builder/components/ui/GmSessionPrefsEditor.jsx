// src/features/dnd/character-builder/components/ui/GmSessionPrefsEditor.jsx
//
// Two checkbox lists driven off PASSIVE_OPTIONS + STAT_OPTIONS — both the
// global "Spielleiter" tab in App settings and the in-session quick panel
// embed this so they edit one source of truth.

import { useSessionPrefs } from '../../lib/useSessionPrefs'
import { PASSIVE_OPTIONS, STAT_OPTIONS } from '../../lib/sessionPrefs'

export default function GmSessionPrefsEditor({ compact = false }) {
  const { prefs, toggle, reset } = useSessionPrefs()
  const passSet = new Set(prefs.passives)
  const statSet = new Set(prefs.stats)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 12 : 18 }}>
      <Group title="Passive Werte" >
        {PASSIVE_OPTIONS.map(o => (
          <Toggle key={o.id} label={o.label} checked={passSet.has(o.id)}
                  onChange={() => toggle('passives', o.id)} />
        ))}
      </Group>
      <Group title="Weitere Stats">
        {STAT_OPTIONS.map(o => (
          <Toggle key={o.id} label={o.label} checked={statSet.has(o.id)}
                  onChange={() => toggle('stats', o.id)} />
        ))}
      </Group>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" onClick={reset} style={resetBtn}>Auf Standard zurücksetzen</button>
      </div>
    </div>
  )
}

function Group({ title, children }) {
  return (
    <div>
      <div style={{
        fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)',
        color: 'var(--color-text-muted)', textTransform: 'uppercase',
        letterSpacing: 0.5, marginBottom: 6,
      }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
        {children}
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 10px', borderRadius: 'var(--radius-sm)',
      background: checked ? 'var(--color-surface-hover)' : 'var(--color-surface)',
      border: `1px solid ${checked ? 'var(--color-accent)' : 'var(--color-border)'}`,
      cursor: 'pointer', fontSize: 'var(--fs-sm)',
      transition: 'all var(--transition)',
    }}>
      <input type="checkbox" checked={checked} onChange={onChange}
             style={{ margin: 0, cursor: 'pointer' }} />
      <span>{label}</span>
    </label>
  )
}

const resetBtn = {
  background: 'transparent', border: 'none', color: 'var(--color-text-muted)',
  cursor: 'pointer', fontSize: 'var(--fs-xs)', padding: '4px 8px',
  textDecoration: 'underline', textUnderlineOffset: 2,
}
