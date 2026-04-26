// src/core/auth/AuthContext.jsx
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabase/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); return; }
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle();
    if (error) {
      console.warn('[auth] failed to load profile:', error.message);
      setProfile(null);
      return;
    }
    setProfile(data ?? null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      await loadProfile(u?.id);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      loadProfile(u?.id);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const updatePlayerName = async (name) => {
    if (!user?.id) throw new Error('Not signed in');
    const trimmed = (name ?? '').trim();
    const prev = profile;
    // optimistic
    setProfile(p => ({ ...(p ?? { id: user.id }), player_name: trimmed }));
    const { data, error } = await supabase
      .from('profiles')
      .update({ player_name: trimmed })
      .eq('id', user.id)
      .select()
      .maybeSingle();
    if (error) {
      setProfile(prev);
      throw error;
    }
    if (data) setProfile(data);
  };

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      playerName: profile?.player_name ?? '',
      loading,
      signIn,
      signOut,
      updatePlayerName,
      reloadProfile: () => loadProfile(user?.id),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
