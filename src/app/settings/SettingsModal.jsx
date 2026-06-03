// src/app/settings/SettingsModal.jsx
import { useEffect, useState } from 'react';
import { Modal, Button, Input } from '../../shared/ui';
import { useTheme } from '../../core/theme/ThemeProvider';
import { useAuth } from '../../core/auth/AuthContext';
import { supabase } from '../../core/supabase/client';
import {
  getMtgPriceSettings,
  setMtgPriceSettings,
  useMtgPriceSettings,
} from '../../features/mtg/deck-builder/services/priceThresholds';
import GmSessionPrefsEditor from '../../features/dnd/character-builder/components/ui/GmSessionPrefsEditor';
import {
  DEFAULT_PILL_COLORS, PILL_COLOR_GROUPS,
  getAllPillColors, setPillColor, resetPillColors,
} from '../../features/dnd/character-builder/lib/pillColors';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'account', label: 'Account' },
  { id: 'theme',   label: 'Theme' },
  { id: 'dnd',     label: 'DnD' },
  { id: 'mtg',     label: 'MTG' },
  { id: 'tools',   label: 'Tools' },
];

const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

export default function SettingsModal({ open, onClose }) {
  const [tab, setTab] = useState('general');
  const [version, setVersion] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isTauri()) {
        try {
          const { getVersion } = await import('@tauri-apps/api/app');
          const v = await getVersion();
          if (!cancelled) setVersion(v);
        } catch {
          if (!cancelled) setVersion('dev');
        }
      } else {
        if (!cancelled) setVersion('web');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Einstellungen"
      width={640}
      footer={
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 'var(--fs-xs)',
          color: 'var(--color-text-muted)',
        }}>
          <span>NerdShelf v{version || '…'}</span>
        </div>
      }
    >
      <div style={{
        display: 'flex',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-4)',
        borderBottom: '1px solid var(--color-border)',
        flexWrap: 'wrap',
      }}>
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

      {tab === 'general' && <GeneralSettings />}
      {tab === 'account' && <AccountSettings />}
      {tab === 'theme'   && <ThemeSettings />}
      {tab === 'dnd'     && <DndSettings />}
      {tab === 'mtg'     && <MtgSettings />}
      {tab === 'tools'   && <ToolsSettings />}
    </Modal>
  );
}

function GeneralSettings() {
  return (
    <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', padding: 'var(--space-4) 0' }}>
      Allgemeine Einstellungen kommen hier in Zukunft hin.
    </div>
  );
}

function AccountSettings() {
  const { user, playerName, updatePlayerName } = useAuth();
  const [name, setName] = useState(playerName || '');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [resetStatus, setResetStatus] = useState(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => { setName(playerName || ''); }, [playerName]);

  async function handleSave() {
    const trimmed = name.trim();
    if (trimmed.length < 2) { setStatus({ type: 'error', msg: 'Mindestens 2 Zeichen.' }); return; }
    if (trimmed.length > 50) { setStatus({ type: 'error', msg: 'Maximal 50 Zeichen.' }); return; }
    setSaving(true); setStatus(null);
    try {
      await updatePlayerName(trimmed);
      setStatus({ type: 'ok', msg: 'Gespeichert.' });
    } catch (e) {
      setStatus({ type: 'error', msg: e?.message || 'Fehler beim Speichern.' });
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordReset() {
    if (!user?.email) return;
    setResetting(true); setResetStatus(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setResetStatus({ type: 'ok', msg: 'Email gesendet. Schau in dein Postfach.' });
    } catch (e) {
      setResetStatus({ type: 'error', msg: e?.message || 'Fehler beim Senden.' });
    } finally {
      setResetting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <Field label="Email">
        <div style={{
          padding: '8px 12px', borderRadius: 'var(--radius-md)',
          background: 'var(--color-bg-sunken)', color: 'var(--color-text-muted)',
          fontSize: 'var(--fs-md)', border: '1px solid var(--color-border)',
        }}>
          {user?.email || '—'}
        </div>
      </Field>

      <Field label="Player-Name">
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Dein Name"
            maxLength={50}
          />
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Speichert…' : 'Speichern'}
          </Button>
        </div>
        {status && <StatusLine type={status.type} msg={status.msg} />}
      </Field>

      <Field label="Passwort">
        <div>
          <Button variant="secondary" onClick={handlePasswordReset} disabled={resetting || !user?.email}>
            {resetting ? 'Sende…' : 'Reset-Email senden'}
          </Button>
        </div>
        {resetStatus && <StatusLine type={resetStatus.type} msg={resetStatus.msg} />}
      </Field>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', fontWeight: 'var(--fw-medium)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function StatusLine({ type, msg }) {
  return (
    <div style={{
      fontSize: 'var(--fs-xs)',
      marginTop: 4,
      color: type === 'ok' ? 'var(--color-success, #2d8a2d)' : 'var(--color-danger, #cc3333)',
    }}>
      {msg}
    </div>
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

function DndSettings() {
  const [exportPath, setExportPath] = useState(() => localStorage.getItem('dndbuilder_export_path') || '');
  const [defaultPath, setDefaultPath] = useState('');
  const [picking, setPicking] = useState(false);
  const tauri = isTauri();

  useEffect(() => {
    if (!tauri) return;
    let cancelled = false;
    (async () => {
      try {
        // Downloads ist der Erwartungswert, den User aus jedem
        // anderen Programm kennen. resourceDir() / appDataDir() lagen
        // bei per-machine-Installs in Program Files bzw. AppData —
        // beides ungeeignet als "klingt nach Foundry-Export"-Default.
        const { downloadDir } = await import('@tauri-apps/api/path');
        const p = await downloadDir();
        if (!cancelled) setDefaultPath(p);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [tauri]);

  async function pickFolder() {
    if (!tauri) return;
    setPicking(true);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: exportPath || defaultPath || undefined,
        title: 'Foundry-Export-Ordner wählen',
      });
      if (typeof selected === 'string' && selected) {
        localStorage.setItem('dndbuilder_export_path', selected);
        setExportPath(selected);
      }
    } catch (e) {
      console.warn('[Settings] folder pick failed:', e);
    } finally {
      setPicking(false);
    }
  }

  function clearPath() {
    localStorage.removeItem('dndbuilder_export_path');
    setExportPath('');
  }

  const displayPath = exportPath || defaultPath;
  const isPlaceholder = !exportPath;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <Field label="Foundry-Export-Ordner">
        <div style={{
          padding: '8px 12px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-bg-sunken)',
          border: '1px solid var(--color-border)',
          color: isPlaceholder ? 'var(--color-text-muted)' : 'var(--color-text)',
          fontSize: 'var(--fs-sm)',
          fontFamily: 'var(--font-mono)',
          wordBreak: 'break-all',
          minHeight: 36,
          display: 'flex',
          alignItems: 'center',
        }}>
          {displayPath || (tauri ? 'Wird beim ersten Export ermittelt…' : 'Nur in der Desktop-App verfügbar')}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <Button
            onClick={pickFolder}
            disabled={!tauri || picking}
            title={!tauri ? 'Nur in der Desktop-App verfügbar' : undefined}
          >
            {picking ? 'Öffnet…' : 'Ordner wählen…'}
          </Button>
          {exportPath && (
            <Button variant="ghost" onClick={clearPath}>
              Zurücksetzen
            </Button>
          )}
        </div>
        {!tauri && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
            Diese Einstellung ist nur in der Desktop-App verfügbar.
          </div>
        )}
      </Field>

      {/* ── Spielleiter — session overview defaults ───────────────────── */}
      <Field label="Spielleiter">
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)', marginBottom: 8 }}>
          Welche Werte für jeden Charakter beim Klick auf „Session starten" angezeigt werden.
          Auch in der Session selbst änderbar.
        </div>
        <GmSessionPrefsEditor />
      </Field>

      {/* ── Pill-Farben ─────────────────────────────────────────────── */}
      <Field label="Pill-Farben">
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)', marginBottom: 8 }}>
          Farben für Damage-Type-, Save-, Action- und Spell-Pills. Lokal pro Browser gespeichert.
        </div>
        <PillColorEditor />
      </Field>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Pill-Color-Editor — Reihen aus Label + nativem Color-Picker, plus
// einem "Auf Default zurücksetzen"-Knopf. Speichert lokal in
// localStorage (siehe lib/pillColors.js), feuert ein custom-event
// damit alle Sheet-Komponenten sofort re-renderen.
// ─────────────────────────────────────────────────────────────────
function PillColorEditor() {
  const [, force] = useState(0)
  const colors = getAllPillColors()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {PILL_COLOR_GROUPS.map(group => (
        <div key={group.label}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)',
            textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
          }}>{group.label}</div>
          <div style={{
            display: 'grid', gap: 6,
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          }}>
            {group.items.map(([key, label]) => {
              const value = colors[key] || DEFAULT_PILL_COLORS[key] || '#888888'
              const overridden = colors[key] && colors[key] !== DEFAULT_PILL_COLORS[key]
              return (
                <label key={key} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  fontSize: 12, color: 'var(--color-text)',
                }}>
                  <input
                    type="color"
                    value={value}
                    onChange={(e) => { setPillColor(key, e.target.value); force(n => n + 1) }}
                    style={{ width: 28, height: 22, border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', padding: 0, background: 'transparent' }}
                  />
                  <span style={{
                    padding: '1px 6px', borderRadius: 4,
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                    textTransform: 'uppercase',
                    border: `1px solid ${value}`, color: value,
                    background: `color-mix(in srgb, ${value} 14%, transparent)`,
                  }}>{label}</span>
                  {overridden && (
                    <button
                      type="button"
                      onClick={() => { setPillColor(key, null); force(n => n + 1) }}
                      title="Auf Default zurücksetzen"
                      style={{
                        marginLeft: 'auto',
                        fontSize: 10, padding: '1px 5px',
                        background: 'transparent', color: 'var(--color-text-muted)',
                        border: '1px solid var(--color-border)', borderRadius: 3, cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >↻</button>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          if (window.confirm('Alle Pill-Farben auf Default zurücksetzen?')) {
            resetPillColors(); force(n => n + 1)
          }
        }}
        style={{
          alignSelf: 'flex-start',
          padding: '4px 12px', fontSize: 12,
          background: 'transparent', color: 'var(--color-text-muted)',
          border: '1px solid var(--color-border)', borderRadius: 4,
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >↻ Alle zurücksetzen</button>
    </div>
  )
}

function MtgSettings() {
  const settings = useMtgPriceSettings();

  function update(patch) {
    setMtgPriceSettings(patch);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <Field label="Warnung bei einzelnen Karten">
        <label style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)',
        }}>
          <input
            type="checkbox"
            checked={!!settings.cardEnabled}
            onChange={e => update({ cardEnabled: e.target.checked })}
          />
          Aktivieren
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginTop: 'var(--space-2)' }}>
          <Input
            type="number"
            min={0}
            step={0.5}
            value={settings.cardThresholdEur}
            onChange={e => update({ cardThresholdEur: Math.max(0, Number(e.target.value) || 0) })}
            disabled={!settings.cardEnabled}
            style={{ width: 120 }}
          />
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>EUR</span>
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
          Karten über diesem Cardmarket-Trend-Preis bekommen ein Warn-Label im
          Deckbuilder.
        </div>
      </Field>

      <Field label="Warnung bei gesamten Decks">
        <label style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)',
        }}>
          <input
            type="checkbox"
            checked={!!settings.deckEnabled}
            onChange={e => update({ deckEnabled: e.target.checked })}
          />
          Aktivieren
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginTop: 'var(--space-2)' }}>
          <Input
            type="number"
            min={0}
            step={1}
            value={settings.deckThresholdEur}
            onChange={e => update({ deckThresholdEur: Math.max(0, Number(e.target.value) || 0) })}
            disabled={!settings.deckEnabled}
            style={{ width: 120 }}
          />
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>EUR</span>
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
          Decks über diesem Gesamtpreis bekommen ein Warn-Label im Dashboard
          und Deckbuilder.
        </div>
      </Field>
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
