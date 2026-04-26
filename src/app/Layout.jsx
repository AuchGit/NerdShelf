// src/app/Layout.jsx
import { Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import SettingsModal from './settings/SettingsModal';
import BugReportModal from '../core/bug-report/BugReportModal';
import useWindowWidth from '../shared/hooks/useWindowWidth';

export default function Layout() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const { mode } = useWindowWidth();

  // Auto-close overlay if window grows back into compact/full mode
  useEffect(() => {
    if (mode !== 'hidden' && overlayOpen) setOverlayOpen(false);
  }, [mode, overlayOpen]);

  // ESC closes overlay
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
  };

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
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <BugReportModal open={bugOpen} onClose={() => setBugOpen(false)} />
    </div>
  );
}
