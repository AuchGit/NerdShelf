import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import AuthLayout from '@/components/layout/AuthLayout';
import AppLayout  from '@/components/layout/AppLayout';
import { RequireAuth, RequireAdmin, RedirectIfAuthenticated } from './guards';

import LoginPage          from '@/pages/auth/LoginPage';
import SignupPage         from '@/pages/auth/SignupPage';
import PendingPage        from '@/pages/auth/PendingPage';
import DashboardPage      from '@/pages/dashboard/DashboardPage';
import DatabasePage       from '@/pages/database/DatabasePage';
import AdminPage          from '@/pages/admin/AdminPage';
import BugReportsPage     from '@/pages/bugreports/BugReportsPage';
import SettingsPage       from '@/pages/settings/SettingsPage';
import CampaignsAdminPage from '@/pages/campaigns/CampaignsAdminPage';
import ActivityPage       from '@/pages/activity/ActivityPage';
import HealthPage         from '@/pages/health/HealthPage';

function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="font-display text-8xl font-extrabold text-slate-100 dark:text-slate-800">404</h1>
      <a href="/dashboard" className="text-sm text-brand-600 hover:underline">← Dashboard</a>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  {
    element: <AuthLayout />,
    children: [
      { path: '/auth/login',  element: <RedirectIfAuthenticated><LoginPage /></RedirectIfAuthenticated> },
      { path: '/auth/signup', element: <RedirectIfAuthenticated><SignupPage /></RedirectIfAuthenticated> },
      { path: '/pending',     element: <PendingPage /> },
    ],
  },
  {
    element: <RequireAuth><AppLayout /></RequireAuth>,
    children: [
      { path: '/dashboard',  element: <DashboardPage /> },
      { path: '/database',   element: <DatabasePage /> },
      { path: '/activity',   element: <ActivityPage /> },
      { path: '/bugreports', element: <BugReportsPage /> },
      { path: '/settings',   element: <SettingsPage /> },
      { path: '/users',      element: <RequireAdmin><AdminPage /></RequireAdmin> },
      { path: '/admin',      element: <RequireAdmin><AdminPage /></RequireAdmin> },
      { path: '/campaigns',  element: <RequireAdmin><CampaignsAdminPage /></RequireAdmin> },
      { path: '/health',     element: <RequireAdmin><HealthPage /></RequireAdmin> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
