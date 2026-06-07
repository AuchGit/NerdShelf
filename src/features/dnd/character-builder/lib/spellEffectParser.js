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

// 5.5e Cantrips (und viele 5e-Cantrips über UA-Backports) tragen ein
// strukturiertes `scalingLevelDice`-Feld, das die EXAKTEN Würfel pro
// Level-Threshold liefert. Das überschreibt die generische
// Doppel-Multiplikator-Heuristik. Shillelagh ist das prominenteste
// Beispiel: 1d8 (L1) → 1d10 (L5) → 1d12 (L11) → 2d6 (L17). Die
// Standard-Cantrip-Logik würde fälschlich "2d8" am L5 ausgeben.
//
// Schema kann sein:
//   • Object:  { label, scaling: { '1': '1d8', '5': '1d10', ... } }
//   • Array:   [ { label: 'damage', scaling: {...} }, { label: '...' } ]
// Wir picken den Eintrag mit label='damage' (oder fallback erste).
// Anzahl-Treffer-/Ray-/Beam-/Dart-Erkennung. Liefert
// { count, upcast, targetKind, targetNote } wenn der Spell-Text auf
// einen Multi-Treffer- oder Multi-Target-Effekt hinweist (Scorching
// Ray, Eldritch Blast, Magic Missile, Bless, Bane, Aid, Slow, Hold
// Person mit single-target+humanoid …) — sonst null.
//
//   count       = Anzahl initialer Treffer (Char-Level-skaliert bei
//                 Cantrips wie Eldritch Blast)
//   upcast      = "+1/lvl" wenn höhere Slots zusätzliche Treffer geben
//   targetKind  = 'enemy' | 'friend' | 'neutral' — für Pill-Farbgebung
//   targetNote  = optionale Restriction-Beschreibung ("Humanoid only",
//                 "Willing creature") für Hover-Tooltip
//
// Patterns sind data-driven über den Entry-Text + 5etools-Strukturfelder
// (savingThrow / damageInflict / affectsCreatureType).
// `attacks?` bewusst NICHT in der Liste: "one attack" steht in vielen
// Non-Projektil-Spells (Slow: "can make only one attack") und würde
// fälschlich als 1-Treffer-Projektil gewertet — was Section 1b (Creature
// Targeting) für Slow / Hold Person / etc. unterdrückt.
const PROJECTILE_RE = '(?:rays?|beams?|darts?|bolts?|missiles?|orbs?|spheres?|projectiles?)'
const CREATURE_RE   = '(?:creatures?|targets?|allies|enemies)'
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10 }

// Heuristik für friend/enemy/neutral. 5etools-Strukturfelder zuerst,
// dann Textsignale.
function detectTargetKind(spell, text) {
  // Save = Gegner muss würfeln → typisch ENEMY (debuff / damage save)
  if (Array.isArray(spell?.savingThrow) && spell.savingThrow.length > 0) return 'enemy'
  if (Array.isArray(spell?.damageInflict) && spell.damageInflict.length > 0) return 'enemy'
  // Textsignale für FRIEND (Buffs / Heals / Beneficial Effects)
  if (/\bwilling\s+creatures?\b/i.test(text)) return 'friend'
  if (/\b(?:bless|imbue[sd]?\s+with|inspire|invigorate)\b/i.test(text)) return 'friend'
  if (/\bregain[s]?\s+(?:hit\s+points|hp)\b/i.test(text)) return 'friend'
  if (/\b(?:gains?|granting)\s+(?:temporary\s+hit\s+points|temp\s+hp)\b/i.test(text)) return 'friend'
  if (/\bhit\s+point[s]?\s+(?:maximum\s+)?(?:increase|gain)/i.test(text)) return 'friend'
  if (/\b(?:advantage|\+\d+\s+(?:to|bonus\s+to)\s+(?:ac|saving\s+throws?|attack\s+rolls?))\b/i.test(text)) return 'friend'
  if (/\bimmune\s+to\b/i.test(text)) return 'friend'
  // Textsignale für ENEMY (Damage / Restraint)
  if (/\b(?:deals?\s+\d*d?\d+\s+\w+\s+damage|takes?\s+\d*d?\d+\s+\w+\s+damage)\b/i.test(text)) return 'enemy'
  if (/\b(?:against\s+(?:the\s+)?target|against\s+a\s+creature)\b/i.test(text)) return 'enemy'
  return 'neutral'
}

// Restriction-Note für Hover (Humanoid only, Willing creature only, …).
function detectTargetRestriction(spell, text) {
  const parts = []
  // affectsCreatureType: Hold Person ['humanoid'], Charm Monster ['humanoid','fiend',...]
  if (Array.isArray(spell?.affectsCreatureType) && spell.affectsCreatureType.length > 0) {
    const cap = spell.affectsCreatureType.map(t => t[0].toUpperCase() + t.slice(1)).join(' / ')
    parts.push(`${cap} only`)
  }
  // Textsignale
  if (/\bwilling\s+creature\b/i.test(text) && !parts.some(p => /willing/i.test(p))) {
    parts.push('Willing creature only')
  }
  if (/\bnon-(?:humanoid|beast|elf|construct|undead)\b/i.test(text)) {
    const m = text.match(/\bnon-(\w+)\b/i)
    if (m) parts.push(`Non-${m[1][0].toUpperCase() + m[1].slice(1)} only`)
  }
  if (/\b(?:tiny|small\s+or\s+medium|small\s+or\s+smaller|medium\s+or\s+smaller)\s+(?:creatures?|targets?)\b/i.test(text)) {
    const m = text.match(/\b(tiny|small\s+or\s+medium|small\s+or\s+smaller|medium\s+or\s+smaller)\s+(?:creatures?|targets?)\b/i)
    if (m) parts.push(`Size: ${m[1]}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function findHitCount(spell, totalCharLevel) {
  if (!spell) return null
  const text = stripTags(flattenEntries(spell.entries))
    .replace(/\s+/g, ' ')

  // 1) Initialer Count aus "you hurl/create/conjure THREE rays" /
  //    "three glowing darts" / "you fire two bolts" etc. (Projektile)
  let baseCount = null
  const verbMatch = text.match(new RegExp(
    `\\byou\\s+(?:hurl|create|conjure|fire|launch|summon|throw)\\s+(\\w+)\\s+(?:glowing\\s+|fiery\\s+|crackling\\s+|magical\\s+|spectral\\s+)?${PROJECTILE_RE}`,
    'i',
  ))
  if (verbMatch) {
    const w = verbMatch[1].toLowerCase()
    baseCount = WORD_NUM[w] != null ? WORD_NUM[w] : (parseInt(w, 10) || null)
  }
  if (baseCount == null) {
    // Fallback ohne Verb-Anker (Magic Missile: "three glowing darts of …").
    const m = text.match(new RegExp(`\\b(${Object.keys(WORD_NUM).join('|')}|\\d+)\\s+(?:glowing\\s+|fiery\\s+|crackling\\s+|magical\\s+|spectral\\s+)?${PROJECTILE_RE}\\b`, 'i'))
    if (m) {
      const w = m[1].toLowerCase()
      baseCount = WORD_NUM[w] != null ? WORD_NUM[w] : (parseInt(w, 10) || null)
    }
  }

  // 1b) Creature/Target Targeting: "Choose up to three creatures",
  //     "Up to three creatures of your choice", "You bless up to N
  //     creatures", "alter time around up to six creatures".
  //     Wird nur ausgewertet wenn kein Projektil-Count gefunden wurde
  //     (manche Spells wie Magic Missile haben beides).
  if (baseCount == null) {
    const m = text.match(new RegExp(
      `\\b(?:choose|bless|target|alter\\s+time\\s+around|grant)\\s+(?:up\\s+to\\s+)?(\\w+)\\s+(?:other\\s+|willing\\s+|friendly\\s+)?${CREATURE_RE}\\b`,
      'i',
    )) || text.match(new RegExp(
      `\\bup\\s+to\\s+(\\w+)\\s+${CREATURE_RE}\\b`,
      'i',
    ))
    if (m) {
      const w = m[1].toLowerCase()
      const cnt = WORD_NUM[w] != null ? WORD_NUM[w] : parseInt(w, 10)
      if (Number.isFinite(cnt) && cnt > 1) baseCount = cnt
    }
  }

  // 2) Cantrip-Scaling für Projektile: "two beams at level 5, three
  //    beams at level 11, four beams at level 17" (Eldritch Blast).
  //    Sucht im Haupt-Text + entriesHigherLevel.
  if ((spell.level ?? 0) === 0) {
    const scanText = text + ' ' + stripTags(flattenEntries(spell.entriesHigherLevel))
    const re = new RegExp(`(${Object.keys(WORD_NUM).join('|')}|\\d+)\\s+${PROJECTILE_RE}\\s+at\\s+(?:level|(?:character\\s+)?level)\\s+(\\d+)`, 'gi')
    let m
    let bestLvl = 0
    let bestCount = baseCount || 1
    while ((m = re.exec(scanText)) !== null) {
      const w = m[1].toLowerCase()
      const cnt = WORD_NUM[w] != null ? WORD_NUM[w] : parseInt(w, 10)
      const lvl = parseInt(m[2], 10)
      if (!Number.isFinite(cnt) || !Number.isFinite(lvl)) continue
      if (lvl <= totalCharLevel && lvl > bestLvl) {
        bestLvl = lvl
        bestCount = cnt
      }
    }
    if (bestLvl > 0) baseCount = bestCount
    if (baseCount == null && /\b(?:a|one)\s+(?:beam|ray|dart|bolt|orb|sphere|missile)\b/i.test(text)) {
      baseCount = 1
    }
  }

  // Wenn nichts gefunden wurde, kein Multi-Hit-Pill.
  if (!baseCount || baseCount <= 1) return null

  // 3) Upcast-Skalierung extrahiert die TATSÄCHLICHE Steigerung:
  //    "one additional ray for each spell slot level above 2"     → +1
  //    "two more darts for each spell slot level above 1"         → +2
  //    "one additional creature for every two slot levels above"  → +1/2
  //    Matched sowohl Projektile als auch Creatures.
  const higherText = stripTags(flattenEntries(spell.entriesHigherLevel))
  const upcastMatch = higherText.match(new RegExp(
    `\\b(one|two|three|four|five|\\d+)\\s+(?:additional|more)\\s+(?:\\w+\\s+)?(?:${PROJECTILE_RE}|${CREATURE_RE})\\s+for\\s+(?:each|every)\\s+(?:(\\w+)\\s+)?(?:spell\\s+)?slot\\s+levels?\\s+above`,
    'i',
  ))
  let upcastSuffix = null
  if (upcastMatch) {
    const w = upcastMatch[1].toLowerCase()
    const inc = WORD_NUM[w] != null ? WORD_NUM[w] : parseInt(w, 10)
    // Optional: "every TWO slot levels above" → +N/2
    const perWord = (upcastMatch[2] || '').toLowerCase()
    const per = WORD_NUM[perWord] != null ? WORD_NUM[perWord] : (parseInt(perWord, 10) || 1)
    if (Number.isFinite(inc) && inc > 0) {
      upcastSuffix = per > 1 ? `+${inc}/${per}` : `+${inc}`
    }
  }

  // Targeting-Kind + Restriction für Pill-Farbe und Hover.
  const targetKind = detectTargetKind(spell, text)
  const targetNote = detectTargetRestriction(spell, text)

  return {
    count: baseCount,
    upcast: upcastSuffix,
    targetKind,
    targetNote,
  }
}

function dieFromScalingLevelDice(scalingLevelDice, charLevel) {
  if (!scalingLevelDice) return null
  const arr = Array.isArray(scalingLevelDice) ? scalingLevelDice : [scalingLevelDice]
  const block = arr.find(b => /damage/i.test(b?.label || '')) || arr[0]
  if (!block?.scaling || typeof block.scaling !== 'object') return null
  // Höchster Threshold ≤ charLevel.
  let best = null
  for (const [lvlStr, dice] of Object.entries(block.scaling)) {
    const lvl = parseInt(lvlStr, 10)
    if (!Number.isFinite(lvl) || lvl > charLevel) continue
    if (best == null || lvl > best.lvl) best = { lvl, dice: String(dice) }
  }
  return best?.dice || null
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

  // Multi-Hit ZUERST berechnen, weil damage-Skalierung das Wissen
  // braucht: wenn ein Cantrip multi-hit ist (Eldritch Blast: 1d10
  // PRO BEAM, mehr Beams mit Level), darf die generische
  // "1 → 2 → 3 → 4 Würfel" Skalierung NICHT angewendet werden.
  const hits = findHitCount(spell, totalCharLevel)

  // ── Damage + Upcast ──────────────────────────────────────────
  let damage = null
  const firstDmg = findFirstDamage(rawText)
  // Strukturierte scalingLevelDice hat Vorrang vor Text-Damage —
  // selbst wenn `{@dice d8}` im Text steht, gewinnt die Tabellen-
  // Variante für Shillelagh / Booming Blade / Sword Burst / Magic
  // Stone (alle Cantrips mit nicht-Standard-Progression).
  const scalingDie = (spell.level ?? 0) === 0
    ? dieFromScalingLevelDice(spell.scalingLevelDice, totalCharLevel)
    : null
  if (firstDmg || scalingDie) {
    let diceDisplay
    if (scalingDie) {
      diceDisplay = scalingDie
    } else if ((spell.level ?? 0) === 0 && !hits) {
      // Cantrip-Skalierung: nur bei Level-0-Spells OHNE Multi-Hit-
      // Skalierung. Eldritch Blast multipliziert die Anzahl der
      // Beams (über hits), nicht die Würfel-Anzahl pro Beam.
      diceDisplay = scaleCantripDice(firstDmg.dice, totalCharLevel)
    } else {
      diceDisplay = firstDmg.dice
    }
    damage = {
      dice: diceDisplay,
      type: firstDmg?.type || null,
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
  // Multi-Hit / Multi-Target — Scorching Ray, Eldritch Blast,
  // Magic Missile, … Pille kommt direkt VOR der Damage-Pille damit
  // klar ist: "3x · 2d6 fire" = 3 Treffer à 2d6 Schaden pro Treffer
  // (nicht 6d6 zusammen).
  // `hits` wurde oben schon berechnet damit die Damage-Skalierung
  // weiß ob sie den generischen Cantrip-Multiplier überspringen soll.
  if (hits) {
    // Tooltip enthält Restriction + Targeting-Kind. Renderer benutzt
    // p.targetKind ('enemy'|'friend'|'neutral') zum Einfärben der Pille.
    const kindLabel = hits.targetKind === 'enemy' ? 'Enemy targets'
      : hits.targetKind === 'friend' ? 'Friendly targets'
      : 'Any creature'
    const tipParts = [
      `${hits.count}× targets`,
      kindLabel,
      hits.upcast ? `Upcast: ${hits.upcast}` : null,
      hits.targetNote || null,
    ].filter(Boolean)
    pills.push({
      kind: 'hits',
      label: `${hits.count}x${hits.upcast ? ` (${hits.upcast})` : ''}`,
      title: tipParts.join(' · '),
      targetKind: hits.targetKind,
      targetNote: hits.targetNote,
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
        ? `${damage.dice} ${damage.type}${damage.upcast ? ` · upcast ${damage.upcast}` : ''}${hits ? ` · pro Treffer (${hits.count}× insgesamt)` : ''}`
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
