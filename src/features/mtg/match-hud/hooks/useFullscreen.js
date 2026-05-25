// src/features/mtg/match-hud/hooks/useFullscreen.js
//
// Request browser fullscreen while the hook is mounted with
// `enabled=true`. Hides the Android system status bar (and the browser
// chrome on a normal tab). Best-effort:
//
//   • Installed PWAs on Android Chrome: fullscreen is granted without a
//     prior user gesture, so the on-mount call succeeds.
//   • Regular browser tabs: usually need a user gesture. The
//     "Match starten" submit is a gesture, but by the time React mounts
//     the destination page that context is gone — call silently fails
//     and we degrade to standalone (status bar visible). Acceptable.
//   • iOS Safari: Fullscreen API is severely restricted; treat as no-op.

import { useEffect } from 'react'

export function useFullscreen(enabled) {
  useEffect(() => {
    if (!enabled) return
    if (typeof document === 'undefined') return
    const el = document.documentElement
    if (!el?.requestFullscreen) return

    let cancelled = false

    ;(async () => {
      try {
        if (!document.fullscreenElement) {
          await el.requestFullscreen({ navigationUI: 'hide' })
        }
      } catch {
        /* gesture missing / unsupported — silently degrade */
      }
      // After fullscreen lands (or after the request settled), try to
      // lock the orientation. This MUST come after fullscreen on most
      // mobile browsers — `screen.orientation.lock()` requires the
      // document to be in fullscreen and rejects otherwise. Doing it
      // here in a single sequenced effect fixes the race where the
      // separate orientation hook fired before fullscreen was granted.
      const orientation = window.screen?.orientation
      if (orientation && typeof orientation.lock === 'function') {
        try { await orientation.lock('landscape') }
        catch { /* iOS / unsupported — keep user's setting */ }
      }
    })()

    return () => {
      cancelled = true
      // Release the orientation lock first so the phone snaps back to
      // the user's system rotation as part of leaving the match,
      // before fullscreen exit visually changes the screen.
      try { window.screen?.orientation?.unlock?.() } catch { /* ignore */ }
      // Only exit if WE put the document in fullscreen and it's still there.
      // The exit must be wrapped in try/catch because the spec rejects when
      // there's nothing to exit from.
      if (document.fullscreenElement) {
        try { document.exitFullscreen?.() } catch { /* ignore */ }
      }
      // Reference cancelled to keep React's exhaustive-deps lint happy if
      // the file ever picks up additional async work in cleanup.
      void cancelled
    }
  }, [enabled])
}
