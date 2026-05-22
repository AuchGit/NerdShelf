import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import useStore from '@/store/useStore';
import { cn } from '@/utils/helpers';

export default function AppLayout() {
  const sidebarOpen = useStore((s) => s.sidebarOpen);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0a0d14] flex">
      <Sidebar />

      {/* Main content */}
      <div
        className={cn(
          'flex flex-col flex-1 min-w-0 transition-all duration-300',
          // Offset for sidebar width on large screens
          sidebarOpen ? 'lg:ml-60' : 'lg:ml-16'
        )}
      >
        <Topbar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 animate-fade-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
