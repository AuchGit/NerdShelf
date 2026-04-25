// src/features/dnd/character-builder/DndCharacterApp.jsx
import { useEffect, useState, Component } from 'react'
import { useAuth } from '../../../core/auth/AuthContext'
import { LanguageProvider } from './lib/i18n'
import { ThemeProvider } from './lib/theme'
import { setupErrorCollector } from './components/ui/BugReportModal'
import DashboardPage from './pages/DashboardPage'
import CharacterCreatePage from './pages/CharacterCreatePage'
import CharacterSheetPage from './pages/CharacterSheetPage'
import LevelUpPage from './pages/LevelUpPage'
import CharacterEditPage from './pages/CharacterEditPage'

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
    const h = window.location.hash.replace(/^#/, '')
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

function matchRoute(route) {
  // /character/new
  if (route === '/character/new') return { page: 'create' }
  // /character/:id/levelup
  let m = route.match(/^\/character\/([^/]+)\/levelup\/?$/)
  if (m) return { page: 'levelup', id: m[1] }
  // /character/:id/edit
  m = route.match(/^\/character\/([^/]+)\/edit\/?$/)
  if (m) return { page: 'edit', id: m[1] }
  // /character/:id
  m = route.match(/^\/character\/([^/]+)\/?$/)
  if (m) return { page: 'sheet', id: m[1] }
  // fallback
  return { page: 'dashboard' }
}

function DndRoutes({ session }) {
  const route = useHashRoute()
  const match = matchRoute(route)

  switch (match.page) {
    case 'create':    return <CharacterCreatePage session={session} />
    case 'sheet':     return <CharacterSheetPage session={session} />
    case 'levelup':   return <LevelUpPage session={session} />
    case 'edit':      return <CharacterEditPage session={session} />
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
          <DndRoutes session={session} />
        </ErrorBoundary>
      </LanguageProvider>
    </ThemeProvider>
  )
}