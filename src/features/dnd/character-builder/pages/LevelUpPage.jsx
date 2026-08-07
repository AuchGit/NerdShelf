// pages/LevelUpPage.jsx — Step-based level-up wizard
import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from '../lib/hashNav'

// VTT-Rücksprung: die Level-Historie-Sidebar im VTT setzt vor dem Absprung
// einen Return-Hash (sessionStorage). Nach Abschluss/Abbruch landet der
// Spieler dann wieder im VTT statt auf dem Charakterbogen.
export const LEVELUP_RETURN_KEY = 'nerdshelf-levelup-return'
function consumeLevelUpReturn() {
  try {
    const r = sessionStorage.getItem(LEVELUP_RETURN_KEY)
    if (r) { sessionStorage.removeItem(LEVELUP_RETURN_KEY); return r }
  } catch { /* sessionStorage gesperrt */ }
  return null
}
import { supabase } from '../lib/supabase'
import { getTotalLevel } from '../lib/characterModel'
import { computeAbilityScores, computeProficiencies } from '../lib/rulesEngine'
import { parseTags } from '../lib/tagParser'
import { formatSkillName, STANDARD_LANGUAGES, STANDARD_TOOLS } from '../lib/sheetUtils'
import {
  loadClassList, loadClassData, loadSpellList, loadClassSpellNames,
  loadFeatList, loadOptionalFeatureList,
} from '../lib/dataLoader'
import { parseFeatChoices, parseFeatureChoices } from '../lib/choiceParser'
import { parseClassFeatureOptionChoices, buildNameSourceMap } from '../lib/optionBlockResolver'
import { getSpellListClass, getSpellcastingInfo } from '../lib/spellcastingRules'
import {
  computeLevelUpInfo, applyLevelUp, undoLastLevelUp,
  getLastLevelUpInfo, getLevelFeatures, getLevelFeatureObjects,
  getAllKnownSpellNames, checkMulticlassEligibility,
  getExistingOptionalFeatures, computeOptionalFeatureGains,
  formatPrerequisites, meetsPrerequisites, getMaxSpellLevel,
} from '../lib/levelUpEngine'
import BrowsePanel from '../components/ui/BrowsePanel'
import HeaderButtons from '../components/ui/HeaderButtons'
import EntryRenderer from '../components/ui/EntryRenderer'
import ChoicePicker from '../components/ui/ChoicePicker'
import { UniversalSpellList } from '../components/wizard/AdditionalSpellPicker'

const ABILITIES = ['str','dex','con','int','wis','cha']
const CC = { full:'var(--accent-purple)', half:'var(--accent-blue)', '1/2':'var(--accent-blue)', '1/3':'var(--accent-green)', pact:'var(--accent-pink)' }
const SCH = { A:'Abjuration',C:'Conjuration',D:'Divination',E:'Enchantment',V:'Evocation',I:'Illusion',N:'Necromancy',T:'Transmutation' }

const STEPS = [
  {id:'class',label:'Klasse'},{id:'hp',label:'HP'},{id:'subclass',label:'Subklasse'},
  {id:'asi',label:'ASI / Feat'},{id:'features',label:'Features'},
  {id:'spells',label:'Zauber'},{id:'summary',label:'Übersicht'},
]

// Hilfsfunktion: ALLE Feature-Option-Descriptors für den NEUEN Level
// einer Klasse berechnen. Wir simulieren den classEntry mit
// level=info.nextLevel + dem (potenziell neu gewählten) subclassId
// damit Subclass-interne Option-Blocks ab dem Subclass-Level auch
// auftauchen. refOptionalfeature-only Blöcke gehen über den Legacy
// OptFeatPicker-Pfad, nicht über uns.
function computeNewOptionBlockDescs(draft, info, featMap = null) {
  if (!info || !draft?.classData) return []
  const synthEntry = {
    classId: info.classId,
    level: info.nextLevel,
    subclassId: draft.subclassId
      || (info.classId && info.subclassId)
      || null,
  }
  // featMap: 2024-Klassen kodieren Fighting Style / Epic Boon als
  // Feat-Kategorie — ohne Feat-Daten kann der Resolver diese Blöcke
  // nicht synthetisieren und der Pick würde erst nachträglich im
  // Features-Tab auftauchen statt direkt beim Level-Up.
  const all = parseClassFeatureOptionChoices(
    synthEntry, draft.classData, { edition: draft.edition || info.edition || '5e', featMap },
  ) || []
  // Nur Descriptors deren Feature genau auf nextLevel kommt — alle
  // vorherigen Level wurden bei früheren Level-Ups schon abgehandelt.
  const newAtThisLevel = all.filter(d => Number(d._featureLevel) === Number(info.nextLevel))
  // refOptionalfeature-only Blöcke vom Legacy-Pfad (OptFeatPicker)
  // ausschließen.
  return newAtThisLevel.filter(d => {
    const kinds = (d._resolvedRefs || []).map(r => r.kind)
    return !kinds.every(k => k === 'optionalfeature')
  })
}

// Neue Features (Klasse + gewählte Subclass) auf GENAU dem neuen Level,
// mit Entries — Futter für parseFeatureChoices ("your choice"-Picks aus
// dem Feature-Text: Expertise, Skill, Sprache, Tool, Saving Throw).
// Diese Picks waren bisher nur nachträglich im Features-Tab des Sheets
// lösbar; jetzt tauchen sie direkt beim Level-Up auf. Der Features-Tab
// bleibt als Backstop für Altbestände.
function newFeaturesWithEntries(draft, info) {
  if (!draft?.classData || !info) return []
  const lvl = info.nextLevel
  const out = []
  for (const f of (draft.classData.features || [])) {
    if (f?.name && (f.level || 1) === lvl && !f.isClassFeatureVariant) out.push(f)
  }
  const subId = draft.subclassId || info.subclassId || null
  if (subId) {
    const cleanSub = String(subId).split(/__|\|/)[0].trim()
    const sub = (draft.classData.subclasses || []).find(s =>
      s.id === subId || s.name === subId
      || s.id === cleanSub || s.name === cleanSub || s.shortName === cleanSub)
    if (sub) {
      for (const f of (Array.isArray(sub.features) ? sub.features : [])) {
        if (f && typeof f === 'object' && f.name && (f.level || 1) === lvl) out.push(f)
      }
      if (sub.featuresPerLevel) {
        for (const [l, fs] of Object.entries(sub.featuresPerLevel)) {
          if ((parseInt(l, 10) || 1) !== lvl) continue
          for (const f of (fs || [])) {
            if (f && typeof f === 'object' && f.name) out.push({ ...f, level: lvl })
          }
        }
      }
    }
  }
  return out
}

function computeNewFeatureTextChoices(draft, info) {
  const seen = new Set()
  const out = []
  for (const f of newFeaturesWithEntries(draft, info)) {
    let choices = []
    try { choices = parseFeatureChoices({ ...f, level: f.level ?? info.nextLevel }) } catch { /* fail-soft */ }
    for (const ch of choices) {
      if (seen.has(ch.id)) continue
      seen.add(ch.id)
      out.push({ feature: f, choice: ch })
    }
  }
  return out
}

function getActiveSteps(info, draft, featMap = null, char = null) {
  if (!info) return [STEPS[0]]
  const a = [STEPS[0], STEPS[1]]
  if (info.needsSubclass) a.push(STEPS[2])
  if (info.hasASI) a.push(STEPS[3])
  // Optional features at this level: neue Picks ODER reine Tausch-
  // Gelegenheit (Invocations & Co. erlauben RAW einen Tausch bei jedem
  // Level-Up — nur relevant, wenn schon Picks existieren).
  const subD = draft.subclassId && draft.classData
    ? (draft.classData.subclasses||[]).find(s => s.name === draft.subclassId) : null
  const ceForOF = char?.classes?.find(c => c.classId === info.classId)
  const hasExistingOF = ceForOF ? getExistingOptionalFeatures(ceForOF).length > 0 : false
  const ofGains = computeOptionalFeatureGains(draft.classData, subD, info.nextLevel)
    .filter(g => g.newCount > 0 || (g.swapEveryLevel && hasExistingOF))
  // Also check for class features that need choices (Ranger Favored Enemy/Terrain, etc.)
  const featureNames = info.features.map(f => f.toLowerCase())
  const hasClassFeatureChoices = featureNames.some(f => f.includes('favored enemy') || f.includes('natural explorer'))
  // Generic feature-option blocks new at this level (Druid Primal
  // Order, future class-feature option picks). Computed against the
  // upcoming level so descriptors fresh for this level-up appear.
  const newOptionBlockDescs = computeNewOptionBlockDescs(draft, info, featMap)
  // "Your choice"-Picks aus dem Feature-Text (Expertise, Skill, Sprache,
  // Tool, Saving Throw) — direkt beim Level-Up statt nachträglich im
  // Features-Tab.
  const hasFeatureTextChoices = computeNewFeatureTextChoices(draft, info).length > 0
  // Optional Class Feature Variants (TCE) auf diesem Level — Step
  // ohnehin nötig damit der Spieler sie aktivieren kann.
  const hasNewVariants = !!(draft.classData?.features?.some(f =>
    f?.isClassFeatureVariant && (f.level || 1) === info.nextLevel
  ))
  if (ofGains.length > 0 || hasClassFeatureChoices || newOptionBlockDescs.length > 0 || hasNewVariants || hasFeatureTextChoices) a.push(STEPS[4])
  // Spells: check effective casting (class or subclass)
  const castAb = draft.existingSpellAbility || draft.subclassSpellAbility || info.spellcastingAbility
  const effProg = draft.existingCasterProg || draft.subclassCasterProg || info.casterProgression
  const maxSL = effProg ? getMaxSpellLevel(effProg, info.nextLevel) : 0
  // Spell-Step gate: NUR zeigen wenn auf diesem Level wirklich etwas
  // Spell-bezogenes neu wird:
  //   • Known caster (Sorcerer/Bard/Warlock) lernt neue Spells
  //     (`newSpellsKnown > 0`)
  //   • Wizard erweitert Spellbook (`newSpellbookSpells > 0`)
  //   • Cantrips dazu (`newCantrips > 0`)
  //   • Spell-Swap erlaubt (`canSwapSpell`)
  //   • Prepared caster (Druid/Cleric/Paladin/Ranger/Artificer) bekommt
  //     ein NEUES Spell-Level freigeschaltet → neue Spells werden
  //     vorbereitbar (`unlocksNewSpellLevel`). Reines Wachsen der
  //     Prepared-Count ohne neue Spell-Stufe braucht KEINEN Step mehr
  //     (Prep wird auf dem Sheet gemacht).
  //   • Optional-Feature gibt Spells (Blessed Warrior, Pact of the Tome)
  //
  // Bei einem Caster der auf diesem Level NICHTS Neues bekommt (z.B.
  // 5.5e Druid L6 wo nur Prep-Count steigt) wird der Step geskippt.
  const isCaster = !!(castAb || effProg)
  const isPrepared = isCaster && !info.newSpellsKnown && !info.newSpellbookSpells
  const preparedUnlocksNewLevel = isPrepared && !!info.unlocksNewSpellLevel
  const hasSpellContent =
       (info.newCantrips || 0) > 0
    || (info.newSpellsKnown || 0) > 0
    || (info.newSpellbookSpells || 0) > 0
    || !!info.canSwapSpell
    || preparedUnlocksNewLevel
  const hasOptFeatSpells = Object.values(draft.optPicks).flat().length > 0
  if (hasSpellContent || hasOptFeatSpells) a.push(STEPS[5])
  a.push(STEPS[6])
  return a
}

export default function LevelUpPage({ session }) {
  const { id } = useParams(), nav = useNavigate()
  const [char, setChar] = useState(null), [loading, setLoading] = useState(true)
  const [classes, setCls] = useState([]), [rcm, setRcm] = useState({})
  const [allSp, setAllSp] = useState([]), [csn, setCsn] = useState(new Set())
  const [feats, setFeats] = useState([]), [optF, setOptF] = useState([])
  const [saving, setSaving] = useState(false), [error, setErr] = useState(null)
  const [stepIdx, setStepIdx] = useState(0), [info, setInfo] = useState(null)

  const [draft, setDraft] = useState({
    classIndex:null, classData:null,
    hpValue:null, hpMethod:'average',
    subclassId:null, subclassSpellAbility:null, subclassCasterProg:null,
    existingSpellAbility:null, existingCasterProg:null,
    asiMode:'asi', asiPicks:{}, featEntry:null, featAB:{}, featCh:{},
    optPicks:{}, optFeatureSpells:{}, classFeatureChoices:{}, featureOptionPicks:{},
    optSwaps:{},
    cantrips:[], spells:[], swapOld:null, swapNew:null, wantSwap:false,
    preparedSpellPool:null, preparedCantripPool:null,
    // 5.5e prepared-caster pick at level-up: the new prepared spells
    // added to character.status.preparedSpells[classId] when the
    // class's preparedTable grows (1 → 2 → 3 …).
    preparedPicks: [],
  })

  const edition = char?.meta?.edition || '5e'
  // Feat-Lookup für den Option-Block-Resolver (2024 Fighting Style /
  // Epic Boon = Feat-Kategorien) — gleiche Doppel-Key-Konvention wie
  // optionalFeatureMap.
  const featMap = useMemo(() => buildNameSourceMap(feats), [feats])
  const activeSteps = useMemo(() => getActiveSteps(info, draft, featMap, char), [info, draft, featMap, char])
  const currentStep = activeSteps[stepIdx] || STEPS[0]

  useEffect(() => { loadData() }, [id])

  async function loadData() {
    setLoading(true)
    const { data, error: e } = await supabase.from('dnd_characters').select('*').eq('id', id).eq('user_id', session.user.id).single()
    if (e || !data) { nav('/'); return }
    setChar(data.data); const ed = data.data.meta?.edition || '5e'
    const [cl, fl, of, sl] = await Promise.all([loadClassList(ed), loadFeatList(ed), loadOptionalFeatureList(ed), loadSpellList(ed)])
    setCls(cl); setFeats(fl); setOptF(of); setAllSp(sl)
    const rm = {}; for (const c of data.data.classes) { const r = await loadClassData(ed, c.classId); if (r) rm[c.classId] = r }
    setRcm(rm); setLoading(false)
  }

  async function selectClass(classIndex, classData) {
    const ce = classIndex >= 0 ? char.classes[classIndex] : null
    const li = computeLevelUpInfo(classData, ce, char, classIndex < 0)
    setInfo(li)
    // Carry forward existing subclass spellcasting info (for EK/AT already chosen)
    const existSpellAb = ce?.spellcastingAbility || null
    const existCasterProg = ce?.casterProgression || null
    const existSubId = ce?.subclassId || null
    setDraft({
      classIndex, classData,
      hpValue: li.hpAverage, hpMethod:'average',
      subclassId: existSubId, subclassSpellAbility:null, subclassCasterProg:null,
      existingSpellAbility: existSpellAb, existingCasterProg: existCasterProg,
      asiMode:'asi', asiPicks:{}, featEntry:null, featAB:{}, featCh:{},
      optPicks:{}, optFeatureSpells:{}, classFeatureChoices:{}, featureOptionPicks:{}, featureTextPicks:{},
      optSwaps:{},
      cantrips:[], spells:[], swapOld:null, swapNew:null, wantSwap:false,
      preparedSpellPool:null, preparedCantripPool:null,
      // 5.5e prepared-caster pick — MUSS initialisiert sein, sonst
      // crashed `draft.preparedPicks.includes(...)` in StepSpells mit
      // TypeError. Vorher übersehen weil selectClass den initialen
      // useState-default überschreibt.
      preparedPicks: [],
    })
    // Load spells when this class has any spellcasting (including half-casters, subclass casters)
    const spellAb = existSpellAb || classData.spellcastingAbility
    const castProg = existCasterProg || classData.casterProgression
    const willHaveSpells = spellAb || castProg || li.newCantrips > 0 || li.newSpellsKnown > 0 || li.newSpellbookSpells > 0
    if (willHaveSpells) {
      const slc = getSpellListClass(classData.id, existSubId, edition)
      const [sl, cn] = await Promise.all([loadSpellList(edition), loadClassSpellNames(edition, slc)])
      setAllSp(sl); setCsn(cn)
    }
    setStepIdx(1)
  }

  async function onSubclassChosen(subId, sub) {
    setDraft(d => ({...d, subclassId:subId, subclassSpellAbility:sub?.spellcastingAbility||null, subclassCasterProg:sub?.casterProgression||null}))
    if (sub?.spellcastingAbility) {
      const slc = getSpellListClass(info.classId, subId, edition)
      const [sl, cn] = await Promise.all([loadSpellList(edition), loadClassSpellNames(edition, slc)])
      setAllSp(sl); setCsn(cn)
    }
  }

  // Effective info patched with subclass casting
  const effectiveInfo = useMemo(() => {
    if (!info) return null
    const castAb = draft.subclassSpellAbility || draft.existingSpellAbility || info.spellcastingAbility
    const castProg = draft.subclassCasterProg || draft.existingCasterProg || info.casterProgression
    if (!castAb || (castAb === info.spellcastingAbility && castProg === info.casterProgression)) return info
    const subName = draft.subclassId
    const currSI = getSpellcastingInfo(info.classId, info.nextLevel, 0, subName, edition)
    const prevSI = info.currentLevel > 0 ? getSpellcastingInfo(info.classId, info.currentLevel, 0, subName, edition) : null
    const maxSL = castProg ? getMaxSpellLevel(castProg, info.nextLevel) : 0
    const prevMaxSL = info.currentLevel > 0 && castProg ? getMaxSpellLevel(castProg, info.currentLevel) : 0
    return { ...info,
      spellcastingAbility: castAb, casterProgression: castProg,
      maxSpellLevel: maxSL, prevMaxSpellLevel: prevMaxSL,
      unlocksNewSpellLevel: maxSL > prevMaxSL,
      newCantrips: currSI ? Math.max(0, (currSI.cantripsKnown||0) - (prevSI?.cantripsKnown||0)) : 0,
      newSpellsKnown: currSI?.type==='known' ? Math.max(0, (currSI.spellsKnown||0) - (prevSI?.spellsKnown||0)) : 0,
      newSpellbookSpells: currSI?.hasSpellbook ? (info.nextLevel===1 ? (currSI.spellbookStart||6) : 2) : 0,
      canSwapSpell: currSI?.canSwapSpell && prevSI ? true : false,
      schoolRestriction: currSI?.schoolRestriction || null,
    }
  }, [info, draft.subclassId, draft.subclassSpellAbility, draft.existingSpellAbility])

  // Subclass feature objects to merge with class features
  const subclassFeatureObjects = useMemo(() => {
    if (!info || !draft.classData) return []
    const subD = (draft.subclassId)
      ? (draft.classData.subclasses||[]).find(s => s.name === draft.subclassId) : null
    if (!subD?.featuresPerLevel?.[info.nextLevel]) return []
    return subD.featuresPerLevel[info.nextLevel].map(f => typeof f === 'string' ? {name:f, entries:[]} : f)
  }, [info, draft.classData, draft.subclassId])

  async function handleSave() {
    if (!effectiveInfo || !char) return; setSaving(true); setErr(null)
    let asiChoice = null
    if (effectiveInfo.hasASI) {
      if (draft.asiMode==='asi') asiChoice = {type:'asi', improvements:{...draft.asiPicks}}
      else if (draft.featEntry) {
        // Merge feat spell choices from _spells into choices.spells
        const featChoices = { ...draft.featCh }
        const spellPicks = featChoices._spells || {}
        delete featChoices._spells
        const allFeatSpells = Object.values(spellPicks).flat()
        if (allFeatSpells.length > 0) featChoices.spells = allFeatSpells
        // Flatten per-choose-group picks into the rules-engine shape
        // ({ability: bonus, …}). draft.featAB is now structured per
        // ability-choose entry (e.g. {_c0: {dex: 1}}); the old code
        // passed it through directly which produced an unreadable
        // shape on character.feats[].abilityBonus. Use whatever
        // setDraft already flattened into draft.featEntry.abilityBonus.
        // Fall back to flat draft.featAB for backwards compatibility
        // with any in-flight draft state predating this change.
        const flatBonus = draft.featEntry.abilityBonus
          || (Object.values(draft.featAB || {}).every(v => typeof v === 'number')
            ? draft.featAB
            : {})
        asiChoice = {type:'feat', featEntry:{...draft.featEntry, abilityBonus: flatBonus, choices:featChoices}}
      }
    }
    const ofE = []; for (const [g,ns] of Object.entries(draft.optPicks)) for (const n of ns) ofE.push({name:n, group:g})
    const sw = (draft.wantSwap&&draft.swapOld&&draft.swapNew) ? {oldSpell:draft.swapOld,newSpell:draft.swapNew} : null
    const updated = applyLevelUp(char, {
      classIndex:draft.classIndex, classData:draft.classData, hpValue:draft.hpValue,
      subclassId: info.needsSubclass ? draft.subclassId : null, asiChoice,
      newCantrips:draft.cantrips, newSpells:draft.spells, swappedSpell:sw,
      optionalFeatures:ofE, optFeatureSpells:draft.optFeatureSpells,
      classFeatureChoices:draft.classFeatureChoices,
      preparedSpellPool:draft.preparedSpellPool,
      // Generische Feature-Option-Picks (Druid Primal Order etc.) →
      // direkt in character.choices mergen. ApplyLevelUp übernimmt
      // das in next.choices, sheet-side collectActiveClassFeatures
      // wertet es aus.
      newChoices: draft.featureOptionPicks && Object.keys(draft.featureOptionPicks).length > 0
        ? { ...draft.featureOptionPicks } : {},
      // "Your choice"-Feature-Text-Picks (Expertise/Skill/Sprache/Tool)
      // → cls.featureChoices, gleiche Storage wie der Features-Tab.
      featureTextChoices: draft.featureTextPicks || {},
    })
    // 5.5e prepared casters: append the level-up's new prepared spell
    // picks to character.status.preparedSpells[classId]. The Prepare
    // modal on the sheet manages further swaps; this just ensures the
    // initial list grows with the class table.
    if (draft.preparedPicks?.length > 0) {
      if (!updated.status) updated.status = {}
      if (!updated.status.preparedSpells) updated.status.preparedSpells = {}
      const prior = updated.status.preparedSpells[info.classId] || []
      const merged = [...prior]
      for (const n of draft.preparedPicks) if (n && !merged.includes(n)) merged.push(n)
      updated.status.preparedSpells[info.classId] = merged
    }
    // Optional Class Feature Variants (TCE) — der Spieler hat in
    // StepFeatures (Variants-Card) Toggle-Picks gemacht. Die landen
    // in draft.optionalClassFeatures; jetzt mergen wir sie in den
    // Char ohne bestehende Picks zu überschreiben.
    if (draft.optionalClassFeatures && Object.keys(draft.optionalClassFeatures).length > 0) {
      const cur = updated.optionalClassFeatures || {}
      const next = { ...cur }
      for (const [cid, perCls] of Object.entries(draft.optionalClassFeatures)) {
        next[cid] = { ...(cur[cid] || {}), ...perCls }
      }
      updated.optionalClassFeatures = next
    }
    // Optfeature-Tausch (RAW „when you gain a level … replace"): den als
    // „abgeben" markierten Pick aus dem levelChoices-Bucket entfernen, in
    // dem er ursprünglich gewählt wurde — der Ersatz kam als zusätzlicher
    // optPick rein. Nur anwenden, wenn über das Level-Soll hinaus wirklich
    // ein Ersatz gewählt wurde (sonst würde der Tausch ersatzlos löschen).
    const swapOuts = []
    if (draft.optSwaps && Object.keys(draft.optSwaps).length > 0) {
      const subDataForGains = draft.subclassId && draft.classData
        ? (draft.classData.subclasses || []).find(s => s.name === draft.subclassId) : null
      const gainsByName = {}
      for (const g of computeOptionalFeatureGains(draft.classData, subDataForGains, info.nextLevel)) gainsByName[g.name] = g
      for (const [group, swp] of Object.entries(draft.optSwaps)) {
        if (!swp?.want || !swp?.old) continue
        const picked = (draft.optPicks[group] || []).length
        const need = gainsByName[group]?.newCount ?? 0
        if (picked > need) swapOuts.push(swp.old)
      }
    }
    if (swapOuts.length > 0) {
      updated.classes = (updated.classes || []).map(ce => {
        if (ce.classId !== info.classId) return ce
        const lcs = {}
        for (const [lv, lc] of Object.entries(ce.levelChoices || {})) {
          let next = lc
          if (Array.isArray(lc.optionalFeatures)) {
            const nf = lc.optionalFeatures.filter(f =>
              !swapOuts.includes(typeof f === 'string' ? f : f?.name))
            if (nf.length !== lc.optionalFeatures.length) next = { ...next, optionalFeatures: nf }
          }
          if (next.optFeatureSpells && swapOuts.some(n => next.optFeatureSpells[n])) {
            const nfs = { ...next.optFeatureSpells }
            for (const n of swapOuts) delete nfs[n]
            next = { ...next, optFeatureSpells: nfs }
          }
          lcs[lv] = next
        }
        return { ...ce, levelChoices: lcs }
      })
    }

    // Safety: backup both old and new state to localStorage before writing
    try {
      localStorage.setItem(`dndbuilder_backup_${id}`, JSON.stringify({
        timestamp: new Date().toISOString(),
        previous: char,
        updated: updated,
      }))
    } catch (_) { /* localStorage full or unavailable — continue anyway */ }

    // Retry logic: up to 3 attempts with increasing delay
    let saved = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error: e } = await supabase.from('dnd_characters')
        .update({ data: updated, name: updated.info.name })
        .eq('id', id).eq('user_id', session.user.id)
      if (!e) { saved = true; break }
      console.warn(`[LevelUp] Save attempt ${attempt} failed:`, e.message)
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500))
    }

    if (!saved) {
      setErr('Speichern fehlgeschlagen nach 3 Versuchen. Dein Charakter ist lokal gesichert — bitte versuche es erneut.')
      setSaving(false)
      return
    }

    // Verify save: read back and confirm level matches
    const { data: verify } = await supabase.from('dnd_characters').select('data').eq('id', id).single()
    if (verify?.data) {
      const savedLevel = (verify.data.classes || []).reduce((s, c) => s + (c.level || 0), 0)
      const expectedLevel = (updated.classes || []).reduce((s, c) => s + (c.level || 0), 0)
      if (savedLevel !== expectedLevel) {
        // Verification failed — retry once more
        console.warn('[LevelUp] Verify mismatch, retrying save...')
        const { error: e2 } = await supabase.from('dnd_characters')
          .update({ data: updated, name: updated.info.name })
          .eq('id', id).eq('user_id', session.user.id)
        if (e2) {
          setErr('Speichern konnte nicht verifiziert werden. Dein Charakter ist lokal gesichert.')
          setSaving(false)
          return
        }
      }
    }

    // Success — clean up backup
    try { localStorage.removeItem(`dndbuilder_backup_${id}`) } catch (_) {}
    nav(consumeLevelUpReturn() || `/character/${id}`)
  }

async function handleUndo() {
  const last = getLastLevelUpInfo(char)
  if (!last?.snapshot) return
  const cls = char.classes.find(c => c.classId === last.classId)
  const lc = cls?.levelChoices?.[last.classLevel] || {}
  const parts = [`${last.classId} Lv.${last.classLevel}`]
  if (lc.type==='asi') parts.push('ASI: '+Object.entries(lc.improvements||{}).map(([k,v])=>`${k.toUpperCase()} +${v}`).join(', '))
  if (lc.type==='feat') parts.push(`Feat: ${lc.featId}`)
  if (lc.cantrips?.length) parts.push(`Cantrips: ${lc.cantrips.join(', ')}`)
  if (lc.knownSpells?.length) parts.push(`Spells: ${lc.knownSpells.join(', ')}`)
  if (lc.optionalFeatures?.length) parts.push(lc.optionalFeatures.map(f=>f.name).join(', '))
  for (const [fn,sp] of Object.entries(lc.optFeatureSpells||{})) { if(sp?.length) parts.push(`${fn}: ${sp.join(', ')}`) }
  if (!window.confirm(`Level Down rückgängig machen?\n\n${parts.join('\n')}`)) return

  // WICHTIG: undoLastLevelUp() graftet die Live-History korrekt zurück,
  // damit weitere Delevel-Schritte möglich sind. Nie direkt last.snapshot verwenden.
  const snap = undoLastLevelUp(char)
  if (!snap) { setErr('Undo fehlgeschlagen: kein Snapshot verfügbar.'); return }
  if (char.appearance?.portrait) snap.appearance = {...(snap.appearance||{}), portrait:char.appearance.portrait}

  try { localStorage.setItem(`dndbuilder_backup_${id}`, JSON.stringify({ timestamp: new Date().toISOString(), previous: char, updated: snap })) } catch (_) {}

  let saved = false
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error: e } = await supabase.from('dnd_characters').update({data:snap,name:snap.info.name}).eq('id',id).eq('user_id',session.user.id)
    if (!e) { saved = true; break }
    console.warn(`[LevelUp] Undo attempt ${attempt} failed:`, e.message)
    if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500))
  }
  if (!saved) { setErr('Undo fehlgeschlagen nach 3 Versuchen. Dein Charakter ist lokal gesichert.'); return }

  try { localStorage.removeItem(`dndbuilder_backup_${id}`) } catch (_) {}
  const { data: reloaded } = await supabase.from('dnd_characters').select('*').eq('id',id).eq('user_id',session.user.id).single()
  if (reloaded) { setChar(reloaded.data); setInfo(null); setStepIdx(0) }
}

  function nextStep() { if (stepIdx < activeSteps.length-1) setStepIdx(stepIdx+1) }
  function prevStep() { if (stepIdx > 0) setStepIdx(stepIdx-1) }

  if (loading) return <div style={S.loading}>Lade Daten…</div>
  if (!char) return null
  const totalLevel = getTotalLevel(char)

  return (
    <div className="dnd-wizard-page" style={S.page}>
      <div className="dnd-wizard-header" data-pwa-target="dnd-wizard-header" style={S.header}>
        <button style={S.backBtn} onClick={() => stepIdx>0 ? setStepIdx(0) : nav(consumeLevelUpReturn() || `/character/${id}`)}>
          ← {stepIdx>0?'Klassenwahl':'Zurück'}</button>
        <h1 className="dnd-wizard-title" style={S.headerTitle}>{char.info.name} — Level Up</h1>
        <div style={{display:"flex",gap:8,alignItems:"center"}}><span style={S.levelBadge}>Lv. {totalLevel}</span><HeaderButtons session={session} /></div>
      </div>
      <div className="dnd-wizard-stepbar" data-pwa-target="dnd-wizard-stepbar" style={S.stepBar}>
        {activeSteps.map((s,i) => (
          <div key={s.id} onClick={() => i<=stepIdx && setStepIdx(i)} style={{
            ...S.stepDot, cursor:i<=stepIdx?'pointer':'default',
            background:i===stepIdx?'var(--accent)':i<stepIdx?'var(--bg-highlight)':'var(--bg-highlight)',
            color:i===stepIdx?'var(--bg-deep)':i<stepIdx?'var(--accent-green)':'var(--text-dim)',
          }}>{i<stepIdx?'✓':i+1}<span style={{marginLeft:6}}>{s.label}</span></div>
        ))}
      </div>
      <div className="dnd-wizard-content" data-pwa-target="dnd-wizard-content" style={S.content}>
        {currentStep.id==='class' && <StepClassChoice char={char} classes={classes} rcm={rcm}
          abScores={computeAbilityScores(char)} onSelect={selectClass} onUndo={handleUndo} session={session} id={id} />}
        {currentStep.id==='hp' && effectiveInfo && <StepHP info={effectiveInfo} draft={draft} setDraft={setDraft} subFeats={subclassFeatureObjects} />}
        {currentStep.id==='subclass' && effectiveInfo && <StepSubclass info={effectiveInfo} draft={draft} onSubclassChosen={onSubclassChosen} />}
        {currentStep.id==='asi' && effectiveInfo && <StepASI info={effectiveInfo} draft={draft} setDraft={setDraft}
          abScores={computeAbilityScores(char)} feats={feats} optF={optF} edition={edition} allSp={allSp} />}
        {currentStep.id==='features' && effectiveInfo && <StepFeatures info={effectiveInfo} draft={draft} setDraft={setDraft}
          optF={optF} feats={feats} char={char} />}
        {currentStep.id==='spells' && effectiveInfo && <StepSpells info={effectiveInfo} draft={draft} setDraft={setDraft}
          allSp={allSp} csn={csn} char={char} optF={optF} edition={edition} />}
        {currentStep.id==='summary' && effectiveInfo && <StepSummary info={effectiveInfo} draft={draft} />}
      </div>
      <div className="dnd-wizard-footer" data-pwa-target="dnd-wizard-footer" style={S.footer}>
        <div>{stepIdx>0&&<button style={S.navBtn} onClick={prevStep}>← Zurück</button>}</div>
        <div>
          {currentStep.id!=='class'&&currentStep.id!=='summary'&&<button style={{...S.navBtn,...S.navPri}} onClick={nextStep}>Weiter →</button>}
          {currentStep.id==='summary'&&<button style={{...S.navBtn,...S.navPri}} onClick={handleSave} disabled={saving}>{saving?'Speichern…':'✓ Level Up bestätigen'}</button>}
        </div>
      </div>
      {error&&<div style={S.errorBar}>{error}</div>}
    </div>
  )
}

// ═══════ STEP: CLASS CHOICE ════════════════════════════════════════════════

function StepClassChoice({ char, classes, rcm, abScores, onSelect, onUndo, session, id }) {
  const [showMC, setShowMC] = useState(false)
  const [mcTab, setMcTab] = useState('info')
  const tl = getTotalLevel(char), lastLU = getLastLevelUpInfo(char)
  if (tl >= 20) return <div style={S.center}><p style={{color:'var(--text-muted)'}}>Max Level (20).</p></div>
  const eIds = new Set(char.classes.map(c => c.classId))
  const mcC = classes.filter(c => !eIds.has(c.id)).map(c => ({
    ...c, _e: rcm[c.id] ? checkMulticlassEligibility(char,rcm[c.id],rcm,abScores) : {eligible:true,reason:''},
  }))

  // Render full class detail with tabs (like Step4Class)
  function renderClassDetail(cls) {
    const profs = cls.startingProficiencies || {}
    return (<div>
      <div style={{color:'var(--accent)',fontSize:20,fontWeight:'bold',marginBottom:4}}>{cls.name}</div>
      <div style={{color:'var(--text-muted)',fontSize:12,marginBottom:12}}>Source: {cls.source}</div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
        <Badge label="Hit Die" value={`d${cls.hitDie}`} color="#ff8888" />
        <Badge label="Caster" value={cls.casterProgression||'—'} color={CC[cls.casterProgression]||'var(--text-dim)'} />
        {cls.spellcastingAbility && <Badge label="Spellcasting" value={cls.spellcastingAbility.toUpperCase()} color="#a78bfa" />}
        <Badge label="Subklasse" value={`${cls.subclassTitle} (Lv.${cls.subclassLevel})`} color="#8899aa" />
      </div>
      {/* Tabs */}
      <div style={{display:'flex',gap:6,marginBottom:12,borderBottom: '1px solid var(--border)',paddingBottom:8}}>
        {['info','features','subclasses'].map(tab => (
          <button key={tab} onClick={() => setMcTab(tab)} style={{
            padding:'5px 14px',borderRadius:6,border:'1px solid',fontSize:12,cursor:'pointer',
            borderColor:mcTab===tab?'var(--accent)':'var(--border)',background:mcTab===tab?'var(--bg-highlight)':'transparent',
            color:mcTab===tab?'var(--accent)':'var(--text-muted)',
          }}>{tab==='info'?'Info':tab==='features'?'Features (1–20)':`${cls.subclassTitle}s (${cls.subclasses?.length||0})`}</button>
        ))}
      </div>
      {mcTab==='info' && (<div>
        <div style={{marginBottom:12}}>
          <div style={{color:'var(--text-secondary)',fontWeight:'bold',fontSize:12,marginBottom:6}}>Starting Proficiencies</div>
          {profs.armor?.length>0 && <ProfRow label="Armor" value={profs.armor.map(a=>parseTags(String(a))).join(', ')} />}
          {profs.weapons?.length>0 && <ProfRow label="Weapons" value={profs.weapons.map(w=>parseTags(String(w))).join(', ')} />}
          {profs.savingThrows?.length>0 && <ProfRow label="Saves" value={profs.savingThrows.join(', ')} />}
          {profs.skills?.length>0 && <ProfRow label="Skills" value={formatSkillChoices(profs.skills)} />}
          {profs.tools?.length>0 && <ProfRow label="Tools" value={profs.tools.map(t=>parseTags(String(typeof t==='object'?Object.keys(t).find(k=>t[k]===true)||'':t))).join(', ')} />}
        </div>
        <EntryRenderer entries={cls.entries} />
      </div>)}
      {mcTab==='features' && <FeatureTable cd={cls} hl={null} open />}
      {mcTab==='subclasses' && (<div>
        {(cls.subclasses||[]).length===0
          ? <div style={{color:'var(--text-dim)',fontSize:13}}>Keine Subklassen-Daten.</div>
          : (cls.subclasses||[]).map(sub => <SubclassCard key={sub.name} sub={sub} sel={false} onSel={()=>{}} />)}
      </div>)}
    </div>)
  }

  return (
    <div style={{maxWidth:860,margin:'0 auto'}}>
      <h2 style={S.secTitle}>Klasse für Level Up wählen</h2>
      <p style={{color:'var(--text-muted)',marginBottom:20,fontSize:14}}>{char.info.name} ist Level {tl}.</p>
      <div style={{display:'flex',flexDirection:'column',gap:12,marginBottom:20}}>
        {char.classes.map((cls, idx) => {
          const d = classes.find(c => c.id === cls.classId); if (!d) return null
          const nxt = cls.level+1, feat = getLevelFeatures(d, nxt)
          return (
            <div key={idx} style={S.classCard} onClick={() => onSelect(idx, d)}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{color:'var(--text-primary)',fontWeight:'bold',fontSize:16}}>{cls.classId}</div>
                  <div style={{color:'var(--text-muted)',fontSize:13}}>Level {cls.level} → <span style={{color:'var(--accent-green)'}}>{nxt}</span>
                    {cls.subclassId && <span style={{color:'var(--accent-purple)',marginLeft:8}}>{cls.subclassId}</span>}</div>
                </div>
                <div style={{display:'flex',gap:6}}>
                  <span style={S.hitDieBadge}>d{cls.hitDie}</span>
                  {cls.casterProgression && <span style={{...S.hitDieBadge,borderColor:CC[cls.casterProgression]||'var(--text-dim)',color:CC[cls.casterProgression]||'var(--text-dim)'}}>{cls.casterProgression}</span>}
                </div>
              </div>
              {feat.length > 0 && <div style={{marginTop:8,display:'flex',flexWrap:'wrap',gap:4}}>
                {feat.map((f,i) => <span key={i} style={S.featureTag}>{f}</span>)}</div>}
              <div style={{color:'var(--accent)',fontWeight:'bold',fontSize:13,marginTop:10,textAlign:'right'}}>⬆ Level Up</div>
            </div>
          )
        })}
      </div>
      {!showMC ? <button style={S.addClassBtn} onClick={() => setShowMC(true)}>＋ Neue Klasse (Multiclass)</button> : (
        <div style={{marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <div style={S.secTitle}>Multiclass — Neue Klasse wählen</div>
            <button style={S.closeBtn} onClick={() => setShowMC(false)}>✕</button>
          </div>
          <BrowsePanel items={mcC.filter(c => c._e.eligible)} selectedId={null}
            onSelect={c => c._e.eligible && onSelect(-1, c)}
            renderListItem={(c, sel) => (<div>
              <div style={{color:sel?'var(--accent)':'var(--text-primary)',fontWeight:'bold',fontSize:14}}>{c.name}</div>
              <div style={{display:'flex',gap:6,marginTop:2}}>
                <span style={{color:'var(--accent-red)',fontSize:11}}>d{c.hitDie}</span>
                <span style={{color:CC[c.casterProgression]||'var(--text-dim)',fontSize:11}}>{c.casterProgression||'—'}</span>
              </div>
              {!c._e.eligible && <div style={{color:'var(--accent-red)',fontSize:10}}>{c._e.reason}</div>}
            </div>)}
            renderDetail={renderClassDetail}
            searchKeys={['name']} />
        </div>
      )}
      {lastLU && <div style={S.undoCard}>
        <div>
          <div style={{color:'var(--accent-red)',fontWeight:'bold',fontSize:13}}>↩ Level Down — {lastLU.classId} Lv.{lastLU.classLevel}</div>
          <div style={{color:'var(--text-muted)',fontSize:11}}>
            {new Date(lastLU.timestamp).toLocaleDateString('de-DE')}
            {(() => { const cls=char.classes.find(c=>c.classId===lastLU.classId); const lc=cls?.levelChoices?.[lastLU.classLevel]||{}
              const p=[]; if(lc.type==='asi')p.push('ASI'); if(lc.type==='feat')p.push(`Feat: ${lc.featId}`)
              if(lc.cantrips?.length)p.push(`${lc.cantrips.length} Cantrips`); if(lc.knownSpells?.length)p.push(`${lc.knownSpells.length} Spells`)
              if(lc.optionalFeatures?.length)p.push(lc.optionalFeatures.map(f=>f.name).join(', '))
              for(const[fn,sp]of Object.entries(lc.optFeatureSpells||{})){if(sp?.length)p.push(`${fn}: ${sp.join(', ')}`)}
              return p.length ? ` · ${p.join(' · ')}` : ''
            })()}
          </div>
        </div>
        <button style={S.undoBtn} onClick={onUndo}>Rückgängig</button>
      </div>}
    </div>
  )
}

function ProfRow({ label, value }) {
  return <div style={{fontSize:12,marginBottom:3}}>
    <span style={{color:'var(--text-muted)'}}>{label}: </span>
    <span style={{color:'var(--text-secondary)'}}>{value}</span>
  </div>
}

function formatSkillChoices(skills) {
  if (!skills?.length) return ''
  for (const s of skills) {
    if (s?.choose) return `Choose ${s.choose.count||2} from ${(s.choose.from||[]).join(', ')}`
    if (typeof s?.any === 'number') return `Choose any ${s.any}`
  }
  return ''
}

// ═══════ STEP: HP ════════════════════════════════════════════════════════════

function StepHP({ info, draft, setDraft, subFeats }) {
  // Merge class + subclass features
  const allFeats = [...(info.featureObjects||[]), ...(subFeats||[])]
  return (
    <div style={{maxWidth:700,margin:'0 auto'}}>
      <h2 style={S.secTitle}>{info.className} — Level {info.nextLevel}</h2>
      <div style={S.card}>
        <div style={S.cardTitle}>Neue Features</div>
        {allFeats.length > 0 ? allFeats.map((f,i) => (
          <div key={i} style={{background:'var(--bg-inset)',borderRadius:8,padding:'10px 14px',border:'1px solid var(--border-subtle)',marginBottom:8}}>
            <div style={{color:'var(--accent-green)',fontWeight:'bold',fontSize:13,marginBottom:4}}>{f.name}</div>
            {f.entries?.length > 0 && <div style={{fontSize:12}}><EntryRenderer entries={f.entries} /></div>}
          </div>
        )) : <div style={{color:'var(--text-dim)',fontSize:13}}>Keine neuen Features.</div>}
        {info.unlocksNewSpellLevel && <div style={{background:'var(--bg-hover)',border:'1px solid var(--accent-purple)',borderRadius:8,padding:'8px 14px',marginTop:8}}>
          <span style={{color:'var(--accent-purple)',fontWeight:'bold',fontSize:13}}>✦ Neues Spell Level: Level {info.maxSpellLevel}!</span></div>}
        <FeatureTable cd={draft.classData} hl={info.nextLevel} />
      </div>
      <div style={S.card}>
        <div style={S.cardTitle}>Trefferpunkte</div>
        <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
          <button style={{...S.optBtn,...(draft.hpMethod==='average'?S.optAct:{})}}
            onClick={() => setDraft(d=>({...d,hpMethod:'average',hpValue:info.hpAverage}))}>Durchschnitt: {info.hpAverage}</button>
          <button style={{...S.optBtn,...(draft.hpMethod==='roll'?S.optAct:{})}}
            onClick={() => setDraft(d=>({...d,hpMethod:'roll'}))}>Würfeln (1d{info.hitDie})</button>
          {draft.hpMethod==='roll' && <input type="number" min={1} max={info.hitDie} style={S.rollInput}
            value={draft.hpValue===info.hpAverage?'':draft.hpValue||''} placeholder={`1-${info.hitDie}`}
            onChange={e=>{const v=parseInt(e.target.value);if(v>=1&&v<=info.hitDie)setDraft(d=>({...d,hpValue:v}))}} />}
          <span style={{color:'var(--accent-green)',fontWeight:'bold'}}>+{draft.hpValue||0} HP (+ CON-Mod)</span>
        </div>
        <div style={{color:'var(--text-muted)',fontSize:11,marginTop:8,fontStyle:'italic'}}>Ändert sich dein CON-Modifier, werden HP aller Level retroaktiv angepasst.</div>
      </div>
    </div>
  )
}

// ═══════ STEP: SUBCLASS ═══════════════════════════════════════════════════

function StepSubclass({ info, draft, onSubclassChosen }) {
  return (
    <div style={{maxWidth:700,margin:'0 auto'}}>
      <h2 style={S.secTitle}>{info.subclassTitle} wählen</h2>
      {info.subclasses.map(sub => <SubclassCard key={sub.name} sub={sub} sel={draft.subclassId===sub.name}
        onSel={() => onSubclassChosen(sub.name, sub)} />)}
    </div>
  )
}

// ═══════ STEP: ASI/FEAT ═════════════════════════════════════════════════════

function StepASI({ info, draft, setDraft, abScores, feats, optF, edition, allSp }) {
  const total = Object.values(draft.asiPicks).reduce((a,b)=>a+b,0)
  function toggleAsi(ab) {
    const cur=draft.asiPicks[ab]||0
    if(cur>0){const n={...draft.asiPicks};delete n[ab];setDraft(d=>({...d,asiPicks:n}))}
    else if(total<2)setDraft(d=>({...d,asiPicks:{...d.asiPicks,[ab]:1}}))
  }
  function setTwo(ab){if((abScores[ab]||10)>=19)return;setDraft(d=>({...d,asiPicks:{[ab]:2}}))}

  return (
    <div style={{maxWidth:860,margin:'0 auto'}}>
      <h2 style={S.secTitle}>Ability Score Improvement / Feat</h2>
      <div style={{display:'flex',gap:8,marginBottom:16}}>
        <button style={{...S.optBtn,...(draft.asiMode==='asi'?S.optAct:{})}} onClick={()=>setDraft(d=>({...d,asiMode:'asi'}))}>+2 Ability Score</button>
        <button style={{...S.optBtn,...(draft.asiMode==='feat'?S.optAct:{})}} onClick={()=>setDraft(d=>({...d,asiMode:'feat'}))}>Feat wählen</button>
      </div>
      {draft.asiMode==='asi' && <div style={S.card}>
        <div style={{color:'var(--text-muted)',fontSize:12,marginBottom:8}}>Verteile 2 Punkte (klick +1, doppelklick +2):</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
          {ABILITIES.map(ab=>{const sc=abScores[ab]||10,b=draft.asiPicks[ab]||0,s=b>0,c=sc+b>=20
            return<button key={ab} disabled={c&&!s} onClick={()=>toggleAsi(ab)} onDoubleClick={()=>setTwo(ab)}
              style={{...S.abilChip,borderColor:s?'var(--accent)':'var(--border)',background:s?'var(--bg-highlight)':'var(--bg-card)',opacity:c&&!s?0.4:1}}>
              <div style={{color:s?'var(--accent)':'var(--text-muted)',fontWeight:'bold',fontSize:13}}>{ab.toUpperCase()}</div>
              <div style={{color:'var(--text-primary)',fontSize:12}}>{sc}</div>
              {b>0&&<div style={{color:'var(--accent-green)',fontSize:11,fontWeight:'bold'}}>+{b}</div>}</button>})}
        </div>
        <div style={{color:total===2?'var(--accent-green)':'var(--text-muted)',fontSize:12,marginTop:6}}>{total}/2 verteilt</div>
      </div>}
      {draft.asiMode==='feat' && <FeatPicker feats={feats} optF={optF} draft={draft} setDraft={setDraft} edition={edition} allSp={allSp} levelContext={{ classId: info.classId, classLevel: info.nextLevel }} />}
    </div>
  )
}

// ═══════ STEP: FEATURES ═════════════════════════════════════════════════════

function StepFeatures({ info, draft, setDraft, optF, feats, char }) {
  const subD = draft.subclassId && draft.classData ? (draft.classData.subclasses||[]).find(s=>s.name===draft.subclassId) : null
  const existOF = useMemo(() => {
    const ce = char.classes.find(c=>c.classId===info.classId)
    return ce ? getExistingOptionalFeatures(ce) : []
  }, [char, info.classId])
  // Neue Picks auf diesem Level ODER reine Tausch-Gelegenheit (RAW „when
  // you gain a level … replace") — Letzteres nur mit vorhandenen Picks.
  const gains = computeOptionalFeatureGains(draft.classData, subD, info.nextLevel)
    .filter(g => g.newCount > 0 || (g.swapEveryLevel && existOF.length > 0))

  // Optional Class Feature Variants (TCE-Erweiterungen) die auf
  // DIESER neuen Stufe verfügbar werden. Data-driven aus
  // classData.features mit isClassFeatureVariant=true.
  const newVariantsAtThisLevel = useMemo(() => {
    if (!draft.classData) return []
    return (draft.classData.features || [])
      .filter(f => f?.isClassFeatureVariant
        && (f.level || 1) === info.nextLevel
        && f.name)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [draft.classData, info.nextLevel])
  const variantPicks = draft.optionalClassFeatures || (char.optionalClassFeatures || {})
  const classVariants = variantPicks[info.classId] || {}
  const toggleVariant = (featureName) => {
    const wasOn = !!classVariants[featureName]
    const nextClsMap = { ...classVariants }
    if (wasOn) delete nextClsMap[featureName]
    else nextClsMap[featureName] = true
    const nextAll = { ...variantPicks }
    if (Object.keys(nextClsMap).length > 0) nextAll[info.classId] = nextClsMap
    else delete nextAll[info.classId]
    setDraft(d => ({ ...d, optionalClassFeatures: nextAll }))
  }

  // Detect class features that need choices (data-driven by feature names)
  const featureNames = info.features.map(f => f.toLowerCase())
  const showFavoredEnemy = featureNames.some(f => f.includes('favored enemy'))
  const showFavoredTerrain = featureNames.some(f => f.includes('natural explorer'))
  const cfc = draft.classFeatureChoices || {}

  // Generische Feature-Option-Picks (Druid Primal Order, 2024 Fighting
  // Style / Epic Boon, …) — neu auf diesem Level, datadriven aus den
  // Class-/Subclass-Features + Feat-Kategorien.
  const stepFeatMap = useMemo(() => buildNameSourceMap(feats), [feats])
  const newOptionBlockDescs = useMemo(() => computeNewOptionBlockDescs(draft, info, stepFeatMap), [draft, info, stepFeatMap])
  const optionPicks = draft.featureOptionPicks || {}
  const toggleOptionPick = (desc, valueKey) => {
    const stored = optionPicks[desc.id]
    const arr = Array.isArray(stored) ? stored : (stored ? [stored] : [])
    let nextArr
    if (desc.count === 1) {
      nextArr = arr.includes(valueKey) ? [] : [valueKey]
    } else {
      nextArr = arr.includes(valueKey)
        ? arr.filter(v => v !== valueKey)
        : (arr.length < desc.count ? [...arr, valueKey] : arr)
    }
    const value = desc.count === 1 ? (nextArr[0] || null) : nextArr
    setDraft(d => ({ ...d, featureOptionPicks: { ...(d.featureOptionPicks || {}), [desc.id]: value } }))
  }

  // ── "Your choice"-Picks aus dem Feature-Text ──
  // Expertise / Skill / Sprache / Tool / Saving Throw, die
  // parseFeatureChoices aus den neuen Features dieses Levels zieht.
  // Gespeichert wie der Features-Tab-Backstop: cls.featureChoices[id].
  const newTextChoices = useMemo(() => computeNewFeatureTextChoices(draft, info), [draft, info])
  const textPicks = draft.featureTextPicks || {}
  // Eligibility aus den AKTUELLEN Proficiencies des Charakters —
  // Expertise nur auf proficient (noch nicht Expertise), Sprachen/Tools
  // die man schon hat sind raus (RAW).
  const profState = useMemo(() => {
    try {
      const profs = computeProficiencies(char) || {}
      const skillMap = profs.skills || {}
      return {
        eligibleExpertise: Object.entries(skillMap).filter(([, v]) => v === 'proficient').map(([k]) => k),
        languages: new Set((profs.languages || []).map(l => String(l).toLowerCase())),
        tools: new Set(Object.keys(profs.tools || {}).map(k => String(k).toLowerCase())),
      }
    } catch { return { eligibleExpertise: [], languages: new Set(), tools: new Set() } }
  }, [char])
  const toggleTextPick = (choice, val) => setDraft(d => {
    const cur = d.featureTextPicks?.[choice.id]?.value
    // Array- vs. Skalar-Storage exakt wie der Features-Tab-Backstop,
    // damit dessen "erledigt"-Check die Level-Up-Picks wiedererkennt.
    const isMulti = choice.type === 'expertise' || choice.type === 'languageProficiency' || choice.type === 'toolProficiency'
    let value
    if (!isMulti) {
      value = cur === val ? null : val
    } else {
      const arr = Array.isArray(cur) ? cur : []
      value = arr.includes(val) ? arr.filter(v => v !== val)
        : (arr.length < choice.count ? [...arr, val] : arr)
    }
    return { ...d, featureTextPicks: { ...(d.featureTextPicks || {}), [choice.id]: { id: choice.id, type: choice.type, value } } }
  })
  // Optionen je Choice-Type (Expertise/Sprachen/Tools sind dynamisch,
  // Skill/Save kommen als statische Options aus dem Parser).
  const textChoiceOptions = (choice) => {
    if (choice.type === 'expertise') return profState.eligibleExpertise.map(s => ({ value: s, label: formatSkillName(s) }))
    if (choice.type === 'languageProficiency') {
      const curArr = Array.isArray(textPicks[choice.id]?.value) ? textPicks[choice.id].value : []
      return STANDARD_LANGUAGES
        .filter(l => curArr.includes(l) || !profState.languages.has(l.toLowerCase()))
        .map(l => ({ value: l, label: l }))
    }
    if (choice.type === 'toolProficiency') {
      const curArr = Array.isArray(textPicks[choice.id]?.value) ? textPicks[choice.id].value : []
      return STANDARD_TOOLS
        .filter(t => curArr.includes(t) || !profState.tools.has(t.toLowerCase()))
        .map(t => ({ value: t, label: t }))
    }
    return choice.options || []
  }

  return (
    <div style={{maxWidth:860,margin:'0 auto'}}>
      <h2 style={S.secTitle}>Class Features wählen</h2>

      {/* ── Feature-Text-Picks (Expertise / Skill / Sprache / Tool …) ── */}
      {newTextChoices.map(({ feature, choice }) => {
        const cur = textPicks[choice.id]?.value
        const curArr = Array.isArray(cur) ? cur : (cur != null ? [cur] : [])
        const done = curArr.length >= choice.count
        const opts = textChoiceOptions(choice)
        return (
          <div key={choice.id} style={S.card}>
            <div style={S.cardTitle}>
              {feature.name} (L{feature.level ?? info.nextLevel})
              {done
                ? <span style={{ color: 'var(--accent-green)', marginLeft: 8, fontSize: 12 }}>✓ {curArr.length}/{choice.count}</span>
                : <span style={{ color: 'var(--accent)', marginLeft: 8, fontSize: 12 }}>{curArr.length}/{choice.count} — wählen</span>}
            </div>
            <div style={{ color:'var(--text-muted)', fontSize:12, marginBottom:10 }}>{choice.label}</div>
            {opts.length === 0 ? (
              <div style={{ color:'var(--text-dim)', fontSize:12, fontStyle:'italic' }}>
                Keine wählbaren Optionen gefunden — du kannst das später im Features-Tab des Sheets nachholen.
              </div>
            ) : (
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {opts.map(o => {
                  const isSel = curArr.includes(o.value)
                  return (
                    <button key={o.value} onClick={() => toggleTextPick(choice, o.value)}
                      style={{padding:'6px 14px',borderRadius:6,border:isSel?'1px solid #e2b96f':'1px solid #2a4a6a',
                        background:isSel?'var(--bg-highlight)':'var(--bg-card)',color:isSel?'var(--accent)':'var(--text-muted)',cursor:'pointer',fontSize:12}}>
                      {o.label} {isSel && '✓'}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* ── Optional Class Feature Variants (TCE) auf dieser Stufe ── */}
      {newVariantsAtThisLevel.length > 0 && (
        <div style={S.card}>
          <div style={S.cardTitle}>
            Optionale Klassen-Features (Variant Rules · L{info.nextLevel})
          </div>
          <div style={{ color:'var(--text-muted)', fontSize:12, marginBottom:10 }}>
            Diese 2020-Erweiterungen sind optional — frag ggf. deinen GM. Aktivierte
            Variants werden auf dem Sheet wie reguläre Class Features behandelt.
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:8 }}>
            {newVariantsAtThisLevel.map(v => {
              const isOn = !!classVariants[v.name]
              const firstStr = Array.isArray(v.entries)
                ? v.entries.find(e => typeof e === 'string') : null
              const shortDesc = firstStr
                ? String(firstStr).replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1').slice(0, 260)
                : ''
              return (
                <div
                  key={v.name}
                  onClick={() => toggleVariant(v.name)}
                  style={{
                    padding:'10px 12px', borderRadius:8, cursor:'pointer',
                    border: isOn ? '2px solid var(--accent-purple)' : '2px solid var(--border)',
                    background: isOn ? 'var(--bg-highlight)' : 'var(--bg-elevated)',
                  }}>
                  <div style={{ fontWeight:600, color:'var(--text-primary)', marginBottom:4 }}>
                    {isOn ? '✓ ' : '+ '}{v.name}
                    {v.source && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-dim)' }}>{v.source}</span>}
                  </div>
                  {shortDesc && (
                    <div style={{ fontSize:12, color:'var(--text-muted)' }}>
                      {shortDesc}{firstStr && firstStr.length > 260 ? ' …' : ''}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Generische Feature-Option-Blocks (Druid Primal Order etc.) ── */}
      {newOptionBlockDescs.map(desc => {
        const stored = optionPicks[desc.id]
        const storedArr = Array.isArray(stored) ? stored : (stored ? [stored] : [])
        const done = storedArr.length === desc.count
        return (
          <div key={desc.id} style={S.card}>
            <div style={S.cardTitle}>
              {desc._featureName || desc.label}
              {done
                ? <span style={{ color: 'var(--accent-green)', marginLeft: 8, fontSize: 12 }}>✓ {storedArr.length}/{desc.count}</span>
                : <span style={{ color: 'var(--accent)', marginLeft: 8, fontSize: 12 }}>{storedArr.length}/{desc.count} — wählen</span>}
            </div>
            <div style={{ color:'var(--text-muted)', fontSize:12, marginBottom:10 }}>
              Wähle {desc.count === 1 ? 'eine Option' : `${desc.count} Optionen`} für „{desc._featureName || desc.label}".
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:8 }}>
              {desc.options.map(opt => {
                const isSel = storedArr.includes(opt.value)
                const firstString = Array.isArray(opt.description)
                  ? opt.description.find(e => typeof e === 'string') : null
                const shortDesc = firstString
                  ? String(firstString).replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1').slice(0, 260) : ''
                return (
                  <div
                    key={opt.value}
                    onClick={() => toggleOptionPick(desc, opt.value)}
                    style={{
                      padding:'10px 12px', borderRadius:8, cursor:'pointer',
                      border: isSel ? '2px solid var(--accent)' : '2px solid var(--border)',
                      background: isSel ? 'var(--bg-highlight)' : 'var(--bg-elevated)',
                    }}>
                    <div style={{ fontWeight:600, color:'var(--text-primary)', marginBottom:4 }}>{opt.label}</div>
                    {shortDesc && <div style={{ fontSize:12, color:'var(--text-muted)' }}>{shortDesc}{firstString && firstString.length > 260 ? ' …' : ''}</div>}
                    {isSel && <div style={{ color:'var(--accent)', fontSize:11, marginTop:6 }}>✓ Gewählt</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Ranger Favored Enemy (5e — data-driven by feature name) */}
      {showFavoredEnemy && <div style={S.card}>
        <div style={S.cardTitle}>Favored Enemy</div>
        <div style={{color:'var(--text-muted)',fontSize:12,marginBottom:10}}>
          Wähle einen Favored Enemy. Du hast Advantage auf Survival-Checks um sie zu verfolgen und auf Intelligence-Checks um Wissen über sie abzurufen.
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
          {['Aberrations','Beasts','Celestials','Constructs','Dragons','Elementals','Fey','Fiends','Giants','Humanoids','Monstrosities','Oozes','Plants','Undead'].map(enemy => {
            const isSel = cfc.favoredEnemy === enemy
            return <button key={enemy} onClick={() => setDraft(d => ({...d, classFeatureChoices:{...d.classFeatureChoices, favoredEnemy:isSel?null:enemy}}))}
              style={{padding:'6px 14px',borderRadius:6,border:isSel?'1px solid #e2b96f':'1px solid #2a4a6a',
                background:isSel?'var(--bg-highlight)':'var(--bg-card)',color:isSel?'var(--accent)':'var(--text-muted)',cursor:'pointer',fontSize:12}}>
              {enemy} {isSel&&'✓'}
            </button>
          })}
        </div>
      </div>}

      {/* Ranger Natural Explorer / Favored Terrain (5e) */}
      {showFavoredTerrain && <div style={S.card}>
        <div style={S.cardTitle}>Natural Explorer — Favored Terrain</div>
        <div style={{color:'var(--text-muted)',fontSize:12,marginBottom:10}}>
          Wähle ein Favored Terrain. In diesem Terrain erhältst du verschiedene Boni beim Reisen und Überleben.
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
          {['Arctic','Coast','Desert','Forest','Grassland','Mountain','Swamp','Underdark'].map(terrain => {
            const isSel = cfc.favoredTerrain === terrain
            return <button key={terrain} onClick={() => setDraft(d => ({...d, classFeatureChoices:{...d.classFeatureChoices, favoredTerrain:isSel?null:terrain}}))}
              style={{padding:'6px 14px',borderRadius:6,border:isSel?'1px solid #e2b96f':'1px solid #2a4a6a',
                background:isSel?'var(--bg-highlight)':'var(--bg-card)',color:isSel?'var(--accent)':'var(--text-muted)',cursor:'pointer',fontSize:12}}>
              {terrain} {isSel&&'✓'}
            </button>
          })}
        </div>
      </div>}

      {/* Optional features (Invocations, Metamagic, Fighting Style, etc.) */}
      {gains.map(gain => <OptFeatPicker key={gain.name} gain={gain} optF={optF} feats={feats} existOF={existOF}
        draft={draft} setDraft={setDraft} char={char} classId={info.classId} classLevel={info.nextLevel} />)}
    </div>
  )
}

// ═══════ STEP: SPELLS ═══════════════════════════════════════════════════════

function StepSpells({ info, draft, setDraft, allSp, csn, char, optF, edition }) {
  const [sLv,setSLv]=useState(null),[sCon,setSCon]=useState(false),[sRit,setSRit]=useState(false)
  const slci = getSpellListClass(info.classId, draft.subclassId, edition)
  const clsLc = (slci||'').toLowerCase()
  const isCS = s => { if(csn.size>0&&csn.has(s.name.toLowerCase()))return true; return(s.classes||[]).some(c=>c.toLowerCase()===clsLc) }
  const classCant = useMemo(()=>allSp.filter(s=>s.level===0&&isCS(s)),[allSp,csn,clsLc])
  const classLev = useMemo(()=>info.maxSpellLevel>0?allSp.filter(s=>s.level>=1&&s.level<=info.maxSpellLevel&&isCS(s)):[]
    ,[allSp,csn,clsLc,info.maxSpellLevel])

  // Granted spells (known + feat spells)
  const granted = useMemo(()=>{
    const r={}
    for (const n of getAllKnownSpellNames(char)) if(n) r[n]='bereits bekannt'
    for (const feat of (char.feats||[])) {
      for (const sp of (feat.choices?.spells||[])) { const name=typeof sp==='string'?sp:sp?.name; if(name) r[name]=`Feat: ${feat.featId}` }
      for (const block of (feat.additionalSpells||[])) {
        if (!block||typeof block!=='object') continue
        for (const grantType of ['known','innate','prepared']) {
          const td=block[grantType]; if(!td||typeof td!=='object') continue
          for (const vals of Object.values(td)) {
            const items=Array.isArray(vals)?vals:Object.values(vals||{}).flat()
            for (const s of items) { if(typeof s==='string'&&!s.startsWith('choose')) { const name=s.split('|')[0].replace(/\b\w/g,c=>c.toUpperCase()).trim(); if(name) r[name]=`Feat: ${feat.featId}` } }
          }
        }
      }
    }
    return r
  },[char])

  const spellCount = info.newSpellsKnown||info.newSpellbookSpells||0
  const sr = info.schoolRestriction, isFree = sr&&sr.freeChoiceLevels?.includes(info.nextLevel)
  const isPrepared = !info.newSpellsKnown && !info.newSpellbookSpells && (info.spellcastingAbility || info.casterProgression) && !sr && info.maxSpellLevel > 0

  // For prepared casters: store full preparable spell pool in draft for Foundry export
  useEffect(() => {
    if (!isPrepared) return
    const pool = classLev.map(s => s.name)
    const cantPool = classCant.map(s => s.name)
    setDraft(d => ({...d, preparedSpellPool: pool, preparedCantripPool: cantPool}))
  }, [isPrepared, classLev.length, classCant.length])

  const filteredLev = useMemo(()=>{let r=classLev
    if(sr&&!isFree) r=r.filter(s=>{const c=(s.school||'').charAt(0).toUpperCase();return sr.schools.includes(c)})
    if(sLv!==null)r=r.filter(s=>s.level===sLv);if(sCon)r=r.filter(s=>s.concentration);if(sRit)r=r.filter(s=>s.ritual);return r
  },[classLev,sr,isFree,sLv,sCon,sRit])
  const availLvls = useMemo(()=>[...new Set(classLev.map(s=>s.level))].sort((a,b)=>a-b),[classLev])

  const knownList = useMemo(()=>{const ce=char.classes.find(c=>c.classId===info.classId);if(!ce)return[]
    const ns=new Set();for(const lc of Object.values(ce.levelChoices||{})){for(const s of(lc.knownSpells||[]))ns.add(s);for(const s of(lc.startingSpells||[]))ns.add(s)};return[...ns]},[char,info.classId])

  const maxSpells = spellCount + (draft.wantSwap&&draft.swapOld?1:0)

  // Parse optional feature spell choices (Blessed Warrior, Pact of the Tome, etc.)
  const optFeatSpellPickers = useMemo(() => {
    if (!optF || optF.length === 0) return []
    const pickers = []
    for (const [groupName, names] of Object.entries(draft.optPicks)) {
      for (const featName of names) {
        const of = optF.find(o => o.name === featName)
        if (!of?.additionalSpells?.length) continue
        for (const block of of.additionalSpells) {
          if (!block || typeof block !== 'object') continue
          for (const grantType of ['known', 'innate', 'prepared']) {
            const td = block[grantType]
            if (!td || typeof td !== 'object') continue
            for (const [lvlKey, levelData] of Object.entries(td)) {
              const entries = Array.isArray(levelData) ? levelData : Object.values(levelData || {}).flat()
              for (const entry of entries) {
                if (!entry || typeof entry !== 'object' || !entry.choose) continue
                // Parse choose string: "level=0|class=cleric" or "level=0"
                const chooseStr = typeof entry.choose === 'string' ? entry.choose : ''
                const count = entry.count || 1
                // Extract filters from choose string
                let filterLevel = null, filterClass = null
                for (const part of chooseStr.split('|')) {
                  const [k, v] = part.split('=')
                  if (k === 'level') filterLevel = parseInt(v)
                  if (k === 'class') filterClass = v?.toLowerCase()
                }
                // Filter spells
                let pool = allSp
                if (filterLevel !== null) pool = pool.filter(s => s.level === filterLevel)
                if (filterClass) pool = pool.filter(s => {
                  if (csn.size > 0) {
                    // Use class spell names if matching
                    if (filterClass === clsLc) return csn.has(s.name.toLowerCase())
                  }
                  return (s.classes || []).some(c => c.toLowerCase() === filterClass)
                })
                pickers.push({ featName, count, pool, filterLevel, filterClass, ability: block.ability })
              }
            }
          }
        }
      }
    }
    return pickers
  }, [draft.optPicks, optF, allSp, csn, clsLc])

  return (
    <div style={{maxWidth:860,margin:'0 auto'}}>
      <h2 style={S.secTitle}>{info.className} — Zauber</h2>

      {/* Optional feature spell pickers (Blessed Warrior, Pact of the Tome, etc.) */}
      {optFeatSpellPickers.map((picker, pi) => {
        const key = `${picker.featName}-${pi}`
        const selected = draft.optFeatureSpells[picker.featName] || []
        return (
          <div key={key} style={S.card}>
            <div style={S.cardTitle}>
              {picker.featName} — {picker.filterLevel === 0 ? 'Cantrips' : 'Zauber'} wählen ({selected.length}/{picker.count})
            </div>
            {picker.filterClass && <div style={{color:'var(--text-muted)',fontSize:12,marginBottom:8}}>
              Aus der {picker.filterClass.charAt(0).toUpperCase()+picker.filterClass.slice(1)}-Zauberliste
            </div>}
            <UniversalSpellList
              label={`${picker.count} wählen`}
              spells={picker.pool}
              selected={selected}
              max={picker.count}
              onToggle={sp => {
                const has = selected.includes(sp.name)
                const next = has ? selected.filter(n => n !== sp.name) : selected.length < picker.count ? [...selected, sp.name] : selected
                setDraft(d => ({...d, optFeatureSpells: {...d.optFeatureSpells, [picker.featName]: next}}))
              }}
              grantedSpells={granted}
            />
          </div>
        )
      })}

      {/* Class cantrips */}
      {info.newCantrips>0&&<div style={S.card}><div style={S.cardTitle}>Neue Cantrips ({draft.cantrips.length}/{info.newCantrips})</div>
        <UniversalSpellList label={`Cantrips wählen — ${info.newCantrips}`} spells={classCant} selected={draft.cantrips} max={info.newCantrips}
          onToggle={sp=>{const h=draft.cantrips.includes(sp.name);setDraft(d=>({...d,cantrips:h?d.cantrips.filter(n=>n!==sp.name):d.cantrips.length<info.newCantrips?[...d.cantrips,sp.name]:d.cantrips}))}}
          grantedSpells={granted} /></div>}

      {/* 5.5e Prepared casters — KEIN Picker mehr. Beim Level-Up
          zeigen wir nur eine Vorschau der vorbereitbaren Zauber, mit
          den NEU freigeschalteten oben hervorgehoben. Das eigentliche
          Preparen passiert nach einer Long Rest auf dem Sheet. */}

      {/* Leveled spells block — bei prepared caster reine Preview-
          Liste (neue Slot-Stufen oben), bei known caster die übliche
          Pick-UI für die N neuen Zauber. */}
      {(spellCount>0||isPrepared)&&<div style={S.card}>
        <div style={S.cardTitle}>
          {isPrepared
            ? `${info.className} — Vorbereitbare Zauber`
            : `${info.className} — Neue Zauber`}
        </div>
        {isPrepared && (() => {
          // Der Spell-Step ist für prepared caster NUR sichtbar wenn
          // ein neues Spell-Level dazukommt (gate in getActiveSteps).
          // Zeige hier ausschließlich die neu vorbereitbaren Spells —
          // nicht den ganzen Pool nochmal. Full prepare-management
          // läuft auf dem Sheet.
          const prevMax = info.prevMaxSpellLevel ?? Math.max(0, (info.maxSpellLevel || 0) - 1)
          const newlyUnlockedLevels = []
          for (let lv = prevMax + 1; lv <= (info.maxSpellLevel || 0); lv++) newlyUnlockedLevels.push(lv)
          const sortFn = (a, b) => (a.level - b.level) || a.name.localeCompare(b.name)
          const newSpells = newlyUnlockedLevels.length > 0
            ? classLev.filter(s => newlyUnlockedLevels.includes(s.level)).sort(sortFn)
            : []
          return (
            <>
              <div style={{ color:'var(--text-muted)', fontSize:12, marginBottom:10, padding:'8px 12px', background:'var(--bg-inset)', borderRadius:8 }}>
                🆕 Neu freigeschaltet bei Level {newlyUnlockedLevels.join(' / ')} — <b>{newSpells.length}</b> neue Zauber die du nach einer Long Rest preparen kannst.
                Die eigentliche Auswahl machst du auf dem Sheet.
              </div>
              {newSpells.length > 0 && (
                <UniversalSpellList
                  spells={newSpells}
                  selected={[]}
                  max={0}
                  onToggle={() => {}}
                  grantedSpells={granted}
                />
              )}
            </>
          )
        })()}

        {/* Known-Caster UI (Sorcerer/Bard/Warlock/Wizard-Spellbook) —
            für Prepared-Caster (Druid/Cleric/Ranger/Paladin) wird
            stattdessen die obige Vorschau benutzt. */}
        {!isPrepared && info.canSwapSpell && knownList.length > 0 && (
          <div style={{marginBottom:12,padding:'10px 14px',background:'var(--bg-inset)',borderRadius:8,border:'1px solid var(--border)'}}>
            <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',color:'var(--text-secondary)',fontSize:13}}>
              <input type="checkbox" checked={draft.wantSwap} onChange={e=>setDraft(d=>({...d,wantSwap:e.target.checked,...(!e.target.checked?{swapOld:null,swapNew:null}:{})}))} />
              Einen bekannten Zauber tauschen (optional)</label>
            {draft.wantSwap&&<div style={{marginTop:10}}>
              <div style={{color:'var(--accent-red)',fontSize:11,fontWeight:'bold',marginBottom:4}}>Abgeben:</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                {knownList.map(name=><button key={name} onClick={()=>setDraft(d=>({...d,swapOld:d.swapOld===name?null:name}))} style={{
                  padding:'4px 10px',borderRadius:6,fontSize:11,cursor:'pointer',
                  border:draft.swapOld===name?'1px solid #ff8888':'1px solid #2a4a6a',background:draft.swapOld===name?'var(--bg-card)':'var(--bg-card)',color:draft.swapOld===name?'var(--accent-red)':'var(--text-muted)',
                }}>{draft.swapOld===name&&'✗ '}{name}</button>)}</div>
              {draft.swapOld&&<div style={{marginTop:6,color:draft.swapNew?'var(--accent-green)':'var(--text-dim)',fontSize:12}}>
                {draft.swapNew?`→ ${draft.swapNew}`:'Wähle einen zusätzlichen Zauber unten'}</div>}
            </div>}
          </div>)}

        {!isPrepared && sr && (
          <div style={{background:'var(--bg-hover)',border:'1px solid var(--accent-purple)',borderRadius:8,padding:'8px 14px',marginBottom:10,fontSize:12}}>
            <span style={{color:'var(--accent-purple)',fontWeight:'bold'}}>Schulbeschränkung: </span>
            <span style={{color:'var(--text-secondary)'}}>{sr.schools.map(s=>SCH[s]||s).join(' / ')}{isFree&&<span style={{color:'var(--accent-green)'}}> — Freie Wahl!</span>}</span>
          </div>
        )}

        {!isPrepared && (
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
            <button style={{...S.filterBtn,...(sLv===null?S.filterAct:{})}} onClick={()=>setSLv(null)}>Alle</button>
            {availLvls.map(lv=><button key={lv} style={{...S.filterBtn,...(sLv===lv?S.filterAct:{})}} onClick={()=>setSLv(sLv===lv?null:lv)}>Lv.{lv}</button>)}
            <button style={{...S.filterBtn,...(sCon?S.filterAct:{}),marginLeft:8}} onClick={()=>setSCon(!sCon)}>K Konz.</button>
            <button style={{...S.filterBtn,...(sRit?S.filterAct:{})}} onClick={()=>setSRit(!sRit)}>R Ritual</button>
          </div>
        )}

        {!isPrepared && (
          <UniversalSpellList label={`Zauber wählen — ${maxSpells}`}
            spells={filteredLev} selected={draft.spells} max={maxSpells}
            onToggle={sp => {
              const h = draft.spells.includes(sp.name)
              if (h) { setDraft(d => ({...d, spells: d.spells.filter(n => n !== sp.name), ...(d.swapNew === sp.name ? {swapNew: null} : {})})) }
              else if (draft.spells.length < maxSpells) {
                setDraft(d => {
                  const next = [...d.spells, sp.name]
                  const sw = d.wantSwap && d.swapOld && next.length > spellCount ? sp.name : d.swapNew
                  return {...d, spells: next, swapNew: sw}
                })
              }
            }}
            grantedSpells={granted} />
        )}
      </div>}
    </div>
  )
}

// ═══════ STEP: SUMMARY ═══════════════════════════════════════════════════════

function StepSummary({ info, draft }) {
  const rows=[['Klasse',`${info.className} ${info.currentLevel} → ${info.nextLevel}`],['Gesamt-Level',String(info.totalLevelAfter)],['HP',`+${draft.hpValue||0} (+ CON-Mod)`]]
  if(info.features.length>0) rows.push(['Features',info.features.join(', ')])
  if(info.unlocksNewSpellLevel) rows.push(['Neues Spell Level',`Level ${info.maxSpellLevel}`])
  if(draft.subclassId && info.needsSubclass) rows.push([info.subclassTitle,draft.subclassId])
  if(info.hasASI&&draft.asiMode==='asi'){const p=Object.entries(draft.asiPicks).map(([k,v])=>`${k.toUpperCase()} +${v}`).join(', ');if(p)rows.push(['ASI',p])}
  if(info.hasASI&&draft.asiMode==='feat'&&draft.featEntry) {
    rows.push(['Feat',draft.featEntry.name])
    const fs = Object.values(draft.featCh?._spells || {}).flat()
    if (fs.length > 0) rows.push(['Feat Spells', fs.join(', ')])
  }
  for(const[g,ns]of Object.entries(draft.optPicks))if(ns.length>0)rows.push([g,ns.join(', ')])
  for(const[g,swp]of Object.entries(draft.optSwaps||{}))if(swp?.want&&swp?.old)rows.push([`Tausch (${g})`,`${swp.old} abgegeben`])
  if(draft.cantrips.length>0)rows.push(['Cantrips',draft.cantrips.join(', ')])
  if(draft.spells.length>0)rows.push(['Zauber',draft.spells.join(', ')])
  if(draft.wantSwap&&draft.swapOld&&draft.swapNew)rows.push(['Tausch',`${draft.swapOld} → ${draft.swapNew}`])
  for (const [featName, spNames] of Object.entries(draft.optFeatureSpells||{})) {
    if (spNames.length > 0) rows.push([`${featName} Spells`, spNames.join(', ')])
  }
  const cfc = draft.classFeatureChoices || {}
  if (cfc.favoredEnemy) rows.push(['Favored Enemy', cfc.favoredEnemy])
  if (cfc.favoredTerrain) rows.push(['Favored Terrain', cfc.favoredTerrain])
  return(<div style={{maxWidth:600,margin:'0 auto'}}><h2 style={S.secTitle}>Zusammenfassung</h2>
    <div style={{display:'flex',flexDirection:'column',gap:8}}>{rows.map(([l,v])=><div key={l} style={S.summaryRow}>
      <span style={{color:'var(--text-muted)',fontSize:13}}>{l}</span><span style={{color:'var(--text-primary)',fontWeight:'bold',fontSize:13}}>{v}</span></div>)}</div>
    <p style={{color:'var(--text-muted)',marginTop:20,fontSize:13}}>Drücke „Level Up bestätigen" um zu speichern.</p></div>)
}

// ═══════ OPTIONAL FEATURE PICKER ═════════════════════════════════════════════

function OptFeatPicker({ gain, optF, feats = [], existOF, draft, setDraft, char, classId, classLevel }) {
  const [search,setSearch]=useState(''),[viewing,setViewing]=useState(null)
  const picks = draft.optPicks[gain.name]||[]
  // 5.5e: gain.source === 'feat' means draw from the feats catalog
  // filtered by category (e.g. category "FS" for Fighting Style). 5e
  // optional features continue to use the optF list filtered by
  // featureType. The picker UI is identical in both cases — only the
  // source pool differs.
  const isFeatSource = gain.source === 'feat'
  const sourcePool = isFeatSource ? feats : optF
  const matchesGain = isFeatSource
    ? (item) => {
        const cat = String(item.category || '').toUpperCase()
        return cat && (gain.featCategories || []).includes(cat)
      }
    : (item) => (item.featureType || []).some(ft => (gain.featureTypes || []).includes(ft))
  const alreadyChosen = new Set(existOF.filter(f => {
    const item = sourcePool.find(o => o.name === f.name)
    return item && matchesGain(item)
  }).map(f => f.name))
  const available = useMemo(()=>{
    let items=sourcePool.filter(matchesGain)
    items=items.filter(o=>!alreadyChosen.has(o.name)||picks.includes(o.name))
    if(search.trim()){const q=search.toLowerCase();items=items.filter(o=>o.name.toLowerCase().includes(q))}
    items=items.map(o=>({...o,_prereqMet:meetsPrerequisites(o.prerequisite,char,classId,classLevel),_prereqText:formatPrerequisites(o.prerequisite)}))
    // Sort: met first, then unmet
    items.sort((a,b)=>(b._prereqMet?1:0)-(a._prereqMet?1:0))
    return items
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sourcePool,gain.featureTypes,gain.featCategories,search,alreadyChosen,picks,char,classId,classLevel])

  // ── Optfeature-Tausch (RAW aus dem Feature-Text erkannt) ──
  // gain.canReplace: „replace"-Erlaubnis (bei jedem Level-Up ODER beim
  // Dazulernen). Der abzugebende Pick wird hier markiert; der Ersatz wird
  // regulär als ZUSÄTZLICHER Pick gewählt (maxPicks steigt um 1).
  const swapState = (draft.optSwaps || {})[gain.name] || null
  const wantSwap = !!swapState?.want
  const swapOld = swapState?.old || null
  // XPHB-Regel: eine Option, die Voraussetzung einer anderen gewählten
  // Option ist, kann nicht abgegeben werden — datengetrieben über die
  // prerequisite.optionalfeature-Verweise der bekannten Picks.
  const lockedAsPrereq = (() => {
    const locked = new Set()
    const known = [...alreadyChosen]
    for (const n of known) {
      const item = sourcePool.find(o => o.name === n)
      for (const p of (item?.prerequisite || [])) {
        for (const ref of (p?.optionalfeature || [])) {
          const raw = typeof ref === 'string' ? ref : (ref?.name || ref?.uid || '')
          const nm = String(raw).split('|')[0].trim().toLowerCase()
          const hit = known.find(k => k.toLowerCase() === nm)
          if (hit) locked.add(hit)
        }
      }
    }
    return locked
  })()
  const maxPicks = gain.newCount + (wantSwap && swapOld ? 1 : 0)
  const isFull = picks.length >= maxPicks
  function toggle(name){const next=picks.includes(name)?picks.filter(n=>n!==name):(!isFull?[...picks,name]:picks);setDraft(d=>({...d,optPicks:{...d.optPicks,[gain.name]:next}}))}
  function setWantSwap(on){
    setDraft(d=>{
      const cur = d.optPicks[gain.name] || []
      // Beim Abwählen den Extra-Pick wieder kappen, damit picks ≤ newCount.
      const trimmed = !on && cur.length > gain.newCount ? cur.slice(0, gain.newCount) : cur
      return {
        ...d,
        optPicks: { ...d.optPicks, [gain.name]: trimmed },
        optSwaps: { ...(d.optSwaps || {}), [gain.name]: { want: on, old: null } },
      }
    })
  }
  function setSwapOld(name){
    setDraft(d=>{
      const cur = d.optPicks[gain.name] || []
      const nextOld = swapOld === name ? null : name
      // Ohne Abgabe-Wahl schrumpft maxPicks — Extra-Pick kappen.
      const trimmed = !nextOld && cur.length > gain.newCount ? cur.slice(0, gain.newCount) : cur
      return {
        ...d,
        optPicks: { ...d.optPicks, [gain.name]: trimmed },
        optSwaps: { ...(d.optSwaps || {}), [gain.name]: { want: true, old: nextOld } },
      }
    })
  }

  return (
    <div style={S.card}>
      <div style={S.cardTitle}>{gain.name} <span style={{color:'var(--accent-green)',fontWeight:'normal',fontSize:12,marginLeft:8}}>({picks.length}/{maxPicks})</span></div>
      {alreadyChosen.size>0&&<div style={{marginBottom:10}}><div style={{color:'var(--text-muted)',fontSize:11,marginBottom:4}}>Bereits gewählt:</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:4}}>{[...alreadyChosen].map(n=><span key={n} style={{...S.featureTag,background: 'var(--bg-highlight)',borderColor:'var(--accent-green)',color:'var(--accent-green)'}}>{n}</span>)}</div></div>}
      {gain.canReplace && alreadyChosen.size>0 && (
        <div style={{marginBottom:10,padding:'8px 12px',background:'var(--bg-inset)',borderRadius:8,border:'1px solid var(--border)'}}>
          <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',color:'var(--text-secondary)',fontSize:13}}>
            <input type="checkbox" checked={wantSwap} onChange={e=>setWantSwap(e.target.checked)} />
            Eine bekannte Option tauschen (optional)</label>
          {wantSwap && (
            <div style={{marginTop:8}}>
              <div style={{color:'var(--accent-red)',fontSize:11,fontWeight:'bold',marginBottom:4}}>Abgeben:</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                {[...alreadyChosen].map(n=>{
                  const locked = lockedAsPrereq.has(n)
                  return <button key={n} disabled={locked}
                    title={locked?'Voraussetzung für eine andere gewählte Option — kann nicht abgegeben werden':undefined}
                    onClick={()=>!locked&&setSwapOld(n)} style={{
                      padding:'4px 10px',borderRadius:6,fontSize:11,cursor:locked?'not-allowed':'pointer',opacity:locked?0.4:1,
                      border:swapOld===n?'1px solid #ff8888':'1px solid #2a4a6a',background:'var(--bg-card)',
                      color:swapOld===n?'var(--accent-red)':'var(--text-muted)',
                    }}>{swapOld===n&&'✗ '}{n}</button>
                })}</div>
              {swapOld&&<div style={{marginTop:6,color:picks.length>gain.newCount?'var(--accent-green)':'var(--text-dim)',fontSize:12}}>
                {picks.length>gain.newCount?'Ersatz gewählt.':'Wähle unten eine zusätzliche Option als Ersatz.'}</div>}
            </div>
          )}
        </div>
      )}
      <div style={fS.layout}>
        <div style={fS.left}>
          <input style={fS.search} placeholder="Suchen…" value={search} onChange={e=>setSearch(e.target.value)} />
          <div style={fS.list}>{available.map(of=>{
            const isSel=picks.includes(of.name),isView=viewing?.name===of.name,canP=(isSel||!isFull)&&of._prereqMet
            return(<div key={of.name} style={{...fS.item,...(isSel?fS.itemSel:isView?fS.itemView:{}),opacity:canP||isSel?1:0.35}} onClick={()=>setViewing(of)}>
              <div style={{color:isSel?'var(--accent)':of._prereqMet?'var(--text-primary)':'var(--text-dim)',fontWeight:'bold',fontSize:13}}>{isSel&&'✓ '}{of.name}</div>
              {of._prereqText.length>0&&<div style={{color:of._prereqMet?'var(--text-muted)':'var(--accent-red)',fontSize:10}}>{of._prereqText.join(', ')}</div>}
            </div>)})}</div>
        </div>
        <div style={fS.right}>
          {viewing?(<>
            <div style={fS.detailScroll}>
              <div style={{color:'var(--accent)',fontSize:18,fontWeight:'bold',marginBottom:4}}>{viewing.name}</div>
              {viewing._prereqText.length>0&&<div style={{marginBottom:10,padding:'6px 10px',borderRadius:6,
                background:viewing._prereqMet?'var(--bg-inset)':'var(--bg-card)',border:viewing._prereqMet?'1px solid #2a4a6a':'1px solid #ff6b6b44',
                color:viewing._prereqMet?'var(--text-muted)':'var(--accent-red)',fontSize:12}}>{viewing._prereqMet?'✓':'✕'} {viewing._prereqText.join(', ')}</div>}
              <EntryRenderer entries={viewing.entries} />
            </div>
            <div style={fS.footer}><button disabled={!viewing._prereqMet&&!picks.includes(viewing.name)}
              style={{...fS.selectBtn,...(picks.includes(viewing.name)?fS.selectBtnAct:{}),opacity:viewing._prereqMet?1:0.4}}
              onClick={()=>viewing._prereqMet&&toggle(viewing.name)}>
              {picks.includes(viewing.name)?'✓ Gewählt':'Wählen'}</button></div>
          </>):<div style={fS.empty}>← Wähle eine Option</div>}
        </div>
      </div>
    </div>)
}

// ═══════ FEAT PICKER (with proper optfeature option loading) ════════════════

function FeatPicker({ feats, optF, draft, setDraft, edition, allSp, levelContext }) {
  const [search,setSearch]=useState(''),[viewing,setViewing]=useState(null)
  // 5.5e feats carry a `category` field:
  //   O   — Origin Feat (taken at character creation from background only)
  //   G   — General Feat (the default ASI-level choice)
  //   FS  — Fighting Style (only when the class feature grants it)
  //   FS:X — Fighting Style restricted to class X
  //   EB  — Epic Boon (only at level 19)
  // At an ASI level the legitimate categories are G + (EB if total level ≥ 19).
  // Anything tagged O/FS at an ASI level would be a rules violation.
  // 5e has no category field — show every feat.
  const is55e = edition === '5.5e'
  const totalLevel = (levelContext?.classLevel || 0)  // approximation; full multiclass sum lives on character
  const categoryFiltered = useMemo(() => {
    if (!is55e) return feats
    return feats.filter(f => {
      const cat = (f.category || 'G').toUpperCase()
      if (cat === 'O') return false                                    // Origin only at character creation
      if (cat.startsWith('FS')) return false                            // Fighting-style picker handled elsewhere
      if (cat === 'EB' && totalLevel < 19) return false                 // Epic Boon at total level 19+
      return true                                                       // G + anything not classified
    })
  }, [feats, is55e, totalLevel])
  const filtered=useMemo(()=>!search.trim()?categoryFiltered:categoryFiltered.filter(f=>f.name.toLowerCase().includes(search.toLowerCase())),[categoryFiltered,search])
  const sel=draft.featEntry
  const detail=viewing||(sel?categoryFiltered.find(f=>f.name===sel.name):null)

  function selectFeat(feat) {
    if(sel?.name===feat.name) { setDraft(d=>({...d,featEntry:null,featAB:{},featCh:{}})); return }
    // Pre-apply any FIXED ability bonuses the feat's data declares
    // (`ability: [{con:1}]`-style entries). Without this only the
    // `choose` entries went through the half-feat picker — fixed
    // bonuses like Tough's +1 CON or Athlete's +1 STR were silently
    // dropped. Parsed at select-time so they're always present on
    // the draft regardless of which choose-entries the player picks.
    const fixedBonus = {}
    for (const entry of (feat.ability || [])) {
      if (!entry || typeof entry !== 'object' || entry.choose) continue
      for (const [k, v] of Object.entries(entry)) {
        if (typeof v === 'number') fixedBonus[k] = (fixedBonus[k] || 0) + v
      }
    }
    setDraft(d=>({
      ...d,
      featEntry: {
        featId: feat.name, name: feat.name, source: feat.source,
        abilityBonus: { ...fixedBonus },
        _fixedAbilityBonus: { ...fixedBonus },
        choices: {}, additionalSpells: feat.additionalSpells || [],
      },
      featAB: {},
      featCh: {},
    }))
  }

  // Resolve optfeature options for feat choices (like Step6 FeatOptChoicePicker)
  const resolvedDescs = useMemo(() => {
    if (!detail) return []
    const descs = parseFeatChoices(detail).filter(d => ['optfeature','variant'].includes(d.type))
    return descs.map(d => {
      if (d.type === 'optfeature' && d.options === null && optF.length > 0) {
        const opts = optF
          .filter(of => of.featureType?.some(t => d.filter?.featureTypes?.includes(t)))
          .map(of => ({
            value: of.name, label: of.name,
            description: (of.entries||[]).find(e => typeof e === 'string')?.slice(0,160) || '',
            meta: { source: of.source },
          }))
        return { ...d, options: opts }
      }
      return d
    })
  }, [detail, optF])

  // Parse feat additionalSpells for choose entries (Fey Touched, Shadow Touched, Magic Initiate, etc.)
  const featSpellPickers = useMemo(() => {
    if (!sel || !sel.additionalSpells?.length || !allSp?.length) return []
    const pickers = []
    for (const block of sel.additionalSpells) {
      if (!block || typeof block !== 'object') continue
      for (const grantType of ['known', 'innate', 'prepared']) {
        const td = block[grantType]
        if (!td || typeof td !== 'object') continue
        for (const [lvlKey, levelData] of Object.entries(td)) {
          const entries = Array.isArray(levelData) ? levelData : Object.values(levelData || {}).flat()
          for (const entry of entries) {
            if (!entry || typeof entry !== 'object' || !entry.choose) continue
            const chooseStr = typeof entry.choose === 'string' ? entry.choose : ''
            const count = entry.count || 1
            let filterLevel = null, filterClass = null, filterSchools = []
            for (const part of chooseStr.split('|')) {
              const [k, v] = part.split('=')
              if (k === 'level') filterLevel = parseInt(v)
              if (k === 'class') filterClass = v?.toLowerCase()
              // Schools can be semicolon-separated: "school=D;E" = Divination or Enchantment
              if (k === 'group' || k === 'school') {
                for (const s of (v || '').split(';')) if (s.trim()) filterSchools.push(s.trim().toLowerCase())
              }
            }
            let pool = allSp
            if (filterLevel !== null) pool = pool.filter(s => s.level === filterLevel)
            if (filterClass) pool = pool.filter(s => (s.classes || []).some(c => c.toLowerCase() === filterClass))
            if (filterSchools.length > 0) pool = pool.filter(s => {
              const school = (s.school || '').toLowerCase()
              const SCH_MAP = {a:'abjuration',c:'conjuration',d:'divination',e:'enchantment',v:'evocation',i:'illusion',n:'necromancy',t:'transmutation'}
              const fullSchool = SCH_MAP[school] || school
              return filterSchools.some(fs => fullSchool.startsWith(fs))
            })
            const label = filterLevel === 0 ? 'Cantrips' : `Level-${filterLevel || '?'} Zauber`
            pickers.push({ id: `${sel.name}_${pickers.length}`, count, pool, label, filterClass })
          }
        }
      }
    }
    return pickers
  }, [sel, allSp])

  // Feat spell choices stored in draft.featCh._spells = { pickerId: [spellName, ...] }
  const featSpells = draft.featCh._spells || {}

  return (
    <div style={fS.layout}>
      <div style={fS.left}>
        <input style={fS.search} placeholder="Feat suchen…" value={search} onChange={e=>setSearch(e.target.value)} />
        <div style={fS.list}>{filtered.map(f=>{const isSel=sel?.name===f.name,isView=viewing?.name===f.name
          return<div key={f.id} style={{...fS.item,...(isSel?fS.itemSel:isView?fS.itemView:{})}} onClick={()=>setViewing(f)}>
            <div style={{color:isSel?'var(--accent)':'var(--text-primary)',fontWeight:'bold',fontSize:13}}>{isSel&&'✓ '}{f.name}</div>
            <div style={{color:'var(--text-muted)',fontSize:11}}>{f.source}</div></div>})}</div>
      </div>
      <div style={fS.right}>
        {detail?(<>
          <div style={fS.detailScroll}>
            <div style={{color:'var(--accent)',fontSize:18,fontWeight:'bold',marginBottom:4}}>{detail.name}</div>
            <div style={{color:'var(--text-muted)',fontSize:12,marginBottom:12}}>{detail.source}</div>
            <EntryRenderer entries={detail.entries} />

            {/* Feat choices — resolved with optfeature options */}
            {resolvedDescs.length>0&&<div style={{marginTop:12,padding:'10px 12px',background:'var(--bg-elevated)',borderRadius:8,border:'1px solid var(--border)'}}>
              <div style={{color:'var(--accent)',fontSize:13,fontWeight:'bold',marginBottom:10}}>Feat-Auswahl:</div>
              {resolvedDescs.map(d=><div key={d.id} style={{marginBottom:12}}>
                <ChoicePicker descriptor={d} value={draft.featCh[d.id]??null}
                  onChange={val=>setDraft(dr=>({...dr,featCh:{...dr.featCh,[d.id]:val}}))}
                  options={d.options} />
              </div>)}
            </div>}

            {/* Feat spell choices (Fey Touched, Shadow Touched, Magic Initiate, etc.) */}
            {sel?.name===detail.name && featSpellPickers.length>0 && (
              <div style={{marginTop:12}}>
                {featSpellPickers.map(picker => {
                  const selected = featSpells[picker.id] || []
                  return (
                    <div key={picker.id} style={{padding:'10px 12px',background:'var(--bg-inset)',borderRadius:8,border:'1px solid var(--border)',marginBottom:8}}>
                      <div style={{color:'var(--accent)',fontSize:13,fontWeight:'bold',marginBottom:6}}>
                        {picker.label} wählen ({selected.length}/{picker.count})
                        {picker.filterClass && <span style={{color:'var(--text-muted)',fontWeight:'normal',marginLeft:8}}>
                          — {picker.filterClass.charAt(0).toUpperCase()+picker.filterClass.slice(1)}-Liste
                        </span>}
                      </div>
                      <UniversalSpellList
                        spells={picker.pool} selected={selected} max={picker.count}
                        onToggle={sp => {
                          const has = selected.includes(sp.name)
                          const next = has ? selected.filter(n=>n!==sp.name) : selected.length<picker.count ? [...selected, sp.name] : selected
                          setDraft(d => ({...d, featCh:{...d.featCh, _spells:{...d.featCh._spells||{}, [picker.id]:next}}}))
                        }}
                        grantedSpells={{}} />
                    </div>
                  )
                })}
              </div>
            )}

            {/* Half-feat ability picker (data-driven) ──
                5etools `ability` arrays are a sequence of entries; each
                entry can be a fixed map (`{con:1}`) or a `choose`
                descriptor. Fixed entries are written straight onto the
                feat at select-time (see selectFeat); this block renders
                a per-`choose` picker for the rest. `choose.amount` is
                the value-per-pick (defaults 1, +2 for the ASI feat).
                `choose.count` would be picks-allowed (defaults 1 — no
                feat currently uses >1 but we read it for forward
                compatibility). */}
            {detail.ability?.length>0&&detail.ability.some(e=>e.choose)&&(
              <div style={{marginTop:12,padding:'10px 12px',background:'var(--bg-inset)',borderRadius:8,border:'1px solid var(--border)'}}>
                {detail.ability.map((entry, idx) => {
                  if (!entry?.choose) return null
                  const from = entry.choose.from || ABILITIES
                  const count = entry.choose.count || 1
                  const amount = entry.choose.amount || 1
                  const key = `_c${idx}`
                  const picksForThis = draft.featAB[key] || {}
                  const pickedCount = Object.keys(picksForThis).length
                  return (
                    <div key={idx} style={{marginBottom:8}}>
                      <div style={{color:'var(--text-secondary)',fontSize:12,fontWeight:'bold',marginBottom:6}}>
                        Ability Score (+{amount}{count > 1 ? `, ${pickedCount}/${count} gewählt` : ''}):
                      </div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {from.map(ab=>{
                          const isPicked = !!picksForThis[ab]
                          return (
                            <button key={ab} style={{...S.miniChip,borderColor:isPicked?'var(--accent)':'var(--border)',color:isPicked?'var(--accent)':'var(--text-muted)'}}
                              onClick={()=>setDraft(d => {
                                const groups = { ...d.featAB }
                                const cur = { ...(groups[key] || {}) }
                                if (cur[ab]) delete cur[ab]
                                else if (Object.keys(cur).length < count) cur[ab] = amount
                                groups[key] = cur
                                // Flatten fixed-from-data + per-choose
                                // groups into the featEntry.abilityBonus
                                // map the rules engine consumes.
                                const flat = { ...(d.featEntry?._fixedAbilityBonus || {}) }
                                for (const [, g] of Object.entries(groups)) {
                                  if (g && typeof g === 'object' && !Array.isArray(g)) {
                                    for (const [a, v] of Object.entries(g)) {
                                      flat[a] = (flat[a] || 0) + v
                                    }
                                  }
                                }
                                const fe = d.featEntry ? { ...d.featEntry, abilityBonus: flat } : d.featEntry
                                return { ...d, featAB: groups, featEntry: fe }
                              })}>
                              {ab.toUpperCase()}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>)}
          </div>
          <div style={fS.footer}><button style={{...fS.selectBtn,...(sel?.name===detail.name?fS.selectBtnAct:{})}}
            onClick={()=>selectFeat(detail)}>{sel?.name===detail.name?'✓ Gewählt':'Wählen'}</button></div>
        </>):<div style={fS.empty}>← Wähle ein Feat</div>}
      </div>
    </div>)
}

// ═══════ SHARED COMPONENTS ═══════════════════════════════════════════════════

function Badge({ label, value, color }) {
  return <div style={{background:'var(--bg-highlight)',borderRadius:6,padding:'4px 10px'}}>
    <div style={{color:'var(--text-muted)',fontSize:10}}>{label}</div>
    <div style={{color:color||'var(--text-primary)',fontWeight:'bold',fontSize:13}}>{value}</div></div>
}

function FeatureTable({ cd, hl, open }) {
  if(!cd?.featuresPerLevel)return null
  return(<details style={{marginTop:4}} open={open}>
    <summary style={{color:'var(--text-muted)',fontSize:12,cursor:'pointer'}}>Alle Features (1–20)</summary>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,marginTop:8}}>
      <thead><tr><th style={tS.th}>Lv</th><th style={tS.th}>Features</th></tr></thead>
      <tbody>{Array.from({length:20},(_,i)=>i+1).map(lv=>{
        const raw=cd.featuresPerLevel?.[lv]||[]
        const names=raw.map(f=>typeof f==='string'?f:f?.name||'').filter(Boolean)
        const isHL=lv===hl
        return<tr key={lv} style={{background:isHL?'var(--bg-highlight)':lv%2===0?'var(--bg-inset)':'transparent'}}>
          <td style={{...tS.td,color:isHL?'var(--accent-green)':'var(--accent)',fontWeight:'bold',width:30}}>{lv}</td>
          <td style={tS.td}>{names.length>0?<span style={{color:isHL?'var(--accent-green)':'var(--text-secondary)'}}>{names.join(', ')}</span>:<span style={{color: 'var(--text-dim)'}}>—</span>}
            {lv===cd.subclassLevel&&<span style={{color:'var(--accent-purple)',fontSize:10,marginLeft:6}}>[{cd.subclassTitle}]</span>}</td>
        </tr>})}</tbody></table></details>)
}

function SubclassCard({ sub, sel, onSel }) {
  const [exp,setExp]=useState(false)
  const lvls=Object.keys(sub.featuresPerLevel||{}).map(Number).sort((a,b)=>a-b)
  return(<div style={{...S.subCard,borderColor:sel?'var(--accent)':'var(--border)',background:sel?'var(--bg-highlight)':'var(--bg-card)',marginBottom:8}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <div><div style={{color:sel?'var(--accent)':'var(--text-primary)',fontWeight:'bold'}}>{sub.name}</div><div style={{color:'var(--text-muted)',fontSize:11}}>{sub.source}</div></div>
      <div style={{display:'flex',gap:8}}>
        <button style={S.smallBtn} onClick={e=>{e.stopPropagation();setExp(!exp)}}>{exp?'▲':'▼'}</button>
        <button style={{...S.smallBtn,...(sel?{border:'1px solid var(--accent)',color:'var(--accent)'}:{})}} onClick={onSel}>{sel?'✓':'Wählen'}</button></div></div>
    {exp&&lvls.length>0&&<table style={{width:'100%',borderCollapse:'collapse',fontSize:12,marginTop:10}}>
      <thead><tr><th style={tS.th}>Lv</th><th style={tS.th}>Feature</th><th style={tS.th}>Beschreibung</th></tr></thead>
      <tbody>{lvls.map(lv=>(sub.featuresPerLevel[lv]||[]).map((feat,fi)=>(
        <tr key={`${lv}-${fi}`} style={{background:lv%2===0?'var(--bg-inset)':'transparent'}}>
          {fi===0&&<td style={{...tS.td,verticalAlign:'top',color:'var(--accent)',fontWeight:'bold'}} rowSpan={sub.featuresPerLevel[lv].length}>{lv}</td>}
          <td style={{...tS.td,color:'var(--text-primary)',fontWeight:'bold',whiteSpace:'nowrap'}}>{feat.name}</td>
          <td style={tS.td}><FE entries={feat.entries} /></td></tr>)))}</tbody></table>}</div>)
}
// Skip "<ordinal>-level <X> feature" header lines (TCE-era pattern)
// so subclass-feature summaries show the real description text, not
// the level-tag echo.
function FE({entries}){
  for(const e of(entries||[])){
    if(typeof e==='string'&&e.length>5){
      const t=parseTags(e).trim()
      if(/^\d+(?:st|nd|rd|th)-level\s+.+\s+feature\.?$/i.test(t)) continue
      return<span style={{color:'var(--text-muted)',fontSize:12}}>{t.slice(0,160)}{t.length>160?'…':''}</span>
    }
    if(e?.entries){
      const child=<FE entries={e.entries} />
      // Only descend if the child actually produced content.
      if(child) return child
    }
  }
  return<span style={{color:'var(--text-dim)'}}>—</span>
}

// ═══════ STYLES ══════════════════════════════════════════════════════════════
const tS={th:{background:'var(--bg-elevated)',color:'var(--accent)',padding:'6px 10px',textAlign:'left',fontSize:11},td:{color:'var(--text-secondary)',padding:'5px 10px',fontSize:12}}
const fS={layout:{display:'grid',gridTemplateColumns:'260px 1fr',border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',height:400},left:{borderRight:'1px solid var(--border)',display:'flex',flexDirection:'column',background:'var(--bg-card)',overflow:'hidden'},search:{margin:10,padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg-surface)',color:'var(--text-primary)',fontSize:13,flexShrink:0},list:{flex:1,overflowY:'auto',padding:'0 6px 6px'},item:{padding:'8px 10px',borderRadius:7,cursor:'pointer',marginBottom:2,border:'1px solid transparent'},itemSel:{background:'var(--bg-highlight)',border:'1px solid var(--accent)'},itemView:{background:'var(--bg-hover)',border:'1px solid var(--border)'},right:{display:'flex',flexDirection:'column',background:'var(--bg-panel)',overflow:'hidden'},detailScroll:{flex:1,overflowY:'auto',padding:16},footer:{flexShrink:0,padding:'12px 16px',borderTop:'1px solid var(--border)',background:'var(--bg-card)'},selectBtn:{width:'100%',padding:10,borderRadius:8,border:'2px solid var(--accent)',background: 'transparent',color:'var(--accent)',fontSize:14,fontWeight:'bold',cursor:'pointer'},selectBtnAct:{background:'var(--accent)',color:'var(--bg-deep)'},empty:{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--border)',fontSize:13}}
const S={page:{minHeight:'100vh',background:'var(--bg-page)',display:'flex',flexDirection:'column'},header:{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 20px',background:'var(--bg-surface)',borderBottom:'1px solid var(--border)'},headerTitle:{color:'var(--accent)',fontSize:18,margin:0},backBtn:{padding:'6px 14px',borderRadius:6,border:'1px solid var(--border)',background: 'transparent',color:'var(--text-muted)',cursor:'pointer',fontSize:13},levelBadge:{background:'var(--bg-highlight)',border:'1px solid var(--border)',borderRadius:6,padding:'4px 10px',color:'var(--accent)',fontWeight:'bold',fontSize:13},stepBar:{display:'flex',justifyContent:'center',gap:16,padding:'12px 20px',background:'var(--bg-surface)',borderBottom:'1px solid var(--border-subtle)',flexWrap:'wrap'},stepDot:{display:'flex',alignItems:'center',borderRadius:999,padding:'4px 12px',fontSize:11,fontWeight:'bold',userSelect:'none'},content:{flex:1,padding:'24px 20px',overflowY:'auto'},footer:{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 20px',background:'var(--bg-surface)',borderTop:'1px solid var(--border)'},navBtn:{padding:'10px 20px',borderRadius:8,border:'1px solid var(--border)',background: 'transparent',color:'var(--text-muted)',cursor:'pointer',fontSize:14},navPri:{border:'2px solid var(--accent)',color:'var(--accent)',fontWeight:'bold'},errorBar:{position:'fixed',bottom:60,left:'50%',transform:'translateX(-50%)',background:'var(--accent-red)',color:'var(--text-primary)',padding:'8px 20px',borderRadius:8,fontSize:13,zIndex:100},loading:{color:'var(--accent)',textAlign:'center',padding:80,fontSize:16},center:{textAlign:'center',padding:40},secTitle:{color:'var(--accent)',fontSize:18,fontWeight:'bold',marginBottom:8,marginTop:0},card:{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:12,padding:20,marginBottom:16},cardTitle:{color:'var(--accent)',fontWeight:'bold',fontSize:14,marginBottom:10},classCard:{background:'var(--bg-elevated)',border:'2px solid var(--border)',borderRadius:10,padding:'14px 16px',cursor:'pointer'},hitDieBadge:{background:'var(--bg-deep)',border:'1px solid var(--accent-red)',borderRadius:6,padding:'2px 8px',color:'var(--accent-red)',fontWeight:'bold',fontSize:12},featureTag:{display:'inline-block',background:'var(--bg-highlight)',border:'1px solid var(--border)',borderRadius:4,padding:'2px 8px',fontSize:11,color:'var(--text-secondary)'},addClassBtn:{width:'100%',padding:14,borderRadius:10,border:'2px dashed var(--border)',background: 'transparent',color:'var(--text-muted)',cursor:'pointer',fontSize:14},closeBtn:{padding:'4px 10px',borderRadius:6,border:'1px solid var(--border)',background: 'transparent',color:'var(--text-muted)',cursor:'pointer',fontSize:12},undoCard:{display:'flex',justifyContent:'space-between',alignItems:'center',background:'var(--bg-card)',border:'1px solid var(--accent-red)',borderRadius:10,padding:'12px 16px',marginTop:20},undoBtn:{padding:'6px 14px',borderRadius:6,border:'1px solid var(--accent-red)',background: 'transparent',color:'var(--accent-red)',cursor:'pointer',fontSize:12},subCard:{border:'1px solid',borderRadius:8,padding:'10px 14px',cursor:'pointer'},smallBtn:{padding:'4px 10px',borderRadius:6,border:'1px solid var(--border)',background: 'transparent',color:'var(--text-muted)',cursor:'pointer',fontSize:11},optBtn:{padding:'8px 16px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg-elevated)',color:'var(--text-muted)',cursor:'pointer',fontSize:13},optAct:{border:'1px solid var(--accent)',color:'var(--accent)',background:'var(--bg-highlight)'},rollInput:{width:70,padding:8,borderRadius:6,border:'1px solid var(--border)',background:'var(--bg-surface)',color:'var(--text-primary)',fontSize:14,textAlign:'center'},abilChip:{border:'1px solid',borderRadius:8,padding:'8px 14px',minWidth:60,textAlign:'center',cursor:'pointer',background:'var(--bg-card)'},miniChip:{border:'1px solid',borderRadius:6,padding:'4px 10px',background: 'transparent',cursor:'pointer',fontSize:12,fontWeight:'bold'},summaryRow:{display:'flex',justifyContent:'space-between',background:'var(--bg-elevated)',borderRadius:8,padding:'10px 14px',border:'1px solid var(--border)'},filterBtn:{padding:'4px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg-elevated)',color:'var(--text-muted)',cursor:'pointer',fontSize:11},filterAct:{border:'1px solid var(--accent)',color:'var(--accent)',background:'var(--bg-highlight)'}}
