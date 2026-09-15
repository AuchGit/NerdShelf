// src/shared/pwa/unsavedChanges.js
//
// Tiny registry of editors with unsaved changes. The PWA updater only
// reloads the app on its own while nothing is registered here.
//
//   useUnsavedChanges('mtg-deck-builder', dirty)

import { useEffect } from 'react';

const active = new Set();

export function hasUnsavedChanges() {
  return active.size > 0;
}

export function useUnsavedChanges(key, unsaved) {
  useEffect(() => {
    if (!unsaved) return undefined;
    active.add(key);
    return () => { active.delete(key); };
  }, [key, unsaved]);
}
