// src/features/wh40k/hooks/useWh40kInventory.js
//
// Wraps the shared inventory hook against the wh40k_inventory table.
// See scripts/split-nerdshelf-tables.sql for the schema.

import { useInventory } from '../../../shared/inventory';

export function useWh40kInventory() {
  return useInventory({ table: 'wh40k_inventory' });
}
