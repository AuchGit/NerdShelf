// src/app/Layout.jsx
import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import Sidebar from './Sidebar';
import SettingsModal from './settings/SettingsModal';
import BugReportModal from '../core/bug-report/BugReportModal';

export default function Layout() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--color-bg)' }}>
      <Sidebar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenBugReport={() => setBugOpen(true)}
      />
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        <Outlet />
      </main>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <BugReportModal open={bugOpen} onClose={() => setBugOpen(false)} />
    </div>
  );
}