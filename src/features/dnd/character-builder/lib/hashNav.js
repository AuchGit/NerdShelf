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
  // /character/:id, /character/:id/edit, /character/:id/levelup
  const m = h.match(/^\/character\/([^/]+)/)
  return m ? { id: m[1] } : {}
}