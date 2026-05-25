// src/app/Layout.jsx
import { Outlet } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import Sidebar from './Sidebar';
import useCalendarNotification from './calendar/useCalendarNotification';
import { BottomNav } from '../shared/ui';
import useWindowWidth from '../shared/hooks/useWindowWidth';
import usePwaMobile from '../shared/hooks/usePwaMobile';

// Lazy-load the three pop-up modals — they're rendered on every page but
// only mounted when the user actually opens them. Their JS chunks load
// on first open and then stay cached.
const SettingsModal  = lazy(() => import('./settings/SettingsModal'));
const BugReportModal = lazy(() => import('../core/bug-report/BugReportModal'));
const CalendarModal  = lazy(() => import('./calendar/CalendarModal'));

export default function Layout() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarReloadKey, setCalendarReloadKey] = useState(0);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const calendarNotif = useCalendarNotification(calendarReloadKey);
  const { mode } = useWindowWidth();
  const { isPwaMobile } = usePwaMobile();

  // Auto-close overlay if window grows back into compact/full mode.
  useEffect(() => {
    if (mode !== 'hidden' && overlayOpen) setOverlayOpen(false);
  }, [mode, overlayOpen]);

  // ESC closes overlay.
  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setOverlayOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlayOpen]);

  const sidebarVariant = mode === 'compact' ? 'compact' : 'full';
  const sidebarProps = {
    onOpenSettings: () => { setSettingsOpen(true); if (overlayOpen) setOverlayOpen(false); },
    onOpenBugReport: () => { setBugOpen(true); if (overlayOpen) setOverlayOpen(false); },
    onOpenCalendar: () => { setCalendarOpen(true); if (overlayOpen) setOverlayOpen(false); },
    calendarNotif,
  };

  const closeCalendar = () => { setCalendarOpen(false); setCalendarReloadKey(k => k + 1); };

  // Layout selection:
  //   - PWA on a phone → bottom tab bar, no sidebar. One-handed native feel.
  //   - Desktop / Tauri → existing sidebar at full or compact width.
  //   - Narrow desktop browser → existing hamburger overlay (unchanged).
  if (isPwaMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--color-bg)' }}>
        <main style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          <Outlet />
        </main>
        <BottomNav {...sidebarProps} />
        <Suspense fallback={null}>
          {settingsOpen && <SettingsModal open onClose={() => setSettingsOpen(false)} />}
          {bugOpen      && <BugReportModal open onClose={() => setBugOpen(false)} />}
          {calendarOpen && <CalendarModal open onClose={closeCalendar} />}
        </Suspense>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--color-bg)' }}>
      {mode !== 'hidden' && (
        <Sidebar variant={sidebarVariant} {...sidebarProps} />
      )}

      {mode === 'hidden' && (
        <>
          <button
            onClick={() => setOverlayOpen(v => !v)}
            aria-label="Menü öffnen"
            style={{
              position: 'fixed',
              top: 12,
              left: 12,
              zIndex: 1001,
              width: 40,
              height: 40,
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              boxShadow: 'var(--shadow-sm, 0 2px 8px rgba(0,0,0,0.15))',
            }}
          >
            ☰
          </button>

          {overlayOpen && (
            <div
              onClick={() => setOverlayOpen(false)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.4)',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
                zIndex: 999,
              }}
            />
          )}

          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              height: '100vh',
              zIndex: 1000,
              transform: overlayOpen ? 'translateX(0)' : 'translateX(-100%)',
              transition: 'transform 200ms ease-out',
              pointerEvents: overlayOpen ? 'auto' : 'none',
              boxShadow: overlayOpen ? 'var(--shadow-lg, 0 8px 32px rgba(0,0,0,0.3))' : 'none',
            }}
          >
            <Sidebar
              variant="full"
              {...sidebarProps}
              onNavigate={() => setOverlayOpen(false)}
            />
          </div>
        </>
      )}

      <main style={{
        flex: 1,
        overflow: 'auto',
        minWidth: 0,
        paddingTop: mode === 'hidden' ? 64 : 0,
      }}>
        <Outlet />
      </main>
      <Suspense fallback={null}>
        {settingsOpen && <SettingsModal open onClose={() => setSettingsOpen(false)} />}
        {bugOpen      && <BugReportModal open onClose={() => setBugOpen(false)} />}
        {calendarOpen && <CalendarModal open onClose={closeCalendar} />}
      </Suspense>
    </div>
  );
}
