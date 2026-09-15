// src/shared/sharing/useDeepLinkImport.js
//
// Reads `?import=<token>` or `?join=<token>` off the current URL and hands
// the token back to the calling dashboard so it can run its own import /
// join flow — on mount, and again when a link arrives while the page is
// already open (desktop app deep link, installed web app reusing its
// window).
//
// After the parameter has been consumed it's stripped from the URL so a
// reload doesn't re-trigger the action. We use `history.replaceState`
// directly so this works for both BrowserRouter routes (MTG/WH40K) and
// the hash-based DnD app (the hash isn't touched).
//
// Usage on the dashboard:
//
//   useDeepLinkImport({
//     param: 'import',                  // or 'join'
//     onToken: token => addImport(token),
//   })

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

export function useDeepLinkImport({ param = 'import', onToken }) {
  const handledToken = useRef(null)
  const location = useLocation()

  useEffect(() => {
    if (typeof window === 'undefined') return
    let url
    try { url = new URL(window.location.href) } catch { return }
    const token = url.searchParams.get(param)
    if (!token || token === handledToken.current) return

    handledToken.current = token

    // Strip the query param so a refresh doesn't re-fire.
    url.searchParams.delete(param)
    try {
      window.history.replaceState(window.history.state, '', url.pathname + (url.search ? url.search : '') + url.hash)
    } catch { /* ignore — onToken still runs */ }

    // Defer so the calling dashboard has finished mounting/auth setup
    // before we kick off the modal/import.
    Promise.resolve().then(() => onToken?.(token))
  }, [param, onToken, location.key, location.search])
}
