import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
} from 'react';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

// ─── State shape ──────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   status:  'initializing' | 'unauthenticated' | 'pending_approval' | 'authenticated';
 *   session: import('@supabase/supabase-js').Session | null;
 *   profile: { id: string; email: string; approved: boolean; is_admin: boolean; created_at: string } | null;
 *   error:   string | null;
 * }} AuthState
 */

/** @type {AuthState} */
const INITIAL_STATE = {
  status:  'initializing',
  session: null,
  profile: null,
  error:   null,
};

// ─── Reducer ──────────────────────────────────────────────────────────────────

function authReducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, status: 'initializing', error: null };
    case 'SET_UNAUTHENTICATED':
      return { ...INITIAL_STATE, status: 'unauthenticated' };
    case 'SET_PENDING':
      return { ...state, status: 'pending_approval', session: action.session, profile: action.profile, error: null };
    case 'SET_AUTHENTICATED':
      return { ...state, status: 'authenticated', session: action.session, profile: action.profile, error: null };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    case 'UPDATE_PROFILE':
      return { ...state, profile: { ...state.profile, ...action.updates } };
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(authReducer, INITIAL_STATE);

  // ── Profile loader ──────────────────────────────────────────────────────────

  const loadProfile = useCallback(async (session) => {
    if (!session) {
      dispatch({ type: 'SET_UNAUTHENTICATED' });
      return;
    }
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (error) throw error;

      if (!data) {
        // Profile row missing — create it
        const { data: created, error: insertErr } = await supabase
          .from('profiles')
          .insert({ id: session.user.id, email: session.user.email })
          .select()
          .single();
        if (insertErr) throw insertErr;

        dispatch({ type: 'SET_PENDING', session, profile: created });
        return;
      }

      if (!data.approved) {
        dispatch({ type: 'SET_PENDING', session, profile: data });
      } else {
        dispatch({ type: 'SET_AUTHENTICATED', session, profile: data });
      }
    } catch (err) {
      console.error('[AuthContext] loadProfile error:', err);
      dispatch({ type: 'SET_ERROR', error: err.message });
      dispatch({ type: 'SET_UNAUTHENTICATED' });
    }
  }, []);

  // ── Bootstrap: listen to Supabase auth state ─────────────────────────────

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      dispatch({ type: 'SET_UNAUTHENTICATED' });
      return;
    }

    let supabase;
    try {
      supabase = getSupabase();
    } catch {
      dispatch({ type: 'SET_UNAUTHENTICATED' });
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      loadProfile(session);
    });

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        loadProfile(session);
      }
    );

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  // ── Auth actions ────────────────────────────────────────────────────────────

  const signUp = useCallback(async ({ email, password }) => {
    dispatch({ type: 'CLEAR_ERROR' });
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      return { success: true };
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message });
      return { success: false, error: err.message };
    }
  }, []);

  const signIn = useCallback(async ({ email, password }) => {
    dispatch({ type: 'CLEAR_ERROR' });
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return { success: true };
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message });
      return { success: false, error: err.message };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      const supabase = getSupabase();
      await supabase.auth.signOut();
    } catch (err) {
      console.error('[AuthContext] signOut error:', err);
    }
    dispatch({ type: 'SET_UNAUTHENTICATED' });
  }, []);

  const refreshProfile = useCallback(async () => {
    if (state.session) await loadProfile(state.session);
  }, [state.session, loadProfile]);

  const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), []);

  // ── Context value ───────────────────────────────────────────────────────────

  const value = {
    ...state,
    isInitializing:   state.status === 'initializing',
    isAuthenticated:  state.status === 'authenticated',
    isPendingApproval: state.status === 'pending_approval',
    isAdmin:          state.profile?.is_admin ?? false,
    signUp,
    signIn,
    signOut,
    refreshProfile,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** @returns {ReturnType<typeof AuthProvider> extends React.FC<{children: any}> ? any : never} */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
