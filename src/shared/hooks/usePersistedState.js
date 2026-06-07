// usePersistedState
//
// useState mit localStorage-Persistenz. Identische API zu React.useState
// (Tuple [value, setValue]); zusätzlich:
//   • Initial-Value wird beim ersten Render aus localStorage geholt
//     wenn dort etwas steht — sonst der mitgegebene default
//   • setValue (oder setValue(prev => …)) schreibt zurück in localStorage
//   • Sets werden via Array-Serialisierung gespeichert — der Caller
//     kann `serializer`/`deserializer` setzen wenn das Default-JSON nicht
//     reicht
//
// Konvention: Storage-Key-Prefix 'dndbuilder_uipref_' damit alle
// UI-Prefs unter einer einheitlichen Namespacing-Regel laufen
// und beim Export/Reset leicht zu finden sind.

import { useState, useEffect, useRef } from 'react'

const PREFIX = 'dndbuilder_uipref_'

export default function usePersistedState(key, defaultValue, opts = {}) {
  const fullKey = key.startsWith(PREFIX) ? key : `${PREFIX}${key}`
  const serializer   = opts.serializer   || JSON.stringify
  const deserializer = opts.deserializer || JSON.parse

  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(fullKey)
      if (raw == null) return typeof defaultValue === 'function' ? defaultValue() : defaultValue
      return deserializer(raw)
    } catch {
      return typeof defaultValue === 'function' ? defaultValue() : defaultValue
    }
  })

  // Avoid writing back on the very first render when state === default.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      // Always write on mount so the key exists in localStorage for
      // future reads — but only if it doesn't yet (so we don't overwrite
      // a value set by a concurrent tab right after our read).
      try {
        if (localStorage.getItem(fullKey) == null) {
          localStorage.setItem(fullKey, serializer(state))
        }
      } catch { /* ignore quota / disabled */ }
      return
    }
    try {
      localStorage.setItem(fullKey, serializer(state))
    } catch { /* ignore quota / disabled */ }
  }, [fullKey, state, serializer])

  return [state, setState]
}

// Convenience-Helper für Sets — speichert als Array, lädt als Set.
const setSerializer   = (s) => JSON.stringify([...s])
const setDeserializer = (raw) => new Set(JSON.parse(raw))

export function usePersistedSet(key, initialIterable) {
  return usePersistedState(key, () => new Set(initialIterable || []), {
    serializer: setSerializer,
    deserializer: setDeserializer,
  })
}
