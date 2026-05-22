// src/shared/ui/BottomNav.jsx
//
// PWA-mobile bottom tab bar. Only rendered by Layout when usePwaMobile()
// reports we're in PWA-mobile mode — so desktop keeps the side nav, narrow
// browser windows on desktop keep the hamburger overlay, and only the
// actually-installed phone PWA flips to this layout.
//
// Five slots: DnD, MTG, WH40K, plus a "More" slot that opens an action
// sheet with settings / bug report / sign-out (the same actions that live
// at the bottom of the desktop sidebar).

import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../core/auth/AuthContext';
import ActionSheet from './ActionSheet';

const NAV = [
  { to: '/dnd',   label: 'DnD',   icon: '⚔' },
  { to: '/mtg',   label: 'MTG',   icon: '✦' },
  { to: '/wh40k', label: 'WH40k', icon: 'Ω' },
];

export default function BottomNav({ onOpenSettings, onOpenBugReport, onOpenCalendar, calendarNotif }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { signOut, user } = useAuth();
  const location = useLocation();

  // Highlight active section. NavLink's own `isActive` only matches the
  // exact path; we want /mtg, /mtg/wishlist, /mtg/match all to highlight
  // the MTG tab.
  const sectionActive = (to) => {
    if (to === '/') return location.pathname === '/';
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  };

  return (
    <>
      <nav className="pwa-bottom-nav" aria-label="Hauptnavigation">
        {NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={`pwa-bottom-nav-item ${sectionActive(item.to) ? 'is-active' : ''}`}
            aria-label={item.label}
          >
            <span className="pwa-bn-icon" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className="pwa-bottom-nav-item"
          onClick={() => setMoreOpen(true)}
          aria-label="Mehr Optionen"
          style={{ position: 'relative' }}
        >
          <span className="pwa-bn-icon" aria-hidden="true">⋯</span>
          <span>Mehr</span>
          {(calendarNotif?.today || calendarNotif?.tomorrow) && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute', top: 6, right: 'calc(50% - 14px)',
                width: 8, height: 8, borderRadius: '50%',
                background: calendarNotif.today ? 'var(--color-danger)' : 'var(--color-warning)',
                boxShadow: '0 0 0 1.5px var(--color-bg-elevated)',
                pointerEvents: 'none',
              }}
            />
          )}
        </button>
      </nav>

      <ActionSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title={user?.email || 'Optionen'}
        items={[
          { id: 'calendar', label: 'Kalender', icon: '▦',
            onSelect: () => { setMoreOpen(false); onOpenCalendar?.(); } },
          { id: 'settings', label: 'Einstellungen', icon: '⚙',
            onSelect: () => { setMoreOpen(false); onOpenSettings?.(); } },
          { id: 'bug', label: 'Bug melden', icon: '⚐',
            onSelect: () => { setMoreOpen(false); onOpenBugReport?.(); } },
          { id: 'logout', label: 'Abmelden', icon: '⎋', danger: true,
            onSelect: () => { setMoreOpen(false); signOut(); } },
        ]}
      />
    </>
  );
}
