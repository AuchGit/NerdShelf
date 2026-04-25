import { createContext, useContext, useState, useEffect } from 'react';

const SettingsContext = createContext(null);

export const CARD_SIZES = {
  small:  { label: 'Small',  minWidth: '110px' },
  medium: { label: 'Medium', minWidth: '150px' },
  large:  { label: 'Large',  minWidth: '195px' },
};

export const COLS_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 2,      label: '2' },
  { value: 3,      label: '3' },
  { value: 4,      label: '4' },
  { value: 5,      label: '5' },
  { value: 6,      label: '6' },
];

const DEFAULTS = {
  cardSize:   'medium',  // 'small' | 'medium' | 'large'
  cardsPerRow: 'auto',  // 'auto' | 2..6
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

export function useSettings() {
  return useContext(SettingsContext);
}
