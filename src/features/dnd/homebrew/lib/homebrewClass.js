// homebrewClass.js
//
// Umwandlung eines Homebrew-Klassen-Eintrags in die beiden Shapes, die der
// Rest der App von einer Klasse erwartet:
//
//   loadClassList(edition)          → Listen-Eintrag (Wizard-Klassenwahl,
//                                     Level-Up, Foundry-Export)
//   loadClassData(edition, classId) → volle Klassendaten (Hydration:
//                                     collectActiveClassFeatures, Subclass-
//                                     Features, Level-Tabellen)
//
// Gespeichertes Format (bewusst nah an 5etools, damit die Konvertierung
// trivial bleibt und ein Eintrag notfalls im JSON-Editor pflegbar ist):
//
//   {
//     name, source,
//     hd: { faces: 8 },
//     proficiency: ['con','int'],            // Saving Throws
//     spellcastingAbility: 'int' | null,
//     casterProgression: 'full'|'half'|'1/3'|'pact'|'artificer'|null,
//     subclassTitle: 'Pfad', subclassLevel: 3,
//     startingProficiencies: { armor, weapons, tools, skills },
//     classFeatures: [{ name, level, entries }],
//     subclasses: [{ name, shortName, entries, features: [{name, level, entries}] }],
//     entries: [...]
//   }
//
// Beide Konverter sind rein — keine IO, damit sie testbar bleiben.

const num = (v, dflt) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : dflt
}

/** Flache Feature-Liste → { [level]: [{name, entries}] } */
function perLevel(features) {
  const map = {}
  for (const f of (features || [])) {
    if (!f?.name) continue
    const lvl = num(f.level, 1)
    if (!map[lvl]) map[lvl] = []
    if (!map[lvl].some(x => x.name === f.name)) {
      map[lvl].push({ name: f.name, entries: f.entries || [] })
    }
  }
  return map
}

/** Homebrew-Klasse → Eintrag im Format von loadClassList. */
export function homebrewClassToListEntry(hb) {
  if (!hb?.name) return null
  return {
    id: hb.name,
    name: hb.name,
    source: hb.source || 'HB',
    proficiency: hb.proficiency || [],
    hitDie: num(hb.hd?.faces, 8),
    spellcastingAbility: hb.spellcastingAbility || null,
    casterProgression: hb.casterProgression === '1/2' ? 'half' : (hb.casterProgression || null),
    subclassTitle: hb.subclassTitle || 'Subclass',
    subclassLevel: num(hb.subclassLevel, 3),
    entries: hb.entries || [],
    classFeatures: [],
    featuresPerLevel: perLevel(hb.classFeatures),
    subclasses: (hb.subclasses || []).filter(s => s?.name).map(s => ({
      name: s.name,
      source: hb.source || 'HB',
      shortName: s.shortName || s.name,
      entries: s.entries || [],
      featuresPerLevel: perLevel(s.features),
      spellcastingAbility: s.spellcastingAbility || null,
      casterProgression: s.casterProgression === '1/2' ? 'half' : (s.casterProgression || null),
      optionalfeatureProgression: s.optionalfeatureProgression || [],
    })),
    startingProficiencies: hb.startingProficiencies || {},
    startingEquipment: hb.startingEquipment || {},
    optionalfeatureProgression: hb.optionalfeatureProgression || [],
    featProgression: hb.featProgression || [],
    classTableGroups: hb.classTableGroups || [],
    multiclassing: hb.multiclassing || null,
    _isHomebrew: true,
  }
}

/** Homebrew-Klasse → Shape von loadClassData (Hydration-Eingabe). */
export function homebrewClassToClassData(hb) {
  if (!hb?.name) return null
  const src = hb.source || 'HB'
  return {
    id: hb.name,
    name: hb.name,
    source: src,
    hd: hb.hd || { faces: 8 },
    proficiency: hb.proficiency || [],
    spellcastingAbility: hb.spellcastingAbility || null,
    casterProgression: hb.casterProgression === '1/2' ? 'half' : (hb.casterProgression || null),
    subclassTitle: hb.subclassTitle || 'Subclass',
    subclassLevel: num(hb.subclassLevel, 3),
    startingProficiencies: hb.startingProficiencies || {},
    startingEquipment: hb.startingEquipment || {},
    optionalfeatureProgression: hb.optionalfeatureProgression || [],
    featProgression: hb.featProgression || [],
    classTableGroups: hb.classTableGroups || [],
    entries: hb.entries || [],
    // collectActiveClassFeatures liest `features` (flach, mit level) und
    // `subclasses[].features`.
    features: (hb.classFeatures || []).filter(f => f?.name).map(f => ({
      name: f.name,
      level: num(f.level, 1),
      entries: f.entries || [],
      source: src,
      className: hb.name,
    })),
    subclasses: (hb.subclasses || []).filter(s => s?.name).map(s => ({
      id: s.name,
      name: s.name,
      source: src,
      shortName: s.shortName || s.name,
      entries: s.entries || [],
      spellcastingAbility: s.spellcastingAbility || null,
      casterProgression: s.casterProgression === '1/2' ? 'half' : (s.casterProgression || null),
      optionalfeatureProgression: s.optionalfeatureProgression || [],
      features: (s.features || []).filter(f => f?.name).map(f => ({
        name: f.name,
        level: num(f.level, 1),
        entries: f.entries || [],
        source: src,
        className: hb.name,
        subclassShortName: s.shortName || s.name,
      })),
    })),
    _isHomebrew: true,
  }
}

/** Leergerüst für einen neuen Eintrag. */
export function blankHomebrewClass(source = 'HB') {
  return {
    name: 'Neue Klasse',
    source,
    hd: { faces: 8 },
    proficiency: [],
    spellcastingAbility: null,
    casterProgression: null,
    subclassTitle: 'Subclass',
    subclassLevel: 3,
    startingProficiencies: { armor: [], weapons: [], tools: [], skills: [] },
    classFeatures: [],
    subclasses: [],
    entries: [],
  }
}
