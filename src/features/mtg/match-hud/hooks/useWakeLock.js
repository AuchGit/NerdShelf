// src/features/mtg/match-hud/hooks/useWakeLock.js
//
// Acquire a screen wake lock while the hook is mounted and the
// `enabled` flag is true. Browsers / iOS WebView automatically release
// the lock when the tab loses visibility — we listen for the
// visibilitychange event and re-acquire when the tab returns so a
// quick app-switch doesn't permanently kill the lock.

import { useEffect } from 'react'

export function useWakeLock(enabled) {
  useEffect(() => {
    if (!enabled) return
    if (typeof navigator === 'undefined' || !navigator.wakeLock) return

    let lock = null
    let cancelled = false

    async function acquire() {
      try {
        lock = await navigator.wakeLock.request('screen')
        lock.addEventListener?.('release', () => { lock = null })
      } catch { /* user gesture missing / unsupported — silently ignore */ }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible' && !lock && !cancelled) acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      try { lock?.release() } catch { /* ignore */ }
      lock = null
    }
  }, [enabled])
}
