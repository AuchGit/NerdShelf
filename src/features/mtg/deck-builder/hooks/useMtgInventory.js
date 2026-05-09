// src/features/mtg/deck-builder/hooks/useMtgInventory.js
//
// Thin wrapper over the shared inventory hook scoped to the 'mtg' domain.
// Mirrors the pattern used by the wh40k feature, sharing the same
// nerdshelf_inventory table and persistence behaviour.

import { useInventory } from '../../../../shared/inventory';

export function useMtgInventory() {
  return useInventory({ domain: 'mtg' });
}
