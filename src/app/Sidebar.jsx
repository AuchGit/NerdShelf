// src/app/Sidebar.jsx
import { NavLink } from 'react-router-dom';
import { useAuth } from '../core/auth/AuthContext';
import IconButton from '../shared/ui/IconButton';

const NAV = [
  { to: '/dnd', label: 'DnD', icon: '⚔' },
  { to: '/mtg', label: 'MTG', icon: '✦' },
];

/**
 * variant: 'full' | 'compact'
 * onNavigate: optional callback fired when a nav link is clicked (used to close overlay).
 */
export default function Sidebar({ onOpenSettings, onOpenBugReport, variant = 'full', onNavigate }) {
  const { user, signOut } = useAuth();
  const compact = variant === 'compact';

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
    justifyContent: compact ? 'center' : 'flex-start',
  });

  return (
    <aside style={{
      width: compact ? 60 : 240,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-bg-elevated)',
      borderRight: '1px solid var(--color-border)',
      transition: 'width 200ms ease-out',
      height: '100%',
    }}>
      <div style={{
        padding: compact ? 'var(--space-4) var(--space-2)' : 'var(--space-5) var(--space-4) var(--space-4)',
        fontSize: compact ? 'var(--fs-md)' : 'var(--fs-lg)',
        fontWeight: 'var(--fw-bold)',
        letterSpacing: 0.3,
        textAlign: compact ? 'center' : 'left',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}>
        {compact ? 'NS' : 'NerdShelf'}
      </div>

      <nav style={{ flex: 1, padding: 'var(--space-2)', overflowY: 'auto' }}>
        {NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            style={linkStyle}
            onClick={onNavigate}
            title={compact ? item.label : undefined}
            aria-label={item.label}
          >
            <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
            {!compact && <span>{item.label}</span>}
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
          justifyContent: compact ? 'center' : 'flex-start',
        }}
        title={compact ? (user?.email || 'Nicht angemeldet') : undefined}
        >
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
          {!compact && (
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
          )}
        </div>

        <div style={{
          display: 'flex',
          gap: 'var(--space-1)',
          flexDirection: compact ? 'column' : 'row',
        }}>
          <IconButton onClick={onOpenSettings} title="Einstellungen" style={{ flex: 1 }}>⚙</IconButton>
          <IconButton onClick={onOpenBugReport} title="Bug melden" style={{ flex: 1 }}>⚐</IconButton>
          <DangerIconButton onClick={signOut} title="Abmelden" style={{ flex: 1 }}>⎋</DangerIconButton>
        </div>
      </div>
    </aside>
  );
}

function DangerIconButton({ style, children, ...rest }) {
  return (
    <button
      style={{
        height: 32,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        color: 'var(--color-danger, #cc3333)',
        border: '1px solid transparent',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'background var(--transition), color var(--transition)',
        fontSize: 16,
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--color-danger, #cc3333)';
        e.currentTarget.style.color = '#fff';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--color-danger, #cc3333)';
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
