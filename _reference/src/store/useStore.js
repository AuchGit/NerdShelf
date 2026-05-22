import { create } from 'zustand';

/**
 * Global application store powered by Zustand.
 *
 * Keep module-specific state inside the module's own hooks.
 * This store holds only truly global, cross-cutting concerns:
 * - UI state (sidebar, notifications)
 * - Module registry cache
 */
const useStore = create((set, get) => ({
  // ── Sidebar ───────────────────────────────────────────────────────────────
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  // ── Toast / Notification queue ────────────────────────────────────────────
  /** @type {{ id: string; type: 'success'|'error'|'info'|'warning'; message: string }[]} */
  toasts: [],

  /**
   * Add a toast notification.
   * Auto-removes itself after `duration` ms (default 4000).
   * @param {{ type?: 'success'|'error'|'info'|'warning'; message: string; duration?: number }} opts
   */
  addToast: ({ type = 'info', message, duration = 4000 }) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, duration);
  },

  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  // ── Convenience toast helpers ────────────────────────────────────────────
  toast: {
    success: (message, duration) => get().addToast({ type: 'success', message, duration }),
    error:   (message, duration) => get().addToast({ type: 'error',   message, duration }),
    info:    (message, duration) => get().addToast({ type: 'info',    message, duration }),
    warn:    (message, duration) => get().addToast({ type: 'warning', message, duration }),
  },
}));

export default useStore;
