// src/core/auth/launcherHandoff.js
//
// Started from AuchLauncher while signed in there: the launcher passes a
// one-time sign-in code for the same account. Redeemed here only when nobody
// is signed in yet; the app then has its own session (nothing is shared with
// the launcher). Desktop app only; the browser version has nothing to take.
import { supabase } from '../supabase/client';

export async function takeLauncherHandoff() {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const code = await invoke('take_handoff');
    if (!code) return null;
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: code, type: 'email' });
    if (error) {
      console.warn('[auth] launcher sign-in failed:', error.message);
      return null;
    }
    return data?.session ?? null;
  } catch {
    return null;
  }
}
