import { cn } from '@/utils/helpers';

export default function EmptyState({ icon, title, description, action, className }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed',
        'border-slate-200 dark:border-slate-700 py-16 px-8 text-center',
        className
      )}
    >
      {icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500">
          {icon}
        </div>
      )}
      <div>
        <p className="font-display text-base font-bold text-slate-700 dark:text-slate-300">
          {title}
        </p>
        {description && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
