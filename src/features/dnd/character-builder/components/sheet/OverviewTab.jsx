// components/sheet/OverviewTab.jsx
// At-a-glance play view: identity is compressed to a single strip; the
// HP block, combat stat tiles, conditions, concentration tracker,
// attacks, spellcasting and class resources are the prominent things.
// Class details and level history are tucked away because they don't
// change during a session.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { getModifier } from '../../lib/characterModel'
import { modStr, masteryShortDesc, collectCharacterSpells, computeSpellSlots, COIN_TYPES, totalGoldValue } from '../../lib/sheetUtils'
import { undoLevelUp } from '../../lib/levelUpEngine'
import { getEffectsForSlot, getMechanicalEffects } from '../../lib/featureEffects'
import { loadItemIndex, loadSpellList, loadOptionalFeatureList } from '../../lib/dataLoader'
import { FEATURE_TYPE_LABEL } from '../../lib/choiceParser'
import { getFavorites, parseFavoriteKey, toggleFavorite } from '../../lib/favorites'
import EntryRenderer from '../ui/EntryRenderer'
import FiveEToolsLink from '../ui/FiveEToolsLink'
import { getSpellcastingInfo } from '../../lib/spellcastingRules'
// (PrepareModal import retired — the Overview Spells column now does
// inline prep toggles via the per-spell dot button, so the modal isn't
// mounted from here anymore.)
import { Section, Badge, DetailChip, Btn, Stepper, FeatureNoteList, SheetModal } from './SheetKit'
import { S } from './sheetStyles'
import ConditionChips from '../ui/ConditionChips'
import { CONDITIONS } from '../../lib/conditions'
import SpellPrepareModal from './SpellPrepareModal'
import usePwaMobile from '../../../../../shared/hooks/usePwaMobile'
import usePersistedState, { usePersistedSet } from '../../../../../shared/hooks/usePersistedState'
import { parseSpellEffect, DAMAGE_TYPE_COLOR } from '../../lib/spellEffectParser'
import { usePillColors } from '../../lib/pillColors'
import { parseFeatureEffect, pillColorForKind } from '../../lib/featureEffectParser'
import { applySavedOrder, getSavedOrder, moveCategory, resetCategoryOrder } from '../../lib/categoryOrder'
import { getColorMarker, setColorMarker, colorStripeStyle } from '../../lib/cardColors'
import { getCustomNote, setCustomNote } from '../../lib/customNotes'
import { isPinnedAction, togglePinnedAction, getPinnedActions } from '../../lib/pinnedActions'
import { getSpellWeaponBuff, getEligibleWeapons } from '../../lib/spellWeaponBuffs'
import { addActiveEffect, removeActiveEffect, getActiveEffects } from '../../lib/activeEffects'
import CrossEditionPill from '../ui/CrossEditionPill'
import HoverDetailTooltip from '../ui/HoverDetailTooltip'

// Sync-Check ob das aktuelle Fenster ein Sheet-Popout ist (`?popout=1`).
// Wird im Render gelesen damit der Closing-Strip ad-hoc als Tauri-
// Drag-Region markiert werden kann.
function isPopoutEnv() {
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
import { CardColorPicker } from './SheetKit'

// Tooltip-Content fuer einen Action-Row-Hover. Greift auf die
// strukturierten Felder zurueck die der Bucket-Builder befuellt
// (spellMeta.entries fuer Spells, entries fuer Features/Species/
// Items, weapon-Stats fuer Attacks). Liefert null wenn nichts
// Sinnvolles zu zeigen ist — dann unterdrueckt der Renderer den
// Tooltip-Wrap.
function actionRowTooltipContent(r) {
  if (!r) return null
  const titleEl = (
    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
      {r.name}
      {r.sub && (
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6, fontWeight: 400 }}>
          {r.sub}
        </span>
      )}
    </div>
  )
  if (r.kind === 'spell' || r.kind === 'always-spell') {
    const sp = r.spellMeta || {}
    const chips = [
      sp.castingTime && `Cast ${sp.castingTime}`,
      sp.range       && `Range ${sp.range}`,
      sp.duration    && `Duration ${sp.duration}`,
      sp.components  && `Comp ${formatSpellComponents(sp.components)}`,
    ].filter(Boolean)
    return (
      <div>
        {titleEl}
        {chips.length > 0 && (
          <div style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
            {chips.join(' · ')}
          </div>
        )}
        {Array.isArray(sp.entries) && sp.entries.length > 0 && (
          <EntryRenderer entries={sp.entries} />
        )}
        {Array.isArray(sp.entriesHigherLevel) && sp.entriesHigherLevel.length > 0 && (
          <div style={{
            marginTop: 6, paddingTop: 6,
            borderTop: '1px dashed var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}>
            <EntryRenderer entries={
              (sp.entriesHigherLevel.length === 1
                && sp.entriesHigherLevel[0]?.entries
                && sp.entriesHigherLevel[0]?.type === 'entries')
                ? sp.entriesHigherLevel[0].entries
                : sp.entriesHigherLevel
            } />
          </div>
        )}
      </div>
    )
  }
  if (r.kind === 'attack') {
    return (
      <div>
        {titleEl}
        <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
          {[
            r.attack && `To Hit ${r.attack}`,
            r.damage && r.damage !== '—' && `${r.damage} ${r.damageType || ''}`.trim(),
            r.range && r.range !== '—' && `Range ${r.range}`,
          ].filter(Boolean).join(' · ')}
        </div>
        {Array.isArray(r.properties) && r.properties.length > 0 && (
          <div style={{ marginBottom: 4 }}>Properties: {r.properties.join(', ')}</div>
        )}
        {r.markedAs && (
          <div style={{ color: 'var(--accent-purple)' }}>{r.markedAs.label}: {r.markedAs.note}</div>
        )}
      </div>
    )
  }
  if (r.kind === 'feature' || r.kind === 'species' || r.kind === 'item') {
    if (!Array.isArray(r.entries) || r.entries.length === 0) {
      if (r.notes) return <div>{titleEl}<div>{r.notes}</div></div>
      return null
    }
    return (
      <div>
        {titleEl}
        <EntryRenderer entries={r.entries} />
      </div>
    )
  }
  if (r.kind === 'standard' && r.notes) {
    return (
      <div>
        {titleEl}
        <div>{r.notes}</div>
      </div>
    )
  }
  return null
}

// Composite-Key für einen Action-Row / Spells-Spalten-Eintrag im
// Color-Marker-System. MUSS IDENTISCH sein zum favoriteKey()-Format
// in lib/favorites.js, damit ein Spell/Feature seinen Farb-Tag
// überall trägt (Action-Row, Spells-Spalte, Features-Tab-Card).
//
//   spell:Hunter's Mark
//   feature:Rogue:Sneak Attack:1
//   trait:Darkvision
//   item:<inventoryItemId>
//   feat:Alert
//   attack:<weaponName>   (kein favoriteKey-Pendant — Marker-only)
function rowMarkerKey(r) {
  if (!r) return null
  if (r.kind === 'spell' || r.kind === 'always-spell') {
    return `spell:${r.spell?.name || r.name}`
  }
  // Bucket-Builder setzt r.markerKey für Klassen-Features, Race-
  // Traits, Items und Feats — die haben strukturierte IDs die das
  // favoriteKey-Format brauchen (Klasse/Name/Level).
  if (r.markerKey) return r.markerKey
  if (r.kind === 'attack') return `attack:${r.name}`
  return r.id
}

// Multiclass-Helper: liefert die Klassen-ID die einen Spell für den
// Spell-Effect-Parser "casten" soll. Reihenfolge:
//   1. Eine Klasse aus collected.sourceClasses die Spellcasting kann
//   2. Mit den besten Stats (DC + Attack-Bonus)
//   3. Fallback auf irgendeine Caster-Klasse des Characters
// Pure read, kein Side-Effect.
function pickCasterClassFor(collectedSpell, computed) {
  const candidates = new Set(collectedSpell?.sourceClasses || [])
  const sc = computed?.spellcasting || {}
  const score = (id) => (sc[id]?.spellSaveDC || 0) + (sc[id]?.spellAttackBonus || 0)
  let best = null
  for (const cid of candidates) {
    if (!sc[cid]) continue
    if (!best || score(cid) > score(best)) best = cid
  }
  if (best) return best
  // Fallback: irgendeine Caster-Klasse (für race-/feat-granted Spells
  // ohne Sourceklass).
  const ids = Object.keys(sc)
  if (ids.length === 1) return ids[0]
  if (ids.length > 1) return ids.sort((a, b) => score(b) - score(a))[0]
  return null
}

// ── Clickable pip row (death saves, resources) ─────────────────
function Pips({ count, filled, color, onSet }) {
  return (
    <div style={S.pipRow}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i} type="button"
          onClick={() => onSet(filled > i ? i : i + 1)}
          style={{ ...S.pip, background: filled > i ? color : 'var(--bg-inset)' }}
          aria-label={`${i + 1}`}
        />
      ))}
    </div>
  )
}

function ResourceCard({ res, used, onSetUsed }) {
  if (res.type === 'passive') {
    return (
      <div style={S.resourceBox}>
        <div style={S.resourceName}>{res.name}</div>
        <div style={S.resourceValue}>{res.value || res.die || '—'}</div>
        <div style={S.resourceRecharge}>Passive</div>
      </div>
    )
  }
  if (res.type === 'pool') {
    const remaining = Math.max(0, (res.max || 0) - used)
    return (
      <div style={S.resourceBox}>
        <div style={S.resourceName}>{res.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <button type="button" style={S.stepBtn} onClick={() => onSetUsed(Math.min(res.max, used + 1))}>−</button>
          <span style={{ ...S.resourceValue, minWidth: 70, textAlign: 'center' }}>{remaining} / {res.max}</span>
          <button type="button" style={S.stepBtn} onClick={() => onSetUsed(Math.max(0, used - 1))}>+</button>
        </div>
        <div style={S.resourceRecharge}>
          {res.recharge === 'short_rest' ? 'Short Rest' : 'Long Rest'} pool
        </div>
      </div>
    )
  }
  const max = res.max || 0
  const remaining = Math.max(0, max - used)
  return (
    <div style={S.resourceBox}>
      <div style={S.resourceName}>{res.name}</div>
      <div style={S.resourceValue}>{remaining} / {max}{res.die ? ` · ${res.die}` : ''}</div>
      {max > 0 && max <= 12 && (
        <Pips count={max} filled={remaining} color="var(--accent)"
          onSet={left => onSetUsed(max - left)} />
      )}
      <div style={S.resourceRecharge}>
        {res.recharge === 'short_rest' ? 'Short Rest' : 'Long Rest'}
      </div>
    </div>
  )
}

// ── Inline HP editor: current / temp / max-adjust + quick damage·heal ──
// Temp + Max-Adjust steppers, sized to sit alongside the HP card at the
// same height. Current HP is intentionally absent — the big "56/56" on
// the HP card already conveys it and the Damage/Heal buttons are the
// Temp / Max: lokaler Draft + debounced commit (250ms idle). Sonst
// schreibt jeder Tastendruck den gesamten Character neu (Recompute +
// Re-render der ganzen Sheet) und das input lagged spürbar.
function TempMaxControls({ hp, maxHpBonus, updateCharacter }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      alignItems: 'center', marginTop: 6,
    }}>
      <DebouncedNumberField
        label="temp:"
        value={hp.temporary || 0}
        min={0} max={999}
        onCommit={(v) => updateCharacter('status.temporaryHp', Math.max(0, v))}
      />
      <DebouncedNumberField
        label="max:"
        value={maxHpBonus || 0}
        min={-999} max={999}
        onCommit={(v) => updateCharacter('status.maxHpBonus', v)}
      />
    </div>
  )
}

// Kleines Number-Input mit Label, das lokal-state hält und nur
// debounced + auf Blur ans Parent-State committed. Verhindert das
// Re-render-Lag der Sheet bei jedem Tastendruck.
function DebouncedTextArea({ value, onCommit, delayMs = 300, ...rest }) {
  const [draft, setDraft] = useState(value || '')
  useEffect(() => { setDraft(value || '') }, [value])
  useEffect(() => {
    if (draft === (value || '')) return
    const t = setTimeout(() => { if (draft !== (value || '')) onCommit(draft) }, delayMs)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])
  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        const v = e.target.value
        if (v !== (value || '')) onCommit(v)
      }}
      {...rest}
    />
  )
}

function DebouncedNumberField({ label, value, min, max, onCommit, delayMs = 250 }) {
  const [draft, setDraft] = useState(String(value ?? 0))
  // Externer Wert hat sich geändert (z.B. anderer Tab schreibt) →
  // Draft re-sync wenn der User gerade NICHT fokussiert ist.
  useEffect(() => { setDraft(String(value ?? 0)) }, [value])
  useEffect(() => {
    if (draft === '' || draft === String(value ?? 0)) return
    const t = setTimeout(() => {
      const n = parseInt(draft, 10)
      if (Number.isFinite(n) && n !== value) onCommit(n)
    }, delayMs)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])
  return (
    <label style={hpMiniInputRow}>
      <span style={hpMiniInputLabel}>{label}</span>
      <input
        type="number" min={min} max={max}
        value={draft}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          const v = e.target.value === '' ? 0 : (parseInt(e.target.value, 10) || 0)
          if (v !== value) onCommit(v)
        }}
        style={hpMiniInputField}
      />
    </label>
  )
}

// Damage / Heal — kompakte Zeile direkt unter der HP-Karte: roter
// Minus-Knopf links (= damage), Zahleingabe in der Mitte, grüner
// Plus-Knopf rechts (= heal). Temp HP soaks damage first; healing
// cappt bei eff. max.
function DamageHealControls({ hp, applyCharacter }) {
  const [amount, setAmount] = useState(0)
  function apply(sign) {
    const n = Number(amount) || 0
    if (n <= 0) return
    if (sign < 0) {
      applyCharacter(d => {
        if (!d.status) d.status = {}
        let dmg = n
        let t = d.status.temporaryHp || 0
        if (t > 0) { const a = Math.min(t, dmg); t -= a; dmg -= a; d.status.temporaryHp = t }
        const cur = d.status.currentHp ?? hp.max
        d.status.currentHp = Math.max(0, cur - dmg)
      }, { changedPaths: ['status.temporaryHp', 'status.currentHp'] })
    } else {
      applyCharacter(d => {
        if (!d.status) d.status = {}
        const cur = d.status.currentHp ?? hp.max
        d.status.currentHp = Math.min(hp.max, cur + n)
      }, { changedPaths: ['status.currentHp'] })
    }
    setAmount(0)
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 6, marginTop: 6,
    }}>
      <button
        type="button"
        onClick={() => apply(-1)}
        disabled={!(Number(amount) > 0)}
        title="Schaden anwenden"
        style={hpDmgBtn}
        aria-label="Damage anwenden"
      >−</button>
      <input
        type="number" min="0" max="999"
        value={amount}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const v = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0)
          setAmount(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter')      apply(+1)  // Enter heilt — kann man später noch flippen falls anders intuitiver
          if (e.key === '-' && e.ctrlKey) apply(-1)
        }}
        style={hpDmgInput}
      />
      <button
        type="button"
        onClick={() => apply(+1)}
        disabled={!(Number(amount) > 0)}
        title="Heilung anwenden"
        style={hpHealBtn}
        aria-label="Heilung anwenden"
      >+</button>
    </div>
  )
}

// Mini-Input-Row-Styles für Temp / Max / Damage. Alles bewusst auf
// kompakte Höhe gehalten, damit die HP-Karte konstant bleibt.
const hpMiniInputRow = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
}
const hpMiniInputLabel = {
  color: 'var(--text-muted)', fontSize: 11, minWidth: 36, textAlign: 'right',
}
const hpMiniInputField = {
  width: 56, padding: '2px 6px', fontSize: 12,
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', borderRadius: 4,
  textAlign: 'center', fontFamily: 'inherit',
}
const hpDmgInput = {
  ...hpMiniInputField,
  width: 60, padding: '4px 6px', fontSize: 14, fontWeight: 700,
}
const hpDmgBtn = {
  width: 28, height: 28, padding: 0,
  borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
  background: 'transparent',
  border: '1.5px solid var(--accent-red)',
  color: 'var(--accent-red)',
  fontSize: 18, lineHeight: 1, fontWeight: 700,
}
const hpHealBtn = {
  ...hpDmgBtn,
  borderColor: 'var(--accent-green)',
  color: 'var(--accent-green)',
}
// Fixer Temp-HP-Slot oben links in der HP-Karte. Hat immer die
// gleiche Höhe (auch wenn leer), damit der HP-Wert darunter nicht
// auf-/abspringt wenn Temp toggelt.
const hpTempSlot = {
  position: 'absolute', top: 6, left: 8,
  fontSize: 11, fontWeight: 700,
  color: 'var(--accent-green)',
  minHeight: 14, lineHeight: '14px',
  pointerEvents: 'none',
}

function HpControls({ hp, baseMaxHp, maxHpBonus, applyCharacter, updateCharacter }) {
  // Legacy wrapper kept so existing call sites keep working — composes
  // the two newer pieces. Most call sites use TempMaxControls +
  // DamageHealControls directly now.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 220 }}>
      <TempMaxControls hp={hp} baseMaxHp={baseMaxHp} maxHpBonus={maxHpBonus}
        updateCharacter={updateCharacter} />
      <DamageHealControls hp={hp} applyCharacter={applyCharacter} />
    </div>
  )
}

export default function OverviewTab({ character, computed, abilityScores, hp, updateCharacter, applyCharacter, charId, session, onReload, onNavigateTab, readOnly = false }) {
  const { isPwaMobile } = usePwaMobile()
  const [conditionsOpen, setConditionsOpen] = useState(false)
  const deathSaves = character.status?.deathSaves || { successes: 0, failures: 0 }
  const usedResources = character.status?.usedResources || {}
  const baseMaxHp = computed?.hp?.max || 1
  const maxHpBonus = character.status?.maxHpBonus || 0
  const hpPct = hp.max > 0 ? Math.max(0, Math.min(100, (hp.current / hp.max) * 100)) : 0

  // ── Combat stat tiles (the four numbers a player needs at a glance) ──
  const profBonus = Math.ceil((character.classes || []).reduce((s, c) => s + (c.level || 0), 0) / 4) + 1
  const ac = computed?.ac?.total ?? 10
  // Concentration buffs are surfaced in the AC tile's tooltip + badge so
  // the player (and GM) can see at a glance that the number includes a
  // temp bonus.
  const acConcEff = computed?.ac?.concentrationEffect
  const acFeatureNotes = getEffectsForSlot(character, 'ac')
  const acTooltipParts = []
  if (acConcEff?.label) acTooltipParts.push(`${acConcEff.spell}: ${acConcEff.label}`)
  for (const n of acFeatureNotes) acTooltipParts.push(`${n.feature}: ${n.text}`)
  const acTooltip = acTooltipParts.length > 0 ? acTooltipParts.join('\n') : undefined
  const acHasNotes = acConcEff || acFeatureNotes.length > 0

  const initiative = computed?.initiative ?? getModifier(abilityScores.dex)
  const initFeatureNotes = getEffectsForSlot(character, 'init')
  const initTooltip = initFeatureNotes.length > 0
    ? initFeatureNotes.map(n => `${n.feature}: ${n.text}`).join('\n')
    : undefined

  // Speed: walk is the headline value; fly / swim / climb / burrow show
  // up in the hover tooltip if the species (or other features) provide
  // them. computeSpeed in the rules engine returns null for modes the
  // character doesn't have.
  const sp = computed?.speed || { walk: character.species?.speed ?? 30 }
  const extraSpeeds = [
    sp.fly    && `Fly ${sp.fly} ft.`,
    sp.swim   && `Swim ${sp.swim} ft.`,
    sp.climb  && `Climb ${sp.climb} ft.`,
    sp.burrow && `Burrow ${sp.burrow} ft.`,
  ].filter(Boolean)
  const speedValue = `${sp.walk} ft.`
  const speedFeatureNotes = getEffectsForSlot(character, 'speed')
  const speedTooltipParts = [`Walk ${sp.walk} ft.`]
  for (const e of extraSpeeds) speedTooltipParts.push(e)
  for (const n of speedFeatureNotes) speedTooltipParts.push(`${n.feature}: ${n.text}`)
  const speedTooltip = speedTooltipParts.join('\n')

  const concentration = character.status?.concentration
  const economy = character.status?.economy || {}

  // The PrepareModal launcher (and the modal mount) was retired —
  // the Spells column now provides inline prep toggles via the dot
  // button next to each spell name. No more state hauling here.

  return (
    <div className="dnd-sheet-tab-body" style={S.tabBody}>
      {/* ── Combat-Tracker-Bar (oberhalb der Hero-Row) ──
          flexWrap: nowrap zwingt die Bar einzeilig zu bleiben — die
          Slots schrumpfen via flex-shrink statt umzubrechen. Inhalte
          sind klein genug dass sie auch bei knappem Platz lesbar
          bleiben.
          Slot 1 (HD + Death Saves zusammen) — spannt über HP + Items.
          Slot 2 (Actions): Action Economy + Neue Runde.
          Slot 3 (rechts): Spell Atk/DC — bleibt rechts unabhaengig
                  vom Spells/Favoriten-Swap. */}
      <div
        data-tauri-drag-region={isPopoutEnv() ? '' : undefined}
        style={{
          display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'nowrap',
          padding: '6px 10px', marginBottom: 10,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {/* Slot 1 — Hit Dice + Death Saves zusammen, deckt die Breite
            von HP (240) + Items (160) + gap (12) = 412px ab. */}
        <div style={{
          flex: '0 1 412px', minWidth: 0,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap',
        }}>
          <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <DetailChip label="HD" value={character.classes.map(c => `${c.level}d${c.hitDie}`).join('+')} />
          </div>
          {/* S/F nebeneinander damit der Slot single-line bleibt. */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={S.deathSaveLabel}>S</span>
              <Pips count={3} filled={deathSaves.successes} color="var(--accent-green)"
                onSet={n => updateCharacter('status.deathSaves', { ...deathSaves, successes: n })} />
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={S.deathSaveLabel}>F</span>
              <Pips count={3} filled={deathSaves.failures} color="var(--accent-red)"
                onSet={n => updateCharacter('status.deathSaves', { ...deathSaves, failures: n })} />
            </div>
          </div>
        </div>
        {/* Slot 2 — Action Economy + Neue Runde */}
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <CombatEconomy
            value={economy}
            character={character}
            onChange={(next) => updateCharacter('status.economy', next)}
          />
        </div>
        {/* Slot 3 — Spell Atk/DC. */}
        {computed?.spellcasting && Object.keys(computed.spellcasting).length > 0 && (
          <div style={{
            flex: '0 1 auto', minWidth: 0,
            display: 'flex', flexDirection: 'column', gap: 1,
            overflow: 'hidden',
          }}>
            {Object.entries(computed.spellcasting).map(([cls, data]) => (
              <div key={cls} style={{ fontSize: 11, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 700 }}>{cls}:</span>{' '}
                <span style={{ color: 'var(--text-muted)' }}>{data.ability.toUpperCase()}</span>{' '}
                <span style={{ color: 'var(--accent-blue)', fontWeight: 700 }}>Atk {data.spellAttackDisplay}</span>
                <span style={{ color: 'var(--text-dim)' }}> · </span>
                <span style={{ color: 'var(--accent-purple)', fontWeight: 700 }}>DC {data.spellSaveDC}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Top row: HP card, Quick-Access grid, then 3 action columns ──
          Layout (left → right):
            • HP card               — current/max + bar + resistance pills
            • Quick-Access GRID     — fills the empty middle space, wraps
                                      potions and pinned items into a
                                      multi-column auto-grid
            • Blue / Green / Yellow — Available Actions, Spells, Favorites
          Death saves + action pills are a separate full-width strip
          below this row (closing border across the whole page). */}
      <div style={isPwaMobile ? heroRowPwa : heroRow}>
        <div style={isPwaMobile ? heroColPwa : { flex: '0 0 240px', minWidth: 0 }}>
        <Section
          title="Hit Points"
          // Conditions-Button im Section-Header (rechts, neben dem
          // Titel), parallel zum "Inventory" / "Prepare"-Button-Muster
          // in den anderen Spalten. Aktiv-Counter steht direkt drauf.
          action={!readOnly ? (
            <ConditionsButton
              active={character.status?.conditions || []}
              onOpen={() => setConditionsOpen(true)}
            />
          ) : null}
          // height:100% damit die Section die volle Höhe der Hero-Row-
          // Slot einnimmt; display:flex+column damit die Notes-Textarea
          // unten via flex:1 runter bis zur Conditions-Bar wächst.
          style={{ height: '100%', display: 'flex', flexDirection: 'column', marginBottom: 0 }}
        >
          {/* Layout (überarbeitet, image-driven):
                ┌────────────────┬──────────────────┐
                │ HP-Karte       │ Resistance/Vuln  │
                │ (HP-Wert in    │ einspaltig,       │
                │  rotem Border) │ scrollbar — füllt │
                │                │ die volle Höhe    │
                │ [ − N + ]      │ bis zum unteren   │
                │ temp: N        │ Abschluss der     │
                │ max:  N        │ HP-Section        │
                └────────────────┴──────────────────┘
              Die HP-Buttons sitzen direkt unter dem roten HP-Wert,
              nicht spalten-übergreifend. Resistance/Vuln nimmt die
              Spalte rechts daneben über die ganze Höhe in Anspruch. */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
            {/* Linker Block: HP-Karte + alle HP-Controls zentriert
                darunter. Eigene Spalte mit fester Breite damit die
                Buttons exakt unter dem HP-Wert sitzen. */}
            <div style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 4,
              flex: '0 0 auto', minWidth: 150,
            }}>
              <div style={{ ...S.hpMain, position: 'relative', alignSelf: 'stretch' }}>
                {(concentration?.spell || concentration?.name) && (
                  <ConcentrationGlyph
                    value={concentration}
                    onChange={(v) => updateCharacter('status.concentration', v || null)}
                  />
                )}
                <div style={hpTempSlot}>
                  {hp.temporary > 0 ? `+${hp.temporary} temp` : ''}
                </div>
                <div style={S.hpLabel}>Hit Points</div>
                <div style={S.hpValue}>{hp.current} / {hp.max}</div>
                <div style={S.hpBarTrack}>
                  <div style={{ ...S.hpBarFill, width: `${hpPct}%` }} />
                </div>
              </div>
              {!readOnly && (
                <DamageHealControls hp={hp} applyCharacter={applyCharacter} />
              )}
              {!readOnly && (
                <TempMaxControls hp={hp} baseMaxHp={baseMaxHp} maxHpBonus={maxHpBonus}
                  updateCharacter={updateCharacter} />
              )}
            </div>
            {/* Rechter Block: Resistance/Vulnerability. Stretcht über
                die ganze Höhe der HP-Section bis zur unteren Border. */}
            <DamageResistancePills character={character} compact />
          </div>
          <FeatureNoteList notes={getEffectsForSlot(character, 'hp')} />
          {/* Spieler-Notizen unter den HP-Buttons. flex:1 sorgt dafür
              dass die Textarea den restlichen Platz der HP-Section
              füllt bis zur Conditions-Bar. Debounced damit jeder
              Tastendruck nicht den ganzen Char recomputed. */}
          {!readOnly && (
            <DebouncedTextArea
              value={character.status?.hpNotes || ''}
              onCommit={(v) => updateCharacter('status.hpNotes', v)}
              placeholder="Notizen …"
              style={{
                width: '100%', marginTop: 6,
                flex: 1, minHeight: 32,
                padding: '6px 8px', fontSize: 11, lineHeight: 1.4,
                background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)', borderRadius: 6,
                fontFamily: 'inherit', resize: 'none', overflowY: 'auto',
              }}
            />
          )}
        </Section>
        </div>

        {/* Quick Access — narrow single column. Items render one per
            row instead of the previous auto-grid; potions + pinned
            items stack vertically. */}
        <div style={isPwaMobile ? heroColPwa : { flex: '0 0 160px', minWidth: 0 }}>
          <PotionAndQuickAccessColumn
            character={character}
            applyCharacter={applyCharacter}
            updateCharacter={updateCharacter}
          />
        </div>

        <div style={isPwaMobile ? heroColPwa : { flex: '1 1 260px', minWidth: 0 }}>
          <Section
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                {getSavedOrder(character, 'actions') && (
                  <ResetOrderIcon onReset={() => resetCategoryOrder(applyCharacter, 'actions')} />
                )}
                Actions
              </span>
            }
          >
            <div style={isPwaMobile ? flexibleScroll : fixedHeightScroll}>
              <CombatActionsExplorer
                character={character}
                computed={computed}
                applyCharacter={applyCharacter}
                embedded
              />
            </div>
          </Section>
        </div>

        {/* Spells/Favorites — Reihenfolge der beiden letzten Spalten
            ist per Pfeil-Button im Header der jeweiligen Section
            swap-bar (persistent in status.heroColSwap). Default:
            Spells links, Favorites rechts. */}
        {(() => {
          const swapped = !!character?.status?.heroColSwap
          const swapColumns = () => updateCharacter('status.heroColSwap', !swapped)
          const spellsCol = (
            <div key="spells" style={isPwaMobile ? heroColPwa : { flex: '1 1 260px', minWidth: 0 }}>
              <FeaturesAndPreparedSpellsColumn
                character={character}
                computed={computed}
                applyCharacter={applyCharacter}
                updateCharacter={updateCharacter}
                swapHeroCol={swapColumns}
                heroColSwapped={swapped}
              />
            </div>
          )
          const favCol = (
            <div key="favs" style={isPwaMobile ? heroColPwa : { flex: '1 1 240px', minWidth: 0 }}>
              <div style={isPwaMobile ? flexibleScroll : fixedHeightSection}>
                <FavoritesSection
                  character={character}
                  computed={computed}
                  applyCharacter={applyCharacter}
                  swapHeroCol={swapColumns}
                  heroColSwapped={swapped}
                />
              </div>
            </div>
          )
          return swapped ? [favCol, spellsCol] : [spellsCol, favCol]
        })()}
      </div>

      {/* Conditions-Footer entfernt — der Toggle-Button sitzt jetzt
          unter den HP-Controls, und aktive Conditions sind oben in
          der Resistance/Vulnerability-Spalte einzeln aufgelistet. */}
      {conditionsOpen && (
        <ConditionsPickerModal
          character={character}
          updateCharacter={updateCharacter}
          onClose={() => setConditionsOpen(false)}
        />
      )}

      {/* Closing strip entfernt — die Inhalte (Hit Dice, Death Saves,
          Action Economy, Spell-Stats) sitzen jetzt oben in der
          Combat-Tracker-Bar und sind dort spalten-aligned. */}

      {/* Conditions row removed — moved into the HP column above
          (under Temp/Max) so the free space there gets used and the
          main column row stays compact. */}

      {/* Weapon Mastery (left half) + Class Resources (right half).
          Two-column grid so each takes half the page width; on narrow
          screens they stack naturally via auto-fit. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 12,
      }}>
        {computed?.attacks?.length > 0 && (
          <WeaponMasteryPicker character={character} computed={computed} updateCharacter={updateCharacter} />
        )}
        {computed?.resources?.length > 0 && (
          <Section title="Class Resources">
            <div style={S.resourceGrid}>
              {computed.resources.map((res, i) => (
                <ResourceCard
                  key={res.id || i} res={res}
                  used={usedResources[res.id] || 0}
                  onSetUsed={n => updateCharacter(`status.usedResources.${res.id}`, n)}
                />
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* Class summary moved to the dedicated "Class History" tab —
          this section was static reference data, not play state, so
          it doesn't belong in the play-time Overview. */}

      {/* Level History moved to its own tab — keeps the Overview
          focused on play-time information. See LevelHistoryTab. */}
    </div>
  )
}

// ── Damage Resistance / Immunity / Vulnerability pills ──────────
// Aggregated from the featureEffects catalog. Empty → null so the HP
// section doesn't grow a phantom row when nothing's applicable.
// ── 5.5e Weapon Mastery picker ────────────────────────────────
// Reads computed.weaponMastery (computed from the class table column),
// shows known/max per class, and lets the player toggle which weapons
// from their inventory the mastery applies to. The 5.5e rule lets you
// swap one pick per long rest — that constraint is enforced socially,
// not by the sheet, so toggles are always live.
function WeaponMasteryPicker({ character, computed, updateCharacter }) {
  const wm = computed?.weaponMastery
  // Load the full 5.5e weapon catalog so the picker can offer every
  // weapon with a mastery, not just the ones the player happens to be
  // carrying. The 5.5e rules let you pick from any weapon you're
  // proficient with — owning it isn't a prerequisite.
  // `loaded` distinguishes "still fetching" from "fetched but empty",
  // so the UI can show a useful message instead of a permanent spinner.
  const [catalog, setCatalog] = useState([])
  const [loaded, setLoaded] = useState(false)
  // (Old collapse state removed — each class is now its own scrollable
  // card, mirroring Class Resources. Picked weapons pin to the top
  // automatically so the resting state shows "what's active first".)
  useEffect(() => {
    if (!wm || wm.perClass.length === 0) return
    const edition = character?.meta?.edition || '5e'
    let cancelled = false
    loadItemIndex(edition).then(items => {
      if (cancelled) return
      const seen = new Set()
      const weapons = []
      for (const it of items || []) {
        if (!it.isWeapon || !(it.mastery?.length > 0)) continue
        const key = it.name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        weapons.push({ name: it.name, mastery: it.mastery, weaponCategory: it.weaponCategory })
      }
      weapons.sort((a, b) => a.name.localeCompare(b.name))
      setCatalog(weapons)
      setLoaded(true)
    }).catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [wm, character?.meta?.edition])

  // Filter out classes that grant 0 mastery slots — only show the
  // picker when there's something to actually pick.
  const eligibleClasses = (wm?.perClass || []).filter(pc => (pc.count || 0) > 0)

  // Modal-driven picker state — which class is being edited right now.
  // Declared up here (before any early return) so React always sees
  // the same hook order on every render of this component; once `wm`
  // arrives the picker promotes from "no picks" to "has picks" and
  // moving these hooks below a conditional return triggered React #310.
  const [pickerFor, setPickerFor] = useState(null)
  const pickerClass = eligibleClasses.find(p => p.classIndex === pickerFor)

  // Set of weapon names already picked by OTHER classes — they're
  // disabled in this class's picker so the same Mastery can't be
  // double-counted. The eligible class itself can still toggle its
  // own picks freely.
  const pickedElsewhere = useMemo(() => {
    if (!pickerClass) return new Set()
    const out = new Set()
    for (const pc of eligibleClasses) {
      if (pc.classIndex === pickerClass.classIndex) continue
      for (const w of (pc.picked || [])) out.add(w.toLowerCase())
    }
    return out
  }, [eligibleClasses, pickerClass])

  if (!wm || eligibleClasses.length === 0) return null

  function togglePick(classIndex, weaponName, max) {
    const cls = character.classes[classIndex]
    const current = Array.isArray(cls.weaponMasteries) ? [...cls.weaponMasteries] : []
    const idx = current.findIndex(w => w.toLowerCase() === weaponName.toLowerCase())
    if (idx >= 0) {
      current.splice(idx, 1)
    } else if (current.length < max) {
      current.push(weaponName)
    } else {
      return // capped
    }
    updateCharacter(`classes.${classIndex}.weaponMasteries`, current)
  }

  // Per-class card: header (class + n/max) + scrollable list of all
  // pickable weapons, with the player's current picks pinned to the
  // top so a glance at the card tells them "what's active for this
  // class". Cards live in the same grid as Class Resources to stay
  // visually paired.
  function pickedFirst(pcPicked) {
    const pickedSet = new Set(pcPicked.map(n => n.toLowerCase()))
    const order = ['simple', 'martial', 'other']
    const out = []
    // First pass: every weapon the player currently has picked.
    for (const w of catalog) {
      if (pickedSet.has(w.name.toLowerCase())) out.push({ ...w, isPicked: true })
    }
    // Second pass: the rest, grouped by category.
    for (const g of order) {
      for (const w of catalog) {
        if (pickedSet.has(w.name.toLowerCase())) continue
        const cat = String(w.weaponCategory || '').toLowerCase() || 'other'
        const bucket = cat === 'simple' || cat === 'martial' ? cat : 'other'
        if (bucket !== g) continue
        out.push({ ...w, isPicked: false })
      }
    }
    return out
  }

  return (
    <Section title="Weapon Mastery">
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${eligibleClasses.length}, 1fr)`,
        gap: 10,
      }}>
        {eligibleClasses.map(pc => {
          const isFull = pc.picked.length >= pc.count
          return (
            <div key={pc.classIndex} style={{
              ...S.resourceBox,
              // WM-Cards passen sich der Inhalts-Höhe an (kein fixes
              // minHeight mehr) — so wird die Mastery-Sektion nur so
              // hoch wie sie sein muss und der Overview-Tab passt
              // eher ohne Page-Scroll.
              display: 'flex', flexDirection: 'column', gap: 2,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 6, marginBottom: 6,
              }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {/* Small open-arrow takes the role of the big "Mastery
                      wählen" button — keeps the card's vertical
                      footprint identical to a Class Resources card. */}
                  <button
                    type="button"
                    onClick={() => setPickerFor(pc.classIndex)}
                    disabled={!loaded}
                    title={loaded ? 'Mastery-Picker öffnen' : 'Lädt …'}
                    style={{
                      background: 'transparent', border: 'none', padding: 0,
                      color: 'var(--accent)', fontSize: 13, lineHeight: 1,
                      cursor: loaded ? 'pointer' : 'not-allowed',
                      opacity: loaded ? 1 : 0.5, fontFamily: 'inherit',
                    }}
                  >▶</button>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 13 }}>
                    {pc.classId}
                  </span>
                </span>
                <span style={{
                  fontSize: 11,
                  color: isFull ? 'var(--accent-green)' : 'var(--accent)',
                  fontWeight: 600,
                }}>{pc.picked.length}/{pc.count}</span>
              </div>
              {/* Picks only — no button. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {pc.picked.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Noch keine Mastery gewählt.
                  </div>
                ) : (
                  pc.picked.map(name => {
                    const mast = (catalog.find(c => c.name.toLowerCase() === name.toLowerCase())?.mastery) || []
                    return (
                      <div key={name} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        fontSize: 12, color: 'var(--accent-green)',
                        padding: '2px 6px', borderRadius: 4,
                        background: 'color-mix(in srgb, var(--accent-green) 10%, transparent)',
                      }}>
                        <span>{name}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 6 }}>
                          {mast.map(m => {
                            const d = masteryShortDesc(m); return d ? `${m} (${d})` : m
                          }).join('/')}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>
      {/* Picker modal — full weapon catalog. Weapons already taken by
          another class are disabled (greyed + can't be toggled). */}
      {pickerClass && (
        <WeaponMasteryPickerModal
          pc={pickerClass}
          catalog={catalog}
          pickedElsewhere={pickedElsewhere}
          onToggle={(name) => togglePick(pickerClass.classIndex, name, pickerClass.count)}
          onClose={() => setPickerFor(null)}
        />
      )}
    </Section>
  )
}

function WeaponMasteryPickerModal({ pc, catalog, pickedElsewhere, onToggle, onClose }) {
  const pickedSet = new Set(pc.picked.map(n => n.toLowerCase()))
  const grouped = { simple: [], martial: [], other: [] }
  for (const w of catalog) {
    const cat = String(w.weaponCategory || '').toLowerCase()
    if (cat === 'simple') grouped.simple.push(w)
    else if (cat === 'martial') grouped.martial.push(w)
    else grouped.other.push(w)
  }
  const isFull = pc.picked.length >= pc.count
  return (
    <div onClick={onClose} style={wmModalOverlay}>
      <div onClick={(e) => e.stopPropagation()} style={wmModalCard}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 14 }}>
              {pc.classId} · Weapon Mastery
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {pc.picked.length}/{pc.count} gewählt
            </div>
          </div>
          <button onClick={onClose} style={wmModalClose} aria-label="Close">✕</button>
        </div>
        {['simple', 'martial', 'other'].filter(g => grouped[g].length > 0).map(g => (
          <div key={g} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: 0.5, marginBottom: 4 }}>
              {g === 'simple' ? 'Simple' : g === 'martial' ? 'Martial' : 'Andere'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {grouped[g].map(w => {
                const key = w.name.toLowerCase()
                const picked = pickedSet.has(key)
                const otherHas = !picked && pickedElsewhere.has(key)
                const disabled = otherHas || (!picked && isFull)
                return (
                  <button
                    key={w.name}
                    type="button"
                    disabled={disabled}
                    onClick={() => onToggle(w.name)}
                    title={otherHas
                      ? 'Bereits in einer anderen Klasse gewählt'
                      : `Mastery: ${w.mastery.join(', ')}`}
                    style={{
                      padding: '3px 10px', borderRadius: 999, fontSize: 11,
                      fontFamily: 'inherit',
                      border: '1px solid ' + (picked ? 'var(--accent-green)' : 'var(--border)'),
                      background: picked ? 'color-mix(in srgb, var(--accent-green) 14%, transparent)' : 'transparent',
                      color: picked ? 'var(--accent-green)' : (otherHas ? 'var(--text-dim)' : 'var(--text-secondary)'),
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.5 : 1,
                    }}
                  >
                    {picked && '✓ '}{w.name}
                    <span style={{ color: 'var(--text-muted)', marginLeft: 4, fontSize: 10 }}>
                      · {w.mastery.map(m => {
                        const d = masteryShortDesc(m); return d ? `${m} (${d})` : m
                      }).join('/')}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
const wmModalOverlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
}
const wmModalCard = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
  padding: 16, width: 'min(620px, 92vw)', maxHeight: '80vh', overflowY: 'auto',
  boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
}
const wmModalClose = {
  background: 'transparent', border: 'none', color: 'var(--text-muted)',
  cursor: 'pointer', fontSize: 16, padding: 4, lineHeight: 1, fontFamily: 'inherit',
}
const wmpStyle = {
  wrap: { marginTop: 10, padding: '8px 10px', background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)', borderRadius: 6 },
  title: { fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase',
           letterSpacing: 0.5, color: 'var(--text-secondary)', marginBottom: 8 },
  classBlock: { marginBottom: 8 },
  classHead: { display: 'flex', justifyContent: 'space-between', fontSize: 12,
               color: 'var(--text-primary)', marginBottom: 6, fontWeight: 600 },
  groupBlock: { marginTop: 6 },
  groupLabel: { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: 0.5, marginBottom: 4 },
  grid: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: { padding: '3px 8px', borderRadius: 999, fontSize: 11,
          background: 'transparent', border: '1px solid var(--border)',
          color: 'var(--text-secondary)' },
  chipOn: { borderColor: 'var(--accent-green)', color: 'var(--accent-green)',
            background: 'color-mix(in srgb, var(--accent-green) 12%, transparent)' },
  chipMastery: { color: 'var(--text-muted)', marginLeft: 4 },
  empty: { fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' },
  hint: { fontSize: 10, color: 'var(--text-dim)', marginTop: 4 },
}

// ── Combat-actions explorer ──────────────────────────────────────
// Collapsible 3-tab table (Action / Bonus / Reaction) listing every
// option the character has for that slot:
//   • Standard universal actions (Dash, Disengage, Help, Hide, …)
//   • Weapon / unarmed / class-feature attacks from computed.attacks
//   • Prepared / always-known spells whose castingTime matches the tab
//     (metadata pulled from the loaded spell list)
//   • Class / subclass / race / background features whose entry text
//     mentions "as a bonus action" / "as a reaction" / "as an action"
// Each row collapses to a one-line summary (damage / mod / range);
// click to expand for the full description.
const STANDARD_ACTIONS = {
  '5e': {
    action: [
      { name: 'Attack',      notes: 'Mache 1 oder mehr Angriffe basierend auf Klasse.' },
      { name: 'Cast a Spell',notes: 'Wirke einen Spell mit Casting Time „1 action".' },
      { name: 'Dash',        notes: 'Verdoppelt deine Bewegung in diesem Zug.' },
      { name: 'Disengage',   notes: 'Verhindert Opportunity Attacks bis Ende deines Zugs.' },
      { name: 'Dodge',       notes: 'Angriffe gegen dich haben Disadvantage; deine DEX-Saves haben Advantage.' },
      { name: 'Help',        notes: 'Verbündeter erhält Advantage auf seinen nächsten Ability-Check oder Attack.' },
      { name: 'Hide',        notes: 'Stealth-Check vs. Passive Perception.' },
      { name: 'Ready',       notes: 'Bereite eine Aktion auf einen Trigger vor.' },
      { name: 'Search',      notes: 'Wahrnehmungs- oder Investigation-Check.' },
      { name: 'Use Object',  notes: 'Interagiere mit einem Objekt als Aktion.' },
      { name: 'Grapple',     notes: 'Athletics vs. Athletics/Acrobatics.' },
      { name: 'Shove',       notes: 'Athletics vs. Athletics/Acrobatics. Ziel: prone oder 5 ft. zurück.' },
    ],
    bonusAction: [],
    reaction: [
      { name: 'Opportunity Attack', notes: 'Wenn ein Feind deine Reichweite verlässt, mache 1 Nahkampf-Angriff.' },
    ],
  },
  '5.5e': {
    action: [
      { name: 'Attack',      notes: 'Mache 1 oder mehr Angriffe basierend auf Klasse.' },
      { name: 'Magic',       notes: 'Wirke einen Spell mit Casting Time „1 action" oder benutze magic-item-Aktion.' },
      { name: 'Dash',        notes: 'Verdoppelt deine Bewegung in diesem Zug.' },
      { name: 'Disengage',   notes: 'Verhindert Opportunity Attacks bis Ende deines Zugs.' },
      { name: 'Dodge',       notes: 'Angriffe gegen dich haben Disadvantage; deine DEX-Saves haben Advantage.' },
      { name: 'Help',        notes: 'Verbündeter erhält Advantage oder du machst Aid (1d4 Boost auf Roll).' },
      { name: 'Hide',        notes: 'Stealth-Check DC 15. Brichst bei Angriff / Zauber-Cast / Bewegung in Sicht.' },
      { name: 'Influence',   notes: 'Probiere ein Wesen zu beeinflussen — typischerweise CHA-Check.' },
      { name: 'Ready',       notes: 'Bereite eine Aktion auf einen Trigger vor.' },
      { name: 'Search',      notes: 'WIS-/INT-Check nach einer Information, einem Spur etc.' },
      { name: 'Study',       notes: 'INT-Check zum Erinnern oder Identifizieren.' },
      { name: 'Utilize',     notes: 'Benutze ein Objekt mit besonderer „Utilize"-Eigenschaft.' },
    ],
    bonusAction: [],
    reaction: [
      { name: 'Opportunity Attack', notes: 'Wenn ein Feind deine Reichweite verlässt, mache 1 Nahkampf-Angriff.' },
    ],
  },
}

function CombatActionsExplorer({ character, computed, applyCharacter, embedded = false }) {
  // Pill-Farbpalette mit den User-Settings-Overrides. Wird bei jeder
  // Änderung in den Settings via custom-event refreshed.
  const pillColors = usePillColors()
  // `embedded` = render always-open (no collapsible header), no own
  // padding, so the column container controls dimensions and the
  // explorer is just the inner content.
  const [open, setOpen] = useState(embedded)
  // tab + expanded: per-character UI prefs — Reload soll die letzte
  // Auswahl beibehalten (User-Wunsch).
  const charPrefId = character?.id || 'default'
  const [tab, setTab]   = usePersistedState(`cae_tab_${charPrefId}`, 'action')
  const [expanded, setExpanded] = useState(null)
  // Per-row slot picker: which row's "Cast" prompt is currently
  // open. Single string keyed by row.id so only one expand pops at
  // a time; clicking elsewhere collapses.
  const [castingFor, setCastingFor] = useState(null)
  const slots = useMemo(() => computeSpellSlots(character), [character])
  const usedSlots = character?.status?.usedSpellSlots || {}
  const usedPact  = character?.status?.usedPactSlots || 0

  // ── Use / cast handlers ──
  // Each turn-economy action toggles its slot on character.status.
  // economy and (for spells) consumes a spell slot + sets
  // concentration. Mirrors the existing castSpell logic in
  // SpellsTab; kept inline so the explorer doesn't have to depend
  // on the spells tab's internals.
  function markActionUsed(slot) {
    if (!applyCharacter || !slot) return
    applyCharacter(d => {
      if (!d.status) d.status = {}
      if (!d.status.economy) d.status.economy = {}
      d.status.economy[slot] = true
    })
  }
  // Special: feature-row activation that creates a *new* pill on
  // the action-economy bar. Currently:
  //   • Action Surge → adds an "Action Surge" pill (second action)
  // Detected by row name match because the underlying mechanic is
  // identical across editions and class data tags it consistently.
  function applyRowSideEffects(row) {
    if (!row?.name) return
    const lower = row.name.toLowerCase()
    if (/\baction\s*surge\b/.test(lower)) {
      applyCharacter(d => {
        if (!d.status) d.status = {}
        if (!d.status.economy) d.status.economy = {}
        d.status.economy.surgeActive = true
        d.status.economy.surgeAction = false
      })
    }
  }
  // Pending Weapon-Buff-Prompt für Spells im SPELL_WEAPON_BUFFS-
  // Catalog (Shillelagh, Magic Weapon, Magic Stone, Elemental Weapon).
  // Wenn ein solcher Spell gecastet wird, halten wir die Cast-Pipeline
  // an, zeigen einen Target-Picker, und führen den Cast erst beim
  // Confirm aus (Slot + Concentration + Effect-Apply atomar).
  const [buffPrompt, setBuffPrompt] = useState(null)

  function castSpellFromExplorer(spell, slotLevel, opts = {}) {
    if (!applyCharacter) return
    // Spell-Weapon-Buff: erst Target prompten, DANN casten + Effekt apply.
    if (!opts.__skipBuffPrompt && getSpellWeaponBuff(spell?.name)) {
      setBuffPrompt({ spell, slotLevel, opts })
      return
    }
    const slotName = opts.economySlot
    const concName = character?.status?.concentration?.spell
      || character?.status?.concentration?.name
    if (spell.concentration && concName && concName !== spell.name) {
      if (!window.confirm(`Du konzentrierst gerade auf ${concName}. Durch ${spell.name} ersetzen?`)) return
    }
    // 5e "one leveled spell per turn" rule: if you cast a leveled
    // spell with a casting time of 1 action OR 1 bonus action, the
    // other slot in the same turn must be a cantrip. We track the
    // first leveled cast on `status.economy.leveledCast` and warn
    // before allowing a second. Reset happens automatically on
    // "Neue Runde". 5.5e relaxed this rule, so we ask rather than
    // hard-block — the player can override if they're playing 5.5e.
    if (slotLevel > 0 && character?.status?.economy?.leveledCast) {
      if (!window.confirm(
        'Du hast in dieser Runde bereits einen Levelzauber gewirkt.\n\n'
        + 'Regel (5e): Nur ein Levelzauber pro Runde — der andere Slot darf nur einen Cantrip wirken.\n\n'
        + 'Trotzdem wirken?'
      )) return
    }
    applyCharacter(d => {
      if (!d.status) d.status = {}
      if (opts.usePact) {
        d.status.usedPactSlots = (d.status.usedPactSlots || 0) + 1
      } else if (slotLevel > 0) {
        if (!d.status.usedSpellSlots) d.status.usedSpellSlots = {}
        d.status.usedSpellSlots[slotLevel] = (d.status.usedSpellSlots[slotLevel] || 0) + 1
      }
      if (spell.concentration) {
        d.status.concentration = {
          spell: spell.name, level: slotLevel,
          since: new Date().toISOString(),
        }
      }
      if (!d.status.economy) d.status.economy = {}
      if (slotName) d.status.economy[slotName] = true
      if (slotLevel > 0) d.status.economy.leveledCast = true
    })
    setCastingFor(null)
  }
  function consumeResource(resourceId) {
    if (!applyCharacter || !resourceId) return
    const res = (computed?.resources || []).find(r => r.id === resourceId)
    const max = res?.max ?? Infinity
    applyCharacter(d => {
      if (!d.status) d.status = {}
      if (!d.status.usedResources) d.status.usedResources = {}
      const cur = d.status.usedResources[resourceId] || 0
      // Clamp at max so spamming "Verwenden" doesn't push the counter
      // past the resource cap (which would render harmlessly thanks
      // to Math.max in the display, but persisting an out-of-range
      // number is just noise on the row).
      if (cur < max) d.status.usedResources[resourceId] = cur + 1
    })
  }

  // Lazy-load the full spell list so we know each spell's casting
  // time and metadata. Without this, prepared spells fall through
  // when `character.spellMetadata` doesn't have them.
  const [spellMap, setSpellMap] = useState(null)
  useEffect(() => {
    if (!open) return
    const edition = character?.meta?.edition || '5e'
    let cancelled = false
    loadSpellList(edition).then(list => {
      if (cancelled) return
      const m = new Map()
      for (const s of list) m.set(s.name.toLowerCase(), s)
      setSpellMap(m)
    }).catch(() => { if (!cancelled) setSpellMap(new Map()) })
    return () => { cancelled = true }
  }, [open, character?.meta?.edition])

  // Lazy-load the feat catalog — needed to scan each character feat's
  // rule text for "as a (bonus) action" / "as a reaction" mentions
  // (Lucky, Sentinel, Telekinetic, Magic Initiate's spell sub-uses,
  // …). Data-driven over the entry text, no per-feat catalogue.
  const [featMap, setFeatMap] = useState(null)
  useEffect(() => {
    if (!open) return
    const edition = character?.meta?.edition || '5e'
    let cancelled = false
    import('../../lib/dataLoader').then(m => m.loadFeatList(edition)).then(list => {
      if (cancelled) return
      const m = new Map()
      for (const f of (list || [])) m.set(f.name.toLowerCase(), f)
      setFeatMap(m)
    }).catch(() => { if (!cancelled) setFeatMap(new Map()) })
    return () => { cancelled = true }
  }, [open, character?.meta?.edition])

  const buckets = useMemo(() => {
    const b = { action: [], bonusAction: [], reaction: [] }
    const edition = character?.meta?.edition || '5e'
    // Prof-Bonus für den Feature-Pill-Parser ableiten — dieselbe
    // Formel die das Charakter-Modell auch verwendet. Wir leiten
    // hier direkt aus den Klassen ab statt eine Prop durchzureichen,
    // damit der Memo-Pfad self-contained bleibt.
    const profBonus = Math.ceil(((character?.classes || []).reduce((s, c) => s + (c.level || 0), 0)) / 4) + 1

    // Universal standard actions everyone can take. Marked as kind
    // 'standard' so the renderer can differentiate styling later.
    const stdSet = STANDARD_ACTIONS[edition] || STANDARD_ACTIONS['5e']
    for (const slot of ['action', 'bonusAction', 'reaction']) {
      for (const a of (stdSet[slot] || [])) {
        b[slot].push({
          id: `std-${slot}-${a.name}`, name: a.name,
          damage: '', attack: '', range: '', target: '',
          kind: 'standard', notes: a.notes,
          economySlot: slot,
        })
      }
    }

    // Attacks: TWF / Psychic Blades bonus rows are tagged
    // `Bonus Action`; everything else defaults to Action.
    for (const atk of (computed?.attacks || [])) {
      const isBonus = (atk.properties || []).some(p => /bonus\s*action/i.test(String(p)))
      const slot = isBonus ? 'bonusAction' : 'action'
      b[slot].push({
        id: `atk-${atk.id || atk.name}`,
        name: atk.name,
        damage: atk.damage,
        attack: atk.attackDisplay,
        range: atk.range,
        target: '1 Ziel',
        kind: 'attack',
        economySlot: slot,
        // Weapon mastery (5.5e) — surfaced as its own pill in the row
        // so the player sees "this weapon's Mastery is Sap / Vex / …"
        // without having to expand. Keep the list raw; the renderer
        // looks up the short description per name.
        mastery: Array.isArray(atk.mastery) ? atk.mastery : [],
        damageType: atk.damageType,
        // Aktive Effekte auf dieser Waffe (Shillelagh, Magic Weapon, …)
        // mit Effect-ID damit ein Dismiss-Klick im UI den richtigen
        // Eintrag aus character.status.activeEffects entfernt.
        activeEffects: atk.activeEffects || [],
        magical: atk.magical,
        weaponId: atk.id,
        attacksPerAction: atk.attacksPerAction || 1,
        properties: atk.properties || [],
        markedAs: atk.markedAs || null,
        // Per-Roll-Advisory aus aktiver Konzentration (Hex / Hunter's
        // Mark / Bless / Divine Favor) — wird als Pille auf der Row
        // gerendert. rulesEngine setzt das Feld; kein Stat-Math.
        variableBuff: atk.variableBuff || null,
        notes: [
          atk.markedAs && `${atk.markedAs.label}: ${atk.markedAs.note}`,
        ].filter(Boolean).join(' • '),
      })
    }

    // Spells: pull every spell the character can cast through the
    // shared collector (cantrips + known + prepared + race-/feat-/
    // feature-granted), then look up each one's full data from the
    // loaded spell list (preferred) or the character's
    // spellMetadata cache (fallback). Routes to Action / Bonus /
    // Reaction by parsing castingTime.
    const meta = character?.spellMetadata || {}
    const collected = collectCharacterSpells(character) || []
    // Prepared-Caster-Filter: für Klassen vom Typ 'prepared' /
    // 'spellbook' (Wizard, Cleric, Druid, Paladin, Ranger 5.5e) nur
    // Spells die TATSÄCHLICH heute prepared sind erscheinen als
    // Actions. Sonst landen 50+ Wizard-Spellbook-Einträge in der
    // Action-Spalte und überfüllen sie. Known-Caster (Sorcerer/Bard/
    // Warlock 5e) und Cantrips + Granted-Spells (race/feat/feature)
    // bleiben unkonditional sichtbar.
    const preparedCasterIds = new Set()
    for (const cls of (character.classes || [])) {
      try {
        const sub = cls.subclassId?.split('__')[0] || null
        const mod = computed?.spellcasting?.[cls.classId]?.modifier ?? 0
        const info = getSpellcastingInfo(cls.classId, cls.level, mod, sub, edition)
        if (info?.type === 'prepared' || info?.type === 'spellbook') {
          preparedCasterIds.add(cls.classId)
        }
      } catch { /* ignore — class without spellcasting */ }
    }
    const preparedByClassLc = {}
    for (const [cid, names] of Object.entries(character?.status?.preparedSpells || {})) {
      preparedByClassLc[cid] = new Set((names || []).map(n => String(n).toLowerCase()))
    }
    function isCastableNow(c, fullSpell) {
      // Cantrips immer ok.
      if ((fullSpell?.level ?? 1) === 0) return true
      // Race/Feat/Custom-Grants sind permanent castbar (oder über
      // explicit "granted") — als Action verfügbar.
      if (c.granted) return true
      const origins = new Set(c.origins || [])
      if (origins.has('race') || origins.has('feat') || origins.has('custom')) return true
      // Class-Source: nur erlauben wenn mindestens EINE Source-Klasse
      // den Spell aktuell prepared hat ODER known-caster ist.
      for (const cid of (c.sourceClasses || [])) {
        if (!preparedCasterIds.has(cid)) return true   // known-caster
        if (preparedByClassLc[cid]?.has(c.name.toLowerCase())) return true
      }
      return false
    }
    const seenSpells = new Set()
    for (const c of collected) {
      const key = c.name.toLowerCase()
      if (seenSpells.has(key)) continue
      seenSpells.add(key)
      const full = spellMap?.get(key) || null
      const m = full || meta[c.name] || null
      // Apply prepared-filter before deciding to surface the row.
      if (!isCastableNow(c, full)) continue
      // 5etools `time` array stores `unit: "bonus" | "reaction" | "action"`
      // (no trailing "action" on "bonus"); formatCastingTime stringifies
      // to "1 bonus" / "1 reaction …" / "1 action". Match the unit word
      // with a word boundary so each branch is unambiguous. Order
      // matters: bonus and reaction must precede the plain action
      // branch because every reaction string also contains "action" via
      // surrounding prose. Default to action when we have no metadata
      // at all (e.g. spell list still loading) so the row is at least
      // visible somewhere.
      const ct = String(m?.castingTime || '').toLowerCase()
      let slot = null
      if (/\bbonus(?:\s*action)?\b/.test(ct))   slot = 'bonusAction'
      else if (/\breaction\b/.test(ct))          slot = 'reaction'
      else if (/\baction\b/.test(ct))            slot = 'action'
      else if (!m) slot = 'action'
      if (!slot) continue
      // Extract a brief description from the spell's entries when
      // available — first ~180 chars of the first string entry.
      const firstString = (full?.entries || []).find(e => typeof e === 'string' && e.length > 8)
      const desc = firstString
        ? String(firstString).replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
        : null
      // `granted: true` = always-prepared spell (race trait / feat /
      // class feature). Surfaces as its own row kind so the sort
      // groups them above the regular prepared/known spells and the
      // UI can tag them visually ("Always").
      const isAlways = !!c.granted
      // Smart-Pill-Extraktion: Attack/Save/Damage werden aus dem
      // 5etools-Eintrag rausgeparsed und mit dem Spellcasting-Profil
      // der Caster-Klasse veredelt. Multiclass: bevorzugt die Klasse,
      // die den Spell auf der Liste hat und die höchste DC/Bonus
      // hat — Player-favoured. Cantrip-Dmg skaliert mit Char-Level.
      const casterClassId = pickCasterClassFor(c, computed)
      const sc = casterClassId ? computed?.spellcasting?.[casterClassId] : null
      const totalCharLevel = (character.classes || []).reduce((s, x) => s + (x.level || 0), 0)
      const fx = parseSpellEffect(full || m, {
        spellAttackBonus: sc?.spellAttackBonus ?? null,
        saveDC:           sc?.spellSaveDC ?? null,
        totalCharLevel,
      })
      const spellPayload = {
        id: `spell-${c.name}`,
        // Spell-Level wandert in eine Pill statt als "(L1)"-Suffix
        // hinter den Namen — der Eintrag bleibt damit kompakter und
        // der Spellname ist nicht von Klammern zerschnitten.
        name: c.name,
        damage: '—',
        attack: '',
        range: full?.range || m?.range || '—',
        target: '—',
        kind: isAlways ? 'always-spell' : 'spell',
        badge: isAlways ? 'Always' : null,
        spell: {
          name: c.name,
          level: full?.level ?? 0,
          concentration: !!full?.concentration,
          ritual: !!full?.ritual,
        },
        economySlot: slot,
        // Full spell meta surfaces in the expanded body: 5etools
        // `entries`, casting time, range, duration, components, school,
        // ritual / concentration flags. Drives the rich description
        // panel and the per-spell slot count rendered as a pill.
        spellMeta: full || m || null,
        effectPills: fx?.pills || [],
        notes: '',
      }
      b[slot].push(spellPayload)
      // Wenn der Spell at-will/granted IST UND der Spieler ihn
      // ZUSÄTZLICH manuell preparen wollte, kommt ein 2. Eintrag rein:
      // einer als "Always" (gratis cast, kein Slot), einer als
      // regulärer "Spell" der Slots verbraucht. Erlaubt z.B. Magic
      // Initiate's Mage Armor zusätzlich aus dem Wizard-Spellslot zu
      // wirken. Erkennung über status.preparedSpells — wird nur
      // emitted wenn der Spell explizit zusätzlich geprep'd ist und
      // nicht-Cantrip ist.
      const preparedByClass = character?.status?.preparedSpells || {}
      const explicitlyPrepped = isAlways
        && (full?.level || 0) > 0
        && Object.values(preparedByClass).some(list => (list || []).some(n => n.toLowerCase() === key))
      if (explicitlyPrepped) {
        b[slot].push({
          ...spellPayload,
          id: `spell-${c.name}-prepped`,
          kind: 'spell',
          badge: null,
        })
      }
    }

    // Shared text-walker + action-economy detector. Walks 5etools
    // nested `entries`/`items` arrays so phrasings buried in
    // sub-features still get matched (Magic Initiate's spell
    // sub-uses, Sentinel's sub-clauses, etc.). Detector handles
    // canonical English ("as a bonus action"), 5.5e XPHB phrasing
    // ("you can take a Bonus Action", "you can take a Reaction"),
    // and the "use your reaction/action" variants. Pure regex, no
    // per-feature table — new features benefit automatically.
    const flattenEntries = (entries) => {
      const parts = []
      const walk = (n) => {
        if (typeof n === 'string') parts.push(n)
        else if (Array.isArray(n)) for (const x of n) walk(x)
        else if (n && typeof n === 'object') {
          if (Array.isArray(n.entries)) walk(n.entries)
          if (Array.isArray(n.items))   walk(n.items)
          if (Array.isArray(n.rows))    walk(n.rows.flat())
        }
      }
      walk(entries || [])
      // Strip 5etools rule-link tags ({@variantrule Bonus Action|XPHB},
      // {@spell ...}, {@condition charmed}, …) — the wrapping breaks
      // plain-text pattern matching otherwise. XPHB's Steady Aim says
      // "As a {@variantrule Bonus Action|XPHB}", which means a naive
      // `as a bonus action` regex would never match.
      return parts
        .join(' ')
        .replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
    }
    const detectActionSlot = (entries) => {
      const raw = flattenEntries(entries).toLowerCase()
      if (!raw) return null
      // Bonus action variants
      if (/\bas\s+a\s+bonus\s*action\b/.test(raw)) return 'bonusAction'
      if (/\b(?:you\s+can\s+(?:take|use|spend|use\s+your)|take|use)\s+a\s+bonus\s+action\b/.test(raw)) return 'bonusAction'
      // Reaction variants
      if (/\bas\s+a\s+reaction\b/.test(raw)) return 'reaction'
      if (/\b(?:you\s+can\s+)?(?:take|use|spend|use\s+your)\s+(?:a\s+|your\s+)?reaction\b/.test(raw)) return 'reaction'
      // Action variants
      if (/\bas\s+an?\s+action\b/.test(raw)) return 'action'
      if (/\b(?:you\s+can\s+)?(?:take|use)\s+(?:an?\s+|your\s+)action\b/.test(raw)) return 'action'
      return null
    }

    // Active class / subclass features whose entry text declares an
    // action economy ("as a bonus action you can …" / "as a
    // reaction" / "as an action"). __activeFeatures is populated at
    // sheet load (CharacterSheetPage.hydrateClassDataAndRecompute).
    // Detect "menu" features — class traits like Rogue Cunning Action
    // that let you take a basic action via a different action type.
    // We scan the feature text for STANDARD_ACTIONS names; if we find
    // ≥2, the feature is treated as a sub-action menu and the expand
    // body renders each referenced basic action with its rule blurb
    // (like the consolidated "Basic Actions" entry does).
    const stdAll = [
      ...(STANDARD_ACTIONS[edition]?.action      || []),
      ...(STANDARD_ACTIONS[edition]?.bonusAction || []),
      ...(STANDARD_ACTIONS[edition]?.reaction    || []),
    ]
    for (const f of (character?.__activeFeatures || [])) {
      const slot = detectActionSlot(f.entries)
      if (!slot) continue
      const raw = flattenEntries(f.entries).toLowerCase()
      // Collect referenced standard actions — case-insensitive whole-
      // word matches against the feature's prose. Skips one-off
      // mentions ("the Attack action" alone) by requiring ≥2 hits.
      const matched = []
      for (const a of stdAll) {
        const re = new RegExp(`\\b${a.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i')
        if (re.test(raw)) matched.push(a)
      }
      const subActions = matched.length >= 2 ? matched : null
      const fxF = parseFeatureEffect(f, character, profBonus, { classDataMap: character?.__classDataMap })
      b[slot].push({
        id: `feat-${f.classId}-${f.name}-${f.level}`,
        // Color-Marker / Favoriten-Key im einheitlichen
        // favoriteKey-Format. Identisch zu was die Features-Tab
        // bei der ExpandableEntryCard nutzt.
        markerKey: `feature:${f.classId}:${f.name}:${f.level || ''}`,
        name: `${f.name}`,
        damage: '—', attack: '', range: '—', target: '—',
        kind: 'feature',
        economySlot: slot,
        entries: f.entries || null,
        sub: `${f.classId}${f.level ? ` · Lv ${f.level}` : ''}`,
        subActions,
        effectPills: fxF?.pills || [],
        notes: '',
      })
    }

    // Species traits with action economy (Aasimar Healing Hands, …)
    // — sowie passive Trigger-Features (Bugbear Surprise Attack, …)
    // die kein "as an action" tragen aber während des normalen
    // Attack-Wurfs feuern. Data-driven über parseFeatureEffect:
    // wenn die Pills einen Trigger ODER Damage liefern, gehört das
    // Trait ins Action-Bucket damit der Spieler die Pille sieht.
    for (const t of (character?.species?.__traits || [])) {
      const fxT = parseFeatureEffect({ ...t, classId: null }, character, profBonus, { classDataMap: character?.__classDataMap })
      const explicitSlot = detectActionSlot(t.entries)
      const hasTriggerPill = (fxT?.pills || []).some(p => p.kind === 'trigger')
      const hasDamagePill  = (fxT?.pills || []).some(p => p.kind === 'damage' || p.kind === 'damage-bonus')
      // Passive Trigger ohne explizite Action-Economy → ins Action-
      // Bucket weil er bei einem normalen Attack-Wurf feuert.
      const slot = explicitSlot || ((hasTriggerPill || hasDamagePill) ? 'action' : null)
      if (!slot) continue
      b[slot].push({
        id: `race-${t.name}`,
        markerKey: `trait:${t.name}`,
        name: t.name,
        damage: '—', attack: '', range: '—', target: '—',
        kind: 'species',
        economySlot: slot,
        entries: t.entries || null,
        sub: explicitSlot ? 'Species' : 'Species · Trigger',
        effectPills: fxT?.pills || [],
        notes: '',
      })
    }

    // Attunete Magic Items mit Action-Economy. Wand of Magic Missiles,
    // Cloak of Displacement, Ring of Invisibility etc. — alle haben
    // ihre Aktivierung als "As an action, …" / "As a bonus action, …"
    // / "As a reaction, …" in den entries. Wir scannen den gleichen
    // detectActionSlot-Pfad wie für Klassen-Features, damit jedes
    // neu hinzukommende Item automatisch erkannt wird ohne Catalog-
    // Maintenance.
    //
    // Bedingungen:
    //   • Item ist auf dem Charakter
    //   • Item ist laut 5etools-Daten attunbar (reqAttune truthy)
    //   • Spieler hat sich attuned (attuned === true)
    //   • Item hat `entries` (vom backfillItemMetadata gefüllt)
    const inventoryItems = [
      ...((character?.inventory?.items) || []),
      ...((character?.custom?.items)    || []),
    ]
    for (const item of inventoryItems) {
      if (!item || !item.reqAttune || !item.attuned) continue
      if (!Array.isArray(item.entries) || item.entries.length === 0) continue
      const slot = detectActionSlot(item.entries)
      if (!slot) continue
      b[slot].push({
        id: `item-${item.id || item._id || item.name}`,
        markerKey: `item:${item.id || item._id || item.name}`,
        name: item.customName || item.name,
        damage: '—', attack: '', range: '—', target: '—',
        kind: 'item',
        economySlot: slot,
        entries: item.entries,
        sub: 'Item · Attuned',
        notes: '',
      })
    }

    // Feats with action economy. Entries come from the lazy-loaded
    // feat catalog (`featMap`); when it hasn't arrived yet the rows
    // pop in on the next render. Recursive walk picks up Magic
    // Initiate's spell sub-uses, Sentinel's sub-clauses, etc.
    if (featMap) {
      for (const feat of (character?.feats || [])) {
        const key = String(feat.featId || feat.name || '').toLowerCase()
        if (!key) continue
        const fd = featMap.get(key)
        if (!fd || !Array.isArray(fd.entries)) continue
        const slot = detectActionSlot(fd.entries)
        if (!slot) continue
        b[slot].push({
          id: `feat-${key}`,
          markerKey: `feat:${feat.featId || feat.name}`,
          name: feat.featId || feat.name,
          damage: '—', attack: '', range: '—', target: '—',
          kind: 'feature',
          economySlot: slot,
          entries: fd.entries,
          sub: 'Feat',
          notes: '',
        })
      }
    }

    // Attach uses info from computed.resources. Match by name keyword
    // (case-insensitive substring) — so the "Hunter's Mark" spell
    // entry links to the "Favored Enemy" resource (XPHB stores
    // Hunter's Mark uses under the Favored Enemy class feature), and
    // "Second Wind" feature row links to the Second Wind resource.
    // Anything that doesn't match keeps `uses = null` and renders no
    // counter — at-a-glance "infinite / slot-based" vs "limited".
    const resources = computed?.resources || []
    const usedResources = character?.status?.usedResources || {}
    const resKeyOf = (name) => {
      const lower = String(name).toLowerCase()
      // Hardcoded synonyms kept tiny — Hunter's Mark IS Favored Enemy
      // in 5.5e, the data doesn't give a different name to match.
      if (/hunter's\s*mark/.test(lower)) {
        return resources.find(r => /favored\s*(?:enemy|foe)/i.test(r.name))
      }
      // Otherwise: substring match against the resource name.
      return resources.find(r => lower.includes(String(r.name).toLowerCase()))
    }
    for (const k of Object.keys(b)) {
      for (const row of b[k]) {
        if (row.kind === 'standard' || row.kind === 'attack') continue
        // Additionally-prepped Kopie eines always-prepared Spells
        // (kind='spell' + always-spell-Twin existiert): NICHT mit der
        // racial / feature-resource verlinken. Dieser Spieler-erstellte
        // Eintrag verbraucht Slots, nicht die rassen-/feature-Uses.
        // Erkennung: die ID endet auf '-prepped' (vom Bucket-Builder).
        if (row.kind === 'spell' && String(row.id || '').endsWith('-prepped')) continue
        // Normale Class-Prep-Spells (kind='spell' ohne always-Kontext)
        // bekommen ebenfalls KEINE Resource-Uses — sie sind slot-
        // basiert. Die uses-Spalte ist nur für Granted-Spells mit
        // begrenzten Uses (race/feat/feature) sinnvoll.
        if (row.kind === 'spell') continue
        const res = resKeyOf(row.name)
        if (!res || !res.max) continue
        const used = usedResources[res.id] || 0
        row.uses = { remaining: Math.max(0, res.max - used), max: res.max, label: res.name }
        // resourceId on the row so the "Use" button knows what to
        // increment (consumeResource(row.resourceId)).
        row.resourceId = res.id
      }
    }

    // Attach slot availability to spell rows so the explorer can show
    // "3/3 slots" inline. Cantrips display "At-Will"; pact slots fold
    // into the matching level so a Warlock sees a combined pool.
    const slotsArr = slots?.slots || null
    const warlock  = slots?.warlockSlots || null
    for (const k of Object.keys(b)) {
      for (const row of b[k]) {
        if (row.kind !== 'spell' && row.kind !== 'always-spell') continue
        const lv = row.spell?.level ?? 0
        if (lv === 0) {
          row.slotLabel = 'At-Will'
          row.slotAvailable = true
        } else {
          const total = Array.isArray(slotsArr) ? (slotsArr[lv - 1] || 0) : 0
          const used  = usedSlots[lv] || 0
          let remain  = Math.max(0, total - used)
          let totalDisp = total
          if (warlock && warlock.level === lv) {
            const pactRemain = Math.max(0, warlock.slots - usedPact)
            remain    += pactRemain
            totalDisp += warlock.slots
          }
          row.slotLabel = `${remain}/${totalDisp}`
          row.slotAvailable = totalDisp === 0 || remain > 0
        }
      }
    }

    // Sort each bucket. always-spells (granted by race / feat /
    // feature) get their own slot above regular spells so they
    // visually group as an "Always" category at a glance. Standard
    // actions stay pinned at the top.
    const kindOrder = { standard: 0, attack: 1, 'always-spell': 2, spell: 3, feature: 4, species: 5, item: 6 }
    for (const k of Object.keys(b)) {
      b[k].sort((a, c) =>
        ((kindOrder[a.kind] ?? 99) - (kindOrder[c.kind] ?? 99))
        || a.name.localeCompare(c.name))
    }
    return b
  }, [character, computed, spellMap, featMap])

  // Hasted Action tab: only available while concentrating on Haste,
  // and filtered to the restricted set the spell allows — "one
  // Attack, Dash, Disengage, Hide, or Use Object". Single attack
  // means we surface ONE weapon attack chip (the first one we have
  // available) rather than the whole attack list. Restrictions are
  // visual only; the player still drives the game socially.
  const concSpell = String(character?.status?.concentration?.spell || character?.status?.concentration?.name || '').toLowerCase()
  const hasted = /\bhaste\b/.test(concSpell)
  const HASTED_NAMES = /^(attack|dash|disengage|hide|use\s*object|utilize|magic)$/i
  if (hasted) {
    const seenAttack = { v: false }
    buckets.hastedAction = []
    for (const r of buckets.action) {
      if (r.kind === 'attack') {
        if (seenAttack.v) continue
        seenAttack.v = true
        buckets.hastedAction.push({ ...r, id: `hasted-${r.id}`, economySlot: 'hastedAction' })
      } else if (r.kind === 'standard' && HASTED_NAMES.test(r.name)) {
        buckets.hastedAction.push({ ...r, id: `hasted-${r.id}`, economySlot: 'hastedAction' })
      }
    }
  }

  const total = buckets.action.length + buckets.bonusAction.length + buckets.reaction.length
    + (buckets.hastedAction?.length || 0)

  // Pinned-Set live ableiten — wir aggregieren über alle Buckets,
  // damit "★" der zentrale Anlaufpunkt für gepinnte Einträge ist.
  // Sub-Gruppen pro Action-Type bleiben innerhalb des Tabs erhalten.
  const pinnedKeys = useMemo(() => getPinnedActions(character), [character?.status?.pinnedActions])
  const pinnedByEconomy = useMemo(() => {
    if (!pinnedKeys.length) return null
    const slots = ['action', 'bonusAction', 'reaction', 'hastedAction']
    const out = {}
    let total = 0
    for (const s of slots) {
      const src = buckets[s] || []
      const hit = src.filter(r => {
        const k = rowMarkerKey(r)
        return k && pinnedKeys.includes(k)
      })
      if (hit.length > 0) {
        out[s] = hit
        total += hit.length
      }
    }
    out.__total = total
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedKeys.join('|'), buckets.action, buckets.bonusAction, buckets.reaction, buckets.hastedAction])

  // Tab-Labels jetzt abgekürzt (Act / BA / Re / Hast) plus ★-Tab als
  // erster Eintrag wenn überhaupt etwas gepinnt ist. Vollnamen über
  // `title` Attribut für Accessibility.
  const tabs = []
  const pinnedTotal = pinnedByEconomy?.__total || 0
  if (pinnedTotal > 0) {
    tabs.push({ id: 'pinned', label: '★', title: 'Pinned', color: 'var(--accent-cyan)' })
  }
  tabs.push(
    { id: 'action',      label: 'A',  title: 'Action',       color: 'var(--accent-red)' },
    { id: 'bonusAction', label: 'BA', title: 'Bonus Action', color: 'var(--accent-yellow)' },
    { id: 'reaction',    label: 'R',  title: 'Reaction',     color: 'var(--accent-purple)' },
  )
  if (hasted && buckets.hastedAction?.length > 0) {
    tabs.push({ id: 'hastedAction', label: 'HA', title: 'Hasted Action', color: 'var(--accent-blue)' })
  }
  // If the currently-selected tab vanished (e.g. concentration on
  // Haste dropped while the player was on the Hasted tab), fall back
  // to Action so we never render against an empty bucket. Must stay
  // ABOVE any early return — total flips between 0 and >0 between
  // renders, and a hook below a conditional return triggers React #310.
  useEffect(() => {
    if (!tabs.some(t => t.id === tab)) setTab(pinnedTotal > 0 ? 'pinned' : 'action')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.map(t => t.id).join('|')])

  if (total === 0) return null
  const rows = tab === 'pinned' ? [] : (buckets[tab] || [])

  return (
    <div style={embedded ? { marginTop: 0 } : { marginTop: 10 }}>
      {!embedded && (
        <button type="button" onClick={() => setOpen(o => !o)} style={caeToggle}>
          {open ? '▼' : '▶'} Actions ({total})
        </button>
      )}
      {open && (
        <div style={embedded ? { ...caeBody, padding: 0, border: 'none', background: 'transparent' } : caeBody}>
          <div style={caeTabs}>
            {tabs.map(t => {
              const sel = tab === t.id
              const n = t.id === 'pinned' ? pinnedTotal : (buckets[t.id]?.length || 0)
              return (
                <button key={t.id} type="button" onClick={() => setTab(t.id)}
                  title={t.title || t.label}
                  style={{
                    ...caeTab,
                    borderColor: sel ? t.color : 'var(--border)',
                    color: sel ? t.color : 'var(--text-muted)',
                    background: sel ? 'color-mix(in srgb, var(--bg-elevated) 70%, transparent)' : 'transparent',
                  }}>
                  {t.label} <span style={caeTabCount}>{n}</span>
                </button>
              )
            })}
          </div>
          {tab === 'pinned' ? (
            // ★-Tab: gruppiert die gepinnten Rows zuerst nach Action-
            // Type (Action / Bonus Action / Reaction / Hasted Action)
            // und reicht jede Untergruppe an die normale CategorisedList
            // weiter, damit Sub-Kategorien (Features, Items, Spells by
            // level) unverändert greifen.
            ['action', 'bonusAction', 'reaction', 'hastedAction']
              .filter(s => pinnedByEconomy?.[s]?.length > 0)
              .map(slot => {
                const slotLabel = slot === 'action' ? 'Action'
                  : slot === 'bonusAction' ? 'Bonus Action'
                  : slot === 'reaction' ? 'Reaction'
                  : 'Hasted Action'
                const slotColor = slot === 'action' ? 'var(--accent-red)'
                  : slot === 'bonusAction' ? 'var(--accent-yellow)'
                  : slot === 'reaction' ? 'var(--accent-purple)'
                  : 'var(--accent-blue)'
                return (
                  <div key={slot} style={{ marginBottom: 10 }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
                      textTransform: 'uppercase',
                      color: slotColor,
                      padding: '4px 0 4px',
                      borderBottom: `1px dashed ${slotColor}`,
                      marginBottom: 4,
                    }}>{slotLabel}</div>
                    <CombatActionsCategorisedList
                      rows={pinnedByEconomy[slot]}
                      expanded={expanded}
                      setExpanded={setExpanded}
                      slots={slots}
                      usedSlots={usedSlots}
                      usedPact={usedPact}
                      castingFor={castingFor}
                      setCastingFor={setCastingFor}
                      castSpellFromExplorer={castSpellFromExplorer}
                      markActionUsed={markActionUsed}
                      consumeResource={consumeResource}
                      applyRowSideEffects={applyRowSideEffects}
                      character={character}
                      applyCharacter={applyCharacter}
                      hidePinnedCategory
                    />
                  </div>
                )
              })
          ) : rows.length === 0 ? (
            <div style={caeEmpty}>Nichts in dieser Kategorie.</div>
          ) : (
            <CombatActionsCategorisedList
              rows={rows}
              expanded={expanded}
              setExpanded={setExpanded}
              slots={slots}
              usedSlots={usedSlots}
              usedPact={usedPact}
              castingFor={castingFor}
              setCastingFor={setCastingFor}
              castSpellFromExplorer={castSpellFromExplorer}
              markActionUsed={markActionUsed}
              consumeResource={consumeResource}
              applyRowSideEffects={applyRowSideEffects}
              character={character}
              applyCharacter={applyCharacter}
            />
          )}
        </div>
      )}
      {/* Weapon-Buff-Target-Modal — überlagert die Action-Spalte
          wenn ein SPELL_WEAPON_BUFFS-Spell gecastet wird (Shillelagh,
          Magic Weapon, …). Spieler wählt Waffe, dann läuft der Cast
          (Slot + Concentration + Effect-Apply atomar) durch. */}
      {buffPrompt && (
        <WeaponBuffTargetModal
          spell={buffPrompt.spell}
          character={character}
          onCancel={() => setBuffPrompt(null)}
          onPick={(weapon, pickOpts = {}) => {
            const buff = getSpellWeaponBuff(buffPrompt.spell.name)
            if (buff) {
              // Spell-Objekt mitgeben damit Shillelagh die
              // scalingLevelDice-Daten konsultieren kann (kein
              // Hardcode mehr).
              const built = buff.buildEffect(character, weapon, { ...pickOpts, spell: buffPrompt.spell })
              addActiveEffect(applyCharacter, {
                kind: built.kind,
                source: `spell:${buffPrompt.spell.name}`,
                target: { kind: 'weapon', id: weapon.id, label: weapon.customName || weapon.name },
                value: built.value || {},
                until: buff.duration,
              })
            }
            // Slot/Concentration/Economy via originalen Cast-Pfad —
            // __skipBuffPrompt verhindert Rekursion in den Picker.
            const { spell, slotLevel, opts } = buffPrompt
            setBuffPrompt(null)
            castSpellFromExplorer(spell, slotLevel, { ...opts, __skipBuffPrompt: true })
          }}
        />
      )}
    </div>
  )
}

// Compact-Button im Section-Header der HP-Spalte. Öffnet das
// ConditionsPickerModal. Aktiv-Counter (Zahl in der Mitte) bleibt
// dezent — wenn 0 Conditions aktiv sind, zeigen wir nur das "+"-Glyph.
function ConditionsButton({ active = [], onOpen }) {
  const count = active.length
  return (
    <button
      type="button"
      onClick={onOpen}
      title={count > 0
        ? `${count} aktive Condition${count === 1 ? '' : 's'} — klick zum Bearbeiten`
        : 'Conditions verwalten'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 8px', borderRadius: 6,
        border: `1px solid ${count > 0 ? 'var(--accent-red)' : 'var(--border-subtle)'}`,
        background: count > 0
          ? 'color-mix(in srgb, var(--accent-red) 16%, transparent)'
          : 'transparent',
        color: count > 0 ? 'var(--accent-red)' : 'var(--text-secondary)',
        cursor: 'pointer', fontSize: 11, fontWeight: 700,
        fontFamily: 'inherit',
      }}
    >
      <span style={{ fontSize: 12, lineHeight: 1 }}>⚠</span>
      <span>{count > 0 ? `Conditions (${count})` : 'Conditions'}</span>
    </button>
  )
}

// Overlay-Modal mit allen 5e-Conditions als Toggle-Chips. Schreibt
// in character.status.conditions; die aktive Liste wird auch oben in
// der Resistance-Spalte gerendert.
function ConditionsPickerModal({ character, updateCharacter, onClose }) {
  const active = character.status?.conditions || []
  function toggle(id, on) {
    const cur = character.status?.conditions || []
    const next = on
      ? [...cur.filter(x => x !== id), id]
      : cur.filter(x => x !== id)
    updateCharacter('status.conditions', next)
  }
  return (
    <div style={wmModalOverlay} onClick={onClose}>
      <div style={wmModalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 12,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            Conditions
          </div>
          <button type="button" onClick={onClose} style={wmModalClose}>×</button>
        </div>
        <ConditionChips active={active} onToggle={toggle} />
        <FeatureNoteList notes={getEffectsForSlot(character, 'conditions')} />
      </div>
    </div>
  )
}

// Modal-Popup das beim Cast eines Weapon-Buff-Spells erscheint.
// Stoppt die Cast-Pipeline und lässt den Spieler eine Ziel-Waffe wählen.
function WeaponBuffTargetModal({ spell, character, onCancel, onPick }) {
  const buff = getSpellWeaponBuff(spell?.name)
  const [showAll, setShowAll] = useState(false)
  // Damage-Type-Picker für Spells mit damageTypeOptions (Elemental
  // Weapon: acid/cold/fire/lightning/thunder). Default = erste Option.
  const dmgTypeOpts = buff?.damageTypeOptions || null
  const [dmgType, setDmgType] = useState(dmgTypeOpts ? dmgTypeOpts[0] : null)
  const eligible = getEligibleWeapons(character, spell?.name)
  const allWeapons = [
    ...((character?.inventory?.items) || []),
    ...((character?.custom?.items) || []),
  ].filter(i => i?.isWeapon || ['M', 'R'].includes(String(i?.type || '').split('|')[0]))
  const list = (showAll || eligible.length === 0) ? allWeapons : eligible
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-card, #1a1a1a)',
        border: '1px solid var(--accent-orange, #ff9533)',
        borderRadius: 10, padding: 16,
        width: 'min(420px, 90vw)', maxHeight: '80vh', overflowY: 'auto',
      }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: 'var(--accent-orange, #ff9533)',
          marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5,
        }}>{buff?.label || spell?.name} — Ziel wählen</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          Auf welche Waffe soll {spell?.name} wirken?
        </div>
        {dmgTypeOpts && (
          <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Damage-Type:</span>
            {dmgTypeOpts.map(t => (
              <button key={t} type="button"
                onClick={() => setDmgType(t)}
                style={{
                  padding: '3px 8px', fontSize: 11, borderRadius: 4,
                  cursor: 'pointer', fontFamily: 'inherit',
                  border: `1px solid ${dmgType === t ? 'var(--accent-orange, #ff9533)' : 'var(--border)'}`,
                  color: dmgType === t ? 'var(--accent-orange, #ff9533)' : 'var(--text-secondary)',
                  background: dmgType === t
                    ? 'color-mix(in srgb, var(--accent-orange, #ff9533) 14%, transparent)'
                    : 'transparent',
                  fontWeight: dmgType === t ? 700 : 400,
                }}>
                {t[0].toUpperCase()}{t.slice(1)}
              </button>
            ))}
          </div>
        )}
        {eligible.length > 0 && (
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, cursor: 'pointer',
          }}>
            <input type="checkbox" checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)} />
            Alle Waffen anzeigen (überschreibt Spell-Filter)
          </label>
        )}
        {eligible.length === 0 && allWeapons.length > 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 8 }}>
            Keine Waffe passt strikt zum Spell-Filter — alle Waffen werden gelistet.
          </div>
        )}
        {list.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            Keine Waffen im Inventar. Lege erst Waffen an, dann nochmal versuchen.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {list.map(w => (
              <button key={w.id} type="button" onClick={() => onPick(w, { damageType: dmgType })}
                style={{
                  padding: '8px 10px', fontSize: 12,
                  textAlign: 'left',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--accent-orange, #ff9533)',
                  borderRadius: 6,
                  color: 'var(--accent-orange, #ff9533)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {w.customName || w.name}
                {w.dmg1 && <span style={{ color: 'var(--text-dim)', marginLeft: 6, fontSize: 11 }}>
                  {w.dmg1} {w.dmgType || ''}
                </span>}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="button" onClick={onCancel} style={{
            padding: '5px 12px', fontSize: 11,
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-muted)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
          }}>Abbrechen</button>
        </div>
      </div>
    </div>
  )
}
// Renders the explorer's row list as collapsible categories. Each
// `kind` becomes its own header; standard actions are consolidated
// into a single "Basic Actions" expandable; spells subdivide by
// level (Cantrip / Level 1 / …). All groups are open by default.
// Erweiterter Expand-Body fuer Action-Rows mit Desc/Notes-Toggle.
// Desc = standard ActionRowExpandedBody, Notes = freie Textarea die
// in customNotes[mKey].body schreibt. Plus die Editor-Zeile unten
// (Color-Picker + Custom-Pill + Pin-Button) bleibt da wie gehabt.
function ActionExpandedBlock({ r, character, applyCharacter, mKey, mColor }) {
  const [mode, setMode] = useState('desc')
  const note = mKey ? getCustomNote(character, mKey) : null
  return (
    <>
      {mKey && (
        <div style={{
          display: 'flex', justifyContent: 'flex-end',
          padding: '4px 8px 0',
        }} onClick={(e) => e.stopPropagation()}>
          <div style={viewToggleWrapInline}>
            <button type="button"
              onClick={() => setMode('desc')}
              style={viewToggleBtnInline(mode === 'desc')}>Desc</button>
            <button type="button"
              onClick={() => setMode('notes')}
              style={viewToggleBtnInline(mode === 'notes')}>Notes</button>
          </div>
        </div>
      )}
      {mode === 'desc' && <ActionRowExpandedBody row={r} />}
      {mode === 'notes' && mKey && (
        <div style={{ padding: '6px 10px' }} onClick={(e) => e.stopPropagation()}>
          <textarea
            value={note?.body || ''}
            placeholder="Deine Notizen zu diesem Eintrag …"
            onChange={(e) => setCustomNote(applyCharacter, mKey, { body: e.target.value })}
            style={{
              width: '100%', minHeight: 80,
              padding: '6px 8px', fontSize: 12, lineHeight: 1.45,
              background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)', borderRadius: 6,
              fontFamily: 'inherit', resize: 'vertical',
            }}
          />
        </div>
      )}
      {mKey && applyCharacter && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          padding: '4px 10px 6px',
          borderTop: '1px solid var(--border-subtle)',
        }}
          onClick={(e) => e.stopPropagation()}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Stripe:</span>
            <CardColorPicker
              color={mColor}
              onChange={(c) => setColorMarker(applyCharacter, mKey, c)}
              compact
            />
          </span>
          <input
            type="text"
            defaultValue={note?.pillText || ''}
            placeholder="Pill-Hinweis"
            onBlur={(e) => setCustomNote(applyCharacter, mKey, { pillText: e.target.value })}
            style={{
              width: 110, padding: '2px 6px', fontSize: 11,
              background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)', borderRadius: 4,
              fontFamily: 'inherit',
            }}
          />
          <input
            type="color"
            value={note?.pillColor || mColor || '#888888'}
            onChange={(e) => setCustomNote(applyCharacter, mKey, { pillColor: e.target.value })}
            title="Pill-Farbe"
            style={{
              width: 22, height: 20, padding: 0,
              background: 'transparent',
              border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer',
            }}
          />
          <button
            type="button"
            onClick={() => togglePinnedAction(applyCharacter, mKey)}
            title={isPinnedAction(character, mKey)
              ? 'Aus Pinned entfernen'
              : 'Oben in Pinned anheften'}
            style={{
              fontSize: 11, padding: '2px 8px',
              background: isPinnedAction(character, mKey)
                ? 'color-mix(in srgb, var(--accent-yellow) 18%, transparent)'
                : 'transparent',
              color: isPinnedAction(character, mKey)
                ? 'var(--accent-yellow)' : 'var(--text-muted)',
              border: `1px solid ${isPinnedAction(character, mKey)
                ? 'var(--accent-yellow)' : 'var(--border)'}`,
              borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
              marginLeft: 'auto',
            }}
          >
            {isPinnedAction(character, mKey) ? '★ Pinned' : '☆ Pin'}
          </button>
        </div>
      )}
    </>
  )
}

const viewToggleWrapInline = {
  display: 'inline-flex',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  overflow: 'hidden',
}
function viewToggleBtnInline(active) {
  return {
    padding: '2px 8px', fontSize: 10, fontWeight: 700,
    letterSpacing: 0.3, textTransform: 'uppercase',
    background: active ? 'var(--bg-card, var(--bg-inset))' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
  }
}

function CombatActionsCategorisedList({
  rows, expanded, setExpanded,
  slots, usedSlots, usedPact, castingFor, setCastingFor,
  castSpellFromExplorer, markActionUsed, consumeResource, applyRowSideEffects,
  character, applyCharacter,
  hidePinnedCategory = false,
}) {
  // Pill-Farben sind lokal-state, also Hook hier separat aufrufen
  // statt durch Props zu reichen — vermeidet eine Prop-Drilling-
  // Kette wenn der Parent ihn schon hat.
  const pillColors = usePillColors()
  // Open/closed state per category id. Open by default — feels less
  // like a series of clicks to get going. Beide Werte persistieren in
  // localStorage, gekeyt per Character damit Reload den Layout-State
  // 1:1 wiederherstellt.
  const cidForPrefs = character?.id || 'default'
  const [closedCats, setClosedCats] = usePersistedSet(`cae_closedCats_${cidForPrefs}`, [])
  const [basicOpen, setBasicOpen]   = usePersistedState(`cae_basicOpen_${cidForPrefs}`, false)

  // Categorisation: per user spec, the action overview is now
  //   1. Basic Actions  (consolidated)
  //         · plus any class "menu" features (Cunning Action, etc.)
  //           that act as alternative basic-action paths for this slot
  //   2. Class & Species Features (everything else not a menu)
  //   3. Attacks & Cantrips  (weapon attacks + level-0 spells together)
  //   4. Spells, one category per non-cantrip level
  const cats = useMemo(() => {
    const out = []
    const byKind = {}
    for (const r of rows) {
      const k = r.kind || 'other'
      if (!byKind[k]) byKind[k] = []
      byKind[k].push(r)
    }
    const standards   = byKind['standard'] || []
    const features    = byKind['feature']  || []
    const species     = byKind['species']  || []
    const attacks     = byKind['attack']   || []
    const items       = byKind['item']     || []
    const spells      = [...(byKind['spell'] || []), ...(byKind['always-spell'] || [])]

    // Menu features (Cunning Action etc.) get promoted into the
    // Basic Actions group — their subActions ARE basic actions in
    // the player's current slot, so they belong with the standards.
    const menuFeatures   = features.filter(f => Array.isArray(f.subActions) && f.subActions.length > 0)
    const otherFeatures  = features.filter(f => !(Array.isArray(f.subActions) && f.subActions.length > 0))

    const basicItems = [...standards, ...menuFeatures]
    if (basicItems.length > 0) {
      out.push({ id: 'basic', label: 'Basic Actions', items: basicItems, consolidated: true })
    }

    // 2. Combined Class + Species (anything not a menu)
    const combinedFeatures = [...otherFeatures, ...species]
    if (combinedFeatures.length > 0) {
      out.push({ id: 'features', label: 'Class & Species Features', items: combinedFeatures })
    }

    // 2b. Magic Items — eigene Kategorie, damit attunete Items
    // (Wand of Magic Missiles, Cloak of Displacement, Ring of
    // Invisibility, …) als Block lesbar zwischen Features und
    // Attacks/Cantrips sitzen statt vermischt zu erscheinen.
    if (items.length > 0) {
      out.push({ id: 'items', label: 'Magic Items', items })
    }

    // 3. Attacks & Cantrips together
    const cantrips      = spells.filter(s => (s.spell?.level ?? 0) === 0)
    const leveledSpells = spells.filter(s => (s.spell?.level ?? 0) > 0)
    if (attacks.length + cantrips.length > 0) {
      out.push({ id: 'attacks-cantrips', label: 'Attacks & Cantrips', items: [...attacks, ...cantrips] })
    }

    // 4. Spells by level (1+)
    if (leveledSpells.length > 0) {
      const byLevel = {}
      for (const s of leveledSpells) {
        const lv = s.spell?.level ?? 1
        if (!byLevel[lv]) byLevel[lv] = []
        byLevel[lv].push(s)
      }
      const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b)
      for (const lv of levels) {
        out.push({ id: `spell-${lv}`, label: `Level ${lv}`, items: byLevel[lv] })
      }
    }
    // Pinned-Kategorie ganz oben. Greift in alle Kategorien rein und
    // sammelt Rows deren markerKey im character.status.pinnedActions
    // steht — emittiert sie als Duplikate mit `pinned-`-Prefix-ID damit
    // React-Keys nicht kollidieren. Original-Rows bleiben in ihren
    // strukturellen Kategorien.
    //
    // Im ★-Tab oben in der Explorer-Leiste passiert die Pin-Aggregation
    // bereits eine Ebene drüber; dann unterdrücken wir hier die
    // Duplikat-Kategorie via `hidePinnedCategory`.
    if (!hidePinnedCategory) {
      const pinnedKeys = getPinnedActions(character)
      if (pinnedKeys.length > 0) {
        const pinnedItems = []
        for (const cat of out) {
          for (const r of cat.items) {
            const k = rowMarkerKey(r)
            if (k && pinnedKeys.includes(k)) {
              pinnedItems.push({ ...r, id: `pinned-${r.id}` })
            }
          }
        }
        if (pinnedItems.length > 0) {
          out.unshift({ id: 'pinned', label: '★ Pinned', items: pinnedItems })
        }
      }
    }
    return out
  }, [rows, character, hidePinnedCategory])

  const toggleCat = (id) => setClosedCats(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // Per-Charakter persistierte Reihenfolge der Kategorien. Default
  // entspricht der Computed-Reihenfolge (basic → features → items →
  // attacks/cantrips → spells by level); der Spieler kann via ▲▼-
  // Buttons jeden Eintrag verschieben und mit ↻ alles auf Default
  // zurücksetzen.
  const savedOrder = getSavedOrder(character, 'actions')
  const orderedCats = applySavedOrder(cats, savedOrder, c => c.id)
  const currentKeys = orderedCats.map(c => c.id)
  const isCustomized = Array.isArray(savedOrder) && savedOrder.length > 0
  const moveCat = (id, dir) => moveCategory(applyCharacter, 'actions', currentKeys, id, dir)
  const resetOrder = () => resetCategoryOrder(applyCharacter, 'actions')

  return (
    <div style={caeList}>
      {/* Reset-Icon ist im Section-Titel (Actions ↻) — keine eigene
          Zeile innerhalb der Liste mehr. */}
      {orderedCats.map((cat, catIdx) => {
        const isOpen = !closedCats.has(cat.id)
        const canMoveUp   = catIdx > 0
        const canMoveDown = catIdx < orderedCats.length - 1
        return (
          <div key={cat.id} style={{ marginBottom: 6 }}>
            <div style={categoryHead}>
              <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => toggleCat(cat.id)}>
                {isOpen ? '▼' : '▶'} {cat.label}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{cat.items.length}</span>
              <button type="button" disabled={!canMoveUp}
                onClick={(e) => { e.stopPropagation(); moveCat(cat.id, 'up') }}
                style={catReorderBtn(!canMoveUp)} title="Nach oben"
                aria-label="Kategorie hoch"
              >▲</button>
              <button type="button" disabled={!canMoveDown}
                onClick={(e) => { e.stopPropagation(); moveCat(cat.id, 'down') }}
                style={catReorderBtn(!canMoveDown)} title="Nach unten"
                aria-label="Kategorie runter"
              >▼</button>
            </div>
            {isOpen && (cat.consolidated
              ? (
                // ONE row for all basic actions — click to expand the full
                // list inline, each entry shows its 5e/5.5e rule text.
                <div style={caeRow}>
                  <div style={caeRowHead} onClick={() => setBasicOpen(o => !o)}>
                    <div style={caeRowName}>
                      <span style={{ color: 'var(--text-dim)', fontSize: 10, marginRight: 6 }}>
                        {basicOpen ? '▼' : '▶'}
                      </span>
                      Basic Actions ({cat.items.length})
                    </div>
                  </div>
                  {basicOpen && (
                    <div style={{ padding: '4px 8px 8px' }}>
                      {cat.items.map(r => (
                        <div key={r.id} style={{ padding: '4px 0', borderTop: '1px solid var(--border-subtle)' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{r.name}</div>
                          {r.notes && (
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{r.notes}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
              : cat.items.map(r => {
                // Marker-Key zuerst computen, BEVOR irgend ein Pill-
                // Builder ihn referenziert (TDZ-Bugfix). Die spätere
                // Block-Variable `mKey` ist dieselbe Identität.
                const mKey = rowMarkerKey(r)
                const mColor = mKey ? getColorMarker(character, mKey) : null
                // Pill-Aufteilung neu strukturiert:
                //   TOP  (rechts neben dem Namen): Slot-Pill ODER
                //        Always-Badge ODER Charges-Pill (für resource-
                //        gebundene Features).
                //   LEFT (untere Reihe, links):  Attack/Save/DC, Damage
                //        (in Damage-Type-Farbe), Range. Mastery-Sterne
                //        auch hier (Attacks-Rows).
                //   RIGHT (untere Reihe, rechts): Conc / Ritual.
                const topPills = []
                const leftPills = []
                const rightPills = []

                // Reihenfolge im topPills-Strip (links → rechts) per
                // Player-Spec: Custom-Note · Charges · Always · Slot.
                // Slot sitzt direkt vor dem CombatActionButton (Upcast/
                // Use). Erst alle "links davon"-Pills sammeln, ZULETZT
                // die Slot-Pille pushen damit sie rechts landet.

                // Custom-Note-Pill (vom Player gesetzt) ganz links.
                const noteRow = mKey ? getCustomNote(character, mKey) : null
                if (noteRow?.pillText) {
                  const nc = noteRow.pillColor || 'var(--accent)'
                  topPills.push(
                    <span key="note" style={{
                      ...caePill,
                      border: `1px solid ${nc}`, color: nc,
                      background: `color-mix(in srgb, ${nc} 14%, transparent)`,
                    }} title={noteRow.pillText}>{noteRow.pillText}</span>
                  )
                }
                // Charges-Pill (Resource-Uses für racial/feature-granted
                // Spells und für Class-Feature-Rows mit limited uses).
                if (r.uses) {
                  const c = r.uses.remaining === 0 ? 'var(--accent-red)'
                    : r.uses.remaining < r.uses.max ? 'var(--accent-yellow)'
                    : 'var(--accent-green)'
                  topPills.push(
                    <span key="uses" style={{ ...caePill, border: `1px solid ${c}`, color: c, fontWeight: 700 }}
                      title={`${r.uses.label}: ${r.uses.remaining}/${r.uses.max} übrig`}>
                      {r.uses.remaining}/{r.uses.max}
                    </span>
                  )
                }
                // Always-Badge zeigt dass der Spell race/feat/feature-
                // granted ist (at-will / gewährt) — sitzt zwischen
                // Charges und Slot.
                if (r.badge === 'Always') {
                  topPills.push(
                    <span key="always" style={{
                      ...caePill,
                      border: '1px solid var(--accent-purple)',
                      color: 'var(--accent-purple)',
                    }} title="Immer vorbereitet">Always</span>
                  )
                }

                // Slot-Pill (klickbar) — RECHTS, direkt vor dem
                // CombatActionButton. Castet den Spell auf seinem
                // Basislevel; "Up"-Button im CombatActionButton ist
                // für Upcast-Auswahl.
                if (r.slotLabel) {
                  const slotColor = r.slotAvailable === false ? 'var(--text-dim)' : 'var(--accent-blue)'
                  const isSpellRow = r.kind === 'spell' || r.kind === 'always-spell'
                  const canCast = isSpellRow && r.slotAvailable !== false
                  const baseLevel = r.spell?.level || 0
                  const handleSlotCast = (e) => {
                    e.stopPropagation()
                    if (!isSpellRow || !canCast || !r.spell) return
                    if (baseLevel === 0) {
                      castSpellFromExplorer(r.spell, 0, { economySlot: r.economySlot })
                      return
                    }
                    // Niedrigsten verfügbaren Slot ≥ baseLevel finden.
                    const slotsArr = slots?.slots || []
                    for (let lv = baseLevel; lv <= 9; lv++) {
                      const max = slotsArr[lv - 1] || 0
                      if (!max) continue
                      const used = usedSlots[lv] || 0
                      if (used < max) {
                        castSpellFromExplorer(r.spell, lv, { economySlot: r.economySlot })
                        return
                      }
                    }
                    // Kein Slot? Pact-Slot probieren.
                    const pact = slots?.warlockSlots
                    if (pact && pact.level >= baseLevel && (pact.slots - usedPact) > 0) {
                      castSpellFromExplorer(r.spell, pact.level, {
                        economySlot: r.economySlot, usePact: true,
                      })
                    }
                  }
                  topPills.push(
                    canCast ? (
                      <button key="slot" type="button"
                        onClick={handleSlotCast}
                        title={baseLevel === 0
                          ? 'Cantrip wirken'
                          : `Cast L${baseLevel} (niedrigster freier Slot)`}
                        style={{
                          ...caePill,
                          border: `1px solid ${slotColor}`, color: slotColor,
                          background: 'transparent', cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}>{r.slotLabel}</button>
                    ) : (
                      <span key="slot" style={{
                        ...caePill,
                        border: `1px solid ${slotColor}`, color: slotColor,
                      }} title={`Spell Slots: ${r.slotLabel}`}>{r.slotLabel}</span>
                    )
                  )
                }
                // (Always / Uses / Note werden bereits oben in der
                // korrekten Reihenfolge gepusht — Reihenfolge:
                // Note · Uses · Always · Slot.)

                // Smart-Effect-Pills (Attack/Save/Damage + Phase 4 Kinds).
                // Dedup-Filter:
                //   • Trigger-Pills die NUR den economy-Slot wiederholen
                //     (Row ist eh schon im BA/R/A-Tab) werden gedroppt
                //   • Identische (kind+label)-Paare nur einmal — verhindert
                //     dass zwei Regex-Treffer das selbe Pill emittieren
                if (Array.isArray(r.effectPills) && r.effectPills.length > 0) {
                  const REDUNDANT_TRIGGERS_BY_SLOT = {
                    bonusAction: new Set(['Bonus Action', 'BA · Your Turn']),
                    reaction:    new Set(['Reaction']),
                    action:      new Set(['On Attack Action', 'On Your Turn']),
                  }
                  const redundant = REDUNDANT_TRIGGERS_BY_SLOT[r.economySlot] || new Set()
                  const seenPillKey = new Set()
                  for (const p of r.effectPills) {
                    // Skip trigger-pill wenn es nur den economySlot wiederholt
                    if (p.kind === 'trigger' && redundant.has(p.label)) continue
                    const dedupKey = `${p.kind}::${p.label}::${p.value || ''}`
                    if (seenPillKey.has(dedupKey)) continue
                    seenPillKey.add(dedupKey)
                    const color = pillColorForKind(p, pillColors, DAMAGE_TYPE_COLOR)
                    leftPills.push(
                      <span key={`fx-${p.kind}-${p.label}`} title={p.title} style={{
                        ...caePill,
                        border: `1px solid ${color}`,
                        color,
                        background: `color-mix(in srgb, ${color} 10%, transparent)`,
                      }}>
                        {p.value != null ? `${p.label} ${p.value}` : p.label}
                      </span>
                    )
                  }
                }
                // Legacy-Felder (Weapon-Attack-Rows): atk/dmg sind reine
                // Strings — wenn vorhanden, einfügen.
                if (r.attack) leftPills.push(
                  <span key="att-legacy" style={{
                    ...caePill, border: '1px solid var(--accent-blue)', color: 'var(--accent-blue)',
                  }} title="Attack-Bonus">{r.attack}</span>
                )
                // ×N Multi-Hit-Pille SITZT DIREKT VOR der Damage-Pille
                // (gleiches Layout wie Spell-Rows mit Scorching Ray /
                // Magic Missile etc.). Klar: "×2 · 1d8 slashing" =
                // 2 Treffer à 1d8, nicht 2d8 zusammen.
                if (r.attacksPerAction && r.attacksPerAction > 1) {
                  leftPills.push(
                    <span key="atks" style={{
                      ...caePill,
                      border: '1px solid var(--accent-yellow)',
                      color: 'var(--accent-yellow)',
                      background: 'color-mix(in srgb, var(--accent-yellow) 14%, transparent)',
                      fontWeight: 700,
                    }} title={`${r.attacksPerAction} Treffer pro Attack-Action — Schaden gilt pro Treffer`}>
                      ×{r.attacksPerAction}
                    </span>,
                  )
                }
                if (r.damage && r.damage !== '—') {
                  // Damage-Type-Farbe aus dem User-Theme oder dem
                  // DAMAGE_TYPE_COLOR-Default. Tooltip zeigt Type +
                  // Magisch-Flag + ggf. "vom Effekt geändert"-Hinweis.
                  const dmgTypeColor = r.damageType
                    ? (pillColors[`damage.${r.damageType}`] || DAMAGE_TYPE_COLOR[r.damageType])
                    : null
                  const color = dmgTypeColor || 'var(--accent-red)'
                  const typeLabel = r.damageType
                    ? `${r.damageType[0].toUpperCase()}${r.damageType.slice(1)}`
                    : null
                  const overrideEffect = (r.activeEffects || []).find(e => e.damageType)
                  const tip = [
                    typeLabel ? `Damage-Type: ${typeLabel}` : null,
                    r.magical ? 'Zählt als magisch' : null,
                    overrideEffect
                      ? `Type von ${overrideEffect.label} überschrieben`
                      : null,
                  ].filter(Boolean).join(' · ')
                  leftPills.push(
                    <span key="dmg-legacy" title={tip || undefined}
                      style={{
                        ...caePill, border: `1px solid ${color}`, color,
                        background: `color-mix(in srgb, ${color} 10%, transparent)`,
                      }}>
                      {r.damage}{typeLabel ? ` ${typeLabel}` : ''}
                    </span>,
                  )
                }
                if (r.range && r.range !== '—') leftPills.push(
                  <span key="rng" style={{
                    ...caePill, border: '1px solid var(--text-dim)', color: 'var(--text-secondary)',
                  }} title={`Reichweite: ${r.range}`}>{r.range}</span>
                )
                if (r.mastery && r.mastery.length > 0) {
                  for (const m of r.mastery) {
                    const desc = masteryShortDesc(m)
                    leftPills.push(
                      <span key={`m-${m}`} style={{
                        ...caePill, border: '1px solid var(--accent-yellow)', color: 'var(--accent-yellow)',
                      }} title={desc ? `Weapon Mastery: ${m} — ${desc}` : `Weapon Mastery: ${m}`}>
                        ★ {m}
                      </span>
                    )
                  }
                }

                // Active-Effects auf der Waffe (Shillelagh, Magic
                // Weapon, …) als klickbare Pille mit ×-Dismiss-Button.
                // Klick auf den ×-Teil entfernt den Effect aus
                // character.status.activeEffects via removeActiveEffect.
                if (Array.isArray(r.activeEffects) && r.activeEffects.length > 0) {
                  for (const ae of r.activeEffects) {
                    if (!ae?.id) continue
                    const label = ae.label || ae.kind || 'effect'
                    const tip = [
                      `Aktiver Effekt: ${label}`,
                      ae.damageType ? `Damage-Type: ${ae.damageType[0].toUpperCase()}${ae.damageType.slice(1)} (überschreibt)` : null,
                      ae.until ? `Dauer: ${ae.until}` : null,
                      'Klick auf × um den Effekt zu beenden',
                    ].filter(Boolean).join(' · ')
                    leftPills.push(
                      <span key={`ae-${ae.id}`} title={tip} style={{
                        ...caePill,
                        border: '1px solid var(--accent-orange, #ff9533)',
                        color: 'var(--accent-orange, #ff9533)',
                        background: 'color-mix(in srgb, var(--accent-orange, #ff9533) 14%, transparent)',
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        padding: '1px 2px 1px 6px',
                      }}>
                        ⚔ {label}
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); removeActiveEffect(applyCharacter, ae.id) }}
                          title={`${label} beenden`}
                          style={{
                            background: 'transparent', border: 'none',
                            color: 'var(--accent-orange, #ff9533)',
                            cursor: 'pointer', padding: '0 4px',
                            fontFamily: 'inherit', fontSize: 11, lineHeight: 1,
                          }}>×</button>
                      </span>,
                    )
                  }
                }

                // Variable-Damage-Concentration-Advisory (Hex /
                // Hunter's Mark / Bless / Divine Favor) — Per-Roll-
                // Bonus den der Player nicht vergessen darf. Orange,
                // damit es sofort als "denk dran"-Marker auffällt.
                if (r.variableBuff) {
                  const vb = r.variableBuff
                  leftPills.push(
                    <span key="varbuff" style={{
                      ...caePill,
                      border: '1px solid var(--accent-orange, #ff9533)',
                      color: 'var(--accent-orange, #ff9533)',
                      background: 'color-mix(in srgb, var(--accent-orange, #ff9533) 14%, transparent)',
                    }} title={vb.note || `${vb.label}: ${vb.formula} ${vb.damageType}`}>
                      ⚡ {vb.label} {vb.formula}
                    </span>,
                  )
                }

                // RIGHT: Concentration und Ritual.
                if (r.spell?.concentration) rightPills.push(
                  <span key="conc" style={{
                    ...caePill, border: '1px solid var(--accent-purple)', color: 'var(--accent-purple)',
                  }} title="Concentration">conc.</span>
                )
                if (r.spell?.ritual) rightPills.push(
                  <span key="ritual" style={{
                    ...caePill, border: '1px solid var(--accent-blue)', color: 'var(--accent-blue)',
                  }} title="Ritual">R★</span>
                )

                const hasBottomRow = leftPills.length > 0 || rightPills.length > 0
                // (mKey + mColor sind oben am Anfang des map-Body
                // schon deklariert — gleicher Wert, eine Quelle.)
                //
                // Row "nicht verfügbar" wenn entweder Spell-Slot leer
                // ist ODER der zugehörige Action-Economy-Slot diese
                // Runde schon verbraucht wurde. Wir grauen die ganze
                // Zeile etwas aus damit klar ist "das geht gerade
                // nicht" — bleibt aber komplett lesbar (kein
                // line-through, opacity nur 0.55).
                const economyUsed = !!(r.economySlot && character?.status?.economy?.[r.economySlot])
                const unavailable = r.slotAvailable === false || economyUsed
                return (
                  <div key={r.id} style={{
                    ...caeRow,
                    ...(colorStripeStyle(mColor) || {}),
                    opacity: unavailable ? 0.55 : 1,
                  }} title={economyUsed && r.economySlot
                    ? `${r.economySlot === 'action' ? 'Action'
                       : r.economySlot === 'bonusAction' ? 'Bonus Action'
                       : r.economySlot === 'reaction' ? 'Reaction'
                       : 'Hasted Action'} diese Runde bereits verbraucht`
                    : undefined}>
                    <div
                      style={{ ...caeRowHead, flexDirection: 'column', alignItems: 'stretch', gap: 3 }}
                    >
                      {/* TOP ROW: chevron (klickbar zum Expand) + name + top-pills + Use-Button.
                          Row-Klick außerhalb des Chevrons triggert NICHTS mehr —
                          nur der Chevron-Klick toggled. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setExpanded(prev => prev === r.id ? null : r.id) }}
                          title={expanded === r.id ? 'Einklappen' : 'Aufklappen'}
                          style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: 'var(--text-dim)', fontSize: 10, padding: '0 2px',
                            fontFamily: 'inherit',
                          }}
                        >{expanded === r.id ? '▼' : '▶'}</button>
                        {(() => {
                          const tip = actionRowTooltipContent(r)
                          const nameEl = (
                            <span style={{ ...caeRowName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {r.name}
                            </span>
                          )
                          return (
                            <span style={{ flex: 1, minWidth: 0 }}>
                              {tip ? <HoverDetailTooltip content={tip}>{nameEl}</HoverDetailTooltip> : nameEl}
                            </span>
                          )
                        })()}
                        {topPills.length > 0 && (
                          <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                            {topPills}
                          </span>
                        )}
                        <CombatActionButton
                          row={r}
                          slots={slots} usedSlots={usedSlots} usedPact={usedPact}
                          castingFor={castingFor} setCastingFor={setCastingFor}
                          onCastSpell={castSpellFromExplorer}
                          onUseAction={() => {
                            if (r.economySlot) markActionUsed(r.economySlot)
                            if (r.resourceId)  consumeResource(r.resourceId)
                            applyRowSideEffects(r)
                          }}
                        />
                      </div>
                      {/* BOTTOM ROW: left-pills (range/dice/save) │ right-pills (conc/ritual) */}
                      {hasBottomRow && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          paddingLeft: 16, fontSize: 11,
                        }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minWidth: 0 }}>
                            {leftPills}
                          </div>
                          {rightPills.length > 0 && (
                            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                              {rightPills}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {expanded === r.id && (
                      <ActionExpandedBlock
                        r={r}
                        character={character}
                        applyCharacter={applyCharacter}
                        mKey={mKey}
                        mColor={mColor}
                      />
                    )}
                    {false && (
                      <>
                        <ActionRowExpandedBody row={r} />
                        {mKey && applyCharacter && (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                            padding: '4px 10px 6px',
                            borderTop: '1px solid var(--border-subtle)',
                          }}
                            onClick={(e) => e.stopPropagation()}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Stripe:</span>
                              <CardColorPicker
                                color={mColor}
                                onChange={(c) => setColorMarker(applyCharacter, mKey, c)}
                                compact
                              />
                            </span>
                            {/* Custom-Pill-Editor inline: Text + Farbe. */}
                            <input
                              type="text"
                              defaultValue={(getCustomNote(character, mKey) || {}).pillText || ''}
                              placeholder="Pill-Hinweis"
                              onBlur={(e) => setCustomNote(applyCharacter, mKey, { pillText: e.target.value })}
                              style={{
                                width: 110, padding: '2px 6px', fontSize: 11,
                                background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                                border: '1px solid var(--border-subtle)', borderRadius: 4,
                                fontFamily: 'inherit',
                              }}
                            />
                            <input
                              type="color"
                              value={(getCustomNote(character, mKey) || {}).pillColor || mColor || '#888888'}
                              onChange={(e) => setCustomNote(applyCharacter, mKey, { pillColor: e.target.value })}
                              title="Pill-Farbe"
                              style={{
                                width: 22, height: 20, padding: 0,
                                background: 'transparent',
                                border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer',
                              }}
                            />
                            {/* Pin-Toggle: gepinnte Actions erscheinen
                                ZUSÄTZLICH oben in der "★ Pinned"-
                                Kategorie. Original-Eintrag bleibt. */}
                            <button
                              type="button"
                              onClick={() => togglePinnedAction(applyCharacter, mKey)}
                              title={isPinnedAction(character, mKey)
                                ? 'Aus Pinned entfernen'
                                : 'Oben in Pinned anheften'}
                              style={{
                                fontSize: 11, padding: '2px 8px',
                                background: isPinnedAction(character, mKey)
                                  ? 'color-mix(in srgb, var(--accent-yellow) 18%, transparent)'
                                  : 'transparent',
                                color: isPinnedAction(character, mKey)
                                  ? 'var(--accent-yellow)' : 'var(--text-muted)',
                                border: `1px solid ${isPinnedAction(character, mKey)
                                  ? 'var(--accent-yellow)' : 'var(--border)'}`,
                                borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
                              }}
                            >
                              {isPinnedAction(character, mKey) ? '★ Pinned' : '☆ Pin'}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                    {castingFor === r.id && r.spell && r.spell.level > 0 && (
                      <SpellSlotPicker
                        row={r} slots={slots} usedSlots={usedSlots} usedPact={usedPact}
                        onCast={castSpellFromExplorer}
                        onCancel={() => setCastingFor(null)}
                      />
                    )}
                  </div>
                )
              })
            )}
          </div>
        )
      })}
    </div>
  )
}

// Rich expanded body for an action row. Branches by kind:
//   • Spell        — casting time / range / duration / components /
//                    school / ritual / concentration chips + full 5etools
//                    entries
//   • Attack       — damage breakdown, weapon properties, mastery
//                    description if any
//   • Feature/     — full 5etools entries (no chopped 200-char preview)
//     Species
//   • Standard     — plain notes (unchanged)
function ActionRowExpandedBody({ row }) {
  if (row.kind === 'spell' || row.kind === 'always-spell') {
    const sp = row.spellMeta || {}
    const chips = [
      sp.castingTime && { label: 'Cast', value: sp.castingTime },
      sp.range       && { label: 'Range', value: sp.range },
      sp.duration    && { label: 'Duration', value: sp.duration },
      sp.school      && { label: 'School', value: SCHOOL_NAMES_LOCAL[sp.school] || sp.school },
      sp.components  && { label: 'Components', value: formatSpellComponents(sp.components) },
    ].filter(Boolean)
    return (
      <div style={caeRowBody}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          {chips.map(c => (
            <span key={c.label} style={chipPill}>
              <span style={chipPillLabel}>{c.label}:</span>{' '}
              <span style={chipPillValue}>{c.value}</span>
            </span>
          ))}
          {sp.concentration && (
            <span style={{ ...chipPill, borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}>
              Concentration
            </span>
          )}
          {sp.ritual && (
            <span style={{ ...chipPill, borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>
              Ritual
            </span>
          )}
        </div>
        {Array.isArray(sp.entries) && sp.entries.length > 0 && (
          <div style={{ fontSize: 12, lineHeight: 1.55 }}>
            <EntryRenderer entries={sp.entries} />
            {Array.isArray(sp.entriesHigherLevel) && sp.entriesHigherLevel.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <EntryRenderer entries={sp.entriesHigherLevel} />
              </div>
            )}
          </div>
        )}
      </div>
    )
  }
  if (row.kind === 'attack') {
    return (
      <div style={caeRowBody}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          {row.attack && <span style={chipPill}><span style={chipPillLabel}>To Hit:</span> <span style={{ ...chipPillValue, color: 'var(--accent-blue)' }}>{row.attack}</span></span>}
          {row.damage && <span style={chipPill}><span style={chipPillLabel}>Damage:</span> <span style={{ ...chipPillValue, color: 'var(--accent-red)' }}>{row.damage}</span></span>}
          {row.damageType && <span style={chipPill}><span style={chipPillLabel}>Type:</span> <span style={chipPillValue}>{row.damageType}</span></span>}
          {row.range && <span style={chipPill}><span style={chipPillLabel}>Range:</span> <span style={chipPillValue}>{row.range}</span></span>}
        </div>
        {Array.isArray(row.properties) && row.properties.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {row.properties.map(p => (
              <span key={p} style={{ ...chipPill, fontSize: 10 }}>{p}</span>
            ))}
          </div>
        )}
        {row.mastery && row.mastery.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {row.mastery.map(m => {
              const desc = masteryShortDesc(m)
              return (
                <div key={m}>
                  <span style={{ color: 'var(--accent-yellow)', fontWeight: 700 }}>★ {m}</span>
                  {desc && <span style={{ color: 'var(--text-secondary)' }}> — {desc}</span>}
                </div>
              )
            })}
          </div>
        )}
        {row.markedAs && (
          <div style={{ fontSize: 11, color: 'var(--accent-purple)', marginTop: 6 }}>
            {row.markedAs.label}: {row.markedAs.note}
          </div>
        )}
      </div>
    )
  }
  if (row.kind === 'feature' || row.kind === 'species' || row.kind === 'item') {
    return (
      <div style={caeRowBody}>
        {row.sub && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>{row.sub}</div>
        )}
        {Array.isArray(row.entries) && row.entries.length > 0 && (
          <div style={{ fontSize: 12, lineHeight: 1.55 }}>
            <EntryRenderer entries={row.entries} />
          </div>
        )}
        {/* Sub-action menu — Cunning Action lists Dash/Disengage/Hide,
            similar 'menu' class features (Druid Wild Companion etc.)
            get the same treatment. Each picked-up basic action is
            shown with its rule note, mirroring how the consolidated
            "Basic Actions" entry renders. */}
        {Array.isArray(row.subActions) && row.subActions.length > 0 && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', marginBottom: 4 }}>
              Sub-Actions
            </div>
            {row.subActions.map(a => (
              <div key={a.name} style={{ padding: '4px 0', borderTop: '1px dashed var(--border-subtle)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{a.name}</div>
                {a.notes && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{a.notes}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  // Standard actions and any other plain rows keep the simple text.
  if (row.notes) return <div style={caeRowBody}>{row.notes}</div>
  return null
}

const SCHOOL_NAMES_LOCAL = {
  A: 'Abjuration', C: 'Conjuration', D: 'Divination', E: 'Enchantment',
  V: 'Evocation', I: 'Illusion', N: 'Necromancy', T: 'Transmutation', U: 'Abjuration',
}
function formatSpellComponents(c = {}) {
  const parts = []
  if (c.v) parts.push('V')
  if (c.s) parts.push('S')
  if (c.m) parts.push('M')
  let out = parts.join(', ')
  if (c.m && typeof c.m === 'object' && c.m.text) out += ` (${c.m.text})`
  else if (c.m && typeof c.m === 'string') out += ` (${c.m})`
  return out || '—'
}
const chipPill = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '2px 8px', borderRadius: 6,
  background: 'var(--bg-inset)',
  border: '1px solid var(--border-subtle)',
  fontSize: 11,
}
const chipPillLabel = { color: 'var(--text-muted)', fontWeight: 600 }
const chipPillValue = { color: 'var(--text-primary)' }

// Inline Cast/Use button cluster on each explorer row. Three modes:
//   • spell cantrip   → single "Cast" button (no slot picker)
//   • spell L1+       → "Cast ▾" opens the SpellSlotPicker below
//   • non-spell row   → "Verwenden" toggles the row's economy slot
//                       and (if applicable) increments the matching
//                       resource counter
function CombatActionButton({
  row, slots, usedSlots, usedPact,
  castingFor, setCastingFor,
  onCastSpell, onUseAction,
}) {
  const stop = (e) => e.stopPropagation()
  if (row.spell) {
    // Cantrip: cast immediately. No slot consumed; concentration
    // still toggles if the cantrip is concentration.
    if (row.spell.level === 0) {
      return (
        <button type="button" style={caeUseBtn} onClick={(e) => {
          stop(e); onCastSpell(row.spell, 0, { economySlot: row.economySlot })
        }} title="Cantrip wirken (kein Slot benötigt)">Cast</button>
      )
    }
    // Leveled spell: toggle the slot picker.
    const isOpen = castingFor === row.id
    return (
      <button type="button" style={caeUseBtn} onClick={(e) => {
        stop(e); setCastingFor(isOpen ? null : row.id)
      }} title="Upcast — Slot-Pille klicken castet direkt mit dem Base-Slot">{isOpen ? 'Up ▴' : 'Up ▾'}</button>
    )
  }
  // Non-spell row: only show a button when this row actually does
  // something on activation. Attacks have an economy slot; class /
  // species / standard rows have economySlot too. Granted-but-passive
  // rows would lack economySlot.
  if (!row.economySlot) return null
  return (
    <button type="button" style={caeUseBtn} onClick={(e) => { stop(e); onUseAction() }}
      title={`Aktion verbrauchen — markiert die ${row.economySlot}-Pille`}>
      Use
    </button>
  )
}

// Pop-out beneath a leveled-spell row: a chip per available slot
// level the player can upcast at, plus a Pact-slot chip for warlocks.
// Used slots are greyed out and disabled.
//
// Wenn der Spell in den 5etools-Daten `entriesHigherLevel` mitbringt
// (= das "At Higher Levels"-Block), zeigen wir den hier über den
// Slot-Chips an — der Spieler soll vor der Slot-Wahl sehen was ein
// Upcast bringt. EntryRenderer löst die 5etools-Tags auf.
function SpellSlotPicker({ row, slots, usedSlots, usedPact, onCast, onCancel }) {
  const baseLevel = row.spell.level || 1
  const stop = (e) => e.stopPropagation()
  const higherLevel = row.spellMeta?.entriesHigherLevel
  const list = []
  for (let lv = baseLevel; lv <= 9; lv++) {
    const max = slots?.slots?.[lv - 1] || 0
    if (!max) continue
    const used = usedSlots[lv] || 0
    list.push({ lv, max, remaining: Math.max(0, max - used) })
  }
  const pact = slots?.warlockSlots
  if (pact && pact.level >= baseLevel) {
    list.push({
      lv: pact.level, max: pact.slots,
      remaining: Math.max(0, pact.slots - usedPact),
      isPact: true,
    })
  }
  return (
    <div style={{ ...caePickerWrap, flexDirection: 'column', alignItems: 'stretch' }} onClick={stop}>
      {Array.isArray(higherLevel) && higherLevel.length > 0 && (
        <div style={{
          fontSize: 11, lineHeight: 1.5,
          color: 'var(--text-secondary)',
          background: 'color-mix(in srgb, var(--accent-blue) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent-blue) 30%, transparent)',
          borderRadius: 6, padding: '6px 8px', marginBottom: 6,
        }}>
          {/* Headline ("Using a Higher-Level Spell Slot" /
              "At Higher Levels") wegfallen lassen — wir wissen aus
              dem Kontext (Upcast-Picker), worum es geht. Wenn der
              entries-Block die typische Form
              [{ type: 'entries', name: '...', entries: [...] }]
              hat, ziehen wir das innere entries-Array raus. */}
          <EntryRenderer entries={
            (Array.isArray(higherLevel)
              && higherLevel.length === 1
              && higherLevel[0]?.entries
              && higherLevel[0]?.type === 'entries')
              ? higherLevel[0].entries
              : higherLevel
          } />
        </div>
      )}
      {list.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 11, flex: 1 }}>
            Keine passenden Slots verfügbar.
          </span>
          <button type="button" style={caeCancelBtn} onClick={(e) => { stop(e); onCancel() }}>×</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 11, marginRight: 4 }}>Slot:</span>
          {list.map(s => {
            const dead = s.remaining === 0
            return (
              <button key={`${s.isPact ? 'p' : 'L'}-${s.lv}`} type="button"
                disabled={dead} style={{ ...caeSlotChip, opacity: dead ? 0.35 : 1 }}
                onClick={(e) => {
                  stop(e)
                  onCast(row.spell, s.lv, { economySlot: row.economySlot, usePact: !!s.isPact })
                }}
                title={s.isPact ? `Pact Slot L${s.lv}` : `Spell Slot L${s.lv}`}>
                {s.isPact ? `P${s.lv}` : `L${s.lv}`}
                <span style={{ marginLeft: 4, color: 'var(--text-dim)' }}>{s.remaining}/{s.max}</span>
              </button>
            )
          })}
          <button type="button" style={caeCancelBtn} onClick={(e) => { stop(e); onCancel() }}>×</button>
        </div>
      )}
    </div>
  )
}

const caeUseBtn = {
  marginLeft: 6, padding: '2px 8px', borderRadius: 4, fontSize: 10,
  fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  background: 'var(--bg-elevated)', border: '1px solid var(--accent)',
  color: 'var(--accent)',
}
const caePickerWrap = {
  display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4,
  padding: '6px 10px', borderTop: '1px solid var(--border-subtle)',
  background: 'var(--bg-inset)',
}
const caeSlotChip = {
  padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
  border: '1px solid var(--accent)', background: 'transparent',
  color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit',
}
const caeCancelBtn = {
  marginLeft: 'auto', width: 20, height: 20, borderRadius: 4,
  border: '1px solid var(--border)', background: 'transparent',
  color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
  fontSize: 12, padding: 0,
}

const caeToggle = {
  cursor: 'pointer', background: 'transparent',
  border: '1px solid var(--border-subtle)', borderRadius: 6,
  padding: '4px 10px', fontSize: 11, color: 'var(--text-secondary)',
  fontFamily: 'inherit',
}
const caeBody = { marginTop: 8 }
const caeTabs = { display: 'flex', gap: 6, marginBottom: 8 }
const caeTab = {
  padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
  border: '1px solid', cursor: 'pointer', fontFamily: 'inherit',
}
const caeTabCount = { color: 'var(--text-dim)', fontWeight: 'normal', marginLeft: 6 }
const caeEmpty = { color: 'var(--text-dim)', fontSize: 11, fontStyle: 'italic', padding: 4 }
const caeList = { display: 'flex', flexDirection: 'column', gap: 4 }
const caeRow = {
  background: 'var(--bg-elevated)', borderRadius: 6,
  border: '1px solid var(--border-subtle)',
}
const caeRowHead = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '5px 8px', cursor: 'pointer', gap: 8,
}
const caeRowName = { color: 'var(--text-primary)', fontWeight: 600, fontSize: 12 }
const caeRowMeta = { display: 'flex', gap: 8, color: 'var(--text-secondary)', fontSize: 11 }
const caeMetaPart = { color: 'var(--text-muted)' }
// Einheitliche Pill für Action-Rows. Form ist die gleiche wie S.tag
// im Spells-Tab (kantig statt 999px-pillenförmig) damit alle Pills
// quer durchs Sheet visuell konsistent sind.
const caePill = {
  display: 'inline-flex', alignItems: 'center',
  padding: '1px 6px', borderRadius: 4,
  fontSize: 10, fontWeight: 700, lineHeight: '14px',
  letterSpacing: 0.3, textTransform: 'uppercase',
  whiteSpace: 'nowrap', fontFamily: 'inherit',
}
// ▲▼ Reorder-Buttons im Kategorie-Header. Disabled wenn schon am
// Anfang/Ende. Pure-Inline-Style, kein eigenes Component nötig.
function catReorderBtn(disabled) {
  return {
    width: 18, height: 18, marginLeft: 2,
    padding: 0,
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 3,
    color: 'var(--text-muted)',
    fontSize: 9, lineHeight: 1, fontFamily: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.35 : 1,
  }
}

// Swap-Pfeil im Section-Titel — Spells <→> Favorites tauschen.
// Persistiert in character.status.heroColSwap.
const swapColBtnStyle = {
  width: 18, height: 18, padding: 0, marginRight: 6,
  background: 'transparent',
  border: '1px solid var(--border)', borderRadius: 3,
  color: 'var(--text-muted)', fontSize: 12, lineHeight: 1,
  cursor: 'pointer', fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  verticalAlign: 'middle',
}

// ↻-Reset-Icon — wird VOR dem Section-Titel gerendert wenn die
// Kategorie-Reihenfolge der Spalte vom Default abweicht. Nur Icon,
// kein Text, fügt sich nahtlos in den Titel ein.
function ResetOrderIcon({ onReset }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onReset?.() }}
      title="Reihenfolge zurücksetzen"
      style={{
        width: 18, height: 18, padding: 0, marginRight: 6,
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 3,
        color: 'var(--text-muted)',
        fontSize: 12, lineHeight: 1, fontFamily: 'inherit',
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        verticalAlign: 'middle',
      }}
    >↻</button>
  )
}
const caeRowBody = {
  padding: '6px 10px 8px 22px',
  fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5,
  borderTop: '1px solid var(--border-subtle)',
}
const caeGroupHead = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: 0.5, color: 'var(--text-muted)',
  margin: '8px 0 2px 2px',
}
const caeAlwaysBadge = {
  marginLeft: 8, padding: '1px 7px', borderRadius: 999,
  fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'var(--accent-green)',
  border: '1px solid var(--accent-green)',
  background: 'color-mix(in srgb, var(--accent-green) 12%, transparent)',
}

// ── Damage Res / Immunity / Vulnerability pills ────────────────────
// Each damage type is a coloured pill (necrotic = green, fire =
// orange, …) so the player can spot at a glance which slot is light
// on what. Two columns: RES (resistance + immunity collapsed into
// one column because immunity is just "stronger resistance") and
// VUL (vulnerability). Hidden entirely when nothing applies.
const DMG_TYPE_COLOR = {
  acid:        '#7dd87d',
  bludgeoning: '#a8a8a8',
  cold:        '#7fc4f7',
  fire:        '#ff7a45',
  force:       '#d97aff',
  lightning:   '#ffd54a',
  necrotic:    '#5fa86b',
  piercing:    '#c0c0c0',
  poison:      '#82c95a',
  psychic:     '#ff7ed1',
  radiant:     '#ffe27a',
  slashing:    '#bfa07a',
  thunder:     '#7fa8ff',
}
const colorFor = (t, pillColors) => {
  const k = String(t).toLowerCase()
  return (pillColors && pillColors[`damage.${k}`])
    || DMG_TYPE_COLOR[k]
    || 'var(--text-secondary)'
}

export function DamageResistancePills({ character, compact = false }) {
  // Pill-Farben aus den Settings — Resistances und Vulnerabilities
  // teilen sich die Damage-Type-Farbpalette mit den Action-Row-Pills.
  const pillColors = usePillColors()
  const m = getMechanicalEffects(character)
  // Immunity is a stronger resistance — display in the same column,
  // pill carries an "immune" tooltip so the rule difference isn't
  // lost. Vulnerability stays its own column.
  const resSet = new Set([...m.damageResistance, ...m.damageImmunity])
  const vulSet = m.damageVulnerability
  // Aktive Conditions stehen ganz oben in der Spalte — vor Resistance
  // und Vulnerability. Bleibt mounted auch wenn keine Conditions
  // gesetzt sind, damit der Spalten-Header sichtbar bleibt sobald
  // mind. eine condition aktiv ist.
  const conditions = character?.status?.conditions || []
  if (resSet.size === 0 && vulSet.size === 0 && conditions.length === 0) return null

  const conditionLabelOf = (id) => {
    const c = CONDITIONS.find(x => x.id === id)
    return c ? c.label : id
  }
  const conditionSymbolOf = (id) => {
    const c = CONDITIONS.find(x => x.id === id)
    return c ? c.symbol : '●'
  }
  const conditionHintOf = (id) => {
    const c = CONDITIONS.find(x => x.id === id)
    return c ? `${c.label} — ${c.hint}` : id
  }

  const renderConditions = () => (
    <div style={compact ? drColCompact : drCol}>
      <div style={drColLabel}>Conditions</div>
      <div style={compact ? drPillRowCompact : drPillRow}>
        {conditions.map(id => (
          <span key={id} title={conditionHintOf(id)}
            style={{
              ...drPill,
              borderColor: 'var(--accent-red)',
              color: 'var(--accent-red)',
              background: 'color-mix(in srgb, var(--accent-red) 18%, transparent)',
            }}>
            {conditionSymbolOf(id)} {conditionLabelOf(id)}
          </span>
        ))}
      </div>
    </div>
  )

  const renderPills = (set, label, isImmune) => (
    <div style={compact ? drColCompact : drCol}>
      <div style={drColLabel}>{label}</div>
      <div style={compact ? drPillRowCompact : drPillRow}>
        {[...set].map(t => {
          const tn = String(t).toLowerCase()
          const immune = isImmune && m.damageImmunity.has(tn)
          const c = colorFor(t, pillColors)
          return (
            <span key={t}
              title={immune ? `Immun gegen ${t}` : `Resistenz gegen ${t}`}
              style={{
                ...drPill,
                borderColor: c, color: c,
                background: `color-mix(in srgb, ${c} 15%, transparent)`,
                fontWeight: immune ? 700 : 600,
              }}>
              {immune ? '★ ' : ''}{t}
            </span>
          )
        })}
      </div>
    </div>
  )

  return (
    <div style={compact ? drWrapCompact : drWrap}>
      {conditions.length > 0 && renderConditions()}
      {resSet.size > 0 && renderPills(resSet, 'Resistance', true)}
      {vulSet.size > 0 && renderPills(vulSet, 'Vulnerability', false)}
    </div>
  )
}
const drWrap = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 8, marginTop: 8,
}
// Compact variant: einspaltig untereinander, füllt die volle Höhe
// des HP-Section-Containers (alignSelf: stretch im Flex-Parent).
// Conditions sitzen jetzt unten als eigener Footer der hero-row, also
// kann Resistance den vorhandenen Vertikal-Platz komplett nutzen.
// overflow: auto greift erst wenn die Pillen-Liste die Höhe der
// HP-Karte+Controls überschreitet.
const drWrapCompact = {
  display: 'flex', flexDirection: 'column', gap: 6,
  flex: '1 1 0', minWidth: 0, minHeight: 0,
  alignSelf: 'stretch',
  overflowY: 'auto',
  paddingRight: 2,
}
const drCol = {
  background: 'var(--bg-inset)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6, padding: '4px 6px 6px',
}
const drColCompact = {
  // No outer box — sits flush against the HP card's own border.
  display: 'flex', flexDirection: 'column', gap: 2,
}
const drColLabel = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 4,
}
const drPillRow = { display: 'flex', gap: 4, flexWrap: 'wrap' }
// Compact-Variante: Pills stapeln vertikal einzeilig, je eine Pille
// pro Zeile. So bleibt der "yellow area"-Bereich neben der HP-Karte
// schmal und scrollt anstatt zu wrappen.
const drPillRowCompact = { display: 'flex', flexDirection: 'column', gap: 2 }
// Resistance-Pill folgt jetzt der gleichen Form wie alle anderen
// Pills im Sheet (Spell-Tab + Action-Spalte): borderRadius 4 statt
// 999, uppercase + letterSpacing für visuelle Einheitlichkeit.
const drPill = {
  padding: '1px 6px', borderRadius: 4, fontSize: 10,
  border: '1px solid', textTransform: 'uppercase',
  letterSpacing: 0.3, fontWeight: 700,
}

// ─────────────────────────────────────────────────────────────────
// FAVORITES — player-pinned feats / items / spells / class features
// / racial traits, rendered as expandable cards in the Overview tab.
// Keys are stored on `character.status.favorites` (see lib/favorites.js)
// and resolved here against the live sources (no stale snapshots).
// ─────────────────────────────────────────────────────────────────

/**
 * Star button used everywhere the player can pin something. Compact
 * 18×18 inline glyph; outlined when off, filled when on.
 */
export function FavoriteToggle({ favKey, character, applyCharacter, title }) {
  if (!favKey || !applyCharacter) return null
  const on = (character?.status?.favorites || []).includes(favKey)
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); toggleFavorite(applyCharacter, favKey) }}
      title={title || (on ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen')}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: 2, fontSize: 14, lineHeight: 1,
        color: on ? 'var(--accent-yellow, gold)' : 'var(--text-dim)',
        opacity: on ? 1 : 0.55,
      }}
    >
      {on ? '★' : '☆'}
    </button>
  )
}

/**
 * Renders a single favorite as an expandable card. Resolves the
 * key against whichever live source matches its kind, so removing
 * the underlying item (selling, deleveling, retraining a feat)
 * naturally clears the card on the next render.
 */
function FavoriteCard({ favKey, resolved, character, computed, applyCharacter }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('desc')
  const pillColors = usePillColors()
  // Wichtig: ALLE Hooks MÜSSEN vor jedem early-return stehen. Sonst
  // ändert sich die Hook-Anzahl zwischen Renders (resolved geht von
  // null → Objekt sobald featData/spellData async geladen sind) und
  // React wirft "Rendered more hooks than during the previous render".
  // Die useMemo-Guards lesen resolved/favKey defensiv — bei null wird
  // einfach [] zurückgegeben.
  const entries     = resolved?.entries
  const title       = resolved?.title
  const note        = favKey ? getCustomNote(character, favKey) : null
  const mColor      = favKey ? getColorMarker(character, favKey) : null
  const favPills = useMemo(() => {
    if (!resolved || !favKey || !Array.isArray(entries) || entries.length === 0) return []
    const kind = favKey.split(':')[0]
    try {
      if (kind === 'spell') {
        const sc = computed?.spellcasting || {}
        let best = null
        let bestScore = -Infinity
        for (const cid of Object.keys(sc)) {
          const s = (sc[cid]?.spellSaveDC || 0) + (sc[cid]?.spellAttackBonus || 0)
          if (s > bestScore) { bestScore = s; best = sc[cid] }
        }
        const totalCharLevel = (character?.classes || []).reduce((acc, c) => acc + (c.level || 0), 0)
        const fx = parseSpellEffect({ ...resolved, entries, name: title }, {
          spellAttackBonus: best?.spellAttackBonus ?? null,
          saveDC:           best?.spellSaveDC ?? null,
          totalCharLevel,
        })
        return fx?.pills || []
      }
      if (kind === 'feature' || kind === 'trait' || kind === 'feat') {
        const classId = kind === 'feature' ? favKey.split(':')[1] || null : null
        const fx = parseFeatureEffect(
          { name: title, entries, classId },
          character,
          computed?.proficiencyBonus || 0,
          { classDataMap: character?.__classDataMap },
        )
        return fx?.pills || []
      }
    } catch { /* ignore – parser shouldn't crash a render */ }
    return []
  }, [favKey, entries, resolved, title, character, computed])

  if (!resolved) return null
  const { badge, html, fiveeLink } = resolved
  const hasBody = (Array.isArray(entries) && entries.length > 0) || (typeof html === 'string' && html.trim())
  const notePillColor = note?.pillColor || mColor || 'var(--accent)'

  return (
    <div style={{ ...favCard, ...(colorStripeStyle(mColor) || {}) }}>
      <div style={{ ...favCardHeader, cursor: 'default' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1, flexWrap: 'wrap' }}>
          <FavoriteToggle favKey={favKey} character={character} applyCharacter={applyCharacter} />
          <span style={favCardName}>{title}</span>
          {badge && <span style={favCardBadge}>{badge}</span>}
          {favPills.map(p => {
            const color = pillColorForKind(p, pillColors, DAMAGE_TYPE_COLOR)
            return (
              <span key={`favfx-${p.kind}-${p.label}-${p.value || ''}`}
                title={p.title} style={{
                  ...spellPill(color),
                  background: `color-mix(in srgb, ${color} 12%, transparent)`,
                }}>
                {p.value != null ? `${p.label} ${p.value}` : p.label}
              </span>
            )
          })}
          {note?.pillText && (
            <span style={{
              padding: '1px 6px', borderRadius: 4,
              fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
              border: `1px solid ${notePillColor}`,
              color: notePillColor,
              background: `color-mix(in srgb, ${notePillColor} 14%, transparent)`,
              whiteSpace: 'nowrap', textTransform: 'uppercase',
            }} title={note.pillText}>{note.pillText}</span>
          )}
          {/* Cross-Edition-Marker: greift sobald der gleiche Name in
              character.custom.{spells|items|feats} mit _crossEdition:true
              liegt. Welcher Bucket geprüft wird, leiten wir aus dem
              favKey-Präfix ab. */}
          <CrossEditionPill
            character={character}
            kind={
              favKey?.startsWith('spell:') ? 'spell'
              : favKey?.startsWith('item:') ? 'item'
              : favKey?.startsWith('feat:') ? 'feat'
              : null
            }
            name={title}
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          title={open ? 'Einklappen' : 'Aufklappen'}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-dim)', fontSize: 11, padding: '0 4px',
            fontFamily: 'inherit',
          }}
        >{open ? '▲' : '▼'}</button>
      </div>
      {open && (
        <div style={favCardBody} onClick={(e) => e.stopPropagation()}>
          {/* Desc/Notes-Toggle nur wenn echte Beschreibung vorhanden ist. */}
          {hasBody && favKey && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
              <div style={viewToggleWrapInline}>
                <button type="button" onClick={() => setMode('desc')}
                  style={viewToggleBtnInline(mode === 'desc')}>Desc</button>
                <button type="button" onClick={() => setMode('notes')}
                  style={viewToggleBtnInline(mode === 'notes')}>Notes</button>
              </div>
            </div>
          )}
          {(mode === 'desc' || !favKey) && hasBody && (
            entries
              ? <EntryRenderer entries={entries} />
              : <div dangerouslySetInnerHTML={{ __html: html }} />
          )}
          {(mode === 'notes' || !hasBody) && favKey && (
            <textarea
              value={note?.body || ''}
              placeholder="Deine Notizen zu diesem Eintrag …"
              onChange={(e) => setCustomNote(applyCharacter, favKey, { body: e.target.value })}
              style={{
                width: '100%', minHeight: 80,
                padding: '6px 8px', fontSize: 12, lineHeight: 1.45,
                background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)', borderRadius: 6,
                fontFamily: 'inherit', resize: 'vertical',
              }}
            />
          )}
          {favKey && applyCharacter && (
            <div style={{
              marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
              paddingTop: 6, borderTop: '1px dashed var(--border-subtle)',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Stripe:</span>
              <CardColorPicker
                color={mColor}
                onChange={(c) => setColorMarker(applyCharacter, favKey, c)}
                compact
              />
              <input
                type="text"
                defaultValue={note?.pillText || ''}
                placeholder="Pill-Hinweis"
                onBlur={(e) => setCustomNote(applyCharacter, favKey, { pillText: e.target.value })}
                style={{
                  width: 110, padding: '2px 6px', fontSize: 11,
                  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)', borderRadius: 4,
                  fontFamily: 'inherit',
                }}
              />
              <input
                type="color"
                value={note?.pillColor || mColor || '#888888'}
                onChange={(e) => setCustomNote(applyCharacter, favKey, { pillColor: e.target.value })}
                title="Pill-Farbe"
                style={{
                  width: 22, height: 20, padding: 0,
                  background: 'transparent',
                  border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer',
                }}
              />
              {fiveeLink && (
                <span style={{ marginLeft: 'auto' }}>
                  <FiveEToolsLink {...fiveeLink} edition={character?.meta?.edition} compact />
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function resolveFavorite(favKey, character, extras = {}) {
  const { featData, spellData } = extras
  const parsed = parseFavoriteKey(favKey)
  if (!parsed) return null
  const { kind, id } = parsed
  if (kind === 'feat') {
    const feat = (character.feats || []).find(f => (f.featId || f.name) === id)
    if (!feat) return null
    const fd = featData?.[id]
    return {
      title: feat.featId || feat.name,
      badge: 'Feat',
      entries: fd?.entries || null,
      html: feat.description || '',
      fiveeLink: feat.source ? { kind: 'feat', name: feat.featId || feat.name, source: feat.source } : null,
    }
  }
  if (kind === 'item') {
    const all = [
      ...((character.inventory?.items) || []),
      ...((character.custom?.items)    || []),
    ]
    const it = all.find(x => (x.id || x._id || x.name) === id)
    if (!it) return null
    return {
      title: it.name,
      badge: it.equipped ? 'Item · Equipped' : 'Item',
      entries: (Array.isArray(it.entries) && it.entries.length > 0) ? it.entries : null,
      html: it.description || '',
      fiveeLink: (it.source && !it._isCustom) ? { kind: 'item', name: it.name, source: it.source } : null,
    }
  }
  if (kind === 'spell') {
    const sp = spellData?.get(String(id).toLowerCase())
    return {
      title: id,
      badge: sp ? `Spell · Lv ${sp.level}` : 'Spell',
      entries: sp?.entries || null,
      html: '',
      fiveeLink: sp?.source ? { kind: 'spell', name: sp.name || id, source: sp.source } : null,
    }
  }
  if (kind === 'feature') {
    const [classId, name, lvl] = id.split(':')
    const feat = (character.__activeFeatures || []).find(f =>
      f.classId === classId && f.name === name && String(f.level || '') === (lvl || ''))
    if (!feat) return null
    // Class features link to the class page (5etools has no per-feature
    // anchor on the class page in v0). Background entries link to the
    // background page; this branch covers both via the synthetic
    // classId === 'Background' marker the FeaturesTab uses.
    const link = classId === 'Background'
      ? (character.background?.backgroundId && character.background?.source
          ? { kind: 'background', name: character.background.backgroundId.split('__')[0], source: character.background.source }
          : null)
      : (feat.source ? { kind: 'class', name: classId, source: feat.source } : null)
    return {
      title: feat.name,
      badge: classId === 'Background' ? 'Background' : `${classId} · Lv ${feat.level}`,
      entries: feat.entries,
      html: '',
      fiveeLink: link,
    }
  }
  if (kind === 'trait') {
    const tr = (character.species?.__traits || []).find(t => t.name === id)
    if (!tr) return null
    const raceName = character.species?.raceId?.split('__')[0] || ''
    return {
      title: tr.name,
      badge: 'Species',
      entries: tr.entries,
      html: '',
      fiveeLink: (raceName && character.species?.source)
        ? { kind: 'race', name: raceName, source: character.species.source }
        : null,
    }
  }
  return null
}

function FavoritesSection({ character, computed, applyCharacter, swapHeroCol, heroColSwapped }) {
  const favs = getFavorites(character)

  // Lazy data fetches — only when there's at least one favorite of
  // the relevant kind. Keyed by edition so re-renders don't refetch.
  const edition = character?.meta?.edition || '5e'
  const [featData, setFeatData] = useState(null)
  const [spellData, setSpellData] = useState(null)
  const needFeats  = favs.some(k => k.startsWith('feat:'))
  const needSpells = favs.some(k => k.startsWith('spell:'))
  useEffect(() => {
    if (!needFeats || featData) return
    let cancelled = false
    import('../../lib/dataLoader').then(m => m.loadFeatList(edition)).then(list => {
      if (cancelled) return
      const map = {}
      for (const f of list) map[f.name] = f
      setFeatData(map)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [edition, needFeats, featData])
  useEffect(() => {
    if (!needSpells || spellData) return
    let cancelled = false
    import('../../lib/dataLoader').then(m => m.loadSpellList(edition)).then(list => {
      if (cancelled) return
      const map = new Map()
      for (const sp of list) map.set(sp.name.toLowerCase(), sp)
      setSpellData(map)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [edition, needSpells, spellData])

  return (
    <Section
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          {swapHeroCol && (
            <button
              type="button"
              onClick={swapHeroCol}
              title="Mit Spells-Spalte tauschen"
              style={swapColBtnStyle}
            >{heroColSwapped ? '→' : '←'}</button>
          )}
          Favoriten{favs.length ? ` (${favs.length})` : ''}
        </span>
      }
    >
      {favs.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '4px 2px' }}>
          Markiere Feats, Items, Spells, Class Features oder Species-Traits mit dem ☆-Knopf, um sie hier zur Hand zu haben.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
          {favs.map(key => (
            <FavoriteCard
              key={key}
              favKey={key}
              resolved={resolveFavorite(key, character, { featData, spellData })}
              character={character}
              computed={computed}
              applyCharacter={applyCharacter}
            />
          ))}
        </div>
      )}
    </Section>
  )
}

const favCard = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  overflow: 'hidden',
}
const favCardHeader = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 10px', cursor: 'pointer',
}
const favCardName = { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const favCardBadge = { fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 }
const favCardBody = { padding: '8px 12px 10px', borderTop: '1px solid var(--border-subtle)', fontSize: 12, lineHeight: 1.55, color: 'var(--text-secondary)' }

// Fixed-height scroll containers for the new 4-column Overview row.
// The number matches the natural height of the HP card + its details
// (death saves + action pills) on the default-size screen so the four
// columns visually line up at the same baseline.
// Taller columns so they fill the empty vertical space the HP
// column used to take up with Conditions pushed inside. Lets the
// Actions/Spells/Favorites lists show more content before scrolling
// while still leaving room for the Combat Tracker bar and the
// Weapon Mastery / Class Resources row underneath.
// Reagiert auf die Viewport-Höhe via CSS-min(). Bei 1080p (≈960px
// nutzbar) bleibt der alte 440-Wert; bei kleineren Browser-Fenstern
// schrumpft die Spalte automatisch damit der Overview nie
// page-scrollt. Innenscroll der Spalte fängt das überlaufende auf.
const COLUMN_HEIGHT_MAX = 420
const fixedHeightScroll = {
  maxHeight: `min(${COLUMN_HEIGHT_MAX}px, calc(100vh - 460px))`,
  overflowY: 'auto',
  paddingRight: 4,
}
const fixedHeightSection = {
  maxHeight: `min(${COLUMN_HEIGHT_MAX + 48}px, calc(100vh - 410px))`,
  overflowY: 'auto',
}

// ─────────────────────────────────────────────────────────────────
// Concentration glyph — tiny circle on the HP card's top-right
// corner, only visible while concentrating. Tap to clear / re-target.
// Hover shows the current spell name.
// ─────────────────────────────────────────────────────────────────
function ConcentrationGlyph({ value, onChange }) {
  const spellName = value?.spell || value?.name || ''
  if (!spellName) return null
  return (
    <button
      type="button"
      onClick={() => {
        const next = window.prompt(
          `Konzentriert auf: ${spellName}\n\nNeuer Spell-Name (leer = beenden):`,
          spellName,
        )
        if (next === null) return
        const trimmed = next.trim()
        if (!trimmed) onChange(null)
        else onChange({ ...(value || {}), spell: trimmed })
      }}
      title={`Konzentration: ${spellName}`}
      style={{
        position: 'absolute', top: 4, right: 6,
        width: 22, height: 22, borderRadius: '50%',
        border: '1.5px solid var(--accent-purple)',
        background: 'color-mix(in srgb, var(--accent-purple) 22%, transparent)',
        color: 'var(--accent-purple)',
        cursor: 'pointer', padding: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
      }}
    >
      ✦
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────
// Quick Access — wide grid filling the empty space between the HP
// card and the action columns. Auto-detects healing potions (Type='P'
// + "healing" in name) and pulls in any other items the player marked
// with the Quick-Access checkbox in InventoryTab.
//
// Per-tile interaction:
//   • Left-click  → decrease quantity (consume)
//   • Right-click → increase quantity (restock)
// Quantity drops to 0 → tile vanishes (item still in inventory if a
// non-stacking entry, but the tile gets out of the way).
// ─────────────────────────────────────────────────────────────────
function PotionAndQuickAccessColumn({ character, applyCharacter, updateCharacter }) {
  const { isPwaMobile } = usePwaMobile()
  const [inventoryOpen, setInventoryOpen] = useState(false)
  // Lazy-load InventoryTab — it's a heavy module and the Overview only
  // wants it on demand when the player clicks the inventory button.
  const [InventoryTabComponent, setInventoryTabComponent] = useState(null)
  useEffect(() => {
    if (!inventoryOpen || InventoryTabComponent) return
    let cancelled = false
    import('./InventoryTab').then(m => { if (!cancelled) setInventoryTabComponent(() => m.default) })
    return () => { cancelled = true }
  }, [inventoryOpen, InventoryTabComponent])

  const items = [
    ...((character.inventory?.items) || []),
    ...((character.custom?.items)    || []),
  ]
  const isHealingPotion = (it) =>
    /healing/i.test(it?.name || '') &&
    (it?.type === 'P' || /potion/i.test(it?.name || ''))
  const potions = items.filter(isHealingPotion)
  const quickAccess = items.filter(it => it?.quickAccess && !isHealingPotion(it))

  function bumpQty(it, delta) {
    if (!applyCharacter) return
    applyCharacter(d => {
      const lists = [d.inventory?.items, d.custom?.items].filter(Array.isArray)
      for (const list of lists) {
        const idx = list.findIndex(x => (x.id || x._id || x.name) === (it.id || it._id || it.name))
        if (idx >= 0) {
          const q = Math.max(0, (list[idx].quantity || 0) + delta)
          list[idx].quantity = q
          return
        }
      }
    })
  }

  function toggleEquip(it) {
    if (!applyCharacter) return
    applyCharacter(d => {
      const lists = [d.inventory?.items, d.custom?.items].filter(Array.isArray)
      for (const list of lists) {
        const idx = list.findIndex(x => (x.id || x._id || x.name) === (it.id || it._id || it.name))
        if (idx >= 0) {
          list[idx].equipped = !list[idx].equipped
          return
        }
      }
    })
  }

  // Categorise: Equipment (weapons/armor/shields) → Wondrous
  // (getragene Magic-Items ohne Type-Code: wondrous-Flag ODER
  // bonus-tragende Accessoires wie Cloak of Protection / Coat of
  // the Crest, Ring of Protection, Amulet of Health …) → Loot
  // (alles andere, inkl. der auto-detected Healing Potions).
  // Datadriven aus 5etools-Feldern — keine Item-Whitelist.
  const isEquipment = (it) => !!(it.isWeapon || it.isArmor || it.isShield)
  const hasMagicBonus = (it) => !!(it.bonusAc || it.bonusWeapon
    || it.bonusWeaponAttack || it.bonusWeaponDamage
    || it.bonusSpellAttack  || it.bonusSpellSaveDc
    || it.bonusSavingThrow  || it.bonusAbilityCheck)
  const isWondrous = (it) =>
    !isEquipment(it) && (it.wondrous || hasMagicBonus(it) || !!it.reqAttune)
  const equipmentTiles = quickAccess
    .filter(isEquipment)
    .map(it => ({ it, isPotion: false }))
  const wondrousTiles = quickAccess
    .filter(isWondrous)
    .map(it => ({ it, isPotion: false }))
  const lootTiles = [
    ...potions.filter(p => !isWondrous(p)).map(p => ({ it: p, isPotion: true })),
    ...quickAccess
      .filter(it => !isEquipment(it) && !isWondrous(it))
      .map(it => ({ it, isPotion: false })),
  ]
  const tiles = [...equipmentTiles, ...wondrousTiles, ...lootTiles] // for the "empty" check

  // Compact icon-only inventory launcher — fits the narrow column.
  const action = (
    <button
      type="button"
      onClick={() => setInventoryOpen(true)}
      title="Inventar öffnen"
      style={{
        padding: '3px 7px', fontSize: 13, borderRadius: 6,
        border: '1px solid var(--accent)', background: 'transparent',
        color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit',
        lineHeight: 1,
      }}
    >
      📦
    </button>
  )

  const renderTile = ({ it, isPotion }) => (
    <QaItemRow
      key={`qa-${it.id || it._id || it.name}`}
      it={it}
      isPotion={isPotion}
      onToggleEquip={() => toggleEquip(it)}
      onBumpQty={(d) => bumpQty(it, d)}
    />
  )

  // Item-Spalten-Kategorien (Equipment / Loot) reorderbar machen,
  // gleicher Pattern wie Actions/Spells.
  const itemCats = [
    { id: 'items:equipment', label: 'Equipment', tiles: equipmentTiles },
    { id: 'items:wondrous',  label: 'Wondrous',  tiles: wondrousTiles },
    { id: 'items:loot',      label: 'Loot',      tiles: lootTiles },
  ]
  const savedItemOrder = getSavedOrder(character, 'items')
  const orderedItemCats = applySavedOrder(itemCats, savedItemOrder, c => c.id)
  const itemKeys = orderedItemCats.map(c => c.id)
  const isItemOrderCustom = Array.isArray(savedItemOrder) && savedItemOrder.length > 0
  const moveItemCat = (id, dir) => moveCategory(applyCharacter, 'items', itemKeys, id, dir)
  const resetItemOrder = () => resetCategoryOrder(applyCharacter, 'items')

  const body = tiles.length === 0 ? (
    <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 4px' }}>
      Markiere Items im Inventar mit "Quick&nbsp;Access" — Heilungstränke erscheinen automatisch.
    </div>
  ) : (
    <div style={{ ...(isPwaMobile ? flexibleScroll : fixedHeightScroll), display: 'flex', flexDirection: 'column', gap: 6 }}>
      {orderedItemCats.map((cat, idx) => {
        const canUp = idx > 0
        const canDown = idx < orderedItemCats.length - 1
        return (
          <QaCategory
            key={cat.id}
            title={cat.label}
            count={cat.tiles.length}
            defaultOpen
            headerExtras={
              <>
                <button type="button" disabled={!canUp}
                  onClick={(e) => { e.stopPropagation(); moveItemCat(cat.id, 'up') }}
                  style={catReorderBtn(!canUp)} title="Nach oben">▲</button>
                <button type="button" disabled={!canDown}
                  onClick={(e) => { e.stopPropagation(); moveItemCat(cat.id, 'down') }}
                  style={catReorderBtn(!canDown)} title="Nach unten">▼</button>
              </>
            }
          >
            {cat.tiles.map(renderTile)}
          </QaCategory>
        )
      })}
    </div>
  )

  return (
    <>
      <Section
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            {isItemOrderCustom && <ResetOrderIcon onReset={resetItemOrder} />}
            Items
          </span>
        }
        action={action}
      >
        {body}
      </Section>
      <SheetModal
        open={inventoryOpen}
        onClose={() => setInventoryOpen(false)}
        title="Inventar"
        width={1100}
      >
        {InventoryTabComponent ? (
          <InventoryTabComponent
            character={character}
            updateCharacter={updateCharacter}
            applyCharacter={applyCharacter}
          />
        ) : (
          <div style={{ padding: 20, color: 'var(--text-muted)' }}>Lade Inventar…</div>
        )}
      </SheetModal>
    </>
  )
}
// Einzeilige Item-Zeile für die Overview-Items-Spalte.
//   • ▸ links: Expand-Chevron — klick öffnet ein Detail-Panel
//     unter der Zeile mit Stats + EntryRenderer-Beschreibung.
//   • Mitte: Name (kleinere Schrift, darf umbrechen statt
//     abgeschnitten zu werden — der Player soll lange Namen wie
//     "Cloak of Elvenkind" komplett lesen können).
//   • Rechts: Stack-Anzahl ×N, oder EQ/— bei Equippables.
// Right-click auf die Zeile bumpt Stack-Items um +1 (Behavior
// vom alten Tile-Layout übernommen). Linksklick aufs Equip-Badge
// toggelt equipped.
function QaItemRow({ it, isPotion, onToggleEquip, onBumpQty }) {
  // Expand-Mechanik komplett entfernt — Items zeigen Name oben + Qty/EQ
  // unten in zwei Zeilen. Volldetails kommen via Hover-Tooltip (auf
  // dem Namen) und im Inventory-Tab.
  const qty = it.quantity || 0
  // Equippable jetzt datadriven: Waffen/Rüstungen/Schilde wie gehabt,
  // plus jedes Wondrous-Item (Cloak/Ring/Amulet/Coat of …) damit der
  // Equipped-Toggle direkt in der Items-Spalte funktioniert.
  const _hasMagicBonus = !!(it.bonusAc || it.bonusWeapon
    || it.bonusWeaponAttack || it.bonusWeaponDamage
    || it.bonusSpellAttack  || it.bonusSpellSaveDc
    || it.bonusSavingThrow  || it.bonusAbilityCheck)
  const isEquippable = !!(it.isWeapon || it.isArmor || it.isShield
    || it.wondrous || it.reqAttune || _hasMagicBonus)
  const equipped = !!it.equipped
  const tagStripe = it.tagColor
    ? { boxShadow: `inset 4px 0 0 ${it.tagColor}`, paddingLeft: 10 }
    : null
  // Stat-Zeile fürs Detail-Panel: dynamisch zusammengebaut aus
  // den Feldern die das Item tatsächlich trägt — keine
  // Hardcoded-Liste, kein Vorrendern leerer Slots.
  const statBits = [
    it.dmg1       && `${it.dmg1}${it.dmgType ? ' ' + it.dmgType : ''}`,
    it.ac != null && `AC ${it.ac}`,
    it.range      && `Range ${it.range}`,
    it.weight  != null && `${it.weight} lb`,
    it.value   != null && `${it.value} gp`,
    it.rarity && it.rarity !== 'none' && it.rarity !== 'common' && it.rarity,
    it.reqAttune && (typeof it.reqAttune === 'string'
      ? `Attunement (${it.reqAttune})`
      : 'Attunement'),
  ].filter(Boolean)
  const masteryBits = Array.isArray(it.mastery)
    ? it.mastery.map(m => {
        const d = masteryShortDesc(m)
        return d ? `${m} (${d})` : m
      })
    : []
  const propBits = Array.isArray(it.properties)
    ? it.properties.filter(Boolean)
    : []
  const hasEntries = Array.isArray(it.entries) && it.entries.length > 0
  const hasDescription = typeof it.description === 'string' && it.description.trim().length > 0

  // Hover-Tooltip-Content: dieselbe Info wie das Inline-Expand-Panel,
  // damit der User mit Hover die komplette Beschreibung lesen kann
  // ohne aufklappen zu müssen.
  const tooltipContent = (
    <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
      <div style={{
        fontSize: 12, fontWeight: 700, color: 'var(--text-primary)',
        marginBottom: 4,
      }}>{it.customName || it.name}</div>
      {statBits.length > 0 && (
        <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
          {statBits.join(' · ')}
        </div>
      )}
      {masteryBits.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: 'var(--accent-yellow)', fontWeight: 700 }}>Mastery:</span>{' '}
          {masteryBits.join(', ')}
        </div>
      )}
      {propBits.length > 0 && (
        <div style={{ marginBottom: 4, color: 'var(--text-muted)' }}>
          Properties: {propBits.join(', ')}
        </div>
      )}
      {hasEntries && <EntryRenderer entries={it.entries} />}
      {!hasEntries && hasDescription && (
        <div style={{ whiteSpace: 'pre-wrap' }}>{it.description}</div>
      )}
      {!hasEntries && !hasDescription && statBits.length === 0 && (
        <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>
          Keine Beschreibung verfügbar.
        </div>
      )}
    </div>
  )

  // Klick-Regeln (vom User explizit so verlangt):
  //   • Chevron ODER Name  → expand/collapse toggle
  //   • Zahl linksklick    → 1× verbrauchen (Stack)  /  Equip toggeln (Equippable)
  //   • Zahl rechtsklick   → +1 (Stack); bei Equippable ohne Wirkung
  // Daher NUR der Header-Slot links (chevron + name) ist klickbar, die
  // Zahl rechts ist ein eigener Button mit eigenem onClick /
  // onContextMenu — kein onClick auf der ganzen Zeile mehr.
  return (
    <div
      style={{
        ...qaTile,
        ...(tagStripe || {}),
        padding: 0,                            // Padding wird von Header / Body separat gesetzt
        cursor: 'default',
        borderColor: isPotion ? 'var(--accent-red)'
          : (isEquippable && equipped) ? 'var(--accent-green)'
          : 'var(--border)',
        background: isPotion
          ? 'color-mix(in srgb, var(--accent-red) 10%, transparent)'
          : (isEquippable && equipped)
            ? 'color-mix(in srgb, var(--accent-green) 12%, transparent)'
            : 'var(--bg-elevated)',
        overflow: 'hidden',
      }}
    >
      {/* 2-Zeilen-Layout: Name oben, Qty/EQ darunter. Hover über
          den Namen zeigt die volle Beschreibung via Tooltip — kein
          Inline-Expand mehr. Spart horizontalen Platz. */}
      <div style={{ padding: '4px 8px', minWidth: 0 }}>
        <HoverDetailTooltip content={tooltipContent}>
          <span style={{
            display: 'block',
            fontSize: 11, fontWeight: 600, color: 'var(--text-primary)',
            lineHeight: 1.25,
            whiteSpace: 'normal', wordBreak: 'break-word',
          }}>
            {isPotion && '🧪 '}{it.customName || it.name}
          </span>
        </HoverDetailTooltip>
        <div style={{
          marginTop: 2,
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 10, color: 'var(--text-dim)',
        }}>
          {isEquippable ? (
            <button
              type="button"
              onClick={onToggleEquip}
              title={equipped ? 'Klick: Ablegen' : 'Klick: Anlegen'}
              style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                color: equipped ? 'var(--accent-green)' : 'var(--text-dim)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: 0, fontFamily: 'inherit',
              }}
            >{equipped ? 'EQ' : '—'}</button>
          ) : (
            <button
              type="button"
              onClick={() => onBumpQty(-1)}
              onContextMenu={(e) => { e.preventDefault(); onBumpQty(+1) }}
              disabled={qty <= 0}
              title={qty > 0 ? 'Linksklick: −1   ·   Rechtsklick: +1' : 'Rechtsklick: +1'}
              style={{
                fontSize: 10, fontWeight: 800,
                color: qty > 0 ? (isPotion ? 'var(--accent-red)' : 'var(--accent)') : 'var(--text-dim)',
                background: 'transparent', border: 'none',
                padding: 0, fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >×{qty}</button>
          )}
        </div>
      </div>
    </div>
  )
}

// Collapsible category wrapper used inside Quick Access — keeps the
// Equipment / Loot split readable when the player has many items.
function QaCategory({ title, count, defaultOpen = true, children, headerExtras }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <div style={categoryHead}>
        <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
          {open ? '▼' : '▶'} {title}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{count}</span>
        {headerExtras}
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {children}
        </div>
      )}
    </div>
  )
}

const qaTile = {
  border: '1px solid', borderRadius: 6,
  padding: '5px 7px', cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
  display: 'flex', flexDirection: 'column', gap: 2,
  color: 'var(--text-primary)',
}

// ─────────────────────────────────────────────────────────────────
// Green column — Prepared / known / always-prepared spells only.
// Class & species features moved out (they live in the blue Available
// Actions explorer); this column is purely the player's casting
// repertoire, grouped by spell level with collapsible headers.
// Each spell row shows an action-type pill, a slot/uses pill that
// goes grey when the level's slots are spent.
// ─────────────────────────────────────────────────────────────────
function FeaturesAndPreparedSpellsColumn({ character, computed, applyCharacter, updateCharacter, swapHeroCol, heroColSwapped }) {
  const { isPwaMobile } = usePwaMobile()
  const [expandedKey, setExpandedKey] = useState(null)
  // openLevels persistiert per Character — welche Spell-Level-Buckets
  // gerade aufgeklappt sind soll Reload überleben.
  const _spellCharId = character?.id || 'default'
  const [openLevels, setOpenLevels] = usePersistedSet(`spellCol_openLevels_${_spellCharId}`, [0, 1])
  const [spellMap, setSpellMap] = useState(null)
  const [allSpells, setAllSpells] = useState([])
  const edition = character?.meta?.edition || '5e'

  // Full spell catalog — needed for the prepared-caster pool (every
  // spell on the class list, not just what's currently prepared) so
  // the player can toggle prep inline without a modal.
  useEffect(() => {
    let cancelled = false
    loadSpellList(edition).then(list => {
      if (cancelled) return
      const m = new Map()
      for (const s of list) m.set(s.name.toLowerCase(), s)
      setSpellMap(m)
      setAllSpells(list)
    }).catch(() => { if (!cancelled) { setSpellMap(new Map()); setAllSpells([]) } })
    return () => { cancelled = true }
  }, [edition])

  // Per-class spellcasting info from the rules lib — drives the
  // prep-caster vs known-caster split and the maxPrepared counter.
  const casterClasses = useMemo(() => {
    return (character.classes || []).map(cls => {
      const sub = cls.subclassId?.split('__')[0] || null
      const mod = computed?.spellcasting?.[cls.classId]?.modifier ?? 0
      const info = getSpellcastingInfo(cls.classId, cls.level, mod, sub, edition)
      return info ? { classId: cls.classId, info, ritualCasting: !!info.ritualCasting } : null
    }).filter(Boolean)
  }, [character.classes, computed, edition])

  // Class-Abkürzungen für die Multiclass-Pills.
  // Eindeutige 2-Buchstaben-Abkürzungen pro Klasse damit z.B. Warlock
  // immer "WL" und Wizard immer "WI" bleibt — auch wenn nur eine der
  // beiden Klassen im Character ist. Konsistenz > minimal-length.
  // Die preferences-Map deckt alle 5e/5.5e-Klassen ab; unbekannte
  // homebrew classes fallen zurück auf die ersten zwei Buchstaben mit
  // Kollisions-Auflösung über mehr Buchstaben.
  const classAbbr = useMemo(() => {
    const ABBR_PREFS = {
      Artificer:  'AR',
      Barbarian:  'BA',
      Bard:       'BD',
      Cleric:     'CL',
      Druid:      'DR',
      Fighter:    'FI',
      Monk:       'MO',
      Paladin:    'PA',
      Ranger:     'RA',
      Rogue:      'RO',
      Sorcerer:   'SO',
      Warlock:    'WL',
      Wizard:     'WI',
      'Blood Hunter': 'BH',
    }
    const ids = casterClasses.map(c => c.classId)
    const out = {}
    const used = new Set()
    // Erster Pass: zugewiesene Preferences setzen
    for (const cid of ids) {
      const pref = ABBR_PREFS[cid]
      if (pref && !used.has(pref)) {
        out[cid] = pref
        used.add(pref)
      }
    }
    // Zweiter Pass: unbekannte Klassen oder Pref-Kollision per
    // Buchstaben-Expand auflösen.
    for (const cid of ids) {
      if (out[cid]) continue
      for (let n = 2; n <= 4; n++) {
        const cand = cid.slice(0, n).toUpperCase()
        if (!used.has(cand)) {
          out[cid] = cand
          used.add(cand)
          break
        }
      }
      if (!out[cid]) out[cid] = cid.toUpperCase().slice(0, 4)
    }
    return out
  }, [casterClasses])

  const preparedByClass = character?.status?.preparedSpells || {}
  const { slots: slotsArr, warlockSlots } = computeSpellSlots(character)
  const usedSlots = character?.status?.usedSpellSlots || {}
  const usedPact  = character?.status?.usedPactSlots  || 0

  // ── Optional-Features-Katalog lazy laden (Maneuvers, Invocations,
  //    Metamagic, Fighting Styles, Arcane Shots, …). Wird genutzt um
  //    die Beschreibungen / Entries zur picked Option anzuzeigen.
  //    Per Edition gecached, identisch zum SpellMap-Lazy-Load.
  const [optFeatMap, setOptFeatMap] = useState(null)
  useEffect(() => {
    let cancelled = false
    loadOptionalFeatureList(edition).then(list => {
      if (cancelled) return
      const m = new Map()
      for (const f of (list || [])) {
        const key = `${String(f.name || '').toLowerCase()}|${String(f.source || '').toUpperCase()}`
        m.set(key, f)
        // Auch ohne Source mappen — manche Charakter-Speicher haben
        // die source nicht mitgespeichert, dann fallback per name.
        const nameKey = String(f.name || '').toLowerCase()
        if (!m.has(nameKey)) m.set(nameKey, f)
      }
      setOptFeatMap(m)
    }).catch(() => { if (!cancelled) setOptFeatMap(new Map()) })
    return () => { cancelled = true }
  }, [edition])

  // ── Pro Klasse die Optional-Features einsammeln (Maneuvers etc.).
  //    Drei Datenpfade werden gemerged:
  //     • cls.levelChoices[lv].optionalFeatures[]   (Legacy: Level-Up-Wizard
  //       OptFeatPicker)
  //     • cls.levelChoices[lv].fightingStyle (string)  (Legacy: alter Step4b)
  //     • character.choices[descId] = 'of:Name|Source' (NEU: Option-Block-
  //       Resolver in Step4b + LevelUp-Page generischer Picker — Phase 2)
  //
  //    Alle werden nach 5etools featureType-Label gruppiert (Maneuver,
  //    Invocation, Metamagic, Fighting Style, Arcane Shot, …).
  //    optFeatMap ist die geladene optionalfeatures.json — über sie
  //    resolven wir featureType + source für choices-Picks die nur Name
  //    haben.
  const classPicks = useMemo(() => {
    const out = {}
    // Helper: ein bereits resolvter Pick → push to out[classId][label]
    const pushPick = (classId, lv, name, source, featureType) => {
      if (!classId || !name) return
      const ft = String(featureType || '').toUpperCase()
      const labelEntry = FEATURE_TYPE_LABEL[ft]
      const label = labelEntry?.label || ft || 'Other'
      if (!out[classId]) out[classId] = {}
      if (!out[classId][label]) out[classId][label] = []
      // Dedup auf Name + Level — verhindert Doppel-Anzeige wenn Pick
      // sowohl im legacy Optfeatures-Array als auch im neuen choices
      // -Map liegt (z.B. nach Migration).
      const exists = out[classId][label].some(p =>
        p.name === name && p.level === lv,
      )
      if (exists) return
      out[classId][label].push({ name, source, level: lv, featureType: ft })
    }

    for (const cls of (character.classes || [])) {
      for (const [lvStr, ch] of Object.entries(cls.levelChoices || {})) {
        const lv = parseInt(lvStr, 10) || 0
        // Legacy 1: optionalFeatures[] (LevelUp-OptFeatPicker)
        for (const f of (ch.optionalFeatures || [])) {
          pushPick(cls.classId, lv, f.name, f.source, f.featureType)
        }
        // Legacy 2: fightingStyle (string from old Step4b)
        if (typeof ch.fightingStyle === 'string' && ch.fightingStyle) {
          const lookup = optFeatMap?.get(ch.fightingStyle.toLowerCase()) || null
          const ftTag = lookup?.featureType?.[0] || (cls.classId === 'Paladin' ? 'FS:P'
            : cls.classId === 'Ranger' ? 'FS:R' : 'FS:F')
          pushPick(cls.classId, lv, ch.fightingStyle, lookup?.source, ftTag)
        }
        if (typeof ch.superiorTechniqueManeuver === 'string' && ch.superiorTechniqueManeuver) {
          const lookup = optFeatMap?.get(ch.superiorTechniqueManeuver.toLowerCase()) || null
          pushPick(cls.classId, lv, ch.superiorTechniqueManeuver, lookup?.source, lookup?.featureType?.[0] || 'MV:B')
        }
      }
    }

    // Neuer Pfad: character.choices mit 'of:Name|Source' Values. Diese
    // Picks stammen aus dem generischen Option-Block-Picker (Phase 2)
    // und tragen ihren classId im descId-Pfad
    // ("optblock::class::Fighter::::1::Fighting Style::b0").
    for (const [descId, raw] of Object.entries(character.choices || {})) {
      if (!descId.startsWith('optblock::')) continue
      const segs = descId.split('::')
      // Format: optblock::<source>::<classId>::<subclassId>::<level>::<featureName>::bN
      if (segs.length < 7) continue
      const classId = segs[2]
      const level = parseInt(segs[4], 10) || 1
      const values = Array.isArray(raw) ? raw : (raw ? [raw] : [])
      for (const v of values) {
        if (!v || !v.startsWith('of:')) continue
        // 'of:Archery|PHB'
        const [name, src] = v.slice(3).split('|')
        const trimmedName = (name || '').trim()
        if (!trimmedName) continue
        const lookup = optFeatMap?.get(trimmedName.toLowerCase()) || null
        const ft = lookup?.featureType?.[0] || ''
        pushPick(classId, level, trimmedName, src || lookup?.source, ft)
      }
    }
    return out
  }, [character.classes, character.choices, optFeatMap])

  // Klassen die ihren eigenen Tab bekommen — alles mit Caster-Status
  // ODER mit picked Optional-Features. Reihenfolge entspricht der
  // Klassenreihenfolge auf dem Charakter (multiclass-Order).
  const tabbedClasses = useMemo(() => {
    const orderedIds = (character.classes || []).map(c => c.classId)
    const set = new Set()
    for (const c of casterClasses) set.add(c.classId)
    for (const cid of Object.keys(classPicks)) set.add(cid)
    return orderedIds.filter(cid => set.has(cid))
  }, [character.classes, casterClasses, classPicks])

  // Tab-State. 'all' = aktueller Combined-View; sonst classId.
  // Bei Single-Class brauchen wir keine Tabs.
  const [tab, setTab] = useState('all')
  const showTabs = tabbedClasses.length > 1
  // Verschwindet die aktuelle Tab-Klasse (Multi→Single nach Level-
  // Up-Undo o.ä.), zurück auf 'all'.
  useEffect(() => {
    if (tab !== 'all' && !tabbedClasses.includes(tab)) setTab('all')
  }, [tab, tabbedClasses])
  const maxSpellLvl = useMemo(() => {
    let mx = 0
    if (Array.isArray(slotsArr)) for (let i = 0; i < 9; i++) if (slotsArr[i] > 0) mx = i + 1
    if (warlockSlots && warlockSlots.level > mx) mx = warlockSlots.level
    return mx
  }, [slotsArr, warlockSlots])

  // Does ANY of the character's classes ritual-cast? Drives the R★ pill.
  const ritualClassExists = casterClasses.some(c => c.ritualCasting)

  // Build the unified row list:
  //   1. Known/always/granted/prepared spells (from collectCharacterSpells)
  //   2. Full prep pool for every prepared-caster class (so the
  //      player sees every option to toggle inline)
  // Rows are keyed by spell.name.toLowerCase. Each row tracks which
  // classes "own" it (for prep toggle dispatch) and whether the
  // player currently has it prepared / always-prepared.
  const { rowsByLevel, levelOrder, slotInfoByLevel, classCounters } = useMemo(() => {
    const rows = new Map()
    const preparedCasters = casterClasses.filter(c => c.info?.type === 'prepared')
    const collected = collectCharacterSpells(character) || []

    function upsert(name, level, payload) {
      const key = String(name).toLowerCase()
      const ex = rows.get(key)
      if (ex) {
        if (payload.always) ex.always = true
        if (payload.knownByClass) for (const cid of payload.knownByClass) ex.knownByClass.add(cid)
        if (payload.hasSpellbook && payload.classId) ex.spellbookClasses.add(payload.classId)
        return ex
      }
      const sp = spellMap?.get(key) || {
        name, level, source: '',
        castingTime: '—', range: '—', duration: '—',
        components: {}, concentration: false, ritual: false, school: 'U',
        entries: [],
      }
      const row = {
        key, spell: sp, level: sp.level ?? level,
        prepared: false,
        always: !!payload.always,
        knownByClass: new Set(payload.knownByClass || []),
        spellbookClasses: new Set(payload.hasSpellbook && payload.classId ? [payload.classId] : []),
      }
      rows.set(key, row)
      return row
    }

    // 1. Known + granted from sheetUtils (covers cantrips, race-/feat-
    //    granted, and prepared-already entries).
    for (const c of collected) {
      const isAlways = c.granted || c.origins.some(o => ['race','feat','custom'].includes(o))
      upsert(c.name, undefined, {
        always: isAlways,
        knownByClass: c.sourceClasses || [],
      })
    }

    // 2. Prep pool: for each prepared caster, every class-list spell
    //    ≤ maxSpellLvl is a candidate. Wizards prepare from their
    //    spellbook (only the spells they've actually learned), so we
    //    skip the catalog pool for them — collectCharacterSpells
    //    already returns their spellbook entries above.
    for (const cc of preparedCasters) {
      const want = cc.classId.toLowerCase()
      const hasSpellbook = !!cc.info?.hasSpellbook
      if (hasSpellbook) continue
      for (const sp of (allSpells || [])) {
        if (sp.level < 1 || sp.level > maxSpellLvl) continue
        if (!(sp.classes || []).some(cn => String(cn).toLowerCase() === want)) continue
        upsert(sp.name, sp.level, { knownByClass: [cc.classId] })
      }
    }

    // Mark prepared from the player's stored picks.
    for (const [classId, names] of Object.entries(preparedByClass)) {
      for (const name of (names || [])) {
        const key = String(name).toLowerCase()
        const row = rows.get(key)
        if (row) {
          row.prepared = true
          row.knownByClass.add(classId)
        }
      }
    }

    // Group by level.
    const byLevel = {}
    const slotInfoByLevel = {}
    for (const row of rows.values()) {
      const lv = row.level || 0
      if (!byLevel[lv]) byLevel[lv] = []
      byLevel[lv].push(row)
    }
    const levelOrder = Object.keys(byLevel).map(Number).sort((a, b) => a - b)
    for (const lv of levelOrder) {
      // Sort: prepared / always-prepared rise to the top so the
      // player's active picks read first, then unprepared in
      // alphabetical order below.
      byLevel[lv].sort((a, b) => {
        const aActive = (a.prepared || a.always || lv === 0) ? 0 : 1
        const bActive = (b.prepared || b.always || lv === 0) ? 0 : 1
        if (aActive !== bActive) return aActive - bActive
        return a.spell.name.localeCompare(b.spell.name)
      })
      if (lv === 0) continue
      const total = Array.isArray(slotsArr) ? (slotsArr[lv - 1] || 0) : 0
      let used = usedSlots[lv] || 0
      let totalDisp = total
      let remain = Math.max(0, total - used)
      if (warlockSlots && warlockSlots.level === lv) {
        remain    += Math.max(0, warlockSlots.slots - usedPact)
        totalDisp += warlockSlots.slots
      }
      slotInfoByLevel[lv] = { remain, total: totalDisp }
    }

    const classCounters = preparedCasters.map(cc => ({
      classId: cc.classId,
      current: (preparedByClass[cc.classId] || []).length,
      max: cc.info?.maxPrepared || 0,
    }))

    return { rowsByLevel: byLevel, levelOrder, slotInfoByLevel, classCounters }
  }, [character, spellMap, allSpells, casterClasses, preparedByClass, maxSpellLvl, slotsArr, warlockSlots, usedSlots, usedPact])

  function toggleLevel(lv) {
    setOpenLevels(prev => {
      const next = new Set(prev)
      if (next.has(lv)) next.delete(lv); else next.add(lv)
      return next
    })
  }

  function togglePrep(row) {
    if (!updateCharacter) return
    if (row.spell.level === 0) return // cantrips never need prep
    // Always-prepared (race/feat/feature grants) DARF jetzt ZUSÄTZLICH
    // gepreped werden — der Spell erscheint dann als 2. Eintrag in der
    // Action-Spalte (siehe Bucket-Builder), einer für den at-will Cast
    // ohne Slot, einer für den Slot-castbaren Eintrag.
    // Welche Klasse beansprucht diesen Prep-Slot?
    // Reihenfolge:
    //   1. Klassen die den Spell schon prepped haben (für Unprep-Klick)
    //   2. Klassen die diesen Spell laut row.knownByClass führen können
    //   3. Fallback: irgendeine Prepared-Caster-Klasse des Charakters
    //      — fängt 5e-Edge-Cases wo der Spell nur über das
    //      sourceClasses-Set ohne canonical case angekommen ist.
    const preparedCasterIds = casterClasses
      .filter(c => c.info?.type === 'prepared')
      .map(c => c.classId)
    if (preparedCasterIds.length === 0) return
    const knownByClassLower = new Set([...(row.knownByClass || [])].map(s => String(s).toLowerCase()))
    const eligible = preparedCasterIds.filter(cid =>
      row.knownByClass.has(cid) || knownByClassLower.has(cid.toLowerCase()),
    )
    const finalEligible = eligible.length > 0 ? eligible : preparedCasterIds
    const isPrepped = !!row.prepared
    const target = isPrepped
      ? (finalEligible.find(cid => (preparedByClass[cid] || []).some(n => n.toLowerCase() === row.key)) || finalEligible[0])
      : finalEligible[0]
    prepWithClass(row, target)
  }

  // Mutually exclusive Per-Class-Toggle. Wird vom Multiclass-Pill-
  // Layout gerufen: Klick auf Pille X → Spell wird bei Klasse X
  // prepared und falls vorher bei einer anderen Klasse prepared,
  // dort entfernt. Klick auf bereits aktive Pille → unprep.
  function prepWithClass(row, classId) {
    if (!updateCharacter || !classId) return
    if (row.spell.level === 0) return
    const listOfTarget = preparedByClass[classId] || []
    const hasInTarget = listOfTarget.some(n => n.toLowerCase() === row.key)
    if (hasInTarget) {
      // Aktive Pille → unprep bei dieser Klasse.
      updateCharacter(
        `status.preparedSpells.${classId}`,
        listOfTarget.filter(n => n.toLowerCase() !== row.key),
      )
      return
    }
    // Andere Pille → bei alter Klasse(n) entfernen, bei neuer
    // hinzufügen. Iterieren über ALLE Caster, damit auch Legacy-
    // Doppeleinträge sauber konsolidiert werden.
    for (const cc of casterClasses) {
      if (cc.classId === classId) continue
      const list = preparedByClass[cc.classId] || []
      if (list.some(n => n.toLowerCase() === row.key)) {
        updateCharacter(
          `status.preparedSpells.${cc.classId}`,
          list.filter(n => n.toLowerCase() !== row.key),
        )
      }
    }
    updateCharacter(`status.preparedSpells.${classId}`, [...listOfTarget, row.spell.name])
  }

  // Modal-State: welche Klasse hat gerade ihr Prepare/Spellbook-
  // Modal offen. Eine pro Klick auf eine Header-Pille.
  const [modalClassId, setModalClassId] = useState(null)

  // Header-Pillen: pro Prepare-Caster eine klickbare Pille die ihr
  // Modal öffnet. Wizard wird mit "Spellbook" beschriftet, alle
  // anderen mit "Prepare ClassName". Zeigt zusätzlich den
  // Counter "x/y" — gelb wenn das Limit erreicht ist.
  const headerCounter = classCounters.length > 0 ? (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
      {classCounters.map(c => {
        const isWizard = c.classId === 'Wizard'
        const overLimit = c.current >= c.max && c.max > 0
        return (
          <button
            key={c.classId}
            type="button"
            onClick={() => setModalClassId(c.classId)}
            title={isWizard ? 'Spellbook öffnen' : `${c.classId}-Spells preparen`}
            style={{
              fontSize: 10, fontWeight: 700, padding: '3px 8px',
              borderRadius: 999, fontFamily: 'inherit', cursor: 'pointer',
              background: 'transparent',
              border: `1px solid ${overLimit ? 'var(--accent-yellow)' : 'var(--accent-green)'}`,
              color: overLimit ? 'var(--accent-yellow)' : 'var(--accent-green)',
              whiteSpace: 'nowrap',
            }}
          >
            {isWizard ? 'Spellbook' : c.classId}{c.max > 0 ? ` ${c.current}/${c.max}` : ''}
          </button>
        )
      })}
    </span>
  ) : null

  // Tab-Filter: für jeden Spell-Level die Rows auf die aktive Tab-
  // Klasse kürzen. 'all' belässt alle. Always-prepared Rows ohne
  // knownByClass werden in jedem Tab gezeigt (race/feat grants).
  const visibleRowsByLevel = useMemo(() => {
    if (tab === 'all' || !showTabs) return rowsByLevel
    const out = {}
    for (const lv of Object.keys(rowsByLevel)) {
      out[lv] = rowsByLevel[lv].filter(row =>
        row.knownByClass?.has(tab) || !row.knownByClass || row.knownByClass.size === 0,
      )
    }
    return out
  }, [tab, showTabs, rowsByLevel])
  const visibleLevelOrder = useMemo(
    () => Object.keys(visibleRowsByLevel).map(Number).sort((a, b) => a - b),
    [visibleRowsByLevel],
  )

  // Class-Picks für den aktiven Tab. 'all' sammelt alles aus allen
  // Klassen, sonst nur die der aktiven Klasse.
  const visibleClassPicks = useMemo(() => {
    if (tab === 'all') {
      const combined = {}
      for (const [cid, groups] of Object.entries(classPicks)) {
        for (const [label, items] of Object.entries(groups)) {
          if (!combined[label]) combined[label] = []
          for (const it of items) combined[label].push({ ...it, classId: cid })
        }
      }
      return combined
    }
    const g = classPicks[tab] || {}
    const out = {}
    for (const [label, items] of Object.entries(g)) {
      out[label] = items.map(it => ({ ...it, classId: tab }))
    }
    return out
  }, [tab, classPicks])
  const pickLabels = Object.keys(visibleClassPicks)

  // Vereinheitlichte Kategorien-Liste (Class-Picks + Spell-Levels)
  // damit der User per ▲▼ Reihenfolge ändern + per ↻ resetten kann.
  // Stable IDs: `pick:<label>` für Maneuvers/Invocations etc.,
  // `lvl:<n>` für Spell-Level-Gruppen.
  const allCategories = useMemo(() => {
    const out = []
    for (const label of pickLabels) {
      out.push({ id: `pick:${label}`, label, kind: 'pick' })
    }
    for (const lv of visibleLevelOrder) {
      out.push({
        id: `lvl:${lv}`,
        label: lv === 0 ? 'Cantrips' : `Level ${lv}`,
        kind: 'level',
        lv,
      })
    }
    return out
  }, [pickLabels.join('|'), visibleLevelOrder.join('|')])

  const savedSpellOrder = getSavedOrder(character, 'spells')
  const orderedSpellCats = applySavedOrder(allCategories, savedSpellOrder, c => c.id)
  const orderedKeys = orderedSpellCats.map(c => c.id)
  const isSpellOrderCustom = Array.isArray(savedSpellOrder) && savedSpellOrder.length > 0
  const moveSpellCat = (id, dir) => moveCategory(applyCharacter, 'spells', orderedKeys, id, dir)
  const resetSpellOrder = () => resetCategoryOrder(applyCharacter, 'spells')

  return (
    <>
    <Section
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          {isSpellOrderCustom && <ResetOrderIcon onReset={resetSpellOrder} />}
          {swapHeroCol && (
            <button
              type="button"
              onClick={swapHeroCol}
              title="Mit Favoriten-Spalte tauschen"
              style={swapColBtnStyle}
            >{heroColSwapped ? '→' : '←'}</button>
          )}
          Spells & More
        </span>
      }
      action={headerCounter}
    >
      <div style={isPwaMobile ? flexibleScroll : fixedHeightScroll}>
        {showTabs && (
          <div style={{
            display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap',
          }}>
            <button
              type="button"
              onClick={() => setTab('all')}
              style={spellTabStyle(tab === 'all')}
              title="Alle Klassen kombiniert"
            >All</button>
            {tabbedClasses.map(cid => (
              <button
                key={cid}
                type="button"
                onClick={() => setTab(cid)}
                style={spellTabStyle(tab === cid)}
                title={cid}
              >{classAbbr[cid] || cid.slice(0, 2).toUpperCase()}</button>
            ))}
          </div>
        )}

        {/* Unified Render: orderedSpellCats vermischt Class-Picks
            und Spell-Levels in der vom Spieler gewählten Reihenfolge.
            Jedes Element trägt ▲▼ zum Verschieben. */}
        {visibleLevelOrder.length === 0 && pickLabels.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '4px 2px' }}>
            Keine Spells.
          </div>
        )}
        {orderedSpellCats.map((cat, catIdx) => {
          const canUp   = catIdx > 0
          const canDown = catIdx < orderedSpellCats.length - 1
          const Arrows = (
            <>
              <button type="button" disabled={!canUp}
                onClick={(e) => { e.stopPropagation(); moveSpellCat(cat.id, 'up') }}
                style={catReorderBtn(!canUp)} title="Nach oben">▲</button>
              <button type="button" disabled={!canDown}
                onClick={(e) => { e.stopPropagation(); moveSpellCat(cat.id, 'down') }}
                style={catReorderBtn(!canDown)} title="Nach unten">▼</button>
            </>
          )
          if (cat.kind === 'pick') {
            return (
              <ClassPickCategory
                key={cat.id}
                label={cat.label}
                items={visibleClassPicks[cat.label]}
                optFeatMap={optFeatMap}
                showClassBadge={tab === 'all'}
                classAbbr={classAbbr}
                headerExtras={Arrows}
                character={character}
                computed={computed}
              />
            )
          }
          const lv = cat.lv
          const rows = visibleRowsByLevel[lv]
          const open = openLevels.has(lv)
          const slotInfo = slotInfoByLevel[lv]
          return (
            <div key={cat.id} style={{ marginBottom: 6 }}>
              <div style={categoryHead}>
                <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => toggleLevel(lv)}>
                  {open ? '▼' : '▶'} {cat.label}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                  {rows.length}{slotInfo ? ` · ${slotInfo.remain}/${slotInfo.total} slots` : ''}
                </span>
                {Arrows}
              </div>
              {open && rows.map(row => (
                <SpellListRow
                  key={row.key}
                  row={row}
                  isExpanded={expandedKey === row.key}
                  onExpand={() => setExpandedKey(k => k === row.key ? null : row.key)}
                  onTogglePrep={() => togglePrep(row)}
                  onPrepWithClass={(cid) => prepWithClass(row, cid)}
                  casterClasses={casterClasses}
                  classAbbr={classAbbr}
                  preparedByClass={preparedByClass}
                  ritualClassExists={ritualClassExists}
                  character={character}
                  computed={computed}
                  applyCharacter={applyCharacter}
                />
              ))}
            </div>
          )
        })}
      </div>
    </Section>
    <SpellPrepareModal
      open={!!modalClassId}
      onClose={() => setModalClassId(null)}
      character={character}
      computed={computed}
      classId={modalClassId}
      casterClasses={casterClasses}
      classAbbr={classAbbr}
      preparedByClass={preparedByClass}
      maxSpellLvl={maxSpellLvl}
      updateCharacter={updateCharacter}
      applyCharacter={applyCharacter}
      prepWithClass={prepWithClass}
    />
    </>
  )
}

// Single row in the Spells column. Renders:
//   • dot toggle (left)  — empty/dim = not prepared, filled green
//     = prepared, blue solid = always-prepared, ☆ for cantrips
//   • name + pills (action type, components, conc, ritual)
//   • slot label (At-Will / N/M)
//   • expanded panel: full chips (cast/range/duration/components) +
//     5etools entries
function SpellListRow({
  row, isExpanded, onExpand, onTogglePrep, onPrepWithClass,
  casterClasses = [], classAbbr = {}, preparedByClass = {},
  ritualClassExists,
  character, computed, applyCharacter,
}) {
  // User-Pill-Farben (pro-Damage-Typ Overrides aus Settings).
  const pillColors = usePillColors()
  // Color-Marker fuer den Spell — gleicher Key wie in der Action-
  // Spalte UND wie favoriteKey('spell', name) damit der gleiche
  // Farb-Tag bei Spells-Spalte, Action-Spalte und Features-Tab
  // synchron läuft. KEIN lowercase — favoriteKey ist case-preserving.
  const mKey = `spell:${row.spell?.name || row.key || ''}`
  const mColor = getColorMarker(character, mKey)
  const mNote = getCustomNote(character, mKey)
  const mNoteColor = mNote?.pillColor || mColor || 'var(--accent)'
  const sp = row.spell
  const lv = row.level
  const isCantrip = lv === 0
  const grayed = !row.prepared && !row.always && !isCantrip
  // Cantrips brauchen kein Prep. Always-prepared Spells durften früher
  // auch nicht togglen — neu: man kann sie zusätzlich preparen, damit
  // sie als 2. Eintrag (Slot-castbar) in der Action-Spalte erscheinen.
  // Dies wird im Bucket-Builder via Duplikat-Row umgesetzt.
  const canToggle = !isCantrip
  const dotKind = row.always
    ? (row.prepared ? 'always-prep' : 'always')
    : (row.prepared ? 'on' : 'off')

  // Multiclass-Modus: wenn EINE oder mehr Caster-Klassen diesen Spell
  // preparen dürfen, zeige Per-Klasse-Pills statt des einzelnen Dots.
  // User-Wunsch: immer Klassen-Buchstaben anzeigen damit klar bleibt
  // welche Klasse den Spell gerade trägt. Cantrips & Always-Prepared
  // rendern weiterhin den Single-Dot (kein Prep-Toggle nötig / sinnvoll).
  const eligiblePrepClasses = canToggle
    ? casterClasses.filter(c => c.info?.type === 'prepared' && row.knownByClass?.has(c.classId))
    : []
  const showMulticlassPills = eligiblePrepClasses.length >= 1

  // Pills
  const ct = String(sp.castingTime || '').toLowerCase()
  const actionLetter =
    /\bbonus(?:\s*action)?\b/.test(ct) ? 'B' :
    /\breaction\b/.test(ct) ? 'R' :
    /\baction\b/.test(ct) ? 'A' : null
  // Match the same colour pallette used by the action pills on Action
  // / Bonus Action / Reaction everywhere else on the sheet so the
  // player can scan their spells and instantly tell "this consumes
  // my bonus action this turn".
  const actionColor =
    actionLetter === 'B' ? 'var(--accent-yellow)' :
    actionLetter === 'R' ? 'var(--accent-purple)' :
    actionLetter === 'A' ? 'var(--accent-red)'    : null
  const comps = sp.components || {}
  const compChars = [comps.v && 'V', comps.s && 'S', comps.m && 'M'].filter(Boolean).join('')
  const showRitualPill = !!sp.ritual && ritualClassExists

  // Smart-Effect-Pills (Attack/Save/DC/Damage/Healing/Upcast) aus dem
  // 5etools-Entries-Text rausgeparst. Identische Logik zur Action-
  // Spalte: wir picken die beste Caster-Klasse die diesen Spell auf
  // ihrer Liste hat (DC + Attack-Bonus → max), schicken deren Werte
  // mit in den Parser, und rendern was rauskommt.
  const effectPills = useMemo(() => {
    if (!sp || !Array.isArray(sp.entries)) return []
    // Klasse picken: bevorzugt eine die diesen Spell führt; sonst
    // irgendeine Caster-Klasse damit DC/Atk-Werte sinnvoll bleiben.
    const sc = computed?.spellcasting || {}
    let bestCid = null
    let bestScore = -Infinity
    const known = row.knownByClass || new Set()
    for (const cid of Object.keys(sc)) {
      const isKnown = known.has(cid) || known.has(String(cid).toLowerCase())
      const score = (sc[cid]?.spellSaveDC || 0) + (sc[cid]?.spellAttackBonus || 0) + (isKnown ? 50 : 0)
      if (score > bestScore) { bestScore = score; bestCid = cid }
    }
    const stats = bestCid ? sc[bestCid] : null
    const totalCharLevel = (character?.classes || []).reduce((s, c) => s + (c.level || 0), 0)
    const fx = parseSpellEffect(sp, {
      spellAttackBonus: stats?.spellAttackBonus ?? null,
      saveDC:           stats?.spellSaveDC ?? null,
      totalCharLevel,
    })
    return fx?.pills || []
  }, [sp, computed, row.knownByClass, character?.classes])

  return (
    <div
      style={{
        margin: '2px 0',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        background: 'var(--bg-elevated)',
        opacity: grayed ? 0.55 : 1,
        ...(colorStripeStyle(mColor) || {}),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px' }}>
        {/* Single-Caster oder Cantrip / Always-Prepared → klassischer
            Dot. Bei Multiclass mit ≥2 Prep-Klassen rendern wir
            stattdessen Per-Klasse-Pills (s. unten). */}
        {!showMulticlassPills && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (canToggle) onTogglePrep() }}
            disabled={!canToggle}
            title={
              dotKind === 'always-prep' ? 'Always Prepared + zusätzlich prepared — klick zum Entfernen des Zusatz-Preps'
              : dotKind === 'always' ? 'Always Prepared — klick um zusätzlich zu preparen'
              : isCantrip ? 'Cantrip — always available'
              : dotKind === 'on' ? 'Prepared (klick zum Unpreparen)'
              : 'Nicht prepared (klick zum Preparen)'
            }
            style={prepDot(dotKind, canToggle)}
          >{
            // Glyphen pro dotKind:
            //   'on'          → ● (gefüllter Kreis, grün)
            //   'always'      → ◆ Diamond (blauer Outline, leerer Kern)
            //   'always-prep' → ◆ Diamond (blau gefüllt, weil zusätzlich prep'd)
            //   'off'         → ○ Hohl-Kreis
            dotKind === 'on' ? '●'
              : dotKind === 'always' || dotKind === 'always-prep' ? '◆'
              : '○'
          }</button>
        )}
        {showMulticlassPills && (
          <div style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
            {eligiblePrepClasses.map(c => {
              const cid     = c.classId
              const list    = preparedByClass[cid] || []
              const active  = list.some(n => n.toLowerCase() === row.key)
              const abbr    = classAbbr[cid] || cid.slice(0, 1).toUpperCase()
              return (
                <button
                  key={cid}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onPrepWithClass?.(cid) }}
                  title={row.always
                    ? (active
                        ? `Always Prepared (race/feat/feature) + zusätzlich via ${cid} — klick zum Entfernen des Zusatz-Preps`
                        : `Always Prepared (race/feat/feature) — klick um zusätzlich via ${cid} zu preparen`)
                    : active
                      ? `Prepared via ${cid} — klick zum Unpreparen`
                      : `Prepare via ${cid}`}
                  style={classPillStyle(active, row.always)}
                >{abbr}</button>
              )
            })}
          </div>
        )}

        <HoverDetailTooltip
          triggerStyle={{ flex: 1, minWidth: 0, display: 'block' }}
          content={
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                {sp.name}
              </div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
                {[
                  lv === 0 ? 'Cantrip' : `Level ${lv}`,
                  sp.castingTime && `Cast ${sp.castingTime}`,
                  sp.range && `Range ${sp.range}`,
                  sp.duration && `Duration ${sp.duration}`,
                ].filter(Boolean).join(' · ')}
              </div>
              {Array.isArray(sp.entries) && sp.entries.length > 0 && (
                <EntryRenderer entries={sp.entries} />
              )}
              {Array.isArray(sp.entriesHigherLevel) && sp.entriesHigherLevel.length > 0 && (
                <div style={{
                  marginTop: 6, paddingTop: 6,
                  borderTop: '1px dashed var(--border-subtle)',
                  color: 'var(--text-secondary)',
                }}>
                  <EntryRenderer entries={
                    (sp.entriesHigherLevel.length === 1
                      && sp.entriesHigherLevel[0]?.entries
                      && sp.entriesHigherLevel[0]?.type === 'entries')
                      ? sp.entriesHigherLevel[0].entries
                      : sp.entriesHigherLevel
                  } />
                </div>
              )}
            </div>
          }
        >
          <span
            onClick={onExpand}
            style={{ fontSize: 12, fontWeight: 600, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}
          >
            {sp.name}
          </span>
        </HoverDetailTooltip>

        {/* Smart-Pills (Attack/Save/DC/Damage/Healing/Upcast) zuerst
            damit sie unmittelbar neben dem Namen sitzen — gleiche
            Reihenfolge wie in der Action-Spalte. Components/Conc/
            Ritual/Action-Type folgen rechts dahinter. */}
        {effectPills.map((p) => {
          const color = pillColorForKind(p, pillColors, DAMAGE_TYPE_COLOR)
          return (
            <span key={`fx-${p.kind}-${p.label}-${p.value || ''}`}
              title={p.title} style={{
                ...spellPill(color),
                background: `color-mix(in srgb, ${color} 12%, transparent)`,
              }}>
              {p.value != null ? `${p.label} ${p.value}` : p.label}
            </span>
          )
        })}
        {/* Pill order: components → conc → ritual → action type. The
            action-type pill sits ALL the way to the right so it
            visually lines up with the Action/Bonus/Reaction column
            colour in adjacent panels. */}
        {compChars && (
          <span style={spellPill('var(--text-muted)')} title="Components">{compChars}</span>
        )}
        {sp.concentration && (
          <span style={spellPill('var(--accent-purple)')} title="Concentration">conc.</span>
        )}
        {showRitualPill && (
          <span style={spellPill('var(--accent-blue)')} title="Ritual">R★</span>
        )}
        {actionLetter && (
          <span style={spellPill(actionColor)} title="Casting time">{actionLetter}</span>
        )}
        {/* Weapon-Buff-Spell-Indikator (Shillelagh, Magic Weapon,
            Magic Stone, Elemental Weapon, ...): klick öffnet die Row
            + den Weapon-Picker im Expanded-Body. Wenn schon aktiv:
            zeigt die gebuffte Waffe als Pill an. */}
        {applyCharacter && getSpellWeaponBuff(sp?.name) && (() => {
          const activeOnes = getActiveEffects(character)
            .filter(e => e?.source === `spell:${sp.name}`)
          if (activeOnes.length > 0) {
            const target = activeOnes[0]?.target?.label || activeOnes[0]?.target?.id || '?'
            return (
              <span style={{
                ...spellPill('var(--accent-orange, #ff9533)'),
                background: 'color-mix(in srgb, var(--accent-orange, #ff9533) 14%, transparent)',
                cursor: 'pointer',
              }} title={`Aktiv auf ${target}. Klick zum Anzeigen / Dismiss.`}
                onClick={(e) => { e.stopPropagation(); onExpand?.() }}>
                ⚔ {target}
              </span>
            )
          }
          return (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); onExpand?.() }}
              title="Auf Waffe wirken — Picker im Expanded-Body öffnen"
              style={{
                ...spellPill('var(--accent-orange, #ff9533)'),
                background: 'color-mix(in srgb, var(--accent-orange, #ff9533) 10%, transparent)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              ⚔ Cast on…
            </button>
          )
        })()}
        {mNote?.pillText && (
          <span style={{
            ...spellPill(mNoteColor),
            background: `color-mix(in srgb, ${mNoteColor} 14%, transparent)`,
          }} title={mNote.pillText}>{mNote.pillText}</span>
        )}
        <CrossEditionPill character={character} kind="spell" name={sp?.name} />
      </div>

      {isExpanded && (
        <div style={{ padding: '6px 10px 10px', borderTop: '1px solid var(--border-subtle)', fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
          {/* Detail chips — show every metadata field the spell has */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <DetailMini label="Lv" value={lv === 0 ? 'Cantrip' : lv} />
            <DetailMini label="Cast" value={sp.castingTime || '—'} />
            <DetailMini label="Range" value={sp.range || '—'} />
            <DetailMini label="Dur" value={sp.duration || '—'} />
            <DetailMini label="Comp" value={[
              comps.v && 'V', comps.s && 'S',
              comps.m && (typeof comps.m === 'object' ? `M (${comps.m.text || ''})` : `M (${comps.m})`),
            ].filter(Boolean).join(', ') || '—'} />
            {sp.concentration && <DetailMini label="" value="Concentration" />}
            {sp.ritual && <DetailMini label="" value="Ritual" />}
          </div>
          {Array.isArray(sp.entries) && sp.entries.length > 0 && (
            <EntryRenderer entries={sp.entries} />
          )}
          {Array.isArray(sp.entriesHigherLevel) && sp.entriesHigherLevel.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <EntryRenderer entries={sp.entriesHigherLevel} />
            </div>
          )}
          {/* Spell-Weapon-Buff (Shillelagh / Magic Weapon / Magic
              Stone / Elemental Weapon): wenn der Spell-Name im
              SPELL_WEAPON_BUFFS-Catalog steht, zeigen wir hier den
              Weapon-Picker. Aktivieren registriert ein activeEffect;
              rulesEngine.computeAttacks consumed das. */}
          {applyCharacter && getSpellWeaponBuff(sp?.name) && (
            <SpellWeaponBuffPicker
              spell={sp}
              character={character}
              applyCharacter={applyCharacter}
            />
          )}
          {applyCharacter && (
            <div
              style={{
                marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                paddingTop: 6, borderTop: '1px solid var(--border-subtle)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Stripe:</span>
              <CardColorPicker
                color={mColor}
                onChange={(c) => setColorMarker(applyCharacter, mKey, c)}
                compact
              />
              <input
                type="text"
                defaultValue={mNote?.pillText || ''}
                placeholder="Pill-Hinweis"
                onBlur={(e) => setCustomNote(applyCharacter, mKey, { pillText: e.target.value })}
                style={{
                  width: 110, padding: '2px 6px', fontSize: 11,
                  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)', borderRadius: 4,
                  fontFamily: 'inherit',
                }}
              />
              <input
                type="color"
                value={mNote?.pillColor || mColor || '#888888'}
                onChange={(e) => setCustomNote(applyCharacter, mKey, { pillColor: e.target.value })}
                title="Pill-Farbe"
                style={{
                  width: 22, height: 20, padding: 0,
                  background: 'transparent',
                  border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer',
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Spells-Spalten-Tab-Pille (All / W / Wi / Wa / R / …) ────────
// Visuell parallel zu den Action-Spalten-Tabs gehalten: oben in der
// Spells-Spalte sitzt für Multiclass-Charaktere eine Reihe Pills, die
// die Liste auf die jeweilige Klasse filtern.
function spellTabStyle(active) {
  return {
    padding: '3px 9px', borderRadius: 6,
    fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
    border: `1px solid ${active ? 'var(--accent-green)' : 'var(--border)'}`,
    background: active
      ? 'color-mix(in srgb, var(--accent-green) 18%, transparent)'
      : 'transparent',
    color: active ? 'var(--accent-green)' : 'var(--text-muted)',
    cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  }
}

// ── Spell-Weapon-Buff-Picker ─────────────────────────────────────
// Erscheint im Expanded-Body einer Spell-Row für Spells im
// SPELL_WEAPON_BUFFS-Catalog (Shillelagh, Magic Weapon, Magic Stone,
// Elemental Weapon). Listet die eligiblen Waffen, "Activate" pinnt
// den Effekt an die gewählte Waffe via lib/activeEffects.
//   • Aktiver Effekt zeigt sich als badge mit × Dismiss-Knopf
//   • rulesEngine.computeAttacks consumed den Effekt → Attack/Damage
//     reflektieren die Buff-Werte automatisch (Shillelagh: WIS + 1d8)
function SpellWeaponBuffPicker({ spell, character, applyCharacter }) {
  const buff = getSpellWeaponBuff(spell?.name)
  const [showAll, setShowAll] = useState(false)
  const dmgTypeOpts = buff?.damageTypeOptions || null
  const [dmgType, setDmgType] = useState(dmgTypeOpts ? dmgTypeOpts[0] : null)
  if (!buff) return null
  const eligible = getEligibleWeapons(character, spell?.name)
  // Fallback: alle Waffen wenn der strikte Filter leer ist ODER der
  // Spieler "alle anzeigen" gewählt hat. Schützt vor dem Edge-Case
  // wo der Char eine Custom-Named Waffe hat die nicht erkannt wird.
  const allWeapons = [
    ...((character?.inventory?.items) || []),
    ...((character?.custom?.items) || []),
  ].filter(i => i?.isWeapon || String(i?.type || '').split('|')[0] === 'M' || String(i?.type || '').split('|')[0] === 'R')
  const displayList = (showAll || eligible.length === 0) ? allWeapons : eligible
  const activeEffects = getActiveEffects(character)
  // Effekte die VON DIESEM Spell stammen (gleicher source-string).
  const sourceTag = `spell:${spell.name}`
  const active = activeEffects.filter(e => e?.source === sourceTag)

  function activate(weapon) {
    // Spell-Daten an buildEffect durchreichen — sonst kann
    // Shillelagh seinen Cantrip-Scaling-Würfel nicht aus
    // scalingLevelDice ziehen und fällt auf 1d8 zurück.
    const opts = { spell, ...(dmgType ? { damageType: dmgType } : {}) }
    const built = buff.buildEffect(character, weapon, opts)
    addActiveEffect(applyCharacter, {
      kind: built.kind,
      source: sourceTag,
      target: { kind: 'weapon', id: weapon.id, label: weapon.customName || weapon.name },
      value: built.value || {},
      until: buff.duration,
    })
  }
  function dismiss(effectId) {
    removeActiveEffect(applyCharacter, effectId)
  }

  return (
    <div style={{
      marginTop: 8, padding: '8px 10px', borderRadius: 6,
      border: '1px dashed var(--accent-orange, #ff9533)',
      background: 'color-mix(in srgb, var(--accent-orange, #ff9533) 8%, transparent)',
    }} onClick={(e) => e.stopPropagation()}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6,
        color: 'var(--accent-orange, #ff9533)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {buff.label} — Auf Waffe wirken
      </div>
      {active.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
          {active.map(e => (
            <div key={e.id} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 6px', borderRadius: 4,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--accent-orange, #ff9533)',
              fontSize: 11,
            }}>
              <span style={{ color: 'var(--accent-orange, #ff9533)', fontWeight: 700 }}>● Active</span>
              <span style={{ color: 'var(--text-primary)', flex: 1 }}>
                {e?.target?.label || e?.target?.id}
              </span>
              <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>{e.until || ''}</span>
              <button type="button" onClick={() => dismiss(e.id)}
                title="Effekt aufheben"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13,
                  padding: '0 4px', fontFamily: 'inherit', lineHeight: 1,
                }}>×</button>
            </div>
          ))}
        </div>
      )}
      {dmgTypeOpts && (
        <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Damage-Type:</span>
          {dmgTypeOpts.map(t => (
            <button key={t} type="button"
              onClick={() => setDmgType(t)}
              style={{
                padding: '2px 6px', fontSize: 10, borderRadius: 4,
                cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${dmgType === t ? 'var(--accent-orange, #ff9533)' : 'var(--border)'}`,
                color: dmgType === t ? 'var(--accent-orange, #ff9533)' : 'var(--text-secondary)',
                background: dmgType === t
                  ? 'color-mix(in srgb, var(--accent-orange, #ff9533) 14%, transparent)'
                  : 'transparent',
                fontWeight: dmgType === t ? 700 : 400,
              }}>
              {t[0].toUpperCase()}{t.slice(1)}
            </button>
          ))}
        </div>
      )}
      {displayList.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          Keine Waffen im Inventar gefunden.
        </div>
      ) : (
        <>
          {eligible.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4 }}>
              Keine Waffe passt strikt zum Spell-Filter — alle Waffen werden gelistet.
            </div>
          )}
          {eligible.length > 0 && (
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, color: 'var(--text-muted)', marginBottom: 4,
              cursor: 'pointer',
            }}>
              <input type="checkbox" checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)} />
              Alle Waffen anzeigen (überschreibt Spell-Filter)
            </label>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {displayList.map(w => {
              const isAlreadyActive = active.some(e => e?.target?.id === w.id)
              return (
                <button key={w.id} type="button" onClick={() => activate(w)}
                  disabled={isAlreadyActive}
                  title={isAlreadyActive ? 'Schon aktiv' : `Auf ${w.customName || w.name} wirken`}
                  style={{
                    padding: '3px 8px', fontSize: 11,
                    background: isAlreadyActive ? 'transparent' : 'var(--bg-elevated)',
                    border: '1px solid var(--accent-orange, #ff9533)',
                    borderRadius: 4,
                    color: 'var(--accent-orange, #ff9533)',
                    cursor: isAlreadyActive ? 'default' : 'pointer',
                    opacity: isAlreadyActive ? 0.5 : 1,
                    fontFamily: 'inherit',
                  }}>
                  {w.customName || w.name}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Class-Pick-Kategorie (Maneuvers / Invocations / Metamagic / …) ─
// Eine Klapp-Kategorie pro featureType-Label. Items werden so
// kompakt wie Spell-Rows gerendert: linker Marker + Name + (im
// 'All'-Tab) ein Klassen-Badge rechts. Klick öffnet ein Sub-Panel
// mit der vollen Entry-Beschreibung aus optionalfeatures.json.
function ClassPickCategory({ label, items, optFeatMap, showClassBadge, classAbbr, headerExtras, character, computed }) {
  const [open, setOpen] = useState(true)
  const [expandedKey, setExpandedKey] = useState(null)
  const pillColors = usePillColors()
  if (!items || items.length === 0) return null
  const profBonus = computed?.proficiencyBonus || 0
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={categoryHead}>
        <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
          {open ? '▼' : '▶'} {label}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{items.length}</span>
        {headerExtras}
      </div>
      {open && items.map(it => {
        const key = `${it.classId || ''}|${it.name}|${it.level || ''}`
        const expanded = expandedKey === key
        const lookupKey = `${String(it.name).toLowerCase()}|${String(it.source || '').toUpperCase()}`
        const featData = optFeatMap?.get(lookupKey) || optFeatMap?.get(String(it.name).toLowerCase()) || null
        const hasEntries = Array.isArray(featData?.entries) && featData.entries.length > 0
        // Smart-Pills aus dem Eintrag-Text. featData hat name + entries
        // — genau das was parseFeatureEffect erwartet. classId schicken
        // wir mit damit Skalierungs-Tabellen pro Klasse greifen.
        let pickPills = []
        if (featData) {
          try {
            const fx = parseFeatureEffect(
              { ...featData, classId: it.classId || null },
              character,
              profBonus,
              { classDataMap: character?.__classDataMap },
            )
            pickPills = fx?.pills || []
          } catch { pickPills = [] }
        }
        return (
          <div key={key} style={{
            margin: '2px 0',
            border: '1px solid var(--border-subtle)', borderRadius: 6,
            background: 'var(--bg-elevated)',
          }}>
            <div
              onClick={() => setExpandedKey(k => k === key ? null : key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 8px',
                cursor: hasEntries ? 'pointer' : 'default',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ color: 'var(--text-dim)', fontSize: 10, width: 10, textAlign: 'center' }}>
                {hasEntries ? (expanded ? '▼' : '▶') : '·'}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {it.name}
              </span>
              {pickPills.map(p => {
                const color = pillColorForKind(p, pillColors, DAMAGE_TYPE_COLOR)
                return (
                  <span key={`pick-fx-${p.kind}-${p.label}-${p.value || ''}`}
                    title={p.title} style={{
                      ...spellPill(color),
                      background: `color-mix(in srgb, ${color} 12%, transparent)`,
                    }}>
                    {p.value != null ? `${p.label} ${p.value}` : p.label}
                  </span>
                )
              })}
              {it.level > 0 && (
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Lv {it.level}</span>
              )}
              {showClassBadge && it.classId && (
                <span style={{
                  fontSize: 9, fontWeight: 800,
                  padding: '1px 5px', borderRadius: 4,
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                }}>{classAbbr[it.classId] || it.classId.slice(0, 2).toUpperCase()}</span>
              )}
            </div>
            {expanded && hasEntries && (
              <div style={{
                padding: '6px 10px 10px',
                borderTop: '1px solid var(--border-subtle)',
                fontSize: 11, lineHeight: 1.55, color: 'var(--text-secondary)',
              }}>
                <EntryRenderer entries={featData.entries} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Per-Klasse-Pille (W/R/P/C/...) für den Multiclass-Modus. Aktive
// Klasse = gefüllt + Akzentfarbe; inaktive = nur Border + dim. Klein
// genug damit 3–4 Pillen in derselben Höhe wie der alte Single-Dot
// nebeneinander passen.
// Always-prepared Spells (isAlways=true) bekommen ein BLAUES Pill statt
// dem üblichen Grün — gleiches Farbschema wie der Solo-Dot (◆ blau)
// damit Spieler auf einen Blick "always-prepared via race/feat/feature"
// erkennt. Active-Zustand (zusätzlich via dieser Klasse prep'd) füllt
// die Pille mit derselben Akzent-Farbe.
function classPillStyle(active, isAlways = false) {
  const accent = isAlways ? 'var(--accent-blue)' : 'var(--accent-green)'
  return {
    minWidth: 18, height: 18, padding: '0 4px',
    borderRadius: 9,
    border: `1.5px solid ${active ? accent : 'var(--text-dim)'}`,
    background: active ? accent : 'transparent',
    color: active ? 'var(--bg-base, #111)' : (isAlways ? accent : 'var(--text-dim)'),
    cursor: 'pointer', fontSize: 10, fontWeight: 800,
    lineHeight: 1, fontFamily: 'inherit',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  }
}

function prepDot(kind, enabled) {
  const color =
    kind === 'on'         ? 'var(--accent-green)' :
    kind === 'always-prep' ? 'var(--accent-green)' :
    kind === 'always'     ? 'var(--accent-blue)'  :
    'var(--text-dim)'
  return {
    width: 18, height: 18, borderRadius: '50%',
    background: kind === 'always-prep' ? 'var(--accent-blue)' : 'transparent',
    border: `1.5px solid ${color}`,
    color,
    cursor: enabled ? 'pointer' : 'default',
    padding: 0, fontSize: 13, lineHeight: 1, fontFamily: 'inherit',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  }
}
function spellPill(color) {
  return {
    fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
    letterSpacing: 0.3, textTransform: 'uppercase',
    border: `1px solid ${color}`, color,
    whiteSpace: 'nowrap',
  }
}
function DetailMini({ label, value }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '1px 7px', borderRadius: 6,
      background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)',
      fontSize: 10,
    }}>
      {label && <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{label}:</span>}
      <span style={{ color: 'var(--text-primary)' }}>{value}</span>
    </span>
  )
}
const categoryHead = {
  display: 'flex', alignItems: 'center', gap: 6,
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
  color: 'var(--text-muted)',
  padding: '4px 6px', cursor: 'pointer',
  background: 'var(--bg-inset)', borderRadius: 4,
  marginBottom: 3,
}

const ACTION_PILL_COLOR = {
  action:      'var(--accent-red)',
  bonusAction: 'var(--accent-yellow)',
  reaction:    'var(--accent-purple)',
}
const ACTION_PILL_LABEL = {
  action:      'Action',
  bonusAction: 'Bonus',
  reaction:    'Reaction',
}
function ActionTypePill({ kind }) {
  const color = ACTION_PILL_COLOR[kind] || 'var(--text-dim)'
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
      border: `1px solid ${color}`, color,
      whiteSpace: 'nowrap',
    }}>{ACTION_PILL_LABEL[kind] || kind}</span>
  )
}
function UsesPill({ remaining, max }) {
  const out = remaining === 0
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
      border: `1px solid ${out ? 'var(--text-dim)' : 'var(--accent-green)'}`,
      color: out ? 'var(--text-dim)' : 'var(--accent-green)',
      whiteSpace: 'nowrap',
    }}>{remaining}/{max}</span>
  )
}

// ── Combat-stat tile (AC, Initiative, Speed, Prof Bonus) ──────────
// `tooltip` puts a native title on the element; used by the Speed tile
// to surface fly / swim / climb modes without crowding the visual.
// `badge` is a tiny glyph in the corner indicating extra info exists.
function CombatTile({ label, value, color, tooltip, badge }) {
  return (
    <div style={combatTile} title={tooltip || undefined}>
      {badge && <div style={tileBadge}>{badge}</div>}
      <div style={{ ...combatTileValue, color }}>{value}</div>
      <div style={combatTileLabel}>{label}</div>
    </div>
  )
}

// ── Combat economy (Action / Bonus Action / Reaction) ─────────────
// One button per slot. Click toggles "used" state. "Neue Runde" resets
// all three to unused at the start of the player's next turn. State
// lives at character.status.economy.
function CombatEconomy({ value, onChange, character }) {
  // Conditional extra pills:
  //  • Action Surge — a flag the Fighter sets via the explorer when
  //    they spend their Action Surge resource; gives a second
  //    Action this turn. Goes away on `reset`.
  //  • Hasted Action — automatic while the character is concentrating
  //    on `Haste`. Lets you take ONE of {Attack (1×), Dash, Disengage,
  //    Hide, Use Object}. The pill is the tracker; restrictions are
  //    enforced socially.
  // The leveled-spell-this-turn flag (`value.leveledCast`) is read
  // when the explorer wants to warn the player, and cleared here.
  const concSpell = String(character?.status?.concentration?.spell || character?.status?.concentration?.name || '').toLowerCase()
  const hasted    = /\bhaste\b/.test(concSpell)
  // Abkürzungen identisch zum Action-Explorer-Tab-Set (A / BA / R / HA)
  // damit Spieler die gleichen Labels überall wiedererkennen.
  const slots = [
    { id: 'action',      label: 'A',  title: 'Action',       color: 'var(--accent-red)' },
    { id: 'bonusAction', label: 'BA', title: 'Bonus Action', color: 'var(--accent-yellow)' },
    { id: 'reaction',    label: 'R',  title: 'Reaction',     color: 'var(--accent-purple)' },
  ]
  if (value?.surgeActive) {
    slots.push({ id: 'surgeAction', label: 'AS', title: 'Action Surge', color: 'var(--accent-orange, #ff9533)' })
  }
  if (hasted) {
    slots.push({ id: 'hastedAction', label: 'HA', title: 'Hasted Action', color: 'var(--accent-blue)' })
  }
  function toggle(id) {
    onChange({ ...(value || {}), [id]: !value?.[id] })
  }
  function reset() {
    // Clear EVERY per-turn flag including the conditional pills and
    // the leveledCast guard. `surgeActive` clears too — Action Surge
    // is single-use-per-turn (refreshes on short/long rest, not the
    // round).
    onChange({
      action: false, bonusAction: false, reaction: false,
      surgeAction: false, hastedAction: false,
      surgeActive: false, leveledCast: false,
    })
  }
  const anyUsed = !!(value?.action || value?.bonusAction || value?.reaction
    || value?.surgeAction || value?.hastedAction || value?.surgeActive || value?.leveledCast)

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', alignItems: 'center', overflow: 'hidden' }}>
      {slots.map(s => {
        const used = !!value?.[s.id]
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => toggle(s.id)}
            title={used
              ? `${s.title || s.label} bereits verwendet — klicken zum Zurücksetzen`
              : `${s.title || s.label} verfügbar — klicken zum Markieren als verwendet`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
              border: `1.5px solid ${used ? 'var(--text-dim)' : s.color}`,
              background: used ? 'transparent' : `color-mix(in srgb, ${s.color} 18%, transparent)`,
              color: used ? 'var(--text-dim)' : s.color,
              fontSize: 12, fontWeight: 700,
              textDecoration: used ? 'line-through' : 'none',
              opacity: used ? 0.7 : 1,
              fontFamily: 'inherit',
            }}
          >
            {used ? '✓' : '○'} {s.label}
          </button>
        )
      })}
      {/* Neue-Runde-Button direkt rechts neben die Action-Pills statt
          ganz rechts ans Bar-Ende — spart Layout-Breite und reduziert
          Maus-Weg zwischen "letzten Spot markieren" und "neue Runde". */}
      <button
        type="button"
        onClick={reset}
        disabled={!anyUsed}
        title="Alle Action-Slots zurücksetzen — neue Runde"
        style={{
          padding: '4px 10px', borderRadius: 999,
          border: '1px solid var(--border)', background: 'transparent',
          color: anyUsed ? 'var(--text-secondary)' : 'var(--text-dim)',
          fontSize: 11, cursor: anyUsed ? 'pointer' : 'default', fontFamily: 'inherit',
        }}
      >
        ↻ Neue Runde
      </button>
    </div>
  )
}

// ── Concentration tracker ──────────────────────────────────────────
// Plain inline-edit + Clear button. The spell field is free-text on
// purpose — picking from "known spells" is unreliable (homebrew,
// non-class spells from items, etc.) and a tap-to-edit text input is
// the fastest "I just cast Hex on the goblin" entry path. The flag is
// what matters for ruling purposes; the name is a memory aid.
function ConcentrationTracker({ value, onChange }) {
  // Support both legacy `{ name }` and current `{ spell }` shapes.
  const spellName = value?.spell || value?.name || ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(spellName)

  if (editing) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          autoFocus
          value={draft}
          placeholder="z. B. Hex, Hold Person…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = draft.trim()
              onChange(v ? { spell: v, since: new Date().toISOString() } : null)
              setEditing(false)
            }
            if (e.key === 'Escape') {
              setDraft(value?.spell || ''); setEditing(false)
            }
          }}
          onBlur={() => {
            const v = draft.trim()
            onChange(v ? { spell: v, since: new Date().toISOString() } : null)
            setEditing(false)
          }}
          style={S.input}
        />
      </div>
    )
  }

  if (!spellName) {
    return (
      <div
        onClick={() => { setDraft(''); setEditing(true) }}
        style={concentrationEmpty}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') { setDraft(''); setEditing(true) } }}
      >
        Konzentrierst du gerade auf einen Zauber? Klick zum Eintragen.
      </div>
    )
  }

  return (
    <div style={concentrationActive}>
      <span style={concentrationDot} />
      <span style={concentrationSpellName} onClick={() => { setDraft(spellName); setEditing(true) }}>
        {spellName}{value?.level ? ` (Lv. ${value.level})` : ''}
      </span>
      <Btn variant="ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => onChange(null)}>
        Aufheben
      </Btn>
    </div>
  )
}

// ── Local styles (kept inline so the file stays self-contained) ────
const identityStrip = {
  display: 'flex', flexWrap: 'wrap', gap: 8,
  padding: '8px 10px', marginBottom: 12,
  background: 'var(--bg-surface)', border: '1px solid var(--border)',
  borderRadius: 8,
}
const identityBadge = {
  display: 'inline-flex', alignItems: 'baseline', gap: 6,
  padding: '3px 10px', borderRadius: 6,
  background: 'var(--bg-inset)', fontSize: 12,
}
const identityBadgeLabel = {
  color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 9,
  fontWeight: 600,
}
const identityBadgeValue = { color: 'var(--text-primary)', fontWeight: 600 }
const overviewCoinCell = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '2px 6px 2px 4px',
  background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)',
  borderRadius: 4,
}
const overviewCoinLabel = {
  fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
}
const overviewCoinInput = {
  width: 50, background: 'transparent', border: 'none', outline: 'none',
  color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 12,
  padding: '2px 0', textAlign: 'right',
}

// Flex (not grid) so the tile column drops below the HP section on
// narrow screens — the 4 stat tiles never need to wrap individually,
// only the whole column.
const heroRow = {
  display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap',
}
// PWA-Mobile: vertikaler Stack. Auf einem Phone-Screen wird die
// 5-spaltige Hero-Reihe sonst zu 5 Blöcken mit JEWEILS eigener
// 440px-Innen-Scroll-Box — extrem unangenehm zu bedienen. Stattdessen
// stapeln wir die Sections vertikal und überlassen das Scrollen der
// Seite. flexibleScroll ersetzt die Fixed-Height-Caps, damit jede
// Section ihren vollen Inhalt ohne Inner-Scroll rendert.
const heroRowPwa = {
  display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'stretch',
}
const heroColPwa = {
  width: '100%', minWidth: 0,
}
const flexibleScroll = {
  // Kein Max-Height: Inhalt fließt natürlich, Seite scrollt.
  paddingRight: 4,
}
const combatTileColumn = {
  display: 'grid', gridTemplateColumns: 'repeat(2, minmax(100px, 1fr))', gap: 8,
  alignContent: 'start',
  flex: '1 1 220px', maxWidth: 260,
}
const combatTile = {
  background: 'var(--bg-surface)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '10px 8px', textAlign: 'center', minWidth: 0,
  position: 'relative',
}
const tileBadge = {
  position: 'absolute', top: 4, right: 6,
  fontSize: 10, color: 'var(--accent)',
  fontWeight: 600,
}
const twoColumnRow = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 12,
}
const combatTileValue = { fontSize: 22, fontWeight: 'bold', lineHeight: 1.1, marginBottom: 2 }
const combatTileLabel = { fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }

const concentrationEmpty = {
  padding: '8px 12px', borderRadius: 6, border: '1px dashed var(--border)',
  color: 'var(--text-dim)', fontSize: 12, fontStyle: 'italic', cursor: 'pointer',
}
const concentrationActive = {
  display: 'inline-flex', alignItems: 'center', gap: 10,
  padding: '6px 12px', borderRadius: 999,
  background: 'color-mix(in srgb, var(--accent-purple) 18%, transparent)',
  border: '1px solid var(--accent-purple)',
}
const concentrationDot = {
  width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-purple)',
  boxShadow: '0 0 6px var(--accent-purple)',
}
const concentrationSpellName = { color: 'var(--accent-purple)', fontWeight: 600, cursor: 'pointer' }

const markedBadge = {
  display: 'inline-block', marginLeft: 8, padding: '1px 7px',
  borderRadius: 999, fontSize: 10, fontWeight: 600,
  background: 'color-mix(in srgb, var(--accent-purple) 25%, transparent)',
  color: 'var(--accent-purple)',
  border: '1px solid var(--accent-purple)',
  textTransform: 'uppercase', letterSpacing: 0.5,
}
const masteryBadge = {
  display: 'inline-block', marginLeft: 6, padding: '1px 7px',
  borderRadius: 999, fontSize: 10, fontWeight: 600,
  background: 'color-mix(in srgb, var(--accent-blue) 22%, transparent)',
  color: 'var(--accent-blue)',
  border: '1px solid var(--accent-blue)',
  letterSpacing: 0.4,
}

const classStrip = { display: 'flex', flexDirection: 'column', gap: 6 }
const classRow = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 10, padding: '6px 10px',
  background: 'var(--bg-surface)', border: '1px solid var(--border)',
  borderRadius: 6, flexWrap: 'wrap',
}
const classMain = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }
const classNameLabel = { fontWeight: 'bold', color: 'var(--text-primary)' }
const classLevelLabel = { color: 'var(--text-muted)', fontSize: 12 }
const classMeta = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }
const classProg = {
  fontSize: 10, color: 'var(--text-muted)', padding: '2px 6px',
  background: 'var(--bg-inset)', borderRadius: 4,
}

const historyDetails = {
  marginTop: 16,
  padding: '8px 12px',
  background: 'var(--bg-surface)', border: '1px solid var(--border)',
  borderRadius: 8,
}
const historySummary = {
  cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600,
  display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none',
}
const historyCount = { color: 'var(--text-dim)', fontSize: 11, fontWeight: 'normal' }
