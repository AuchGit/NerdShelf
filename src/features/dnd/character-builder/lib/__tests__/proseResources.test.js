// Prosa-Resource-Synthesizer: Pools ohne Tabelle (Battle-Master-Superiority-
// Dice 2014+2024) und additive Feat-Grants (Metamagic Adept Sorcery Points).
// Läuft gegen die ECHTEN 5.5e-Datenfiles.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { computeResources } from '../rulesEngine'

const fighter = JSON.parse(readFileSync('public/data/5.5e/class/class-fighter.json', 'utf8'))
const feats = JSON.parse(readFileSync('public/data/5.5e/feats.json', 'utf8')).feat

const MODS = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }
const csXphb = fighter.subclassFeature.find((f) => f.name === 'Combat Superiority' && f.source === 'XPHB')
const csPhb = fighter.subclassFeature.find((f) => f.name === 'Combat Superiority' && f.source === 'PHB')
const metamagicAdept = feats.find((f) => f.name === 'Metamagic Adept')

const charWith = (feat, lvl) => ({
  classes: [{ classId: 'Fighter', level: lvl }],
  __activeFeatures: [{ classId: 'Fighter', name: feat.name, entries: feat.entries }],
})

describe('synthesizeFeatureProseResources (via computeResources)', () => {
  it('Battle Master XPHB: 4 Dice auf L3, 5 auf L7, 6 auf L15, short rest, d8', () => {
    for (const [lvl, want] of [[3, 4], [7, 5], [15, 6]]) {
      const res = computeResources(charWith(csXphb, lvl), MODS, 2, lvl, {})
      const sd = res.find((r) => /superiority dice/i.test(r.name))
      expect(sd, `L${lvl}`).toBeTruthy()
      expect(sd.max).toBe(want)
      expect(sd.recharge).toBe('short_rest')
      expect(sd.die).toBe('d8')
    }
  })

  it('Battle Master PHB (2014): 4 Dice auf L3, 5 auf L7', () => {
    for (const [lvl, want] of [[3, 4], [7, 5]]) {
      const sd = computeResources(charWith(csPhb, lvl), MODS, 2, lvl, {})
        .find((r) => /superiority dice/i.test(r.name))
      expect(sd, `L${lvl}`).toBeTruthy()
      expect(sd.max).toBe(want)
    }
  })

  it('Metamagic Adept (Feat, __featFeatures): 2 Sorcery Points, additiv markiert', () => {
    const ch = {
      classes: [{ classId: 'Fighter', level: 5 }],
      __featFeatures: [{ classId: null, name: metamagicAdept.name, entries: metamagicAdept.entries }],
    }
    const res = computeResources(ch, MODS, 3, 5, {})
    const sp = res.find((r) => /sorcery points/i.test(r.name))
    expect(sp).toBeTruthy()
    expect(sp.max).toBe(2)
  })
})
