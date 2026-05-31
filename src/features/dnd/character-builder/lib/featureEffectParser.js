// featureEffectParser.js
//
// Parst mechanische Eckdaten aus Class-/Subclass-/Feat-Feature-Texten:
//   • Damage-Würfel + Type (+ Class-Level-Skalierung)
//   • Trigger-Art (On-Hit / On-Save / Free / …)
//   • Charges / Uses (kompakt, ohne den Class-Resource-Synthesizer
//     zu duplizieren)
//
// Datengetrieben — kein Featurename, keine Klassen-Whitelist; nur
// Regex-Patterns die das übliche 5etools-Phrasing matchen.
//
// Output:
//   { pills: [{ kind, label, color?, title? }] }

const DAMAGE_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
]

function stripTags(s) {
  return String(s || '').replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
}

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

// "deal an extra 1d4 Psychic damage" → { dice: '1d4', type: 'psychic' }
// "1d10 piercing damage" → { dice: '1d10', type: 'piercing' }
// Pure first-hit — bei Multi-Damage-Features pickt's das prominenteste
// (= erstgenanntes) Pattern.
function findFeatureDamage(rawText) {
  // Bevorzugt {@damage X|Y} Tag
  const tagMatch = rawText.match(/\{@(?:damage|dice)\s+([^|}]+)(?:\|[^}]*)?\}\s*([A-Za-z]+)?/i)
  if (tagMatch) {
    const dice = tagMatch[1].trim()
    const possibleType = (tagMatch[2] || '').toLowerCase()
    const type = DAMAGE_TYPES.includes(possibleType) ? possibleType : null
    if (!type) {
      // Probier weiter im Kontext: nach dem Tag könnte der Typ
      // einige Wörter später stehen.
      const after = rawText.slice(tagMatch.index + tagMatch[0].length, tagMatch.index + tagMatch[0].length + 60)
      const t = after.match(new RegExp(`\\b(${DAMAGE_TYPES.join('|')})\\b`, 'i'))
      return { dice, type: t ? t[1].toLowerCase() : null }
    }
    return { dice, type }
  }
  const stripped = stripTags(rawText)
  const plain = stripped.match(new RegExp(
    `\\b(\\d*d\\d+(?:\\s*\\+\\s*\\d+)?)\\b[\\s,.;:-]*\\b(${DAMAGE_TYPES.join('|')})?`,
    'i',
  ))
  if (plain) {
    return { dice: plain[1].replace(/\s+/g, ''), type: plain[2] ? plain[2].toLowerCase() : null }
  }
  return null
}

// Class-Level-Skalierung: "increases to Xd Y when you reach <Class>
// level N" — wenn der Character den Schwellenwert erreicht, ersetzen
// wir den Basis-Würfel mit der gestaffelten Variante.
// Liefert den Würfel ('1d6') ODER null wenn keine Skalierung greift.
function findScaledDice(rawText, classId, classLevel) {
  if (!classId || !classLevel) return null
  const stripped = stripTags(rawText)
  // Pattern: "increases to 1d6 when you reach Ranger level 11"
  // Mehrfach-Treffer möglich (Cantrip-artige Treppen), wir nehmen die
  // höchste anwendbare Stufe.
  const re = new RegExp(
    `\\bincreases?\\s+to\\s+(\\d*d\\d+)\\s+when\\s+you\\s+reach\\s+${classId}\\s+level\\s+(\\d+)`,
    'gi',
  )
  let best = null
  let m
  while ((m = re.exec(stripped)) !== null) {
    const threshold = parseInt(m[2], 10)
    if (!Number.isFinite(threshold)) continue
    if (classLevel >= threshold) {
      if (!best || threshold > best.level) best = { level: threshold, dice: m[1] }
    }
  }
  return best ? best.dice : null
}

// Trigger-Klassifizierung — was triggert das Feature?
// Liefert ein kurzes Label fürs Pill oder null.
function detectTrigger(stripped) {
  if (/\bwhen\s+you\s+hit\s+(?:a\s+)?(?:creature|target)/i.test(stripped)) return 'On Hit'
  if (/\bon\s+a\s+hit\b/i.test(stripped)) return 'On Hit'
  if (/\bwhen\s+you\s+(?:are\s+)?targeted\b/i.test(stripped)) return 'When Targeted'
  if (/\bwhen\s+a\s+creature\s+(?:hits\s+you|attacks\s+you)/i.test(stripped)) return 'When Hit'
  if (/\bwhen\s+you\s+take\s+damage\b/i.test(stripped)) return 'When Damaged'
  if (/\bwhen\s+you\s+(?:make|hit\s+with)\s+a\s+(?:weapon|melee\s+weapon|ranged\s+weapon)\s+attack/i.test(stripped)) return 'On Hit'
  return null
}

// Charges/Uses-Erkennung. "X charges" / "X uses per long rest" /
// "uses equal to your proficiency bonus" — gibt den Count und die
// Recharge zurück. Class-Resource-Synthesizer fängt die wichtigsten
// schon ab; das hier ist nur als kleines Pill-Hint für Features die
// keine eigene Resource-Karte emiten.
function findCharges(stripped, profBonus) {
  // "equal to your proficiency bonus"
  if (/\bequal\s+to\s+your\s+proficiency\s+bonus\b/i.test(stripped) && profBonus) {
    return profBonus
  }
  // Numerische "X times" / "X uses"
  const m = stripped.match(/\b(\d+)\s+(?:times|uses|charges)\b/i)
  if (m) return parseInt(m[1], 10)
  return null
}

/**
 * Hauptfunktion.
 * @param {object} feature           — { name, entries, classId, level, ... }
 * @param {object} character          — vollständiges Character-Objekt
 * @param {number} [profBonus]        — derzeitiger Proficiency-Bonus
 */
export function parseFeatureEffect(feature, character, profBonus = 0) {
  if (!feature || !Array.isArray(feature.entries)) return { pills: [] }
  const rawText = flattenEntries(feature.entries)
  const stripped = stripTags(rawText)

  // Class-Level für die feature-besitzende Klasse (für Skalierung).
  let classLevel = 0
  if (feature.classId) {
    const cls = (character?.classes || []).find(c => c.classId === feature.classId)
    if (cls) classLevel = cls.level || 0
  }

  const pills = []

  // Trigger
  const trigger = detectTrigger(stripped)
  if (trigger) pills.push({ kind: 'trigger', label: trigger, title: trigger })

  // Damage (mit Skalierung)
  const dmg = findFeatureDamage(rawText)
  if (dmg) {
    const scaled = feature.classId
      ? findScaledDice(rawText, feature.classId, classLevel)
      : null
    const finalDice = scaled || dmg.dice
    pills.push({
      kind: 'damage',
      label: finalDice,
      damageType: dmg.type,
      title: dmg.type
        ? `${finalDice} ${dmg.type}${scaled ? ` (scaled at ${feature.classId} L${classLevel})` : ''}`
        : finalDice,
    })
  }

  // Charges — nur wenn das Feature keinen eigenen Resource-Pfad hat
  // (computeResources würde das sonst doppelt zeigen). Wir geben's
  // dem Renderer und lassen ihn entscheiden ob's noch gebraucht wird.
  const charges = findCharges(stripped, profBonus)
  if (charges) {
    pills.push({
      kind: 'uses',
      label: `${charges}×`,
      title: `${charges} Uses`,
    })
  }

  return { pills }
}
