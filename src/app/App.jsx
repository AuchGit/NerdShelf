// src/app/App.jsx
import { AuthProvider } from '../core/auth/AuthContext';
import AuthGate from '../core/auth/AuthGate';
import { ThemeProvider } from '../core/theme/ThemeProvider';
import { setupErrorCollector } from '../core/bug-report/collector';
import UpdateChecker from '../core/updater/UpdateChecker';
import Router from './Router';
import '../core/theme/theme.css';

setupErrorCollector();

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthGate>
          <Router />
          <UpdateChecker />
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  );
}
