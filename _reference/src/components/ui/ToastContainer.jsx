import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/utils/helpers';
import useStore from '@/store/useStore';

const ICONS = {
  success: <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />,
  error:   <XCircle      size={16} className="text-red-500    shrink-0" />,
  warning: <AlertTriangle size={16} className="text-amber-500 shrink-0" />,
  info:    <Info          size={16} className="text-sky-500   shrink-0" />,
};

const BORDERS = {
  success: 'border-l-emerald-500',
  error:   'border-l-red-500',
  warning: 'border-l-amber-500',
  info:    'border-l-sky-500',
};

function Toast({ id, type, message }) {
  const removeToast = useStore((s) => s.removeToast);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger CSS animation on mount
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3 rounded-lg border border-l-4 shadow-lg',
        'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700',
        'text-slate-800 dark:text-slate-200 text-sm',
        'transition-all duration-300',
        BORDERS[type] ?? BORDERS.info,
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      )}
      role="alert"
    >
      {ICONS[type] ?? ICONS.info}
      <p className="flex-1 leading-snug">{message}</p>
      <button
        onClick={() => removeToast(id)}
        className="shrink-0 -mr-1 -mt-0.5 p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** Renders the global toast queue. Mount once at app root. */
export default function ToastContainer() {
  const toasts = useStore((s) => s.toasts);

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 w-full max-w-sm pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast {...t} />
        </div>
      ))}
    </div>
  );
}
