// src/shared/cache/listCache.js
//
// Tiny module-scope cache for list-style Supabase queries (dashboard
// "all my X" reads). Survives navigation within a single page session,
// not page reload. Works on Tauri AND in the browser — orthogonal to
// the PWA service-worker HTTP cache.
//
// Pattern at the call site:
//
//   const key = `mtg_decks:${user.id}`
//   const cached = readList(key)
//   const [decks, setDecks] = useState(() => cached ?? [])
//   const [loading, setLoading] = useState(() => !cached)
//
//   const load = useCallback(async () => {
//     const { data } = await supabase.from('mtg_decks').select(...)
//     setDecks(data ?? [])
//     writeList(key, data ?? [])
//     setLoading(false)
//   }, [...])
//
//   useEffect(() => { load() }, [load])
//   useEffect(() => subscribe(key, payload => {
//     if (payload === null) load()
//     else setDecks(payload)
//   }), [key, load])
//
//   // After any mutation: invalidate(key); load()
//
// Why module-scope, not React context: the cache is data, not state —
// it doesn't need to trigger re-renders for components that don't read
// it. Subscribers opt in explicitly via subscribe().

const cache = new Map()           // key -> { data, ts }
const subscribers = new Map()     // key -> Set<fn>

/** Return cached data for a key, or null if absent. */
export function readList(key) {
  return cache.get(key)?.data ?? null
}

/** Return the ms timestamp the cache entry was last written, or null. */
export function readListAt(key) {
  return cache.get(key)?.ts ?? null
}

/** Replace the cached value and notify subscribers. */
export function writeList(key, data) {
  cache.set(key, { data, ts: Date.now() })
  for (const fn of (subscribers.get(key) || [])) fn(data)
}

/**
 * Drop the cached entry and notify subscribers with `null`, so they can
 * re-fetch. Use after a mutation.
 */
export function invalidate(key) {
  cache.delete(key)
  for (const fn of (subscribers.get(key) || [])) fn(null)
}

/** Drop every cached entry whose key starts with `prefix`. */
export function invalidatePrefix(prefix) {
  for (const k of [...cache.keys()]) {
    if (k.startsWith(prefix)) {
      cache.delete(k)
      for (const fn of (subscribers.get(k) || [])) fn(null)
    }
  }
}

/**
 * Subscribe to changes for `key`. Callback fires with the new data on
 * writeList, or `null` on invalidate. Returns an unsubscribe function.
 */
export function subscribe(key, fn) {
  let set = subscribers.get(key)
  if (!set) { set = new Set(); subscribers.set(key, set) }
  set.add(fn)
  return () => set.delete(fn)
}
