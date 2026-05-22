import Modal from './Modal';
import Button from './Button';
import { AlertTriangle } from 'lucide-react';

/**
 * A generic confirmation dialog.
 *
 * Usage:
 * <ConfirmDialog
 *   open={showConfirm}
 *   onClose={() => setShowConfirm(false)}
 *   onConfirm={handleDelete}
 *   title="Delete Character"
 *   description="Are you sure? This cannot be undone."
 *   confirmLabel="Delete"
 *   confirmVariant="danger"
 * />
 */
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  description = 'This action cannot be undone.',
  confirmLabel = 'Confirm',
  confirmVariant = 'danger',
  loading = false,
}) {
  return (
    <Modal open={open} onClose={onClose} size="sm" title={null}>
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
          <AlertTriangle className="text-red-600 dark:text-red-400" size={22} />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
          {description && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
          )}
        </div>
        <div className="flex w-full gap-2 pt-1">
          <Button variant="outline" fullWidth onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={confirmVariant} fullWidth onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
