// src/core/updater/UpdateChecker.jsx
//
// Auto-update flow for NerdShelf when running inside Tauri.
//
// On app start:
//   1. Wait a few seconds (don't slow down the initial render)
//   2. Ask Tauri's updater plugin if a new release is available
//   3. If yes: show a small banner. User can install or dismiss for this session.
//   4. On install: download → install → relaunch
//
// In a regular browser (no Tauri), this component renders nothing.

import { useEffect, useState, useCallback } from 'react'

const CHECK_DELAY_MS  = 4000     // delay first check so app boots responsively
const RECHECK_HOURS   = 6        // periodic re-check while app is running
const DISMISS_KEY     = 'nerdshelf-update-dismissed-version'

export default function UpdateChecker() {
  // `entries` holds one {version, body} per release the user skipped,
  // newest first. The Tauri updater only surfaces the latest body —
  // so for users who skipped several releases, we also pull the
  // GitHub Releases list and aggregate. Falls back to just the
  // latest body if GitHub is unreachable.
  const [updateInfo, setUpdateInfo] = useState(null)   // { version, body, update, entries } | null
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress]     = useState(null)   // { downloaded, total } | null
  const [error, setError]           = useState(null)

  const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

  const checkForUpdate = useCallback(async () => {
    if (!isTauri) return
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      // Timeout: bei blockiertem/zähem GitHub (Firewall/Proxy/AV) soll der
      // Check schnell und leise fehlschlagen statt zu hängen.
      const update = await check({ timeout: 15000 })
      if (!update?.available) return

      // Skip if user already dismissed this exact version
      const dismissed = sessionStorage.getItem(DISMISS_KEY)
      if (dismissed === update.version) return

      // Pull the currently-installed version so we know which range
      // of releases to aggregate. Without this we'd default to "just
      // the latest body" which loses skipped-version notes.
      let currentVersion = ''
      try {
        const { getVersion } = await import('@tauri-apps/api/app')
        currentVersion = await getVersion()
      } catch { /* ignore */ }

      const entries = await fetchSkippedChangelogs(currentVersion, update.version, update.body)

      setUpdateInfo({
        version: update.version,
        body:    update.body,
        entries,
        update,
      })
    } catch (e) {
      console.warn('[UpdateChecker] check failed:', e)
    }
  }, [isTauri])

  useEffect(() => {
    if (!isTauri) return
    // initial delayed check
    const t = setTimeout(checkForUpdate, CHECK_DELAY_MS)
    // periodic re-check
    const interval = setInterval(checkForUpdate, RECHECK_HOURS * 3600 * 1000)
    return () => { clearTimeout(t); clearInterval(interval) }
  }, [isTauri, checkForUpdate])

  async function handleInstall() {
    if (!updateInfo?.update) return
    setInstalling(true)
    setError(null)
    try {
      let downloaded = 0
      let total = 0
      await updateInfo.update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength || 0
            setProgress({ downloaded: 0, total })
            break
          case 'Progress':
            downloaded += event.data.chunkLength || 0
            setProgress({ downloaded, total })
            break
          case 'Finished':
            setProgress({ downloaded: total, total })
            break
        }
      })
      // Relaunch app with the new version
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch (e) {
      console.error('[UpdateChecker] install failed:', e)
      setError(e?.message || String(e))
      setInstalling(false)
    }
  }

  function handleDismiss() {
    if (updateInfo?.version) {
      sessionStorage.setItem(DISMISS_KEY, updateInfo.version)
    }
    setUpdateInfo(null)
    setError(null)
  }

  // Manueller Ausweg, wenn der In-App-Download scheitert (Netzwerk/Proxy):
  // Release-Seite im Standardbrowser öffnen, Installer von Hand laden.
  async function openReleasePage() {
    const url = 'https://github.com/AuchGit/NerdShelf/releases/latest'
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
    } catch {
      try { window.open(url, '_blank') } catch { /* letzter Versuch gescheitert */ }
    }
  }

  if (!isTauri || !updateInfo) return null

  const pct = progress?.total
    ? Math.round((progress.downloaded / progress.total) * 100)
    : 0

  return (
    <div style={S.banner}>
      <div style={S.content}>
        <div style={S.icon}>⬇</div>
        <div style={S.text}>
          <div style={S.title}>
            Update verfügbar: <span style={S.version}>v{updateInfo.version}</span>
          </div>
          {error ? (
            <div style={S.error}>
              Fehler: {error}
              {'\n'}Der Download ist fehlgeschlagen (Netzwerk/Firewall/Proxy?). Du kannst es
              erneut versuchen oder den Installer manuell von der Release-Seite laden.
            </div>
          ) : installing ? (
            <div style={S.subtitle}>
              {progress?.total
                ? `Lade herunter… ${pct}%`
                : 'Installation läuft…'}
            </div>
          ) : (updateInfo.entries && updateInfo.entries.length > 0) ? (
            <div style={S.changelogList}>
              {updateInfo.entries.map(e => (
                <div key={e.version} style={S.changelogBlock}>
                  <div style={S.changelogVer}>v{e.version}</div>
                  <div style={S.subtitle}>{formatChangelog(e.body)}</div>
                </div>
              ))}
            </div>
          ) : updateInfo.body ? (
            <div style={S.subtitle}>{formatChangelog(updateInfo.body)}</div>
          ) : null}
        </div>
      </div>

      {!installing && !error && (
        <div style={S.actions}>
          <button style={S.btnDismiss} onClick={handleDismiss}>Später</button>
          <button style={S.btnInstall} onClick={handleInstall}>Installieren</button>
        </div>
      )}

      {/* Fehlerfall: das Banner darf NIE ohne Ausweg dastehen (vorher gab es
          hier keine Buttons → "Fehlerfenster geht nicht weg und blockiert"). */}
      {!installing && error && (
        <div style={S.actions}>
          <button style={S.btnDismiss} onClick={handleDismiss}>Schließen</button>
          <button style={S.btnDismiss} onClick={openReleasePage}>Release-Seite öffnen</button>
          <button style={S.btnInstall} onClick={handleInstall}>Erneut versuchen</button>
        </div>
      )}

      {installing && progress?.total > 0 && (
        <div style={S.progressBar}>
          <div style={{ ...S.progressFill, width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

// Release-Skript schreibt mehrere Changelog-Punkte mit "; " als
// Trenner in eine Zeile. Hier in echte Zeilenumbrüche auflösen, damit
// der Updater-Banner sie untereinander listet. CSS handhabt das
// Wrapping per `whiteSpace: 'pre-line'` im subtitle-Style.
function formatChangelog(s) {
  if (!s) return ''
  return String(s).split(/;\s+/).map(line => line.trim()).filter(Boolean).join('\n')
}

// GitHub Releases API zwischen `currentVersion` (exklusiv) und
// `latestVersion` (inklusiv) abfragen, sodass das Popup für jeden
// übersprungenen Release dessen Notes mit anzeigen kann. Fällt auf
// `[{version, body: latestBody}]` zurück, falls die API hängt oder
// die Versionsspanne nicht auflösbar ist.
async function fetchSkippedChangelogs(currentVersion, latestVersion, latestBody) {
  const fallback = [{ version: latestVersion, body: latestBody || '' }]
  if (!latestVersion) return fallback
  try {
    // per_page=30 reicht ohne Auth bequem — ein Release dauert ein
    // Patch-Bump, und 30 Releases zwischen zwei App-Starts wäre
    // ohnehin Sondersituation.
    const res = await fetch('https://api.github.com/repos/AuchGit/NerdShelf/releases?per_page=30', {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return fallback
    const list = await res.json()
    if (!Array.isArray(list)) return fallback
    const out = []
    for (const r of list) {
      const v = String(r.tag_name || '').replace(/^v/, '').trim()
      if (!v) continue
      if (compareVersions(v, latestVersion) > 0) continue
      // Wenn wir die aktuelle Version kennen, exklusive Untergrenze;
      // sonst zeig nur den Latest-Release (Fallback weiter unten).
      if (currentVersion && compareVersions(v, currentVersion) <= 0) continue
      out.push({ version: v, body: String(r.body || '') })
    }
    if (out.length === 0) return fallback
    out.sort((a, b) => compareVersions(b.version, a.version))
    return out
  } catch {
    return fallback
  }
}

// Semver-Compare auf x.y.z. Reicht für die App, die kein Pre-Release
// / Build-Metadata-Schema benutzt; die Release-Pipeline erlaubt nur
// reine SemVer-Triples.
function compareVersions(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] || 0
    const bi = pb[i] || 0
    if (ai !== bi) return ai - bi
  }
  return 0
}

const S = {
  banner: {
    position: 'fixed',
    bottom: 'var(--space-4)',
    right: 'var(--space-4)',
    width: 380,
    maxWidth: 'calc(100vw - 32px)',
    background: 'var(--color-bg-elevated)',
    border: '1px solid var(--color-accent)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-lg)',
    padding: 'var(--space-4)',
    zIndex: 999,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
  },
  content: {
    display: 'flex',
    gap: 'var(--space-3)',
    alignItems: 'flex-start',
  },
  icon: {
    width: 32, height: 32,
    flexShrink: 0,
    background: 'var(--color-accent)',
    color: 'var(--color-accent-contrast)',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 'bold',
  },
  text: { minWidth: 0, flex: 1 },
  title: {
    fontSize: 'var(--fs-md)',
    fontWeight: 'var(--fw-semibold)',
    color: 'var(--color-text)',
  },
  version: { color: 'var(--color-accent)' },
  subtitle: {
    fontSize: 'var(--fs-sm)',
    color: 'var(--color-text-muted)',
    marginTop: 2,
    // `pre-line` ehrt die Newlines die formatChangelog aus "; "
    // erzeugt, ohne Spaces zu kollabieren — Punktelisten lesen sich
    // dann wie eine echte Aufzählung.
    whiteSpace: 'pre-line',
    lineHeight: 1.4,
  },
  // Container für die Pro-Version-Blöcke. Wird scrollbar, wenn der
  // User mehrere Releases übersprungen hat — der Banner soll auch
  // mit langer History nicht den halben Screen einnehmen.
  changelogList: {
    marginTop: 4,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxHeight: 260,
    overflowY: 'auto',
    paddingRight: 4,
  },
  changelogBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  changelogVer: {
    fontSize: 'var(--fs-xs, 11px)',
    fontWeight: 'var(--fw-semibold)',
    color: 'var(--color-accent)',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  error: {
    fontSize: 'var(--fs-sm)',
    color: 'var(--color-danger)',
    marginTop: 2,
    whiteSpace: 'pre-line',
    lineHeight: 1.4,
  },
  actions: {
    display: 'flex',
    gap: 'var(--space-2)',
    justifyContent: 'flex-end',
  },
  btnDismiss: {
    padding: '6px 12px',
    background: 'transparent',
    color: 'var(--color-text-muted)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--fs-sm)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnInstall: {
    padding: '6px 14px',
    background: 'var(--color-accent)',
    color: 'var(--color-accent-contrast)',
    border: '1px solid var(--color-accent)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--fs-sm)',
    fontWeight: 'var(--fw-semibold)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  progressBar: {
    height: 4,
    background: 'var(--color-bg-sunken)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: 'var(--color-accent)',
    transition: 'width 200ms linear',
  },
}
