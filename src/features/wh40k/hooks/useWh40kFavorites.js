// src/features/wh40k/hooks/useWh40kFavorites.js
//
// Wraps the shared favorites core against the wh40k_favorites table.
// See scripts/split-nerdshelf-tables.sql for the schema.

import { useFavoritesCore } from '../../../shared/favorites';

export function useWh40kFavorites() {
  return useFavoritesCore({
    table: 'wh40k_favorites',
    extractId:    (unit) => unit?.id,
    extractLabel: (unit) => unit?.name || '',
  });
}
