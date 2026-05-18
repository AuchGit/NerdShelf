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
  // /character/view/:token — read-only viewer for imported characters
  let m = h.match(/^\/character\/view\/([^/]+)/)
  if (m) return { token: m[1] }
  // /character/:id, /character/:id/edit, /character/:id/levelup
  m = h.match(/^\/character\/([^/]+)/)
  return m ? { id: m[1] } : {}
}