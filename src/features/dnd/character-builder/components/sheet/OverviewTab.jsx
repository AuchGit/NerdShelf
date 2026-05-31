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
import SpellPrepareModal from './SpellPrepareModal'
import usePwaMobile from '../../../../../shared/hooks/usePwaMobile'
import { parseSpellEffect, DAMAGE_TYPE_COLOR } from '../../lib/spellEffectParser'
import { parseFeatureEffect } from '../../lib/featureEffectParser'
import { applySavedOrder, getSavedOrder, moveCategory, resetCategoryOrder } from '../../lib/categoryOrder'
import { getColorMarker, setColorMarker, colorStripeStyle } from '../../lib/cardColors'
import { isPinnedAction, togglePinnedAction, getPinnedActions } from '../../lib/pinnedActions'
import HoverDetailTooltip from '../ui/HoverDetailTooltip'
import { CardColorPicker } from './SheetKit'

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
// Temp / Max steht jetzt als zwei zentrierte schlanke Zeilen unter
// der HP-Karte: jeweils ein simples Number-Input mit Label davor.
// Statt Stepper, damit der Platz minimal bleibt und die Karten unten
// sauber ausgerichtet sind. Werte spiegeln sich direkt mit
// status.temporaryHp / status.maxHpBonus.
function TempMaxControls({ hp, maxHpBonus, updateCharacter }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      alignItems: 'center', marginTop: 6,
    }}>
      <label style={hpMiniInputRow}>
        <span style={hpMiniInputLabel}>temp:</span>
        <input
          type="number" min="0" max="999"
          value={hp.temporary || 0}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const v = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0)
            updateCharacter('status.temporaryHp', v)
          }}
          style={hpMiniInputField}
        />
      </label>
      <label style={hpMiniInputRow}>
        <span style={hpMiniInputLabel}>max:</span>
        <input
          type="number" min="-999" max="999"
          value={maxHpBonus || 0}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const v = e.target.value === '' ? 0 : (parseInt(e.target.value, 10) || 0)
            updateCharacter('status.maxHpBonus', v)
          }}
          style={hpMiniInputField}
        />
      </label>
    </div>
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
      {/* ── Compact identity strip ──
          Species · Subrace · Background · Alignment · Experience —
          tiny badges, single row. The big InfoCard grid that used to
          eat half the screen for info that never changes mid-session
          is gone. Detailed traits live in the Features tab. */}
      <div style={identityStrip}>
        <span style={identityBadge}>
          <span style={identityBadgeLabel}>Species</span>
          <span style={identityBadgeValue}>
            {character.species.subraceId
              ? `${character.species.subraceId.split('__')[0]} (${character.species.raceId?.split('__')[0]})`
              : character.species.raceId?.split('__')[0] || '—'}
          </span>
        </span>
        <span style={identityBadge}>
          <span style={identityBadgeLabel}>Background</span>
          <span style={identityBadgeValue}>{character.background.backgroundId?.split('__')[0] || '—'}</span>
        </span>
        {character.info.alignment && (
          <span style={identityBadge}>
            <span style={identityBadgeLabel}>Alignment</span>
            <span style={identityBadgeValue}>{character.info.alignment}</span>
          </span>
        )}
        <span style={identityBadge}>
          <span style={identityBadgeLabel}>Edition</span>
          <span style={identityBadgeValue}>{character.meta.edition === '5.5e' ? 'D&D 2024' : 'D&D 2014'}</span>
        </span>
        {!!character.info.experience && (
          <span style={identityBadge}>
            <span style={identityBadgeLabel}>XP</span>
            <span style={identityBadgeValue}>{character.info.experience}</span>
          </span>
        )}
        {/* Currency strip — same compact cells as the Inventory tab so
            the player can tweak coin counts without leaving Overview.
            Pushed to the right with auto-margin so it sits on the same
            row as the identity badges. */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
          {COIN_TYPES.map(({ key, label, color }) => (
            <label key={key} style={overviewCoinCell}>
              <span style={{ ...overviewCoinLabel, color }}>{label.slice(0, 2).toUpperCase()}</span>
              <input
                type="number" min="0" inputMode="numeric"
                value={(character.inventory?.currency || {})[key] ?? 0}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const v = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0)
                  updateCharacter(`inventory.currency.${key}`, v)
                }}
                style={overviewCoinInput}
              />
            </label>
          ))}
        </div>
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
          {/* Spieler-Notizen: füllt den restlichen vertikalen Platz der
              HP-Section bis zum Section-Ende. Kein eigener Page-
              Scroll-Push — wenn der Text die Textarea überfüllt,
              scrollt sie intern. resize ist deaktiviert da die Höhe
              automatisch durch flex:1 verwaltet wird. */}
          {!readOnly && (
            <textarea
              value={character.status?.hpNotes || ''}
              placeholder="Notizen …"
              onChange={(e) => updateCharacter('status.hpNotes', e.target.value)}
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

        <div style={isPwaMobile ? heroColPwa : { flex: '1 1 260px', minWidth: 0 }}>
          <FeaturesAndPreparedSpellsColumn
            character={character}
            computed={computed}
            applyCharacter={applyCharacter}
            updateCharacter={updateCharacter}
          />
        </div>

        {/* Yellow — Favorites, now in the top row as the 5th column. */}
        <div style={isPwaMobile ? heroColPwa : { flex: '1 1 240px', minWidth: 0 }}>
          <div style={isPwaMobile ? flexibleScroll : fixedHeightSection}>
            <FavoritesSection
              character={character}
              computed={computed}
              applyCharacter={applyCharacter}
            />
          </div>
        </div>
      </div>

      {/* Conditions-Footer: spannt horizontal die ganze hero-row und
          schließt sie nach unten ab — passend zum Reference-Bild.
          Section-Header wird weggelassen; die Chips sind selbst-
          erklärend genug. */}
      <div style={{
        marginTop: 8, padding: '6px 10px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
      }}>
        <ConditionChips
          active={character.status?.conditions || []}
          onToggle={(id, on) => {
            const cur = character.status?.conditions || []
            const next = on ? [...cur.filter(x => x !== id), id] : cur.filter(x => x !== id)
            updateCharacter('status.conditions', next)
          }}
          compact
        />
        <FeatureNoteList notes={getEffectsForSlot(character, 'conditions')} />
      </div>

      {/* ── Closing strip: HP details + Death Saves + Action pills ──
          One single full-width row, no section header:
            HP Method · Hit Dice · Successes · Failures · Action pills
          The "Combat-Tracker" title was deliberately removed — the
          strip is its own visual divider between the play columns
          and whatever sits below them. */}
      <div style={{
        display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
        padding: '8px 12px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8, marginTop: 10, marginBottom: 10,
      }}>
        <DetailChip label="HP Method" value={character.hpPreference?.method === 'roll' ? 'Roll' : 'Average'} />
        <DetailChip label="Hit Dice" value={character.classes.map(c => `${c.level}d${c.hitDie}`).join(' + ')} />
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-subtle)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={S.deathSaveRow}>
            <span style={S.deathSaveLabel}>Successes</span>
            <Pips count={3} filled={deathSaves.successes} color="var(--accent-green)"
              onSet={n => updateCharacter('status.deathSaves', { ...deathSaves, successes: n })} />
          </div>
          <div style={S.deathSaveRow}>
            <span style={S.deathSaveLabel}>Failures</span>
            <Pips count={3} filled={deathSaves.failures} color="var(--accent-red)"
              onSet={n => updateCharacter('status.deathSaves', { ...deathSaves, failures: n })} />
          </div>
        </div>
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-subtle)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <CombatEconomy
            value={economy}
            character={character}
            onChange={(next) => updateCharacter('status.economy', next)}
          />
        </div>
        {/* Spellcasting — compact inline summary inside the same
            tracker bar. Per class: "Cleric: WIS +7/13". Skip when the
            character has no spellcasting class so the bar stays tight
            on martials. */}
        {computed?.spellcasting && Object.keys(computed.spellcasting).length > 0 && (
          <>
            <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-subtle)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {Object.entries(computed.spellcasting).map(([cls, data]) => (
                <div key={cls} style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  <span style={{ fontWeight: 700 }}>{cls}:</span>{' '}
                  <span style={{ color: 'var(--text-muted)' }}>{data.ability.toUpperCase()}</span>{' '}
                  <span style={{ color: 'var(--accent-blue)', fontWeight: 700 }}>{data.spellAttackDisplay}</span>
                  <span style={{ color: 'var(--text-dim)' }}>/</span>
                  <span style={{ color: 'var(--accent-purple)', fontWeight: 700 }}>{data.spellSaveDC}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

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
  // `embedded` = render always-open (no collapsible header), no own
  // padding, so the column container controls dimensions and the
  // explorer is just the inner content.
  const [open, setOpen] = useState(embedded)
  const [tab, setTab]   = useState('action')
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
  function castSpellFromExplorer(spell, slotLevel, opts = {}) {
    if (!applyCharacter) return
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
        properties: atk.properties || [],
        markedAs: atk.markedAs || null,
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
    const seenSpells = new Set()
    for (const c of collected) {
      const key = c.name.toLowerCase()
      if (seenSpells.has(key)) continue
      seenSpells.add(key)
      const full = spellMap?.get(key) || null
      const m = full || meta[c.name] || null
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
      const fxF = parseFeatureEffect(f, character, profBonus)
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

    // Species traits with action economy (Aasimar Healing Hands, …).
    for (const t of (character?.species?.__traits || [])) {
      const slot = detectActionSlot(t.entries)
      if (!slot) continue
      const fxT = parseFeatureEffect({ ...t, classId: null }, character, profBonus)
      b[slot].push({
        id: `race-${t.name}`,
        markerKey: `trait:${t.name}`,
        name: t.name,
        damage: '—', attack: '', range: '—', target: '—',
        kind: 'species',
        economySlot: slot,
        entries: t.entries || null,
        sub: 'Species',
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

  const tabs = [
    { id: 'action',      label: 'Action',       color: 'var(--accent-red)' },
    { id: 'bonusAction', label: 'Bonus Action', color: 'var(--accent-yellow)' },
    { id: 'reaction',    label: 'Reaction',     color: 'var(--accent-purple)' },
  ]
  if (hasted && buckets.hastedAction?.length > 0) {
    tabs.push({ id: 'hastedAction', label: 'Hasted Action', color: 'var(--accent-blue)' })
  }
  // If the currently-selected tab vanished (e.g. concentration on
  // Haste dropped while the player was on the Hasted tab), fall back
  // to Action so we never render against an empty bucket. Must stay
  // ABOVE any early return — total flips between 0 and >0 between
  // renders, and a hook below a conditional return triggers React #310.
  useEffect(() => {
    if (!tabs.some(t => t.id === tab)) setTab('action')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.map(t => t.id).join('|')])

  if (total === 0) return null
  const rows = buckets[tab] || []

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
              const n = buckets[t.id].length
              return (
                <button key={t.id} type="button" onClick={() => setTab(t.id)}
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
          {rows.length === 0 ? (
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
    </div>
  )
}
// Renders the explorer's row list as collapsible categories. Each
// `kind` becomes its own header; standard actions are consolidated
// into a single "Basic Actions" expandable; spells subdivide by
// level (Cantrip / Level 1 / …). All groups are open by default.
function CombatActionsCategorisedList({
  rows, expanded, setExpanded,
  slots, usedSlots, usedPact, castingFor, setCastingFor,
  castSpellFromExplorer, markActionUsed, consumeResource, applyRowSideEffects,
  character, applyCharacter,
}) {
  // Open/closed state per category id. Open by default — feels less
  // like a series of clicks to get going.
  const [closedCats, setClosedCats] = useState(() => new Set())
  const [basicOpen, setBasicOpen]   = useState(false)

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
    return out
  }, [rows, character])

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

                // Slot- oder Always- oder Uses-Pill oben — eine
                // Auswahl, keine Doppel-Anzeige.
                if (r.slotLabel) {
                  topPills.push(
                    <span key="slot" style={{
                      ...caePill,
                      border: `1px solid ${r.slotAvailable === false ? 'var(--text-dim)' : 'var(--accent-blue)'}`,
                      color: r.slotAvailable === false ? 'var(--text-dim)' : 'var(--accent-blue)',
                    }} title={`Spell Slots: ${r.slotLabel}`}>{r.slotLabel}</span>
                  )
                }
                if (r.badge === 'Always') {
                  topPills.push(
                    <span key="always" style={{
                      ...caePill,
                      border: '1px solid var(--accent-purple)',
                      color: 'var(--accent-purple)',
                    }} title="Immer vorbereitet">Always</span>
                  )
                }
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

                // Smart-Effect-Pills (Attack/Save/Damage) ins LEFT.
                if (Array.isArray(r.effectPills) && r.effectPills.length > 0) {
                  for (const p of r.effectPills) {
                    const color = p.kind === 'attack'
                      ? 'var(--accent-blue)'
                      : p.kind === 'save'
                        ? 'var(--accent-purple)'
                        : (p.damageType && DAMAGE_TYPE_COLOR[p.damageType]) || 'var(--accent-red)'
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
                if (r.damage && r.damage !== '—') leftPills.push(
                  <span key="dmg-legacy" style={{
                    ...caePill, border: '1px solid var(--accent-red)', color: 'var(--accent-red)',
                  }}>{r.damage}</span>
                )
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
                // Color-Marker: persistiert per rowMarkerKey →
                // `character.colorMarkers`. Stripe links wenn gesetzt,
                // Picker im Expanded-Body.
                const mKey = rowMarkerKey(r)
                const mColor = mKey ? getColorMarker(character, mKey) : null
                return (
                  <div key={r.id} style={{
                    ...caeRow,
                    ...(colorStripeStyle(mColor) || {}),
                    opacity: r.slotAvailable === false ? 0.55 : 1,
                  }}>
                    <div
                      style={{ ...caeRowHead, flexDirection: 'column', alignItems: 'stretch', gap: 3 }}
                      onClick={() => setExpanded(e => e === r.id ? null : r.id)}
                    >
                      {/* TOP ROW: chevron + name + top-pills + Use-Button */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>
                          {expanded === r.id ? '▼' : '▶'}
                        </span>
                        <span style={{ ...caeRowName, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.name}
                        </span>
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
                      <>
                        <ActionRowExpandedBody row={r} />
                        {mKey && applyCharacter && (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '4px 10px 6px',
                            borderTop: '1px solid var(--border-subtle)',
                          }}
                            onClick={(e) => e.stopPropagation()}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Farb-Tag:</span>
                              <CardColorPicker
                                color={mColor}
                                onChange={(c) => setColorMarker(applyCharacter, mKey, c)}
                                compact
                              />
                            </span>
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
      }} title="Spell wirken">{isOpen ? 'Cast ▴' : 'Cast ▾'}</button>
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
          <EntryRenderer entries={higherLevel} />
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
// Einheitliche kompakte Pill für Action-Rows (slot/atk/dmg/save/range/
// mastery/conc/ritual). Border + Farbe werden inline überschrieben.
const caePill = {
  display: 'inline-flex', alignItems: 'center',
  padding: '0 7px', borderRadius: 999,
  fontSize: 10, fontWeight: 700, lineHeight: '16px',
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
const colorFor = (t) => DMG_TYPE_COLOR[String(t).toLowerCase()] || 'var(--text-secondary)'

export function DamageResistancePills({ character, compact = false }) {
  const m = getMechanicalEffects(character)
  // Immunity is a stronger resistance — display in the same column,
  // pill carries an "immune" tooltip so the rule difference isn't
  // lost. Vulnerability stays its own column.
  const resSet = new Set([...m.damageResistance, ...m.damageImmunity])
  const vulSet = m.damageVulnerability
  if (resSet.size === 0 && vulSet.size === 0) return null

  const renderPills = (set, label, isImmune) => (
    <div style={compact ? drColCompact : drCol}>
      <div style={drColLabel}>{label}</div>
      <div style={compact ? drPillRowCompact : drPillRow}>
        {[...set].map(t => {
          const tn = String(t).toLowerCase()
          const immune = isImmune && m.damageImmunity.has(tn)
          const c = colorFor(t)
          return (
            <span key={t}
              title={immune ? `Immun gegen ${t}` : `Resistenz gegen ${t}`}
              style={{
                ...drPill,
                borderColor: c, color: c,
                background: `color-mix(in srgb, ${c} 15%, transparent)`,
                fontWeight: immune ? 700 : 600,
                // Immunity gets a small ⛒ glyph prefix so the player
                // can tell which entries are immunity vs resistance.
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
const drPill = {
  padding: '1px 7px', borderRadius: 999, fontSize: 10,
  border: '1px solid', textTransform: 'capitalize',
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
function FavoriteCard({ favKey, resolved, character, applyCharacter }) {
  const [open, setOpen] = useState(false)
  if (!resolved) return null
  const { title, badge, entries, html, fiveeLink } = resolved
  const hasBody = (Array.isArray(entries) && entries.length > 0) || (typeof html === 'string' && html.trim())
  return (
    <div style={favCard}>
      <div style={favCardHeader} onClick={() => hasBody && setOpen(o => !o)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
          <FavoriteToggle favKey={favKey} character={character} applyCharacter={applyCharacter} />
          <span style={favCardName}>{title}</span>
          {badge && <span style={favCardBadge}>{badge}</span>}
        </div>
        {hasBody && (
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
        )}
      </div>
      {open && hasBody && (
        <div style={favCardBody}>
          {entries
            ? <EntryRenderer entries={entries} />
            : <div dangerouslySetInnerHTML={{ __html: html }} />}
          {fiveeLink && (
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}
              onClick={(e) => e.stopPropagation()}>
              <FiveEToolsLink {...fiveeLink} edition={character?.meta?.edition} compact />
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

function FavoritesSection({ character, computed, applyCharacter }) {
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
    <Section title={`Favoriten${favs.length ? ` (${favs.length})` : ''}`}>
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

  // Categorise: Equipment (weapons/armor/shields) vs Loot (everything
  // else, plus auto-detected healing potions). Both lists are
  // collapsible — opens by default.
  const equipmentTiles = quickAccess
    .filter(it => it.isWeapon || it.isArmor || it.isShield)
    .map(it => ({ it, isPotion: false }))
  const lootTiles = [
    ...potions.map(p => ({ it: p, isPotion: true })),
    ...quickAccess
      .filter(it => !(it.isWeapon || it.isArmor || it.isShield))
      .map(it => ({ it, isPotion: false })),
  ]
  const tiles = [...equipmentTiles, ...lootTiles] // for the "empty" check

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
  const [open, setOpen] = useState(false)
  const qty = it.quantity || 0
  const isEquippable = !!(it.isWeapon || it.isArmor || it.isShield)
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
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 8px',
          minHeight: 22,
        }}
      >
        <div
          onClick={() => setOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            flex: 1, minWidth: 0, cursor: 'pointer',
          }}
        >
          <span style={{
            color: 'var(--text-dim)', fontSize: 10, lineHeight: 1,
            width: 10, textAlign: 'center', flexShrink: 0,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms',
          }}>▶</span>
          <HoverDetailTooltip content={tooltipContent}>
            <span style={{
              fontSize: 11, fontWeight: 600, color: 'var(--text-primary)',
              lineHeight: 1.3,
              // Lange Namen umbrechen statt abschneiden — auch
              // mehrwortige Magic-Item-Namen sollen voll lesbar sein.
              whiteSpace: 'normal', wordBreak: 'break-word',
            }}>
              {isPotion && '🧪 '}{it.customName || it.name}
            </span>
          </HoverDetailTooltip>
        </div>
        {isEquippable ? (
          <button
            type="button"
            onClick={onToggleEquip}
            title={equipped ? 'Klick: Ablegen' : 'Klick: Anlegen'}
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
              color: equipped ? 'var(--accent-green)' : 'var(--text-dim)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '0 2px', fontFamily: 'inherit', flexShrink: 0,
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
              fontSize: 11, fontWeight: 800,
              color: qty > 0 ? (isPotion ? 'var(--accent-red)' : 'var(--accent)') : 'var(--text-dim)',
              whiteSpace: 'nowrap', flexShrink: 0,
              background: 'transparent', border: 'none',
              padding: '0 2px', fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >×{qty}</button>
        )}
      </div>

      {open && (
        <div style={{
          padding: '6px 10px 8px 22px',         // 22px Indent für die Chevron-Spalte
          borderTop: '1px solid var(--border-subtle)',
          background: 'color-mix(in srgb, var(--bg-inset) 70%, transparent)',
          fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5,
          cursor: 'default',
        }}>
          {statBits.length > 0 && (
            <div style={{ marginBottom: 4, color: 'var(--text-muted)' }}>
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
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: 'var(--text-muted)' }}>Properties:</span>{' '}
              {propBits.join(', ')}
            </div>
          )}
          {hasEntries && (
            <div style={{ marginTop: 4 }}>
              <EntryRenderer entries={it.entries} />
            </div>
          )}
          {!hasEntries && hasDescription && (
            <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
              {it.description}
            </div>
          )}
        </div>
      )}
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
function FeaturesAndPreparedSpellsColumn({ character, computed, applyCharacter, updateCharacter }) {
  const { isPwaMobile } = usePwaMobile()
  const [expandedKey, setExpandedKey] = useState(null)
  const [openLevels, setOpenLevels] = useState(() => new Set([0, 1]))
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

  // Class-Abkürzungen für die Multiclass-Pills. Datengetrieben: nimm
  // den ersten Buchstaben jeder Klasse, bei Kollision (Wizard +
  // Warlock = beide W) auf 2 Buchstaben hoch — kein hardcoded
  // Klassen→Buchstabe-Mapping.
  const classAbbr = useMemo(() => {
    const ids = casterClasses.map(c => c.classId)
    for (let n = 1; n <= 4; n++) {
      const candidate = {}
      let collision = false
      for (const cid of ids) {
        const abbr = cid.slice(0, n).toUpperCase()
        if (candidate[abbr] && candidate[abbr] !== cid) { collision = true; break }
        candidate[abbr] = cid
      }
      if (!collision) {
        const out = {}
        for (const cid of ids) out[cid] = cid.slice(0, n).toUpperCase()
        return out
      }
    }
    const out = {}
    for (const cid of ids) out[cid] = cid.toUpperCase().slice(0, 4)
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
  //    Datenpfad: cls.levelChoices[lv].optionalFeatures[]. Gruppiert
  //    nach dem 5etools featureType-Label (Maneuver, Invocation,
  //    Metamagic, Fighting Style, Arcane Shot, …) — kein hardcoded
  //    Mapping pro Klasse, das Label kommt direkt aus FEATURE_TYPE_LABEL.
  const classPicks = useMemo(() => {
    const out = {}
    for (const cls of (character.classes || [])) {
      const map = {}
      for (const [lvStr, ch] of Object.entries(cls.levelChoices || {})) {
        const lv = parseInt(lvStr, 10) || 0
        for (const f of (ch.optionalFeatures || [])) {
          const ft = String(f.featureType || '').toUpperCase()
          const labelEntry = FEATURE_TYPE_LABEL[ft]
          const label = labelEntry?.label || ft || 'Other'
          if (!map[label]) map[label] = []
          map[label].push({
            name: f.name,
            source: f.source,
            level: lv,
            featureType: ft,
          })
        }
      }
      if (Object.keys(map).length > 0) out[cls.classId] = map
    }
    return out
  }, [character.classes])

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
          Spells
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
  character, applyCharacter,
}) {
  // Color-Marker fuer den Spell — gleicher Key wie in der Action-
  // Spalte UND wie favoriteKey('spell', name) damit der gleiche
  // Farb-Tag bei Spells-Spalte, Action-Spalte und Features-Tab
  // synchron läuft. KEIN lowercase — favoriteKey ist case-preserving.
  const mKey = `spell:${row.spell?.name || row.key || ''}`
  const mColor = getColorMarker(character, mKey)
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

  // Multiclass-Modus: wenn mehr als eine Caster-Klasse diesen Spell
  // preparen darf, zeige Per-Klasse-Pills statt des einzelnen Dots.
  // Mutually exclusive — eine Klasse hat den Slot, Klick auf andere
  // Pille verschiebt ihn dorthin. Cantrips & Always-Prepared rendern
  // weiterhin den Single-Dot (kein Prep-Toggle nötig / sinnvoll).
  const eligiblePrepClasses = canToggle
    ? casterClasses.filter(c => c.info?.type === 'prepared' && row.knownByClass?.has(c.classId))
    : []
  const showMulticlassPills = eligiblePrepClasses.length > 1

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
              dotKind === 'always' ? 'Always Prepared'
              : isCantrip ? 'Cantrip — always available'
              : dotKind === 'on' ? 'Prepared (klick zum Unpreparen)'
              : 'Nicht prepared (klick zum Preparen)'
            }
            style={prepDot(dotKind, canToggle)}
          >{dotKind === 'on' ? '●' : dotKind === 'always' ? '◆' : '○'}</button>
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
                  title={active
                    ? `Prepared via ${cid} — klick zum Unpreparen`
                    : `Prepare via ${cid}`}
                  style={classPillStyle(active)}
                >{abbr}</button>
              )
            })}
          </div>
        )}

        <span
          onClick={onExpand}
          style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}
        >
          {sp.name}
        </span>

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
          {applyCharacter && (
            <div
              style={{
                marginTop: 8, display: 'flex', alignItems: 'center', gap: 6,
                paddingTop: 6, borderTop: '1px solid var(--border-subtle)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Farb-Tag:</span>
              <CardColorPicker
                color={mColor}
                onChange={(c) => setColorMarker(applyCharacter, mKey, c)}
                compact
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

// ── Class-Pick-Kategorie (Maneuvers / Invocations / Metamagic / …) ─
// Eine Klapp-Kategorie pro featureType-Label. Items werden so
// kompakt wie Spell-Rows gerendert: linker Marker + Name + (im
// 'All'-Tab) ein Klassen-Badge rechts. Klick öffnet ein Sub-Panel
// mit der vollen Entry-Beschreibung aus optionalfeatures.json.
function ClassPickCategory({ label, items, optFeatMap, showClassBadge, classAbbr, headerExtras }) {
  const [open, setOpen] = useState(true)
  const [expandedKey, setExpandedKey] = useState(null)
  if (!items || items.length === 0) return null
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
              }}
            >
              <span style={{ color: 'var(--text-dim)', fontSize: 10, width: 10, textAlign: 'center' }}>
                {hasEntries ? (expanded ? '▼' : '▶') : '·'}
              </span>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                {it.name}
              </span>
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
function classPillStyle(active) {
  return {
    minWidth: 18, height: 18, padding: '0 4px',
    borderRadius: 9, border: '1.5px solid var(--accent-green)',
    background: active ? 'var(--accent-green)' : 'transparent',
    color: active ? 'var(--bg-base, #111)' : 'var(--text-dim)',
    cursor: 'pointer', fontSize: 10, fontWeight: 800,
    lineHeight: 1, fontFamily: 'inherit',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    borderColor: active ? 'var(--accent-green)' : 'var(--text-dim)',
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
    fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
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
  const slots = [
    { id: 'action',      label: 'Action',       color: 'var(--accent-red)' },
    { id: 'bonusAction', label: 'Bonus Action', color: 'var(--accent-yellow)' },
    { id: 'reaction',    label: 'Reaction',     color: 'var(--accent-purple)' },
  ]
  if (value?.surgeActive) {
    slots.push({ id: 'surgeAction', label: 'Action Surge', color: 'var(--accent-orange, #ff9533)' })
  }
  if (hasted) {
    slots.push({ id: 'hastedAction', label: 'Hasted Action', color: 'var(--accent-blue)' })
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
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {slots.map(s => {
        const used = !!value?.[s.id]
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => toggle(s.id)}
            title={used ? `${s.label} bereits verwendet — klicken zum Zurücksetzen` : `${s.label} verfügbar — klicken zum Markieren als verwendet`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 999, cursor: 'pointer',
              border: `1.5px solid ${used ? 'var(--text-dim)' : s.color}`,
              background: used ? 'transparent' : `color-mix(in srgb, ${s.color} 18%, transparent)`,
              color: used ? 'var(--text-dim)' : s.color,
              fontSize: 12, fontWeight: 600,
              textDecoration: used ? 'line-through' : 'none',
              opacity: used ? 0.7 : 1,
              fontFamily: 'inherit',
            }}
          >
            {used ? '✓' : '○'} {s.label}
          </button>
        )
      })}
      <button
        type="button"
        onClick={reset}
        disabled={!anyUsed}
        title="Alle drei zurücksetzen — neue Runde."
        style={{
          marginLeft: 'auto', padding: '4px 12px', borderRadius: 999,
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
