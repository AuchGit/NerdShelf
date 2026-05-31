// src/features/dnd/character-builder/lib/hashNav.js
// Hash-basierte Ersatzfunktionen für useNavigate/useParams, damit die
// DnD-Pages innerhalb des äußeren BrowserRouters eigenständig routen können.

export function useNavigate() {
  return (to) => {
    if (typeof to !== 'string') return
    window.location.hash = to.startsWith('/') ? to : '/' + to
  }
}

export function useParams() {
  const h = window.location.hash.replace(/^#/, '') || '/'
  // [^/?]+ stops at both the next path segment AND the query string, so a
  // popout hash like /character/148?popout=1 yields id "148", not
  // "148?popout=1" (which PostgREST rejects as an invalid bigint → 400).
  // /character/view/:token — read-only viewer for imported characters
  let m = h.match(/^\/character\/view\/([^/?]+)/)
  if (m) return { token: m[1] }
  // /character/:id, /character/:id/edit, /character/:id/levelup
  m = h.match(/^\/character\/([^/?]+)/)
  return m ? { id: m[1] } : {}
}