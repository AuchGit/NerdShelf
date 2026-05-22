import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/utils/helpers';

const Select = forwardRef(function Select(
  { label, error, hint, options = [], placeholder, className, containerClassName, ...props },
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
        <select
          ref={ref}
          id={id}
          className={cn(
            'w-full appearance-none rounded-lg border bg-white dark:bg-slate-900 px-3 py-2 pr-9 text-sm',
            'text-slate-900 dark:text-slate-100',
            'border-slate-300 dark:border-slate-600',
            'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500',
            'dark:focus:ring-brand-400 dark:focus:border-brand-400',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-colors duration-150 cursor-pointer',
            error && 'border-red-500 focus:ring-red-500',
            className
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) =>
            typeof opt === 'string' ? (
              <option key={opt} value={opt}>{opt}</option>
            ) : (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            )
          )}
        </select>

        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          size={15}
        />
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {!error && hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
});

export default Select;
