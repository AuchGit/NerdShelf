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

import { dieFromScalingLevelDice } from './spellEffectParser'

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

function totalCharLevel(character) {
  return (character?.classes || []).reduce((s, c) => s + (c.level || 0), 0)
}

// Findet die Skalierungs-Würfel aus dem Spell-Daten. Erste Wahl: das
// 5.5e-strukturierte Feld `scalingLevelDice`. Fallback für 5e PHB-
// Spells deren Skalierung nur im Text steht: Regex auf "NdM ... at
// Lth level" / "NdM ... when you reach Lth level". Liefert die
// höchste Tier ≤ charLevel — sonst null.
function scaledDieFromSpell(spell, charLevel) {
  if (!spell) return null
  const fromStruct = dieFromScalingLevelDice(spell.scalingLevelDice, charLevel)
  if (fromStruct) return fromStruct
  const flat = (Array.isArray(spell.entries) ? spell.entries : [])
    .filter(e => typeof e === 'string').join(' ')
  if (!flat) return null
  const stripped = flat.replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
  const re = /(\d*d\d+)[^.]*?(?:at|when\s+you\s+reach)\s+(\d+)(?:st|nd|rd|th)?\s+level/gi
  let m, best = null
  while ((m = re.exec(stripped)) !== null) {
    const lvl = parseInt(m[2], 10)
    if (!Number.isFinite(lvl) || lvl > charLevel) continue
    if (best == null || lvl > best.lvl) best = { lvl, dice: m[1] }
  }
  return best?.dice || null
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
    buildEffect: (character, _weapon, opts = {}) => {
      // Würfel kommt aus dem Spell-Datensatz — kein Hardcode.
      // 5.5e XPHB Shillelagh trägt scalingLevelDice
      //   ({1:'1d8', 5:'1d10', 11:'1d12', 17:'2d6'}).
      // 5e PHB hat die Skalierung im Text — scaledDieFromSpell
      // parsed beide Formen. Fallback ist '1d8' falls der Spell
      // mal keine Skalierung im Datenformat trägt.
      const lvl = totalCharLevel(character)
      const die = scaledDieFromSpell(opts.spell, lvl) || '1d8'
      return {
        kind: 'shillelagh',
        value: {
          abilityOverride: pickSpellcastingAbility(character),
          damageDie: die,
          damageType: 'force',
          magical: true,
        },
      }
    },
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
