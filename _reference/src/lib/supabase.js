import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './config';

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let _client = null;

/**
 * Returns the shared Supabase client, creating it on first call.
 * Throws if Supabase is not yet configured.
 */
export function getSupabase() {
  if (_client) return _client;

  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase is not configured. Please open Settings and enter your Supabase URL and Anon Key.'
    );
  }

  _client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession:   true,   // Keeps session across page reloads
      autoRefreshToken: true,   // Refreshes JWT before it expires
      detectSessionInUrl: true, // Handles OAuth redirect URLs
    },
  });

  return _client;
}

/**
 * Destroys the cached client.
 * Call this after changing Supabase config so the next call to getSupabase()
 * will create a fresh client with the new credentials.
 */
export function resetSupabaseClient() {
  _client = null;
}

/**
 * Returns true if a client can be created with current config.
 */
export function isSupabaseConfigured() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
  return Boolean(supabaseUrl && supabaseAnonKey);
}
