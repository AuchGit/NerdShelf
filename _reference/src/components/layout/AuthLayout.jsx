import { Outlet } from 'react-router-dom';

export default function AuthLayout() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-surface-dark flex items-center justify-center p-4">
      {/* Decorative grid background */}
      <div
        className="fixed inset-0 pointer-events-none opacity-50 dark:opacity-30"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' width='32' height='32' fill='none' stroke='%23cbd5e1'%3e%3cpath d='M0 .5H31.5V32'/%3e%3c/svg%3e")`,
        }}
      />
      {/* Glow blob */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-brand-500/20 blur-[100px] pointer-events-none" />

      <div className="relative w-full max-w-md animate-fade-in">
        {/* Branding */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white font-bold text-lg shadow-glow">
            N
          </div>
          <span className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">
            NerdTools
          </span>
        </div>

        <Outlet />

        <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-600">
          Nerd Tools Platform · Built with ❤️ and React
        </p>
      </div>
    </div>
  );
}
