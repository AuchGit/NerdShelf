import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Database, Settings,
  LogOut, ChevronLeft, ChevronRight, Shield, Bug
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import useStore from '@/store/useStore';
import Avatar from '@/components/ui/Avatar';
import { cn } from '@/utils/helpers';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/database',  label: 'Datenbank',  icon: Database },
  { to: '/users',     label: 'Users',       icon: Users },
  { to: '/bugreports',label: 'Bug Reports', icon: Bug },
];

const BOTTOM_ITEMS = [
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const { profile, signOut, isAdmin } = useAuth();
  const { sidebarOpen, toggleSidebar } = useStore();
  const navigate = useNavigate();

  const handleSignOut = async () => { await signOut(); navigate('/auth/login'); };

  return (
    <>
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 backdrop-blur-sm lg:hidden" onClick={toggleSidebar} />
      )}
      <aside className={cn(
        'fixed top-0 left-0 z-30 h-full flex flex-col border-r border-slate-200 dark:border-slate-800',
        'bg-white dark:bg-slate-950 transition-all duration-300',
        sidebarOpen ? 'w-60' : 'w-16',
        !sidebarOpen && 'max-lg:-translate-x-full lg:translate-x-0'
      )}>
        {/* Logo */}
        <div className={cn('flex items-center h-14 px-4 border-b border-slate-200 dark:border-slate-800 shrink-0', !sidebarOpen && 'justify-center px-0')}>
          {sidebarOpen ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white font-bold text-sm shrink-0">S</div>
              <span className="font-display font-extrabold text-slate-900 dark:text-white truncate">SupaManager</span>
            </div>
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white font-bold text-sm">S</div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <SidebarLink key={to} to={to} label={label} icon={Icon} collapsed={!sidebarOpen} />
          ))}
          {isAdmin && (
            <>
              <div className={cn('my-2 px-1', !sidebarOpen && 'px-0')}>
                {sidebarOpen
                  ? <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-600 px-2">Admin</p>
                  : <div className="border-t border-slate-200 dark:border-slate-800 my-1" />}
              </div>
              <SidebarLink to="/admin" label="Admin Panel" icon={Shield} collapsed={!sidebarOpen} />
            </>
          )}
        </nav>

        {/* Bottom */}
        <div className="shrink-0 border-t border-slate-200 dark:border-slate-800 py-3 px-2 space-y-0.5">
          {BOTTOM_ITEMS.map(({ to, label, icon: Icon }) => (
            <SidebarLink key={to} to={to} label={label} icon={Icon} collapsed={!sidebarOpen} />
          ))}
          <div className={cn('flex items-center gap-2.5 rounded-lg px-2 py-2 mt-1', !sidebarOpen && 'justify-center px-0')}>
            <Avatar name={profile?.email} size="sm" />
            {sidebarOpen && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{profile?.email}</p>
                  {isAdmin && <p className="text-[10px] text-brand-500 font-semibold">Admin</p>}
                </div>
                <button onClick={handleSignOut} title="Abmelden"
                  className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600 dark:hover:text-red-400 transition-colors">
                  <LogOut size={15} />
                </button>
              </>
            )}
          </div>
        </div>

        <button onClick={toggleSidebar}
          className="absolute -right-3 top-[52px] flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm max-lg:hidden">
          {sidebarOpen ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
        </button>
      </aside>
    </>
  );
}

function SidebarLink({ to, label, icon: Icon, collapsed }) {
  return (
    <NavLink to={to} title={collapsed ? label : undefined}
      className={({ isActive }) => cn('nav-link', isActive && 'active', collapsed && 'justify-center px-0 py-2')}>
      <Icon size={18} className="shrink-0" />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );
}
