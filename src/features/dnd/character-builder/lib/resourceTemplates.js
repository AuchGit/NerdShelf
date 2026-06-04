// resourceTemplates.js
//
// Pro-Klasse-Resource-Definitionen für computeResources(). Ersetzt das
// hand-enumerierte switch(cls.classId) — eine neue Klasse hinzufügen
// = ein Eintrag im RESOURCE_TEMPLATES-Objekt.
//
// Jeder Eintrag ist eine Funktion `(ctx) => Resource[]`, die den
// context-Bag konsumiert:
//   {
//     level,        — int (class level)
//     modifiers,    — { str, dex, con, int, wis, cha }
//     profBonus,    — int
//     tv(col),      — table-value lookup (numeric or null)
//     td(col),      — table-die lookup ('1d6' or null)
//   }
//
// Resource-Records-Shape (gleich wie vorher):
//   {
//     id,            // unique key
//     name,          // display
//     max?,          // counted resource: max value
//     current?,      // current count (0 by default)
//     value?,        // passive readout (no max/min)
//     die?,          // 'NdF' for dice-based
//     type?,         // 'pool' | 'passive' | undefined (=counter)
//     recharge?,     // 'short_rest' | 'long_rest' | undefined
//     note?,         // free-text tooltip
//   }
//
// Wenn die Funktion `[]` zurückgibt, hat die Klasse auf diesem Level
// keine speziellen Resources — Recharge-Slots o.ä. werden separat
// verwaltet.

import {
  getBarbarianRages, getBarbarianRageDamage,
  getBardicInspirationDie, getMonkMartialArtsDie,
  getWarlockInvocations, getArtificerInfusions, getArtificerInfusedItems,
} from './rulesEngineFallbacks'

export const RESOURCE_TEMPLATES = {
  Barbarian: ({ level, tv }) => [
    { id: 'rage', name: 'Rages',
      max: tv('Rages') ?? getBarbarianRages(level),
      current: 0, recharge: 'long_rest' },
    { id: 'rage_damage', name: 'Rage Damage Bonus',
      value: `+${tv('Rage Damage') ?? getBarbarianRageDamage(level)}`,
      type: 'passive' },
  ],

  Bard: ({ level, modifiers, tv, td }) => [
    { id: 'bardic_inspiration', name: 'Bardic Inspiration',
      max: Math.max(1, modifiers.cha || 1),
      die: td('Bardic Die') ?? td('Bardic Insp. Die') ?? getBardicInspirationDie(level),
      current: 0,
      recharge: level >= 5 ? 'short_rest' : 'long_rest' },
  ],

  Cleric: ({ level, tv }) => [
    { id: 'channel_divinity', name: 'Channel Divinity',
      max: tv('Channel Divinity') ?? (level >= 18 ? 3 : level >= 6 ? 2 : 1),
      current: 0, recharge: 'short_rest' },
  ],

  Druid: ({ level, tv }) => [
    { id: 'wild_shape', name: 'Wild Shape',
      max: tv('Wild Shape') ?? (level >= 20 ? 99 : 2),
      current: 0, recharge: 'short_rest' },
  ],

  Fighter: ({ level, tv }) => {
    const out = [
      { id: 'second_wind', name: 'Second Wind',
        max: tv('Second Wind') ?? 1,
        current: 0, recharge: 'short_rest' },
    ]
    if (level >= 2) out.push({ id: 'action_surge', name: 'Action Surge',
      max: level >= 17 ? 2 : 1, current: 0, recharge: 'short_rest' })
    if (level >= 9) out.push({ id: 'indomitable', name: 'Indomitable',
      max: level >= 17 ? 3 : level >= 13 ? 2 : 1, current: 0, recharge: 'long_rest' })
    return out
  },

  Monk: ({ level, tv, td }) => {
    const points = tv('Focus Points') ?? tv('Ki Points') ?? level
    const maDie = td('Martial Arts') ?? `1${getMonkMartialArtsDie(level)}`
    return [
      { id: 'ki', name: tv('Focus Points') != null ? 'Focus Points' : 'Ki Points',
        max: points, current: 0, recharge: 'short_rest' },
      { id: 'martial_arts_die', name: 'Martial Arts Die', value: maDie, type: 'passive' },
    ]
  },

  Paladin: ({ level, tv }) => {
    const out = [
      { id: 'lay_on_hands', name: 'Lay on Hands',
        max: level * 5, current: 0, recharge: 'long_rest', type: 'pool' },
    ]
    if (level >= 2) out.push({ id: 'channel_divinity', name: 'Channel Divinity',
      max: tv('Channel Divinity') ?? (level >= 6 ? 2 : 1),
      current: 0, recharge: 'short_rest' })
    return out
  },

  Ranger: ({ level, profBonus, tv }) => {
    if (level < 1) return []
    return [
      { id: 'favored_foe', name: 'Favored Enemy',
        max: tv('Favored Enemy') ?? profBonus,
        current: 0, recharge: 'long_rest' },
    ]
  },

  Rogue: ({ level, td }) => {
    if (level < 1) return []
    const saDie = td('Sneak Attack') ?? `${Math.ceil(level / 2)}d6`
    return [
      { id: 'sneak_attack', name: 'Sneak Attack', value: saDie, type: 'passive' },
    ]
  },

  Sorcerer: ({ level, tv }) => [
    { id: 'sorcery_points', name: 'Sorcery Points',
      max: tv('Sorcery Points') ?? level,
      current: 0, recharge: 'long_rest' },
  ],

  Warlock: ({ level }) => {
    if (level < 2) return []
    const invocations = getWarlockInvocations(level)
    return [
      { id: 'eldritch_invocations', name: 'Eldritch Invocations',
        value: invocations, type: 'passive' },
    ]
  },

  Wizard: ({ level }) => [
    { id: 'arcane_recovery', name: 'Arcane Recovery',
      max: 1, value: Math.ceil(level / 2), current: 0, recharge: 'long_rest',
      note: `Recover up to ${Math.ceil(level / 2)} spell slot levels` },
  ],

  Artificer: ({ level }) => [
    { id: 'infusions', name: 'Infusions Known',
      value: getArtificerInfusions(level), type: 'passive' },
    { id: 'infused_items', name: 'Infused Items',
      max: getArtificerInfusedItems(level), type: 'passive' },
  ],
}
