import { parseTags } from './tagParser'

const SOURCES = {
  '5e':   '/data/5e',
  '5.5e': '/data/5.5e',
}

const cache = {}

// 5.5e source priority for de-duplication: prefer 2024 sources over legacy
const PREFERRED_55E_SOURCES = ['XPHB', 'XDMG', 'XMM']

async function fetchData(edition, path) {
  if (!edition || !SOURCES[edition]) {
    console.warn(`[dataLoader] skip fetch — unknown edition "${edition}" (path: ${path})`)
    return null
  }
  const key = `${edition}:${path}`
  if (cache[key] !== undefined) return cache[key]
  const url = `${SOURCES[edition]}/${path}`
  try {
    const res = await fetch(url)
    if (!res.ok) { console.warn(`[dataLoader] ${res.status}: ${url}`); cache[key] = null; return null }
    // Vite dev-server + Tauri serve den SPA-index.html als Fallback für
    // fehlende statische Dateien. Wenn der content-type HTML ist oder
    // der Body mit `<` anfängt, ist das Datei-Fetch ins Leere gegangen.
    // Wir behandeln das als "Datei existiert nicht" (cached) damit die
    // Konsole nicht mit fehlgeschlagenen JSON-Parses zugespammt wird.
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('html')) {
      cache[key] = null
      return null
    }
    const text = await res.text()
    if (text.trimStart().startsWith('<')) {
      cache[key] = null
      return null
    }
    const data = JSON.parse(text)
    cache[key] = data
    return data
  } catch (e) {
    console.error(`[dataLoader] Failed: ${url}`, e)
    cache[key] = null
    return null
  }
}

// ── BUILD SPELL→CLASS MAP FROM sources.json ────────────────
// sources.json structure: { SOURCE_BOOK: { SpellName: { class: [...], classVariant: [...] } } }
// Returns: Map<lowercase_spell_name, Set<className>>

async function buildSpellClassMap(edition) {
  const sources = await fetchData(edition, 'spells/sources.json')
  const map = new Map()

  if (!sources) {
    console.warn('[dataLoader] sources.json not found — spell filtering will be limited')
  }

  // Existing sources.json logic
  for (const [, spellsInBook] of Object.entries(sources || {})) {
    for (const [spellName, data] of Object.entries(spellsInBook)) {
      const key = spellName.toLowerCase()
      if (!map.has(key)) map.set(key, new Set())
      const classSet = map.get(key)
      for (const c of (data.class || []))        classSet.add(c.name)
      for (const c of (data.classVariant || [])) classSet.add(c.name)
    }
  }

  // NEU: spell-lists.json supplementieren (deckt EGW, GGR etc. ab)
  const spellLists = await fetchData(edition, 'spell-lists.json')
  if (spellLists) {
    for (const [className, spellNames] of Object.entries(spellLists)) {
      for (const spellName of (spellNames || [])) {
        const key = spellName.toLowerCase()
        if (!map.has(key)) map.set(key, new Set())
        map.get(key).add(className)
      }
    }
  }

  console.log(`[dataLoader] sources.json (${edition}): ${map.size} spells indexed`)
  return map
}

// ── RACES ──────────────────────────────────────────────────

export async function loadRaceList(edition) {
  const data = await fetchData(edition, 'races.json')
  if (!data) return []

  const allRaces = []

  for (const race of (data.race || [])) {
    if (!isEditionMatch(race.source, edition)) continue
    allRaces.push({
      id: `${race.name}__${race.source}`,
      name: race.name,
      source: race.source,
      speed: typeof race.speed === 'number' ? race.speed : (race.speed?.walk ?? 30),
      size: race.size || ['M'],
      ability: race.ability || [],
      entries: race.entries || [],
      traitTags: race.traitTags || [],
      languageProficiencies: race.languageProficiencies || [],
      toolProficiencies:     race.toolProficiencies     || [],   // FIX: was missing
      weaponProficiencies:   race.weaponProficiencies   || [],   // FIX: was missing
      darkvision: race.darkvision || null,
      additionalSpells: race.additionalSpells || [],
      feats: race.feats || [],
      skillProficiencies: race.skillProficiencies || [],
      _versions: race._versions || null,   // FIX: needed by choiceParser for variant-aware descriptor assignment
      hasSubraces: false,
      subraces: [],
    })
  }

  for (const sub of (data.subrace || [])) {
    if (!isEditionMatch(sub.source, edition)) continue
    // Unterrassen ohne Namen überspringen
    if (!sub.name || !sub.name.trim()) continue
    const parent = allRaces.find(r => r.name === sub.raceName)
    if (parent) {
      parent.hasSubraces = true
      parent.subraces.push({
        id: `${sub.name}__${sub.source}`,
        name: sub.name,
        source: sub.source,
        speed: typeof sub.speed === 'number' ? sub.speed : (sub.speed?.walk ?? null),
        darkvision: sub.darkvision ?? null,
        ability: sub.ability || [],
        entries: sub.entries || [],
        traitTags: sub.traitTags || [],
        additionalSpells: sub.additionalSpells || [],
        feats: sub.feats || [],
        skillProficiencies:    sub.skillProficiencies    || [],
        languageProficiencies: sub.languageProficiencies || [],   // FIX: was missing
        toolProficiencies:     sub.toolProficiencies     || [],   // FIX: was missing
        weaponProficiencies:   sub.weaponProficiencies   || [],   // FIX: was missing
        _versions: sub._versions || null,   // FIX: needed by choiceParser for variant-aware descriptor assignment
      })
    }
  }

  // 5.5e de-duplication: prefer XPHB over PHB when same name exists
  if (edition === '5.5e') return deduplicateByName(allRaces).sort((a, b) => a.name.localeCompare(b.name))
  return allRaces.sort((a, b) => a.name.localeCompare(b.name))
}

// ── CLASSES ────────────────────────────────────────────────

export async function loadClassList(edition) {
  const classNames = [
    'barbarian','bard','cleric','druid','fighter',
    'monk','paladin','ranger','rogue','sorcerer',
    'warlock','wizard','artificer',
  ]
  const classes = []
  const seen = new Set()
  const is55e = edition === '5.5e'

  for (const name of classNames) {
    const data = await fetchData(edition, `class/class-${name}.json`)
    if (!data?.class) continue

    // ── Pick the right class entry ──────────────────────────────────────
    // 5.5e files contain both PHB and XPHB versions. Strict edition filter:
    // 5.5e → nur XPHB-Klassen, 5e → nur non-X-Klassen.
    const officialClasses = data.class.filter(c => isEditionMatch(c.source, edition))
    let cls = null
    if (is55e) {
      cls = officialClasses.find(c => PREFERRED_55E_SOURCES.includes(c.source))
           || officialClasses[0]
    } else {
      cls = officialClasses[0]
    }
    if (!cls) continue
    if (seen.has(cls.name)) continue
    seen.add(cls.name)

    const classSource = cls.source  // e.g. 'XPHB' or 'PHB'
    const subclassFeatureArray = data.subclassFeature || []

    // ── Filter subclasses by edition + classSource ───────────────────────
    // Strict: nur Subclasses aus der passenden Edition-Family. Zusätzlich
    // bei 5.5e nur die Subclasses deren classSource zur gewählten Class-
    // Source passt (interne Kohärenz innerhalb der 2024-Edition).
    const rawSubclasses = (data.subclass || [])
      .filter(s => {
        if (s.className !== cls.name) return false
        if (!isEditionMatch(s.source, edition)) return false
        if (is55e && s.classSource && s.classSource !== classSource) return false
        return true
      })

    // De-duplicate subclasses by shortName — prefer XPHB source
    const subMap = new Map()
    for (const s of rawSubclasses) {
      const key = (s.shortName || s.name).toLowerCase()
      const existing = subMap.get(key)
      if (!existing) {
        subMap.set(key, s)
      } else if (is55e && PREFERRED_55E_SOURCES.includes(s.source) && !PREFERRED_55E_SOURCES.includes(existing.source)) {
        subMap.set(key, s)
      }
    }

    const subclasses = [...subMap.values()].map(s => {
      const shortName = s.shortName || s.name
      const featuresPerLevel = {}
      // Many 5.5e subclasses (Fey Wanderer, Gloom Stalker, Hexblade,
      // …) keep their original classSource tag of "PHB" even when the
      // 2024 subclass entry has classSource="XPHB" — the XPHB
      // subclass just `_copy`s the older features rather than
      // re-tagging them. So strict classSource matching on feature
      // entries empties the table. Match by subclassShortName only
      // and dedupe by name+level so PHB + XPHB doublets collapse to
      // one row. Lookup of the actual source if needed is left to
      // downstream code; the picker only needs the names + entries.
      for (const f of subclassFeatureArray) {
        if (f.subclassShortName !== shortName) continue
        if (f.isClassFeatureVariant) continue
        if (!f.level || !f.name) continue
        if (!featuresPerLevel[f.level]) featuresPerLevel[f.level] = []
        const alreadyHas = featuresPerLevel[f.level].some(x => x.name === f.name)
        if (!alreadyHas) {
          featuresPerLevel[f.level].push({ name: f.name, entries: f.entries || [] })
        }
      }
      return {
        name: s.name,
        source: s.source,
        shortName,
        entries: s.entries || [],
        featuresPerLevel,
        // Pass through subclass spellcasting data (for EK, AT, etc.)
        spellcastingAbility: s.spellcastingAbility || null,
        casterProgression:   normCasterProg(s.casterProgression),
        optionalfeatureProgression: s.optionalfeatureProgression || [],
      }
    })

    // ── Build class features per level, source-filtered for 5.5e ────────
    const featuresPerLevel = buildFeaturesPerLevel(
      data.classFeature || [], cls.name, is55e ? classSource : null
    )

    classes.push({
      id: cls.name,
      name: cls.name,
      source: cls.source,
      proficiency: cls.proficiency || [],
      hitDie: cls.hd?.faces || 8,
      spellcastingAbility: cls.spellcastingAbility || null,
      casterProgression: normCasterProg(cls.casterProgression),
      subclassTitle: cls.subclassTitle || 'Subclass',
      subclassLevel: deriveSubclassLevel(cls),
      entries: cls.entries || [],
      classFeatures: cls.classFeatures || [],
      featuresPerLevel,
      subclasses,
      startingProficiencies: cls.startingProficiencies || {},
      startingEquipment: cls.startingEquipment || {},
      optionalfeatureProgression: cls.optionalfeatureProgression || [],
      // 5.5e moves a number of picks (Fighting Style, Metamagic, Epic
      // Boon, Eldritch Invocations) onto featProgression with category
      // filters (FS / FS:R / FS:P / EB / MM / EI). Forgetting to
      // forward this field silently broke the level-up picker — every
      // class that gained one of those at L≥2 would skip Step 4.
      featProgression: cls.featProgression || [],
      classTableGroups: cls.classTableGroups || [],
      multiclassing: cls.multiclassing || null,
    })
  }

  return classes.sort((a, b) => a.name.localeCompare(b.name))
}

function buildFeaturesPerLevel(classFeatureArray, className, preferredSource) {
  const map = {}
  for (const feature of classFeatureArray) {
    if (feature.className !== className) continue
    if (!feature.level || !feature.name) continue
    if (feature.isClassFeatureVariant) continue
    // For 5.5e: only include features matching the preferred source (XPHB)
    // This prevents PHB features appearing alongside XPHB features
    if (preferredSource && feature.source !== preferredSource) continue
    if (!map[feature.level]) map[feature.level] = []
    map[feature.level].push({ name: feature.name, entries: feature.entries || [] })
  }
  return map
}

/**
 * Derive the subclass selection level from the class's classFeatures array.
 * 5etools stores this as entries with `gainSubclassFeature: true` in the
 * classFeatures list, e.g. { classFeature: "Divine Domain|Cleric||1", gainSubclassFeature: true }
 * The level is the 4th pipe-delimited segment of the classFeature string.
 * Falls back to 3 if not found.
 */
function deriveSubclassLevel(cls) {
  if (cls.subclassLevel) return cls.subclassLevel
  for (const cf of (cls.classFeatures || [])) {
    if (typeof cf === 'object' && cf.gainSubclassFeature) {
      const parts = (cf.classFeature || '').split('|')
      const level = parseInt(parts[3])
      if (!isNaN(level) && level > 0) return level
    }
  }
  return 3
}

export async function loadClassData(edition, classId) {
  const fileName = classId.toLowerCase()
  const data = await fetchData(edition, `class/class-${fileName}.json`)
  if (!data) return null

  // 5.5e class JSONs ship multiple `class` entries — the legacy PHB one
  // first, then the 2024 XPHB rewrite. The XPHB version is what carries
  // the 5.5e `classTableGroups` (Fighter "Second Wind" 2→3→4 etc.) and
  // updated starting proficiencies, so we must prefer it. Without this
  // preference loadClassData returned the PHB entry — silently breaking
  // every table-driven 5.5e resource.
  const officialClasses = (data.class || []).filter(c => isEditionMatch(c.source, edition))
  const matching = officialClasses.filter(c => c.name === classId)
  const is55e = edition === '5.5e'
  let cls = null
  if (is55e) {
    cls = matching.find(c => PREFERRED_55E_SOURCES.includes(c.source))
      || matching[0]
      || data.class?.find(c => c.name === classId)
  } else {
    cls = matching[0] || data.class?.find(c => c.name === classId)
  }
  // Strict-Edition Subclass-Filter — bei 5.5e nur XPHB-Subclasses,
  // bei 5e nur non-X-Subclasses (kein Auto-Bridge der 2024-Subclasses
  // in 5e-Charaktere).
  const subclasses = (data.subclass || []).filter(
    s => s.className === classId && isEditionMatch(s.source, edition)
  )
  // Cross-edition guard: 5.5e class JSONs ship BOTH legacy (PHB) und
  // 2024 (XPHB) Versionen jeder Feature für Backward-Compat. Wir
  // dedupen in zwei Phasen:
  //   1. Same-name-same-level: bevorzuge die Edition-passende Variante
  //   2. Same-level-different-name (5.5e only): wenn auf einer Stufe
  //      eine XPHB-Variante existiert, droppen wir ALLE PHB-Varianten
  //      auf derselben Stufe (5e PHB hat z.B. "Extra Attack (2)" L11,
  //      5.5e XPHB hat dafür "Two Extra Attacks" L11 — unterschiedliche
  //      Namen aber gleiche Mechanik; doppelt = Spieler sieht beide).
  // Ausnahme: PHB-Feature wird BEHALTEN wenn auf seiner Stufe kein
  // einziges XPHB-Feature existiert (Subclass-Stub-Features wie
  // "Martial Archetype feature L7 (PHB)" haben kein XPHB-Pendant).
  // Strict edition gate ZUERST — danach erst die same-name-same-level
  // Dedup. Verhindert dass 5e-Charaktere XPHB-Features sehen oder
  // 5.5e-Charaktere PHB-Reste die kein XPHB-Pendant haben.
  const rawClassFeatures = (data.classFeature || []).filter(
    f => f.className === classId && isEditionMatch(f.source, edition),
  )
  const featureKey = (f) => `${f.name}::${f.level ?? 0}::${f.className}`
  const isXphb = (f) => PREFERRED_55E_SOURCES.includes(f?.source)

  // Phase 1: same-name same-level dedup
  const byKey = new Map()
  for (const f of rawClassFeatures) {
    const k = featureKey(f)
    const existing = byKey.get(k)
    if (!existing) { byKey.set(k, f); continue }
    if (is55e) {
      if (isXphb(f) && !isXphb(existing)) byKey.set(k, f)
    } else {
      if (isXphb(existing) && !isXphb(f)) byKey.set(k, f)
    }
  }
  let classFeatures = [...byKey.values()]

  // Phase 2 (5.5e only): drop PHB features auf Stufen die schon eine
  // XPHB-Variante haben — die XPHB-Feature ersetzt mechanisch die PHB
  // (z.B. "Two Extra Attacks" L11 ersetzt "Extra Attack (2)" L11).
  if (is55e) {
    const xphbLevels = new Set(
      classFeatures.filter(isXphb).map(f => f.level ?? 0),
    )
    classFeatures = classFeatures.filter(f => isXphb(f) || !xphbLevels.has(f.level ?? 0))
  }

  // Subclass-Features: gleiche Logik aber gekeyt zusätzlich auf
  // subclassShortName damit Champion-PHB nicht mit Battle-Master-XPHB
  // kollidiert.
  const rawSubFeatures = (data.subclassFeature || []).filter(
    f => isEditionMatch(f.source, edition),
  )
  const subKey = (f) => `${f.name}::${f.level ?? 0}::${f.className}::${f.subclassShortName}`
  const subByKey = new Map()
  for (const f of rawSubFeatures) {
    const k = subKey(f)
    const existing = subByKey.get(k)
    if (!existing) { subByKey.set(k, f); continue }
    if (is55e) {
      if (isXphb(f) && !isXphb(existing)) subByKey.set(k, f)
    } else {
      if (isXphb(existing) && !isXphb(f)) subByKey.set(k, f)
    }
  }
  let subclassFeatures = [...subByKey.values()]
  // Phase 2 für Subclass: per (subclassShortName, level) wenn XPHB
  // vorhanden → drop PHB.
  if (is55e) {
    const xphbSubLevels = new Set(
      subclassFeatures.filter(isXphb)
        .map(f => `${f.subclassShortName}::${f.level ?? 0}`),
    )
    subclassFeatures = subclassFeatures.filter(f =>
      isXphb(f) || !xphbSubLevels.has(`${f.subclassShortName}::${f.level ?? 0}`),
    )
  }

  return {
    ...cls,
    subclasses: subclasses.map(sub => ({
      id: sub.name,
      name: sub.name,
      source: sub.source,
      shortName: sub.shortName || sub.name,
      entries: sub.entries || [],
      features: subclassFeatures.filter(
        f => f.subclassShortName === sub.shortName && f.className === classId
      ),
    })),
    features: classFeatures,
  }
}

// ── BACKGROUNDS ────────────────────────────────────────────

/**
 * Parse 5etools feat reference format from backgrounds/races.
 * Input:  [{"magic initiate; cleric|xphb": true}]
 * Output: [{name: "Magic Initiate", source: "XPHB", variant: "Cleric"}]
 * Also handles the simple {name, source} format from older data.
 */
function parseFeatRefs(featsArray) {
  const result = []
  for (const entry of (featsArray || [])) {
    if (!entry || typeof entry !== 'object') continue
    // Already in {name, source} format (older data / already parsed)
    if (entry.name) { result.push(entry); continue }
    // 5etools keyed format: {"feat name; variant|source": true}
    for (const [key, val] of Object.entries(entry)) {
      if (val !== true) continue
      const [nameVariant, src] = key.split('|')
      const parts = nameVariant.split(';').map(s => s.trim())
      // Title-case the feat name
      const name = parts[0].replace(/\b\w/g, c => c.toUpperCase())
      result.push({
        name,
        source: (src || '').toUpperCase(),
        variant: parts[1] ? parts[1].replace(/\b\w/g, c => c.toUpperCase()) : null,
      })
    }
  }
  return result
}

export async function loadBackgroundList(edition) {
  const data = await fetchData(edition, 'backgrounds.json')
  if (!data) return []

  const all = (data.background || [])
    .filter(bg => isEditionMatch(bg.source, edition))
    .map(bg => ({
      id: `${bg.name}__${bg.source}`,
      name: bg.name,
      source: bg.source,
      skillProficiencies: bg.skillProficiencies || [],
      toolProficiencies: bg.toolProficiencies || [],
      languageProficiencies: bg.languageProficiencies || [],
      feats: parseFeatRefs(bg.feats),       // FIX: parse 5etools keyed format
      ability: bg.ability || [],
      entries: bg.entries || [],
      startingEquipment: bg.startingEquipment || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // 5.5e de-duplication: prefer XPHB over PHB when same name exists
  if (edition === '5.5e') return deduplicateByName(all)
  return all
}

// ── OPTIONAL FEATURES ──────────────────────────────────────

/**
 * Load optionalfeatures.json for the given edition.
 * Returns the raw optionalfeature[] array.
 * Used by FeatChoiceSectionNew in Step7Proficiencies so it hits the correct
 * edition-aware path (/data/5e/... vs /data/5.5e/...) instead of a bare
 * fetch('/data/optionalfeatures.json') which always fails.
 *
 * 5.5e dedup: each maneuver / invocation / metamagic option appears in both
 * the legacy source (TCE / PHB) and the 2024 XPHB rewrite, so the raw array
 * has e.g. "Ambush" twice. We keep the XPHB version (preferred source list)
 * and drop the legacy duplicate — same approach the feat/background/race
 * loaders already use.
 */
export async function loadOptionalFeatureList(edition) {
  const data = await fetchData(edition || '5e', 'optionalfeatures.json')
  const raw = data?.optionalfeature || []
  // Strict edition gate: 5.5e bekommt nur XPHB-Optionalfeatures
  // (Fighting Styles, Maneuvers, Invocations, Metamagic der 2024-
  // Edition); 5e behält PHB / TCE / XGE.
  const all = raw.filter(f => isEditionMatch(f.source, edition))
  if (edition === '5.5e') return deduplicateByName(all)
  return all
}

// ── FEATS ──────────────────────────────────────────────────

export async function loadFeatList(edition) {
  const data = await fetchData(edition, 'feats.json')
  if (!data) return []

  const all = (data.feat || [])
    .filter(f => isEditionMatch(f.source, edition))
    .map(f => ({
      id: `${f.name}__${f.source}`,
      name: f.name,
      source: f.source,
      prerequisite: f.prerequisite || null,
      ability: f.ability || [],
      entries: f.entries || [],
      category: f.category || null,
      repeatable: f.repeatable || false,
      abilityChoices: extractFeatAbilityChoices(f),
      additionalSpells: f.additionalSpells || [],
      skillProficiencies:         f.skillProficiencies         || [],
      toolProficiencies:          f.toolProficiencies          || [],
      weaponProficiencies:        f.weaponProficiencies        || [],
      armorProficiencies:         f.armorProficiencies         || [],
      optionalfeatureProgression: f.optionalfeatureProgression || [],
      languageProficiencies:      f.languageProficiencies      || [],
      expertise:                  f.expertise                  || [],
      _versions:                  f._versions                  || null,
      // 5.5e new fields
      skillToolLanguageProficiencies: f.skillToolLanguageProficiencies || [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // 5.5e de-duplication: prefer XPHB over PHB when same name exists
  if (edition === '5.5e') return deduplicateByName(all)
  return all
}

function extractFeatAbilityChoices(feat) {
  const choices = []
  for (const entry of (feat.ability || [])) {
    if (entry.choose) {
      choices.push({ count: entry.choose.count || 1, from: entry.choose.from || [] })
    }
  }
  return choices
}

// ── SPELLS ─────────────────────────────────────────────────

/**
 * Resolves the list of spell files to load for a given edition.
 *
 * FIX: Was hardcoded to 3 files (phb, xge, tce).
 *      Now loads spells/index.json (built by download-data.cjs) to discover
 *      all available spell files dynamically.  Falls back to a complete
 *      hardcoded list so it still works without the index file.
 */
async function resolveSpellFiles(edition) {
  // Both editions: read spells/index.json which lists every source
  // file present. For 5.5e this includes TCE / XGE / SCC / GGR /
  // FTD / etc. — sources that the 2024 PHB's expanded class lists
  // (Ranger, Paladin, …) reference for cantrips like Booming Blade,
  // Sword Burst, Magic Stone. The previous 5.5e-only hardcode to
  // just XPHB + PHB silently dropped those spells, and the class
  // spell pickers showed "Keine Zauber gefunden".
  const indexData = await fetchData(edition, 'spells/index.json')
  // BUGFIX: also check length > 0 — an empty {} is truthy but would return []
  // and silently skip the fallback, resulting in zero spells loaded.
  if (indexData && typeof indexData === 'object' && Object.keys(indexData).length > 0) {
    const files = Object.values(indexData).map(f => `spells/${f}`)
    console.log(`[dataLoader] spells/index.json: ${files.length} spell files found`)
    return files
  }

  // Fallback: full hardcoded list (same order as 5etools canonical sources)
  console.warn('[dataLoader] spells/index.json missing or empty — using hardcoded fallback')
  return [
    'spells/spells-phb.json',
    'spells/spells-xge.json',
    'spells/spells-tce.json',
    'spells/spells-aag.json',
    'spells/spells-ai.json',
    'spells/spells-aitfr-avt.json',
    'spells/spells-bmt.json',
    'spells/spells-egw.json',
    'spells/spells-ftd.json',
    'spells/spells-ggr.json',
    'spells/spells-idrotf.json',
    'spells/spells-llk.json',
    'spells/spells-sato.json',
    'spells/spells-scc.json',
  ]
}

export async function loadSpellList(edition) {
  // 1. Build spell→class map from sources.json (authoritative for PHB, XGE, TCE …)
  const spellClassMap = await buildSpellClassMap(edition)

  // 2. Discover spell files dynamically instead of using a hardcoded 3-file list
  const files = await resolveSpellFiles(edition)
  const spellListsData = await fetchData(edition, 'spell-lists.json')
  const spellListsMap = new Map()
  if (spellListsData) {
    for (const [className, names] of Object.entries(spellListsData)) {
      for (const name of (names || [])) {
        const key = name.toLowerCase()
        if (!spellListsMap.has(key)) spellListsMap.set(key, new Set())
        spellListsMap.get(key).add(className)
      }
    }
    console.log(`[dataLoader] spell-lists.json: ${spellListsMap.size} spells indexed`)
  }
  const all  = []
  const seen = new Set()

  for (const file of files) {
    const data = await fetchData(edition, file)
    if (!data) continue
    const spellArray = data.spell || data.spells || []
    console.log(`[dataLoader] ${file}: ${spellArray.length} spells`)

    for (const spell of spellArray) {
      const uid = `${spell.name}__${spell.source}`
      if (seen.has(uid)) continue
      seen.add(uid)

      // Build the spell's class list by UNIONING every known source.
      //
      // sources.json is the older mapping and is the authoritative
      // record for the legacy 5e class assignments. spell-lists.json
      // is the newer per-edition list that, in 5.5e, adds the
      // expanded Ranger / Paladin / Druid / etc. lists — including
      // cantrips that sources.json never tagged for those classes
      // (Booming Blade on Ranger, etc.). Preferring one over the
      // other dropped spells from whichever side was missing; the
      // union path keeps every legitimate assignment without losing
      // anything. Inline `extractSpellClassesFallback` is still the
      // last-resort when neither map knows about the spell at all.
      const classesFromSources = spellClassMap.get(spell.name.toLowerCase())
      const classesFromLists   = spellListsMap.get(spell.name.toLowerCase())
      const mergedClasses = new Set()
      if (classesFromSources?.size) for (const c of classesFromSources) mergedClasses.add(c)
      if (classesFromLists?.size)   for (const c of classesFromLists)   mergedClasses.add(c)
      const classes = mergedClasses.size > 0
        ? Array.from(mergedClasses)
        : extractSpellClassesFallback(spell)

      all.push({
        id: uid,
        name: spell.name,
        source: spell.source || '',
        level: spell.level ?? 0,
        school: spell.school || 'U',
        castingTime: formatCastingTime(spell.time),
        range: formatRange(spell.range),
        components: spell.components || {},
        duration: formatDuration(spell.duration),
        concentration: !!(spell.duration?.some(d => d.concentration)),
        ritual: !!(spell.meta?.ritual),
        classes,
        entries: spell.entries || [],
        entriesHigherLevel: spell.entriesHigherLevel || [],
        damageType: spell.damageInflict || [],
        savingThrow: spell.savingThrow || [],
        conditionInflict: spell.conditionInflict || [],
        spellAttack: spell.spellAttack || [],
      })
    }
  }

  // ── SUPPLEMENT via spell-lists-full.json ──────────────────────────────────
  //
  // spell-lists-full.json has the shape:
  //   { "Wizard": [{name, source, level, school}, …], "Cleric": […], … }
  //
  // It contains every spell on every class list across ALL books.
  // We use it to fill in any spells that weren't loaded from their source
  // files (e.g. because spells-egw.json or spells-ggr.json don't exist on
  // the server yet).  Spells already loaded from their book file are skipped
  // (the `seen` set prevents duplicates) so they keep their full detail data.
  // Supplemented spells get basic metadata sufficient for the picker UI;
  // the detail panel will show limited info for them.
  const supplement = await fetchData(edition, 'spell-lists-full.json')
  if (supplement && typeof supplement === 'object') {
    // Build a reverse map: lowercase spell name → Set<className>
    // This lets us assign the correct class list to each supplemented spell.
    const supplementClassMap = new Map() // lowercase name → Set<className>
    for (const [className, spellsArr] of Object.entries(supplement)) {
      for (const s of (spellsArr || [])) {
        const key = s.name?.toLowerCase()
        if (!key) continue
        if (!supplementClassMap.has(key)) supplementClassMap.set(key, new Set())
        supplementClassMap.get(key).add(className)
      }
    }

    // Collect unique spells from all class arrays and add missing ones
    const allSupplementSpells = new Map() // name__source → spell obj
    for (const spellsArr of Object.values(supplement)) {
      for (const s of (spellsArr || [])) {
        if (!s?.name || !s?.source) continue
        const uid = `${s.name}__${s.source}`
        if (!allSupplementSpells.has(uid)) allSupplementSpells.set(uid, s)
      }
    }

    let supplemented = 0
    for (const [uid, s] of allSupplementSpells) {
      if (seen.has(uid)) continue  // already loaded from book file — skip
      seen.add(uid)

      // Prefer classes from sources.json (authoritative); fall back to
      // what spell-lists-full.json tells us.
      const classesFromSources = spellClassMap.get(s.name.toLowerCase())
      const classes = (classesFromSources != null && classesFromSources.size > 0)
        ? Array.from(classesFromSources)
        : Array.from(supplementClassMap.get(s.name.toLowerCase()) || [])

      all.push({
        id:                uid,
        name:              s.name,
        source:            s.source || '',
        level:             s.level  ?? 0,
        school:            s.school || 'U',
        // Full detail unavailable without the book file
        castingTime:       '—',
        range:             '—',
        components:        {},
        duration:          '—',
        concentration:     false,
        ritual:            false,
        classes,
        entries:           [],
        entriesHigherLevel: [],
        damageType:        [],
        savingThrow:       [],
        conditionInflict:  [],
        spellAttack:       [],
      })
      supplemented++
    }

    if (supplemented > 0) {
      console.log(`[dataLoader] Supplemented ${supplemented} spells from spell-lists-full.json`)
    }
  }

  // Debug sample
  if (all.length > 0) {
    const wizardSpells = all.filter(s => s.classes.includes('Wizard'))
    const bardSpells   = all.filter(s => s.classes.includes('Bard'))
    console.log(`[dataLoader] Total: ${all.length} spells | Wizard: ${wizardSpells.length} | Bard: ${bardSpells.length}`)
  }

  // 5.5e: collapse PHB/XPHB doublets into one entry per name, keeping
  // the XPHB version (the 2024 rewrite the player actually reads). The
  // helper merges every spell's `classes` lists so we don't lose
  // class assignments declared on the legacy entry that aren't on
  // the new one — important when the XPHB version doesn't ship with
  // the spellListsMap fallback's classes attached yet.
  const final = edition === '5.5e' ? deduplicateSpellsForEdition(all) : all
  return final.sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level
    return a.name.localeCompare(b.name)
  })
}

// Like deduplicateByName but spell-aware: merges `classes` from every
// dropped duplicate into the surviving (preferred-source) entry, so a
// PHB Aid that lists [Cleric, Paladin] doesn't lose those classes when
// the XPHB Aid entry wins. Without the merge, a Cleric in 5.5e
// preparing Aid would find it missing from the pool.
function deduplicateSpellsForEdition(spells) {
  const byName = new Map()
  for (const s of spells) {
    const k = s.name.toLowerCase()
    const existing = byName.get(k)
    if (!existing) { byName.set(k, s); continue }
    const existingPrio = PREFERRED_55E_SOURCES.indexOf(existing.source)
    const newPrio      = PREFERRED_55E_SOURCES.indexOf(s.source)
    const winner = (newPrio !== -1 && (existingPrio === -1 || newPrio < existingPrio)) ? s : existing
    const loser  = winner === s ? existing : s
    // Merge classes (set union, preserve order).
    const seenC = new Set(winner.classes || [])
    const merged = [...(winner.classes || [])]
    for (const c of (loser.classes || [])) if (!seenC.has(c)) { seenC.add(c); merged.push(c) }
    winner.classes = merged
    byName.set(k, winner)
  }
  return [...byName.values()]
}

// Fallback: extract classes from inline spell data
// Handles books not in sources.json (EGW, GGR, …) as well as older formats
function extractSpellClassesFallback(spell) {
  const classes = new Set()
  const c = spell.classes
  if (!c) return []
  if (Array.isArray(c)) {
    for (const item of c) {
      if (typeof item === 'string') classes.add(item)
      else if (item?.name) classes.add(item.name)
    }
  } else {
    for (const arr of [c.fromClassList, c.fromClassListVariant]) {
      for (const cls of (arr || [])) {
        if (cls?.name) classes.add(cls.name)
      }
    }
    for (const entry of (c.fromSubclass || [])) {
      if (entry?.class?.name) classes.add(entry.class.name)
    }
  }
  return Array.from(classes)
}

// Filter spells for a specific class (case-insensitive)
export function filterSpellsByClass(spells, classId) {
  const needle = classId.toLowerCase().trim()
  const result = spells.filter(s =>
    (s.classes || []).some(c => c.toLowerCase().trim() === needle)
  )
  console.log(`[dataLoader] filterSpellsByClass("${classId}"): ${result.length}/${spells.length} spells`)
  return result
}

// ── ITEMS ──────────────────────────────────────────────────

/**
 * Load the combined item index (mundane + magic + variants).
 * Built by download-data.cjs → item-index.json.
 * Falls back to items-base.json if item-index.json not available.
 *
 * Returns all items filtered by official source and de-duplicated for 5.5e.
 */
export async function loadItemIndex(edition) {
  // Try combined index first
  let items = await fetchData(edition, 'item-index.json')
  if (items && Array.isArray(items)) {
    // Merge a couple of fields the index strips out but downstream code
    // needs:
    //   • scfType — spellcasting-focus subtype, only on items-base.
    //   • mastery — 5.5e weapon mastery names; 5.5e weapons in
    //     items-base have these, the index doesn't. Without this merge
    //     the Weapon Mastery picker on the sheet had nothing to show.
    const baseData = await fetchData(edition, 'items-base.json')
    // Auch magic items (items.json) ziehen wir parallel, um die
    // bonus*-Felder zurück zu mergen — der bundled item-index.json
    // strippt diese Felder, aber rulesEngine braucht sie für AC/Save/
    // Weapon/Spell-Boni von Cloak of Protection, +N Weapon, etc.
    const magicData = await fetchData(edition, 'items.json')
    if (baseData) {
      const scfMap = {}
      const masteryMap = {}
      // item-index.json strips `entries` to keep the file small, but
      // the sheet's expandable item rows and the Foundry export both
      // want rules text. Pull it back from items-base.json. Falls back
      // gracefully — items with no entries here keep an empty array.
      const entriesMap = {}
      for (const b of (baseData.baseitem || [])) {
        const key = `${b.name?.toLowerCase()}::${b.source}`
        if (b.scfType) scfMap[key] = b.scfType
        if (Array.isArray(b.mastery) && b.mastery.length > 0) {
          masteryMap[key] = b.mastery
            .map(m => String(typeof m === 'string' ? m : m?.name || '').split('|')[0])
            .filter(Boolean)
        }
        if (Array.isArray(b.entries) && b.entries.length > 0) {
          entriesMap[key] = b.entries
        }
      }
      // Magic-Boni und Magic-Item-Entries aus items.json indexen.
      const bonusMap = {}
      const magicEntriesMap = {}
      const attuneMap = {}
      const wondrousMap = {}
      const BONUS_FIELDS = [
        'bonusAc', 'bonusWeapon', 'bonusWeaponAttack', 'bonusWeaponDamage',
        'bonusSpellAttack', 'bonusSpellSaveDc',
        'bonusSavingThrow', 'bonusAbilityCheck',
      ]
      for (const m of (magicData?.item || [])) {
        const key = `${m.name?.toLowerCase()}::${m.source}`
        const b = {}
        for (const f of BONUS_FIELDS) if (m[f] != null) b[f] = m[f]
        if (Object.keys(b).length > 0) bonusMap[key] = b
        if (Array.isArray(m.entries) && m.entries.length > 0) magicEntriesMap[key] = m.entries
        if (m.reqAttune != null) attuneMap[key] = m.reqAttune
        if (m.wondrous === true)  wondrousMap[key] = true
      }
      items = items.map(i => {
        const key = `${i.name?.toLowerCase()}::${i.source}`
        const patch = {}
        if (i.type === 'SCF' && !i.scfType && scfMap[key]) patch.scfType = scfMap[key]
        if (masteryMap[key]) patch.mastery = masteryMap[key]
        if ((!i.entries || i.entries.length === 0) && entriesMap[key]) patch.entries = entriesMap[key]
        if ((!i.entries || i.entries.length === 0) && magicEntriesMap[key]) patch.entries = magicEntriesMap[key]
        if (bonusMap[key]) Object.assign(patch, bonusMap[key])
        if (attuneMap[key] != null && i.reqAttune == null) patch.reqAttune = attuneMap[key]
        if (wondrousMap[key] && !i.wondrous) patch.wondrous = true
        // item-index.json stripped its isArmor/isWeapon flags by source-
        // exact `type === 'LA'` checks, so XPHB armors (`type: 'LA|XPHB'`)
        // ended up with isArmor=false. Re-derive from the type code so
        // every consumer (Step9 wizard, Inventory tab, Foundry export)
        // sees consistent flags regardless of source suffix.
        const code = String(i.type || '').split('|')[0]
        if (['LA','MA','HA','S'].includes(code) && !i.isArmor) patch.isArmor = true
        if (['M','R'].includes(code) && !i.isWeapon)           patch.isWeapon = true
        return Object.keys(patch).length > 0 ? { ...i, ...patch } : i
      })
    }
    const filtered = items.filter(i => isEditionMatch(i.source, edition))
    if (edition === '5.5e') return deduplicateByName(filtered)
    return filtered
  }

  // Fallback to items-base.json only
  const data = await fetchData(edition, 'items-base.json')
  if (!data) return []
  const baseItems = (data.baseitem || data.item || [])
    .filter(item => isEditionMatch(item.source, edition))
    .map(item => ({
      name: item.name,
      source: item.source,
      type: item.type || null,
      scfType: item.scfType || null,
      rarity: item.rarity || 'none',
      weight: item.weight ?? null,
      value: item.value ?? null,
      ac: item.ac ?? null,
      strength: item.strength ?? null,
      stealth: item.stealth === true,
      weaponCategory: item.weaponCategory || null,
      dmg1: item.dmg1 || null,
      dmgType: item.dmgType || null,
      range: item.range || null,
      property: item.property || [],
      entries: item.entries || [],
      reqAttune: item.reqAttune || false,
      isWeapon: ['M', 'R'].includes(item.type) || !!item.weaponCategory,
      isArmor: ['LA', 'MA', 'HA', 'S'].includes(item.type),
      isGear: !['M','R','LA','MA','HA','S'].includes(item.type) && !item.weaponCategory,
      packContents: item.packContents || null,
      // 5.5e weapon mastery (Topple / Vex / Push / Graze / Nick / Sap /
      // Slow / Cleave). Strip the |SOURCE suffix and keep the names as
      // a clean string array. Empty array for 5e weapons — the data
      // file simply doesn't have the field there.
      mastery: Array.isArray(item.mastery)
        ? item.mastery.map(m => String(typeof m === 'string' ? m : m?.name || '').split('|')[0]).filter(Boolean)
        : [],
    }))
  if (edition === '5.5e') return deduplicateByName(baseItems)
  return baseItems
}

// Keep old name as alias for backwards compatibility
export const loadItemList = loadItemIndex

/**
 * Resolve a starting equipment item reference to an actual item from the index.
 * Input: "chain mail|xphb" or "greatsword|phb"
 * Returns the matching item object, or a stub if not found.
 */
// 5etools weapon-property codes → English labels the rules engine
// understands. Shared between the inventory tab (manual add) and the
// starting-equipment step (auto-add) so weapons added through either
// path have the same shape — without this normalisation, 5.5e items
// (which carry codes like "F|XPHB") leak through unchanged and the
// rules engine's `properties.includes('Finesse')` checks all return
// false, hiding Finesse / Thrown / Ammunition behaviours.
const PROP_CODE_MAP = {
  F: 'Finesse', V: 'Versatile', L: 'Light', H: 'Heavy', '2H': 'Two-Handed',
  T: 'Thrown', A: 'Ammunition', R: 'Reach', LD: 'Loading', S: 'Special',
  RLD: 'Reload', BF: 'Burst Fire', N: 'Net', AF: 'Ammunition',
}
export function normalizeWeaponProperty(p) {
  let raw = typeof p === 'string' ? p : (p?.name || p?.uid || '')
  const code = raw.split('|')[0].toUpperCase()
  return PROP_CODE_MAP[code] || raw.split('|')[0]
}
export function normalizeWeaponProperties(arr) {
  return (arr || []).map(normalizeWeaponProperty).filter(Boolean)
}

export function resolveItemRef(ref, itemIndex) {
  if (!ref || typeof ref !== 'string') return null
  const [rawName, rawSource] = ref.split('|')
  const name = rawName.trim()
  const source = (rawSource || '').trim().toUpperCase()

  // Try exact match first
  let match = itemIndex.find(i =>
    i.name.toLowerCase() === name.toLowerCase() &&
    (!source || i.source === source)
  )
  // Fallback: name-only match (different source editions)
  if (!match) {
    match = itemIndex.find(i => i.name.toLowerCase() === name.toLowerCase())
  }
  return match || { name, source, type: null, rarity: 'none', isGear: true }
}

/**
 * Parse startingEquipment from class/background data into displayable option groups.
 *
 * 5e format:  defaultData has MULTIPLE groups, each with a/b/c — player picks one per group
 * 5.5e format: defaultData has ONE group with A/B/C — player picks one complete package
 *
 * Output: {
 *   groups: [{ options: [{key, items, gold}] }],
 *   entries: string[],
 *   isPackageChoice: boolean  // true = 5.5e single package choice
 * }
 */
export function parseStartingEquipment(startingEquipment, itemIndex) {
  if (!startingEquipment) return { groups: [], entries: [], isPackageChoice: false, mandatoryItems: [] }

  const defaultData = startingEquipment.defaultData || startingEquipment
  const entries = startingEquipment.entries || []

  const rawGroups = Array.isArray(defaultData) ? defaultData : [defaultData]
  const groups = []
  const mandatoryItems = []  // items from '_' key — always granted, no choice needed

  for (const group of rawGroups) {
    if (!group || typeof group !== 'object') continue
    const options = []
    for (const [key, itemList] of Object.entries(group)) {
      if (!Array.isArray(itemList)) continue
      const items = []
      let gold = 0
      for (const entry of itemList) {
        // FIX Bug 1: plain string refs like "greataxe|phb" — were silently skipped
        if (typeof entry === 'string') {
          const resolved = resolveItemRef(entry, itemIndex)
          if (resolved) items.push({ ...resolved, quantity: 1, displayName: resolved.name })
          continue
        }
        if (!entry || typeof entry !== 'object') continue
        if (entry.value !== undefined && !entry.item) {
          gold += entry.value
        } else if (entry.item) {
          const resolved = resolveItemRef(entry.item, itemIndex)
          items.push({
            ...resolved,
            quantity: entry.quantity || 1,
            displayName: entry.displayName || resolved?.name || entry.item,
          })
        } else if (entry.equipmentType) {
          // FIX Bug 3: "any weapon of type X" — show as named placeholder
          const label = formatEquipmentType(entry.equipmentType)
          items.push({ name: label, displayName: label, quantity: entry.quantity || 1, isPlaceholder: true, equipmentType: entry.equipmentType, rarity: 'none', isWeapon: false, isArmor: false, isGear: true })
        }
      }
      // FIX Bug 2: '_' = mandatory items always granted — were skipped entirely
      if (key === '_') {
        mandatoryItems.push(...items)
      } else {
        options.push({ key: key.toUpperCase(), items, gold })
      }
    }
    if (options.length > 0) groups.push({ options })
  }

  // 5.5e = single group (pick one package), 5e = multi-group (one pick per group)
  const isPackageChoice = groups.length === 1

  return { groups, entries, isPackageChoice, mandatoryItems }
}

function formatEquipmentType(type) {
  const labels = {
    weaponMartialMelee:   'Any Martial Melee Weapon',
    weaponMartialRanged:  'Any Martial Ranged Weapon',
    weaponMartial:        'Any Martial Weapon',
    weaponSimple:         'Any Simple Weapon',
    weaponSimpleMelee:    'Any Simple Melee Weapon',
    weaponSimpleRanged:   'Any Simple Ranged Weapon',
    armorLight:           'Any Light Armor',
    armorMedium:          'Any Medium Armor',
    armorHeavy:           'Any Heavy Armor',
    instrumentMusical:    'Any Musical Instrument',
    toolArtisan:          'Any Artisan Tool',
    focusSpellcastingArcane:  'Any Arcane Focus',
    focusSpellcastingHoly:    'Any Holy Symbol',
    focusSpellcastingDruidic: 'Any Druidic Focus',
  }
  return labels[type] || `Any ${type}`
}

// ── HELPERS ────────────────────────────────────────────────

/**
 * 5.5e de-duplication: when the same entity name exists in both an older source
 * (PHB, TCE, XGE, …) and a newer 2024 source (XPHB, XDMG, XMM), keep only the
 * newer version. This prevents duplicates in pickers without affecting 5e data.
 *
 * Priority order: XPHB > XDMG > XMM > everything else (first occurrence wins).
 */

// Normalize 5etools casterProgression values: '1/2' → 'half'
// Raw 5etools data uses '1/2' for half-casters (Paladin, Ranger) but
// the app uses 'half' everywhere (spell level tables, color maps, etc.)
function normCasterProg(prog) {
  if (!prog) return null
  if (prog === '1/2') return 'half'
  return prog
}

function deduplicateByName(items) {
  const byName = new Map()
  for (const item of items) {
    const key = item.name.toLowerCase()
    const existing = byName.get(key)
    if (!existing) {
      byName.set(key, item)
    } else {
      // Keep whichever has the higher-priority source
      const existingPrio = PREFERRED_55E_SOURCES.indexOf(existing.source)
      const newPrio      = PREFERRED_55E_SOURCES.indexOf(item.source)
      // If new item is from a preferred source and existing is not (or lower prio), replace
      if (newPrio !== -1 && (existingPrio === -1 || newPrio < existingPrio)) {
        byName.set(key, item)
      }
    }
  }
  return [...byName.values()]
}

export function isOfficialSource(source) {
  if (!source) return false
  const official = [
    'PHB','XPHB','DMG','XDMG','MM','XMM','XGE','TCE','SCAG',
    'MTF','VGM','GGR','AI','ERLW','EGW','MOT','FTD','SCC',
    'AAG','BAM','DSotDQ','KftGV','BGdia','BGDIA','MPMM',
    'SRD','SRD5.1',
  ]
  return official.includes(source)
}

// Strict edition gate. Pro Edition werden NUR Quellen aus dieser
// Edition-Family zugelassen:
//   • 5.5e mode → XPHB / XDMG / XMM (2024 core books)
//   • 5e   mode → alles AUSSER X*-Quellen, plus offizielle Supplements
// Falls der Spieler andere Quellen will, kann er sie nachträglich über
// den 5e.tools-Import in seinem Sheet einspielen (manuelle Items /
// Feats / Spells). Der Auto-Catalog bleibt edition-strict.
//
// `entryHasNoSource` (truthy) erlaubt unkommentierte Einträge — manche
// optionalfeatures haben keine source und sollen dann zur jeweiligen
// Edition gehören (Fallback).
export function isEditionMatch(source, edition, entryHasNoSource = false) {
  if (!source) return entryHasNoSource ? true : false
  const isXfamily = source === 'XPHB' || source === 'XDMG' || source === 'XMM'
  if (edition === '5.5e') return isXfamily
  // 5e: alles official AUSSER X-family
  return isOfficialSource(source) && !isXfamily
}

function formatCastingTime(time) {
  if (!time?.[0]) return '—'
  const t = time[0]
  return `${t.number} ${t.unit}${t.number > 1 ? 's' : ''}${t.condition ? ' ' + t.condition : ''}`
}

function formatRange(range) {
  if (!range) return '—'
  if (range.type === 'special') return 'Special'
  if (range.type === 'point') {
    const d = range.distance
    if (d?.type === 'self') return 'Self'
    if (d?.type === 'touch') return 'Touch'
    if (d?.type === 'unlimited') return 'Unlimited'
    if (d?.type === 'sight') return 'Sight'
    return `${d?.amount ?? '?'} ft.`
  }
  if (range.type === 'radius') return `Self (${range.distance?.amount} ft. radius)`
  if (range.type === 'cone')   return `Self (${range.distance?.amount} ft. cone)`
  if (range.type === 'line')   return `Self (${range.distance?.amount} ft. line)`
  if (range.type === 'cube')   return `Self (${range.distance?.amount} ft. cube)`
  return '—'
}

function formatDuration(duration) {
  if (!duration?.[0]) return '—'
  const d = duration[0]
  if (d.type === 'instant')   return 'Instantaneous'
  if (d.type === 'permanent') return 'Until dispelled'
  if (d.type === 'special')   return 'Special'
  if (d.type === 'timed') {
    const c = d.concentration ? 'Concentration, up to ' : ''
    return `${c}${d.duration?.amount} ${d.duration?.type}${d.duration?.amount > 1 ? 's' : ''}`
  }
  return '—'
}

export function getMulticlassSpellSlots(classes) {
  const slots = {
    1:[2,0,0,0,0,0,0,0,0], 2:[3,0,0,0,0,0,0,0,0], 3:[4,2,0,0,0,0,0,0,0],
    4:[4,3,0,0,0,0,0,0,0], 5:[4,3,2,0,0,0,0,0,0], 6:[4,3,3,0,0,0,0,0,0],
    7:[4,3,3,1,0,0,0,0,0], 8:[4,3,3,2,0,0,0,0,0], 9:[4,3,3,3,1,0,0,0,0],
    10:[4,3,3,3,2,0,0,0,0],11:[4,3,3,3,2,1,0,0,0],12:[4,3,3,3,2,1,0,0,0],
    13:[4,3,3,3,2,1,1,0,0],14:[4,3,3,3,2,1,1,0,0],15:[4,3,3,3,2,1,1,1,0],
    16:[4,3,3,3,2,1,1,1,0],17:[4,3,3,3,2,1,1,1,1],18:[4,3,3,3,3,1,1,1,1],
    19:[4,3,3,3,3,2,1,1,1],20:[4,3,3,3,3,2,2,1,1],
  }
  let total = 0, hasWarlock = false, warlockLevel = 0
  for (const cls of classes) {
    if (cls.casterProgression === 'pact')  { hasWarlock = true; warlockLevel = cls.level }
    else if (cls.casterProgression === 'full') total += cls.level
    else if (cls.casterProgression === 'half' || cls.casterProgression === '1/2') total += Math.floor(cls.level / 2)
    else if (cls.casterProgression === '1/3')  total += Math.floor(cls.level / 3)
  }
  const lvl = Math.min(20, Math.round(total))
  return {
    spellSlots: lvl > 0 ? slots[lvl] : [0,0,0,0,0,0,0,0,0],
    hasWarlock, warlockLevel,
    pactSlots: hasWarlock ? getWarlockPactSlots(warlockLevel) : null,
  }
}

function getWarlockPactSlots(level) {
  const t = {
    1:{slots:1,level:1},2:{slots:2,level:1},3:{slots:2,level:2},4:{slots:2,level:2},
    5:{slots:2,level:3},6:{slots:2,level:3},7:{slots:2,level:4},8:{slots:2,level:4},
    9:{slots:2,level:5},10:{slots:2,level:5},11:{slots:3,level:5},12:{slots:3,level:5},
    13:{slots:3,level:5},14:{slots:3,level:5},15:{slots:3,level:5},16:{slots:3,level:5},
    17:{slots:4,level:5},18:{slots:4,level:5},19:{slots:4,level:5},20:{slots:4,level:5},
  }
  return t[level] || null
}

// ── Spell-Filtering für Step7Spells ────────────────────────

export function filterSpellsByNames(spells, nameSet) {
  if (!nameSet || nameSet.size === 0) return spells
  return spells.filter(s => nameSet.has(s.name.toLowerCase()))
}

export async function loadClassSpellNames(edition, classId) {
  // sources.json: { "PHB": { "Fireball": { "class": [{name:"Wizard",...}] } } }
  // spell-lists.json: { "Wizard": ["Fireball", "Magic Missile", …], … }
  //
  // The two are partially redundant but each carries spells the other
  // doesn't — most importantly, 5.5e spell-lists.json declares the
  // expanded Ranger / Paladin / etc. lists (incl. cantrips that
  // sources.json never tagged for those classes). Union both so the
  // class's spell picker doesn't silently drop entries that ARE on
  // the official list.
  const [sourcesData, listsData] = await Promise.all([
    fetchData(edition, 'spells/sources.json'),
    fetchData(edition, 'spell-lists.json'),
  ])
  if (!sourcesData && !listsData) {
    console.warn('[dataLoader] no spell index found — run download script')
    return new Set()
  }

  const nameSet = new Set()
  const wantClass = classId.toLowerCase()

  if (sourcesData) {
    for (const sourceData of Object.values(sourcesData)) {
      for (const [spellName, spellMeta] of Object.entries(sourceData)) {
        const classes = spellMeta.class || []
        const classVariants = spellMeta.classVariant || []
        const allClasses = [...classes, ...classVariants]
        if (allClasses.some(c => c.name?.toLowerCase() === wantClass)) {
          nameSet.add(spellName.toLowerCase())
        }
      }
    }
  }
  if (listsData && Array.isArray(listsData[classId])) {
    for (const name of listsData[classId]) {
      if (typeof name === 'string') nameSet.add(name.toLowerCase())
    }
  }

  console.log(`[dataLoader] loadClassSpellNames ${classId}: ${nameSet.size} spells`)
  return nameSet
}