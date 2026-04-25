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
  const [updateInfo, setUpdateInfo] = useState(null)   // { version, body, update } | null
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress]     = useState(null)   // { downloaded, total } | null
  const [error, setError]           = useState(null)

  const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

  const checkForUpdate = useCallback(async () => {
    if (!isTauri) return
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      if (!update?.available) return

      // Skip if user already dismissed this exact version
      const dismissed = sessionStorage.getItem(DISMISS_KEY)
      if (dismissed === update.version) return

      setUpdateInfo({
        version: update.version,
        body:    update.body,
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
            <div style={S.error}>Fehler: {error}</div>
          ) : installing ? (
            <div style={S.subtitle}>
              {progress?.total
                ? `Lade herunter… ${pct}%`
                : 'Installation läuft…'}
            </div>
          ) : updateInfo.body ? (
            <div style={S.subtitle}>{truncate(updateInfo.body, 140)}</div>
          ) : null}
        </div>
      </div>

      {!installing && !error && (
        <div style={S.actions}>
          <button style={S.btnDismiss} onClick={handleDismiss}>Später</button>
          <button style={S.btnInstall} onClick={handleInstall}>Installieren</button>
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

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
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
  },
  error: {
    fontSize: 'var(--fs-sm)',
    color: 'var(--color-danger)',
    marginTop: 2,
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
