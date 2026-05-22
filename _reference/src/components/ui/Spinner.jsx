import { cn } from '@/utils/helpers';

const SIZES = {
  xs: 'w-3 h-3 border',
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-[3px]',
  xl: 'w-12 h-12 border-4',
};

export default function Spinner({ size = 'md', className }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full animate-spin',
        'border-slate-300 dark:border-slate-600 border-t-brand-500 dark:border-t-brand-400',
        SIZES[size] ?? SIZES.md,
        className
      )}
      role="status"
      aria-label="Loading"
    />
  );
}
