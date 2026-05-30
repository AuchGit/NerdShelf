// wizardScribing.js — Wizard Spellbook Scribing-Kostenrechnung
//
// 5e RAW: 50 gp + 2 Stunden pro Spell-Level für Kopieren eines
// gefundenen Spells ins Spellbook. Die Wizard-Subclass-"Savant"-
// Features (Evocation Savant, Abjuration Savant, …) halbieren das
// für ihre namensgebende School.
//
// Die Erkennung läuft pure regex über `character.__activeFeatures`,
// gefiltert auf Wizard-Klassen. Damit zieht sie automatisch jede
// neue Schule die in den Daten landet — keine Subclass-Whitelist,
// kein School→Wizard-Mapping.
//
// Exporte:
//   getScribingDiscounts(character)   → { halvedSchools: Set<string> }
//   getScribingCost(spell, discounts) → { gp, hours, halved: boolean }

const HALVED_PATTERN =
  /(?:gold\s+and\s+time|time\s+and\s+gold)\s+(?:you\s+)?(?:must\s+)?spend\s+to\s+copy\s+an?\s+([a-z]+)\s+spell\s+into\s+(?:your|the)\s+spellbook\s+is\s+halved/i

// Fallback für andere Phrasierungen ("the cost in gold and time to
// add a [school] spell to your spellbook is halved" o.ä.) — fängt
// dieselbe Mechanik, nur in freier Reihenfolge.
const HALVED_PATTERN_LOOSE =
  /copy(?:ing)?\s+an?\s+([a-z]+)\s+spell\s+into\s+(?:your|the)\s+spellbook\s+is\s+halved/i

function flattenEntries(entries) {
  const parts = []
  const walk = (n) => {
    if (typeof n === 'string') parts.push(n)
    else if (Array.isArray(n)) for (const x of n) walk(x)
    else if (n && typeof n === 'object') {
      if (Array.isArray(n.entries)) walk(n.entries)
      if (Array.isArray(n.items))   walk(n.items)
    }
  }
  walk(entries || [])
  return parts
    .join(' ')
    // 5etools-Tags strippen: {@variantrule X|XPHB}, {@spell Y|XPHB} etc.
    // Sonst klebt der School-Name an irgendeinem Tag-Wrapper und das
    // Regex matcht nicht.
    .replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
}

/**
 * Liest die geschriebenen Spell-Schools aus dem Charakter heraus.
 * Operiert auf `character.__activeFeatures` (hydriert von der Sheet-
 * Page beim Laden), gefiltert auf Wizard-Klassen.
 *
 * Returns: { halvedSchools: Set<string lowercase> }
 */
export function getScribingDiscounts(character) {
  const halvedSchools = new Set()
  const features = character?.__activeFeatures || []
  for (const f of features) {
    if (f.classId !== 'Wizard') continue
    if (!Array.isArray(f.entries)) continue
    const text = flattenEntries(f.entries)
    const m = HALVED_PATTERN.exec(text) || HALVED_PATTERN_LOOSE.exec(text)
    if (m && m[1]) halvedSchools.add(m[1].toLowerCase())
  }
  return { halvedSchools }
}

/**
 * Kosten für das Kopieren eines einzelnen Spells.
 * - Cantrips (Level 0) sind nicht kopierbar → null.
 * - Halbiert wenn die Spell-School in `halvedSchools` ist.
 *
 * `spell.school` ist im 5etools-Format ein Buchstaben-Code
 * (A=Abjuration, V=Evocation, C=Conjuration, D=Divination,
 * E=Enchantment, I=Illusion, N=Necromancy, T=Transmutation).
 * Wir vergleichen gegen den vollen Schul-Namen, also expandieren
 * den Code hier datennah aus dem 5etools-Standard.
 */
const SCHOOL_CODE_TO_NAME = {
  A: 'abjuration',
  V: 'evocation',
  C: 'conjuration',
  D: 'divination',
  E: 'enchantment',
  I: 'illusion',
  N: 'necromancy',
  T: 'transmutation',
}

export function getScribingCost(spell, discounts) {
  const level = spell?.level
  if (!Number.isFinite(level) || level <= 0) return null
  const schoolCode = String(spell?.school || '').toUpperCase()
  const schoolName = SCHOOL_CODE_TO_NAME[schoolCode] || String(spell?.school || '').toLowerCase()
  const halved = discounts?.halvedSchools?.has(schoolName) || false
  const baseGp    = 50 * level
  const baseHours = 2  * level
  return {
    gp:    halved ? baseGp    / 2 : baseGp,
    hours: halved ? baseHours / 2 : baseHours,
    halved,
    school: schoolName,
  }
}
