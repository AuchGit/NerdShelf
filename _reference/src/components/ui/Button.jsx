import { forwardRef } from 'react';
import { cn } from '@/utils/helpers';
import Spinner from './Spinner';

const VARIANTS = {
  primary:   'bg-brand-600 hover:bg-brand-700 text-white shadow-sm hover:shadow-glow-sm focus-ring',
  secondary: 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 focus-ring',
  danger:    'bg-red-600 hover:bg-red-700 text-white shadow-sm focus-ring',
  ghost:     'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 focus-ring',
  outline:   'border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 focus-ring',
  link:      'text-brand-600 dark:text-brand-400 hover:underline underline-offset-2 p-0 h-auto font-medium',
};

const SIZES = {
  xs: 'h-7  px-2.5 text-xs  gap-1.5',
  sm: 'h-8  px-3   text-sm  gap-2',
  md: 'h-9  px-4   text-sm  gap-2',
  lg: 'h-11 px-6   text-base gap-2.5',
  xl: 'h-12 px-8   text-base gap-3',
};

const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    className,
    children,
    ...props
  },
  ref
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      className={cn(
        'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 select-none',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
        VARIANTS[variant] ?? VARIANTS.primary,
        variant !== 'link' && (SIZES[size] ?? SIZES.md),
        fullWidth && 'w-full',
        className
      )}
      {...props}
    >
      {loading ? (
        <Spinner size="sm" />
      ) : leftIcon ? (
        <span className="shrink-0">{leftIcon}</span>
      ) : null}

      {children && <span>{children}</span>}

      {!loading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </button>
  );
});

export default Button;
