// itemBonuses.js
//
// 5etools-Items tragen magische Boni in spezifischen Feldern:
//
//   bonusAc            "+1"   — addiert auf AC (Cloak of Protection,
//                                Ring of Protection, +N Armor, +N Shield)
//   bonusWeapon        "+1"   — addiert AUF attack UND damage (klassisch
//                                "+N Weapon")
//   bonusWeaponAttack  "+1"   — nur Attack-Roll
//   bonusWeaponDamage  "+1"   — nur Damage
//   bonusSpellAttack   "+1"   — Spell-Attack-Rolls (Robe of the Archmagi,
//                                +N Spellcasting Focus, Staff of Power)
//   bonusSpellSaveDc   "+1"   — Spell-Save-DC
//   bonusSavingThrow   "+1"   — alle Saving Throws (Cloak/Ring of
//                                Protection, Robe of the Archmagi)
//   bonusAbilityCheck  "+1"   — alle Ability Checks
//
// Diese Helper parsen die Werte (Strings wie "+1", "-1") und liefern die
// summierten Boni für alle EQUIPPED Items eines Charakters. Items
// aus character.inventory.items UND character.custom.items werden zu
// EINER Liste vereint (gleicher Treatment wie in rulesEngine's AC- und
// Weapon-Logik).

// Parsen "+1" / "-1" / "+2" → integer; ungültiges → 0.
export function parseBonusInt(raw) {
  if (raw == null) return 0
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw) : 0
  if (typeof raw !== 'string') return 0
  const m = raw.trim().match(/^([+-]?)(\d+)/)
  if (!m) return 0
  const sign = m[1] === '-' ? -1 : 1
  return sign * parseInt(m[2], 10)
}

// Ist das Item attunement-bedürftig?
//   reqAttune = true → braucht generelle Attunement
//   reqAttune = "by a wizard" → braucht Class-Restricted Attunement
//   reqAttune = null/false → kein Attunement nötig (z.B. mundane Waffen)
export function requiresAttunement(item) {
  return !!item?.reqAttune
}

// Aktiv-Gate: Item gilt nur dann als "aktiv" (zählt für Boni / Actions),
// wenn es EQUIPPED ist UND — falls reqAttune gesetzt — auch ATTUNED.
// Mundane Items (kein reqAttune) reichen mit equipped.
export function isItemActive(item) {
  if (!item?.equipped) return false
  if (requiresAttunement(item) && !item.attuned) return false
  return true
}

// Liste aller derzeit aktiven Items (Inventory + Custom). Items die
// reqAttune tragen aber NICHT attuned sind, werden ausgeschlossen — die
// Boni dürfen erst greifen wenn der Spieler beide Voraussetzungen
// erfüllt (RAW: "while attuned"-Klausel auf jedem magischen Item).
export function listEquippedItems(character) {
  const inv = Array.isArray(character?.inventory?.items) ? character.inventory.items : []
  const cus = Array.isArray(character?.custom?.items)   ? character.custom.items   : []
  return [...inv, ...cus].filter(isItemActive)
}

// Summiert einen Bonus-Field-Namen über alle aktiven Items.
export function sumEquippedBonuses(character, field) {
  let total = 0
  const sources = []
  for (const it of listEquippedItems(character)) {
    const v = parseBonusInt(it?.[field])
    if (v !== 0) {
      total += v
      sources.push({ name: it.name, value: v })
    }
  }
  return { total, sources }
}

// Boni einer einzelnen Waffe (legacy `attackBonus` als Fallback wenn
// jemand den Wert manuell in CustomEdit setzt; sonst die 5etools-
// Felder). bonusWeapon zählt für BEIDE — attack und damage.
// Attunement-gated: wenn die Waffe reqAttune trägt aber nicht attuned
// ist, geben wir 0/0 zurück — kein magischer Bonus ohne Attunement.
export function getWeaponBonus(weapon) {
  if (!weapon) return { attack: 0, damage: 0 }
  if (requiresAttunement(weapon) && !weapon.attuned) {
    return { attack: 0, damage: 0 }
  }
  const both    = parseBonusInt(weapon.bonusWeapon)
  const atkOnly = parseBonusInt(weapon.bonusWeaponAttack)
  const dmgOnly = parseBonusInt(weapon.bonusWeaponDamage)
  const legacy  = typeof weapon.attackBonus === 'number' ? weapon.attackBonus : 0
  return {
    attack: both + atkOnly + legacy,
    damage: both + dmgOnly + legacy,
  }
}
