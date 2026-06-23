// src/app/settings/SettingsModal.jsx
import { useEffect, useState } from 'react';
import { Modal, Button, Input } from '../../shared/ui';
import { useTheme } from '../../core/theme/ThemeProvider';
import { useAuth } from '../../core/auth/AuthContext';
import { supabase } from '../../core/supabase/client';
import {
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
    </Modal>
  );
}

function GeneralSettings() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <Field label="App-Updates">
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)', marginBottom: 8 }}>
          Prüft GitHub auf eine neue Version. Default-Check läuft automatisch ~4s nach App-Start und alle 6h.
        </div>
        <UpdateCheckButton />
        <RecentReleases />
      </Field>
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

      {/* ── Cross-Edition-Marker für 5e.tools-Imports ─────────────── */}
      <Field label="Cross-Edition-Marker">
        <CrossEditionToggle />
      </Field>

      {/* Virtual-Tabletop settings now live INSIDE the VTT (top-right ⚙). */}
    </div>
  );
}

function CrossEditionToggle() {
  const [hide, setHide] = useState(() => {
    try { return localStorage.getItem('nerdshelf:hideCrossEditionMarker') === '1' }
    catch { return false }
  });
  const onChange = (e) => {
    const next = e.target.checked;
    setHide(next);
    try {
      if (next) localStorage.setItem('nerdshelf:hideCrossEditionMarker', '1');
      else localStorage.removeItem('nerdshelf:hideCrossEditionMarker');
      window.dispatchEvent(new CustomEvent('nerdshelf:crossedition-changed'));
    } catch { /* ignore */ }
  };
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)',
      cursor: 'pointer',
    }}>
      <input type="checkbox" checked={hide} onChange={onChange} />
      <span>
        Cross-Edition-Marker bei importierten 5e.tools-Einträgen ausblenden
      </span>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────
// Manueller "Auf Updates prüfen"-Knopf. Triggert denselben check()
// wie der auto-Updater, aber mit sichtbarem Feedback — User mit
// Installer-Setups die kein Popup sehen können hier verifizieren ob
// die Updater-Pipeline überhaupt durchkommt.
// ─────────────────────────────────────────────────────────────────
function UpdateCheckButton() {
  const [busy, setBusy]   = useState(false)
  const [info, setInfo]   = useState(null)
  const isTauri = typeof window !== 'undefined'
    && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

  async function run() {
    setBusy(true); setInfo(null)
    try {
      let currentVersion = ''
      if (isTauri) {
        try {
          const { getVersion } = await import('@tauri-apps/api/app')
          currentVersion = await getVersion()
        } catch { /* ignore */ }
      }
      if (!isTauri) {
        setInfo({ kind: 'info', text: 'Update-Check funktioniert nur im Desktop-Build (Tauri).' })
        return
      }
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      if (!update?.available) {
        setInfo({ kind: 'ok',
          text: `Du bist auf der aktuellsten Version (v${currentVersion || '?'}).` })
        return
      }
      setInfo({ kind: 'new',
        text: `Update verfügbar: v${update.version}. Im Haupt-Banner unten rechts erscheint die Installations-Möglichkeit.` })
    } catch (e) {
      setInfo({ kind: 'err',
        text: `Update-Check fehlgeschlagen: ${e?.message || String(e)}` })
    } finally {
      setBusy(false)
    }
  }

  const color = info?.kind === 'err' ? 'var(--color-danger)'
    : info?.kind === 'new' ? 'var(--color-accent)'
    : info?.kind === 'ok' ? 'var(--color-success, var(--color-accent))'
    : 'var(--color-text-muted)'

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <Button onClick={run} disabled={busy}>
        {busy ? 'Prüfe …' : 'Auf Updates prüfen'}
      </Button>
      {info && (
        <span style={{ fontSize: 12, color }}>{info.text}</span>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// RecentReleases — zeigt die letzten 3 GitHub-Releases mit ein-/
// ausklappbarem Changelog. Jede Version hat einen "Installieren"-
// Knopf der die NSIS-Setup-EXE im Browser/OS-Download öffnet
// (Tauri opener-plugin → Download im Default-Browser, User führt
// den Installer manuell aus). Erlaubt sowohl Downgrade als auch
// Reinstall einer älteren Version.
// ─────────────────────────────────────────────────────────────────
function RecentReleases() {
  const [releases, setReleases] = useState(null)
  const [error, setError]       = useState(null)
  const [openId, setOpenId]     = useState(null)
  const [busyId, setBusyId]     = useState(null)
  // Was bietet der Tauri-Updater aktuell an? Diese Version geht über
  // den background-downloadAndInstall()-Pfad — alle anderen Versionen
  // sind Downgrades und müssen weiter den Browser-Download nehmen
  // (Tauri-Updater ist „latest-or-not", kein arbitrary-Version-Install).
  const [updaterVersion, setUpdaterVersion] = useState(null)
  const [currentVersion, setCurrentVersion] = useState(null)
  const isTauri = typeof window !== 'undefined'
    && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

  useEffect(() => {
    let cancelled = false
    fetch('https://api.github.com/repos/AuchGit/NerdShelf/releases?per_page=3', {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(list => { if (!cancelled) setReleases(Array.isArray(list) ? list : []) })
      .catch(e => { if (!cancelled) setError(String(e?.message || e)) })
    return () => { cancelled = true }
  }, [])

  // Tauri-Updater + Current-Version parallel laden. updaterVersion =
  // null wenn kein Update verfügbar (heißt: User ist schon auf
  // latest, oder wir sind im Browser).
  useEffect(() => {
    if (!isTauri) return
    let cancelled = false
    ;(async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app')
        const v = await getVersion()
        if (!cancelled) setCurrentVersion(String(v || '').replace(/^v/, ''))
      } catch { /* ignore */ }
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const update = await check()
        if (!cancelled) setUpdaterVersion(update?.available ? String(update.version || '').replace(/^v/, '') : null)
      } catch (e) {
        console.warn('[updater-check]', e)
      }
    })()
    return () => { cancelled = true }
  }, [isTauri])

  async function install(release, ver) {
    setBusyId(release.id)
    try {
      // Bevorzugter Pfad: Tauri-Updater wenn diese Version genau die
      // ist die der Updater gerade anbietet → background download +
      // auto-install + relaunch. Kein User-Browser-Download nötig.
      if (isTauri && updaterVersion && ver === updaterVersion) {
        try {
          const { check } = await import('@tauri-apps/plugin-updater')
          const update = await check()
          if (update?.available) {
            await update.downloadAndInstall()
            // Nach erfolgreichem Install muss der Process neu gestartet
            // werden damit die neue Binary läuft.
            const { relaunch } = await import('@tauri-apps/plugin-process')
            await relaunch()
            return
          }
        } catch (e) {
          console.warn('[updater-install] fallback to browser', e)
          // Fall through zum Opener-Pfad.
        }
      }
      // Downgrade / Reinstall: opener-Plugin lädt im OS-Browser. Tauri-
      // Updater unterstützt keinen arbitrary-version-install.
      const asset = (release.assets || []).find(a => /\.exe$/i.test(a.name || ''))
      const url = asset?.browser_download_url || release.html_url
      if (!url) return
      if (isTauri) {
        try {
          const { openUrl } = await import('@tauri-apps/plugin-opener')
          await openUrl(url)
          return
        } catch (e) {
          console.warn('[opener]', e)
        }
      }
      try { window.open(url, '_blank') } catch { /* ignore */ }
    } finally {
      setBusyId(null)
    }
  }

  if (error) {
    return (
      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-danger)' }}>
        Release-Liste konnte nicht geladen werden: {error}
      </div>
    )
  }
  if (!releases) {
    return (
      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>
        Lade Release-Historie…
      </div>
    )
  }
  if (releases.length === 0) return null
  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)',
        textTransform: 'uppercase', letterSpacing: 0.5,
      }}>Letzte Versionen</div>
      {releases.map(r => {
        const isOpen = openId === r.id
        const ver = String(r.tag_name || '').replace(/^v/, '')
        // Drei Zustände pro Zeile:
        //   • Aktuelle Version → kein Install-Button (User ist schon drauf)
        //   • Latest verfügbar via Tauri-Updater → "Update installieren"
        //     (background download + auto-install + relaunch)
        //   • Ältere/andere Version → "Browser-Download" (Opener)
        const isCurrent = currentVersion && ver === currentVersion
        const isUpdaterTarget = updaterVersion && ver === updaterVersion
        const busy = busyId === r.id
        const btnLabel = busy
          ? 'Installiere…'
          : isUpdaterTarget ? 'Auto-Update'
          : 'Browser-Download'
        const btnTitle = isUpdaterTarget
          ? 'Im Hintergrund herunterladen + installieren + neustarten'
          : 'Download startet im Browser — Installer manuell ausführen'
        return (
          <div key={r.id} style={{
            border: '1px solid var(--color-border)', borderRadius: 6,
            background: 'var(--color-bg-elevated)',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', cursor: 'pointer',
            }} onClick={() => setOpenId(o => o === r.id ? null : r.id)}>
              <span style={{ flex: 1, fontWeight: 600, color: 'var(--color-text)' }}>
                v{ver} <span style={{
                  fontSize: 11, fontWeight: 400, color: 'var(--color-text-muted)',
                  marginLeft: 6,
                }}>{new Date(r.published_at).toLocaleDateString()}</span>
                {isCurrent && (
                  <span style={{
                    marginLeft: 8, fontSize: 10, fontWeight: 700,
                    padding: '1px 6px', borderRadius: 4,
                    border: '1px solid var(--color-text-muted)',
                    color: 'var(--color-text-muted)', textTransform: 'uppercase',
                  }}>Installiert</span>
                )}
              </span>
              {!isCurrent && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => { e.stopPropagation(); install(r, ver) }}
                  title={btnTitle}
                  style={{
                    padding: '3px 10px', fontSize: 11, fontWeight: 600,
                    background: isUpdaterTarget
                      ? 'color-mix(in srgb, var(--color-accent) 16%, transparent)'
                      : 'transparent',
                    color: 'var(--color-accent)',
                    border: '1px solid var(--color-accent)', borderRadius: 4,
                    cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
                    opacity: busy ? 0.6 : 1,
                  }}
                >{btnLabel}</button>
              )}
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {isOpen ? '▲' : '▼'}
              </span>
            </div>
            {isOpen && (
              <div style={{
                padding: '8px 12px',
                borderTop: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                fontSize: 12, lineHeight: 1.5, color: 'var(--color-text-muted)',
                whiteSpace: 'pre-wrap',
                maxHeight: 240, overflowY: 'auto',
              }}>
                {(r.body || '').trim() || 'Keine Changelog-Notizen.'}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
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

