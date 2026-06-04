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

// Liste aller derzeit equipped Items (Inventory + Custom). Reine
// Helper-Funktion; keine Side-Effects.
export function listEquippedItems(character) {
  const inv = Array.isArray(character?.inventory?.items) ? character.inventory.items : []
  const cus = Array.isArray(character?.custom?.items)   ? character.custom.items   : []
  return [...inv, ...cus].filter(i => i?.equipped)
}

// Summiert einen Bonus-Field-Namen über alle equipped Items. Bei
// Bedarf können Bonus-Items, die ATTUNEMENT erfordern, durch ein
// strict-Attune-Flag noch gefiltert werden — derzeit lassen wir
// equipped allein entscheiden (der Spieler markiert was er trägt).
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
export function getWeaponBonus(weapon) {
  if (!weapon) return { attack: 0, damage: 0 }
  const both    = parseBonusInt(weapon.bonusWeapon)
  const atkOnly = parseBonusInt(weapon.bonusWeaponAttack)
  const dmgOnly = parseBonusInt(weapon.bonusWeaponDamage)
  const legacy  = typeof weapon.attackBonus === 'number' ? weapon.attackBonus : 0
  return {
    attack: both + atkOnly + legacy,
    damage: both + dmgOnly + legacy,
  }
}
