// Eine Map-Zeile (inkl. levels/Stockwerke im jsonb) DURABEL nach Supabase
// schreiben — unabhängig vom Live-Transport, mit Retry und Weglassen fehlender
// Spalten (nicht migrierte DB). Verhindert, dass ein schnelles Schließen oder
// eine Relay-Only-Session eine neue Map / ein neues Stockwerk verliert.
import { getState } from '../state/store';
import { saveMapRowDurable } from '../sync/SupabaseAdapter';
import { supabase } from '../../../../core/supabase/client';

export async function persistMapDurable(mapId, campaignId) {
  const map = getState().maps[mapId];
  if (map) await saveMapRowDurable(supabase, map, campaignId);
}
