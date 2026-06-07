// spellWeaponBuffs.js
//
// Catalog von Spells deren mechanischer Effekt eine EQUIPPED WAFFE
// buffed (Shillelagh, Magic Weapon, Magic Stone, Elemental Weapon …).
// Phase 6 — generischer Effect-Record-Pipeline. Eine neue Buff-Spell
// hinzufügen = ein Eintrag hier.
//
// Catalog-Eintrag pro Spell (key = lowercase spell name):
//   {
//     label,            // Display
//     duration,         // 'minute' | 'concentration-end' | 'long_rest' | …
//     weaponFilter,     // (item, character) => boolean — welche Waffen sind
//                       //   valide Ziele für diese Spell?
//     buildEffect,      // (character, weapon) => { kind, value }
//                       //   value enthält die strukturierten Overrides
//                       //   die rulesEngine.computeAttacks konsumiert:
//                       //     abilityOverride? — 'str'|'dex'|'wis'|'cha'|…
//                       //     damageDie?       — '1d8' (überschreibt dmg1)
//                       //     damageType?      — 'force' o.ä.
//                       //     attackBonus?     — flat +N
//                       //     damageBonus?     — flat +N
//                       //     magical?         — boolean (für DR-overcome)
//   }
//
// Datadriven — keine class-specific logic. Spellcasting-Ability
// (für Shillelagh / Magic Stone) wird über computed.spellcasting
// vom besten Caster der Klasse ermittelt.

const ANY = () => true

function pickSpellcastingAbility(character) {
  const sc = character?.computed?.spellcasting || {}
  // Bevorzugt Druid/Cleric/Warlock-Caster (für Shillelagh-Pfad).
  let bestAbility = null
  let bestScore = -Infinity
  for (const cid of Object.keys(sc)) {
    const stat = sc[cid]
    if (!stat?.ability) continue
    const score = (stat.spellSaveDC || 0) + (stat.spellAttackBonus || 0)
    if (score > bestScore) { bestScore = score; bestAbility = stat.ability }
  }
  return bestAbility || 'wis'
}

export const SPELL_WEAPON_BUFFS = {
  shillelagh: {
    label: 'Shillelagh',
    duration: 'minute',
    // Erlaubte Waffen: Club ODER Quarterstaff. itemId (kanonischer
    // Item-Name aus dem Datensatz) hat Vorrang, sonst Name-Substring.
    // Damit klappt's auch wenn der Spieler die Waffe customName-
    // umbenannt hat (z.B. "Ironbark" als Custom-Name für seinen
    // Quarterstaff).
    weaponFilter: (item) => {
      if (!item) return false
      const id = String(item.itemId || '').toLowerCase()
      if (id === 'club' || id === 'quarterstaff') return true
      const n = String(item.name || '').toLowerCase()
      return /\b(club|quarterstaff)\b/.test(n)
    },
    buildEffect: (character) => ({
      kind: 'shillelagh',
      value: {
        // 5e: WIS based, 1d8 magical force/bludgeoning. 5.5e: gleiche
        // mechanics, damageType force. Wir nehmen force (5.5e RAW);
        // 5e-Charaktere die's auf einem Quarterstaff-Treffer rollen
        // bekommen am Sheet immer noch die korrekten Numbers.
        abilityOverride: pickSpellcastingAbility(character),
        damageDie: '1d8',
        damageType: 'force',
        magical: true,
      },
    }),
  },
  'magic weapon': {
    label: 'Magic Weapon',
    duration: 'concentration-end',
    weaponFilter: ANY,
    buildEffect: (character) => {
      // 5e: scaling +1/+2/+3 mit Slot-Level. Wir nehmen den Default
      // +1; höhere Werte kommen über einen optionalen `slotLevel`-
      // Parameter (wird über updateActiveEffect nachträglich gesetzt).
      void character
      return {
        kind: 'magic-weapon',
        value: { attackBonus: 1, damageBonus: 1, magical: true },
      }
    },
  },
  'magic stone': {
    label: 'Magic Stone',
    duration: 'minute',
    // Magic Stone buffed thrown stones (pebbles). Weapon-Filter ist
    // bewusst lax — der Spieler entscheidet welche Inventory-Row die
    // "Magic Stone"-Munition repräsentiert.
    weaponFilter: (item) => /stone|pebble|sling/i.test(item?.name || ''),
    buildEffect: (character) => ({
      kind: 'magic-stone',
      value: {
        abilityOverride: pickSpellcastingAbility(character),
        damageDie: '1d6',
        damageType: 'bludgeoning',
        magical: true,
      },
    }),
  },
  'elemental weapon': {
    label: 'Elemental Weapon',
    duration: 'concentration-end',
    weaponFilter: (item) => !!item?.isWeapon,
    // Spell let den Spieler den Damage-Type beim Cast wählen — Modal
    // zeigt einen Picker mit diesen Optionen.
    damageTypeOptions: ['acid', 'cold', 'fire', 'lightning', 'thunder'],
    buildEffect: (character, weapon, opts = {}) => ({
      kind: 'elemental-weapon',
      value: {
        attackBonus: 1,
        damageBonus: 1,
        extraDamageDie: '1d4',
        // Beim Cast vom Modal gepickt, sonst Fire als Default.
        damageType: opts.damageType || 'fire',
        magical: true,
      },
    }),
  },
}

export function getSpellWeaponBuff(spellName) {
  if (!spellName) return null
  return SPELL_WEAPON_BUFFS[String(spellName).toLowerCase()] || null
}

// Liefert alle Waffen des Charakters die Filter-erlaubt sind. Wird
// vom UI-Picker konsultiert.
export function getEligibleWeapons(character, spellName) {
  const buff = getSpellWeaponBuff(spellName)
  if (!buff) return []
  const items = [
    ...((character?.inventory?.items) || []),
    ...((character?.custom?.items) || []),
  ]
  return items.filter(i => i?.isWeapon && buff.weaponFilter(i, character))
}
