// src/app/settings/SettingsModal.jsx
import { useState } from 'react';
import { Modal, Button } from '../../shared/ui';
import { useTheme } from '../../core/theme/ThemeProvider';

const TABS = [
  { id: 'theme', label: 'Theme' },
  { id: 'tools', label: 'Tools' },
];

export default function SettingsModal({ open, onClose }) {
  const [tab, setTab] = useState('theme');

  return (
    <Modal open={open} onClose={onClose} title="Einstellungen" width={640}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--color-accent)' : '2px solid transparent',
              color: tab === t.id ? 'var(--color-text)' : 'var(--color-text-muted)',
              fontSize: 'var(--fs-sm)',
              fontWeight: 'var(--fw-medium)',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'theme' && <ThemeSettings />}
      {tab === 'tools' && <ToolsSettings />}
    </Modal>
  );
}

function ThemeSettings() {
  const { mode, setThemeMode, customColors, setCustomColors, resetCustomColors, DEFAULT_CUSTOM } = useTheme();

  const options = [
    { id: 'system', label: 'System', desc: 'Folgt OS-Einstellung' },
    { id: 'light', label: 'Hell', desc: 'Helles modernes Theme' },
    { id: 'dark', label: 'Dunkel', desc: 'Dunkles modernes Theme' },
    { id: 'custom', label: 'Benutzerdefiniert', desc: 'Eigene Farben' },
  ];

  const setColor = (key, value) => setCustomColors({ ...customColors, [key]: value });

  return (
    <div>
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        {options.map(opt => (
          <button
            key={opt.id}
            onClick={() => setThemeMode(opt.id)}
            style={{
              textAlign: 'left',
              padding: 'var(--space-3) var(--space-4)',
              background: mode === opt.id ? 'var(--color-surface-hover)' : 'var(--color-surface)',
              border: `1px solid ${mode === opt.id ? 'var(--color-accent)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text)',
              cursor: 'pointer',
              transition: 'all var(--transition)',
            }}
          >
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-medium)' }}>{opt.label}</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', marginTop: 2 }}>{opt.desc}</div>
          </button>
        ))}
      </div>

      {mode === 'custom' && (
        <div style={{ marginTop: 'var(--space-5)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)' }}>Farben anpassen</div>
            <Button size="sm" variant="ghost" onClick={resetCustomColors}>Zurücksetzen</Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
            {Object.keys(DEFAULT_CUSTOM).map(key => (
              <label key={key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 'var(--space-2)', padding: 'var(--space-2)',
                background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--fs-xs)',
              }}>
                <span style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {key.replace('--color-', '')}
                </span>
                <input
                  type="color"
                  value={customColors[key]}
                  onChange={(e) => setColor(key, e.target.value)}
                  style={{
                    width: 32, height: 24, border: 'none',
                    background: 'transparent', cursor: 'pointer', padding: 0,
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolsSettings() {
  return (
    <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', padding: 'var(--space-4) 0' }}>
      Tool-spezifische Einstellungen kommen hier in Zukunft hin.
    </div>
  );
}