// pillColors.js
//
// Zentrale Farbpalette für alle Sheet-Pills (Damage-Types, Save-Pills,
// Action-Pills, Concentration, Ritual, Slot, Uses, …). Lokal pro
// Browser persistiert in localStorage — nicht per Charakter, weil das
// eher User-Preference als Char-Daten ist.
//
// API:
//   DEFAULT_PILL_COLORS    — fallback palette
//   getAllPillColors()     — { [key]: hex } gemerged mit override
//   getPillColor(key)      — single color lookup mit fallback
//   setPillColor(key, hex) — speichert override
//   resetPillColors()      — wischt alle overrides

const STORAGE_KEY = 'nerdshelf:pillColors'

export const DEFAULT_PILL_COLORS = {
  // Damage types — Standard 5e + healing alias
  'damage.acid':        '#7bc950',
  'damage.bludgeoning': '#8a8a8a',
  'damage.cold':        '#7dd3fc',
  'damage.fire':        '#ff6b35',
  'damage.force':       '#c084fc',
  'damage.lightning':   '#fbbf24',
  'damage.necrotic':    '#a3a3a3',
  'damage.piercing':    '#9ca3af',
  'damage.poison':      '#84cc16',
  'damage.psychic':     '#ec4899',
  'damage.radiant':     '#fcd34d',
  'damage.slashing':    '#a8a29e',
  'damage.thunder':     '#60a5fa',
  'damage.healing':     '#5eead4',
  // Spell- / Action-Mechanik
  'pill.attack':       '#5b8cff',  // accent-blue
  'pill.save':         '#a684ff',  // accent-purple
  'pill.concentration':'#a684ff',
  'pill.ritual':       '#5b8cff',
  'pill.slot':         '#5b8cff',
  'pill.always':       '#a684ff',
  'pill.uses':         '#22c55e',
  'pill.trigger':      '#fbbf24',
  // Action-Economy
  'action.action':      '#ef4444',
  'action.bonusAction': '#fbbf24',
  'action.reaction':    '#a684ff',
  'action.hastedAction':'#5b8cff',
}

// Display-Labels für die Settings-UI. Gruppiert für übersichtliche
// Anzeige. Strings statt Untergruppen-Schlüssel um die Lib einfach
// zu halten.
export const PILL_COLOR_GROUPS = [
  {
    label: 'Damage Types',
    items: [
      ['damage.acid', 'Acid'],
      ['damage.bludgeoning', 'Bludgeoning'],
      ['damage.cold', 'Cold'],
      ['damage.fire', 'Fire'],
      ['damage.force', 'Force'],
      ['damage.lightning', 'Lightning'],
      ['damage.necrotic', 'Necrotic'],
      ['damage.piercing', 'Piercing'],
      ['damage.poison', 'Poison'],
      ['damage.psychic', 'Psychic'],
      ['damage.radiant', 'Radiant'],
      ['damage.slashing', 'Slashing'],
      ['damage.thunder', 'Thunder'],
      ['damage.healing', 'Healing'],
    ],
  },
  {
    label: 'Spell Pills',
    items: [
      ['pill.attack', 'Attack'],
      ['pill.save', 'Save'],
      ['pill.concentration', 'Concentration'],
      ['pill.ritual', 'Ritual'],
      ['pill.slot', 'Slot'],
      ['pill.always', 'Always Prepared'],
      ['pill.uses', 'Uses / Charges'],
      ['pill.trigger', 'Trigger'],
    ],
  },
  {
    label: 'Action Economy',
    items: [
      ['action.action', 'Action'],
      ['action.bonusAction', 'Bonus Action'],
      ['action.reaction', 'Reaction'],
      ['action.hastedAction', 'Hasted Action'],
    ],
  },
]

function readOverrides() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return (parsed && typeof parsed === 'object') ? parsed : {}
  } catch { return {} }
}

function writeOverrides(map) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    // Custom event damit React-Komponenten re-renderen können wenn
    // die Settings-UI den Wert ändert (storage-event feuert nur in
    // anderen Tabs, nicht im selben).
    window.dispatchEvent(new CustomEvent('nerdshelf:pillcolors-changed'))
  } catch { /* ignore */ }
}

export function getAllPillColors() {
  return { ...DEFAULT_PILL_COLORS, ...readOverrides() }
}

export function getPillColor(key) {
  const all = getAllPillColors()
  return all[key] || DEFAULT_PILL_COLORS[key] || 'var(--text-muted)'
}

export function setPillColor(key, hex) {
  if (!key) return
  const map = readOverrides()
  if (!hex || hex === DEFAULT_PILL_COLORS[key]) delete map[key]
  else map[key] = hex
  writeOverrides(map)
}

export function resetPillColors() {
  writeOverrides({})
}

// React-Hook: liefert die aktuelle Pill-Color-Map und subscribet auf
// Änderungen über das custom-event. Komponenten re-rendern wenn der
// User in den Settings eine Farbe ändert.
import { useEffect, useState } from 'react'
export function usePillColors() {
  const [colors, setColors] = useState(() => getAllPillColors())
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onChange = () => setColors(getAllPillColors())
    window.addEventListener('nerdshelf:pillcolors-changed', onChange)
    // storage-event greift bei Multi-Tab-Sync
    const onStorage = (e) => {
      if (e.key === 'nerdshelf:pillColors') setColors(getAllPillColors())
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('nerdshelf:pillcolors-changed', onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return colors
}
