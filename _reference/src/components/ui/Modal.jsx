import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/utils/helpers';
import Button from './Button';

const SIZES = {
  sm:   'max-w-sm',
  md:   'max-w-md',
  lg:   'max-w-lg',
  xl:   'max-w-xl',
  '2xl': 'max-w-2xl',
};

export default function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  closable = true,
  children,
  footer,
  className,
}) {
  const overlayRef = useRef(null);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape' && closable) onClose?.(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, closable, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={() => closable && onClose?.()}
      />

      {/* Panel */}
      <div
        className={cn(
          'relative w-full rounded-2xl border border-slate-200 dark:border-slate-700',
          'bg-white dark:bg-slate-900 shadow-xl animate-fade-in',
          SIZES[size] ?? SIZES.md,
          className
        )}
      >
        {/* Header */}
        {(title || closable) && (
          <div className="flex items-start justify-between p-5 pb-4">
            <div>
              {title && (
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  {title}
                </h2>
              )}
              {description && (
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
              )}
            </div>
            {closable && (
              <Button
                variant="ghost"
                size="xs"
                className="ml-4 -mr-1 -mt-1"
                onClick={onClose}
                aria-label="Close dialog"
              >
                <X size={16} />
              </Button>
            )}
          </div>
        )}

        {/* Body */}
        <div className={cn('px-5', !title && 'pt-5', !footer && 'pb-5')}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex justify-end gap-2 p-5 pt-4 border-t border-slate-100 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
