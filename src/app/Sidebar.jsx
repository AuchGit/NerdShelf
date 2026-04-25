// src/app/Sidebar.jsx
import { NavLink } from 'react-router-dom';
import { useAuth } from '../core/auth/AuthContext';
import IconButton from '../shared/ui/IconButton';

const NAV = [
  { to: '/dnd', label: 'DnD', icon: '⚔' },
  { to: '/mtg', label: 'MTG', icon: '✦' },
];

export default function Sidebar({ onOpenSettings, onOpenBugReport }) {
  const { user, signOut } = useAuth();

  const linkStyle = ({ isActive }) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-2) var(--space-3)',
    marginBottom: 2,
    borderRadius: 'var(--radius-md)',
    textDecoration: 'none',
    color: isActive ? 'var(--color-text)' : 'var(--color-text-muted)',
    background: isActive ? 'var(--color-surface-hover)' : 'transparent',
    fontSize: 'var(--fs-md)',
    fontWeight: isActive ? 'var(--fw-semibold)' : 'var(--fw-medium)',
    transition: 'background var(--transition), color var(--transition)',
  });

  return (
    <aside style={{
      width: 240,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-bg-elevated)',
      borderRight: '1px solid var(--color-border)',
    }}>
      <div style={{
        padding: 'var(--space-5) var(--space-4) var(--space-4)',
        fontSize: 'var(--fs-lg)',
        fontWeight: 'var(--fw-bold)',
        letterSpacing: 0.3,
      }}>
        NerdShelf
      </div>

      <nav style={{ flex: 1, padding: 'var(--space-2)', overflowY: 'auto' }}>
        {NAV.map(item => (
          <NavLink key={item.to} to={item.to} style={linkStyle}>
            <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div style={{
        padding: 'var(--space-3)',
        borderTop: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-2)',
          minWidth: 0,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'var(--color-accent)',
            color: 'var(--color-accent-contrast)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)',
            flexShrink: 0,
          }}>
            {(user?.email || '?').charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 'var(--fs-sm)',
              color: 'var(--color-text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {user?.email || 'Nicht angemeldet'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          <IconButton onClick={onOpenSettings} title="Einstellungen" style={{ flex: 1 }}>⚙</IconButton>
          <IconButton onClick={onOpenBugReport} title="Bug melden" style={{ flex: 1 }}>🐛</IconButton>
          <IconButton onClick={signOut} title="Abmelden" style={{ flex: 1 }}>⎋</IconButton>
        </div>
      </div>
    </aside>
  );
}