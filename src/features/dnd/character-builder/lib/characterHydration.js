// Charakter-Hydration — die transienten Felder, die das Sheet vor dem Rechnen
// anreichert (__activeFeatures, __grantedSpells, species.__traits …). Aus
// CharacterSheetPage extrahiert, damit das VTT (Bottom-Bar-Actions, Aktions-
// Overlay, Zauber-Sidebar) EXAKT dieselbe Datenlage bekommt wie das Sheet —
// eine Quelle, nichts dupliziert. Die Kataloge (optionalFeatureMap/featMap)
// injiziert der Aufrufer; ohne sie degradieren die Sammler sanft.
import { loadRaceList, normalizeWeaponProperties } from './dataLoader'
import { findOptionBlocks, optionValueKey } from './optionBlockResolver'
import { isVariantEnabled } from './optionalFeatureVariants'

// Waffen-Daten aus dem Item-Katalog nachfüllen: manche Charaktere haben
// Waffen mit LEEREM properties-Array (z.B. über Startausrüstung/alten
// Import angelegt) → rulesEngine erkennt dann keine Finesse/Thrown und
// nutzt STR statt DEX (Dagger +2 statt +7, kein „Geworfen"-Schalter). Wir
// mappen fehlende Felder (properties/weaponCategory/dmg1/dmgType) über den
// Waffennamen aus dem Katalog nach. `itemIndex` = loadItemIndex(edition).
// Rein transient — nichts wird persistiert; Charaktere mit vollständigen
// Daten bleiben unverändert.
export function backfillWeaponData(character, itemIndex) {
  if (!character || !Array.isArray(itemIndex) || !itemIndex.length) return character
  const byName = new Map()
  for (const it of itemIndex) {
    if (it?.name) byName.set(String(it.name).toLowerCase(), it)
  }
  const enrich = (list) => {
    let changed = false
    const out = (list || []).map((w) => {
      if (!w?.isWeapon && !w?.dmg1 && !w?.weaponCategory) return w
      const hasProps = Array.isArray(w.properties) && w.properties.length > 0
      if (hasProps && w.weaponCategory) return w
      const base = byName.get(String(w.customName || w.name || '').toLowerCase())
      if (!base) return w
      const next = { ...w }
      if (!hasProps) {
        const bp = base.property || base.properties || []
        if (bp.length) next.properties = normalizeWeaponProperties(bp)
      }
      if (!next.weaponCategory && base.weaponCategory) next.weaponCategory = base.weaponCategory
      if (!next.dmg1 && base.dmg1) next.dmg1 = base.dmg1
      if (!next.dmgType && base.dmgType) next.dmgType = base.dmgType
      changed = changed || next !== w
      return next
    })
    return changed ? out : list
  }
  const inv = enrich(character.inventory?.items)
  const cust = enrich(character.custom?.items)
  if (inv === character.inventory?.items && cust === character.custom?.items) return character
  return {
    ...character,
    inventory: { ...(character.inventory || {}), items: inv },
    custom: { ...(character.custom || {}), items: cust },
  }
}

export function collectActiveClassFeatures(charData, classDataMap, catalogs = {}) {
const { optionalFeatureMap = null, featMap = null } = catalogs
  const out = []
  // Dedup "classId|name|level" but PREFER the XPHB (2024) entry
  // when both exist. Several 5.5e features (Favored Enemy, Wild
  // Shape, …) are reprinted with different text in XPHB — the
  // 2024 text usually adds the actually-mechanically-relevant
  // hooks (e.g. "you always have Hunter's Mark prepared"). The
  // PHB-first dedup would have kept the legacy text and the
  // scanner that reads "you always have X prepared" wouldn't find
  // anything.
  const PREFERRED = ['XPHB', 'XDMG', 'XMM']
  const sourceRank = (s) => {
    const i = PREFERRED.indexOf(s)
    return i >= 0 ? i : 99
  }
  const byKey = new Map()
  const push = (entry, source) => {
    const key = `${entry.classId}|${entry.name}|${entry.level}`
    const existing = byKey.get(key)
    if (!existing) { byKey.set(key, { entry, source }); return }
    if (sourceRank(source) < sourceRank(existing.source)) {
      byKey.set(key, { entry, source })
    }
  }
  const is55e = (charData?.meta?.edition || '5e') === '5.5e'
  // „Replaces …"-Semantik (TCE-Varianten, reines 2014-5e-Thema): eine
  // AKTIVIERTE Variante, deren Text „replaces the X feature" sagt, ersetzt
  // das reguläre Feature X — RAW ist X dann weg. Targets werden beim
  // Durchlaufen der aktivierten Varianten gesammelt (datengetrieben aus dem
  // Text, keine Namensliste) und am Ende aus der Ausgabe gefiltert.
  const replacedByVariant = new Set() // `${classId}|${feature-name lowercase}`
  const collectReplacements = (feature, classId) => {
    if (!feature?.isClassFeatureVariant || !feature?.entries) return
    const raw = JSON.stringify(feature.entries).replace(/\{@\w+ ([^|}]+)(?:\|[^}]*)?\}/g, '$1')
    for (const m of raw.matchAll(/replaces the ([^.,{"]+?) feature/gi)) {
      const target = String(m[1] || '').trim().toLowerCase()
      if (target) replacedByVariant.add(`${classId}|${target}`)
    }
  }
  // ── Option-Block-Vorscan ────────────────────────────────────
  // Bevor wir Features pushen, ermitteln wir welche Class-Feature-
  // Namen Sub-Optionen anderer Features sind (z.B. Magician /
  // Warden sind Sub-Options von Primal Order). Diese Features
  // dürfen NICHT automatisch in __activeFeatures landen — sie
  // werden nur durch eine bewusste Wahl in character.choices
  // aktiv. So vermeiden wir das "beide Optionen gleichzeitig
  // aktiv"-Bug.
  //
  // Pro Entry-Key (classId|name|level) merken wir auch wer der
  // Parent ist (für UI-Diagnostik) und welcher Choice-Descriptor
  // die Wahl steuert.
  const choices = charData?.choices || {}
  const optionTargetKeys = new Set()
  const chosenSubFeatures = [] // {classId, source, subclassId?, name, level, entries, fromOptionFeature}

  for (const cls of (charData?.classes || [])) {
    const cd = classDataMap[cls.classId]
    if (!cd) continue
    const allClassFeatures = cd.features || []
    const subId = cls.subclassId
    const cleanSubIdPrescan = subId ? String(subId).split(/__|\|/)[0].trim() : null
    const subPrescan = cleanSubIdPrescan
      ? (cd.subclasses || []).find(s =>
          s.id === subId || s.name === subId
          || s.id === cleanSubIdPrescan || s.name === cleanSubIdPrescan
          || s.shortName === cleanSubIdPrescan)
      : null
    const allSubFeatures = subPrescan
      ? [
          ...(Array.isArray(subPrescan.features) ? subPrescan.features : []),
          ...(subPrescan.featuresPerLevel
            ? Object.entries(subPrescan.featuresPerLevel).flatMap(([lvl, fs]) =>
                (fs || []).map(f => ({ ...f, level: parseInt(lvl, 10) || 1 })))
            : []),
        ]
      : []

    // Resolver braucht die geladenen Class-Data damit
    // refClassFeature → konkretes Feature aufgelöst werden kann.
    // optionalFeatureMap zusätzlich, damit refOptionalfeature
    // (Fighting Style, Maneuver, Invocation, Metamagic, …) ebenfalls
    // resolved.
    const resolverOpts = {
      classDataMap: { [cls.classId]: cd },
      optionalFeatureMap: optionalFeatureMap,
      featMap: featMap,
    }

    const collectFromBlocks = (feature, ownerKey, isSubclass) => {
      if (!feature?.entries) return
      const blocks = findOptionBlocks(feature.entries, resolverOpts)
      if (blocks.length === 0) return
      blocks.forEach((block, blockIdx) => {
        // Sub-Option-Namen für skip-Set merken — egal ob das ein
        // Pick-Block oder Grant-All-Block ist: die genannten Refs
        // sollen NICHT zusätzlich über den main-loop laufen sondern
        // nur über chosenSubFeatures kommen (vermeidet Doppel-
        // Aktivierung wenn das Sub-Feature auch als top-level-
        // classFeature im Datensatz existiert).
        for (const opt of block.options) {
          if (opt.kind === 'classFeature' && opt.entry) {
            const target = opt.entry
            const tLvl = target.level || opt.level || 1
            const matchesEdition = is55e
              ? (!target.classSource || target.classSource === cd.source || PREFERRED.includes(target.classSource))
              : true
            if (matchesEdition) {
              optionTargetKeys.add(`${cls.classId}|${target.name}|${tLvl}`)
            }
          }
          if (opt.kind === 'subclassFeature' && opt.entry) {
            optionTargetKeys.add(`${cls.classId}|sub|${opt.entry.name}|${opt.entry.level || opt.level || 1}`)
          }
        }
        // Grant-All Block (5etools `options` ohne count): ALLE Refs
        // werden automatisch aktiviert, kein User-Pick. Beispiel:
        // 5e TCE Soulknife "Psionic Power" listet Psi-Bolstered
        // Knack + Psychic Whispers — beide gleichzeitig gewährt
        // (RAW: "The powers below use your Psionic Energy dice").
        if (block._grantAll) {
          for (const opt of block.options) {
            if (!opt?.entry) continue
            const effectiveLevel = opt.entry.level || ownerKey.level || feature.level || 1
            chosenSubFeatures.push({
              classId: cls.classId,
              source: isSubclass ? 'subclass' : 'class',
              subclassId: isSubclass ? subId : undefined,
              name: opt.entry.name,
              level: effectiveLevel,
              entries: opt.entry.entries || [],
              fromOptionFeature: feature.name,
              isOptionalFeature: opt.kind === 'optionalfeature',
            })
          }
          return
        }
        // Stored choice für Pick-Blöcke.
        const idParts = [
          'optblock',
          ownerKey.source,
          String(ownerKey.classId || ''),
          String(ownerKey.subclassId || ''),
          String(ownerKey.level || ''),
          String(feature.name || ''),
          `b${blockIdx}`,
        ]
        const descId = idParts.join('::')
        const stored = choices[descId]
        const storedArr = Array.isArray(stored) ? stored : (stored ? [stored] : [])
        for (const valueKey of storedArr) {
          const match = block.options.find(o => optionValueKey(o) === valueKey)
          if (!match?.entry) continue
          const effectiveLevel = match.entry.level || ownerKey.level || feature.level || 1
          chosenSubFeatures.push({
            classId: cls.classId,
            source: isSubclass ? 'subclass' : 'class',
            subclassId: isSubclass ? subId : undefined,
            name: match.entry.name,
            level: effectiveLevel,
            entries: match.entry.entries || [],
            fromOptionFeature: feature.name,
            isOptionalFeature: match.kind === 'optionalfeature',
          })
        }
      })
    }

    for (const f of allClassFeatures) {
      if (!f?.name) continue
      const lvl = f.level || 1
      if (lvl > cls.level) continue
      // Optional Class Feature Variant (TCE-Erweiterung): nur
      // skippen wenn der Spieler die Variante NICHT aktiviert hat.
      // Variants leben in character.optionalClassFeatures[cls.id].
      if (f.isClassFeatureVariant && !isVariantEnabled(charData, cls.classId, f.name)) continue
      const matchesEditionPre = is55e
        ? (!f.classSource || f.classSource === cd.source || PREFERRED.includes(f.classSource))
        : true
      if (!matchesEditionPre) continue
      collectFromBlocks(f, { source: 'class', classId: cls.classId, level: lvl }, false)
    }
    for (const f of allSubFeatures) {
      if (!f?.name) continue
      const lvl = f.level || 1
      if (lvl > cls.level) continue
      // Optional Class Feature Variant (TCE-Erweiterung): nur
      // skippen wenn der Spieler die Variante NICHT aktiviert hat.
      // Variants leben in character.optionalClassFeatures[cls.id].
      if (f.isClassFeatureVariant && !isVariantEnabled(charData, cls.classId, f.name)) continue
      collectFromBlocks(f, { source: 'subclass', classId: cls.classId, subclassId: subId, level: lvl }, true)
    }
  }

  for (const cls of (charData?.classes || [])) {
    const cd = classDataMap[cls.classId]
    if (!cd) continue
    // Class features (gained automatically by class level).
    for (const f of (cd.features || [])) {
      if (!f?.name) continue
      const lvl = f.level || 1
      if (lvl > cls.level) continue
      // Optional Class Feature Variant (TCE-Erweiterung): nur
      // skippen wenn der Spieler die Variante NICHT aktiviert hat.
      // Variants leben in character.optionalClassFeatures[cls.id].
      if (f.isClassFeatureVariant && !isVariantEnabled(charData, cls.classId, f.name)) continue
      collectReplacements(f, cls.classId)
      // 5.5e filter: skip features tagged with a classSource that
      // belongs to a different edition (PHB feature for an XPHB
      // class entry). Both versions show up in classFeature[]
      // because loadClassData doesn't filter. Without this the
      // dedup tie-breaker still saves us, but it's cheaper to
      // skip the wrong-source entry up front.
      const matchesEdition = is55e
        ? (!f.classSource || f.classSource === cd.source || PREFERRED.includes(f.classSource))
        : true
      if (!matchesEdition) continue
      // Option-Target-Filter: Features die Sub-Options eines
      // anderen Features sind (Magician/Warden für Druid Primal
      // Order, Sub-Optionen für Fighter Fighting Style etc.)
      // werden NICHT auto-aktiviert — sie kommen über
      // chosenSubFeatures nur rein wenn der Player tatsächlich
      // gewählt hat.
      if (optionTargetKeys.has(`${cls.classId}|${f.name}|${lvl}`)) continue
      push({ classId: cls.classId, source: 'class', name: f.name, level: lvl, entries: f.entries || [] }, f.source)
    }
    // Subclass features. loadClassData returns the subclass as
    // `{features: [...flat...]}`; loadClassList builds
    // `{featuresPerLevel: {3: [...], 7: [...]}}`. Walk both shapes
    // so a subclass loaded via either path is covered. Without
    // this, Otherworldly Glamour's "WIS-on-CHA" effect (and every
    // other subclass-feature mechanic) never reached the scanner.
    const subId = cls.subclassId
    if (!subId) continue
    // Strip any `__SOURCE` / `|SOURCE` suffix some legacy data
    // appended to the subclass id ("Fey Wanderer__TCE"); we only
    // match by the bare subclass name. Without this stripping a
    // single character's old subclassId could miss every load.
    const cleanSubId = String(subId).split(/__|\|/)[0].trim()
    const sub = (cd.subclasses || []).find(s =>
      s.id === subId || s.name === subId
      || s.id === cleanSubId || s.name === cleanSubId
      || s.shortName === cleanSubId
    )
    if (!sub) continue
    if (Array.isArray(sub.features)) {
      for (const f of sub.features) {
        if (!f?.name) continue
        const lvl = f.level || 1
        if (lvl > cls.level) continue
        // Optional Class Feature Variant (TCE-Erweiterung): nur
      // skippen wenn der Spieler die Variante NICHT aktiviert hat.
      // Variants leben in character.optionalClassFeatures[cls.id].
      if (f.isClassFeatureVariant && !isVariantEnabled(charData, cls.classId, f.name)) continue
        collectReplacements(f, cls.classId)
        if (optionTargetKeys.has(`${cls.classId}|sub|${f.name}|${lvl}`)) continue
        push({ classId: cls.classId, source: 'subclass', subclassId: subId, name: f.name, level: lvl, entries: f.entries || [] }, f.source)
      }
    }
    if (sub.featuresPerLevel) {
      for (const [lvlStr, feats] of Object.entries(sub.featuresPerLevel)) {
        const lvl = parseInt(lvlStr, 10)
        if (!Number.isFinite(lvl) || lvl > cls.level) continue
        for (const f of (feats || [])) {
          if (!f?.name) continue
          if (f.isClassFeatureVariant && !isVariantEnabled(charData, cls.classId, f.name)) continue
          collectReplacements(f, cls.classId)
          if (optionTargetKeys.has(`${cls.classId}|sub|${f.name}|${lvl}`)) continue
          push({ classId: cls.classId, source: 'subclass', subclassId: subId, name: f.name, level: lvl, entries: f.entries || [] }, f.source)
        }
      }
    }
  }
  // Chosen sub-features (Magician/Warden für die jeweilige
  // Primal-Order-Wahl etc.) jetzt nachschieben.
  for (const cf of chosenSubFeatures) {
    push({
      classId: cf.classId,
      source: cf.source,
      subclassId: cf.subclassId,
      name: cf.name,
      level: cf.level,
      entries: cf.entries,
      fromOptionFeature: cf.fromOptionFeature,
      isOptionalFeature: cf.isOptionalFeature,
    }, 'XPHB')
  }

  // Homebrew-Features: laufen async aus dem Tauri-Filesystem, also
  // ergänzen wir den Charakter mit pending-Promise-Liste. Sie werden
  // dem __activeFeatures-Bucket hinzugefügt wenn sie zur Klasse des
  // Charakters gehören (oder klassenfrei sind = global aktiv).
  // Hinweis: hier synchron-Pfad — die Promise wird unten resolved.
  if (Array.isArray(charData?.__homebrewFeatures)) {
    for (const hf of charData.__homebrewFeatures) {
      if (!hf?.name || !Array.isArray(hf.entries)) continue
      // Wenn classId gesetzt, nur aktivieren wenn der Char diese
      // Klasse hat UND die Stufe ≥ feature.level erreicht ist.
      if (hf.className) {
        const cls = (charData.classes || []).find(c => c.classId === hf.className)
        if (!cls) continue
        if ((hf.level || 1) > cls.level) continue
        push({
          classId: hf.className,
          source: 'class-homebrew',
          name: hf.name,
          level: hf.level || 1,
          entries: hf.entries,
        }, hf.source)
      } else {
        // Klassenfreies Homebrew-Feature → an erste Klasse hängen
        // damit der Bucket-Builder es als generisches Class-Feature
        // behandelt.
        const cls0 = (charData.classes || [])[0]
        if (!cls0) continue
        push({
          classId: cls0.classId,
          source: 'class-homebrew',
          name: hf.name,
          level: hf.level || 1,
          entries: hf.entries,
        }, hf.source)
      }
    }
  }

  // Legacy-Optfeature-Picks aus cls.levelChoices[N].optionalFeatures
  // (Level-Up-Wizard schreibt dort rein) als __activeFeatures
  // surfacen, damit Bonus-Extractor + Catalog + featureEffectParser
  // sie sehen. Auflösung über die optionalFeatureMap aus der
  // Hydration; fehlt sie, schicken wir den blanken Eintrag mit nur
  // dem Namen rein — catalog matched über name, Bonus-Extractor
  // ignoriert (keine entries).
  const ofMap = optionalFeatureMap
  for (const cls of (charData?.classes || [])) {
    const lcs = cls.levelChoices || {}
    for (const [lvlStr, lc] of Object.entries(lcs)) {
      const lvl = parseInt(lvlStr, 10) || 1
      const ofs = Array.isArray(lc?.optionalFeatures) ? lc.optionalFeatures : []
      for (const f of ofs) {
        const name = typeof f === 'string' ? f : f?.name
        if (!name) continue
        const lookup = ofMap ? (ofMap.get(name.toLowerCase()) || null) : null
        push({
          classId: cls.classId,
          source: 'class',
          name,
          level: lvl,
          entries: (lookup?.entries) || [],
          isOptionalFeature: true,
        }, lookup?.source || 'XPHB')
      }
      // Legacy Fighting-Style-Field: alte Charaktere haben
      // `levelChoices[1].fightingStyle = 'Archery'` (Step4b vor dem
      // Refactor). Wir lookupen den Eintrag aus optfeature-Data und
      // surfacen ihn als active feature, damit die mechanischen Boni
      // (Archery → +2 Ranged Attack, etc.) trotzdem greifen.
      if (typeof lc?.fightingStyle === 'string' && lc.fightingStyle) {
        const fsName = lc.fightingStyle
        const lookup = ofMap ? (ofMap.get(fsName.toLowerCase()) || null) : null
        push({
          classId: cls.classId,
          source: 'class',
          name: fsName,
          level: lvl,
          entries: (lookup?.entries) || [],
          isOptionalFeature: true,
        }, lookup?.source || 'XPHB')
      }
      // Superior-Technique-Maneuver field (auch Legacy).
      if (typeof lc?.superiorTechniqueManeuver === 'string' && lc.superiorTechniqueManeuver) {
        const mName = lc.superiorTechniqueManeuver
        const lookup = ofMap ? (ofMap.get(mName.toLowerCase()) || null) : null
        push({
          classId: cls.classId,
          source: 'class',
          name: mName,
          level: lvl,
          entries: (lookup?.entries) || [],
          isOptionalFeature: true,
        }, lookup?.source || 'XPHB')
      }
    }
  }
  // „Replaces …"-Filter: von aktivierten TCE-Varianten ersetzte reguläre
  // Features fliegen raus (Favored Foe ersetzt Favored Enemy, Deft Explorer
  // ersetzt Natural Explorer, Blessed Strikes ersetzt Divine Strike, …).
  for (const v of byKey.values()) {
    const e = v.entry
    if (replacedByVariant.has(`${e.classId}|${String(e.name).toLowerCase()}`)) continue
    out.push(e)
  }
  return out
}

// Walk class + subclass `additionalSpells.prepared` tables and
// return the spells the character has unlocked at their current
// class level. Output shape: `[{name, classId, sourceFeature}]`.
// The character-level keyed table is filtered against `cls.level`,
// so a Cleric 1 Twilight gets the L1 row and a Cleric 5 gets L1+3+5.
export function collectClassGrantedSpells(charData, classDataMap, activeFeatures = null) {
  const out = []
  const seen = new Set()
  const push = (name, classId, sourceFeature) => {
    const key = `${classId}|${String(name).toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ name: String(name), classId, sourceFeature })
  }
  // 5etools `additionalSpells` is an array of blocks. Each block can
  // have `prepared: { <classLevel>: [<spell names>] }`. Spell strings
  // may carry `|SOURCE` suffix → strip. We only read the `prepared`
  // bucket — `known` / `innate` go through other paths (spellbook,
  // race / feat innate casting).
  const consumeAdditional = (additionalSpells, level, classId, sourceFeature) => {
    for (const block of (additionalSpells || [])) {
      if (!block || typeof block !== 'object') continue
      const prep = block.prepared
      if (!prep || typeof prep !== 'object') continue
      for (const [lvlKey, arr] of Object.entries(prep)) {
        const lv = parseInt(lvlKey, 10)
        if (!Number.isFinite(lv) || lv > level) continue
        for (const raw of (Array.isArray(arr) ? arr : [])) {
          const name = typeof raw === 'string'
            ? raw.split('|')[0].replace(/\b\w/g, c => c.toUpperCase()).trim()
            : null
          if (name) push(name, classId, sourceFeature)
        }
      }
    }
  }
  for (const cls of (charData?.classes || [])) {
    const cd = classDataMap[cls.classId]
    if (!cd) continue
    consumeAdditional(cd.additionalSpells, cls.level, cls.classId, cls.classId)
    const subId = cls.subclassId
    if (!subId) continue
    const cleanSubId = String(subId).split(/__|\|/)[0].trim()
    const sub = (cd.subclasses || []).find(s =>
      s.id === subId || s.name === subId
      || s.id === cleanSubId || s.name === cleanSubId
      || s.shortName === cleanSubId
    )
    if (sub) consumeAdditional(sub.additionalSpells, cls.level, cls.classId, subId)
  }

  // XPHB (5.5e) shift: subclasses like Archfey, Fiend, Celestial,
  // Twilight Cleric, etc. encode "you always have these spells
  // prepared" as an inline `{type: 'table'}` entry on the feature
  // instead of `additionalSpells.prepared`. Walk every active
  // feature looking for a 2-column table whose first column header
  // matches "<class> Level"; treat each row as a "thereafter
  // always have these spells prepared" grant for the listed level.
  const SPELL_TAG_RE = /\{@spell\s+([^|}]+)(?:\|[^}]*)?\}/g
  const scanFeatureForSpellTables = (feature, classId, classLevel) => {
    if (!feature?.entries) return
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { for (const x of node) walk(x); return }
      if (node.type === 'table' && Array.isArray(node.colLabels) && Array.isArray(node.rows)) {
        const isLevelCol = /\blevel\b/i.test(node.colLabels[0] || '')
        const isSpellCol = /\bspell/i.test(node.colLabels[1] || '')
        if (isLevelCol && isSpellCol) {
          for (const row of node.rows) {
            const lvCell = row?.[0]
            const spCell = row?.[1]
            const lv = parseInt(typeof lvCell === 'string' ? lvCell : (lvCell?.roll?.exact ?? lvCell), 10)
            if (!Number.isFinite(lv) || lv > classLevel) continue
            const cellText = typeof spCell === 'string'
              ? spCell
              : JSON.stringify(spCell || '')
            for (const m of cellText.matchAll(SPELL_TAG_RE)) {
              const name = String(m[1] || '').trim()
              if (name) push(name, classId, feature.name)
            }
          }
        }
      }
      if (Array.isArray(node.entries)) walk(node.entries)
      if (Array.isArray(node.items))   walk(node.items)
    }
    walk(feature.entries)
  }
  for (const f of (activeFeatures || charData?.__activeFeatures || [])) {
    if (!f?.classId) continue
    const cls = (charData.classes || []).find(c => c.classId === f.classId)
    if (!cls) continue
    scanFeatureForSpellTables(f, f.classId, cls.level)
  }

  return out
}

// Pull race + subrace trait NAMES *and* their raw `entries` arrays
// from the 5etools race data. The names feed the featureEffects
// catalog's name-based match (so we can call out Fey Ancestry,
// Dwarven Resilience, …); the entries feed the dynamic trait
// scanner that emits synthetic save/HP/speed notes for any race
// trait the catalog hasn't translated yet — without a hardcoded
// race→features map.
export async function loadRaceTraits(edition, charData) {
  const raceId = charData?.species?.raceId
  if (!raceId) return { names: [], traits: [], fixedSkills: [] }
  const races = await loadRaceList(edition).catch(() => [])
  const race = races.find(r => r.id === raceId || r.name === raceId)
  if (!race) return { names: [], traits: [], fixedSkills: [] }
  const sub = (race.subraces || []).find(s =>
    s.id === charData.species.subraceId || s.name === charData.species.subraceId
  )
  const allEntries = [...(race.entries || []), ...(sub?.entries || [])]
  // Level-Gate: Trait-Blöcke mit `_hbLevel` (Homebrew) oder offizielle
  // 5etools-Konvention (manche MPMM-Rassen haben Sub-Features wie
  // "At 3rd level…") werden nur aktiviert wenn Char-Level >= Schwelle.
  const totalLevel = (charData?.classes || []).reduce(
    (s, c) => s + (c.level || 0), 0,
  )
  const names = []
  const traits = []
  for (const e of allEntries) {
    if (!e || typeof e !== 'object' || !e.name) continue
    const minLevel = parseInt(e._hbLevel, 10) || 1
    if (totalLevel < minLevel) continue
    names.push(String(e.name))
    traits.push({ name: String(e.name), entries: Array.isArray(e.entries) ? e.entries : [] })
  }
  // Fixed skill proficiencies from race + subrace data — e.g. 5e Elf
  // Keen Senses is `[{"perception": true}]` in races.json. Choice
  // blocks (`{"choose": {...}}`) are handled by the wizard via
  // species.traitChoices.skills; this only collects the always-on
  // grants the rules engine was previously ignoring.
  const fixedSkills = []
  const skillBlocks = [
    ...(race.skillProficiencies || []),
    ...(sub?.skillProficiencies || []),
  ]
  for (const block of skillBlocks) {
    if (!block || typeof block !== 'object') continue
    // Skip choice-style entries — those are user picks.
    if (block.choose || typeof block.any === 'number') continue
    for (const [k, v] of Object.entries(block)) {
      if (v === true && k !== 'choose' && k !== 'any') fixedSkills.push(k)
    }
  }
  return { names, traits, fixedSkills }
}

