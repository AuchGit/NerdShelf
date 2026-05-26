// src/features/dnd/character-builder/lib/sessionPrefs.js
//
// Local-only display prefs for the GM session overview. Stored per device
// in localStorage (mirroring other dndbuilder_* prefs) because these are
// personal display preferences, not data that needs to be shared across
// devices / users.
//
// Two axes the GM can toggle:
//   - `passives` — which passive skills to show (perception/insight/...).
//     The skill ids match the keys on `computed.skills` so adding a new
//     passive is purely a checkbox in the editor; the SessionCard derives
//     `10 + skills[id].total` and renders it.
//   - `stats`    — which non-passive stat blocks to show (AC, speed, ...).
//     Each entry maps to a renderer in the SessionCard. Adding a new one
//     means: add the id to STAT_OPTIONS and a switch arm in the renderer.
//
// `getDefaults` returns the sensible-default visibility (the three most
// commonly used passives + AC) — used on first load and as the "reset"
// target in the editor.

const STORAGE_KEY = 'dndbuilder_gm_session_prefs'

// Catalog of every togglable field. Keep this as the single source of
// truth — the editor reads it to render checkboxes, the session card
// reads it to know whether a field is enabled.
export const PASSIVE_OPTIONS = [
  { id: 'perception',    label: 'Passive Perception',    default: true  },
  { id: 'insight',       label: 'Passive Insight',       default: true  },
  { id: 'investigation', label: 'Passive Investigation', default: true  },
  { id: 'stealth',       label: 'Passive Stealth',       default: false },
]

export const STAT_OPTIONS = [
  { id: 'ac',          label: 'Armor Class',          default: true  },
  { id: 'speed',       label: 'Speed (Walk)',         default: false },
  // When `speed` is enabled the SessionCard also surfaces fly / swim /
  // climb on hover via this option. Separated so the GM can hide the
  // primary speed value entirely without losing the hover.
  { id: 'movementModes', label: 'Andere Bewegungsmodi (Tooltip)', default: false },
  { id: 'initiative',  label: 'Initiative',           default: false },
  { id: 'saves',       label: 'Saving Throws',        default: false },
  { id: 'hitDice',     label: 'Hit Dice',             default: false },
  { id: 'spellSave',   label: 'Spell Save DC',        default: false },
  { id: 'spellAttack', label: 'Spell Attack Mod',     default: false },
  { id: 'spellSlots',  label: 'Spell Slots',          default: false },
  { id: 'actions',     label: 'Action-Economy',       default: false },
  // Konzentration ist immer sichtbar (siehe SessionPage) — kein Toggle nötig.
  { id: 'encumbrance', label: 'Encumbrance-Bar',      default: false },
  { id: 'currency',    label: 'Currency / Coins',     default: false },
]

export function getDefaults() {
  return {
    passives: PASSIVE_OPTIONS.filter(o => o.default).map(o => o.id),
    stats:    STAT_OPTIONS.filter(o => o.default).map(o => o.id),
  }
}

/**
 * Read the persisted prefs, falling back to defaults for missing keys so
 * a partially-written object never breaks the UI. Unknown ids are kept
 * (they're a no-op) so users can roll forward / backward between app
 * versions without losing their checks.
 */
export function getSessionPrefs() {
  const defaults = getDefaults()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw)
    return {
      passives: Array.isArray(parsed.passives) ? parsed.passives : defaults.passives,
      stats:    Array.isArray(parsed.stats)    ? parsed.stats    : defaults.stats,
    }
  } catch {
    return defaults
  }
}

export function setSessionPrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)) } catch { /* ignore */ }
  try { window.dispatchEvent(new Event('dnd-session-prefs-changed')) } catch { /* non-browser */ }
}

export function resetSessionPrefs() {
  setSessionPrefs(getDefaults())
}

/** Toggle one id in either bucket and persist. */
export function toggleSessionPref(bucket, id) {
  const cur = getSessionPrefs()
  const set = new Set(cur[bucket])
  if (set.has(id)) set.delete(id); else set.add(id)
  setSessionPrefs({ ...cur, [bucket]: [...set] })
}
