// src/features/wh40k/hooks/useWh40kFavorites.js
//
// Thin wrapper over the shared favorites core scoped to the 'wh40k' domain.
// Stays a wrapper rather than direct usage so wh40k components don't need to
// know the domain string and can pass `Unit` objects directly.

import { useFavoritesCore } from '../../../shared/favorites';

export function useWh40kFavorites() {
  return useFavoritesCore({
    domain: 'wh40k',
    extractId: (unit) => unit?.id,
    extractLabel: (unit) => unit?.name || '',
  });
}
