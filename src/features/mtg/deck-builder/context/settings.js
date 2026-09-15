// src/features/mtg/deck-builder/context/settings.js
//
// Context object + hook for the deck-builder display settings. Kept apart
// from the provider component (SettingsContext.jsx) so that file exports
// only a component.

import { createContext, useContext } from 'react';

export const SettingsContext = createContext(null);

export function useSettings() {
  return useContext(SettingsContext);
}
