// src/features/mtg/deck-builder/hooks/useOracleTags.js
//
// Shared access to the Scryfall oracle-tag index (see services/scryfallTags).
// Returns { status: 'idle'|'loading'|'ready'|'error', index, error, load }.
// Nothing downloads until someone calls `load()`.

import { useSyncExternalStore } from 'react';
import {
  subscribeOracleTags, getOracleTagsState, loadOracleTags,
} from '../services/scryfallTags';

export function useOracleTags() {
  const state = useSyncExternalStore(subscribeOracleTags, getOracleTagsState, getOracleTagsState);
  return { ...state, load: loadOracleTags };
}
