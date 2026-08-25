// characterSpellLists.js
//
// Homebrew-SPELL-LISTEN: benannte Zauber-Sammlungen, die die wählbaren
// Zauber eines Charakters erweitern — für Fälle außerhalb der offiziellen
// Klassenliste (gefundenes Grimoire, Pakt, Fraktions-Ausbildung, eigene
// Klasse).
//
// Eine Liste kommt auf zwei Wegen an einen Charakter:
//   1. Sie hängt an einem ANDEREN Homebrew-Eintrag (Rasse, Background,
//      Feature, Item) über dessen `spellListIds`. Hat der Charakter diesen
//      Eintrag, gilt die Liste automatisch.
//   2. Sie ist dem Charakter direkt zugeordnet
//      (character.homebrewSpellLists) — für spontane DM-Vergaben.
//
// Datenmodell des Listen-Eintrags (Homebrew-Kind 'spelllists'):
//   { name, source, spells: [<Zaubername>], classes: [<Klasse>]?, entries? }
//   `classes` leer    → erweitert JEDE Zauberklasse des Charakters
//   `classes` gesetzt → erweitert nur diese Klassen
//
// Wirkung an den zwei Stellen, an denen ein Spieler Zauber wählt:
//   • Prepared Caster → die Zauber erscheinen im Vorbereiten-Dialog
//   • Known Caster    → sie erscheinen beim Lernen (Level-Up / Erstellung)
//
// Die Auflösung ist bewusst eine reine Funktion (testbar, keine IO): die
// Aufrufer laden die Homebrew-Einträge und reichen sie herein.

// Referenzen auf Homebrew-Einträge sind je nach Alter des Charakters mal
// die local_id, mal der Name (die Loader vergeben `id` aus dem Namen).
// Deshalb tolerant vergleichen statt eine Form zu erzwingen.
const norm = (v) => String(v ?? '').trim().toLowerCase()
function matchesRef(entry, ref) {
  if (!entry || ref == null) return false
  const r = norm(ref)
  if (!r) return false
  return r === norm(entry._localMeta?.id)
    || r === norm(entry.name)
    || r === norm(String(entry.name).replace(/\s+/g, '-'))
}

// Alle Homebrew-Einträge, die auf DIESEN Charakter zutreffen — pro Kind
// über das Feld, mit dem der Charakter den Eintrag referenziert.
function activeHomebrewEntries(character, byKind = {}) {
  const hits = []
  const raceRefs = [character?.species?.raceId, character?.species?.subraceId]
  for (const e of (byKind.races || [])) {
    if (raceRefs.some(r => matchesRef(e, r))) hits.push(e)
  }
  for (const e of (byKind.backgrounds || [])) {
    if (matchesRef(e, character?.background?.backgroundId)) hits.push(e)
  }
  // Features: alles was die Hydration aktiviert hat (Homebrew-Features
  // landen dort über __homebrewFeatures) — Fallback auf die Rohliste,
  // falls noch nicht hydriert.
  const featureNames = new Set([
    ...(character?.__activeFeatures || []).map(f => norm(f?.name)),
    ...(character?.__homebrewFeatures || []).map(f => norm(f?.name)),
  ])
  for (const e of (byKind.features || [])) {
    if (featureNames.has(norm(e.name))) hits.push(e)
  }
  // Items: nur ausgerüstete zählen (ein Grimoire im Rucksack lehrt nichts).
  const carried = [
    ...(character?.inventory?.items || []),
    ...(character?.custom?.items || []),
  ].filter(i => i?.equipped)
  for (const e of (byKind.items || [])) {
    if (carried.some(i => norm(i.customName || i.name) === norm(e.name))) hits.push(e)
  }
  return hits
}

/**
 * Alle für den Charakter geltenden Spell-Listen.
 * `byKind` = { spelllists, races, backgrounds, features, items } — jeweils
 * die vollständigen Homebrew-Einträge des Nutzers.
 */
export function assignedSpellLists(character, byKind = {}) {
  const all = byKind.spelllists || []
  if (!all.length) return []
  const wanted = new Set()
  // 1. Direkt am Charakter
  for (const id of (character?.homebrewSpellLists || [])) wanted.add(norm(id))
  // 2. Über andere Homebrew-Einträge
  for (const e of activeHomebrewEntries(character, byKind)) {
    for (const id of (e?.spellListIds || [])) wanted.add(norm(id))
  }
  if (!wanted.size) return []
  return all.filter(l => wanted.has(norm(l?._localMeta?.id)) || wanted.has(norm(l?.name)))
}

/**
 * Zusätzliche Zaubernamen (lowercase) für eine KONKRETE Klasse.
 * Eine Liste ohne `classes` erweitert jede Klasse; mit `classes` nur die
 * genannten (Vergleich case-insensitiv).
 */
export function extraSpellNamesFor(character, byKind = {}, classId = null) {
  const out = new Set()
  const want = norm(classId)
  for (const list of assignedSpellLists(character, byKind)) {
    const restrict = Array.isArray(list.classes) ? list.classes.filter(Boolean) : []
    if (restrict.length > 0 && want) {
      if (!restrict.some(c => norm(c) === want)) continue
    }
    for (const s of (list.spells || [])) {
      const name = typeof s === 'string' ? s : s?.name
      if (name) out.add(norm(name))
    }
  }
  return out
}

/** Alle Zusatz-Zaubernamen über sämtliche geltenden Listen (klassenlos). */
export function allExtraSpellNames(character, byKind = {}) {
  return extraSpellNamesFor(character, byKind, null)
}

/** Patch-Wert für updateCharacter('homebrewSpellLists', …) — pure. */
export function setSpellListAssigned(character, listId, on) {
  const cur = Array.isArray(character?.homebrewSpellLists) ? character.homebrewSpellLists : []
  const id = String(listId)
  const has = cur.some(x => String(x) === id)
  if (on && !has) return [...cur, id]
  if (!on && has) return cur.filter(x => String(x) !== id)
  return cur
}

/** Patch-Wert für `spellListIds` an einem beliebigen Homebrew-Eintrag. */
export function setEntrySpellList(entry, listId, on) {
  const cur = Array.isArray(entry?.spellListIds) ? entry.spellListIds : []
  const id = String(listId)
  const has = cur.some(x => String(x) === id)
  if (on && !has) return [...cur, id]
  if (!on && has) return cur.filter(x => String(x) !== id)
  return cur
}
