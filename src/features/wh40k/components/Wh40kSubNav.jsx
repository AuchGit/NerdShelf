// src/features/wh40k/components/Wh40kSubNav.jsx
//
// Sub-navigation strip rendered inside the wh40k section. Mirrors the
// "section header" feel used elsewhere in the app — a row of tab-styled
// NavLinks underlined by the page-content border.

import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/wh40k',           label: 'Armeen',     end: true },
  { to: '/wh40k/units',     label: 'Einheiten' },
  { to: '/wh40k/combat',    label: 'Combat'    },
  { to: '/wh40k/favorites', label: 'Favoriten' },
  { to: '/wh40k/inventory', label: 'Sammlung'  },
];

export default function Wh40kSubNav() {
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
