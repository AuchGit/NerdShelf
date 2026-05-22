import { cn } from '@/utils/helpers';

const VARIANTS = {
  default:  'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
  primary:  'bg-brand-100 dark:bg-brand-950 text-brand-700 dark:text-brand-300',
  success:  'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
  warning:  'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
  danger:   'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300',
  info:     'bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300',
};

const SIZES = {
  sm: 'text-xs px-1.5 py-0.5 rounded',
  md: 'text-xs px-2 py-1 rounded-md font-medium',
  lg: 'text-sm px-2.5 py-1 rounded-md font-medium',
};

export default function Badge({ variant = 'default', size = 'md', dot = false, className, children }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        VARIANTS[variant] ?? VARIANTS.default,
        SIZES[size] ?? SIZES.md,
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            'inline-block w-1.5 h-1.5 rounded-full',
            variant === 'success' && 'bg-emerald-500',
            variant === 'warning' && 'bg-amber-500',
            variant === 'danger'  && 'bg-red-500',
            variant === 'primary' && 'bg-brand-500',
            variant === 'info'    && 'bg-sky-500',
            variant === 'default' && 'bg-slate-500',
          )}
        />
      )}
      {children}
    </span>
  );
}
