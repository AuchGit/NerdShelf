// Die Homebrew-Validierung beantwortet die Frage „warum taucht mein
// Eintrag nirgends auf?" — sie prüft gegen die Anforderungen der
// KONSUMENTEN (Loader + Sheet-Parser), nicht gegen das 5etools-Schema.
import { describe, it, expect } from 'vitest'
import { validateHomebrew, validationCounts } from '../homebrewValidate'

const msgs = (kind, entry) => validateHomebrew(kind, entry).map(v => v.msg).join(' | ')
const levels = (kind, entry) => validateHomebrew(kind, entry).map(v => v.level)

describe('validateHomebrew: allgemein', () => {
  it('ohne Namen ist jeder Eintrag ein Fehler (Loader filtern ihn)', () => {
    expect(levels('items', { source: 'HB' })).toContain('error')
    expect(levels('spells', { source: 'HB', level: 1 })).toContain('error')
  })
  it('fehlende Source ist nur ein Hinweis', () => {
    const v = validateHomebrew('items', { name: 'Test', type: 'G' })
    expect(v.every(x => x.level === 'warn')).toBe(true)
  })
  it('unbekannter Kind crasht nicht', () => {
    expect(() => validateHomebrew('gibtsnicht', { name: 'X', source: 'HB' })).not.toThrow()
  })
})

describe('validateHomebrew: spells', () => {
  const base = {
    name: 'Testzauber', source: 'HB-X', level: 1, school: 'V',
    time: [{ number: 1, unit: 'action' }], entries: ['Ein Effekt.'],
    classes: ['Wizard'],
  }
  it('vollständiger Spell ohne Würfel: keine Meldungen', () => {
    expect(validateHomebrew('spells', base)).toHaveLength(0)
  })
  it('ohne Klassen-Zuweisung warnt es (taucht in keinem Picker auf)', () => {
    const v = msgs('spells', { ...base, classes: [] })
    expect(v).toMatch(/Klassen-Liste/i)
  })
  it('ungültiges Level ist ein Fehler', () => {
    expect(levels('spells', { ...base, level: 12 })).toContain('error')
    expect(levels('spells', { ...base, level: undefined })).toContain('error')
  })
  it('Cantrip mit Würfeln ohne Skalierung warnt', () => {
    const v = msgs('spells', { ...base, level: 0, entries: ['Deals 1d8 fire damage.'] })
    expect(v).toMatch(/Skalierung/i)
  })
  it('Cantrip mit scalingLevelDice warnt nicht mehr', () => {
    const v = msgs('spells', {
      ...base, level: 0, entries: ['Deals 1d8 fire damage.'],
      scalingLevelDice: { label: '1d8', scaling: { 1: '1d8', 5: '2d8' } },
    })
    expect(v).not.toMatch(/Skalierung/i)
  })
  it('leveled Spell mit Würfeln ohne Upcast warnt', () => {
    const v = msgs('spells', { ...base, entries: ['Deals 8d6 fire damage.'] })
    expect(v).toMatch(/Upcast/i)
  })
  it('fehlende Casting Time warnt (kein Aktions-Bucket)', () => {
    const v = msgs('spells', { ...base, time: [] })
    expect(v).toMatch(/Casting Time/i)
  })
})

describe('validateHomebrew: features', () => {
  const base = { name: 'Testfeature', source: 'HB-X', level: 3, className: 'Rogue', entries: ['Tut etwas.'] }
  it('vollständiges Feature: keine Meldungen', () => {
    expect(validateHomebrew('features', base)).toHaveLength(0)
  })
  it('ohne Beschreibungstext ist es ein Fehler (Parser lesen den Text)', () => {
    expect(levels('features', { ...base, entries: [] })).toContain('error')
    expect(levels('features', { ...base, entries: [''] })).toContain('error')
  })
  it('Level außerhalb 1–20 ist ein Fehler', () => {
    expect(levels('features', { ...base, level: 25 })).toContain('error')
  })
  it('ohne Klasse gibt es den Hinweis auf globale Wirkung', () => {
    const v = msgs('features', { ...base, className: undefined })
    expect(v).toMatch(/JEDEM Charakter/i)
  })
})

describe('validateHomebrew: items / races / backgrounds / creatures', () => {
  it('Waffe ohne Schadenswürfel warnt', () => {
    const v = msgs('items', { name: 'Klinge', source: 'HB', type: 'M', weaponCategory: 'martial' })
    expect(v).toMatch(/Schadenswürfel/i)
  })
  it('Rasse ohne Speed warnt', () => {
    const v = msgs('races', { name: 'Testvolk', source: 'HB', size: ['M'] })
    expect(v).toMatch(/Bewegungsrate/i)
  })
  it('Background ohne Proficiencies warnt', () => {
    const v = msgs('backgrounds', { name: 'Testherkunft', source: 'HB' })
    expect(v).toMatch(/Proficiencies/i)
  })
  it('Kreatur ohne HP/CR warnt zweifach', () => {
    const c = validationCounts('creatures', { name: 'Testvieh', source: 'HB' })
    expect(c.errors).toBe(0)
    expect(c.warnings).toBe(2)
  })
})
