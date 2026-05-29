import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from '../lib/hashNav'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n'
import { computeCharacter, computeAbilityScores, computeModifiers } from '../lib/rulesEngine'
import { getProficiencyBonus, getTotalLevel } from '../lib/characterModel'
import { loadClassData, loadItemIndex, loadRaceList } from '../lib/dataLoader'
// foundryExport is huge (~3000 lines of stat-block / item / spell
// converters) and only runs when the user clicks "Foundry Export".
// Defer the import to click time so the initial sheet bundle stays small.
const importFoundryExport = () => import('../lib/foundryExport')
import { parseTags } from '../lib/tagParser'
import { undoLastLevelUp } from '../lib/levelUpEngine'
import { getEffectsForSlot } from '../lib/featureEffects'
import { FeatureNoteList } from '../components/sheet/SheetKit'
import { patchCombatState } from '../lib/campaigns'
import HeaderButtons from '../components/ui/HeaderButtons'
import { lazy, Suspense } from 'react'
// CustomEditModal is opened ~rarely (Custom button); split it off so the
// rules-engine that drives it doesn't sit in the initial sheet bundle.
const CustomEditModal = lazy(() => import('../components/ui/CustomEditModal'))
import usePwaMobile from '../../../../shared/hooks/usePwaMobile'
import { ActionSheet } from '../../../../shared/ui'
import { SideSection, ProfBlock, SenseRow } from '../components/sheet/SheetKit'
import { S } from '../components/sheet/sheetStyles'
import OverviewTab from '../components/sheet/OverviewTab'
import SpellsTab from '../components/sheet/SpellsTab'
import InventoryTab from '../components/sheet/InventoryTab'
import FeaturesTab from '../components/sheet/FeaturesTab'
import PersonalityTab from '../components/sheet/PersonalityTab'
import { modStr, formatToolName, formatSkillName } from '../lib/sheetUtils'
import './CharacterSheetPage.css'

const TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'spells',      label: 'Spells' },
  { id: 'inventory',   label: 'Inventory' },
  { id: 'features',    label: 'Features' },
  { id: 'personality', label: 'Personality' },
]

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function CharacterSheetPage({ session, readOnly = false, characterId, campaignId, fromSession = false }) {
  const params = useParams()
  const id = characterId || params.id
  // Sheet opened from the GM session overview should return there rather than
  // to the campaign detail — keeps the GM in their session flow.
  const backTo = readOnly && campaignId
    ? (fromSession ? `/campaign/${campaignId}/session` : `/campaign/${campaignId}`)
    : '/'
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [character, setCharacter] = useState(null)
  const [computed, setComputed] = useState(null)
  // classDataMap is keyed by classId and holds the raw 5etools class
  // payload (incl. classTableGroups). The rules engine reads scaling
  // resource counts (e.g. 5.5e Fighter "Second Wind" → 2/3/4 by level)
  // straight from those tables, so until this is loaded the resource
  // panel falls back to the pre-2024 single-use behaviour.
  const classDataMapRef = useRef({})
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  // Concentration-save prompt: { damage, dc } when the player has just
  // taken damage while concentrating. Player-side only — readOnly GM
  // view skips this entirely.
  const [concSavePrompt, setConcSavePrompt] = useState(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showCustomEdit, setShowCustomEdit] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const { isPwaMobile } = usePwaMobile()
  const saveTimer = useRef(null)
  const portraitRef = useRef(null)

  useEffect(() => { loadCharacter() }, [id])
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  // Realtime: pull GM-side combat-state writes (and any other client's
  // patches) onto this sheet without a manual refresh. The GM session
  // already listens the other way; this is the mirror channel so
  // toggling a condition on the session card lights up on the player
  // sheet within the realtime tick. We only merge `data.status`, the
  // same whitelist the patchCombatState RPC enforces — wholesale row
  // replacement here would clobber any unsaved local edits.
  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`dnd-character:${id}`)
      .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'dnd_characters',
            filter: `id=eq.${id}` },
          (payload) => {
            const row = payload?.new
            const nextStatus = row?.data?.status
            if (!nextStatus) return
            setCharacter(prev => {
              if (!prev) return prev
              // Skip if the incoming status matches what we already have —
              // realtime echoes our own writes back to us and re-setting
              // would trigger a redundant recompute + computed flash.
              if (JSON.stringify(prev.status) === JSON.stringify(nextStatus)) return prev
              const next = { ...prev, status: nextStatus }
              setComputed(computeCharacter(next, classDataMapRef.current))
              return next
            })
          })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id])

  // Load every class file the character uses (5etools payloads, with
  // classTableGroups in 5.5e), stash the result in the ref, and trigger
  // a recompute so resource panels pick up the table values. Cheap on
  // re-load thanks to dataLoader's module-level fetch cache.
  async function hydrateClassDataAndRecompute(charData) {
    const edition = charData?.meta?.edition || '5e'
    const classes = (charData?.classes || []).map(c => c.classId).filter(Boolean)
    const unique = [...new Set(classes)]
    const loaded = await Promise.all(unique.map(id => loadClassData(edition, id).catch(() => null)))
    const map = {}
    unique.forEach((cid, i) => { if (loaded[i]) map[cid] = loaded[i] })
    classDataMapRef.current = map
    // Backfill the spellcasting fields onto cls entries that were
    // saved before loadClassList consistently forwarded them. Without
    // this, multiclass Rangers / Paladins / Wizards / etc. created
    // by an older build show "Spellcasting / Class" stats but no
    // Prepare section (because casterProgression is missing on the
    // cls and computeSpellSlots can't tell what progression to use).
    if (!readOnly) backfillClassSpellcastingFields(charData, map).catch(() => {})
    // Hydrate race trait names *and* entries from the 5etools race
    // data so:
    //   • the featureEffects catalog can detect Fey Ancestry / Brave /
    //     Dwarven Resilience / Darkvision / Hellish Resistance / etc.
    //     by trait name without a hardcoded race→features map, and
    //   • the dynamic scanner in featureEffects can emit a generic
    //     hint for any trait the catalog hasn't translated yet.
    // Stored as transient __trait* hints on character.species —
    // queueSave strips both before persisting so they don't bloat the
    // Supabase row.
    const { names: traitNames, traits: rawTraits } =
      await loadRaceTraits(edition, charData)
    // Collect active class + subclass feature entries (Fighting
    // Style picks, subclass abilities like Otherworldly Glamour,
    // class-feature text the catalog hasn't translated yet). Same
    // contract as race traits: the synthesizer scans them for
    // advantage / resistance / "bonus equal to your X modifier" /
    // skill-proficiency-choice phrasings and surfaces inline notes.
    const activeFeatures = collectActiveClassFeatures(charData, map)
    // Always-prepared spells granted by structured class /
    // subclass `additionalSpells.prepared` data — Cleric domain
    // spells, Paladin oath spells, Warlock patron spells, etc.
    // (Text-based grants like the Ranger Hunter's Mark are picked
    // up by the regex scanner in collectCharacterSpells; this
    // covers the table-shaped grants.)
    const grantedSpells = collectClassGrantedSpells(charData, map)
    if (traitNames.length > 0 || activeFeatures.length > 0 || grantedSpells.length > 0) {
      const speciesPatch = traitNames.length > 0
        ? { __traitNames: traitNames, __traits: rawTraits }
        : {}
      setCharacter(prev => prev ? ({
        ...prev,
        species: { ...(prev.species || {}), ...speciesPatch },
        __activeFeatures: activeFeatures,
        __grantedSpells: grantedSpells,
      }) : prev)
      charData = {
        ...charData,
        species: { ...(charData.species || {}), ...speciesPatch },
        __activeFeatures: activeFeatures,
        __grantedSpells: grantedSpells,
      }
    }
    setComputed(computeCharacter(charData, map))
    // Backfill mastery + entries on weapons already in the inventory.
    // Characters created before the dataLoader started preserving these
    // fields have weapons without `mastery` / `entries`, which makes
    // them silently miss in the sheet's attack badges, mastery picker,
    // and item description panel. We patch in place exactly once and
    // persist the result so the next open is clean.
    if (!readOnly) backfillItemMetadata(edition, charData).catch(() => {})
  }

  // Heal cls entries that lack the spellcasting metadata
  // (`casterProgression`, `spellcastingAbility`, `isSpellcaster`) the
  // sheet relies on for spell slot / preparation logic. Earlier
  // builds saved multiclass entries with these fields undefined
  // because loadClassList didn't always forward them; without the
  // backfill, computeSpellSlots falls into the default branch and
  // produces no slots → no Prepare button.
  async function backfillClassSpellcastingFields(charData, classDataMap) {
    if (!charData?.classes?.length) return false
    let needsPatch = false
    for (const cls of charData.classes) {
      const cd = classDataMap[cls.classId]
      if (!cd) continue
      if (!cls.casterProgression && cd.casterProgression) { needsPatch = true; break }
      if (!cls.spellcastingAbility && cd.spellcastingAbility) { needsPatch = true; break }
    }
    if (!needsPatch) return false
    applyCharacter(d => {
      for (const cls of (d.classes || [])) {
        const cd = classDataMap[cls.classId]
        if (!cd) continue
        if (!cls.casterProgression && cd.casterProgression) cls.casterProgression = cd.casterProgression
        if (!cls.spellcastingAbility && cd.spellcastingAbility) {
          cls.spellcastingAbility = cd.spellcastingAbility
          if (cls.isSpellcaster == null) cls.isSpellcaster = true
        }
      }
    }, { changedPaths: ['classes'] })
    return true
  }

  // Walks the inventory once, fills missing mastery / entries from the
  // edition's item catalog, and saves if anything changed. Cheap if
  // there's nothing to fix — the catalog fetch is cached and we bail
  // before triggering a state update when no items are stale, so we
  // don't write back to Supabase on every load. Operates on the
  // `charData` snapshot passed in (the version that triggered the
  // hydrate), not the React state, to avoid stale-closure reads.
  async function backfillItemMetadata(edition, charData) {
    const items = await loadItemIndex(edition).catch(() => [])
    if (!items || items.length === 0) return false
    const byName = new Map()
    for (const it of items) {
      const k = it.name?.toLowerCase()
      if (!k) continue
      if (!byName.has(k)) byName.set(k, it)
    }
    const lists = [charData?.inventory?.items, charData?.custom?.items].filter(Array.isArray)
    let needsPatch = false
    outer: for (const list of lists) {
      for (const w of list) {
        if (!w?.name) continue
        const ref = byName.get(w.name.toLowerCase())
        if (!ref) continue
        const wantsMastery = ref.isWeapon && Array.isArray(ref.mastery) && ref.mastery.length > 0
          && !(Array.isArray(w.mastery) && w.mastery.length > 0)
        const wantsEntries = Array.isArray(ref.entries) && ref.entries.length > 0
          && !(Array.isArray(w.entries) && w.entries.length > 0)
        if (wantsMastery || wantsEntries) { needsPatch = true; break outer }
      }
    }
    if (!needsPatch) return false
    applyCharacter(d => {
      const draftLists = [d.inventory?.items, d.custom?.items].filter(Array.isArray)
      for (const list of draftLists) {
        for (const w of list) {
          if (!w?.name) continue
          const ref = byName.get(w.name.toLowerCase())
          if (!ref) continue
          if (ref.isWeapon && Array.isArray(ref.mastery) && ref.mastery.length > 0
              && !(Array.isArray(w.mastery) && w.mastery.length > 0)) {
            w.mastery = ref.mastery.slice()
          }
          if (Array.isArray(ref.entries) && ref.entries.length > 0
              && !(Array.isArray(w.entries) && w.entries.length > 0)) {
            w.entries = ref.entries
          }
        }
      }
    }, { changedPaths: ['inventory.items', 'custom.items'] })
    return true
  }

  // Walk every class entry on the character and return the active
  // class + subclass features ({name, entries, classId, level}) for
  // levels ≤ the character's current level in that class. Feeds the
  // featureEffects synthesizer so subclass abilities like
  // Otherworldly Glamour (Fey Wanderer L3) light up as inline notes
  // on the sheet without per-feature hardcoding in the catalog.
  function collectActiveClassFeatures(charData, classDataMap) {
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
    for (const cls of (charData?.classes || [])) {
      const cd = classDataMap[cls.classId]
      if (!cd) continue
      // Class features (gained automatically by class level).
      for (const f of (cd.features || [])) {
        if (!f?.name) continue
        const lvl = f.level || 1
        if (lvl > cls.level) continue
        if (f.isClassFeatureVariant) continue
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
      const sub = (cd.subclasses || []).find(s => s.id === subId || s.name === subId)
      if (!sub) continue
      if (Array.isArray(sub.features)) {
        for (const f of sub.features) {
          if (!f?.name) continue
          const lvl = f.level || 1
          if (lvl > cls.level) continue
          if (f.isClassFeatureVariant) continue
          push({ classId: cls.classId, source: 'subclass', subclassId: subId, name: f.name, level: lvl, entries: f.entries || [] }, f.source)
        }
      }
      if (sub.featuresPerLevel) {
        for (const [lvlStr, feats] of Object.entries(sub.featuresPerLevel)) {
          const lvl = parseInt(lvlStr, 10)
          if (!Number.isFinite(lvl) || lvl > cls.level) continue
          for (const f of (feats || [])) {
            if (!f?.name) continue
            push({ classId: cls.classId, source: 'subclass', subclassId: subId, name: f.name, level: lvl, entries: f.entries || [] }, f.source)
          }
        }
      }
    }
    for (const v of byKey.values()) out.push(v.entry)
    return out
  }

  // Walk class + subclass `additionalSpells.prepared` tables and
  // return the spells the character has unlocked at their current
  // class level. Output shape: `[{name, classId, sourceFeature}]`.
  // The character-level keyed table is filtered against `cls.level`,
  // so a Cleric 1 Twilight gets the L1 row and a Cleric 5 gets L1+3+5.
  function collectClassGrantedSpells(charData, classDataMap) {
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
      const sub = (cd.subclasses || []).find(s => s.id === subId || s.name === subId)
      if (sub) consumeAdditional(sub.additionalSpells, cls.level, cls.classId, subId)
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
  async function loadRaceTraits(edition, charData) {
    const raceId = charData?.species?.raceId
    if (!raceId) return { names: [], traits: [] }
    const races = await loadRaceList(edition).catch(() => [])
    const race = races.find(r => r.id === raceId || r.name === raceId)
    if (!race) return { names: [], traits: [] }
    const sub = (race.subraces || []).find(s =>
      s.id === charData.species.subraceId || s.name === charData.species.subraceId
    )
    const allEntries = [...(race.entries || []), ...(sub?.entries || [])]
    const names = []
    const traits = []
    for (const e of allEntries) {
      if (!e || typeof e !== 'object' || !e.name) continue
      names.push(String(e.name))
      traits.push({ name: String(e.name), entries: Array.isArray(e.entries) ? e.entries : [] })
    }
    return { names, traits }
  }

  async function loadCharacter() {
    // Read-only (GM) load relies on RLS: the GM may SELECT member characters
    // but never filters by user_id. The owner path keeps the user_id filter.
    let query = supabase.from('dnd_characters').select('*').eq('id', id)
    if (!readOnly) query = query.eq('user_id', session.user.id)
    const { data, error } = await query.single()
    if (error || !data) { navigate(backTo); return }

    // Read-only viewers never touch the level-up backup machinery.
    if (readOnly) {
      setCharacter(data.data)
      setComputed(computeCharacter(data.data))
      setLoading(false)
      hydrateClassDataAndRecompute(data.data)
      return
    }

    // Restore an unsaved level-up backup if one is newer than the saved data.
    try {
      const backupKey = `dndbuilder_backup_${id}`
      const backupRaw = localStorage.getItem(backupKey)
      if (backupRaw) {
        const backup = JSON.parse(backupRaw)
        const backupLevel = (backup.updated?.classes || []).reduce((s, c) => s + (c.level || 0), 0)
        const savedLevel = (data.data.classes || []).reduce((s, c) => s + (c.level || 0), 0)
        if (backupLevel !== savedLevel && backup.updated) {
          const age = Date.now() - new Date(backup.timestamp).getTime()
          if (age < 24 * 60 * 60 * 1000) {
            const restore = window.confirm(
              `Ein nicht gespeichertes Level-Up wurde gefunden (${new Date(backup.timestamp).toLocaleString('de-DE')}).\n\n` +
              `Gespeichert: Level ${savedLevel}\nBackup: Level ${backupLevel}\n\nBackup wiederherstellen?`
            )
            if (restore) {
              const { error: restoreErr } = await supabase.from('dnd_characters')
                .update({ data: backup.updated, name: backup.updated.info.name })
                .eq('id', id).eq('user_id', session.user.id)
              if (!restoreErr) {
                localStorage.removeItem(backupKey)
                setCharacter(backup.updated)
                setComputed(computeCharacter(backup.updated))
                setLoading(false)
                hydrateClassDataAndRecompute(backup.updated)
                return
              }
            }
          }
          localStorage.removeItem(backupKey)
        } else {
          localStorage.removeItem(backupKey)
        }
      }
    } catch { /* localStorage unavailable */ }

    setCharacter(data.data)
    setComputed(computeCharacter(data.data))
    setLoading(false)
    hydrateClassDataAndRecompute(data.data)

    // One-time recompression for legacy oversized portraits. New uploads
    // are already compressed by handlePortrait, but characters created
    // before that change still carry multi-MB base64 blobs inside
    // dnd_characters.data.appearance.portrait — those blobs are pulled
    // on every row fetch (own sheet, GM session view, etc.) and were
    // the dominant payload cost. ~50KB base64 threshold roughly
    // corresponds to "bigger than a freshly compressed 256px JPEG".
    const portrait = data.data?.appearance?.portrait
    if (typeof portrait === 'string' && portrait.length > 50_000) {
      ;(async () => {
        try {
          const { compressDataUrl } = await import('../../../../shared/images/compressImage')
          const smaller = await compressDataUrl(portrait, { maxDim: 256, quality: 0.75 })
          if (smaller && smaller.length < portrait.length) {
            updateCharacter('appearance.portrait', smaller)
          }
        } catch { /* corrupted source — leave it alone */ }
      })()
    }
  }

  // ── Persistence ───────────────────────────────────────────
  // Debounced so rapid in-play edits collapse into a single Supabase
  // write. The whole `data` jsonb (10–50KB) goes up — fine for one-off
  // edits, but combat-state ticks (HP / conditions / death-saves) take
  // a much slimmer path below via the dnd_patch_combat_state RPC.
  function queueSave(next) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    // Strip any transient sheet-only hints we attached to the
    // character before persisting (currently just species.__traitNames
    // from hydrateClassDataAndRecompute). Keeping the row clean
    // prevents stale data from being trusted on next load and avoids
    // bloating the JSONB column.
    const cleanForSave = (data) => {
      const sp = data?.species || {}
      const stripped = { ...data }
      let touched = false
      if (sp.__traitNames || sp.__traits) {
        const { __traitNames, __traits, ...restSpecies } = sp
        stripped.species = restSpecies
        touched = true
      }
      if (stripped.__activeFeatures) {
        delete stripped.__activeFeatures
        touched = true
      }
      if (stripped.__grantedSpells) {
        delete stripped.__grantedSpells
        touched = true
      }
      return touched ? stripped : data
    }
    saveTimer.current = setTimeout(() => {
      const payload = cleanForSave(next)
      supabase.from('dnd_characters')
        .update({ data: payload, name: payload.info?.name || '' })
        .eq('id', id).eq('user_id', session.user.id)
        .then(({ error }) => { if (error) console.error('[Sheet Save]', error) })
    }, 700)
  }

  // Keys that go through the slim RPC path instead of saving the whole
  // character row. Same whitelist the SQL function (dnd_patch_combat_state)
  // enforces — keeps the two ends in lock-step. Anything in here also
  // propagates INSTANTLY to the GM session view via realtime; anything
  // not in here goes through the 700 ms full-row debounce.
  const COMBAT_STATE_KEYS = [
    'currentHp', 'temporaryHp', 'conditions', 'deathSaves',
    'concentration', 'economy', 'markedWeapons',
    'maxHpBonus', 'inspiration',
    'usedResources', 'usedSpellSlots', 'usedPactSlots', 'hitDiceUsed',
  ]

  // Apply an arbitrary mutation to a fresh draft, recompute, persist.
  // In read-only (GM) mode every mutation is a no-op.
  //
  // Routing:
  //   • Combat-state keys (HP / temp HP / conditions / death saves) →
  //     fire the slim patchCombatState RPC for instant cross-user sync.
  //   • Anything else → queue the 700ms full-row save.
  //   • If ONLY combat keys changed → skip the full save (RPC already
  //     covered it).
  //
  // `opts.changedPaths` is a hint of dotted paths the mutation touched.
  // When supplied we can skip the costly "is anything outside combat
  // different?" diff (used to JSON.stringify the whole 10-50 KB
  // character — measurable lag on every HP click). Callers that don't
  // know what they changed (rare — really only the level-up rollback
  // path) leave it off and we conservatively run a full save.
  function applyCharacter(mutator, opts = {}) {
    if (readOnly) return
    setCharacter(prev => {
      const next = structuredClone(prev)
      mutator(next)
      setComputed(computeCharacter(next, classDataMapRef.current))

      // Concentration-save trigger: any HP drop while a concentration
      // spell is active fires a prompt. DC = max(10, ⌊damage / 2⌋).
      // The prompt is dismissable and never auto-changes state by
      // itself — only the user's "Bestanden / Gescheitert" choice does.
      const prevHp = prev.status?.currentHp
      const nextHp = next.status?.currentHp
      const conc = next.status?.concentration
      if (
        conc && (conc.spell || conc.name)
        && typeof prevHp === 'number' && typeof nextHp === 'number'
        && nextHp < prevHp
      ) {
        const dmg = prevHp - nextHp
        const dc = Math.max(10, Math.floor(dmg / 2))
        setConcSavePrompt({ damage: dmg, dc, spell: conc.spell || conc.name })
      }

      // Combat-state diff is cheap (4 small keys) — always do this so
      // the RPC fires correctly even when no hint was provided.
      const prevStatus = prev.status || {}
      const nextStatus = next.status || {}
      const combatPatch = {}
      for (const k of COMBAT_STATE_KEYS) {
        if (prevStatus[k] !== nextStatus[k]
            && JSON.stringify(prevStatus[k]) !== JSON.stringify(nextStatus[k])) {
          combatPatch[k] = nextStatus[k]
        }
      }
      if (Object.keys(combatPatch).length > 0) {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        patchCombatState(id, combatPatch)
          .catch(e => console.warn('[combat patch]', e?.message || e))
      }

      // Decide whether to queue a full-row save.
      if (!opts.skipFullSave) {
        let needFullSave
        if (Array.isArray(opts.changedPaths)) {
          // Skip the full save iff every changed path is a combat key.
          needFullSave = opts.changedPaths.some(p => {
            if (!p.startsWith('status.')) return true
            const head = p.slice(7).split('.')[0]
            return !COMBAT_STATE_KEYS.includes(head)
          })
        } else {
          // No hint: be conservative and save. Rare path (level-up
          // rollback, etc.) — the cost of an extra full-row save here
          // is far less than the cost of a per-click stringify diff.
          needFullSave = true
        }
        if (needFullSave) queueSave(next)
      }
      return next
    })
  }

  // Set a single dotted path. Passes the path along so applyCharacter
  // can route combat-only writes through the RPC without doing a full
  // save.
  function updateCharacter(path, value) {
    const parts = path.split('.')
    applyCharacter(d => {
      let obj = d
      for (let i = 0; i < parts.length - 1; i++) {
        if (obj[parts[i]] == null || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {}
        obj = obj[parts[i]]
      }
      obj[parts[parts.length - 1]] = value
    }, { changedPaths: [path] })
  }

  // ── Rests ─────────────────────────────────────────────────
  function shortRest() {
    if (!window.confirm('Take a short rest? Restores Pact Magic slots and short-rest resources.')) return
    applyCharacter(d => {
      if (!d.status) d.status = {}
      d.status.usedPactSlots = 0
      const used = { ...(d.status.usedResources || {}) }
      for (const res of (computed?.resources || [])) {
        if (res.recharge === 'short_rest') delete used[res.id]
      }
      d.status.usedResources = used
    })
  }

  function longRest() {
    if (!window.confirm('Take a long rest? Restores HP, spell slots and all resources.')) return
    const maxHp = Math.max(1, (computed?.hp?.max || 1) + (character.status?.maxHpBonus || 0))
    applyCharacter(d => {
      if (!d.status) d.status = {}
      d.status.usedSpellSlots = {}
      d.status.usedPactSlots = 0
      d.status.usedResources = {}
      d.status.currentHp = maxHp
      d.status.temporaryHp = 0
      d.status.deathSaves = { successes: 0, failures: 0 }
      d.status.concentration = null
      d.status.economy = { action: false, bonusAction: false, reaction: false }
    })
  }

  // ── Portrait ──────────────────────────────────────────────
  // Portraits are stored as base64 data URLs in dnd_characters.data, so
  // raw 5MB uploads would blow up every row read. compressImage resizes
  // to 256px on the longer edge and re-encodes as JPEG quality 0.75 —
  // typically ~15KB regardless of the source.
  async function handlePortrait(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const { compressImage } = await import('../../../../shared/images/compressImage')
      const dataUrl = await compressImage(file, { maxDim: 256, quality: 0.75 })
      updateCharacter('appearance.portrait', dataUrl)
    } catch (err) {
      alert(err.message || 'Bild konnte nicht verarbeitet werden.')
    }
  }

  function commitName() {
    setEditingName(false)
    const v = nameDraft.trim()
    if (v && v !== character.info.name) updateCharacter('info.name', v)
  }

  // ── Level Down (unchanged behaviour) ──────────────────────
  async function levelDown() {
    const h = character.levelHistory || []
    const last = h[h.length - 1]
    if (!last?.snapshot) return
    const cls = character.classes.find(c => c.classId === last.classId)
    const lc = cls?.levelChoices?.[last.classLevel] || {}
    const parts = [`${last.classId} Lv.${last.classLevel}`]
    if (lc.type === 'asi') parts.push('ASI: ' + Object.entries(lc.improvements || {}).map(([k, v]) => `${k.toUpperCase()} +${v}`).join(', '))
    if (lc.type === 'feat') parts.push(`Feat: ${lc.featId}`)
    if (lc.cantrips?.length) parts.push(`${lc.cantrips.length} Cantrips`)
    if (lc.knownSpells?.length) parts.push(`${lc.knownSpells.length} Spells`)
    if (lc.optionalFeatures?.length) parts.push(lc.optionalFeatures.map(f => f.name).join(', '))
    for (const [fn, sp] of Object.entries(lc.optFeatureSpells || {})) { if (sp?.length) parts.push(`${fn}: ${sp.join(', ')}`) }
    if (!window.confirm(`Level Down rückgängig machen?\n\n${parts.join('\n')}`)) return

    const restored = undoLastLevelUp(character)
    if (!restored) { alert('Kein Snapshot verfügbar.'); return }
    if (character.appearance?.portrait)
      restored.appearance = { ...(restored.appearance || {}), portrait: character.appearance.portrait }

    try { localStorage.setItem(`dndbuilder_backup_${id}`, JSON.stringify({ timestamp: new Date().toISOString(), previous: character, updated: restored })) } catch { /* ignore */ }
    let saved = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error: e } = await supabase.from('dnd_characters').update({ data: restored, name: restored.info.name })
        .eq('id', id).eq('user_id', session.user.id)
      if (!e) { saved = true; break }
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500))
    }
    if (!saved) { alert('Level Down fehlgeschlagen. Dein Charakter ist lokal gesichert.'); return }
    try { localStorage.removeItem(`dndbuilder_backup_${id}`) } catch { /* ignore */ }
    loadCharacter()
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 80, fontSize: 16 }}>{t('loading')}</div>
  if (!character) return null

  const abilityScores = computeAbilityScores(character)
  const modifiers     = computeModifiers(abilityScores)
  const totalLevel    = getTotalLevel(character)
  const profBonus     = getProficiencyBonus(character)
  // Effective max HP = rules-engine max + a manual adjustment the player can
  // tweak on the sheet (magic items, Aid, DM rulings, …).
  const baseMaxHp     = computed?.hp?.max || 1
  const maxHpBonus    = character.status?.maxHpBonus || 0
  const effMaxHp      = Math.max(1, baseMaxHp + maxHpBonus)
  const hp            = {
    max: effMaxHp,
    current: character.status?.currentHp ?? effMaxHp,
    temporary: character.status?.temporaryHp || 0,
  }
  const ac            = computed?.ac?.total || 10
  const initiative    = computed?.initiative ?? modifiers.dex
  const speed         = computed?.speed?.walk || character.species?.speed || 30
  const raceName      = character.species.raceId?.split('__')[0] || '—'
  const subraceName   = character.species.subraceId?.split('__')[0] || ''
  const speciesDisplay = subraceName ? `${subraceName} (${raceName})` : raceName
  const className     = character.classes.map(c => `${c.classId} ${c.level}`).join(' / ')
  const portrait      = character.appearance?.portrait
  const inspiration   = character.status?.inspiration || character.info?.inspiration || false

  return (
    <div className="dnd-sheet-root" style={S.page}>
      <input ref={portraitRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePortrait} />

      {/* ═══ HEADER ═══ */}
      {isPwaMobile ? (
        <div data-pwa-target="dnd-sheet-header" style={S.headerMobile}>
          <button type="button" style={S.headerIconBtn} onClick={() => navigate(backTo)} aria-label="Zurück" title="Zurück">←</button>
          <div style={S.headerMobileTitle}>
            {portrait
              ? <img src={portrait} style={S.headerMobilePortrait} alt="" onClick={readOnly ? undefined : () => portraitRef.current?.click()} />
              : <div style={{ ...S.headerMobilePortrait, ...S.headerPortraitEmpty, width: 34, height: 34, fontSize: 14 }} onClick={readOnly ? undefined : () => portraitRef.current?.click()}>+</div>}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ ...S.headerName, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {character.info.name || 'Unbenannt'}
              </div>
              <div style={{ ...S.headerSubline, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {className} · L{totalLevel}{readOnly ? ' · Nur Lesen' : ''}
              </div>
            </div>
          </div>
          <button type="button" style={S.headerIconBtn} onClick={() => setShowMobileMenu(true)} aria-label="Optionen" title="Optionen">⋯</button>
        </div>
      ) : (
        <div data-pwa-target="dnd-sheet-header" style={S.header}>
          <button style={S.headerBackBtn} onClick={() => navigate(backTo)}>
            {readOnly && campaignId ? '← Campaign' : '← Dashboard'}
          </button>

          <div style={S.headerCenter}>
            {portrait
              ? <img src={portrait} style={S.headerPortrait} alt="Portrait" title={readOnly ? '' : 'Portrait ändern'} onClick={readOnly ? undefined : () => portraitRef.current?.click()} />
              : (readOnly
                  ? <div style={S.headerPortraitEmpty}>—</div>
                  : <div style={S.headerPortraitEmpty} title="Portrait hinzufügen" onClick={() => portraitRef.current?.click()}>+</div>)}
            <div style={{ minWidth: 0 }}>
              {readOnly ? (
                <div style={S.headerName}>{character.info.name || 'Unbenannt'}</div>
              ) : editingName ? (
                <input
                  autoFocus value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false) }}
                  style={S.headerNameInput}
                />
              ) : (
                <div style={{ ...S.headerName, cursor: 'pointer' }} title="Name ändern"
                  onClick={() => { setNameDraft(character.info.name || ''); setEditingName(true) }}>
                  {character.info.name || 'Unbenannt'} <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>✎</span>
                </div>
              )}
              <div style={S.headerSubline}>
                {speciesDisplay} · {className} · Level {totalLevel}
                {character.info.alignment && ` · ${character.info.alignment}`}
                {readOnly && <span style={{ color: 'var(--accent-yellow)' }}> · Spielleiter-Ansicht (Nur Lesen)</span>}
              </div>
            </div>
          </div>

          <div style={S.headerRight}>
            <div style={{ position: 'relative' }}>
              <button style={S.exportBtn} onClick={() => setShowExportMenu(v => !v)}>Export</button>
              {showExportMenu && (
                <div style={S.exportMenu}>
                  <button style={S.exportMenuItem}
                    onClick={async () => { const { downloadFoundryJSON } = await importFoundryExport(); await downloadFoundryJSON(character); setShowExportMenu(false) }}>
                    FoundryVTT (.json)
                  </button>
                </div>
              )}
            </div>
            {!readOnly && (
              <>
                <button style={S.levelUpBtn} onClick={() => navigate(`/character/${id}/levelup`)}>Level Up</button>
                <button style={{ ...S.headerBtn, borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}
                  onClick={() => setShowCustomEdit(true)}>Custom</button>
                {totalLevel === 1 && (
                  <button style={S.headerBtn} onClick={() => navigate(`/character/${id}/edit`)}>Bearbeiten</button>
                )}
                {(character.levelHistory || []).length > 0 && (
                  <button style={{ ...S.headerBtn, borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}
                    onClick={levelDown}>Level Down</button>
                )}
              </>
            )}
            <HeaderButtons session={session} />
          </div>
        </div>
      )}

      {/* Mobile overflow menu */}
      <ActionSheet
        open={showMobileMenu}
        onClose={() => setShowMobileMenu(false)}
        title={character.info.name || 'Charakter'}
        items={readOnly ? [
          { id: 'export', label: 'Foundry-Export', icon: '⬇',
            onSelect: async () => { const { downloadFoundryJSON } = await importFoundryExport(); await downloadFoundryJSON(character) } },
        ] : [
          { id: 'rename', label: 'Name ändern', icon: 'Aa',
            onSelect: () => {
              const v = window.prompt('Charaktername:', character.info.name || '')
              if (v != null && v.trim()) updateCharacter('info.name', v.trim())
            } },
          { id: 'portrait', label: 'Portrait ändern', icon: '▣',
            onSelect: () => portraitRef.current?.click() },
          { id: 'levelup', label: 'Level Up', icon: '＋',
            onSelect: () => navigate(`/character/${id}/levelup`) },
          { id: 'custom', label: 'Custom Edit', icon: '✦',
            onSelect: () => setShowCustomEdit(true) },
          ...(totalLevel === 1 ? [{
            id: 'edit', label: 'Bearbeiten', icon: '✎',
            onSelect: () => navigate(`/character/${id}/edit`),
          }] : []),
          { id: 'export', label: 'Foundry-Export', icon: '⬇',
            onSelect: async () => { const { downloadFoundryJSON } = await importFoundryExport(); await downloadFoundryJSON(character) } },
          ...((character.levelHistory || []).length > 0 ? [{
            id: 'leveldown', label: 'Level Down', icon: '↩', danger: true,
            onSelect: levelDown,
          }] : []),
        ]}
      />

      {showCustomEdit && (
        <Suspense fallback={null}>
          <CustomEditModal
            onClose={() => setShowCustomEdit(false)}
            character={character}
            updateCharacter={updateCharacter}
          />
        </Suspense>
      )}

      {/* ═══ CONCENTRATION-SAVE PROMPT ═══
          Fires after any HP drop while concentrating. Lets the player
          choose the save outcome — failing auto-clears concentration. */}
      {concSavePrompt && (
        <ConcentrationSavePrompt
          info={concSavePrompt}
          onSucceeded={() => setConcSavePrompt(null)}
          onFailed={() => {
            updateCharacter('status.concentration', null)
            setConcSavePrompt(null)
          }}
          onSkip={() => setConcSavePrompt(null)}
        />
      )}

      {/* ═══ COMBAT BAR ═══ */}
      <div style={S.combatBar}>
        <CombatStat label="Armor Class" value={ac} color="var(--accent-blue)" />
        <CombatStat label="Initiative" value={modStr(initiative)} color="var(--accent-purple)" />
        <CombatStat label="Speed" value={`${speed} ft.`} color="var(--accent-green)" />
        <CombatStat label="Hit Points" value={`${hp.current}/${hp.max}`} color="var(--accent-red)"
          sub={hp.temporary ? `+${hp.temporary} temp` : null} onClick={() => setActiveTab('overview')} />
        <CombatStat label="Proficiency" value={modStr(profBonus)} color="var(--accent-yellow)" />
        <CombatStat label="Passive Perception" value={computed?.passivePerception ?? 10} color="var(--text-muted)" />
      </div>

      {/* ═══ PLAY TOOLBAR ═══ */}
      {readOnly ? (
        <div style={{ ...S.playBar, color: 'var(--accent-yellow)', fontSize: 12 }}>
          Spielleiter-Ansicht — schreibgeschützt. Änderungen werden nicht gespeichert.
        </div>
      ) : (
        <div style={S.playBar}>
          <button type="button" style={S.playBtn} onClick={shortRest}>Short Rest</button>
          <button type="button" style={S.playBtn} onClick={longRest}>Long Rest</button>
          <button type="button"
            title={character.meta?.edition === '5.5e'
              ? 'Heroic Inspiration (2024 PHB): erlaubt einmal pro Rast einen Wurf zu wiederholen. Wird oft bei Nat 1 verliehen.'
              : 'Inspiration (PHB 2014): erlaubt einen Roll mit Advantage. Vom DM verliehen.'}
            style={{
              ...S.playBtn,
              borderColor: inspiration ? 'var(--accent-yellow)' : 'var(--border)',
              color: inspiration ? 'var(--accent-yellow)' : 'var(--text-secondary)',
            }}
            onClick={() => updateCharacter('status.inspiration', !inspiration)}>
            {character.meta?.edition === '5.5e' ? 'Heroic Inspiration' : 'Inspiration'}: {inspiration ? 'On' : 'Off'}
          </button>
        </div>
      )}

      {/* ═══ BODY ═══ */}
      {/* In GM (readOnly) mode the body is `inert`: HTML standard attribute
          that blocks ALL pointer / focus / keyboard events on the subtree
          without dimming the content. Defense-in-depth — applyCharacter is
          already a no-op when readOnly, but inert also kills any
          direct-supabase-write buttons (e.g. the level-history "Undo")
          and prevents portrait-picker dialogs from popping up. The tab
          BAR above is NOT inert so the GM can still switch tabs. */}
      <div className="dnd-sheet-body" style={S.body}>
        {/* ── SIDEBAR ── */}
        <div className="dnd-sheet-sidebar" style={S.sidebar} inert={readOnly ? '' : undefined}>
          {portrait && (
            <div style={S.sidePortrait}>
              <img src={portrait} style={S.sidePortraitImg} alt="Portrait" className="dnd-sheet-portrait"
                onClick={() => portraitRef.current?.click()} title="Portrait ändern" />
            </div>
          )}

          <SideSection title="Ability Scores" defaultOpen>
            <div style={S.abilityGrid}>
              {['str','dex','con','int','wis','cha'].map(key => {
                const score = abilityScores[key]
                const mod = modifiers[key]
                const base = character.abilityScores.base[key] || 8
                const racial = character.species?.abilityScoreImprovements?.[key] || 0
                const bg = character.background?.abilityScoreImprovements?.[key] || 0
                const featBonus = (character.feats || []).reduce((sum, f) =>
                  sum + (f.abilityBonus?.[key] || 0) + (f.choices?.abilityBonus?.[key] || 0), 0)
                const hasBonuses = racial || bg || featBonus
                return (
                  <div key={key} style={S.abilityBox}>
                    <div style={S.abilityAbbr}>{key.toUpperCase()}</div>
                    <div style={S.abilityMod}>{modStr(mod)}</div>
                    <div style={S.abilityScore}>{score}</div>
                    {hasBonuses && (
                      <div style={S.abilityBreakdown}>
                        {base}
                        {racial !== 0 && <span style={{ color: 'var(--accent-green)' }}>{racial > 0 ? '+' : ''}{racial}</span>}
                        {bg !== 0 && <span style={{ color: 'var(--accent-purple)' }}>{bg > 0 ? '+' : ''}{bg}</span>}
                        {featBonus !== 0 && <span style={{ color: 'var(--accent)' }}>{featBonus > 0 ? '+' : ''}{featBonus}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </SideSection>

          <SideSection title="Saving Throws">
            {computed && Object.entries(computed.savingThrows).map(([key, save]) => (
              <div key={key} style={S.saveRow}>
                <span style={{ ...S.profDot, background: save.proficient ? 'var(--accent)' : 'var(--border-strong)' }} />
                <span style={S.saveName}>{key.toUpperCase()}</span>
                <span style={S.saveValue}>{modStr(save.total)}</span>
              </div>
            ))}
            {/* All save notes — per-ability and all-saves — rendered as
                a single small list below the table. Replaces the
                old ★-with-tooltip pattern: at-a-glance instead of
                hover-to-find. Each per-ability note is prefixed with
                the ability (e.g. "DEX · Evasion: …") so the player
                can tell at a glance which save it applies to. */}
            <ScopedNoteList
              character={character}
              slots={['str','dex','con','int','wis','cha'].map(a => ({ slot: `save:${a}`, prefix: a.toUpperCase() }))}
              extraSlot="saves"
            />
          </SideSection>

          <SideSection title="Skills">
            {computed && Object.entries(computed.skills).map(([skill, data]) => {
              const dotColor = data.proficiency === 'expertise' ? 'var(--accent)'
                : data.proficiency === 'proficient' ? 'var(--accent-green)' : 'var(--border-strong)'
              const tooltipBase =
                data.proficiency === 'expertise' ? 'Expertise'
                : data.proficiency === 'proficient' ? 'Proficient' : 'Not Proficient'
              return (
                <div key={skill} style={S.skillRow} title={tooltipBase}>
                  <span style={{ ...S.profDot, background: dotColor }} />
                  <span style={S.skillName}>
                    {formatSkillName(skill)}
                    <span style={S.skillAbility}> ({data.ability.toUpperCase()})</span>
                  </span>
                  <span style={{ ...S.skillValue, color: data.proficiency ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                    {modStr(data.total)}
                  </span>
                </div>
              )
            })}
            <div style={S.sideHint}>
              <span style={{ color: 'var(--accent-green)' }}>● Proficient</span>
              {' · '}
              <span style={{ color: 'var(--accent)' }}>● Expertise</span>
            </div>
            {/* All per-skill notes aggregated inline below the table —
                no hover-to-find tooltips. Each line is "<Skill> · …". */}
            <ScopedNoteList
              character={character}
              slots={computed ? Object.keys(computed.skills).map(s =>
                ({ slot: `skill:${s}`, prefix: formatSkillName(s) })) : []}
              extraSlot="skills"
            />
          </SideSection>

          {computed?.proficiencies && (
            <SideSection title="Proficiencies">
              {computed.proficiencies.armor?.length > 0 && (
                <ProfBlock label="Armor" value={computed.proficiencies.armor.map(a => parseTags(String(a))).join(', ')} />
              )}
              {computed.proficiencies.weapons?.length > 0 && (
                <ProfBlock label="Weapons" value={computed.proficiencies.weapons.map(w => parseTags(String(w))).join(', ')} />
              )}
              {Object.keys(computed.proficiencies.tools || {}).length > 0 && (
                <ProfBlock label="Tools" value={Object.keys(computed.proficiencies.tools).map(formatToolName).join(', ')} />
              )}
              {computed.proficiencies.languages?.length > 0 && (
                <ProfBlock label="Languages" value={computed.proficiencies.languages.join(', ')} />
              )}
            </SideSection>
          )}

          <SideSection title="Senses">
            <SenseRow label="Passive Perception" value={computed?.passivePerception ?? 10} />
            <SenseRow label="Passive Investigation" value={computed?.passiveInvestigation ?? 10} />
            <SenseRow label="Passive Insight" value={computed?.passiveInsight ?? 10} />
            {character.species?.darkvision && (
              <SenseRow label="Darkvision" value={`${character.species.darkvision} ft.`} />
            )}
          </SideSection>
        </div>

        {/* ── MAIN ── */}
        <div className="dnd-sheet-main" style={S.main}>
          <div data-pwa-target="dnd-sheet-tabs" style={S.tabs}>
            {TABS.map(tab => (
              <button key={tab.id}
                style={{ ...S.tab, ...(activeTab === tab.id ? S.tabActive : {}) }}
                onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>

          <div style={S.tabContent} inert={readOnly ? '' : undefined}>
            {activeTab === 'overview' && (
              <OverviewTab character={character} computed={computed} abilityScores={abilityScores}
                hp={hp} updateCharacter={updateCharacter} applyCharacter={applyCharacter}
                charId={id} session={session} onReload={loadCharacter}
                readOnly={readOnly} />
            )}
            {activeTab === 'spells' && (
              <SpellsTab character={character} computed={computed}
                updateCharacter={updateCharacter} applyCharacter={applyCharacter} />
            )}
            {activeTab === 'inventory' && (
              <InventoryTab character={character} computed={computed}
                updateCharacter={updateCharacter} applyCharacter={applyCharacter} />
            )}
            {activeTab === 'features' && <FeaturesTab character={character} updateCharacter={updateCharacter} />}
            {activeTab === 'personality' && (
              <PersonalityTab character={character} updateCharacter={updateCharacter} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// COMBAT STAT
// ═══════════════════════════════════════════════════════════════

// (FeatureNoteList moved to ./components/sheet/SheetKit — shared with
// OverviewTab and any future caller. featureNoteDot stays here because
// it's used inline in the saving-throws side-section.)
const featureNoteDot = {
  marginLeft: 6, color: 'var(--accent-yellow)', fontSize: 11, cursor: 'help',
}

// Aggregated inline note list for a Side section (Saves / Skills /
// anything else with per-row + section-wide notes). Each entry is
// rendered with its feature name + a per-row prefix (e.g. "DEX"
// for save:dex) so the player can see at a glance which row the note
// applies to. Returns null when there's nothing to show, so the
// SideSection doesn't grow a phantom block.
function ScopedNoteList({ character, slots, extraSlot }) {
  const items = []
  let key = 0
  for (const { slot, prefix } of (slots || [])) {
    const notes = getEffectsForSlot(character, slot)
    for (const n of notes) {
      items.push({ id: `${slot}-${key++}`, prefix, feature: n.feature, text: n.text })
    }
  }
  if (extraSlot) {
    const notes = getEffectsForSlot(character, extraSlot)
    for (const n of notes) {
      items.push({ id: `${extraSlot}-${key++}`, prefix: null, feature: n.feature, text: n.text })
    }
  }
  if (items.length === 0) return null
  return (
    <ul style={scopedNoteList}>
      {items.map(n => (
        <li key={n.id} style={scopedNoteItem}>
          {n.prefix && <span style={scopedNotePrefix}>{n.prefix}</span>}
          <span style={scopedNoteFeature}>{n.feature}</span>
          <span> · {n.text}</span>
        </li>
      ))}
    </ul>
  )
}
const scopedNoteList = {
  margin: '8px 0 0 0', padding: '6px 8px', listStyle: 'none',
  background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)',
  borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 3,
}
const scopedNoteItem = { fontSize: 11, lineHeight: 1.4, color: 'var(--text-secondary)' }
const scopedNotePrefix = {
  display: 'inline-block', minWidth: 28, marginRight: 6,
  color: 'var(--text-muted)', fontWeight: 700, fontSize: 10,
  letterSpacing: 0.5,
}
const scopedNoteFeature = { color: 'var(--accent)', fontWeight: 600 }

function CombatStat({ label, value, color, sub, onClick }) {
  return (
    <div
      style={{ ...S.combatStat, ...(onClick ? S.combatStatBtn : {}) }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      title={onClick ? 'Zu den Trefferpunkten' : undefined}
    >
      <div style={{ ...S.combatStatValue, color }}>{value}</div>
      <div style={S.combatStatLabel}>{label}</div>
      {sub && <div style={S.combatStatSub}>{sub}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// CONCENTRATION SAVE PROMPT
// Centered modal that appears whenever HP drops while a concentration
// spell is active. The DC is derived per RAW (max(10, ⌊damage/2⌋));
// the player picks the save outcome — failing auto-drops concentration.
// ═══════════════════════════════════════════════════════════════
function ConcentrationSavePrompt({ info, onSucceeded, onFailed, onSkip }) {
  return (
    <div
      onClick={onSkip}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)', color: 'var(--text-primary)',
          border: '1px solid var(--accent-purple)', borderRadius: 12,
          padding: 22, maxWidth: 420, width: '100%',
          boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{
          fontSize: 11, color: 'var(--accent-purple)',
          textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6,
          fontWeight: 'bold',
        }}>
          Konzentrations-Save
        </div>
        <div style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 10 }}>
          {info.spell}
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16, lineHeight: 1.5 }}>
          Du hast <b style={{ color: 'var(--accent-red)' }}>{info.damage} HP</b> Schaden bekommen.
          Würfle einen Konstitutions-Save gegen <b style={{ color: 'var(--accent-purple)' }}>DC {info.dc}</b>.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            type="button" onClick={onSkip}
            style={{
              padding: '8px 14px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
            }}
          >Überspringen</button>
          <button
            type="button" onClick={onFailed}
            style={{
              padding: '8px 14px', borderRadius: 6,
              border: '1px solid var(--accent-red)', background: 'transparent',
              color: 'var(--accent-red)', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 'bold',
            }}
          >✗ Nicht bestanden</button>
          <button
            type="button" onClick={onSucceeded}
            style={{
              padding: '8px 14px', borderRadius: 6,
              border: '1px solid var(--accent-green)',
              background: 'color-mix(in srgb, var(--accent-green) 22%, transparent)',
              color: 'var(--accent-green)', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 'bold',
            }}
          >✓ Bestanden</button>
        </div>
      </div>
    </div>
  )
}
