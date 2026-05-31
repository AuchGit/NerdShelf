// src/app/App.jsx
import { AuthProvider } from '../core/auth/AuthContext';
import AuthGate from '../core/auth/AuthGate';
import { ThemeProvider } from '../core/theme/ThemeProvider';
import { setupErrorCollector } from '../core/bug-report/collector';
import UpdateChecker from '../core/updater/UpdateChecker';
import Router from './Router';
import usePwaMobile from '../shared/hooks/usePwaMobile';
import '../core/theme/theme.css';

setupErrorCollector();

export default function App() {
  // Popout-Fenster: nur das Sheet selbst, kein Update-Banner oder
  // ähnliche globale Overlays. Diese laufen weiter im Hauptfenster.
  const { isPopout } = usePwaMobile();
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthGate>
          <Router />
          {!isPopout && <UpdateChecker />}
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  );
}
