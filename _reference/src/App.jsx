import { createContext, useContext, useState, useCallback } from 'react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider }  from '@/contexts/AuthContext';
import { useAuth }       from '@/contexts/AuthContext';
import AppRouter         from '@/router';
import ToastContainer    from '@/components/ui/ToastContainer';
import { useTauriNotifications } from '@/hooks/useTauriNotifications';

// ─── Global refresh context ───────────────────────────────────────────────────
// Lets any page subscribe to background-poll data updates.

export const RefreshContext = createContext({
  lastPollData: null,
  triggerRefresh: () => {},
});

export function useRefreshContext() {
  return useContext(RefreshContext);
}

// ─── Inner wrapper — has auth + provides refresh context ──────────────────────

function AppCore() {
  const { isAuthenticated } = useAuth();
  const [lastPollData, setLastPollData] = useState(null);

  // Called by the polling hook whenever fresh data arrives
  const handleRefresh = useCallback((data) => {
    setLastPollData({ ...data, ts: Date.now() });
  }, []);

  const { poll: triggerRefresh } = useTauriNotifications({
    enabled:   isAuthenticated,
    onRefresh: handleRefresh,
  });

  return (
    <RefreshContext.Provider value={{ lastPollData, triggerRefresh }}>
      <AppRouter />
      <ToastContainer />
    </RefreshContext.Provider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppCore />
      </AuthProvider>
    </ThemeProvider>
  );
}
