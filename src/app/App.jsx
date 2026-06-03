// src/app/App.jsx
import { AuthProvider } from '../core/auth/AuthContext';
import AuthGate from '../core/auth/AuthGate';
import { ThemeProvider } from '../core/theme/ThemeProvider';
import { setupErrorCollector } from '../core/bug-report/collector';
import UpdateChecker from '../core/updater/UpdateChecker';
import Router from './Router';
import usePwaMobile from '../shared/hooks/usePwaMobile';
import { PinnedTooltipsProvider } from '../features/dnd/character-builder/components/ui/PinnedTooltipsContext';
import PinOverlayPage from '../features/dnd/character-builder/components/ui/PinOverlayPage';
import '../core/theme/theme.css';

setupErrorCollector();

// Erkennt Pin-Overlay-Fenster anhand der URL. Pin-Fenster bekommen die
// URL `…/#/pin-overlay/<id>` mit. Pre-Router-Check, weil die Overlay-
// Page weder AuthGate noch Router noch Sidebar braucht — nur den
// Theme-Provider für die CSS-Variablen.
function detectPinOverlay() {
  if (typeof window === 'undefined') return null;
  try {
    const hash = window.location.hash || '';
    const m = hash.match(/#\/pin-overlay\/([^?&#/]+)/);
    if (m) return decodeURIComponent(m[1]);
    const path = window.location.pathname || '';
    const m2 = path.match(/\/pin-overlay\/([^?&#/]+)/);
    if (m2) return decodeURIComponent(m2[1]);
  } catch { /* ignore */ }
  return null;
}

export default function App() {
  // Popout-Fenster: nur das Sheet selbst, kein Update-Banner oder
  // ähnliche globale Overlays. Diese laufen weiter im Hauptfenster.
  const { isPopout } = usePwaMobile();
  const pinOverlayId = detectPinOverlay();
  if (pinOverlayId) {
    return (
      <ThemeProvider>
        <PinOverlayPage id={pinOverlayId} />
      </ThemeProvider>
    );
  }
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthGate>
          <PinnedTooltipsProvider>
            <Router />
            {!isPopout && <UpdateChecker />}
          </PinnedTooltipsProvider>
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  );
}
