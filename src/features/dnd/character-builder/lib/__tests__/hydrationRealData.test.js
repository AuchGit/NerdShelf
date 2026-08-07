// Regressionstest gegen die ECHTEN 5etools-Daten in public/ — genau die
// Kette, die Sheet, VTT und Foundry-Export gemeinsam konsumieren
// (collectActiveClassFeatures + collectClassGrantedSpells über loadClassData).
// Deckt die Export-Findings ab: TCE-Varianten-Skip, „replaces …"-Filter,
// Spell-Tabellen-Grants (Primal Awareness) und den Option-Block-Filter
// (Magician/Warden nur nach Wahl).
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { collectActiveClassFeatures, collectClassGrantedSpells } from '../characterHydration'
import { loadClassData } from '../dataLoader'

const PUB = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'public')

beforeAll(() => {
  // fetch-Shim: /data/… aus public/ lesen (dataLoader läuft sonst nur im
  // Browser/Tauri). 404-Verhalten wie der Dev-Server: ok=false.
  globalThis.fetch = async (url) => {
    const rel = String(url).split('?')[0].replace(/^\//, '')
    const p = path.join(PUB, rel)
    const exists = fs.existsSync(p) && fs.statSync(p).isFile()
    return {
      ok: exists,
      status: exists ? 200 : 404,
      headers: { get: () => (exists ? 'application/json' : '') },
      text: async () => (exists ? fs.readFileSync(p, 'utf8') : ''),
      json: async () => JSON.parse(fs.readFileSync(p, 'utf8')),
    }
  }
})

const mkRanger = (level, optionalClassFeatures = {}) => ({
  meta: { edition: '5e' },
  classes: [{ classId: 'Ranger', level, levelChoices: {} }],
  optionalClassFeatures,
  choices: {},
})

describe('Echt-Daten: 2014 Ranger + TCE-Varianten', () => {
  let cd
  beforeAll(async () => { cd = await loadClassData('5e', 'Ranger') })

  it('Klassendaten laden und enthalten die TCE-Varianten', () => {
    expect(cd).toBeTruthy()
    const names = (cd.features || []).map((f) => f.name)
    expect(names).toContain('Favored Enemy')
    expect(names).toContain('Favored Foe')
    expect(names).toContain('Primal Awareness')
  })

  it('ohne Varianten: Standard-Features aktiv, keine Variant-Spells', () => {
    const ch = mkRanger(5)
    const feats = collectActiveClassFeatures(ch, { Ranger: cd }, {})
    const names = feats.map((f) => f.name)
    expect(names).toContain('Favored Enemy')
    expect(names).toContain('Primeval Awareness')
    expect(names).not.toContain('Favored Foe')
    expect(names).not.toContain('Primal Awareness')
    const spells = collectClassGrantedSpells(ch, { Ranger: cd }, feats).map((s) => s.name.toLowerCase())
    expect(spells).not.toContain('speak with animals')
  })

  it('aktivierte Varianten ersetzen die Standard-Features (echtes TCE-Phrasing)', () => {
    const ch = mkRanger(5, { Ranger: { 'Favored Foe': true, 'Primal Awareness': true } })
    const feats = collectActiveClassFeatures(ch, { Ranger: cd }, {})
    const names = feats.map((f) => f.name)
    expect(names).toContain('Favored Foe')
    expect(names).toContain('Primal Awareness')
    expect(names).not.toContain('Favored Enemy')
    expect(names).not.toContain('Primeval Awareness')
  })

  it('Primal Awareness gewährt Spells über die Level-Tabelle (bis Klassenstufe)', () => {
    const ch = mkRanger(5, { Ranger: { 'Primal Awareness': true } })
    const feats = collectActiveClassFeatures(ch, { Ranger: cd }, {})
    const spells = collectClassGrantedSpells(ch, { Ranger: cd }, feats).map((s) => s.name.toLowerCase())
    expect(spells).toContain('speak with animals')
    expect(spells).toContain('beast sense')
    expect(spells).not.toContain('speak with plants') // erst L9
  })
})

describe('Echt-Daten: 5.5e Druid Option-Block (Primal Order)', () => {
  let cd
  beforeAll(async () => { cd = await loadClassData('5.5e', 'Druid') })

  it('ohne Wahl sind weder Magician noch Warden aktiv, Primal Order schon', () => {
    const ch = { meta: { edition: '5.5e' }, classes: [{ classId: 'Druid', level: 2, levelChoices: {} }], choices: {} }
    const names = collectActiveClassFeatures(ch, { Druid: cd }, {}).map((f) => f.name)
    expect(names).toContain('Primal Order')
    expect(names).not.toContain('Magician')
    expect(names).not.toContain('Warden')
    // Wild Companion ist im 2024-PHB ein REGULÄRES L2-Feature (XPHB-Zeile,
    // kein Variant-Flag) — genau einmal aktiv; die TCE-Bridge-Zeile
    // (variant, classSource PHB) darf nicht zusätzlich reinrutschen.
    expect(names.filter((n) => n === 'Wild Companion')).toHaveLength(1)
  })
})
