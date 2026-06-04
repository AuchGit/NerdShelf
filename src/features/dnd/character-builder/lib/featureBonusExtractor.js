// featureBonusExtractor.js
//
// Liest die `entries` einer Class-/Subclass-/Optional-Feature und
// extrahiert STRUKTURIERTE mechanische Boni daraus. Anders als der
// Pill-Parser (`featureEffectParser`) der "+1d6 necrotic"-Pillen baut
// und nicht in derived stats fließt, produziert dieser Extractor flat-
// integer Werte die direkt von rulesEngine aufaddiert werden können.
//
// Output-Shape (alle Felder optional):
//   {
//     acBonus,                       // +N AC (Defense, Cloak of …)
//     acBonusRequiresArmor,          // true ⇒ nur wenn Rüstung getragen
//     rangedAttackBonus,             // +N Attack Roll mit Fernkampfwaffen (Archery)
//     meleeAttackBonus,              // +N Attack Roll mit Nahkampfwaffen
//     oneHandedMeleeDamageBonus,     // +N Damage mit einhändiger Nahkampfwaffe (Dueling)
//     thrownDamageBonus,             // +N Damage mit Thrown-Waffen (Thrown Weapon Fighting)
//     savingThrowBonus,              // +N auf alle Saves
//     abilityCheckBonus,             // +N auf alle Ability Checks
//     // Erweiterbar — neue Felder werden von rulesEngine ignoriert
//     // bis dort ein consumer existiert. Kein Hardcode pro
//     // Feature-Name — die Erkennung läuft rein über Regex auf den
//     // entries-Text.
//   }
//
// Die Patterns sind sortiert nach Spezifität (spezifischste zuerst),
// damit "+2 Damage with thrown weapons" nicht versehentlich als
// generisches "+2 Damage" greift.

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
  return parts.join(' ')
}

function stripTags(s) {
  return String(s || '').replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
}

// Hilfs-Parser: zieht den signed-int-Wert aus einem Match-Group
// (kann "+2", "2", "-1" sein).
function toInt(s) {
  if (s == null) return 0
  const m = String(s).match(/^([+-]?)(\d+)/)
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10)
}

/**
 * Extrahiert mechanische Boni aus dem entries-Text eines Features.
 *
 * @param {object} feature  { entries, name? }
 * @returns {object} bonus record
 */
export function extractFeatureBonuses(feature) {
  if (!feature?.entries) return {}
  const raw = stripTags(flattenEntries(feature.entries))
  const text = raw.toLowerCase()
  const out = {}

  // ── AC ─────────────────────────────────────────────────────
  //   "+1 bonus to AC"  (Defense)
  //   "your AC increases by 1"
  //   "while you are wearing armor, you gain a +1 bonus to AC"
  {
    const m = text.match(/\+(\d+)\s+(?:bonus\s+to\s+)?ac\b/i)
      || text.match(/\bac\s+increases?\s+by\s+(\d+)/i)
    if (m) {
      out.acBonus = toInt(m[1])
      if (/wearing\s+armor|while\s+you\s+wear\s+armor/i.test(text)) {
        out.acBonusRequiresArmor = true
      }
    }
  }

  // ── Ranged Attack (Archery) ────────────────────────────────
  //   "You gain a +2 bonus to attack rolls you make with ranged weapons."
  // Beide Reihenfolgen abdecken: "+N … ranged" UND "ranged … +N".
  {
    const m = text.match(/\+(\d+)\s+(?:bonus\s+to\s+)?attack\s+rolls?\b[^.]*?\branged\s+(?:weapons?|attacks?)/i)
      || text.match(/\branged\s+(?:weapons?|attacks?)[^.]*?\+(\d+)\s+(?:bonus\s+to\s+)?attack\s+rolls?/i)
    if (m) out.rangedAttackBonus = toInt(m[1])
  }

  // ── Melee Attack ────────────────────────────────────────────
  //   "+1 bonus to attack rolls with melee weapons"  (rare; some homebrew)
  if (out.rangedAttackBonus == null) {
    const m = text.match(/\+(\d+)\s+(?:bonus\s+to\s+)?attack\s+rolls?\b[^.]*?\bmelee\s+(?:weapons?|attacks?)/i)
      || text.match(/\bmelee\s+(?:weapons?|attacks?)[^.]*?\+(\d+)\s+(?:bonus\s+to\s+)?attack\s+rolls?/i)
    if (m) out.meleeAttackBonus = toInt(m[1])
  }

  // ── Dueling: +N damage with one-handed melee, no other weapons ─
  //   Real text: "When you are wielding a melee weapon in one hand and
  //   no other weapons, you gain a +2 bonus to damage rolls with that
  //   weapon."
  // Wielding-Clause kommt VOR dem +N — Reverse-Pattern.
  {
    const m = text.match(/\b(?:wielding|holding)\s+(?:a\s+)?(?:melee\s+)?weapon\s+in\s+one\s+hand[^.]*?(?:no\s+other\s+weapons?|nothing\s+in\s+the\s+other)[^.]*?\+(\d+)\s+(?:bonus\s+(?:to\s+)?)?damage/i)
      || text.match(/\+(\d+)\s+(?:bonus\s+(?:to\s+)?)?damage[^.]*?\b(?:wielding|holding)\s+(?:a\s+)?(?:melee\s+)?weapon\s+in\s+one\s+hand[^.]*?(?:no\s+other\s+weapons?|nothing\s+in\s+the\s+other)/i)
    if (m) out.oneHandedMeleeDamageBonus = toInt(m[1])
  }

  // ── Thrown Weapon Fighting: +N damage with thrown weapons ──
  //   Real text: "…when you hit with a ranged attack using a thrown
  //   weapon, you gain a +2 bonus to the damage roll."
  {
    const m = text.match(/\bthrown\s+weapon(?:s)?[^.]*?\+(\d+)\s+(?:bonus\s+(?:to\s+)?)?(?:the\s+)?damage/i)
      || text.match(/\+(\d+)\s+(?:bonus\s+(?:to\s+)?)?damage[^.]*?\bthrown\s+(?:property\s+)?weapons?/i)
    if (m) out.thrownDamageBonus = toInt(m[1])
  }

  // ── Saving-Throw Bonus (Cloak of Protection-Schema, Aura-Style) ──
  //   "+N bonus to all saving throws"
  //   "you gain a +N bonus to saving throws"
  {
    const m = text.match(/\+(\d+)\s+(?:bonus\s+to\s+(?:all\s+)?)?saving\s+throws?/i)
    if (m) out.savingThrowBonus = toInt(m[1])
  }

  // ── Ability-Check Bonus ────────────────────────────────────
  {
    const m = text.match(/\+(\d+)\s+(?:bonus\s+to\s+(?:all\s+)?)?ability\s+checks?/i)
    if (m) out.abilityCheckBonus = toInt(m[1])
  }

  return out
}

/**
 * Aggregiert die Boni über ALLE aktiv-gewählten Features die der
 * Caller liefert (typisch: chosen optfeatures + chosen sub-features
 * + die Feature-Effekt-Notes). Aufaddiert wo numerisch.
 *
 * @param {Array<object>} features  Liste von Feature-Objekten mit `entries`
 * @returns {object} aggregierte Boni
 */
export function aggregateFeatureBonuses(features) {
  const total = {}
  const NUMERIC_KEYS = [
    'acBonus', 'rangedAttackBonus', 'meleeAttackBonus',
    'oneHandedMeleeDamageBonus', 'thrownDamageBonus',
    'savingThrowBonus', 'abilityCheckBonus',
  ]
  // Flags die OR-aggregiert werden (true sobald irgendein Feature
  // sie setzt).
  const FLAG_KEYS = ['acBonusRequiresArmor']

  for (const f of (features || [])) {
    if (!f) continue
    const b = extractFeatureBonuses(f)
    for (const k of NUMERIC_KEYS) {
      if (typeof b[k] === 'number') total[k] = (total[k] || 0) + b[k]
    }
    for (const k of FLAG_KEYS) {
      if (b[k]) total[k] = true
    }
  }
  return total
}
