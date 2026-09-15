import { useState, useEffect } from 'react';
import { SettingsContext } from './settings';

// Per-device display preferences (localStorage), not shared deck state.
const DEFAULTS = {
  cardSize:     'medium', // 'small' | 'medium' | 'large'
  cardsPerRow:  'auto',   // 'auto' | 2..6
  deckListSort: 'type',   // sort of the ◉ decklist view (see services/deckOrganize)
  deckListSort2: '',      // optional second level ('' = none)
};

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => {
    try {
      const stored = localStorage.getItem('mtg-settings');
      return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : DEFAULTS;
    } catch {
      return DEFAULTS;
    }
  });

  useEffect(() => {
    try { localStorage.setItem('mtg-settings', JSON.stringify(settings)); }
    catch { /* ignore */ }
  }, [settings]);

  const updateSetting = (key, value) =>
    setSettings(prev => ({ ...prev, [key]: value }));

  return (
    <SettingsContext.Provider value={{ settings, updateSetting }}>
      {children}
    </SettingsContext.Provider>
  );
}
