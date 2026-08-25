// Homebrew-Klassen: die beiden Konverter müssen exakt die Shapes liefern,
// die loadClassList (Klassenwahl / Level-Up) und loadClassData (Hydration)
// sonst aus den 5etools-Dateien bauen. Der zweite Test prüft daher gegen
// den echten Sammler collectActiveClassFeatures — wenn der die Features
// einer Homebrew-Klasse findet, greift die ganze Kette bis ins Sheet.
import { describe, it, expect } from 'vitest'
import { homebrewClassToListEntry, homebrewClassToClassData, blankHomebrewClass } from '../homebrewClass'
import { collectActiveClassFeatures } from '../../../character-builder/lib/characterHydration'

const runenschmied = {
  name: 'Runenschmied',
  source: 'HB-MILES',
  hd: { faces: 10 },
  proficiency: ['con', 'int'],
  spellcastingAbility: 'int',
  casterProgression: '1/2',
  subclassTitle: 'Runenpfad',
  subclassLevel: 3,
  startingProficiencies: { armor: ['light', 'medium'], weapons: ['simple'], skills: [{ choose: { from: ['arcana', 'history'], count: 1 } }] },
  classFeatures: [
    { name: 'Runengravur', level: 1, entries: ['Du gravierst Runen.'] },
    { name: 'Zweiter Hammerschlag', level: 5, entries: ['Du schlägst zweimal.'] },
  ],
  subclasses: [
    {
      name: 'Pfad der Glut', shortName: 'Glut', entries: [],
      features: [{ name: 'Glutrune', level: 3, entries: ['Feuer.'] }],
    },
  ],
  _localMeta: { id: 'cls-1' },
}

describe('homebrewClassToListEntry', () => {
  const e = homebrewClassToListEntry(runenschmied)
  it('liefert id/name/hitDie im Listen-Shape', () => {
    expect(e.id).toBe('Runenschmied')
    expect(e.name).toBe('Runenschmied')
    expect(e.hitDie).toBe(10)
    expect(e.subclassTitle).toBe('Runenpfad')
    expect(e.subclassLevel).toBe(3)
  })
  it('normalisiert die Caster-Progression wie normCasterProg', () => {
    expect(e.casterProgression).toBe('half')
    expect(e.spellcastingAbility).toBe('int')
  })
  it('gruppiert Features nach Stufe', () => {
    expect(Object.keys(e.featuresPerLevel).sort()).toEqual(['1', '5'])
    expect(e.featuresPerLevel[1][0].name).toBe('Runengravur')
  })
  it('bildet Subclasses mit featuresPerLevel ab', () => {
    expect(e.subclasses).toHaveLength(1)
    expect(e.subclasses[0].shortName).toBe('Glut')
    expect(e.subclasses[0].featuresPerLevel[3][0].name).toBe('Glutrune')
  })
  it('ohne Namen kein Eintrag', () => {
    expect(homebrewClassToListEntry({})).toBeNull()
  })
})

describe('homebrewClassToClassData', () => {
  const d = homebrewClassToClassData(runenschmied)
  it('liefert flache features[] mit level', () => {
    expect(d.features.map(f => f.name)).toEqual(['Runengravur', 'Zweiter Hammerschlag'])
    expect(d.features[1].level).toBe(5)
  })
  it('Subclass-Features tragen shortName und level', () => {
    const f = d.subclasses[0].features[0]
    expect(f.name).toBe('Glutrune')
    expect(f.level).toBe(3)
    expect(f.subclassShortName).toBe('Glut')
  })
})

describe('Integration: collectActiveClassFeatures über eine Homebrew-Klasse', () => {
  const classData = homebrewClassToClassData(runenschmied)
  const mkChar = (level, subclassId = null) => ({
    meta: { edition: '5e' },
    classes: [{ classId: 'Runenschmied', level, subclassId, levelChoices: {} }],
    choices: {},
  })

  it('Stufe 1: nur das L1-Feature ist aktiv', () => {
    const names = collectActiveClassFeatures(mkChar(1), { Runenschmied: classData }, {}).map(f => f.name)
    expect(names).toContain('Runengravur')
    expect(names).not.toContain('Zweiter Hammerschlag')
  })

  it('Stufe 5: beide Klassen-Features aktiv', () => {
    const names = collectActiveClassFeatures(mkChar(5), { Runenschmied: classData }, {}).map(f => f.name)
    expect(names).toEqual(expect.arrayContaining(['Runengravur', 'Zweiter Hammerschlag']))
  })

  it('mit gewählter Subclass kommt deren Feature dazu', () => {
    const names = collectActiveClassFeatures(mkChar(5, 'Pfad der Glut'), { Runenschmied: classData }, {}).map(f => f.name)
    expect(names).toContain('Glutrune')
  })

  it('ohne Subclass-Wahl bleibt das Subclass-Feature aus', () => {
    const names = collectActiveClassFeatures(mkChar(5), { Runenschmied: classData }, {}).map(f => f.name)
    expect(names).not.toContain('Glutrune')
  })
})

describe('blankHomebrewClass', () => {
  it('ist ein gültiger Ausgangspunkt für beide Konverter', () => {
    const b = blankHomebrewClass('HB-X')
    expect(homebrewClassToListEntry(b)).toBeTruthy()
    expect(homebrewClassToClassData(b)).toBeTruthy()
    expect(homebrewClassToListEntry(b).hitDie).toBe(8)
  })
})
