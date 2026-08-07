// Datengetriebene RAW-Erkennung rund um Optfeature-Picks:
//   • computeOptionalFeatureGains.swapEveryLevel — „when you gain a level …
//     replace" (2014) / „Whenever you gain a <Class> level, you can replace"
//     (XPHB) erlaubt den Tausch bei JEDEM Level-Up; Battle-Master-Phrasing
//     („Whenever you learn new maneuvers …") bleibt beim newCount>0-Fenster.
//   • extractWeaponReq — Waffen-Anforderung eines On-Hit-Riders aus dem
//     Feature-Text (Sneak Attack „finesse or ranged").
import { describe, it, expect } from 'vitest'
import { computeOptionalFeatureGains } from '../levelUpEngine'
import { extractWeaponReq } from '../onHitRiders'

const warlockCd = {
  optionalfeatureProgression: [
    { name: 'Eldritch Invocations', featureType: ['EI'], progression: { 2: 2, 5: 3, 7: 4 } },
  ],
  features: [
    {
      name: 'Eldritch Invocations', level: 2,
      entries: ['Additionally, when you gain a level in this class, you can choose one of the invocations you know and replace it with another invocation that you could learn at that level.'],
    },
  ],
}

const battleMasterSub = {
  optionalfeatureProgression: [
    { name: 'Maneuvers', featureType: ['MV:B'], progression: { 3: 3, 7: 5 } },
  ],
  features: [
    {
      name: 'Maneuvers', level: 3,
      entries: ['Whenever you learn new maneuvers, you can also replace one maneuver you know with a different one.'],
    },
  ],
}

describe('computeOptionalFeatureGains: swapEveryLevel aus dem Feature-Text', () => {
  it('Invocations: Tausch bei jedem Level-Up, auch ohne neue Slots', () => {
    // L6: totalAtLevel 3, totalAtPrev 3 → newCount 0, aber Tausch erlaubt.
    const gains = computeOptionalFeatureGains(warlockCd, null, 6)
    const inv = gains.find(g => g.name === 'Eldritch Invocations')
    expect(inv).toBeTruthy()
    expect(inv.newCount).toBe(0)
    expect(inv.swapEveryLevel).toBe(true)
    expect(inv.canReplace).toBe(true)
  })
  it('Maneuvers (learn-new-Phrasing): kein Tausch ohne neue Slots', () => {
    const gains = computeOptionalFeatureGains({}, battleMasterSub, 5)
    const mv = gains.find(g => g.name === 'Maneuvers')
    expect(mv).toBeTruthy()
    expect(mv.newCount).toBe(0)
    expect(mv.swapEveryLevel).toBe(false)
    expect(mv.canReplace).toBe(false)
  })
  it('Maneuvers: beim Dazulernen bleibt canReplace erhalten', () => {
    const gains = computeOptionalFeatureGains({}, battleMasterSub, 7)
    const mv = gains.find(g => g.name === 'Maneuvers')
    expect(mv.newCount).toBe(2)
    expect(mv.canReplace).toBe(true)
  })
})

describe('extractWeaponReq: Waffen-Anforderung aus Rider-Text', () => {
  it('Sneak Attack: finesse ODER ranged', () => {
    const req = extractWeaponReq('Once per turn, you can deal an extra 1d6 damage. The attack must use a finesse or a ranged weapon.')
    expect(req.sort()).toEqual(['finesse', 'ranged'])
  })
  it('Dreadful Strikes: jede Waffe (keine Tokens)', () => {
    expect(extractWeaponReq('When you hit a creature with a weapon, you can deal an extra 1d4 psychic damage.')).toEqual([])
  })
  it('Improved Divine Smite: nur melee', () => {
    expect(extractWeaponReq('Whenever you hit a creature with a melee weapon attack, the creature takes an extra 1d8 radiant damage.')).toEqual(['melee'])
  })
})
