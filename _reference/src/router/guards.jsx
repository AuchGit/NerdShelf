import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Spinner from '@/components/ui/Spinner';

// ─── Full-screen loader ───────────────────────────────────────────────────────
function FullPageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-surface-dark">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" />
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      </div>
    </div>
  );
}

// ─── RequireAuth ──────────────────────────────────────────────────────────────
/**
 * Wraps routes that require an authenticated & approved user.
 * - Initializing → spinner
 * - Unauthenticated → redirect to /auth/login
 * - Pending approval → redirect to /pending
 */
export function RequireAuth({ children }) {
  const { isInitializing, status } = useAuth();
  const location = useLocation();

  if (isInitializing) return <FullPageSpinner />;

  if (status === 'unauthenticated') {
    return <Navigate to="/auth/login" state={{ from: location }} replace />;
  }

  if (status === 'pending_approval') {
    return <Navigate to="/pending" replace />;
  }

  return children;
}

// ─── RequireAdmin ─────────────────────────────────────────────────────────────
/**
 * Wraps routes that require is_admin = true.
 */
export function RequireAdmin({ children }) {
  const { isAdmin, isInitializing, status } = useAuth();
  const location = useLocation();

  if (isInitializing) return <FullPageSpinner />;

  if (status === 'unauthenticated') {
    return <Navigate to="/auth/login" state={{ from: location }} replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

// ─── RedirectIfAuthenticated ──────────────────────────────────────────────────
/**
 * Used on auth pages (login, signup).
 * If the user is already logged in and approved → redirect to /dashboard.
 */
export function RedirectIfAuthenticated({ children }) {
  const { isInitializing, status } = useAuth();

  if (isInitializing) return <FullPageSpinner />;

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  if (status === 'pending_approval') {
    return <Navigate to="/pending" replace />;
  }

  return children;
}
