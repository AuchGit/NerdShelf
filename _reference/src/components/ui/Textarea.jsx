import { forwardRef } from 'react';
import { cn } from '@/utils/helpers';

const Textarea = forwardRef(function Textarea(
  { label, error, hint, className, containerClassName, rows = 4, ...props },
  ref
) {
  const id = props.id ?? props.name;

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      {label && (
        <label
          htmlFor={id}
          className="text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          {label}
          {props.required && <span className="ml-1 text-red-500">*</span>}
        </label>
      )}

      <textarea
        ref={ref}
        id={id}
        rows={rows}
        className={cn(
          'w-full rounded-lg border bg-white dark:bg-slate-900 px-3 py-2 text-sm',
          'text-slate-900 dark:text-slate-100',
          'placeholder:text-slate-400 dark:placeholder:text-slate-500',
          'border-slate-300 dark:border-slate-600',
          'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500',
          'dark:focus:ring-brand-400 dark:focus:border-brand-400',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50 dark:disabled:bg-slate-800',
          'resize-y transition-colors duration-150',
          error && 'border-red-500 focus:ring-red-500 dark:border-red-500',
          className
        )}
        {...props}
      />

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {!error && hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
});

export default Textarea;
