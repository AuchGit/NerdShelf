import { useState, useEffect, useCallback } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useAuth }     from '@/contexts/AuthContext';
import useStore        from '@/store/useStore';

/**
 * useCharacters
 * Bestehende Tabellenstruktur: id, created_at, updated_at, user_id, name, data (jsonb)
 * Das `data`-Feld enthält alle Charakter-Daten als JSON — komplett kompatibel
 * mit deinem bestehenden Character Creator.
 */
export function useCharacters() {
  const { profile }  = useAuth();
  const { addToast } = useStore();

  const [characters, setCharacters] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);

  const fetchCharacters = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase
        .from('characters')
        .select('id, name, data, created_at, updated_at')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false });

      if (err) throw err;
      setCharacters(data ?? []);
    } catch (e) {
      setError(e.message);
      addToast({ type: 'error', message: `Laden fehlgeschlagen: ${e.message}` });
    } finally {
      setLoading(false);
    }
  }, [profile?.id, addToast]);

  useEffect(() => { fetchCharacters(); }, [fetchCharacters]);

  // Create: { name, data: { ...deinCreatorJSON } }
  const createCharacter = useCallback(async ({ name, data: charData }) => {
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase
        .from('characters')
        .insert({ user_id: profile.id, name, data: charData })
        .select('id, name, data, created_at, updated_at')
        .single();

      if (err) throw err;
      setCharacters((prev) => [data, ...prev]);
      addToast({ type: 'success', message: `${data.name} erstellt!` });
      return { success: true, data };
    } catch (e) {
      addToast({ type: 'error', message: `Fehler: ${e.message}` });
      return { success: false, error: e.message };
    }
  }, [profile?.id, addToast]);

  // Update: { name, data: { ...deinCreatorJSON } }
  const updateCharacter = useCallback(async (id, { name, data: charData }) => {
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase
        .from('characters')
        .update({ name, data: charData, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', profile.id)
        .select('id, name, data, created_at, updated_at')
        .single();

      if (err) throw err;
      setCharacters((prev) => prev.map((c) => (c.id === id ? data : c)));
      addToast({ type: 'success', message: `${data.name} gespeichert.` });
      return { success: true, data };
    } catch (e) {
      addToast({ type: 'error', message: `Fehler: ${e.message}` });
      return { success: false, error: e.message };
    }
  }, [profile?.id, addToast]);

  const deleteCharacter = useCallback(async (id) => {
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from('characters')
        .delete()
        .eq('id', id)
        .eq('user_id', profile.id);

      if (err) throw err;
      setCharacters((prev) => prev.filter((c) => c.id !== id));
      addToast({ type: 'success', message: 'Charakter gelöscht.' });
      return { success: true };
    } catch (e) {
      addToast({ type: 'error', message: `Fehler: ${e.message}` });
      return { success: false, error: e.message };
    }
  }, [profile?.id, addToast]);

  return { characters, loading, error, fetchCharacters, createCharacter, updateCharacter, deleteCharacter };
}
