// „Replaces …"-Semantik der TCE-Varianten (2014-5e): eine AKTIVIERTE
// Variante, deren Text „replaces the X feature" sagt, entfernt das reguläre
// Feature X aus __activeFeatures — nicht aktivierte Varianten erscheinen
// gar nicht, und ohne Aktivierung bleibt alles beim Standard.
import { describe, it, expect } from 'vitest'
import { collectActiveClassFeatures } from '../characterHydration'

// Synthetische Klassendaten im 5etools-Shape (wie loadClassData sie liefert).
const rangerCd = {
  id: 'Ranger',
  source: 'PHB',
  features: [
    { name: 'Favored Enemy', level: 1, entries: ['Choose a type of favored enemy…'], source: 'PHB' },
    { name: 'Natural Explorer', level: 1, entries: ['You are adept at…'], source: 'PHB' },
    {
      name: 'Favored Foe', level: 1, isClassFeatureVariant: true, source: 'TCE',
      entries: ['This 1st-level feature replaces the Favored Enemy feature and works with the Foe Slayer feature.'],
    },
    {
      name: 'Deft Explorer', level: 1, isClassFeatureVariant: true, source: 'TCE',
      entries: ['This 1st-level feature replaces the {@classFeature Natural Explorer|Ranger||1} feature.'],
    },
  ],
  subclasses: [],
}

const mkChar = (optionalClassFeatures) => ({
  meta: { edition: '5e' },
  classes: [{ classId: 'Ranger', level: 3, levelChoices: {} }],
  optionalClassFeatures,
})
const names = (ch) => collectActiveClassFeatures(ch, { Ranger: rangerCd }, {}).map((f) => f.name)

describe('TCE-Varianten: replaces-Semantik', () => {
  it('ohne Aktivierung: Standard-Features aktiv, Varianten nicht', () => {
    const n = names(mkChar({}))
    expect(n).toContain('Favored Enemy')
    expect(n).toContain('Natural Explorer')
    expect(n).not.toContain('Favored Foe')
    expect(n).not.toContain('Deft Explorer')
  })

  it('aktivierte Variante ersetzt das genannte Feature (auch mit {@classFeature}-Tag)', () => {
    const n = names(mkChar({ Ranger: { 'Favored Foe': true, 'Deft Explorer': true } }))
    expect(n).toContain('Favored Foe')
    expect(n).toContain('Deft Explorer')
    expect(n).not.toContain('Favored Enemy')
    expect(n).not.toContain('Natural Explorer')
  })

  it('nur die aktivierte Variante ersetzt — die andere bleibt Standard', () => {
    const n = names(mkChar({ Ranger: { 'Favored Foe': true } }))
    expect(n).toContain('Favored Foe')
    expect(n).not.toContain('Favored Enemy')
    expect(n).toContain('Natural Explorer')
    expect(n).not.toContain('Deft Explorer')
  })
})
