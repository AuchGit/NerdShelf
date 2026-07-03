import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useParams } from '../lib/hashNav'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n'
import { computeCharacter, computeAbilityScores, computeModifiers } from '../lib/rulesEngine'
import { getProficiencyBonus, getTotalLevel, getModifier } from '../lib/characterModel'
import { loadClassData, loadItemIndex, loadRaceList, loadOptionalFeatureList, loadFeatList } from '../lib/dataLoader'
import { findOptionBlocks, optionValueKey, buildNameSourceMap } from '../lib/optionBlockResolver'
import { isVariantEnabled } from '../lib/optionalFeatureVariants'
// foundryExport is huge (~3000 lines of stat-block / item / spell
// converters) and only runs when the user clicks "Foundry Export".
// Defer the import to click time so the initial sheet bundle stays small.
const importFoundryExport = () => import('../lib/foundryExport')

// Sheet-Popout: spawnt im Tauri-Shell ein eigenes Always-on-Top Fenster mit
// dem Sheet im PWA-Layout — gedacht für die Nutzung neben einem VTT. Die
// Spawn-Logik liegt in lib/sheetPopout.js, damit auch der VTT (Token-Sheet)
// sie ohne das schwere Sheet-Modul nutzen kann.
import { openSheetPopout as openPopout } from '../lib/sheetPopout'

// Schließt das aktuelle Popout-Fenster. Tauri-Shell: schließt das
// WebviewWindow via `getCurrentWindow().close()` — funktioniert weil
// das Popout sein eigenes Window-Label hat. Browser-Fallback:
// `window.close()` greift bei Fenstern die durch `window.open` aus
// einem User-Gesture entstanden sind.
// Defensive Popout-Detection ohne den React-Hook — wird im useEffect
// am ganz oberen Scope der Page-Komponente gebraucht bevor isPopout
// aus usePwaMobile destrukturiert ist.
function isPopoutWindow() {
  if (typeof window === 'undefined') return false
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('popout') === '1') return true
    const hash = window.location.hash || ''
    const qIdx = hash.indexOf('?')
    if (qIdx >= 0) {
      const hashParams = new URLSearchParams(hash.slice(qIdx + 1))
      if (hashParams.get('popout') === '1') return true
    }
  } catch { /* ignore */ }
  return false
}

async function closePopoutWindow() {
  const isTauri = typeof window !== 'undefined'
    && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  if (isTauri) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().close()
      return
    } catch (e) {
      console.error('[popout] close failed', e)
    }
  }
  try { window.close() } catch { /* ignore */ }
}

// Mini-Drag-Bar-Styles für das Popout-Fenster.
//   • height bewusst klein (22px) damit sie kaum Platz frisst
//   • data-tauri-drag-region macht den ganzen Bereich draggable
//   • Close-Button bekommt eigenes Click-Handling und damit
//     `app-region: no-drag` — wäre nur in CSS-Win-Style relevant,
//     Tauri respektiert Click-Targets automatisch.
const popoutDragBar = {
  height: 28,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--bg-elevated)',
  borderBottom: '1px solid var(--border)',
  padding: '0 4px 0 10px',
  cursor: 'grab',
  userSelect: 'none',
  WebkitUserSelect: 'none',
}
const popoutDragTitle = {
  flex: 1,
  minWidth: 0,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  letterSpacing: 0.3,
  pointerEvents: 'none',  // Click geht durch zum Drag-Bereich
}
const popoutDragSubtitle = {
  fontSize: 10,
  fontWeight: 400,
  color: 'var(--text-dim)',
  marginLeft: 6,
  pointerEvents: 'none',
}
const popoutActionBtn = {
  padding: '0 8px',
  height: 20,
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  background: 'transparent',
  color: 'var(--accent)',
  border: '1px solid var(--accent)',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'inherit',
  lineHeight: 1,
}
const popoutCloseBtn = {
  width: 22, height: 22,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  color: 'var(--text-muted)',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  fontFamily: 'inherit',
  padding: 0,
}
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
const FiveEImportModal = lazy(() => import('../components/FiveEImportModal'))
import usePwaMobile from '../../../../shared/hooks/usePwaMobile'
import usePopoutSize from '../../../../shared/hooks/usePopoutSize'
import PopoutStatBar from '../components/sheet/PopoutStatBar'
import useWindowWidth from '../../../../shared/hooks/useWindowWidth'
import { ActionSheet } from '../../../../shared/ui'
import { SideSection, ProfBlock, SenseRow } from '../components/sheet/SheetKit'
import { S } from '../components/sheet/sheetStyles'
import OverviewTab from '../components/sheet/OverviewTab'
import SpellsTab from '../components/sheet/SpellsTab'
import InventoryTab from '../components/sheet/InventoryTab'
import FeaturesTab from '../components/sheet/FeaturesTab'
import PersonalityTab from '../components/sheet/PersonalityTab'
import { modStr, formatToolName, formatSkillName, COIN_TYPES } from '../lib/sheetUtils'
import './CharacterSheetPage.css'

const TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'spells',      label: 'Spells' },
  { id: 'inventory',   label: 'Inventory' },
  { id: 'features',    label: 'Features' },
  { id: 'personality', label: 'Basic Info' },
  { id: 'history',     label: 'Class History' },
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
  // Cached optionalfeature index (lowercased name → entry). Wird in
  // hydrateClassDataAndRecompute befüllt und von collectActiveClass
  // Features genutzt um refOptionalfeature-Picks (Fighting Style etc.)
  // auf konkrete Entries aufzulösen.
  const optionalFeatureMapRef = useRef(null)
  // Feat-Lookup für den Option-Block-Resolver: 2024-Klassen kodieren
  // Fighting Style / Epic Boon als Feat-Kategorie ({@filter …|feats|
  // category=FS}) — ohne Feat-Daten resolven gespeicherte ft:-Picks
  // nicht und der Bonus (z.B. Defense +1 AC) ginge verloren.
  const featMapRef = useRef(null)
  const [loading, setLoading] = useState(true)
  // Active-Tab pro Charakter persistiert (localStorage keyed by id).
  // Beim Sheet-Neustart soll der User auf dem Tab landen den er
  // zuletzt benutzt hatte — z.B. wenn er gerade Inventar gepflegt
  // hat. Default 'overview' für frische Charaktere.
  const tabStorageKey = id ? `nerdshelf:sheetTab:${id}` : null
  const [activeTab, setActiveTabRaw] = useState(() => {
    if (!tabStorageKey) return 'overview'
    try {
      const v = window.localStorage.getItem(tabStorageKey)
      return v || 'overview'
    } catch { return 'overview' }
  })
  const setActiveTab = (next) => {
    setActiveTabRaw(next)
    if (tabStorageKey) {
      try { window.localStorage.setItem(tabStorageKey, next) } catch { /* ignore */ }
    }
  }
  // Im Popout-Fenster ist das Sheet auf Overview eingeschraenkt.
  // Falls aus irgend einem Grund ein anderer Tab gesetzt wurde
  // (Persistenz, Hot-Reload), sofort zurueck.
  useEffect(() => {
    if (isPopoutWindow() && activeTab !== 'overview') setActiveTab('overview')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])
  // Concentration-save prompt: { damage, dc } when the player has just
  // taken damage while concentrating. Player-side only — readOnly GM
  // view skips this entirely.
  const [concSavePrompt, setConcSavePrompt] = useState(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showCustomEdit, setShowCustomEdit] = useState(false)
  const [showFiveEImport, setShowFiveEImport] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  // Desktop header is hidden by default and pops down as an overlay
  // when the player clicks the chevron in the top toggle bar. Mobile
  // keeps the existing compact header (no toggle).
  const [headerOpen, setHeaderOpen] = useState(false)
  // Guided rest prompts replace the old "confirm"-style rests. Short
  // Rest collects hit-die rolls + previews HP gain; Long Rest reminds
  // about spell prep + free recovery before committing.
  const [shortRestOpen, setShortRestOpen] = useState(false)
  const [longRestOpen, setLongRestOpen] = useState(false)
  // Sheet-Sidebar (Ability Scores / Saves / Skills / Senses / Profs)
  // läuft bei schmalen Fenstern als Slide-in-Drawer von links statt
  // oberhalb des Mains gestapelt. Trigger = useWindowWidth.mode
  // 'hidden' (= viewport < 768px); dort hat ein inliner Sidebar nicht
  // genug horizontalen Platz, ein vertikaler Stack schluckt aber zu
  // viel vertikalen — Drawer ist der Mittelweg.
  const [sheetSidebarOpen, setSheetSidebarOpen] = useState(false)
  // Features-Tab ExpandedSet: bleibt erhalten wenn der User zwischen
  // Tabs wechselt (FeaturesTab selbst unmounted, CharacterSheetPage
  // bleibt aber gemounted, also überlebt der State hier oben).
  const [featuresExpanded, setFeaturesExpanded] = useState(() => new Set())
  const { isPwaMobile, isPopout } = usePwaMobile()
  const popoutSize = usePopoutSize()
  const [popoutConditionsOpen, setPopoutConditionsOpen] = useState(false)
  // Popout-Bottom-Nav: default / spells / favs / mastery (Class-Ressources
  // + Weapon-Mastery). State lebt hier damit der Reload den Stand behält
  // wenn das Popout-Fenster gewechselt wird.
  const [popoutTab, setPopoutTab] = useState('default')
  const { mode: winMode } = useWindowWidth()
  const sheetSidebarAsDrawer = winMode === 'hidden'
  // Drawer schließt automatisch, wenn das Fenster wieder breit wird.
  useEffect(() => {
    if (!sheetSidebarAsDrawer && sheetSidebarOpen) setSheetSidebarOpen(false)
  }, [sheetSidebarAsDrawer, sheetSidebarOpen])
  // ESC schließt den Drawer.
  useEffect(() => {
    if (!sheetSidebarOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setSheetSidebarOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheetSidebarOpen])
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
    // Homebrew-Features lazy laden und auf den transient-character
    // stashen. collectActiveClassFeatures liest sie unten aus und
    // hängt sie an __activeFeatures wenn classId + level matched.
    try {
      const { listHomebrew } = await import('../../homebrew/lib/homebrewStore')
      const homebrewFeatures = await listHomebrew('features')
      charData = { ...charData, __homebrewFeatures: homebrewFeatures }
    } catch (e) {
      console.warn('[homebrew] feature load failed', e)
    }
    // Optfeature-Liste laden für die Auflösung der refOptionalfeature
    // -Picks (Fighting Style, Maneuver, Invocation, …). Fail-soft —
    // wenn der Load schief geht, fallen wir auf "kein Match" zurück,
    // catalog/parser sehen den optfeature dann nicht, aber kein Crash.
    let optionalFeatureMap = null
    try {
      const ofList = await loadOptionalFeatureList(edition)
      optionalFeatureMap = new Map()
      for (const f of (ofList || [])) {
        if (!f?.name) continue
        const lower = String(f.name).toLowerCase()
        const src = String(f.source || '').toUpperCase()
        // Two keys: `name` und `name|source` damit ein Resolver-Lookup
        // auch ohne Source treffen kann.
        optionalFeatureMap.set(lower, f)
        if (src) optionalFeatureMap.set(`${lower}|${src}`, f)
      }
    } catch { /* ignore */ }
    optionalFeatureMapRef.current = optionalFeatureMap
    try {
      featMapRef.current = buildNameSourceMap(await loadFeatList(edition))
    } catch { /* fail-soft wie optionalFeatureMap */ }
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
    const { names: traitNames, traits: rawTraits, fixedSkills: raceFixedSkills } =
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
    const grantedSpells = collectClassGrantedSpells(charData, map, activeFeatures)
    if (traitNames.length > 0 || activeFeatures.length > 0 || grantedSpells.length > 0 || raceFixedSkills.length > 0) {
      const speciesPatch = {}
      if (traitNames.length > 0) {
        speciesPatch.__traitNames = traitNames
        speciesPatch.__traits = rawTraits
      }
      if (raceFixedSkills.length > 0) speciesPatch.__fixedSkills = raceFixedSkills
      // classDataMap auf das transient-character stashen, damit
      // featureEffectParser (für Sneak-Attack-/Bardic-Die-/Martial-
      // Arts-Skalierung über classTableLookup) den Map ohne extra
      // Prop-Drilling findet. queueSave strippt das vor dem Persist.
      // Feats mit Katalog-Entries als SEPARATES transient-Feld — nur der
      // Prosa-Resource-Synthesizer liest es (Metamagic Adept +2 Sorcery
      // Points), NICHT die Feature-Bonus-Aggregation (kein Doppelzählen).
      const featFeatures = []
      if (featMapRef.current) {
        const pushFeat = (nm, inline) => {
          const entries = Array.isArray(inline) ? inline : featMapRef.current.get(String(nm || '').toLowerCase())?.entries
          if (nm && Array.isArray(entries)) featFeatures.push({ classId: null, name: nm, level: 1, entries })
        }
        for (const ft of (charData.feats || [])) pushFeat(ft.name || ft.featId, ft.entries)
        for (const ft of (charData.custom?.feats || [])) pushFeat(ft.name, ft.entries)
      }
      setCharacter(prev => prev ? ({
        ...prev,
        species: { ...(prev.species || {}), ...speciesPatch },
        __activeFeatures: activeFeatures,
        __featFeatures: featFeatures,
        __grantedSpells: grantedSpells,
        __classDataMap: map,
      }) : prev)
      charData = {
        ...charData,
        species: { ...(charData.species || {}), ...speciesPatch },
        __activeFeatures: activeFeatures,
        __featFeatures: featFeatures,
        __grantedSpells: grantedSpells,
        __classDataMap: map,
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
    // Type-code → flag for the legacy-wizard fix: old characters were
    // saved with isArmor=false on XPHB armor because item-index.json's
    // source-suffixed type ('LA|XPHB') skipped the strict equality
    // check the wizard used. We re-derive from the type code so the
    // sheet and Foundry export both see the right item kind.
    const needsArmorFlag = (w) => {
      const code = String(w.type || '').split('|')[0]
      return ['LA','MA','HA','S'].includes(code) && !w.isArmor
    }
    const needsWeaponFlag = (w) => {
      const code = String(w.type || '').split('|')[0]
      return ['M','R'].includes(code) && !w.isWeapon
    }
    // `reqAttune` was added later — characters created before it
    // exists need it backfilled so the Attune checkbox / sidebar
    // counter can decide per item whether attunement applies at all.
    // 5etools stores `reqAttune` as `true` OR a string ("by a wizard"
    // etc.); we keep whichever form the catalog has so future UI can
    // surface the conditions verbatim if it wants to.
    const needsAttuneFlag = (w, ref) =>
      ref && ref.reqAttune && w.reqAttune === undefined
    let needsPatch = false
    outer: for (const list of lists) {
      for (const w of list) {
        if (!w?.name) continue
        if (needsArmorFlag(w) || needsWeaponFlag(w)) { needsPatch = true; break outer }
        const ref = byName.get(w.name.toLowerCase())
        if (!ref) continue
        const wantsMastery = ref.isWeapon && Array.isArray(ref.mastery) && ref.mastery.length > 0
          && !(Array.isArray(w.mastery) && w.mastery.length > 0)
        const wantsEntries = Array.isArray(ref.entries) && ref.entries.length > 0
          && !(Array.isArray(w.entries) && w.entries.length > 0)
        if (wantsMastery || wantsEntries || needsAttuneFlag(w, ref)) {
          needsPatch = true
          break outer
        }
      }
    }
    if (!needsPatch) return false
    applyCharacter(d => {
      const draftLists = [d.inventory?.items, d.custom?.items].filter(Array.isArray)
      for (const list of draftLists) {
        for (const w of list) {
          if (!w?.name) continue
          if (needsArmorFlag(w))  w.isArmor  = true
          if (needsWeaponFlag(w)) w.isWeapon = true
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
          if (needsAttuneFlag(w, ref)) w.reqAttune = ref.reqAttune
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
        optionalFeatureMap: optionalFeatureMapRef.current,
        featMap: featMapRef.current,
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
    const ofMap = optionalFeatureMapRef.current
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
    for (const v of byKey.values()) out.push(v.entry)
    return out
  }

  // Walk class + subclass `additionalSpells.prepared` tables and
  // return the spells the character has unlocked at their current
  // class level. Output shape: `[{name, classId, sourceFeature}]`.
  // The character-level keyed table is filtered against `cls.level`,
  // so a Cleric 1 Twilight gets the L1 row and a Cleric 5 gets L1+3+5.
  function collectClassGrantedSpells(charData, classDataMap, activeFeatures = null) {
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
  async function loadRaceTraits(edition, charData) {
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
      if (sp.__traitNames || sp.__traits || sp.__fixedSkills) {
        const { __traitNames, __traits, __fixedSkills, ...restSpecies } = sp
        stripped.species = restSpecies
        touched = true
      }
      if (stripped.__activeFeatures) {
        delete stripped.__activeFeatures
        touched = true
      }
      if (stripped.__featFeatures) {
        delete stripped.__featFeatures
        touched = true
      }
      if (stripped.__grantedSpells) {
        delete stripped.__grantedSpells
        touched = true
      }
      if (stripped.__classDataMap) {
        delete stripped.__classDataMap
        touched = true
      }
      if (stripped.__homebrewFeatures) {
        delete stripped.__homebrewFeatures
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
  // Rest handlers now just open the guided prompts; the actual state
  // changes happen on confirm inside each modal.
  // Resettet _hbActions-Item-Charges (shared + per-action) wenn das
  // jeweilige rest-Field in `rests` enthalten ist. Iteriert das ECHTE
  // Inventory (nicht computed.resources) damit auch Items ohne
  // Resource-Backing korrekt zurückgesetzt werden.
  function resetItemCharges(d, rests) {
    if (!d?.status?.itemCharges) return
    const restSet = new Set(rests)
    const itemPool = [
      ...(d.inventory?.items || []),
      ...(d.custom?.items    || []),
    ]
    for (const it of itemPool) {
      const id = it?.id || it?._id || it?.name
      if (!id) continue
      const bucket = d.status.itemCharges[id]
      if (!bucket) continue
      // Shared pool — eine Reset-Regel pro Item.
      if (it._hbSharedCharges && restSet.has(it._hbSharedCharges.rest || 'long')) {
        delete bucket.shared
      }
      // Per-Action — pro Action eigene Regel.
      if (Array.isArray(it._hbActions)) {
        for (const a of it._hbActions) {
          if (restSet.has(a.chargesRest || 'long')) delete bucket[a.id]
        }
      }
      if (Object.keys(bucket).length === 0) delete d.status.itemCharges[id]
    }
  }

  function shortRest() {
    if (readOnly) return
    setShortRestOpen(true)
  }
  function longRest() {
    if (readOnly) return
    setLongRestOpen(true)
  }

  // Commit handlers called from the modals — wrapping applyCharacter
  // so the modals stay UI-only and the persistence logic lives next
  // to the rest of the character mutators.
  function commitShortRest({ hpGain, diceSpent }) {
    applyCharacter(d => {
      if (!d.status) d.status = {}
      const maxHp = computed?.hp?.max || 1
      const cur = d.status.currentHp ?? maxHp
      d.status.currentHp = Math.min(maxHp, cur + hpGain)
      // Track spent hit dice per class — Long Rest will recover half.
      d.status.hitDiceUsed = { ...(d.status.hitDiceUsed || {}) }
      for (const [classId, n] of Object.entries(diceSpent || {})) {
        if (n > 0) d.status.hitDiceUsed[classId] = (d.status.hitDiceUsed[classId] || 0) + n
      }
      // Resources flagged short-rest plus pact slots refresh.
      d.status.usedPactSlots = 0
      const used = { ...(d.status.usedResources || {}) }
      for (const res of (computed?.resources || [])) {
        if (res.recharge === 'short_rest') delete used[res.id]
      }
      d.status.usedResources = used
      // Homebrew-Item-Charges: reset per shared.rest oder action.chargesRest
      // wenn 'short'. Iteriert direkt über die Inventory damit jeder Eintrag
      // (auch ohne computed.resources-Backing) zurückgesetzt wird.
      resetItemCharges(d, ['short'])
      // Active-Effects-Cleanup: alle Effekte mit until=short_rest /
      // concentration-end / turn-end fallen weg.
      if (Array.isArray(d.status.activeEffects)) {
        d.status.activeEffects = d.status.activeEffects.filter(e =>
          !['short_rest', 'concentration-end', 'turn-end'].includes(e?.until),
        )
      }
    })
    setShortRestOpen(false)
  }
  function commitLongRest() {
    const maxHp = Math.max(1, (computed?.hp?.max || 1) + (character.status?.maxHpBonus || 0))
    applyCharacter(d => {
      if (!d.status) d.status = {}
      d.status.usedSpellSlots = {}
      d.status.usedPactSlots = 0
      d.status.usedResources = {}
      // Homebrew-Item-Charges: alle die long-rest-, short-rest- oder
      // dawn-cleared sind reseten. Long Rest deckt alle "kürzer-als-day"
      // Resets ab (RAW: Long-Rest erholt alle Charges die schneller als
      // einmal pro Tag zurückkommen).
      resetItemCharges(d, ['short', 'long', 'dawn'])
      d.status.currentHp = maxHp
      d.status.temporaryHp = 0
      d.status.deathSaves = { successes: 0, failures: 0 }
      d.status.concentration = null
      d.status.economy = {
        action: false, bonusAction: false, reaction: false,
        surgeAction: false, hastedAction: false,
        surgeActive: false, leveledCast: false,
      }
      // Active-Effects-Cleanup: long rest räumt alles auf außer
      // dauerhafte Effekte (until=null). Concentration ist sowieso
      // gebrochen (siehe oben), Minute-/Turn-Effekte sind eh abgelaufen.
      if (Array.isArray(d.status.activeEffects)) {
        d.status.activeEffects = d.status.activeEffects.filter(e =>
          !['long_rest', 'short_rest', 'concentration-end', 'minute', 'turn-end'].includes(e?.until),
        )
      }
      // Long Rest recovers half (round-up) of each class's max hit dice.
      const used = { ...(d.status.hitDiceUsed || {}) }
      for (const cls of (character.classes || [])) {
        const max = cls.level
        const spent = used[cls.classId] || 0
        const recover = Math.ceil(max / 2)
        used[cls.classId] = Math.max(0, spent - recover)
      }
      d.status.hitDiceUsed = used
    })
    setLongRestOpen(false)
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
  // Attunement-Counter unter dem Sidebar-Portrait — nur Items mit
  // reqAttune zählen, damit Legacy-attuned=true auf nicht-attunbaren
  // Items nicht mitgezählt wird. Slots-Default 3 entspricht 5e RAW.
  const allInvItems   = [
    ...((character.inventory?.items) || []),
    ...((character.custom?.items)    || []),
  ]
  const attunedCount  = allInvItems.filter(i => i.reqAttune && i.attuned).length
  const attuneMax     = character.inventory?.attunementSlots || 3
  const subraceName   = character.species.subraceId?.split('__')[0] || ''
  const speciesDisplay = subraceName ? `${subraceName} (${raceName})` : raceName
  const className     = character.classes.map(c => `${c.classId} ${c.level}`).join(' / ')
  const portrait      = character.appearance?.portrait
  const inspiration   = character.status?.inspiration || character.info?.inspiration || false

  return (
    <div className="dnd-sheet-root" style={S.page}>
      <input ref={portraitRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePortrait} />

      {/* ═══ HEADER ═══
          Im Popout-Fenster wird die Mobile-Header-Bar (Back / Portrait /
          Name / ⋯) komplett weggelassen — Top-Slot ist die PopoutStatBar.
          Die Drag-Region sitzt direkt auf der StatBar. */}
      {isPwaMobile && !isPopout ? (
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
      ) : (<>
        {/* Im Popout-Fenster: KEINE separate Drag-/Close-Leiste —
            die PopoutStatBar (weiter unten) trägt selbst die
            `data-tauri-drag-region` Markierung damit der ganze
            obere Bereich zum Verschieben benutzt werden kann. Der
            × Close-Button sitzt rechts in der StatBar. */}
        {/* Slim always-visible toggle: chevron + character name. The
            full header (Dashboard back-link, name editor, Export /
            Level Up / Custom buttons) appears as an overlay below when
            the chevron is opened, so the bar doesn't eat vertical
            space during play.
            Im Popout-Fenster wird die ganze Toolbar weggelassen —
            das Popout zeigt nur das Sheet selbst, kein Header / keine
            Action-Buttons (die liegen im Haupt-Fenster). */}
        {!isPopout && (<>
        <div style={headerToggleBar}>
          <button
            type="button"
            onClick={() => setHeaderOpen(o => !o)}
            title={headerOpen ? 'Header schließen' : 'Header öffnen'}
            style={headerToggleBtn}
          >{headerOpen ? '▲' : '▼'}</button>
          {sheetSidebarAsDrawer && (
            // Slide-out-Knopf für die Sheet-Sidebar. Nur sichtbar wenn
            // wir gerade im Drawer-Modus sind (sonst läuft die Sidebar
            // inline und braucht keinen Toggle). Beschriftung mit ›/‹
            // matched die App-Sidebar-Chevrons.
            <button
              type="button"
              onClick={() => setSheetSidebarOpen(o => !o)}
              title={sheetSidebarOpen ? 'Sidebar schließen' : 'Sidebar öffnen'}
              style={{ ...headerToggleBtn, marginLeft: 6 }}
            >{sheetSidebarOpen ? '‹' : '›'}</button>
          )}
          <span style={headerToggleTitle}>
            {character.info.name || 'Unbenannt'}
            <span style={{ color: 'var(--text-dim)', fontWeight: 400, marginLeft: 8 }}>
              {speciesDisplay} · {className} · L{totalLevel}
            </span>
          </span>
        </div>
        {headerOpen && (
        <div data-pwa-target="dnd-sheet-header"
          style={{ ...S.header, position: 'absolute', top: 32, left: 0, right: 0, zIndex: 20, boxShadow: '0 6px 12px rgba(0,0,0,0.4)' }}
          onMouseLeave={() => setHeaderOpen(false)}
        >
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
                {/* Popout: spawnt im Tauri-Shell ein separates Always-on-Top
                    Borderless-Fenster mit dem Sheet im PWA-Layout. Im
                    Browser fällt es auf window.open() zurück. */}
                <button
                  style={{ ...S.headerBtn, borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}
                  onClick={() => openPopout(id)}
                  title="Sheet als Popout-Fenster für VTT-Spiel öffnen"
                >Popout</button>
                {/* 5e.tools-Import: öffnet das Importer-Modal mit
                    URL-Paste + Browse-Window. Spell / Item / Feat
                    landen in character.custom.* mit korrektem Edition-
                    Marker. */}
                <button
                  style={{ ...S.headerBtn, borderColor: 'var(--accent-orange, #ff9533)', color: 'var(--accent-orange, #ff9533)' }}
                  onClick={() => setShowFiveEImport(true)}
                  title="Spell, Item oder Feat per 5e.tools-URL importieren"
                >📥 5e.tools</button>
              </>
            )}
            <HeaderButtons session={session} />
          </div>
        </div>
        )}
        </>)}
      </>)}

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

      {showFiveEImport && (
        <Suspense fallback={null}>
          <FiveEImportModal
            open={showFiveEImport}
            onClose={() => setShowFiveEImport(false)}
            character={character}
            applyCharacter={applyCharacter}
          />
        </Suspense>
      )}

      {/* ═══ REST PROMPTS ═══ */}
      {shortRestOpen && (
        <ShortRestPrompt
          character={character}
          computed={computed}
          abilityScores={abilityScores}
          maxHp={hp.max}
          currentHp={hp.current}
          onClose={() => setShortRestOpen(false)}
          onConfirm={commitShortRest}
        />
      )}
      {longRestOpen && (
        <LongRestPrompt
          character={character}
          computed={computed}
          onClose={() => setLongRestOpen(false)}
          onConfirm={commitLongRest}
        />
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

      {/* Play toolbar replaced by corner icons on the sidebar portrait
          (short rest / long rest / inspiration / level). GM read-only
          notice still shows in its own slim banner. */}
      {readOnly && (
        <div style={{ ...S.playBar, color: 'var(--accent-yellow)', fontSize: 12 }}>
          Spielleiter-Ansicht — schreibgeschützt. Änderungen werden nicht gespeichert.
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
        {/* Drawer-Backdrop: nur im narrow + offen. */}
        {sheetSidebarAsDrawer && sheetSidebarOpen && (
          <div
            onClick={() => setSheetSidebarOpen(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.45)',
              backdropFilter: 'blur(2px)',
              WebkitBackdropFilter: 'blur(2px)',
              zIndex: 30,
            }}
          />
        )}
        {/* ── SIDEBAR ── */}
        <div
          className="dnd-sheet-sidebar"
          style={
            sheetSidebarAsDrawer
              ? {
                  ...S.sidebar,
                  position: 'fixed',
                  top: 0, left: 0, bottom: 0,
                  width: 280, maxWidth: '85vw',
                  zIndex: 31,
                  boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
                  transform: sheetSidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
                  transition: 'transform 200ms ease-out',
                  pointerEvents: sheetSidebarOpen ? 'auto' : 'none',
                }
              : S.sidebar
          }
          inert={readOnly ? '' : undefined}
        >
          <div style={{ ...S.sidePortrait, position: 'relative', display: 'inline-block', width: '100%' }}>
              {portrait
                ? <img src={portrait} style={S.sidePortraitImg} alt="Portrait" className="dnd-sheet-portrait"
                    onClick={readOnly ? undefined : () => portraitRef.current?.click()} title="Portrait ändern" />
                : (
                  // Placeholder wenn kein Portrait gesetzt — klickbar im
                  // Edit-Modus, damit der Spieler eins hochladen kann.
                  // Visuell hält's die Sidebar-Slot-Höhe stabil + die
                  // Corner-Icons (Lv / Inspiration / Rests) bleiben
                  // sichtbar wie bei einem gesetzten Portrait.
                  <div
                    onClick={readOnly ? undefined : () => portraitRef.current?.click()}
                    title={readOnly ? '' : 'Portrait hochladen'}
                    className="dnd-sheet-portrait"
                    style={{
                      ...S.sidePortraitImg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexDirection: 'column', gap: 4,
                      background: 'var(--bg-inset)',
                      border: '2px dashed var(--border-strong, var(--border))',
                      color: 'var(--text-dim)',
                      cursor: readOnly ? 'default' : 'pointer',
                      fontSize: 11, fontFamily: 'inherit',
                    }}>
                    <span style={{ fontSize: 26, lineHeight: 1 }}>+</span>
                    <span>Portrait</span>
                  </div>
                )}
              {/* Corner icons replace the old play-toolbar buttons:
                    TL: short rest  ·  TR: long rest
                    BL: inspiration ·  BR: total level
                  Each is absolutely positioned so the portrait stays
                  the same size; click handlers stop propagation so the
                  portrait-upload picker doesn't pop up. */}
              <PortraitCornerIcon
                pos="tl"
                title={readOnly
                  ? `Total Level ${totalLevel}`
                  : `Total Level ${totalLevel} — Level Up öffnen`}
                glyph={`Lv${totalLevel}`}
                onClick={readOnly ? undefined : () => navigate(`/character/${id}/levelup`)}
                static={readOnly}
              />
              <PortraitCornerIcon
                pos="tr"
                title={character.meta?.edition === '5.5e'
                  ? 'Heroic Inspiration — toggle on / off'
                  : 'Inspiration — toggle on / off'}
                onClick={() => updateCharacter('status.inspiration', !inspiration)}
                glyph="★"
                active={!!inspiration}
                activeColor="var(--accent-yellow)"
              />
              <PortraitCornerIcon
                pos="bl"
                title="Long Rest — HP, Spell Slots & Resources reset."
                onClick={longRest}
                glyph="LR"
              />
              <PortraitCornerIcon
                pos="br"
                title="Short Rest — Hit Dice & matching resources recover."
                onClick={shortRest}
                glyph="SR"
              />
            </div>

          {/* Attunement-Counter. Mittig unter dem Portrait, knappes
              "Attuned X/Y" — über Limit wird's rot, damit ein
              Overflow sofort auffällt. Nur Items mit reqAttune
              tragen zur Zählung bei (s. Berechnung oben). */}
          <div style={{
            textAlign: 'center',
            fontSize: 11,
            color: attunedCount > attuneMax ? 'var(--accent-red)' : 'var(--text-muted)',
            marginTop: 4,
            marginBottom: 6,
            letterSpacing: 0.3,
          }}
          title={attunedCount > attuneMax ? 'Über dem Attunement-Limit' : 'Attunement-Slots'}>
            Attuned {attunedCount}/{attuneMax}
          </div>

          {/* Currency — kompakt unter dem Portrait. War vorher in der
              Identity-Strip oben, sitzt jetzt hier damit der obere
              Bereich für den Combat-Tracker frei ist. */}
          {!readOnly && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 4,
              marginBottom: 12, justifyContent: 'center',
            }}>
              {COIN_TYPES.map(({ key, label, color }) => (
                <label key={key} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '1px 4px', borderRadius: 4,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: 10,
                }}>
                  <span style={{ color, fontWeight: 700, letterSpacing: 0.3 }}>
                    {label.slice(0, 2).toUpperCase()}
                  </span>
                  <input
                    type="number" min="0" inputMode="numeric"
                    value={(character.inventory?.currency || {})[key] ?? 0}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const v = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0)
                      updateCharacter(`inventory.currency.${key}`, v)
                    }}
                    style={{
                      width: 36, padding: '1px 3px', fontSize: 10,
                      background: 'transparent', color: 'var(--text-primary)',
                      border: 'none', textAlign: 'right', fontFamily: 'inherit',
                    }}
                  />
                </label>
              ))}
            </div>
          )}

          <SideSection title="Ability Scores" defaultOpen>
            <div style={S.abilityGrid}>
              {['str','dex','con','int','wis','cha'].map(key => {
                const score = abilityScores[key]
                const mod = modifiers[key]
                // The old box showed the breakdown (base / racial /
                // background / feat). The dedicated "Saving Throws"
                // section below was redundant info for the same six
                // abilities, so we merged: each box now carries its
                // ability mod (top) + score (middle) + the matching
                // saving throw with a proficiency dot (bottom).
                const save = computed?.savingThrows?.[key]
                return (
                  <div key={key} style={S.abilityBox}>
                    <div style={S.abilityAbbr}>{key.toUpperCase()}</div>
                    <div style={S.abilityMod}>{modStr(mod)}</div>
                    <div style={S.abilityScore}>{score}</div>
                    {save && (
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: 4, marginTop: 4,
                        fontSize: 11, color: 'var(--text-muted)',
                      }} title={save.proficient ? 'Proficient' : 'Not Proficient'}>
                        <span style={{
                          width: 7, height: 7, borderRadius: '50%',
                          background: save.proficient ? 'var(--accent)' : 'var(--border-strong)',
                        }} />
                        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>SAVE</span>
                        <span style={{ color: save.proficient ? 'var(--accent)' : 'var(--text-primary)', fontWeight: 700 }}>
                          {modStr(save.total)}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {/* Save notes (Evasion etc.) were lost when the dedicated
                section was removed — keep them right under the ability
                grid so the player can still see them. */}
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
                    {/* Passive score = 10 + total modifier (incl.
                        observant / proficiency / etc. baked into
                        data.total by computeSkills). Slightly muted
                        so the active modifier reads as the primary
                        number; old "Senses" section retired. */}
                    <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontWeight: 500, fontSize: 11 }}>
                      ({10 + (data.total || 0)})
                    </span>
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

          {/* Senses section removed — passive Perception is now shown
              inline next to the Perception skill ("+8 (18)"), the
              same pattern works for Investigation and Insight. */}
        </div>

        {/* ── MAIN ── */}
        <div className="dnd-sheet-main" style={S.main}
          data-popout-size={isPopout ? popoutSize.size : undefined}>
          {/* Popout-Mode: kompakter Stat-Bar oben statt der breiten
              CombatStat-Kacheln. Beinhaltet HP + AC/Init/Spd/PP +
              Conditions + Concentration + Inspiration + Action-Economy
              + (bei Bedarf) Death Saves. Adaptiert sich an popoutSize. */}
          {isPopout && (
            <PopoutStatBar
              character={character}
              computed={computed}
              abilityScores={abilityScores}
              hp={hp}
              size={popoutSize.size}
              updateCharacter={updateCharacter}
              applyCharacter={applyCharacter}
              onOpenConditions={() => setPopoutConditionsOpen(true)}
              onClose={closePopoutWindow}
              activeTab={popoutTab}
              onTabChange={setPopoutTab}
              readOnly={readOnly}
            />
          )}
          {/* Combat stat tiles — moved INTO the right pane so the
              sidebar can stretch up to the very top of the page. The
              tiles auto-fit across the remaining width, sidebar edge
              to right edge. Im Popout wird die Bar durch PopoutStatBar
              ersetzt (s.o.). */}
          {!isPopout && <div style={{
            ...S.combatBar,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))',
            gap: 8,
          }}>
            <CombatStat label="Armor Class" value={ac} color="var(--accent-blue)" />
            <CombatStat label="Initiative" value={modStr(initiative)} color="var(--accent-purple)" />
            <CombatStat label="Speed" value={`${speed} ft.`} color="var(--accent-green)" />
            <CombatStat
              label="Hit Points"
              color="var(--accent-red)"
              onClick={() => setActiveTab('overview')}
              value={
                <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
                  <span>{hp.current}/{hp.max}</span>
                  {hp.temporary > 0 && (
                    <span style={{
                      fontSize: '0.55em', fontWeight: 700,
                      color: 'var(--accent-green)',
                    }}>+{hp.temporary}</span>
                  )}
                </span>
              }
            />
            <CombatStat label="Proficiency" value={modStr(profBonus)} color="var(--accent-yellow)" />
            <CombatStat label="Passive Perception" value={computed?.passivePerception ?? 10} color="var(--text-muted)" />
          </div>}

          {/* Im Popout wird die Tab-Leiste weggelassen. Das Popout ist
              auf die Overview-Spalten beschränkt — der Spieler kann
              nicht zu Features / Inventory etc. navigieren, das gehört
              ins Hauptfenster. */}
          {!isPopout && <div data-pwa-target="dnd-sheet-tabs" style={S.tabs}>
            {TABS.map(tab => (
              <button key={tab.id}
                style={{ ...S.tab, ...(activeTab === tab.id ? S.tabActive : {}) }}
                onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>}

          <div style={S.tabContent} inert={readOnly ? '' : undefined}>
            {activeTab === 'overview' && (
              <OverviewTab character={character} computed={computed} abilityScores={abilityScores}
                hp={hp} updateCharacter={updateCharacter} applyCharacter={applyCharacter}
                charId={id} session={session} onReload={loadCharacter}
                onNavigateTab={setActiveTab}
                inPopout={isPopout} popoutSize={popoutSize.size}
                popoutTab={popoutTab}
                openConditions={popoutConditionsOpen}
                onCloseConditions={() => setPopoutConditionsOpen(false)}
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
            {activeTab === 'features' && (
              <FeaturesTab
                character={character}
                computed={computed}
                updateCharacter={updateCharacter}
                applyCharacter={applyCharacter}
                expanded={featuresExpanded}
                setExpanded={setFeaturesExpanded}
              />
            )}
            {activeTab === 'personality' && (
              <PersonalityTab character={character} updateCharacter={updateCharacter} />
            )}
            {activeTab === 'history' && (
              <LevelHistoryTab
                character={character}
                readOnly={readOnly}
                onUndo={async () => {
                  const { undoLevelUp } = await import('../lib/levelUpEngine')
                  const restored = undoLevelUp(character, 0)
                  if (!restored) { alert('Kein Snapshot verfügbar.'); return }
                  if (character.appearance?.portrait) {
                    restored.appearance = { ...(restored.appearance || {}), portrait: character.appearance.portrait }
                  }
                  await supabase.from('dnd_characters')
                    .update({ data: restored, name: restored.info.name })
                    .eq('id', id).eq('user_id', session.user.id)
                  loadCharacter()
                }}
              />
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

// Slim always-visible header strip — replaces the full desktop header
// during play. Click the chevron to drop the full bar in as an overlay.
const headerToggleBar = {
  display: 'flex', alignItems: 'center', gap: 8,
  background: 'var(--bg-panel)',
  borderBottom: '1px solid var(--border)',
  padding: '4px 10px',
  flexShrink: 0,
  position: 'relative',
  zIndex: 10,
}
const headerToggleBtn = {
  background: 'transparent', border: 'none',
  color: 'var(--accent)', cursor: 'pointer',
  padding: '2px 8px', fontSize: 12, fontFamily: 'inherit', lineHeight: 1,
}
const headerToggleTitle = {
  fontSize: 13, fontWeight: 700,
  color: 'var(--text-primary)',
  flex: 1, minWidth: 0,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
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
  // Plain text lines — no pill chips, no extra wrapper section.
  // The sidebar shrinks vertically when the player has lots of hints
  // so seeing them at a glance beats hover-only access.
  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {items.map(n => (
        <div
          key={n.id}
          title={`${n.feature} — ${n.text}`}
          style={{
            fontSize: 11, lineHeight: 1.35, color: 'var(--text-secondary)',
            cursor: 'help',
          }}
        >
          {n.prefix && (
            <span style={{ color: 'var(--text-dim)', fontWeight: 700, fontSize: 10, marginRight: 4 }}>
              {n.prefix}
            </span>
          )}
          <span style={{ color: 'var(--accent)' }}>{abbreviateNote(n.text)}</span>
        </div>
      ))}
    </div>
  )
}

// Aggressive heuristic abbreviation — pure regex over both English
// (5etools rule text) and German (curated catalog) phrasings.
// Compresses noise to 2-3 word hints like "Adv vs. Charmed",
// "Sleep Immune", "Darkvision 60ft", "Resist Fire". New traits with
// similar wording benefit automatically — no per-feature table.
function cap(w) { return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '' }

// Small German→English condition map used only inside the abbreviator
// — keeps the chip readable in English even when the source catalog
// is in German.  Not a "translation table" of all rules; just the
// nouns that appear after "vs./Resist/Immune".
const DE_NOUN = {
  feuer: 'Fire', kälte: 'Cold', kaelte: 'Cold', säure: 'Acid', saeure: 'Acid',
  blitz: 'Lightning', donner: 'Thunder', strahlend: 'Radiant', strahlenden: 'Radiant',
  nekrotisch: 'Necrotic', nekrotischen: 'Necrotic',
  gift: 'Poison', psychisch: 'Psychic', psychischen: 'Psychic',
  kraft: 'Force', wucht: 'Bludgeoning',
  hieb: 'Slashing', stich: 'Piercing',
  bezaubert: 'Charmed', verängstigt: 'Frightened', verängstigung: 'Frightened',
  gelähmt: 'Paralyzed', betäubt: 'Stunned',
  blind: 'Blinded', taub: 'Deafened',
  versteinert: 'Petrified', vergiftet: 'Poisoned',
  schlaf: 'Sleep', erschöpfung: 'Exhaustion',
  magie: 'Magic', initiative: 'Init',
}
function translateNoun(w) {
  if (!w) return ''
  const k = w.toLowerCase()
  return DE_NOUN[k] || cap(w)
}

function abbreviateNote(text) {
  let s = String(text || '').trim()
  // Catch sense-range traits FIRST and replace the WHOLE string —
  // these have noisy German/English explanation tails ("…in
  // Dämmerlicht / 60 ft. schwach in Dunkelheit") we don't want.
  // Player reads "Darkvision: 60 ft." and is done.
  const senseMatch =
    s.match(/\b(darkvision|blindsight|tremorsense|truesight)\b[^0-9]*?(\d+)\s*(?:ft|feet|foot|fuß)\.?/i)
  if (senseMatch) {
    return `${cap(senseMatch[1])}: ${senseMatch[2]} ft.`
  }
  // Drop the leading "FeatureName: " prefix only for non-canonical
  // traits — keeping the prefix here would double up with the
  // feature label that's already in the hover tooltip. For canonical
  // sense traits the sense-match branch above already handled it.
  s = s.replace(/^[A-ZÄÖÜ][\wäöüß'’\- ]{1,40}:\s+/, '').trim()

  // ── High-frequency exact phrases ──
  s = s
    // English: "magic can't put you to sleep"
    .replace(/\b(?:magic\s+)?(?:can(?:'t| not)|cannot)\s+(?:be\s+)?put(?:\s+you)?\s+to\s+sleep(?:\s+by\s+magic)?\b/gi, 'Sleep Immune')
    .replace(/\byou\s+can(?:'t| not)\s+be\s+put\s+to\s+sleep\b/gi, 'Sleep Immune')
    // German: "Magie kann dich nicht ... Schlaf"
    .replace(/\bmagie\s+kann\s+(?:dich\s+)?nicht\s+(?:in\s+den\s+)?schlaf(?:\s+versetzen)?\b/gi, 'Sleep Immune')
    // Speed — both English and German prefix.
    .replace(/\b(?:your\s+|deine\s+|grund-?\s*)?(?:walking\s+|base\s+|grund-?)?(?:speed|geschwindigkeit)\s+(?:is\s+|of\s+|ist\s+)?(\d+)\s*(?:ft|feet|foot|fuß)\.?\b/gi,
      (_, n) => `Speed ${n}ft`)
    // HP per level
    .replace(/\+\s*(\d+)\s+hp\s+(?:per|pro|each)\s+(?:character\s+|class\s+)?level\b/gi, '+$1 HP/Lv')
    // English condition immunity
    .replace(/\byou\s+can(?:'t| not)\s+be\s+(charmed|frightened|poisoned|paralyzed|stunned|deafened|blinded|grappled|petrified)\b/gi,
      (_, cond) => `${cap(cond)} Immune`)
    // German condition immunity ("immun gegen Gift")
    .replace(/\bimmun(?:ität)?\s+gegen\s+([\wäöüß]+)/gi, (_, w) => `${translateNoun(w)} Immune`)

  // ── Concentration saves ──
  s = s
    .replace(/\bkonzentrations(?:rettungswurf|saves)?\s*(?:durch|bei|gegen)?\s*schaden\b/gi, 'Conc. Dmg')
    .replace(/\bconcentration\s+(?:saves?|saving throws?)?\s*(?:caused\s+by|from|on)?\s*damage\b/gi, 'Conc. Dmg')
    .replace(/\bconcentration\s+(?:saves?|saving throws?)\b/gi, 'Conc. Save')

  // ── Resistance / Immunity / Vulnerability + type ──
  s = s
    .replace(/\bresistance\s+to\s+(\w+)(?:\s+damage)?\b/gi, (_, w) => 'Resist ' + translateNoun(w))
    .replace(/\bresistenz\s+gegen\s+([\wäöüß]+)(?:\s+schaden)?\b/gi, (_, w) => 'Resist ' + translateNoun(w))
    .replace(/\bimmunity\s+to\s+(\w+)(?:\s+damage)?\b/gi, (_, w) => 'Immune ' + translateNoun(w))
    .replace(/\bvulnerability\s+to\s+(\w+)(?:\s+damage)?\b/gi, (_, w) => 'Vuln. ' + translateNoun(w))
    .replace(/\bverwundbarkeit\s+gegen\s+([\wäöüß]+)\b/gi, (_, w) => 'Vuln. ' + translateNoun(w))

  // ── Multi-ability saves ──
  s = s.replace(
    /\b((?:str|dex|con|int|wis|cha)(?:\s*[\/, ]\s*(?:str|dex|con|int|wis|cha))+)\s+(?:saves?|saving throws?)\s+(?:vs|against)\s+(\w+)/gi,
    (_, abils, against) => abils.toUpperCase().replace(/[\s,]+/g, '/') + ' vs. ' + translateNoun(against),
  )

  // ── Single saves (English) ──
  s = s
    .replace(/\b(?:saves?|saving throws?)\s+(?:vs|against)\s+being\s+(\w+)/gi, (_, w) => 'vs. ' + translateNoun(w))
    .replace(/\b(?:saves?|saving throws?)\s+(?:vs|against)\s+(\w+)/gi, (_, w) => 'vs. ' + translateNoun(w))
    .replace(/\b(\w+)\s+(?:saves?|saving throws?)\b/gi, (_, w) => 'vs. ' + translateNoun(w))

  // ── German "Vorteil/Nachteil" patterns ──
  s = s
    // "Vorteil gegen X" / "Vorteil auf X" → "Adv vs. X"
    .replace(/\bvorteil(?:\s+auf|gegen)?\s+(?:rettungswürfe[n]?\s+)?(?:gegen\s+)?([\wäöüß]+)/gi, (_, w) => 'Adv vs. ' + translateNoun(w))
    .replace(/\bvorteil\b/gi, 'Adv')
    .replace(/\bnachteil(?:\s+auf|gegen)?\s+(?:rettungswürfe[n]?\s+)?(?:gegen\s+)?([\wäöüß]+)/gi, (_, w) => 'Dis vs. ' + translateNoun(w))
    .replace(/\bnachteil\b/gi, 'Dis')
    .replace(/\brettungswürfe[n]?\s+gegen\s+([\wäöüß]+)/gi, (_, w) => 'vs. ' + translateNoun(w))
    .replace(/\brettungswürfe[n]?\b/gi, 'Save')

  // ── Adv / Dis ──
  s = s
    .replace(/\badvantage\s+on\b/gi, 'Adv')
    .replace(/\badvantage\b/gi, 'Adv')
    .replace(/\bdisadvantage\s+on\b/gi, 'Dis')
    .replace(/\bdisadvantage\b/gi, 'Dis')

  // ── Ability check shortenings ──
  s = s
    .replace(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+(?:ability\s+)?checks?\b/gi,
      (_, ab) => ab.slice(0, 3).toUpperCase() + ' check')
    .replace(/\bcharismaprob[a-zäöüß]+/gi, 'CHA check') // German "Charisma-Probe"
    .replace(/\b(stärke|geschicklichkeit|konstitution|intelligenz|weisheit|charisma)\s*(?:-|\s)?prob(?:e|en|enwurf)?\b/gi, (_, ab) => {
      const k = ab.toLowerCase()
      return ({ stärke: 'STR', geschicklichkeit: 'DEX', konstitution: 'CON',
                intelligenz: 'INT', weisheit: 'WIS', charisma: 'CHA' })[k] + ' check'
    })

  // ── Tidy leftovers ──
  s = s
    .replace(/\bwhenever\s+(?:you\s+)?make\s+(?:an?|a)\s+/gi, '')
    .replace(/\byou\s+can\s+add\s+your\s+(\w+)\s+modifier\b/gi, '+ $1 mod')
    .replace(/\byou\s+have\s+/gi, '')
    .replace(/\byou\s+gain\s+/gi, '')
    .replace(/\byou\s+/gi, '')
    .replace(/\bdu\s+hast\s+/gi, '')
    .replace(/\bdu\s+gewinnst\s+/gi, '')
    .replace(/\bdu\s+/gi, '')
    .replace(/\bbeing\s+/gi, '')
    .replace(/\bgegen\s+das\s+/gi, 'vs. ')
    .replace(/\bgegen\b/gi, 'vs.')
    .replace(/\bagainst\b/gi, 'vs.')
    .replace(/\b(damage|dmg|schaden|schadens?)\b/gi, 'Dmg')
    .replace(/\bproficiency\b/gi, 'Prof')
    .replace(/\bbonus\s+gleich\s+deinem?\s+(\w+)\b/gi, '+ $1 mod')
    .replace(/\bdoppelte\s+(?:reichweite|distanz)\b/gi, 'doppelte Reichweite')
    // Collapse double "vs."
    .replace(/\bvs\.?\s+vs\.?/gi, 'vs.')
    .replace(/\bvs\s+\./g, 'vs.')

  s = s.replace(/\s+/g, ' ').trim()
  if (s) s = s[0].toUpperCase() + s.slice(1)
  // Sidebar hints render as plain text lines now (no pill chips), so
  // the chip-fit truncation is gone — full hint is visible. The
  // `title` tooltip still carries the original verbose text if the
  // player wants the rule context.
  return s
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

// Small icon at a portrait corner. `pos` = tl/tr/bl/br; `glyph` is
// the visible character (emoji or short string like "Lv7"); `active`
// + `activeColor` colour the icon when toggled on; `static` makes the
// icon non-clickable (used for the level badge).
// Standalone "History" tab — the chronological level-up trail moved
// out of Overview so the latter can stay focused on play. Only the
// newest entry has an Undo button (per-snapshot restore).
function LevelHistoryTab({ character, readOnly, onUndo }) {
  const entries = character.levelHistory || []
  const progLabel = (p) =>
    p === 'full' ? 'Full'
    : (p === 'half' || p === '1/2' || p === 'artificer') ? '½'
    : p === '1/3' ? '⅓'
    : p === 'pact' ? 'Pact' : p
  // Class summary moved here from Overview — sits above the level
  // history so the player sees "who am I + what did I take when".
  const classSummary = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {(character.classes || []).map((c, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '8px 12px', background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)', borderRadius: 8,
        }}>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{c.classId}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Lv. {c.level}</span>
          {c.subclassId && (
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 999,
              border: '1px solid var(--accent-purple)', color: 'var(--accent-purple)',
            }} title={c.subclassTitle || 'Subclass'}>{c.subclassId.split('__')[0]}</span>
          )}
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 999,
            border: '1px solid var(--accent-blue)', color: 'var(--accent-blue)',
          }} title="Hit Die">d{c.hitDie}</span>
          {c.spellcastingAbility && (
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 999,
              border: '1px solid var(--accent-yellow)', color: 'var(--accent-yellow)',
            }} title="Casting Ability">{c.spellcastingAbility.toUpperCase()}</span>
          )}
          {c.casterProgression && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }} title="Caster Progression">
              {progLabel(c.casterProgression)}
            </span>
          )}
        </div>
      ))}
    </div>
  )

  if (entries.length === 0) {
    return (
      <div className="dnd-sheet-tab-body" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {classSummary}
        <div style={{ color: 'var(--text-muted)' }}>Noch keine Level-Ups protokolliert.</div>
      </div>
    )
  }
  return (
    <div className="dnd-sheet-tab-body" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {classSummary}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[...entries].reverse().map((entry, i) => {
        const cls = character.classes.find(c => c.classId === entry.classId)
        const lc = cls?.levelChoices?.[entry.classLevel] || {}
        const details = []
        if (lc.type === 'asi') {
          const parts = Object.entries(lc.improvements || {}).map(([k, v]) => `${k.toUpperCase()} +${v}`)
          if (parts.length > 0) details.push(`ASI: ${parts.join(', ')}`)
        }
        if (lc.type === 'feat' && lc.featId) details.push(`Feat: ${lc.featId}`)
        if (lc.cantrips?.length > 0) details.push(`Cantrips: ${lc.cantrips.join(', ')}`)
        if (lc.knownSpells?.length > 0) details.push(`Spells: ${lc.knownSpells.join(', ')}`)
        if (lc.optionalFeatures?.length > 0) details.push(lc.optionalFeatures.map(f => f.name).join(', '))
        return (
          <div key={i} style={{
            padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 8,
            border: i === 0 ? '1px solid var(--accent-red)' : '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <div style={{ color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 }}>
                  {entry.classId} Lv.{entry.classLevel}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 'normal', marginLeft: 8, fontSize: 11 }}>
                    Total Lv.{entry.totalLevel} · {new Date(entry.timestamp).toLocaleDateString('de-DE')}
                  </span>
                </div>
                {details.length > 0 && (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginTop: 3 }}>{details.join(' · ')}</div>
                )}
              </div>
              {!readOnly && i === 0 && entry.snapshot && (
                <button
                  type="button"
                  onClick={onUndo}
                  style={{
                    padding: '4px 10px', fontSize: 11,
                    background: 'transparent', border: '1px solid var(--accent-red)',
                    color: 'var(--accent-red)', borderRadius: 4, cursor: 'pointer',
                  }}
                >Undo</button>
              )}
            </div>
          </div>
        )
      })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// SHORT REST PROMPT
// Guided modal: per-class hit-die rolls + dynamic HP preview. The
// player rolls a die (or enters a value) for each die they want to
// spend; the new HP is previewed live. Confirm commits the spent
// dice (used for future displays + long-rest recovery) and gives
// the matching HP back, capped at max.
// ─────────────────────────────────────────────────────────────────
function ShortRestPrompt({ character, computed, abilityScores, maxHp, currentHp, onClose, onConfirm }) {
  const conMod = getModifier(abilityScores?.con ?? 10)
  const hitDiceUsed = character.status?.hitDiceUsed || {}
  const classes = (character.classes || []).filter(c => c.level > 0)

  // Per-class roll state: array of integers (one per spent die).
  const [rolls, setRolls] = useState(() =>
    Object.fromEntries(classes.map(c => [c.classId, []]))
  )

  // Dynamic HP preview: each entered value contributes (roll + CON mod,
  // minimum 1 per RAW). Empty inputs count as 0 (don't auto-add). Cap
  // at maxHp; if we'd overflow we visually surface "voll" so the
  // player knows the next die is wasted.
  const totalGain = useMemo(() => {
    let g = 0
    for (const cls of classes) {
      for (const r of (rolls[cls.classId] || [])) {
        const n = Number(r)
        if (!Number.isFinite(n) || n <= 0) continue
        g += Math.max(1, n + conMod)
      }
    }
    return g
  }, [rolls, conMod, classes])
  const previewedHp = Math.min(maxHp, currentHp + totalGain)
  const wouldBeFull = previewedHp >= maxHp

  function addRoll(classId) {
    if (wouldBeFull) return
    // Empty entry — the player types the rolled value.
    setRolls(prev => ({ ...prev, [classId]: [...(prev[classId] || []), ''] }))
  }
  function setRoll(classId, idx, value) {
    setRolls(prev => {
      const arr = [...(prev[classId] || [])]
      arr[idx] = value
      return { ...prev, [classId]: arr }
    })
  }
  function removeRoll(classId, idx) {
    setRolls(prev => {
      const arr = [...(prev[classId] || [])]
      arr.splice(idx, 1)
      return { ...prev, [classId]: arr }
    })
  }

  function confirm() {
    const diceSpent = {}
    for (const cls of classes) {
      // Only count entries with a real rolled value as spent — blank
      // slots are uncommitted and the player keeps the die.
      diceSpent[cls.classId] = (rolls[cls.classId] || []).filter(r => {
        const n = Number(r); return Number.isFinite(n) && n > 0
      }).length
    }
    onConfirm({ hpGain: totalGain, diceSpent })
  }

  // Short-rest resources that will reset (Pact slots, Channel Divinity etc.)
  const shortResetResources = (computed?.resources || []).filter(r => r.recharge === 'short_rest')
  // Classes whose Spellcasting feature allows spell-prep changes on a
  // short rest — surface only the relevant hint. (e.g. some 5.5e
  // class features that say "during a Short Rest, you can swap …")
  const prepHintsAll = useMemo(() => extractPrepHints(character), [character])
  const shortRestPrepHints = prepHintsAll.filter(h => h.restPhase === 'short')

  return (
    <div onClick={onClose} style={restOverlay}>
      <div onClick={(e) => e.stopPropagation()} style={restModal}>
        <div style={restTitle}>Short Rest</div>

        <div style={restHpStrip}>
          <span>HP: <b>{currentHp}</b> / {maxHp}</span>
          <span style={{ color: 'var(--text-dim)' }}>→</span>
          <span style={{ color: wouldBeFull ? 'var(--accent-green)' : 'var(--accent-yellow)', fontWeight: 700 }}>
            {previewedHp} / {maxHp}
            {wouldBeFull && ' (voll)'}
          </span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 12 }}>
            CON-Mod {modStr(conMod)} pro Würfel
          </span>
        </div>

        {classes.map(cls => {
          const used = hitDiceUsed[cls.classId] || 0
          const max = cls.level
          const spent = (rolls[cls.classId] || []).length
          const available = Math.max(0, max - used - spent)
          return (
            <div key={cls.classId} style={restClassBlock}>
              <div style={restClassHead}>
                <span style={{ fontWeight: 700 }}>{cls.classId}</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  d{cls.hitDie} · verfügbar {available}/{max - used}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(rolls[cls.classId] || []).map((r, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="number" min="1" max={cls.hitDie} value={r}
                      placeholder={`d${cls.hitDie}`}
                      onChange={e => {
                        const v = e.target.value
                        if (v === '') { setRoll(cls.classId, i, ''); return }
                        const parsed = parseInt(v, 10)
                        if (!Number.isFinite(parsed)) { setRoll(cls.classId, i, ''); return }
                        setRoll(cls.classId, i, Math.max(1, Math.min(cls.hitDie, parsed)))
                      }}
                      style={restRollInput}
                    />
                    <span style={{ color: 'var(--text-dim)', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {conMod >= 0 ? `+${conMod}` : `−${Math.abs(conMod)}`} CON
                    </span>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => addRoll(cls.classId)}
                  disabled={available <= 0 || wouldBeFull}
                  style={{
                    ...restRollBtn,
                    opacity: (available <= 0 || wouldBeFull) ? 0.4 : 1,
                    cursor: (available <= 0 || wouldBeFull) ? 'not-allowed' : 'pointer',
                  }}
                  title={wouldBeFull ? 'HP wäre voll' : `Würfel d${cls.hitDie} verbrauchen — Wert eintragen`}
                >+ d{cls.hitDie}</button>
              </div>
            </div>
          )
        })}

        {shortResetResources.length > 0 && (
          <div style={restNoteBox}>
            <div style={restNoteTitle}>Außerdem refreshed:</div>
            <ul style={restNoteList}>
              <li>Pact-Slots (Warlock)</li>
              {shortResetResources.map(r => <li key={r.id}>{r.name}</li>)}
            </ul>
          </div>
        )}

        {shortRestPrepHints.length > 0 && (
          <div style={{ ...restNoteBox, borderColor: 'var(--accent)' }}>
            <div style={restNoteTitle}>Spell-Preparation</div>
            <ul style={restNoteList}>
              {shortRestPrepHints.map((h, i) => (
                <li key={`${h.classId}-${i}`}>
                  <b>{h.classId}</b>{h.featureName && h.featureName !== 'Spellcasting' ? ` · ${h.featureName}` : ''}: {h.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={restButtons}>
          <button type="button" onClick={onClose} style={restBtnSecondary}>Abbrechen</button>
          <button type="button" onClick={confirm} style={restBtnPrimary}>Short Rest bestätigen</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// LONG REST PROMPT
// Reminders modal — lists what's about to refresh + prep reminders
// per prepared caster class (no enforcement; player still chooses).
// ─────────────────────────────────────────────────────────────────
// Scan __activeFeatures for paragraphs in the class's Spellcasting /
// Pact Magic / etc. that explain WHEN the player can prepare spells.
// Pure regex over the 5etools rule text — no per-class catalogue, so
// edition-specific wording (XPHB "during a Long Rest", PHB "after a
// Long Rest", subclass "you may swap one prepared spell when you
// finish a Short Rest") all surface for free.
//
// Returns array of `{ classId, restPhase: 'long'|'short'|'any', text }`.
function extractPrepHints(character) {
  const features = character?.__activeFeatures || []
  const headerRe = /\b(?:spellcasting|prepared\s+spells|preparation|change\s+(?:your\s+)?prepared|pact\s+magic)\b/i
  // 5etools wraps rule-link words in tags like "{@variantrule Long
  // Rest|XPHB}", so the plain-text `long rest` regex would never
  // match the wrapped form. Strip tags BEFORE every match.
  const stripTags = (s) => String(s || '').replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
  const out = []
  for (const f of features) {
    if (!f?.classId || !Array.isArray(f.entries)) continue
    const walk = (node, hits) => {
      if (typeof node === 'string') {
        const clean = stripTags(node)
        const low = clean.toLowerCase()
        if (!/\b(prepar|prepared|change(?:s|d)?\s+(?:your\s+)?(?:list\s+of\s+)?prepared|swap)\b/.test(low)) return
        const restMatch = low.match(/\b(long|short)\s+rest\b/)
        if (!restMatch && !/\b(daily|each\s+day|after\s+each\s+adventure)\b/.test(low)) return
        const phase = restMatch ? restMatch[1] : 'any'
        hits.push({ phase, text: clean.length > 240 ? clean.slice(0, 238) + '…' : clean })
      } else if (Array.isArray(node)) {
        for (const x of node) walk(x, hits)
      } else if (node && typeof node === 'object') {
        if (Array.isArray(node.entries)) walk(node.entries, hits)
        if (Array.isArray(node.items))   walk(node.items, hits)
      }
    }
    // Header gating tested on tag-stripped strings too — XPHB wraps
    // the parent feature names in {@variantrule …} occasionally.
    const firstStr = stripTags((f.entries || []).find(e => typeof e === 'string') || '')
    if (!headerRe.test(stripTags(f.name || '')) && !headerRe.test(firstStr)) continue
    const hits = []
    walk(f.entries, hits)
    for (const h of hits) {
      out.push({ classId: f.classId, restPhase: h.phase, text: h.text, featureName: f.name })
    }
  }
  return out
}

function LongRestPrompt({ character, computed, onClose, onConfirm }) {
  const classes = character.classes || []
  // Data-driven prep hints — show the actual rule text the class's
  // Spellcasting feature uses for "when can I prepare", filtered to
  // long-rest-relevant lines (plus "any" which fits both rests).
  const prepHintsAll = useMemo(() => extractPrepHints(character), [character])
  const prepHints = prepHintsAll.filter(h => h.restPhase === 'long' || h.restPhase === 'any')

  const hitDiceUsed = character.status?.hitDiceUsed || {}
  const hitDiceRecovery = classes.map(c => {
    const max = c.level
    const used = hitDiceUsed[c.classId] || 0
    const recover = Math.min(used, Math.ceil(max / 2))
    return { classId: c.classId, die: c.hitDie, recover, after: Math.max(0, used - recover), max }
  }).filter(h => h.max > 0)

  return (
    <div onClick={onClose} style={restOverlay}>
      <div onClick={(e) => e.stopPropagation()} style={restModal}>
        <div style={restTitle}>Long Rest</div>

        <div style={restNoteBox}>
          <div style={restNoteTitle}>Folgendes wird wiederhergestellt:</div>
          <ul style={restNoteList}>
            <li>HP voll</li>
            <li>Spell Slots</li>
            <li>Pact-Slots</li>
            <li>Alle Class Resources</li>
            <li>Death Saves &amp; Concentration zurückgesetzt</li>
          </ul>
        </div>

        {hitDiceRecovery.length > 0 && (
          <div style={restNoteBox}>
            <div style={restNoteTitle}>Hit Dice recoveriert (½ aufgerundet pro Klasse):</div>
            <ul style={restNoteList}>
              {hitDiceRecovery.map(h => (
                <li key={h.classId}>
                  {h.classId} d{h.die}: +{h.recover} → {h.max - h.after}/{h.max} verfügbar
                </li>
              ))}
            </ul>
          </div>
        )}

        {prepHints.length > 0 && (
          <div style={{ ...restNoteBox, borderColor: 'var(--accent)' }}>
            <div style={restNoteTitle}>Spell-Preparation</div>
            <ul style={restNoteList}>
              {prepHints.map((h, i) => (
                <li key={`${h.classId}-${i}`}>
                  <b>{h.classId}</b>{h.featureName && h.featureName !== 'Spellcasting' ? ` · ${h.featureName}` : ''}: {h.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={restButtons}>
          <button type="button" onClick={onClose} style={restBtnSecondary}>Abbrechen</button>
          <button type="button" onClick={onConfirm} style={restBtnPrimary}>Long Rest bestätigen</button>
        </div>
      </div>
    </div>
  )
}

const restOverlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
}
const restModal = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
  padding: 18, width: 'min(540px, 92vw)', maxHeight: '88vh', overflowY: 'auto',
  boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
  display: 'flex', flexDirection: 'column', gap: 10,
}
const restTitle = {
  fontSize: 16, fontWeight: 700, color: 'var(--accent)',
  textTransform: 'uppercase', letterSpacing: 0.5,
}
const restHpStrip = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 10px', borderRadius: 8,
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
  fontSize: 13,
}
const restClassBlock = {
  padding: '8px 10px', borderRadius: 6,
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
}
const restClassHead = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6,
  fontSize: 12,
}
// (restRollChip + restRollX removed — the chip wrapped the input with
// transparent borders and the entered digit got visually buried; the
// input now stands on its own with a real border, and the + CON label
// sits beside it as a separate span.)
const restRollInput = {
  width: 48, background: 'var(--bg-inset)',
  border: '1px solid var(--border)', outline: 'none', borderRadius: 4,
  color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 13,
  textAlign: 'center', fontWeight: 700,
  padding: '4px 6px',
}
const restRollBtn = {
  padding: '4px 10px', borderRadius: 999,
  border: '1px solid var(--accent)', background: 'transparent',
  color: 'var(--accent)', fontSize: 12, fontFamily: 'inherit',
}
const restNoteBox = {
  padding: '8px 10px', borderRadius: 6,
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
  fontSize: 12,
}
const restNoteTitle = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 4,
}
const restNoteList = {
  margin: 0, paddingLeft: 18,
  color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5,
}
const restButtons = {
  display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4,
}
const restBtnPrimary = {
  padding: '6px 14px', borderRadius: 6,
  background: 'var(--accent)', border: '1px solid var(--accent)',
  color: 'var(--bg-card)', fontWeight: 600, cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 13,
}
const restBtnSecondary = {
  padding: '6px 14px', borderRadius: 6,
  background: 'transparent', border: '1px solid var(--border)',
  color: 'var(--text-secondary)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 13,
}

function PortraitCornerIcon({ pos, title, glyph, onClick, active = false, activeColor, static: isStatic = false }) {
  const offset = 4
  const placement = {
    tl: { top: offset, left: offset },
    tr: { top: offset, right: offset },
    bl: { bottom: offset, left: offset },
    br: { bottom: offset, right: offset },
  }[pos] || {}
  const baseColor = active ? (activeColor || 'var(--accent)') : 'var(--text-secondary)'
  const borderCol = active ? (activeColor || 'var(--accent)') : 'var(--border)'
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (!isStatic && onClick) onClick() }}
      title={title}
      style={{
        position: 'absolute', ...placement,
        width: 28, height: 28, borderRadius: '50%',
        background: 'color-mix(in srgb, var(--bg-elevated) 92%, transparent)',
        border: `1.5px solid ${borderCol}`,
        color: baseColor,
        cursor: isStatic ? 'default' : 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: glyph.length > 2 ? 10 : 14,
        fontWeight: 700, fontFamily: 'inherit',
        padding: 0, lineHeight: 1,
        boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
      }}
    >
      {glyph}
    </button>
  )
}

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
