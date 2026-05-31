// src/app/Layout.jsx
import { Outlet } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import Sidebar from './Sidebar';
import useCalendarNotification from './calendar/useCalendarNotification';
import { BottomNav } from '../shared/ui';
import useSidebarMode, { nextSidebarPref } from '../shared/hooks/useSidebarMode';
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
  const calendarNotif = useCalendarNotification(calendarReloadKey);
  const { userPref, setUserPref, effective, overlay } = useSidebarMode();
  const { isPwaMobile, isPopout } = usePwaMobile();

  // ESC schließt den Overlay-Drawer wenn aufgeklappt.
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e) => { if (e.key === 'Escape') setUserPref('collapsed'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay, setUserPref]);

  const toggleSidebar = () => setUserPref(nextSidebarPref(userPref, effective));

  const sidebarProps = {
    onOpenSettings: () => { setSettingsOpen(true); if (overlay) setUserPref('collapsed'); },
    onOpenBugReport: () => { setBugOpen(true); if (overlay) setUserPref('collapsed'); },
    onOpenCalendar: () => { setCalendarOpen(true); if (overlay) setUserPref('collapsed'); },
    calendarNotif,
    onToggle: toggleSidebar,
  };

  const closeCalendar = () => { setCalendarOpen(false); setCalendarReloadKey(k => k + 1); };

  // Popout-Modus: ein separat gespawntes Tauri-Fenster (alwaysOnTop,
  // borderless) das nur das Sheet im PWA-Layout zeigt — gedacht als
  // Overlay neben einem VTT. Hier keine App-Sidebar, kein BottomNav,
  // keine Modals — pure Sheet-View.
  if (isPopout) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--color-bg)' }}>
        <main style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          <Outlet />
        </main>
      </div>
    );
  }

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

  // Layout-Komposition:
  //   • Rail = die kompakte 60px-Sidebar. IMMER inline gemountet (auch
  //     bei sehr schmalen Fenstern, ersetzt den alten Hamburger).
  //   • Drawer = die ausgeklappte 240px-Sidebar. Bei autoMode === 'hidden'
  //     wird sie ALS OVERLAY über dem Content gerendert, sonst inline
  //     (verdrängt die Rail). Klick auf Backdrop oder ESC collapsed wieder.
  const showDrawerInline = effective === 'full' && !overlay;
  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--color-bg)' }}>
      {/* Inline-Rail: compact zeigt immer, full nur wenn nicht Overlay. */}
      {!showDrawerInline && (
        <Sidebar variant="compact" {...sidebarProps} />
      )}
      {showDrawerInline && (
        <Sidebar variant="full" {...sidebarProps} />
      )}

      {/* Overlay-Drawer: bei schmalem Fenster + effective === 'full'.
          Backdrop schließt durch Click. */}
      {overlay && (
        <>
          <div
            onClick={() => setUserPref('collapsed')}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.4)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              zIndex: 999,
            }}
          />
          <div style={{
            position: 'fixed', top: 0, left: 0, height: '100vh',
            zIndex: 1000,
            boxShadow: 'var(--shadow-lg, 0 8px 32px rgba(0,0,0,0.3))',
          }}>
            <Sidebar
              variant="full"
              {...sidebarProps}
              onNavigate={() => setUserPref('collapsed')}
            />
          </div>
        </>
      )}

      <main style={{
        flex: 1,
        overflow: 'auto',
        minWidth: 0,
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
