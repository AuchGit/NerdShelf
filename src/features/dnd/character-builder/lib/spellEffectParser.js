// spellEffectParser.js
//
// Smart-Extraktion der mechanischen Eckdaten aus 5etools-Spell-
// Daten — alles über Regex / Strukturanalyse, kein Spell-Whitelist.
//
// Returns für jeden Spell:
//   {
//     attack:  null | { kind: 'melee'|'ranged', bonus: number }
//     save:    null | { ability: 'dex'|'str'|'con'|'int'|'wis'|'cha', dc: number }
//     damage:  null | { dice: string, type: string|null, upcast: string|null }
//     summary: ein paar kompakte Pill-Strings für das UI
//   }
//
// Inputs:
//   spell        — das 5etools-Spell-Objekt (von loadSpellList)
//   spellcasting — der Output von computeSpellcasting() für die
//                  Caster-Klasse des Spells: { spellAttackBonus, saveDC,
//                  abilityMod, modifier }. Damit kommen Attack-Bonus
//                  und Save-DC aus der korrekten Klasse (multiclass-sauber).
//   caster       — { classId, classLevel, casterAbilityMod } — wird für
//                  Cantrip-Damage-Skalierung gebraucht.

const SCHOOLS_ABILITIES = ['dex', 'str', 'con', 'int', 'wis', 'cha']
const DAMAGE_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
]

function stripTags(s) {
  return String(s || '')
    // {@scaledamage 3d6|1-9|1d6}  → 3d6 (BASE), 3. Arg ist Per-Level
    // {@scaledice  1d6|1-9|1d6}   → ditto
    // Im Upcast-Pfad will man explizit den 3. Arg = Increment, das
    // macht parseUpcast separat. Hier liefert stripTags den Display-
    // Wert = den Basis-Würfel.
    .replace(/\{@(?:scaledamage|scaledice)\s+([^|}]+)\|[^|}]*\|[^}]*\}/g, '$1')
    .replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
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

// Damage-Token aus dem Originaltext extrahieren (BEVOR die Tags
// gestripped werden), damit `{@damage 1d10}` zuerst gewinnt und nicht
// gegen "in 1d10 minutes" o.ä. konkurriert. Liefert das erste Damage-
// Token im Text und (wenn erkennbar) den Damage-Type direkt danach.
function findFirstDamage(rawText) {
  // 1. Bevorzugt {@damage ...} und {@dice ...} Tags
  const tagMatch = rawText.match(/\{@(?:damage|dice)\s+([^|}]+)(?:\|[^}]*)?\}/i)
  if (tagMatch) {
    const dice = tagMatch[1].trim()
    // Damage-Type direkt nach dem Tag suchen
    const after = rawText.slice(tagMatch.index + tagMatch[0].length, tagMatch.index + tagMatch[0].length + 60)
    const typeMatch = after.match(new RegExp(`\\b(${DAMAGE_TYPES.join('|')})\\b`, 'i'))
    return { dice, type: typeMatch ? typeMatch[1].toLowerCase() : null }
  }
  // 2. Plain "1d8 fire" Pattern als Fallback
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

// Upcast-Beschreibung: "The damage increases by 1d10 for each spell
// slot level above 1" → "+1d10 / level"
// 5etools entriesHigherLevel ist meist eine Liste mit einem entries-
// Block. Wir nehmen den Text raus und suchen die Pattern.
function parseUpcast(spell) {
  const hl = spell?.entriesHigherLevel
  if (!Array.isArray(hl) || hl.length === 0) return null
  const rawText = flattenEntries(hl)
  // Bevorzugt: {@scaledamage base|range|increment} hat den Increment
  // im DRITTEN Argument. Direkt rausfischen, dann ist der Wert
  // unabhängig von der umgebenden Sprache ("increases by …" /
  // "deals an additional …" /  "extra …") korrekt.
  const scaleTag = rawText.match(/\{@(?:scaledamage|scaledice)\s+[^|}]+\|[^|}]*\|([^}]+)\}/i)
  if (scaleTag) return `+${scaleTag[1].trim()}`
  // Fallback: Plain-Text-Pattern. Hier nehmen wir den Dice-Token DIREKT
  // nach dem "increases by" / "additional" / "extra" — was meistens
  // schon der Increment ist (z.B. "increases by 1d6 for each slot
  // level above 1st").
  const text = stripTags(rawText)
  if (!text) return null
  const inc = text.match(/(?:increases?\s+by|additional|extra)\s+(\d*d\d+)/i)
  if (!inc) return null
  return `+${inc[1]}`
}

// Cantrip-Damage skaliert nach Character-Level (nicht Class-Level!).
// 5e/5.5e Pattern: 1 Würfel bis L4, 2 ab L5, 3 ab L11, 4 ab L17.
// Wenn der Cantrip-Text das so beschreibt ("the damage increases by
// 1d8 when you reach 5th level (2d8), 11th level (3d8), and 17th
// level (4d8)") können wir den Multiplikator direkt rausparsen.
function scaleCantripDice(diceToken, charLevel) {
  if (!diceToken) return diceToken
  const m = String(diceToken).match(/^(\d*)d(\d+)$/i)
  if (!m) return diceToken
  const die = parseInt(m[2], 10)
  let count = parseInt(m[1] || '1', 10)
  // Standardprogression — 5e RAW. Wenn der Cantrip eine andere
  // Progression hat (z.B. Eldritch Blast = strict beam-doubling),
  // sollte der Cantrip-Text das im entriesHigherLevel präzisieren —
  // den parsen wir hier nicht im Detail, der Default-Pfad reicht
  // für ~95% der Cantrips.
  if (charLevel >= 17) count = 4
  else if (charLevel >= 11) count = 3
  else if (charLevel >= 5) count = 2
  else count = 1
  return `${count}d${die}`
}

/**
 * Hauptfunktion: aus einem Spell + Caster-Context die Pill-Daten holen.
 *
 * @param {object} spell                  — 5etools spell object
 * @param {object} [opts]
 * @param {number} [opts.spellAttackBonus] — z.B. +7
 * @param {number} [opts.saveDC]           — z.B. 15
 * @param {number} [opts.totalCharLevel]   — für Cantrip-Skalierung
 * @param {boolean} [opts.preferEntriesHigherLevelForUpcast=true]
 */
export function parseSpellEffect(spell, opts = {}) {
  if (!spell) return null
  const {
    spellAttackBonus = null,
    saveDC = null,
    totalCharLevel = 1,
  } = opts

  const rawText = flattenEntries(spell.entries)
  const text = stripTags(rawText)

  // ── Attack erkennen ──────────────────────────────────────────
  // "Make a ranged spell attack" / "make a melee spell attack against"
  let attack = null
  // 5etools annotiert das oft auch direkt: spell.spellAttack: ["R"]/"M"
  if (Array.isArray(spell.spellAttack) && spell.spellAttack.length > 0) {
    const code = String(spell.spellAttack[0]).toUpperCase()
    attack = {
      kind: code === 'M' ? 'melee' : 'ranged',
      bonus: spellAttackBonus,
    }
  } else if (/\bmake\s+a\s+ranged\s+spell\s+attack/i.test(text)) {
    attack = { kind: 'ranged', bonus: spellAttackBonus }
  } else if (/\bmake\s+a\s+melee\s+spell\s+attack/i.test(text)) {
    attack = { kind: 'melee',  bonus: spellAttackBonus }
  }

  // ── Save erkennen ────────────────────────────────────────────
  // 5etools annotiert die Save-Ability oft als spell.savingThrow:
  //   ['dexterity'] / ['constitution'] / …
  let save = null
  if (Array.isArray(spell.savingThrow) && spell.savingThrow.length > 0) {
    const a = String(spell.savingThrow[0]).slice(0, 3).toLowerCase()
    if (SCHOOLS_ABILITIES.includes(a)) save = { ability: a, dc: saveDC }
  } else {
    const m = text.match(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving\s+throw/i)
    if (m) {
      save = { ability: m[1].slice(0, 3).toLowerCase(), dc: saveDC }
    }
  }

  // ── Damage + Upcast ──────────────────────────────────────────
  let damage = null
  const firstDmg = findFirstDamage(rawText)
  if (firstDmg) {
    let diceDisplay = firstDmg.dice
    // Cantrip-Skalierung: nur bei Level-0-Spells und nur wenn das
    // Token "1d…" oder "d…" ist (Cantrips ohne ability-mod). Spells
    // ab Level 1 skalieren via Slot, nicht via Charlevel.
    if ((spell.level ?? 0) === 0) {
      diceDisplay = scaleCantripDice(firstDmg.dice, totalCharLevel)
    }
    damage = {
      dice: diceDisplay,
      type: firstDmg.type,
      upcast: parseUpcast(spell),
    }
  }

  // ── Healing-Erkennung ────────────────────────────────────────
  // Wenn der Spell-Text "regain hit points" / "heal" / "restore hit
  // points" / "regains hit points" enthält UND wir kein damage-Type
  // gefunden haben, ist's vermutlich ein Healing-Spell. Damage-Pill
  // bekommt dann türkisgrüne Healing-Farbe statt rot.
  // Cure-Wounds-Pattern hat das Damage-Token ohne Type weil 5etools
  // healing nicht als damage-Type listet.
  const isHealing = damage && !damage.type
    && /\b(?:regain|recover|restore)s?\s+(?:[a-z\s]+?\s+)?hit\s+points\b/i.test(text)
  if (isHealing) damage.type = 'healing'

  // ── Kompakte Pill-Strings fürs UI ────────────────────────────
  const pills = []
  if (attack) {
    pills.push({
      kind: 'attack',
      label: attack.kind === 'melee' ? 'Melee' : 'Atk',
      value: attack.bonus != null ? `${attack.bonus >= 0 ? '+' : ''}${attack.bonus}` : '?',
      title: `${attack.kind === 'melee' ? 'Melee' : 'Ranged'} Spell Attack`,
    })
  }
  if (save) {
    pills.push({
      kind: 'save',
      label: save.ability.toUpperCase(),
      value: save.dc != null ? String(save.dc) : '?',
      title: `${save.ability.toUpperCase()} Save DC`,
    })
  }
  if (damage) {
    const parts = [damage.dice]
    if (damage.upcast) parts.push(`(${damage.upcast})`)
    pills.push({
      kind: 'damage',
      label: parts.join(' '),
      value: null,
      damageType: damage.type,
      title: damage.type
        ? `${damage.dice} ${damage.type}${damage.upcast ? ` · upcast ${damage.upcast}` : ''}`
        : damage.dice,
    })
  }

  return { attack, save, damage, pills }
}

// Farbe pro Damage-Type — für die Pill-Hervorhebung. Hält sich an die
// Farbpalette die `DMG_TYPE_COLOR` in OverviewTab.jsx schon nutzt.
// "healing" ist kein offizieller 5etools-Damage-Type sondern wird vom
// Parser für Spells synthesisiert die HP wiederherstellen statt
// Schaden machen — eigene Türkis-Grün-Farbe damit Healer-Spells in
// der Action-Spalte auf einen Blick erkennbar sind.
export const DAMAGE_TYPE_COLOR = {
  acid:        '#7bc950',
  bludgeoning: '#8a8a8a',
  cold:        '#7dd3fc',
  fire:        '#ff6b35',
  force:       '#c084fc',
  lightning:   '#fbbf24',
  necrotic:    '#1f2937',
  piercing:    '#9ca3af',
  poison:      '#84cc16',
  psychic:     '#ec4899',
  radiant:     '#fcd34d',
  slashing:    '#a8a29e',
  thunder:     '#60a5fa',
  healing:     '#5eead4',
}
