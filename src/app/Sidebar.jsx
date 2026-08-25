// src/app/Sidebar.jsx
import { NavLink } from 'react-router-dom';
import { useAuth } from '../core/auth/AuthContext';
import IconButton from '../shared/ui/IconButton';
import { openHandbook } from '../shared/help/openHandbook';

const NAV = [
  { to: '/dnd',   label: 'DnD',   icon: '⚔' },
  { to: '/mtg',   label: 'MTG',   icon: '✦' },
  { to: '/wh40k', label: 'WH40k', icon: 'Ω' },
];

/**
 * variant:    'full' | 'compact'
 * onNavigate: optional callback fired when a nav link is clicked (used to close overlay).
 * onToggle:   optional — wenn gesetzt, zeigen wir einen Chevron-Knopf
 *             oben in der Sidebar, der zwischen full/compact toggled.
 */
export default function Sidebar({ onOpenSettings, onOpenBugReport, onOpenCalendar, calendarNotif, variant = 'full', onNavigate, onToggle }) {
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: compact ? 'center' : 'space-between',
        gap: 6,
      }}>
        <span>{compact ? 'NS' : 'NerdShelf'}</span>
        {onToggle && (
          // Chevron-Toggle. Beim Full-Modus zeigt's "‹" (collapse), beim
          // Compact-Modus "›" (expand). Persistiert per useSidebarMode.
          // Bei Compact + sehr schmalem Fenster geht "›" auf Overlay-
          // Drawer auf, sodass User auch da seine volle Sidebar bekommt.
          <button
            type="button"
            onClick={onToggle}
            title={compact ? 'Sidebar ausklappen' : 'Sidebar einklappen'}
            aria-label={compact ? 'Sidebar ausklappen' : 'Sidebar einklappen'}
            style={{
              width: 22, height: 22, padding: 0,
              borderRadius: 6,
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 14, lineHeight: 1, fontFamily: 'inherit',
              flexShrink: 0,
            }}
          >{compact ? '›' : '‹'}</button>
        )}
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
          <div style={{ flex: 1, position: 'relative' }}>
            <IconButton onClick={onOpenCalendar} title="Kalender" style={{ width: '100%' }}>▦</IconButton>
            {(calendarNotif?.today || calendarNotif?.tomorrow) && (
              <span
                aria-hidden="true"
                title={calendarNotif.today ? 'Heute ist ein Termin' : 'Morgen ist ein Termin'}
                style={{
                  position: 'absolute', top: 4, right: 4,
                  width: 8, height: 8, borderRadius: '50%',
                  background: calendarNotif.today ? 'var(--color-danger)' : 'var(--color-warning)',
                  boxShadow: '0 0 0 1.5px var(--color-bg-elevated)',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
          {/* Handbuch: öffnet public/handbuch.html (eigenes Fenster in der
              Tauri-Shell, sonst neuer Tab) direkt beim Kapitel zur aktuellen
              Seite — siehe shared/help/openHandbook.js. */}
          <IconButton onClick={() => openHandbook()} title="Handbuch" style={{ flex: 1 }}>?</IconButton>
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
