// src/features/wh40k/hooks/useWh40kInventory.js
import { useInventory } from '../../../shared/inventory';

export function useWh40kInventory() {
  return useInventory({ domain: 'wh40k' });
}
