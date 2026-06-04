// classTableLookup.js
//
// Hilfsfunktionen um Werte aus `classTableGroups[].rows[]` zu lesen.
// 5etools encodet level-skalierte Resource-Counts / Würfel direkt in
// dieser Tabelle (Fighter Second Wind 2→3→4, Bard Bardic Die d6→d12,
// Rogue Sneak Attack 1d6→10d6, Monk Martial Arts 1d4→1d12 etc.).
//
// Bisher leben die Helper privat in rulesEngine.js. Phase 3 zieht sie
// raus damit auch featureEffectParser auf den gleichen Pfad zugreifen
// kann (Sneak-Attack-Pille skaliert dann korrekt mit dem Charakter-
// Level statt am ersten "1d6"-Tag im Entry-Text zu kleben).

function stripTag(s) {
  return String(s || '')
    .replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
    .toLowerCase().trim()
}

/** Internal: locate the raw cell. Case-insensitive label match, tolerates
 *  `{@filter X|…}` / `{@variantrule X|XPHB}` markup on column labels. */
export function getClassTableCell(classData, level, columnLabel) {
  if (!classData?.classTableGroups || !level) return null
  const target = stripTag(columnLabel)
  for (const group of classData.classTableGroups) {
    const labels = group.colLabels || []
    const idx = labels.findIndex(l => stripTag(l) === target)
    if (idx < 0) continue
    const row = (group.rows || [])[level - 1]
    if (!row) continue
    return row[idx]
  }
  return null
}

/**
 * Numeric lookup. Returns integer or null (no fallback — caller
 * decides). Handles plain numbers, numeric strings, and object cells
 * of shape `{ value: N }`.
 */
export function getClassTableValue(classData, level, columnLabel) {
  const cell = getClassTableCell(classData, level, columnLabel)
  if (cell == null) return null
  if (typeof cell === 'number') return cell
  if (typeof cell === 'string') {
    const n = parseInt(cell, 10)
    return Number.isNaN(n) ? null : n
  }
  if (cell && typeof cell === 'object' && typeof cell.value === 'number') return cell.value
  return null
}

/**
 * Dice-formatted lookup. Returns "1d6" / "2d6" / "1d8" / null.
 * 5etools-Schema: `{ type: 'dice', toRoll: [{ number, faces }, ...] }`.
 * Multi-dice cells (rare; some entries roll multiple dice at once)
 * werden als "NdF + NdF" zusammengefasst.
 */
export function getClassTableDie(classData, level, columnLabel) {
  const cell = getClassTableCell(classData, level, columnLabel)
  if (!cell || typeof cell !== 'object') return null
  if (cell.type === 'dice' && Array.isArray(cell.toRoll) && cell.toRoll[0]) {
    return cell.toRoll
      .filter(r => r && (r.number || 1) > 0 && r.faces > 0)
      .map(r => `${r.number || 1}d${r.faces}`)
      .join(' + ') || null
  }
  return null
}

/**
 * Liefert ALLE Spalten-Labels der Klasse als simplified-Strings.
 * Wird vom Pill-Parser benutzt um zu raten welche Spalte gemeint ist
 * wenn der Feature-Text "as shown in the X column of the Y table"
 * sagt (X = column-name we substring-match).
 */
export function listClassTableColumns(classData) {
  if (!classData?.classTableGroups) return []
  const out = []
  for (const group of (classData.classTableGroups || [])) {
    for (const label of (group.colLabels || [])) {
      const stripped = stripTag(label)
      if (stripped) out.push({ label, stripped })
    }
  }
  return out
}
