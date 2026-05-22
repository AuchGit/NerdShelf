import { Menu, Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import useStore from '@/store/useStore';
import { cn } from '@/utils/helpers';

export default function Topbar() {
  const { toggleSidebar } = useStore();
  const { theme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-950/90 backdrop-blur-sm px-4">
      {/* Mobile hamburger */}
      <button
        onClick={toggleSidebar}
        className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
        aria-label="Toggle sidebar"
      >
        <Menu size={18} />
      </button>

      <div className="flex-1" />

      {/* Theme switcher */}
      <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-900">
        {[
          { value: 'light',  icon: Sun,     label: 'Light mode'  },
          { value: 'system', icon: Monitor, label: 'System mode' },
          { value: 'dark',   icon: Moon,    label: 'Dark mode'   },
        ].map(({ value, icon: Icon, label }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            aria-label={label}
            className={cn(
              'p-1.5 rounded-md transition-all duration-150',
              theme === value
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
            )}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>
    </header>
  );
}
