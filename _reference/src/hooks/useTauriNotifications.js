import { useEffect, useRef, useCallback } from 'react';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

// ─── Tauri detection + invoke helper ─────────────────────────────────────────

export function isTauri() {
  return typeof window !== 'undefined' && (
    !!window.__TAURI__ ||
    !!window.__TAURI_INTERNALS__ ||      // Tauri v2
    !!window.__TAURI_IPC__
  );
}

// Tauri v2 moved `invoke` from `@tauri-apps/api/tauri` to `@tauri-apps/api/core`.
// The old import path silently throws on v2 → every command returned null,
// which is why set_autostart/get_autostart appeared to do nothing.
async function invoke(cmd, args = {}) {
  if (!isTauri()) return null;
  try {
    const mod = await import('@tauri-apps/api/core');
    return await mod.invoke(cmd, args);
  } catch (e) {
    console.warn('[Tauri]', cmd, e?.message ?? e);
    return null;
  }
}

// ─── Public helpers ───────────────────────────────────────────────────────────

export async function sendNotification(title, body) {
  await invoke('show_notification', { title, body });
}

export async function setTrayBadge(count) {
  await invoke('update_tray_badge', { count: Math.max(0, Math.round(count)) });
}

export async function clearTrayBadge() {
  await invoke('clear_tray_badge');
}

export async function setAutostart(enabled) {
  // Rust signature returns the new state (true|false) or throws — we forward
  // it so the UI can confirm what actually got written to the registry.
  const result = await invoke('set_autostart', { enabled });
  return result == null ? false : !!result;
}

export async function getAutostart() {
  return !!(await invoke('get_autostart'));
}

export async function hideToTray() {
  await invoke('hide_to_tray');
}

// ─── Core polling hook ────────────────────────────────────────────────────────

/**
 * useTauriNotifications
 *
 * - Polls Supabase every POLL_MS milliseconds (default 30s)
 * - Detects NEW bugs (status=open) and NEW pending users vs. last poll
 * - Fires OS notifications for new items
 * - Updates the tray icon badge with total open count
 * - Calls onRefresh(data) so the Dashboard can update without a manual click
 */

const POLL_MS = 30_000; // 30 seconds

export function useTauriNotifications({ enabled = true, onRefresh } = {}) {
  const prev = useRef({
    initialized: false,
    openBugIds:  new Set(),
    pendingEmails: new Set(),
  });

  const poll = useCallback(async () => {
    if (!isSupabaseConfigured()) return;

    try {
      const supabase = getSupabase();

      const [bugsRes, usersRes] = await Promise.all([
        supabase
          .from('bug_reports')
          .select('id, priority, description, user_email, status, created_at')
          .not('status', 'in', '("resolved","closed")')
          .order('created_at', { ascending: false }),
        supabase
          .from('profiles')
          .select('id, email, approved, is_admin, created_at')
          .eq('approved', false),
      ]);

      const bugs    = bugsRes.data  ?? [];
      const pending = usersRes.data ?? [];

      const newBugIds     = new Set(bugs.filter(b => b.status === 'open').map(b => b.id));
      const pendingEmails = new Set(pending.map(u => u.email));

      // ── Notify about new items (only after first successful poll) ──────────
      if (prev.current.initialized) {
        const addedBugs  = [...newBugIds].filter(id => !prev.current.openBugIds.has(id));
        const addedUsers = [...pendingEmails].filter(e => !prev.current.pendingEmails.has(e));

        if (addedBugs.length > 0) {
          const highCount = bugs.filter(b => addedBugs.includes(b.id) && b.priority === 'high').length;
          const title = addedBugs.length === 1 ? '🐛 Neuer Bug Report' : `🐛 ${addedBugs.length} neue Bug Reports`;
          const body  = highCount > 0
            ? `${highCount > 1 ? `${highCount}x ` : ''}HIGH Priorität!`
            : bugs.find(b => addedBugs.includes(b.id))?.description?.slice(0, 80) ?? 'Neuer Report eingegangen.';
          await sendNotification(title, body);
        }

        if (addedUsers.length > 0) {
          const title = addedUsers.length === 1
            ? '👤 Neuer User wartet auf Freigabe'
            : `👤 ${addedUsers.length} neue User warten`;
          await sendNotification(title, addedUsers.slice(0, 2).join(', '));
        }
      }

      // ── Update tray badge = total open bugs + pending users ────────────────
      const totalBadge = newBugIds.size + pendingEmails.size;
      await setTrayBadge(totalBadge);

      // ── Save state for next comparison ─────────────────────────────────────
      prev.current = {
        initialized:   true,
        openBugIds:    newBugIds,
        pendingEmails: pendingEmails,
      };

      // ── Notify dashboard to refresh its local state ────────────────────────
      if (onRefresh) {
        onRefresh({ bugs: bugsRes.data ?? [], pending });
      }
    } catch (e) {
      console.warn('[useTauriNotifications] poll error:', e.message);
    }
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    // First poll after 3s (let auth settle)
    const initial = setTimeout(poll, 3000);
    const interval = setInterval(poll, POLL_MS);

    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [enabled, poll]);

  return { poll }; // expose manual trigger
}
