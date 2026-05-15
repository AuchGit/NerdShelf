// src/features/mtg/deck-builder/components/MtgSubNav.jsx
//
// Sub-navigation strip for the MTG section. Mirrors the WH40k sub-nav
// (same styles, same spacing, same NavLink behaviour) so the two systems
// feel like one platform. Rendered inside Layout's <main> at the top of
// the MTG pages that participate in this hub:
//
//   /mtg              Decks dashboard
//   /mtg/wishlist     Auto-computed missing cards across decks
//   /mtg/inventory    User-owned cards (shared inventory, domain='mtg')
//   /mtg/favorites    Starred cards
//
// Intentionally NOT rendered inside the deck builder route
// (/mtg/deck/:id) — that page has its own header chrome.

import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/mtg',           label: 'Decks',     end: true },
  { to: '/mtg/wishlist',  label: 'Wunschliste' },
  { to: '/mtg/inventory', label: 'Sammlung' },
  { to: '/mtg/favorites', label: 'Favoriten' },
];

export default function MtgSubNav() {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-1)',
        padding: 'var(--space-3) var(--space-5) 0',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
        position: 'sticky',
        top: 0,
        zIndex: 5,
      }}
    >
      {TABS.map(tab => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          style={({ isActive }) => ({
            padding: 'var(--space-2) var(--space-3)',
            fontSize: 'var(--fs-md)',
            fontWeight: isActive ? 'var(--fw-semibold)' : 'var(--fw-medium)',
            color: isActive ? 'var(--color-text)' : 'var(--color-text-muted)',
            textDecoration: 'none',
            borderBottom: `2px solid ${isActive ? 'var(--color-accent)' : 'transparent'}`,
            marginBottom: -1,
            transition: 'color var(--transition), border-color var(--transition)',
          })}
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
