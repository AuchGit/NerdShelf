// „1×/Zug"-Verbrauch von Wurf-Composer-Ridern (Sneak Attack, Dreadful
// Strikes, …), geteilt über Fenster hinweg (VTT, Popout-Sheet, Aktions-
// Overlay) via localStorage. Der Zug-Schlüssel kommt aus der VTT-Initiative
// (Runde:Index) — RAW gilt „once per turn" für JEDEN Zug (auch Reaktionen/
// Gelegenheitsangriffe), darum ist der globale Zugwechsel der richtige Reset.
// Ohne laufenden Kampf gibt es keine Züge → nichts wird durchgesetzt.
const KEY = 'nerdshelf:riderTurnUse'

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null } catch { return null }
}
function write(v) {
  try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY) } catch { /* ignore */ }
}

// Vom VTT bei jedem Initiative-Wechsel gesetzt; null = kein Kampf → Reset.
export function setRiderTurnKey(turnKey) {
  const cur = read()
  if (!turnKey) { if (cur) write(null); return }
  if (cur?.turnKey === turnKey) return
  write({ turnKey, used: {} })
}

// Bereits in DIESEM Zug verbrauchte Rider eines Charakters (Set von Rider-Ids;
// die Ids sind stabil name-basiert, siehe gatherActionRiders).
export function usedRiders(charKey) {
  const cur = read()
  if (!cur?.turnKey || charKey == null) return new Set()
  return new Set(cur.used?.[String(charKey)] || [])
}

// Rider als verbraucht markieren (No-op ohne laufenden Kampf).
export function markRidersUsed(charKey, ids) {
  const cur = read()
  if (!cur?.turnKey || charKey == null || !ids?.length) return
  const k = String(charKey)
  const prev = new Set(cur.used?.[k] || [])
  ids.forEach((id) => prev.add(id))
  write({ ...cur, used: { ...cur.used, [k]: [...prev] } })
}
