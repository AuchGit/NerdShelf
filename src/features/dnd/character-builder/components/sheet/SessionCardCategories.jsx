// components/sheet/SessionCardCategories.jsx
//
// In-card expandable lookup panels for the GM session view. The GM picks
// a category (Inventory / Spells / Features / Feats) and the matching
// section unfolds inline so they don't have to open the full character
// sheet for a quick rules lookup. Each entry inside a section is itself
// collapsible to surface its description on demand.
//
// Data sources reuse the existing app primitives:
//   - Inventory  : character.inventory.items + character.custom.items
//   - Spells     : collectCharacterSpells() + loadSpellList(edition)
//   - Features   : loadClassData(edition, classId).features  (per class)
//                  + species.entries + background.entries
//   - Feats      : character.feats + loadFeatList(edition)
//
// Module-scope promise caches mean simultaneous SessionCards share
// in-flight requests — opening the same category on 4 cards triggers
// the dataset fetch once, not four times.

import { useEffect, useMemo, useState } from 'react'
import { collectCharacterSpells, SCHOOL_NAMES } from '../../lib/sheetUtils'
import EntryRenderer from '../ui/EntryRenderer'

const PAD = 8

// ─── module-scope dataset caches ─────────────────────────────
const spellListCache = new Map()    // edition → Promise<Spell[]>
const featListCache  = new Map()    // edition → Promise<Feat[]>
const classDataCache = new Map()    // `${edition}:${classId}` → Promise<ClassData>

function loadSpellsCached(edition) {
  if (!spellListCache.has(edition)) {
    spellListCache.set(edition,
      import('../../lib/dataLoader').then(m => m.loadSpellList(edition)))
  }
  return spellListCache.get(edition)
}
function loadFeatsCached(edition) {
  if (!featListCache.has(edition)) {
    featListCache.set(edition,
      import('../../lib/dataLoader').then(m => m.loadFeatList(edition)))
  }
  return featListCache.get(edition)
}
function loadClassCached(edition, classId) {
  const key = `${edition}:${classId}`
  if (!classDataCache.has(key)) {
    classDataCache.set(key,
      import('../../lib/dataLoader').then(m => m.loadClassData(edition, classId)))
  }
  return classDataCache.get(key)
}

// ─── category bar ────────────────────────────────────────────

const CATEGORIES = [
  { id: 'inventory', label: 'Inventory' },
  { id: 'spells',    label: 'Spells' },
  { id: 'features',  label: 'Features' },
  { id: 'feats',     label: 'Feats' },
]

export default function SessionCardCategories({ character }) {
  const [open, setOpen] = useState(null)
  if (!character) return null

  return (
    <div style={{ padding: `0 ${PAD}px ${PAD}px` }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${CATEGORIES.length}, minmax(0, 1fr))`,
        gap: 3,
      }}>
        {CATEGORIES.map(c => {
          const active = open === c.id
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setOpen(o => o === c.id ? null : c.id)}
              style={{
                padding: '4px 6px',
                background: active
                  ? 'color-mix(in srgb, var(--color-accent) 18%, transparent)'
                  : 'var(--color-surface)',
                border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 10, fontWeight: 'var(--fw-semibold)',
                cursor: 'pointer', fontFamily: 'inherit',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {c.label} {active ? '▲' : '▾'}
            </button>
          )
        })}
      </div>
      {open === 'inventory' && <InventorySection character={character} />}
      {open === 'spells'    && <SpellsSection    character={character} />}
      {open === 'features'  && <FeaturesSection  character={character} />}
      {open === 'feats'     && <FeatsSection     character={character} />}
    </div>
  )
}

// ─── shared row ──────────────────────────────────────────────

function Expandable({ title, sub, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--color-surface)',
      marginBottom: 3,
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 6px', background: 'transparent', border: 'none',
          color: 'var(--color-text)', cursor: 'pointer',
          fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <span style={{
          flex: 1, minWidth: 0,
          fontSize: 11, fontWeight: 'var(--fw-semibold)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{title}</span>
        {sub && (
          <span style={{
            fontSize: 9, color: 'var(--color-text-muted)',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>{sub}</span>
        )}
        <span style={{ fontSize: 9, color: 'var(--color-text-dim)' }}>{open ? '▲' : '▾'}</span>
      </button>
      {open && (
        <div style={{
          padding: '0 6px 6px',
          fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.5,
          borderTop: '1px solid var(--color-border)',
          marginTop: 1, paddingTop: 4,
        }}>
          {children}
        </div>
      )}
    </div>
  )
}

function SectionShell({ children, empty }) {
  return (
    <div style={{
      marginTop: 6, maxHeight: 360, overflowY: 'auto',
      paddingRight: 2,
    }}>
      {children}
      {empty}
    </div>
  )
}

function EmptyHint({ children }) {
  return (
    <div style={{
      padding: 8, fontSize: 11, fontStyle: 'italic',
      color: 'var(--color-text-muted)', textAlign: 'center',
    }}>{children}</div>
  )
}

function LoadingHint() { return <EmptyHint>Lade…</EmptyHint> }

// ─── inventory ───────────────────────────────────────────────

function InventorySection({ character }) {
  const items = useMemo(() => [
    ...(character?.inventory?.items || []),
    ...(character?.custom?.items   || []),
  ], [character])

  if (!items.length) return <SectionShell empty={<EmptyHint>Keine Items.</EmptyHint>} />

  // Sort: equipped first, then by name.
  const sorted = [...items].sort((a, b) => {
    if (!!b.equipped !== !!a.equipped) return b.equipped ? 1 : -1
    return (a.customName || a.name || '').localeCompare(b.customName || b.name || '')
  })

  return (
    <SectionShell>
      {sorted.map((it, i) => {
        const name = it.customName || it.name || 'Item'
        const sub = [
          it.quantity > 1 ? `×${it.quantity}` : null,
          it.equipped ? 'equipped' : null,
          it.attuned ? 'attuned' : null,
        ].filter(Boolean).join(' · ')
        const props = (it.properties || []).join(', ')
        return (
          <Expandable key={it.id || `${name}-${i}`} title={name} sub={sub}>
            {it.dmg1 && <div><b>Damage:</b> {it.dmg1} {it.dmgType || ''}</div>}
            {it.ac != null && <div><b>AC:</b> {it.ac}</div>}
            {it.range && <div><b>Range:</b> {it.range}</div>}
            {it.weight != null && <div><b>Weight:</b> {it.weight} lb</div>}
            {props && <div><b>Properties:</b> {props}</div>}
            {it.description ? (
              <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{it.description}</div>
            ) : (
              !it.dmg1 && it.ac == null && !it.range && !props && !it.weight &&
              <div style={{ fontStyle: 'italic', opacity: 0.7 }}>Keine Beschreibung.</div>
            )}
          </Expandable>
        )
      })}
    </SectionShell>
  )
}

// ─── spells ──────────────────────────────────────────────────

function formatComponents(c = {}) {
  const parts = []
  if (c.v) parts.push('V')
  if (c.s) parts.push('S')
  if (c.m) parts.push('M')
  let out = parts.join(', ')
  if (c.m && typeof c.m === 'object' && c.m.text) out += ` (${c.m.text})`
  else if (c.m && typeof c.m === 'string') out += ` (${c.m})`
  return out || '—'
}

function SpellsSection({ character }) {
  const edition = character?.meta?.edition || '5e'
  const [allSpells, setAllSpells] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadSpellsCached(edition).then(list => { if (!cancelled) setAllSpells(list) })
    return () => { cancelled = true }
  }, [edition])

  const spellMap = useMemo(() => {
    const m = new Map()
    for (const s of (allSpells || [])) m.set(s.name.toLowerCase(), s)
    return m
  }, [allSpells])

  const enrich = useMemo(() => {
    // Same shape SpellsTab uses, locally to keep this file self-contained.
    const customByName = {}
    for (const c of (character?.custom?.spells || [])) {
      if (c?.name) customByName[c.name.toLowerCase()] = c
    }
    const meta = character?.spellMetadata || {}
    return (name) => {
      const loaded = spellMap?.get(name.toLowerCase())
      const custom = customByName[name.toLowerCase()]
      const m = meta[name] || {}
      return {
        name,
        level: loaded?.level ?? custom?.level ?? m.level ?? 0,
        school: loaded?.school || custom?.school || m.school || 'U',
        ritual: loaded?.ritual ?? custom?.ritual ?? m.ritual ?? false,
        concentration: loaded?.concentration ?? custom?.concentration ?? m.concentration ?? false,
        castingTime: loaded?.castingTime || custom?.castingTime || m.castingTime || '—',
        range: loaded?.range || custom?.range || m.range || '—',
        duration: loaded?.duration || custom?.duration || m.duration || '—',
        components: loaded?.components || {},
        entries: loaded?.entries || custom?.entries || (custom?.description ? [custom.description] : []),
        entriesHigherLevel: loaded?.entriesHigherLevel || custom?.entriesHigherLevel || [],
      }
    }
  }, [character, spellMap])

  const groups = useMemo(() => {
    if (!character) return []
    const dedup = new Map()
    for (const s of collectCharacterSpells(character)) {
      const key = s.name.toLowerCase()
      if (!dedup.has(key)) dedup.set(key, enrich(s.name))
    }
    const arr = [...dedup.values()].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    const byLevel = new Map()
    for (const s of arr) {
      if (!byLevel.has(s.level)) byLevel.set(s.level, [])
      byLevel.get(s.level).push(s)
    }
    return [...byLevel.entries()].sort((a, b) => a[0] - b[0])
  }, [character, enrich])

  if (allSpells === null) return <SectionShell empty={<LoadingHint />} />
  if (groups.length === 0) return <SectionShell empty={<EmptyHint>Keine Spells.</EmptyHint>} />

  return (
    <SectionShell>
      {groups.map(([level, spells]) => (
        <div key={level} style={{ marginBottom: 4 }}>
          <div style={{
            fontSize: 9, color: 'var(--color-text-muted)',
            textTransform: 'uppercase', letterSpacing: 0.5,
            margin: '4px 2px 2px',
          }}>{level === 0 ? 'Cantrips' : `Level ${level}`} ({spells.length})</div>
          {spells.map(s => (
            <Expandable
              key={s.name}
              title={s.name}
              sub={[
                SCHOOL_NAMES[s.school] || s.school,
                s.ritual ? 'R' : null,
                s.concentration ? 'C' : null,
              ].filter(Boolean).join(' · ')}
            >
              <div><b>Cast:</b> {s.castingTime} · <b>Range:</b> {s.range}</div>
              <div><b>Duration:</b> {s.duration} · <b>Comp:</b> {formatComponents(s.components)}</div>
              <div style={{ marginTop: 4 }}>
                {s.entries?.length
                  ? <EntryRenderer entries={s.entries} />
                  : <span style={{ fontStyle: 'italic', opacity: 0.7 }}>Keine Beschreibung.</span>}
                {s.entriesHigherLevel?.length > 0 && (
                  <div style={{ marginTop: 6 }}><EntryRenderer entries={s.entriesHigherLevel} /></div>
                )}
              </div>
            </Expandable>
          ))}
        </div>
      ))}
    </SectionShell>
  )
}

// ─── features ────────────────────────────────────────────────
//
// Class features come from the per-class JSON. We pull every class the
// character has and surface features whose `level` is ≤ the character's
// level in that class. Species + background features come straight off
// the character object (already enriched).

function FeaturesSection({ character }) {
  const edition = character?.meta?.edition || '5e'
  const [classMap, setClassMap] = useState({})

  useEffect(() => {
    let cancelled = false
    const classIds = [...new Set((character?.classes || []).map(c => c.classId).filter(Boolean))]
    Promise.all(classIds.map(id =>
      loadClassCached(edition, id).then(d => [id, d]).catch(() => [id, null])
    )).then(pairs => {
      if (cancelled) return
      const map = {}
      for (const [id, d] of pairs) if (d) map[id] = d
      setClassMap(map)
    })
    return () => { cancelled = true }
  }, [edition, character?.classes])

  const groups = useMemo(() => {
    if (!character) return []
    const out = []

    // Class features
    for (const cls of (character.classes || [])) {
      const data = classMap[cls.classId]
      if (!data) continue
      const features = (data.features || [])
        .filter(f => (f.level || 1) <= (cls.level || 0))
        .sort((a, b) => (a.level || 1) - (b.level || 1) || (a.name || '').localeCompare(b.name || ''))
      if (features.length === 0) continue
      out.push({
        title: `${cls.classId}${cls.level ? ` (L${cls.level})` : ''}`,
        items: features.map(f => ({
          key: `${cls.classId}-${f.name}-${f.level}`,
          name: f.name,
          sub: f.level ? `L${f.level}` : '',
          entries: f.entries || [],
        })),
      })
    }

    // Species feature blocks (race/subrace traits stored as `entries` blocks)
    const sp = character.species || {}
    const speciesEntries = sp.entries || sp.traits || []
    if (speciesEntries.length > 0) {
      out.push({
        title: `Species (${sp.raceId?.split('__')[0] || '—'})`,
        items: speciesEntries.map((e, i) => ({
          key: `sp-${i}`,
          name: e?.name || `Trait ${i + 1}`,
          sub: '',
          entries: e?.entries || (typeof e === 'string' ? [e] : []),
        })),
      })
    }

    // Background features
    const bg = character.background || {}
    const bgEntries = bg.entries || bg.feature?.entries || []
    if (bgEntries.length > 0) {
      out.push({
        title: `Background (${bg.backgroundId?.split('__')[0] || '—'})`,
        items: bgEntries.map((e, i) => ({
          key: `bg-${i}`,
          name: e?.name || `Feature ${i + 1}`,
          sub: '',
          entries: e?.entries || (typeof e === 'string' ? [e] : []),
        })),
      })
    }

    return out
  }, [character, classMap])

  const noClassesLoadedYet = (character?.classes || []).length > 0 && Object.keys(classMap).length === 0
  if (noClassesLoadedYet) return <SectionShell empty={<LoadingHint />} />
  if (groups.length === 0) return <SectionShell empty={<EmptyHint>Keine Features.</EmptyHint>} />

  return (
    <SectionShell>
      {groups.map(g => (
        <div key={g.title} style={{ marginBottom: 4 }}>
          <div style={{
            fontSize: 9, color: 'var(--color-text-muted)',
            textTransform: 'uppercase', letterSpacing: 0.5,
            margin: '4px 2px 2px',
          }}>{g.title} ({g.items.length})</div>
          {g.items.map(it => (
            <Expandable key={it.key} title={it.name} sub={it.sub}>
              {it.entries?.length
                ? <EntryRenderer entries={it.entries} />
                : <span style={{ fontStyle: 'italic', opacity: 0.7 }}>Keine Beschreibung.</span>}
            </Expandable>
          ))}
        </div>
      ))}
    </SectionShell>
  )
}

// ─── feats ───────────────────────────────────────────────────

function FeatsSection({ character }) {
  const edition = character?.meta?.edition || '5e'
  const [featMap, setFeatMap] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadFeatsCached(edition).then(list => {
      if (cancelled) return
      const m = {}
      for (const f of list) m[f.name.toLowerCase()] = f
      setFeatMap(m)
    })
    return () => { cancelled = true }
  }, [edition])

  const items = useMemo(() => {
    return (character?.feats || []).map((f, i) => {
      const key = (f.featId || '').toLowerCase()
      const data = featMap?.[key] || null
      return {
        key: `${f.featId || 'feat'}-${i}`,
        name: f.featId || data?.name || `Feat ${i + 1}`,
        sub: f.source || data?.source || '',
        entries: data?.entries || [],
      }
    })
  }, [character?.feats, featMap])

  if (featMap === null) return <SectionShell empty={<LoadingHint />} />
  if (items.length === 0) return <SectionShell empty={<EmptyHint>Keine Feats.</EmptyHint>} />

  return (
    <SectionShell>
      {items.map(it => (
        <Expandable key={it.key} title={it.name} sub={it.sub}>
          {it.entries.length
            ? <EntryRenderer entries={it.entries} />
            : <span style={{ fontStyle: 'italic', opacity: 0.7 }}>Keine Beschreibung verfügbar.</span>}
        </Expandable>
      ))}
    </SectionShell>
  )
}
