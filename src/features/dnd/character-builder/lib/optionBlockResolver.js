// optionBlockResolver.js
//
// 5etools encodes "pick one of these sub-features" using an inline
// entries node of the form:
//
//   { type: 'options', count: 1, entries: [
//        { type: 'refClassFeature',    classFeature:    'Magician|Druid|XPHB|1' },
//        { type: 'refClassFeature',    classFeature:    'Warden|Druid|XPHB|1' },
//   ] }
//
// or
//
//   { type: 'options', count: 1, entries: [
//        { type: 'refOptionalfeature', optionalfeature: 'Archery' },
//        { type: 'refOptionalfeature', optionalfeature: 'Defense' },
//        ...
//   ] }
//
// or `refSubclassFeature`, `refFeat` — same pattern, different ref-shape.
//
// This module:
//   1. Walks any feature's `entries` for option-blocks
//   2. Resolves each ref-target to the underlying entry (name + entries)
//      via lookup maps that the caller provides
//   3. Emits ChoiceDescriptors (same shape as choiceParser.js) so the
//      generic choice-picker UI can render them
//   4. Provides a helper to determine which sub-features the character
//      has CHOSEN, so collectActiveClassFeatures can include only those
//
// Pure functions only — no React, no state, no fetch.

// ── Reference parsing ──────────────────────────────────────────────
// 5etools ref strings use pipe-delimited segments.
//
//   refClassFeature       "Name|ClassName|ClassSource|Level"
//   refSubclassFeature    "Name|ClassName|ClassSource|SubclassShortName|SubclassSource|Level"
//   refOptionalfeature    "Name"  OR  "Name|Source"
//   refFeat               "Name"  OR  "Name|Source"
//
// We tolerate missing trailing segments (some 5etools entries drop them
// when defaults apply) and we lowercase the source field for matching.
function parseRefString(refType, raw) {
  if (typeof raw !== 'string') return null
  const parts = raw.split('|').map(s => s.trim())
  switch (refType) {
    case 'refClassFeature':
      return {
        kind: 'classFeature',
        name:        parts[0] || '',
        className:   parts[1] || '',
        classSource: (parts[2] || '').toUpperCase(),
        level:       parseInt(parts[3] || '1', 10) || 1,
      }
    case 'refSubclassFeature':
      return {
        kind: 'subclassFeature',
        name:              parts[0] || '',
        className:         parts[1] || '',
        classSource:       (parts[2] || '').toUpperCase(),
        subclassShortName: parts[3] || '',
        subclassSource:    (parts[4] || '').toUpperCase(),
        level:             parseInt(parts[5] || '1', 10) || 1,
      }
    case 'refOptionalfeature':
      return {
        kind: 'optionalfeature',
        name:   parts[0] || '',
        source: (parts[1] || '').toUpperCase(),
      }
    case 'refFeat':
      return {
        kind: 'feat',
        name:   parts[0] || '',
        source: (parts[1] || '').toUpperCase(),
      }
    default:
      return null
  }
}

// Lookup-Bag-Shape den der Caller liefert:
//   { classDataMap:        { [classId]: classData },
//     optionalFeatureMap:  Map<lowername, entry>  OR  { [lowername]: entry },
//     featMap:             Map<lowername, entry>  OR  { [lowername]: entry } }
//
// Alle Maps sind tolerant — wenn der Caller einen Slot nicht füllt
// (z.B. optionalFeatureMap fehlt weil noch nicht geladen), liefert
// resolveRef einen Stub-Eintrag mit nur dem Namen. Die UI kann das
// trotzdem als auswählbare Option zeigen; die rich-Description wird
// nachgeladen wenn die Daten da sind.
function lookupOptionalFeature(opts, name, source) {
  const map = opts?.optionalFeatureMap
  if (!map) return null
  const lower = String(name || '').toLowerCase()
  const srcLower = String(source || '').toUpperCase()
  // Map-Form
  if (map instanceof Map) {
    const keyed = srcLower ? map.get(`${lower}|${srcLower}`) : null
    if (keyed) return keyed
    return map.get(lower) || null
  }
  // Object-Form
  if (srcLower && map[`${lower}|${srcLower}`]) return map[`${lower}|${srcLower}`]
  return map[lower] || null
}

function lookupFeat(opts, name, source) {
  const map = opts?.featMap
  if (!map) return null
  const lower = String(name || '').toLowerCase()
  const srcLower = String(source || '').toUpperCase()
  if (map instanceof Map) {
    if (srcLower) {
      const k = map.get(`${lower}|${srcLower}`)
      if (k) return k
    }
    return map.get(lower) || null
  }
  if (srcLower && map[`${lower}|${srcLower}`]) return map[`${lower}|${srcLower}`]
  return map[lower] || null
}

function lookupClassFeature(opts, className, name, classSource) {
  const cd = opts?.classDataMap?.[className]
  if (!cd) return null
  const nameLow = String(name || '').toLowerCase()
  const srcUp = String(classSource || '').toUpperCase()
  // Erster Treffer: gleicher Name UND classSource. classSource ist
  // wichtig damit z.B. der XPHB-"Magician" nicht versehentlich auf
  // ein PHB-Pendant fällt.
  return (cd.features || []).find(f => {
    if (!f?.name) return false
    if (String(f.name).toLowerCase() !== nameLow) return false
    if (srcUp && String(f.classSource || cd.source || '').toUpperCase() !== srcUp) return false
    return true
  }) || (cd.features || []).find(f =>
    String(f?.name || '').toLowerCase() === nameLow,
  ) || null
}

function lookupSubclassFeature(opts, className, subclassShortName, name) {
  const cd = opts?.classDataMap?.[className]
  if (!cd) return null
  const nameLow = String(name || '').toLowerCase()
  const subShortLow = String(subclassShortName || '').toLowerCase()
  const sub = (cd.subclasses || []).find(s =>
    String(s?.shortName || s?.name || '').toLowerCase() === subShortLow,
  )
  if (!sub) return null
  return (sub.features || []).find(f =>
    String(f?.name || '').toLowerCase() === nameLow,
  ) || null
}

// ── Public: resolve a single ref node ──────────────────────────────
// Returns { name, entries, source? } or a stub { name } when lookup
// misses (still useful for the picker UI label).
export function resolveRef(refNode, opts = {}) {
  if (!refNode || typeof refNode !== 'object') return null
  const t = refNode.type
  const raw = refNode.classFeature
          || refNode.subclassFeature
          || refNode.optionalfeature
          || refNode.feat
  const parsed = parseRefString(t, raw)
  if (!parsed) return null
  switch (parsed.kind) {
    case 'classFeature': {
      const hit = lookupClassFeature(opts, parsed.className, parsed.name, parsed.classSource)
      if (hit) return { ...parsed, entry: hit, name: hit.name, entries: hit.entries || [], source: hit.source || hit.classSource || parsed.classSource }
      return { ...parsed, entry: null, entries: [] }
    }
    case 'subclassFeature': {
      const hit = lookupSubclassFeature(opts, parsed.className, parsed.subclassShortName, parsed.name)
      if (hit) return { ...parsed, entry: hit, name: hit.name, entries: hit.entries || [], source: hit.source || parsed.subclassSource }
      return { ...parsed, entry: null, entries: [] }
    }
    case 'optionalfeature': {
      const hit = lookupOptionalFeature(opts, parsed.name, parsed.source)
      if (hit) return { ...parsed, entry: hit, name: hit.name, entries: hit.entries || [], source: hit.source || parsed.source, featureType: hit.featureType }
      return { ...parsed, entry: null, entries: [] }
    }
    case 'feat': {
      const hit = lookupFeat(opts, parsed.name, parsed.source)
      if (hit) return { ...parsed, entry: hit, name: hit.name, entries: hit.entries || [], source: hit.source || parsed.source }
      return { ...parsed, entry: null, entries: [] }
    }
    default:
      return null
  }
}

// ── Public: walk a feature's entries for option-blocks ─────────────
// Returns an array of { count, options: [resolvedRef, ...], path }
// describing every options-block found, deep-walked.
//
// `path` is a debug breadcrumb (array of indices) so the caller can
// generate stable choice IDs.
export function findOptionBlocks(featureEntries, opts = {}) {
  const out = []
  const walk = (node, path) => {
    if (!node) return
    if (Array.isArray(node)) {
      node.forEach((c, i) => walk(c, [...path, i]))
      return
    }
    if (typeof node !== 'object') return
    if (node.type === 'options' && Array.isArray(node.entries)) {
      const options = []
      for (const child of node.entries) {
        const resolved = resolveRef(child, opts)
        if (resolved) options.push(resolved)
      }
      if (options.length > 0) {
        // 5etools-Konvention: `options` mit explizitem `count` ist ein
        // CHOICE-Block (user wählt N von M). OHNE count ist es nur eine
        // strukturierte Listen-Anzeige der Sub-Features — alle werden
        // automatisch gewährt. Beispiel: Soulknife Psionic Power
        // listet Psi-Bolstered Knack + Psychic Whispers als ALL-granted
        // (RAW: "you have these powers"), nicht als Pick-one.
        const explicitCount = Number.isFinite(node.count) ? node.count : null
        // count = null signalisiert dem Caller "alle gewähren";
        // count > 0 = echter Pick.
        out.push({
          count: explicitCount,
          options,
          path: [...path],
          // _grantAll = true wenn kein explizites count gesetzt war:
          // CharacterSheetPage muss diese Refs dann auto-aktivieren.
          _grantAll: explicitCount == null,
        })
      }
      // Don't recurse into the options' own sub-entries — they're
      // rendered when the parent option is chosen, not as a nested
      // pick.
      return
    }
    // Recurse into common nested fields.
    if (Array.isArray(node.entries)) walk(node.entries, [...path, 'entries'])
    if (Array.isArray(node.items))   walk(node.items,   [...path, 'items'])
  }
  walk(featureEntries, [])
  return out
}

// ── Public: build ChoiceDescriptors for a single class-feature ─────
// `feature` is the source classFeature / subclassFeature entry.
// `ownerKey` identifies the class/level for stable IDs:
//   { source: 'class', classId: 'Druid', level: 1 }
// or
//   { source: 'subclass', classId: 'Druid', subclassId: 'Circle of the Land', level: 6 }
//
// Returned descriptor type === 'feature-option' so other consumers
// can distinguish from skill / language / spell picks.
export function buildFeatureOptionDescriptors(feature, ownerKey, opts = {}) {
  if (!feature?.entries) return []
  const blocks = findOptionBlocks(feature.entries, opts)
  if (blocks.length === 0) return []
  const descriptors = []
  blocks.forEach((block, blockIdx) => {
    // Grant-all-Blöcke (5etools `options` ohne count) sind KEINE Picks
    // — die Refs werden automatisch aktiviert. Wir emittieren KEINEN
    // Descriptor; CharacterSheetPage hat eine separate Code-Path die
    // diese Refs via collectActiveClassFeatures aufnimmt.
    if (block._grantAll) return
    // Stable, edition-aware ID. Same character will get the same ID
    // for the same block across reloads → choice persistence works.
    const idParts = [
      'optblock',
      ownerKey.source,
      String(ownerKey.classId || ''),
      String(ownerKey.subclassId || ''),
      String(ownerKey.level || ''),
      String(feature.name || ''),
      `b${blockIdx}`,
    ]
    const id = idParts.join('::')
    descriptors.push({
      id,
      source: ownerKey.source,
      sourceId: ownerKey.classId || ownerKey.subclassId || '',
      type: 'feature-option',
      label: feature.name,
      count: block.count,
      required: true,
      options: block.options.map(o => ({
        value: optionValueKey(o),
        label: o.name || '(unbenannt)',
        description: o.entries || [],
        meta: {
          kind: o.kind,
          source: o.source,
          featureType: o.featureType,
          // Roh-Resolved-Entry damit der Sheet bei Bedarf direkt das
          // ganze Feature rendern kann ohne nochmal lookup zu machen.
          entry: o.entry || null,
        },
      })),
      // Roh-Block-Refs für die Auswerteseite (collectActiveClassFeatures).
      _resolvedRefs: block.options,
      _featureName: feature.name,
      _featureLevel: feature.level || ownerKey.level || 1,
    })
  })
  return descriptors
}

// Stabiler Option-Value-Key: matched dem _resolvedRefs-Eintrag damit
// die Resolver-Logik wieder zurück findet, ohne den ganzen Entry zu
// serialisieren.
//
//   classFeature      → "cf:Magician|Druid|XPHB|1"
//   subclassFeature   → "sf:Magician|Druid|XPHB|Land|XPHB|6"
//   optionalfeature   → "of:Archery|PHB"
//   feat              → "ft:Tough|PHB"
export function optionValueKey(resolvedRef) {
  if (!resolvedRef) return ''
  const r = resolvedRef
  switch (r.kind) {
    case 'classFeature':
      return `cf:${r.name}|${r.className}|${r.classSource}|${r.level}`
    case 'subclassFeature':
      return `sf:${r.name}|${r.className}|${r.classSource}|${r.subclassShortName}|${r.subclassSource}|${r.level}`
    case 'optionalfeature':
      return `of:${r.name}${r.source ? '|' + r.source : ''}`
    case 'feat':
      return `ft:${r.name}${r.source ? '|' + r.source : ''}`
    default:
      return ''
  }
}

// ── Public: which sub-features should be active for a feature? ─────
// Returns the list of resolved refs (full entries) that the character
// has chosen for the given feature. Empty when the option block exists
// but no choice has been made yet — caller decides whether to include
// the parent feature still.
//
// `choices` is the character.choices object. We look up the same IDs
// that buildFeatureOptionDescriptors emits.
export function getChosenFeatureOptions(feature, ownerKey, choices, opts = {}) {
  const descriptors = buildFeatureOptionDescriptors(feature, ownerKey, opts)
  const out = []
  for (const d of descriptors) {
    const chosen = choices?.[d.id]
    const chosenArr = Array.isArray(chosen) ? chosen : (chosen ? [chosen] : [])
    for (const valueKey of chosenArr) {
      const match = d._resolvedRefs.find(r => optionValueKey(r) === valueKey)
      if (match?.entry) out.push(match.entry)
    }
  }
  return out
}

// Helper für UI: gibt true zurück wenn das Feature überhaupt einen
// Options-Block hat (=> die Card soll einen "Choose"-Hinweis zeigen).
export function featureHasOptionBlock(feature, opts = {}) {
  if (!feature?.entries) return false
  return findOptionBlocks(feature.entries, opts).length > 0
}

// ── Public: alle Feature-Option-Descriptors für eine Klasse + Level ──
//
// Geht durch ALLE Class- und Subclass-Features bis einschließlich
// `classLevel`, ruft buildFeatureOptionDescriptors auf jedem auf,
// dedupliziert über die descriptor-ID (gleiche Features im 5.5e-
// Datensatz erscheinen sowohl als PHB- als auch XPHB-Eintrag — wir
// nehmen die XPHB-Variante zuerst, gleicher PREFERRED-Rank wie
// collectActiveClassFeatures).
//
// `classEntry` = der Charakter-Eintrag mit { classId, level, subclassId }.
// `classData`  = das Resultat von loadClassData(edition, classId).
// `opts`       = { classDataMap, optionalFeatureMap, featMap, edition }.
export function parseClassFeatureOptionChoices(classEntry, classData, opts = {}) {
  if (!classEntry || !classData) return []
  const classId = classEntry.classId
  const classLevel = classEntry.level || 1
  const subclassId = classEntry.subclassId || null
  const edition = opts?.edition || '5e'
  const is55e = edition === '5.5e'

  // PHB vs XPHB dedup: gleicher Name + gleicher Level kann doppelt in
  // classFeature[] stehen — wir picken die preferred-source-Variante.
  const PREFERRED = ['XPHB', 'XDMG', 'XMM']
  const sourceRank = (s) => {
    const i = PREFERRED.indexOf((s || '').toUpperCase())
    return i >= 0 ? i : 99
  }

  const cd = classData
  // Resolver braucht classDataMap mit der eigenen Klasse drin damit
  // refClassFeature im selben Feature-Tree (Druid Primal Order →
  // Magician/Warden) gefunden wird.
  const resolverOpts = {
    ...opts,
    classDataMap: {
      ...(opts.classDataMap || {}),
      [classId]: cd,
    },
  }

  // Helper: Edition-Match-Filter, identisch zur Logik in
  // collectActiveClassFeatures. Stops PHB-features from leaking into
  // a 5.5e character (or vice versa).
  const matchesEdition = (f) => {
    if (!is55e) return true
    if (!f?.classSource) return true
    const src = String(f.classSource).toUpperCase()
    if (src === String(cd.source || '').toUpperCase()) return true
    if (PREFERRED.includes(src)) return true
    return false
  }

  // Dedup by name+level, prefer XPHB.
  const dedupByKey = (list, getKey) => {
    const byKey = new Map()
    for (const f of list) {
      const k = getKey(f)
      const ex = byKey.get(k)
      if (!ex || sourceRank(f.source) < sourceRank(ex.source)) byKey.set(k, f)
    }
    return [...byKey.values()]
  }

  const eligibleClassFeatures = dedupByKey(
    (cd.features || []).filter(f =>
      f?.name
      && (f.level || 1) <= classLevel
      && !f.isClassFeatureVariant
      && matchesEdition(f),
    ),
    f => `${f.name}|${f.level || 1}`,
  )

  const all = []
  for (const f of eligibleClassFeatures) {
    const ownerKey = { source: 'class', classId, level: f.level || 1 }
    const descs = buildFeatureOptionDescriptors(f, ownerKey, resolverOpts)
    all.push(...descs)
  }

  // Subclass-Features
  if (subclassId) {
    const cleanSubId = String(subclassId).split(/__|\|/)[0].trim()
    const sub = (cd.subclasses || []).find(s =>
      s.id === subclassId || s.name === subclassId
      || s.id === cleanSubId || s.name === cleanSubId
      || s.shortName === cleanSubId,
    )
    if (sub) {
      const subFeatures = []
      if (Array.isArray(sub.features)) {
        for (const f of sub.features) {
          if (!f?.name) continue
          if ((f.level || 1) > classLevel) continue
          if (f.isClassFeatureVariant) continue
          subFeatures.push(f)
        }
      }
      if (sub.featuresPerLevel) {
        for (const [lvlStr, feats] of Object.entries(sub.featuresPerLevel)) {
          const lvl = parseInt(lvlStr, 10)
          if (!Number.isFinite(lvl) || lvl > classLevel) continue
          for (const f of (feats || [])) {
            if (f?.name) subFeatures.push({ ...f, level: lvl })
          }
        }
      }
      const deduped = dedupByKey(subFeatures, f => `${f.name}|${f.level || 1}`)
      for (const f of deduped) {
        const ownerKey = {
          source: 'subclass',
          classId,
          subclassId,
          level: f.level || 1,
        }
        const descs = buildFeatureOptionDescriptors(f, ownerKey, resolverOpts)
        all.push(...descs)
      }
    }
  }

  // Final dedup by descriptor-ID (sollte selten greifen — Klassen
  // haben pro Feature+Level nur einen Block — aber wir wollen
  // robust sein.)
  const seen = new Set()
  return all.filter(d => {
    if (seen.has(d.id)) return false
    seen.add(d.id)
    return true
  })
}
