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

import { getClassTableDie, getClassTableValue, listClassTableColumns } from './classTableLookup'

// Default-Farbe pro Pill-Kind. Wird von den Renderern (Action-Row,
// Spell-Row, Favorite-Card, Class-Pick) konsultiert; pillColors aus
// den User-Settings überschreiben die jeweilige Damage-Type-Farbe via
// `pillColors[damage.<type>]`.
//
// Neue Kinds aus Phase 4: ac, damage-bonus, speed, advantage, resist,
// reroll, trigger, uses. Die alten kinds (attack, save, damage) leben
// weiter unter ihren Standardfarben.
const DEFAULT_KIND_COLORS = {
  attack:         'var(--accent-blue)',
  save:           'var(--accent-purple)',
  damage:         'var(--accent-red)',
  'damage-bonus': 'var(--accent-red)',
  ac:             'var(--accent-green)',
  speed:          'var(--accent-cyan, #4dd0e1)',
  advantage:      'var(--accent-yellow)',
  resist:         'var(--accent-blue)',
  reroll:         'var(--text-secondary)',
  trigger:        'var(--text-secondary)',
  uses:           'var(--accent-orange, #ff9533)',
  cost:           'var(--accent-yellow)',
  utility:        'var(--accent-cyan, #4dd0e1)',
  hits:           'var(--accent-yellow)',
  crit:           'var(--accent-red)',
  heal:           'var(--accent-green)',
}

/**
 * Liefert die anzuwendende Farbe für eine Pill. Reihenfolge:
 *   1. pillColors[pill.<kind>] — User-Setting falls vorhanden
 *   2. pillColors[damage.<damageType>] / DAMAGE_TYPE_COLOR — wenn die Pill
 *      damageType trägt (damage / damage-bonus / resist mit type)
 *   3. DEFAULT_KIND_COLORS[kind]
 *   4. 'var(--accent-red)' als letzter Fallback
 *
 * @param {object} pill — { kind, damageType? }
 * @param {object} pillColors — useSetting-Objekt
 * @param {object} damageTypeColorMap — Map { damageType → color }
 *                  (= DAMAGE_TYPE_COLOR aus spellEffectParser)
 */
export function pillColorForKind(pill, pillColors = {}, damageTypeColorMap = {}) {
  if (!pill) return 'var(--accent-red)'
  const k = pill.kind
  // 1) User-Override per Kind
  if (k && pillColors[`pill.${k}`]) return pillColors[`pill.${k}`]
  // 2) Damage-Type für damage/damage-bonus/resist
  if (pill.damageType) {
    if (pillColors[`damage.${pill.damageType}`]) return pillColors[`damage.${pill.damageType}`]
    if (damageTypeColorMap[pill.damageType]) return damageTypeColorMap[pill.damageType]
  }
  // 2b) Multi-Hit-Pill: Farbe nach targetKind (enemy=red, friend=green,
  //     neutral=yellow). Default fällt auf neutral.
  if (k === 'hits') {
    if (pill.targetKind === 'enemy')  return 'var(--accent-red)'
    if (pill.targetKind === 'friend') return 'var(--accent-green)'
    return 'var(--accent-yellow)'
  }
  // 3) Default pro Kind
  if (DEFAULT_KIND_COLORS[k]) return DEFAULT_KIND_COLORS[k]
  return 'var(--accent-red)'
}

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
  // d20 ist NIE Damage — es ist der Würfel für Attack/Save/Check-
  // Würfe. Manche Features (Hexblade's Curse: "critical hit on a roll
  // of 19 or 20 on the d20") werden sonst fälschlich als d20-Damage
  // angezeigt. Wir filtern jede `{@dice d20}`-Sequenz raus bevor wir
  // den Damage-Match versuchen.
  const dmgRelevantText = rawText.replace(/\{@(?:dice|damage)\s+d20[^}]*\}/gi, '')
  // Bevorzugt {@damage X|Y} oder {@dice NdM} Tag
  const tagMatch = dmgRelevantText.match(/\{@(?:damage|dice)\s+(\d*d\d+(?:\s*[+-]\s*\d+)?)(?:\|[^}]*)?\}\s*([A-Za-z]+)?/i)
  if (tagMatch) {
    const dice = tagMatch[1].trim()
    // Sicherheitscheck: kein d20 als Damage akzeptieren (zur Sicher-
    // heit doppelt — falls der Stripper-Filter mal nicht greift).
    if (/d20\b/i.test(dice)) {
      // Fallback in den verbleibenden Text springen
    } else {
      const possibleType = (tagMatch[2] || '').toLowerCase()
      const type = DAMAGE_TYPES.includes(possibleType) ? possibleType : null
      if (!type) {
        const after = dmgRelevantText.slice(tagMatch.index + tagMatch[0].length, tagMatch.index + tagMatch[0].length + 60)
        const t = after.match(new RegExp(`\\b(${DAMAGE_TYPES.join('|')})\\b`, 'i'))
        return { dice, type: t ? t[1].toLowerCase() : null }
      }
      return { dice, type }
    }
  }
  const stripped = stripTags(dmgRelevantText)
  const plain = stripped.match(new RegExp(
    `\\b(\\d*d\\d+(?:\\s*\\+\\s*\\d+)?)\\b[\\s,.;:-]*\\b(${DAMAGE_TYPES.join('|')})?`,
    'i',
  ))
  if (plain && !/d20\b/i.test(plain[1])) {
    return { dice: plain[1].replace(/\s+/g, ''), type: plain[2] ? plain[2].toLowerCase() : null }
  }
  return null
}

// Crit-Range-Erweiterung: "critical hit on a roll of 19 or 20 on the
// d20" (Hexblade's Curse), "score a critical hit on a roll of 19 or 20"
// (Champion Improved Critical), "18-20" (Superior Critical).
function findCritRangePill(stripped) {
  const m = stripped.match(/\bcritical\s+hit\s+on\s+a\s+roll\s+of\s+(\d+)(?:\s+(?:or|-)\s+(\d+))?/i)
  if (m) {
    const low = parseInt(m[1], 10)
    const high = m[2] ? parseInt(m[2], 10) : 20
    if (low > 0 && low < high) {
      return { label: `Crit ${low}-${high}`, title: `Critical hit on ${low}-${high}` }
    }
  }
  return null
}

// Vs-Target-Damage-Bonus: "bonus to damage rolls against the cursed
// target" / "additional damage against the target". Pattern matcht
// "bonus equals your proficiency bonus" oder "+N damage".
function findVsTargetDamagePill(stripped) {
  if (/\bbonus\s+to\s+damage\s+rolls?\s+against\s+the\s+(?:cursed|marked|chosen)\s+target\b/i.test(stripped)
      && /\bequals\s+your\s+proficiency\s+bonus\b/i.test(stripped)) {
    return { label: '+ProfBonus dmg', title: 'Bonus damage to attacks against the cursed target equal to your proficiency bonus' }
  }
  const m = stripped.match(/\+(\d+)\s+damage\s+(?:to|against)\s+(?:the\s+)?(?:cursed|marked|chosen)\s+target/i)
  if (m) {
    return { label: `+${m[1]} dmg vs target`, title: `+${m[1]} damage against the cursed/marked target` }
  }
  return null
}

// HP-Regen-On-Kill: "If the [cursed] target dies, you regain hit points"
// (Hexblade's Curse pattern).
function findRegenOnKillPill(stripped) {
  if (/\b(?:if|when)\s+the\s+(?:cursed|marked)?\s*target\s+dies[^.]*?(?:regain|gain)\s+(?:hit\s+points|hp)\b/i.test(stripped)) {
    return { label: 'HP on kill', title: 'Regain HP when the cursed/marked target dies' }
  }
  return null
}

// Class-Table-Skalierung: viele Features sagen "as shown in the X
// column of the Y table" und die echten Würfel-Werte stehen in
// classTableGroups[].rows[]. Wir extrahieren den Spalten-Namen aus dem
// Prosa-Text, schlagen ihn in der Class-Data nach und liefern den
// aktuellen Würfel für den Charakter-Level. Greift für: Sneak Attack
// (1d6→10d6), Bardic Inspiration Die (d6→d12), Monk Martial Arts Die
// (d4→d12), Sorcerer Sorcery Points, etc. — alle Features die ihren
// Wert per Tabelle skalieren.
//
// Pattern-Varianten die wir matchen:
//   "as shown in the <COL> column"
//   "as shown in the <COL> column of the Rogue/<Class> table"
//   "as shown in the <CLASS> table"     (Spalte = Feature-Name als Fallback)
//   "amount of the extra damage increases as you gain levels … <COL> column"
//
// Liefert { dice: 'NdF' } oder { value: N } (numerisch) oder null.
function findTableScaledValue(rawText, classData, classLevel, fallbackFeatureName) {
  if (!classData || !classLevel) return null
  const stripped = stripTags(rawText)
  // 1) Versuche explizit "the <COL> column" zu extrahieren.
  const colMatch = stripped.match(/\bthe\s+([A-Z][A-Za-z0-9. '-]+?)\s+column\b/)
  const candidates = []
  if (colMatch) candidates.push(colMatch[1].trim())
  // 2) Feature-Name als Spalten-Kandidat (Sneak Attack feature →
  //    Sneak Attack column). Häufiger Fall im 5etools-Datensatz.
  if (fallbackFeatureName) candidates.push(fallbackFeatureName)
  // 3) Substring-Suche: wenn der Text noch "X table"-Phrasen enthält,
  //    bei denen X != klassen-name, könnten andere Spalten gemeint
  //    sein. Wir gehen den Cataolog der Class-Spalten durch und
  //    schauen ob einer davon im strpped-Text vorkommt UND nicht
  //    "level"/"prof"/"feature" heißt (zu generische Spalten).
  for (const c of listClassTableColumns(classData)) {
    if (!c.stripped) continue
    if (['level', 'features', 'feature', 'cantrips known', 'spells known', 'spell slots'].includes(c.stripped)) continue
    if (stripped.toLowerCase().includes(c.stripped)) {
      // Nur addieren wenn nicht schon mit dem rohen Label da
      if (!candidates.some(x => x.toLowerCase() === c.stripped)) {
        candidates.push(c.label)
      }
    }
  }
  // Pro Kandidat: erst Dice probieren, dann numerischen Wert.
  for (const col of candidates) {
    const dice = getClassTableDie(classData, classLevel, col)
    if (dice) return { dice }
    const val = getClassTableValue(classData, classLevel, col)
    if (val != null) return { value: val }
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
// Liefert ein kurzes Label fürs Pill oder null. Patterns sortiert
// von spezifisch zu generisch — die Funktion returnt beim ersten
// Treffer. Damit gewinnt "When Damaged" gegen "On Hit" wenn beide
// Phrasen im selben Text vorkommen.
function detectTrigger(stripped) {
  if (/\bwhen\s+(?:another\s+)?creature\s+damages\s+you\b/i.test(stripped)) return 'When Damaged'
  if (/\bwhen\s+you\s+take\s+damage\b/i.test(stripped)) return 'When Damaged'
  if (/\bwhen\s+a\s+creature\s+misses\s+you\b/i.test(stripped)) return 'When Missed'
  if (/\bwhen\s+you\s+hit\s+(?:a\s+)?(?:creature|target)/i.test(stripped)) return 'On Hit'
  if (/\bon\s+a\s+hit\b/i.test(stripped)) return 'On Hit'
  if (/\bimmediately\s+after\s+you\s+hit\b/i.test(stripped)) return 'On Hit'
  if (/\bwhen\s+you\s+(?:make|hit\s+with)\s+a\s+(?:weapon|melee\s+weapon|ranged\s+weapon)\s+attack/i.test(stripped)) return 'On Hit'
  if (/\bwhen\s+you\s+make\s+a\s+weapon\s+attack\s+roll\b/i.test(stripped)) return 'On Attack'
  if (/\bwhen\s+a\s+creature\s+(?:hits\s+you|attacks\s+you)/i.test(stripped)) return 'When Hit'
  if (/\bwhen\s+you\s+(?:are\s+)?targeted\b/i.test(stripped)) return 'When Targeted'
  if (/\bwhen\s+you\s+(?:take\s+the\s+)?attack\s+action\b/i.test(stripped)) return 'On Attack Action'
  if (/\bwhen\s+a\s+creature\s+(?:that\s+)?you\s+can\s+see\s+(?:moves|attacks)/i.test(stripped)) return 'When Seen'
  if (/\bas\s+a\s+bonus\s+action\s+on\s+your\s+turn\b/i.test(stripped)) return 'BA · Your Turn'
  if (/\bas\s+a\s+bonus\s+action\b/i.test(stripped)) return 'Bonus Action'
  if (/\bas\s+a\s+reaction\b/i.test(stripped)) return 'Reaction'
  if (/\bon\s+your\s+turn\b/i.test(stripped)) return 'On Your Turn'
  return null
}

// Maneuver/Feature-Cost-Pill: "expend one superiority die" / "spend
// X ki points" / "spend X sorcery points" etc. Wird als knappes Cost-
// Pill ("1 SD" / "1 Ki" / "2 SP") angezeigt damit der Spieler sofort
// sieht was er ausgibt.
function detectCost(stripped) {
  if (/\bexpend\s+(?:one|two|three|four|\d+)\s+superiority\s+(?:die|dice)\b/i.test(stripped)) {
    const m = stripped.match(/\bexpend\s+(one|two|three|four|\d+)\s+superiority\s+(?:die|dice)\b/i)
    const n = m ? toIntWord(m[1]) : 1
    return { label: `${n} SD`, title: `Cost: ${n} superiority die${n > 1 ? '+' : ''}` }
  }
  if (/\bspend\s+(?:one|two|three|four|five|six|\d+)\s+(?:ki|focus)\s+points?\b/i.test(stripped)) {
    const m = stripped.match(/\bspend\s+(one|two|three|four|five|six|\d+)\s+(?:ki|focus)\s+points?\b/i)
    const n = m ? toIntWord(m[1]) : 1
    return { label: `${n} Ki`, title: `Cost: ${n} Ki / Focus Point${n > 1 ? 's' : ''}` }
  }
  if (/\bspend\s+(?:one|two|three|\d+)\s+sorcery\s+points?\b/i.test(stripped)) {
    const m = stripped.match(/\bspend\s+(one|two|three|\d+)\s+sorcery\s+points?\b/i)
    const n = m ? toIntWord(m[1]) : 1
    return { label: `${n} SP`, title: `Cost: ${n} Sorcery Point${n > 1 ? 's' : ''}` }
  }
  return null
}

// Tiny side-effect-pill for movement/utility maneuvers like Bait and
// Switch ("switch places with that creature"), Evasive Footwork
// ("rolling the die and adding to AC"), Lunging Attack ("increase
// your reach for that attack by 5 feet").
function detectUtility(stripped) {
  if (/\bswitch\s+places\s+with\b/i.test(stripped)) {
    return { label: 'Swap', title: 'Switch places with target' }
  }
  if (/\badding\s+the\s+(?:number\s+)?rolled\s+to\s+your\s+ac\b/i.test(stripped)) {
    return { label: '+AC roll', title: 'Add superiority die to AC' }
  }
  if (/\bincrease\s+your\s+reach\s+(?:for\s+that\s+attack\s+)?by\s+(\d+)\s+(?:feet|ft\.?)/i.test(stripped)) {
    const m = stripped.match(/\bincrease\s+your\s+reach\s+(?:for\s+that\s+attack\s+)?by\s+(\d+)\s+(?:feet|ft\.?)/i)
    return { label: `+${m[1]}ft Reach`, title: `Reach +${m[1]} ft this attack` }
  }
  return null
}

function toIntWord(w) {
  const map = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }
  if (typeof w !== 'string') return 0
  const lw = w.toLowerCase()
  if (map[lw] != null) return map[lw]
  const n = parseInt(w, 10)
  return Number.isNaN(n) ? 0 : n
}

// ── Micro-Pattern-Pills (Phase 4) ─────────────────────────
// Kleine, datadriven-extrahierte Pills für Feature-Effekte die der
// User auf einen Blick sehen will: Reroll, Resistance, Advantage,
// Speed-Bonus, AC-Bonus, Attack-Bonus, Damage-Bonus, Save-Bonus.
// Eine Pille pro Pattern; null wenn nicht gefunden.

// Great Weapon Fighting: "you can reroll the die" / "reroll the die
// and use the new roll" — meist mit "1 or 2 on a damage die" davor.
function findRerollPill(stripped) {
  const m = stripped.match(/\broll(?:ed)?\s+a\s+([\d\s,or]+)\s+on\s+a\s+damage\s+die[^.]*?\breroll\b/i)
    || stripped.match(/\breroll\s+(?:any\s+)?(\d+)s?\s+(?:and|or)\s+(\d+)s?\s+(?:on\s+)?(?:a\s+)?damage\s+dice/i)
  if (!m) {
    // Catch-all: "reroll the die" mit irgendwelchen 1/2-Schwellen davor
    if (/\breroll\s+the\s+die\b/i.test(stripped) && /\b1\s+or\s+2\b/i.test(stripped)) {
      return { label: 'Reroll 1-2', title: 'Reroll any 1s and 2s on damage dice (keep new roll)' }
    }
    return null
  }
  return { label: 'Reroll 1-2', title: 'Reroll low damage dice' }
}

// Damage-Resistance: "you have resistance to X damage"
function findResistancePill(stripped) {
  const m = stripped.match(/\bresistance\s+to\s+([a-z, ]+?)\s+damage\b/i)
  if (!m) return null
  // Kann eine Liste sein ("fire and cold damage"). Wir nehmen den
  // ersten Typ als Pill-Label und legen die Liste in den Tooltip.
  const list = m[1].split(/,|\band\b/i).map(s => s.trim()).filter(Boolean)
  const first = list[0]
  if (!first) return null
  return {
    label: `Resist ${first[0].toUpperCase()}${first.slice(1)}`,
    damageType: first.toLowerCase(),
    title: `Resistance to ${list.join(', ')} damage`,
  }
}

// Advantage-on: "advantage on X saving throws" / "advantage on X
// ability checks" / "advantage on X attack rolls"
function findAdvantagePill(stripped) {
  // Saving-Throw-Subject. "ability saves" is also matched (5.5e uses
  // "saving throws" mostly).
  const sv = stripped.match(/\badvantage\s+on\s+(?:all\s+)?([A-Za-z]+)\s+saving\s+throws?/i)
  if (sv) {
    const t = sv[1].toLowerCase()
    return { label: `Adv ${t.slice(0,3).toUpperCase()} Save`, title: `Advantage on ${t} saving throws` }
  }
  // Generic "advantage on saving throws against X"
  const sa = stripped.match(/\badvantage\s+on\s+saving\s+throws?\s+against\s+([^.,]{3,60})/i)
  if (sa) {
    return { label: 'Adv vs', title: `Advantage on saving throws against ${sa[1].trim()}` }
  }
  const at = stripped.match(/\badvantage\s+on\s+attack\s+rolls?\s+against\s+([^.,]{3,60})/i)
  if (at) {
    return { label: 'Adv Atk', title: `Advantage on attack rolls against ${at[1].trim()}` }
  }
  return null
}

// Speed-Bonus: "your speed increases by N feet" /
// "your walking speed is N feet" (absolute — ignorieren) /
// "+N feet to your walking speed"
function findSpeedPill(stripped) {
  const m = stripped.match(/\bspeed\s+increases?\s+by\s+(\d+)\s*(?:feet|ft\.?)/i)
    || stripped.match(/\+(\d+)\s*(?:feet|ft\.?)\s+to\s+your\s+(?:walking\s+)?speed/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return { label: `+${n}ft Speed`, title: `Speed +${n} ft` }
}

// AC-Bonus (mirrored from featureBonusExtractor — wir wollen die
// auch als Pille zum schnellen Lesen).
function findAcBonusPill(stripped) {
  const m = stripped.match(/\+(\d+)\s+(?:bonus\s+to\s+)?ac\b/i)
    || stripped.match(/\bac\s+increases?\s+by\s+(\d+)/i)
  if (!m) return null
  return { label: `+${m[1]} AC`, title: `+${m[1]} AC bonus` }
}

// Attack-Roll-Bonus mit Waffen-Typ-Kontext.
function findAttackBonusPill(stripped) {
  const ranged = stripped.match(/\+(\d+)\s+(?:bonus\s+to\s+)?attack\s+rolls?\b[^.]*?\branged\s+(?:weapons?|attacks?)/i)
    || stripped.match(/\branged\s+(?:weapons?|attacks?)[^.]*?\+(\d+)\s+(?:bonus\s+to\s+)?attack\s+rolls?/i)
  if (ranged) return { label: `+${ranged[1]} Ranged Atk`, title: `+${ranged[1]} attack rolls with ranged weapons` }
  const melee = stripped.match(/\+(\d+)\s+(?:bonus\s+to\s+)?attack\s+rolls?\b[^.]*?\bmelee\s+(?:weapons?|attacks?)/i)
    || stripped.match(/\bmelee\s+(?:weapons?|attacks?)[^.]*?\+(\d+)\s+(?:bonus\s+to\s+)?attack\s+rolls?/i)
  if (melee) return { label: `+${melee[1]} Melee Atk`, title: `+${melee[1]} attack rolls with melee weapons` }
  return null
}

// Damage-Bonus mit Waffen-Typ-Kontext.
function findDamageBonusPill(stripped) {
  // Thrown (Thrown Weapon Fighting)
  const thrown = stripped.match(/\bthrown\s+weapon(?:s)?[^.]*?\+(\d+)\s+(?:bonus\s+(?:to\s+)?)?(?:the\s+)?damage/i)
    || stripped.match(/\+(\d+)\s+(?:bonus\s+(?:to\s+)?)?damage[^.]*?\bthrown\s+(?:property\s+)?weapons?/i)
  if (thrown) return { label: `+${thrown[1]} Thrown Dmg`, title: `+${thrown[1]} damage with thrown weapons` }
  // Dueling / one-handed melee
  const dueling = stripped.match(/\b(?:wielding|holding)\s+(?:a\s+)?(?:melee\s+)?weapon\s+in\s+one\s+hand[^.]*?(?:no\s+other\s+weapons?|nothing\s+in\s+the\s+other)[^.]*?\+(\d+)\s+(?:bonus\s+(?:to\s+)?)?damage/i)
    || stripped.match(/\+(\d+)\s+(?:bonus\s+(?:to\s+)?)?damage[^.]*?\b(?:wielding|holding)\s+(?:a\s+)?(?:melee\s+)?weapon\s+in\s+one\s+hand[^.]*?(?:no\s+other\s+weapons?|nothing\s+in\s+the\s+other)/i)
  if (dueling) return { label: `+${dueling[1]} 1H Dmg`, title: `+${dueling[1]} damage with one-handed melee weapon (no other weapons)` }
  return null
}

// Saving-Throw-Bonus (flat: Cloak of Protection prose / Aura-style).
function findSaveBonusPill(stripped) {
  const m = stripped.match(/\+(\d+)\s+(?:bonus\s+to\s+(?:all\s+)?)?saving\s+throws?/i)
  if (!m) return null
  return { label: `+${m[1]} Saves`, title: `+${m[1]} bonus to all saving throws` }
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
 * @param {object} [opts]
 * @param {object} [opts.classDataMap] — { classId: classData } für die
 *   class-table-skalierten Werte (Sneak Attack, Bardic Inspiration,
 *   Martial Arts Die …). Wenn nicht übergeben, fallen wir auf die
 *   "increases to Xd Y when you reach …"-Prosa zurück; das catched
 *   weniger Features aber funktioniert ohne extra Data-Loads.
 */
export function parseFeatureEffect(feature, character, profBonus = 0, opts = {}) {
  if (!feature || !Array.isArray(feature.entries)) return { pills: [] }
  const rawText = flattenEntries(feature.entries)
  const stripped = stripTags(rawText)

  // Class-Level für die feature-besitzende Klasse (für Skalierung).
  let classLevel = 0
  if (feature.classId) {
    const cls = (character?.classes || []).find(c => c.classId === feature.classId)
    if (cls) classLevel = cls.level || 0
  }
  const classData = (feature.classId && opts?.classDataMap)
    ? opts.classDataMap[feature.classId] || null : null

  const pills = []

  // Trigger
  const trigger = detectTrigger(stripped)
  if (trigger) pills.push({ kind: 'trigger', label: trigger, title: trigger })

  // Cost (Superiority Die / Ki / Sorcery Point)
  const cost = detectCost(stripped)
  if (cost) pills.push({ kind: 'cost', ...cost })

  // Utility (Swap / +AC roll / +reach)
  const util = detectUtility(stripped)
  if (util) pills.push({ kind: 'utility', ...util })

  // Damage (mit Skalierung)
  const dmg = findFeatureDamage(rawText)
  if (dmg) {
    // Priorität:
    //   1. Class-Table-Lookup (Sneak Attack column, Bardic Die, …)
    //      — gibt den authoritative-Wert für den Charakter-Level.
    //   2. "increases to Xd Y when you reach Class level N" Prosa.
    //   3. Erstes {@damage}-Tag aus dem Text (= L1-Wert).
    let tableScaled = null
    if (classData && classLevel) {
      const t = findTableScaledValue(rawText, classData, classLevel, feature.name)
      if (t?.dice) tableScaled = t.dice
    }
    const scaledByProse = feature.classId
      ? findScaledDice(rawText, feature.classId, classLevel)
      : null
    const finalDice = tableScaled || scaledByProse || dmg.dice
    pills.push({
      kind: 'damage',
      label: finalDice,
      damageType: dmg.type,
      title: dmg.type
        ? `${finalDice} ${dmg.type}${(tableScaled || scaledByProse)
            ? ` (scaled at ${feature.classId} L${classLevel})` : ''}`
        : finalDice,
    })
  }

  // Micro-Pattern-Pills — Phase 4. Reihenfolge ist die Render-Reihen-
  // folge (Linke Pille zuerst). Bonus-Pillen vor Charge-Pillen, damit
  // "+2 Ranged Atk" / "+1 AC" / "Resist Fire" sofort ins Auge fällt.
  const acP = findAcBonusPill(stripped)
  if (acP) pills.push({ kind: 'ac', ...acP })
  const atkP = findAttackBonusPill(stripped)
  if (atkP) pills.push({ kind: 'attack', ...atkP })
  const dmgBonusP = findDamageBonusPill(stripped)
  if (dmgBonusP) pills.push({ kind: 'damage-bonus', ...dmgBonusP })
  const saveP = findSaveBonusPill(stripped)
  if (saveP) pills.push({ kind: 'save', ...saveP })
  const speedP = findSpeedPill(stripped)
  if (speedP) pills.push({ kind: 'speed', ...speedP })
  const advP = findAdvantagePill(stripped)
  if (advP) pills.push({ kind: 'advantage', ...advP })
  const resistP = findResistancePill(stripped)
  if (resistP) pills.push({ kind: 'resist', ...resistP })
  const rerollP = findRerollPill(stripped)
  if (rerollP) pills.push({ kind: 'reroll', ...rerollP })
  // Crit-Range / Vs-Target-Bonus / HP-on-Kill — Hexblade's Curse,
  // Champion's Improved/Superior Critical, Hunter's Mark, etc.
  const critP = findCritRangePill(stripped)
  if (critP) pills.push({ kind: 'crit', ...critP })
  const vsTargetP = findVsTargetDamagePill(stripped)
  if (vsTargetP) pills.push({ kind: 'damage-bonus', ...vsTargetP })
  const regenP = findRegenOnKillPill(stripped)
  if (regenP) pills.push({ kind: 'heal', ...regenP })

  // Charges — nur wenn das Feature keinen eigenen Resource-Pfad hat
  // (computeResources würde das sonst doppelt zeigen). Wir geben's
  // dem Renderer und lassen ihn entscheiden ob's noch gebraucht wird.
  // Class-Table-Wert hat Vorrang vor regex-uses (Wild Shape: Spalte
  // "Wild Shape", Channel Divinity: Spalte "Channel Divinity").
  let chargesValue = null
  if (classData && classLevel && feature.name && !dmg) {
    const t = findTableScaledValue('', classData, classLevel, feature.name)
    if (t?.value != null) chargesValue = t.value
  }
  if (chargesValue == null) chargesValue = findCharges(stripped, profBonus)
  if (chargesValue) {
    pills.push({
      kind: 'uses',
      label: `${chargesValue}×`,
      title: `${chargesValue} Uses`,
    })
  }

  return { pills }
}
