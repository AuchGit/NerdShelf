// Homebrew-Spell-Listen: eine Liste erreicht den Charakter entweder direkt
// oder über einen anderen Homebrew-Eintrag (Rasse / Background / Feature /
// ausgerüstetes Item), der sie in `spellListIds` referenziert.
import { describe, it, expect } from 'vitest'
import {
  assignedSpellLists, extraSpellNamesFor, allExtraSpellNames,
  setSpellListAssigned, setEntrySpellList,
} from '../characterSpellLists'

const listA = {
  name: 'Sternenmagie', source: 'HB',
  spells: ['Faerie Fire', 'Starry Wisp'],
  _localMeta: { id: 'list-a' },
}
const listB = {
  name: 'Akademische Kniffe', source: 'HB',
  spells: ['Mage Hand'], classes: ['Wizard'],
  _localMeta: { id: 'list-b' },
}
const byKind = (extra = {}) => ({ spelllists: [listA, listB], ...extra })

describe('Zuordnung direkt am Charakter', () => {
  it('ohne Zuordnung keine Zusatz-Zauber', () => {
    expect(assignedSpellLists({}, byKind())).toHaveLength(0)
    expect(allExtraSpellNames({}, byKind()).size).toBe(0)
  })
  it('direkte Zuordnung über homebrewSpellLists', () => {
    const ch = { homebrewSpellLists: ['list-a'] }
    expect(assignedSpellLists(ch, byKind()).map(l => l.name)).toEqual(['Sternenmagie'])
    expect([...allExtraSpellNames(ch, byKind())].sort()).toEqual(['faerie fire', 'starry wisp'])
  })
})

describe('Zuordnung über andere Homebrew-Einträge', () => {
  it('Rasse mit spellListIds gibt die Liste weiter', () => {
    const race = { name: 'Sternenkind', spellListIds: ['list-a'], _localMeta: { id: 'race-1' } }
    const ch = { species: { raceId: 'Sternenkind' } }
    const names = allExtraSpellNames(ch, byKind({ races: [race] }))
    expect(names.has('faerie fire')).toBe(true)
  })
  it('Referenz über die local_id der Rasse funktioniert ebenso', () => {
    const race = { name: 'Sternenkind', spellListIds: ['list-a'], _localMeta: { id: 'race-1' } }
    const ch = { species: { raceId: 'race-1' } }
    expect(allExtraSpellNames(ch, byKind({ races: [race] })).size).toBe(2)
  })
  it('andere Rasse → keine Liste', () => {
    const race = { name: 'Sternenkind', spellListIds: ['list-a'], _localMeta: { id: 'race-1' } }
    const ch = { species: { raceId: 'Mensch' } }
    expect(allExtraSpellNames(ch, byKind({ races: [race] })).size).toBe(0)
  })
  it('Background zählt über backgroundId', () => {
    const bg = { name: 'Akademiker', spellListIds: ['list-b'], _localMeta: { id: 'bg-1' } }
    const ch = { background: { backgroundId: 'Akademiker' } }
    expect(allExtraSpellNames(ch, byKind({ backgrounds: [bg] })).has('mage hand')).toBe(true)
  })
  it('aktives Homebrew-Feature zählt', () => {
    const feat = { name: 'Pakt des Grimoires', spellListIds: ['list-a'], _localMeta: { id: 'f-1' } }
    const ch = { __activeFeatures: [{ name: 'Pakt des Grimoires' }] }
    expect(allExtraSpellNames(ch, byKind({ features: [feat] })).size).toBe(2)
  })
  it('Item zählt nur wenn ausgerüstet', () => {
    const item = { name: 'Buch der Sterne', spellListIds: ['list-a'], _localMeta: { id: 'i-1' } }
    const kind = byKind({ items: [item] })
    const carried = { inventory: { items: [{ name: 'Buch der Sterne', equipped: false }] } }
    expect(allExtraSpellNames(carried, kind).size).toBe(0)
    const worn = { inventory: { items: [{ name: 'Buch der Sterne', equipped: true }] } }
    expect(allExtraSpellNames(worn, kind).size).toBe(2)
  })
})

describe('Klassen-Beschränkung', () => {
  const ch = { homebrewSpellLists: ['list-a', 'list-b'] }
  it('Liste ohne classes gilt für jede Klasse', () => {
    expect(extraSpellNamesFor(ch, byKind(), 'Cleric').has('faerie fire')).toBe(true)
  })
  it('Liste mit classes gilt nur dort', () => {
    expect(extraSpellNamesFor(ch, byKind(), 'Wizard').has('mage hand')).toBe(true)
    expect(extraSpellNamesFor(ch, byKind(), 'Cleric').has('mage hand')).toBe(false)
  })
  it('ohne Klassenangabe kommt alles zurück', () => {
    expect(allExtraSpellNames(ch, byKind()).size).toBe(3)
  })
})

describe('Patch-Helfer', () => {
  it('setSpellListAssigned toggelt idempotent', () => {
    const ch = {}
    const on = setSpellListAssigned(ch, 'list-a', true)
    expect(on).toEqual(['list-a'])
    expect(setSpellListAssigned({ homebrewSpellLists: on }, 'list-a', true)).toEqual(['list-a'])
    expect(setSpellListAssigned({ homebrewSpellLists: on }, 'list-a', false)).toEqual([])
  })
  it('setEntrySpellList toggelt am Homebrew-Eintrag', () => {
    const e = { name: 'Rasse' }
    const on = setEntrySpellList(e, 'list-a', true)
    expect(on).toEqual(['list-a'])
    expect(setEntrySpellList({ ...e, spellListIds: on }, 'list-a', false)).toEqual([])
  })
})
