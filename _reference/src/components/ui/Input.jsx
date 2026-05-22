import { forwardRef } from 'react';
import { cn } from '@/utils/helpers';

const Input = forwardRef(function Input(
  {
    label,
    error,
    hint,
    leftElement,
    rightElement,
    className,
    containerClassName,
    ...props
  },
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

      <div className="relative">
        {leftElement && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 dark:text-slate-500">
            {leftElement}
          </div>
        )}

        <input
          ref={ref}
          id={id}
          className={cn(
            'w-full rounded-lg border bg-white dark:bg-slate-900 px-3 py-2 text-sm',
            'text-slate-900 dark:text-slate-100',
            'placeholder:text-slate-400 dark:placeholder:text-slate-500',
            'border-slate-300 dark:border-slate-600',
            'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500',
            'dark:focus:ring-brand-400 dark:focus:border-brand-400',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50 dark:disabled:bg-slate-800',
            'transition-colors duration-150',
            error && 'border-red-500 focus:ring-red-500 dark:border-red-500',
            leftElement  && 'pl-9',
            rightElement && 'pr-9',
            className
          )}
          {...props}
        />

        {rightElement && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 dark:text-slate-500">
            {rightElement}
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      {!error && hint && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      )}
    </div>
  );
});

export default Input;
