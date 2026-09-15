// src/features/dnd/character-builder/DndCharacterApp.jsx
import { useEffect, useState, Component, Suspense } from 'react'
import { useAuth } from '../../../core/auth/AuthContext'
import { LanguageProvider } from './lib/i18n'
import { ThemeProvider } from './lib/theme'
import { setupErrorCollector } from './components/ui/BugReportModal'
import lazyWithReload from '../../../shared/lazyWithReload'

// Pages load on first visit — the tabletop and the character sheet are by
// far the biggest parts of the app and most sessions only need one of them.
const DashboardPage       = lazyWithReload(() => import('./pages/DashboardPage'))
const CharacterCreatePage = lazyWithReload(() => import('./pages/CharacterCreatePage'))
const CharacterSheetPage  = lazyWithReload(() => import('./pages/CharacterSheetPage'))
const LevelUpPage         = lazyWithReload(() => import('./pages/LevelUpPage'))
const CharacterEditPage   = lazyWithReload(() => import('./pages/CharacterEditPage'))
const CharacterViewPage   = lazyWithReload(() => import('./pages/CharacterViewPage'))
const CampaignsPage       = lazyWithReload(() => import('./pages/CampaignsPage'))
const CampaignDetailPage  = lazyWithReload(() => import('./pages/CampaignDetailPage'))
const SessionPage         = lazyWithReload(() => import('./pages/SessionPage'))
const VttPage             = lazyWithReload(() => import('./pages/VttPage'))
const HomebrewPage        = lazyWithReload(() => import('../homebrew/pages/HomebrewPage'))

function PageLoading() {
  return (
    <div style={{ color: 'var(--accent)', textAlign: 'center', padding: 80, fontSize: 16 }}>
      Laden...
    </div>
  )
}

setupErrorCollector()

class ErrorBoundary extends Component {
  state = { hasError: false, error: null }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  componentDidCatch(err, info) { console.error('[ErrorBoundary]', err, info) }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: 'var(--accent-red)', padding: 40, textAlign: 'center' }}>
          <h2>Etwas ist schiefgelaufen</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: 10 }}>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()}
            style={{ marginTop: 20, padding: '10px 20px', borderRadius: 8, border: '2px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 14 }}>
            App neu laden
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// Liest #/foo/bar aus der URL
function useHashRoute() {
  const getRoute = () => {
    // Query-Teil im Hash abschneiden: Popout-Fenster laden
    // `#/character/<id>?popout=1` — ohne Strip landet das `?popout=1` in der
    // gecaptureten id (`<id>?popout=1`), der Charakter wird nicht gefunden und
    // das Sheet fällt auf die Kampagnenseite zurück. Die popout=1-Erkennung
    // (usePwaMobile.readPopout) liest die Hash-Query separat, bleibt intakt.
    const h = window.location.hash.replace(/^#/, '').split('?')[0]
    return h || '/'
  }
  const [route, setRoute] = useState(getRoute)
  useEffect(() => {
    const onChange = () => setRoute(getRoute())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

// Shared deep links target /dnd/?join=<token> (campaign) or
// /dnd/?import=<token> (character). The default landing page is the
// character dashboard, which is fine for ?import (DashboardPage consumes
// it there). For ?join we want the user on /campaigns instead — bounce
// once at startup so CampaignsPage's useDeepLinkImport picks it up.
function useDeepLinkBounce() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const q = new URL(window.location.href).searchParams
      const isJoin   = q.has('join')
      const hash     = window.location.hash.replace(/^#/, '') || '/'
      if (isJoin && hash !== '/campaigns') {
        window.location.hash = '/campaigns'
      }
    } catch { /* ignore */ }
  }, [])
}

function matchRoute(route) {
  // /character/new
  if (route === '/character/new') return { page: 'create' }
  // /character/view/:token   (read-only viewer for imported characters)
  let m = route.match(/^\/character\/view\/([^/]+)\/?$/)
  if (m) return { page: 'view', token: m[1] }
  // /character/:id/levelup
  m = route.match(/^\/character\/([^/]+)\/levelup\/?$/)
  if (m) return { page: 'levelup', id: m[1] }
  // /character/:id/edit
  m = route.match(/^\/character\/([^/]+)\/edit\/?$/)
  if (m) return { page: 'edit', id: m[1] }
  // ── Homebrew ──
  if (route === '/homebrew' || route === '/homebrew/') return { page: 'homebrew' }
  // ── Campaigns ──
  if (route === '/campaigns' || route === '/campaigns/') return { page: 'campaigns' }
  // /campaign/:id/session/character/:charId  (GM sheet opened from session — back goes to session)
  m = route.match(/^\/campaign\/([^/]+)\/session\/character\/([^/]+)\/?$/)
  if (m) return { page: 'gmsheet', campaignId: m[1], charId: m[2], fromSession: true }
  // /campaign/:id/session  (session overview)
  m = route.match(/^\/campaign\/([^/]+)\/session\/?$/)
  if (m) return { page: 'session', campaignId: m[1] }
  // /campaign/:id/vtt  (virtual tabletop)
  m = route.match(/^\/campaign\/([^/]+)\/vtt\/?$/)
  if (m) return { page: 'vtt', campaignId: m[1] }
  // /campaign/:id/character/:charId  (GM read-only character sheet)
  m = route.match(/^\/campaign\/([^/]+)\/character\/([^/]+)\/?$/)
  if (m) return { page: 'gmsheet', campaignId: m[1], charId: m[2] }
  // /campaign/:id
  m = route.match(/^\/campaign\/([^/]+)\/?$/)
  if (m) return { page: 'campaign', campaignId: m[1] }
  // /character/:id
  m = route.match(/^\/character\/([^/]+)\/?$/)
  if (m) return { page: 'sheet', id: m[1] }
  // fallback
  return { page: 'dashboard' }
}

function DndRoutes({ session }) {
  useDeepLinkBounce()
  const route = useHashRoute()
  const match = matchRoute(route)

  switch (match.page) {
    case 'create':    return <CharacterCreatePage session={session} />
    case 'sheet':     return <CharacterSheetPage session={session} />
    case 'levelup':   return <LevelUpPage session={session} />
    case 'edit':      return <CharacterEditPage session={session} />
    case 'view':      return <CharacterViewPage />
    case 'campaigns': return <CampaignsPage session={session} />
    case 'homebrew':  return <HomebrewPage session={session} />
    case 'campaign':  return <CampaignDetailPage session={session} campaignId={match.campaignId} />
    case 'session':   return <SessionPage session={session} campaignId={match.campaignId} />
    case 'vtt':       return <VttPage session={session} campaignId={match.campaignId} />
    case 'gmsheet':   return <CharacterSheetPage session={session} readOnly
                               characterId={match.charId} campaignId={match.campaignId}
                               fromSession={!!match.fromSession} />
    case 'dashboard':
    default:          return <DashboardPage session={session} />
  }
}

export default function DndCharacterApp() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <ThemeProvider>
        <div style={{ color: 'var(--accent)', textAlign: 'center', padding: 80, fontSize: 16 }}>
          Laden...
        </div>
      </ThemeProvider>
    )
  }

  if (!user) {
    return (
      <ThemeProvider>
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 80, fontSize: 16 }}>
          Bitte melde dich an, um den Character Builder zu nutzen.
        </div>
      </ThemeProvider>
    )
  }

  const session = { user }

  return (
    <ThemeProvider>
      <LanguageProvider>
        <ErrorBoundary>
          <Suspense fallback={<PageLoading />}>
            <DndRoutes session={session} />
          </Suspense>
        </ErrorBoundary>
      </LanguageProvider>
    </ThemeProvider>
  )
}