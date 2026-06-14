// PopoutStatBar.jsx
//
// Ultra-kompakte VTT-Overlay-Bar für das Popout-Sheet. Trägt:
//
//   • Drag-Handle (data-tauri-drag-region) auf dem ganzen Container
//   • Close-Button (× rechts oben)
//   • HP-Pille + Damage/Heal-Input (triggert Concentration-Save)
//   • AC · Init · Spd · PP Stat-Tiles
//   • Ability Scores (STR/DEX/CON/INT/WIS/CHA) mit Saving-Throw-Mods
//   • Gold + Class Resources (kompakte Abkürzungen + Counter)
//   • Conditions-Chips · Concentration · Inspiration · Action-Economy
//   • [▾ Skills & Profs]-Overlay-Toggle
//   • Bottom-Nav (4 Tabs: Default / Spells / Favs / Mastery)
//
// Adaptiert sich an `size` (L/M/S/XS) — bei kleiner Popout-Größe rutschen
// Stats in eigene Zeilen statt zu kürzen.

import { useState } from 'react'
import { getModifier } from '../../lib/characterModel'

// Tauri-Drag: manuelle startDragging-Aufruf damit das Fenster auf
// JEDEM mousedown des Drag-Handles bewegt wird — `data-tauri-drag-region`
// allein hängt sich gelegentlich auf wenn der Webview Drag-Events nicht
// korrekt propagiert. Wir kombinieren beides: Attribut für das Standard-
// Verhalten + Fallback-Listener für portable Robustheit.
async function startTauriDrag() {
  try {
    if (typeof window === 'undefined') return
    if (!('__TAURI_INTERNALS__' in window) && !('__TAURI__' in window)) return
    const mod = await import('@tauri-apps/api/window')
    const win = mod.getCurrentWindow ? mod.getCurrentWindow() : null
    if (win?.startDragging) await win.startDragging()
  } catch { /* ignore — fallback ist das Attribut */ }
}

const C_RED    = 'var(--accent-red, #f7768e)'
const C_GREEN  = 'var(--accent-green, #9ece6a)'
const C_BLUE   = 'var(--accent-blue, #7aa2f7)'
const C_YELLOW = 'var(--accent-yellow, #e0af68)'
const C_PURPLE = 'var(--accent-purple, #b07afe)'
const C_CYAN   = 'var(--accent-cyan, #4dd0e1)'
const C_ORANGE = 'var(--accent-orange, #ff9533)'
const C_TEXT   = 'var(--text-primary, #e6e8ee)'
const C_MUTED  = 'var(--text-muted, #9aa3b4)'
const C_DIM    = 'var(--text-dim, #6b7386)'
const C_BORDER = 'var(--border, #2a3040)'

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha']

export default function PopoutStatBar({
  character, computed, abilityScores, hp,
  size, updateCharacter, applyCharacter,
  onOpenConditions: _onOpenConditions,  // jetzt nicht mehr genutzt — Conditions im Body
  onClose,
  activeTab = 'default', onTabChange,
  readOnly = false,
}) {
  const [skillsOpen, setSkillsOpen] = useState(false)
  const isXS = size === 'XS'

  const conc = character?.status?.concentration
  const concName = conc?.spell || conc?.name
  const deathSaves = character?.status?.deathSaves || { successes: 0, failures: 0 }
  const economy = character?.status?.economy || {}
  const inspiration = !!(character?.status?.inspiration || character?.info?.inspiration)
  const portrait = character?.appearance?.portrait

  const ac = computed?.ac?.total ?? 10
  const init = computed?.initiative ?? getModifier(abilityScores?.dex || 10)
  const sp = computed?.speed || { walk: character?.species?.speed ?? 30 }
  const pp = computed?.passivePerception ?? 10

  const profBonus = computed?.profBonus
    ?? (Math.ceil((character?.classes || []).reduce((s, c) => s + (c.level || 0), 0) / 4) + 1)
  const saves = computed?.savingThrows || {}
  const resources = computed?.resources || []
  const currency = character?.inventory?.currency || {}
  const goldTotal = (() => {
    const cp = currency.cp || 0
    const spc = currency.sp || 0
    const ep = currency.ep || 0
    const gp = currency.gp || 0
    const ppc = currency.pp || 0
    return gp + spc / 10 + cp / 100 + ep * 5 / 10 + ppc * 10
  })()

  const usedResources = character?.status?.usedResources || {}
  const showDeathSaves = hp.current <= 0 || deathSaves.successes > 0 || deathSaves.failures > 0
  const hpPct = hp.max > 0 ? Math.max(0, Math.min(100, (hp.current / hp.max) * 100)) : 0
  const hpColor = hp.current <= 0 ? C_RED
    : hpPct < 25 ? C_RED
    : hpPct < 50 ? C_YELLOW : C_GREEN

  const toggleEconomy = (k) => () => {
    applyCharacter?.(d => {
      if (!d.status) d.status = {}
      if (!d.status.economy) d.status.economy = {}
      d.status.economy[k] = !d.status.economy[k]
    })
  }
  const newRound = () => {
    applyCharacter?.(d => {
      if (!d.status) d.status = {}
      d.status.economy = { action: false, bonusAction: false, reaction: false }
    })
  }
  const toggleInspiration = () => updateCharacter?.('status.inspiration', !inspiration)

  // Drag-Mousedown handler — startet Tauri-Window-Drag direkt. Wird auf
  // Portrait, Namens-Slot und freie Bereichen der Bar gebunden.
  const onDragMouseDown = (e) => {
    // Nur Hauptmausetaste; interaktive Elemente ignorieren
    if (e.button !== 0) return
    if (e.target.closest('button, input, select, textarea, a')) return
    startTauriDrag()
  }

  const statPill = (label, value, color, title) => (
    <div style={{ ...s.stat, borderColor: color }} title={title}>
      <span style={{ ...s.statLbl, color }}>{label}</span>
      <span style={s.statVal}>{value}</span>
    </div>
  )

  return (
    <div
      data-tauri-drag-region
      onMouseDown={onDragMouseDown}
      style={s.bar}
      data-popout-size={size}
    >
      {/* === Zeile 1: Portrait (Drag-Handle) + Name + HP + DMG + Stats + Close === */}
      <div style={s.row} data-tauri-drag-region onMouseDown={onDragMouseDown}>
        {/* Portrait — eigene Drag-Surface. Klick + Halt = Fenster verschieben.
            Falls kein Portrait gesetzt, generischer Drag-Anker mit Initialen. */}
        <div data-tauri-drag-region onMouseDown={onDragMouseDown}
          style={s.portraitSlot} title="Drag = Fenster verschieben">
          {portrait ? (
            <img src={portrait} alt="" style={s.portraitImg} draggable={false} />
          ) : (
            <div style={s.portraitPlaceholder}>
              {(character?.info?.name || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div data-tauri-drag-region onMouseDown={onDragMouseDown}
          style={s.nameSlot} title="Drag = Fenster verschieben">
          <div style={s.nameTxt}>{character?.info?.name || 'Char'}</div>
          <div style={s.nameSub}>
            {(character?.classes || []).map(c => `${c.classId} ${c.level}`).join(' / ')}
          </div>
        </div>
        <HpInline hp={hp} hpColor={hpColor} hpPct={hpPct} />
        {!readOnly && <HpEditInput hp={hp} applyCharacter={applyCharacter} />}
        <div style={s.statGroup}>
          {statPill('AC',   ac,                C_BLUE,   `Armor Class ${ac}`)}
          {statPill('Init', fmtMod(init),      C_YELLOW, `Initiative ${fmtMod(init)}`)}
          {statPill('Spd',  sp.walk,           C_CYAN,   `Walk ${sp.walk} ft.`)}
          {!isXS && statPill('PP', pp,         C_MUTED,  `Passive Perception ${pp}`)}
          {!isXS && statPill('PB', fmtMod(profBonus), C_MUTED, `Proficiency Bonus ${fmtMod(profBonus)}`)}
        </div>
        <div style={s.spacer} data-tauri-drag-region onMouseDown={onDragMouseDown} />
        <button type="button" onClick={onClose} style={s.closeBtn}
          title="Popout schließen" aria-label="Popout schließen">×</button>
      </div>

      {/* === Zeile 2: Ability Scores + Saves === */}
      <div style={s.row} data-tauri-drag-region onMouseDown={onDragMouseDown}>
        {ABILITIES.map(ab => {
          const score = (abilityScores && abilityScores[ab]) ?? 10
          const mod = getModifier(score)
          const saveProf = saves[ab]?.proficient || saves[ab]?.expertise
          const saveBonus = saveProf ? mod + profBonus : mod
          return (
            <div key={ab} style={s.ab}
              title={`${ab.toUpperCase()} ${score} (${fmtMod(mod)})${saveProf ? ' · Save proficient' : ''}`}>
              <span style={s.abName}>{ab.toUpperCase()}</span>
              <span style={s.abScore}>{score}</span>
              <span style={s.abMod}>{fmtMod(mod)}</span>
              <span style={{ ...s.abSave, color: saveProf ? C_GREEN : C_DIM }}>
                {saveProf ? '●' : '○'} {fmtMod(saveBonus)}
              </span>
            </div>
          )
        })}
        <div style={s.spacer} data-tauri-drag-region onMouseDown={onDragMouseDown} />
        <button type="button" onClick={() => setSkillsOpen(o => !o)}
          style={skillsOpen ? s.skillsBtnOn : s.skillsBtn}
          title="Skills & Proficiencies anzeigen">
          {skillsOpen ? '▴' : '▾'} Skills
        </button>
      </div>

      {/* === Zeile 3: Gold + Resources + Conc + Insp + Economy === */}
      <div style={s.row} data-tauri-drag-region onMouseDown={onDragMouseDown}>
        {goldTotal > 0 && (
          <div style={s.gold}
            title={`${currency.pp || 0}pp · ${currency.gp || 0}gp · ${currency.ep || 0}ep · ${currency.sp || 0}sp · ${currency.cp || 0}cp`}>
            <span style={s.goldIcon}>◯</span>
            <span style={s.goldVal}>{Math.floor(goldTotal)}</span>
            <span style={s.goldLbl}>gp</span>
          </div>
        )}
        {resources.length > 0 && (
          <div style={s.resGroup}>
            {resources.map((res, i) => {
              const used = usedResources[res.id] || 0
              const remaining = Math.max(0, (res.max || 0) - used)
              const abbr = shortName(res.name)
              return (
                <div key={res.id || i} style={s.resPill}
                  title={`${res.name}: ${remaining}/${res.max}${res.recharge ? ` · regains ${res.recharge}` : ''}`}>
                  <span style={s.resLbl}>{abbr}</span>
                  <span style={s.resVal}>{remaining}/{res.max}</span>
                </div>
              )
            })}
          </div>
        )}
        {concName && (
          <button type="button" style={s.conc}
            title={`Konzentration: ${concName} — Klick zum Beenden`}
            onClick={() => updateCharacter?.('status.concentration', null)}>
            ◎ {isXS ? '' : concName}
          </button>
        )}
        <div style={s.spacer} data-tauri-drag-region onMouseDown={onDragMouseDown} />
        <button type="button" onClick={toggleInspiration}
          title={inspiration ? 'Inspiration — Klick: verbrauchen' : 'Inspiration aktivieren'}
          style={inspiration ? s.inspOn : s.inspOff}>◆ Insp</button>
        <div style={s.econGroup}>
          <button type="button" onClick={toggleEconomy('action')}
            style={economy.action ? s.econOn : s.econOff} title="Action">A</button>
          <button type="button" onClick={toggleEconomy('bonusAction')}
            style={economy.bonusAction ? s.econOn : s.econOff} title="Bonus Action">BA</button>
          <button type="button" onClick={toggleEconomy('reaction')}
            style={economy.reaction ? s.econOn : s.econOff} title="Reaction">R</button>
          <button type="button" onClick={newRound} style={s.roundBtn} title="Neue Runde">↻</button>
        </div>
      </div>

      {/* === Zeile 4 (conditional): Death Saves === */}
      {showDeathSaves && (
        <div style={s.row} data-tauri-drag-region onMouseDown={onDragMouseDown}>
          <span style={s.dsLabel}>Death</span>
          <Pips count={3} filled={deathSaves.successes} color={C_GREEN}
            onSet={n => updateCharacter?.('status.deathSaves', { ...deathSaves, successes: n })} />
          <Pips count={3} filled={deathSaves.failures} color={C_RED}
            onSet={n => updateCharacter?.('status.deathSaves', { ...deathSaves, failures: n })} />
        </div>
      )}

      {skillsOpen && (
        <SkillsOverlay
          computed={computed}
          abilityScores={abilityScores}
          profBonus={profBonus}
          onClose={() => setSkillsOpen(false)}
        />
      )}

      <PopoutBottomNav activeTab={activeTab} onTabChange={onTabChange} />
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────

function HpInline({ hp, hpColor, hpPct }) {
  return (
    <div style={s.hpInline} title="Hit Points">
      <div style={s.hpLine}>
        <span style={{ ...s.statLbl, color: hpColor }}>HP</span>
        <span style={{ ...s.hpVal, color: hpColor }}>{hp.current}</span>
        <span style={s.hpMax}>/{hp.max}</span>
        {hp.temporary > 0 && <span style={s.tempHp}>+{hp.temporary}</span>}
      </div>
      <div style={s.hpTrack}>
        <div style={{ ...s.hpFill, width: `${hpPct}%`, background: hpColor }} />
      </div>
    </div>
  )
}

function HpEditInput({ hp, applyCharacter, compact }) {
  const [amount, setAmount] = useState('')
  const apply = (sign) => {
    const n = Math.max(0, parseInt(amount, 10) || 0)
    if (n <= 0) return
    if (sign < 0) {
      applyCharacter?.(d => {
        if (!d.status) d.status = {}
        let dmg = n
        let t = d.status.temporaryHp || 0
        if (t > 0) { const a = Math.min(t, dmg); t -= a; dmg -= a; d.status.temporaryHp = t }
        const cur = d.status.currentHp ?? hp.max
        d.status.currentHp = Math.max(0, cur - dmg)
      }, { changedPaths: ['status.temporaryHp', 'status.currentHp'] })
    } else {
      applyCharacter?.(d => {
        if (!d.status) d.status = {}
        const cur = d.status.currentHp ?? hp.max
        d.status.currentHp = Math.min(hp.max, cur + n)
      }, { changedPaths: ['status.currentHp'] })
    }
    setAmount('')
  }
  return (
    <div style={s.editGroup} data-tauri-drag-region="false">
      <button type="button" onClick={() => apply(-1)} disabled={!amount}
        style={amount ? s.dmgBtnActive : s.dmgBtn}
        title="Schaden anwenden (triggert Concentration-Save)">−</button>
      <input type="number" min="0" value={amount}
        onChange={e => setAmount(e.target.value)}
        onFocus={e => e.target.select()}
        onKeyDown={e => {
          if (e.key === 'Enter') apply(+1)
          if (e.key === 'Escape') setAmount('')
        }}
        placeholder={compact ? '' : '±'}
        style={s.editInput}
        title="Zahl, dann − oder + (Enter = heilen)" />
      <button type="button" onClick={() => apply(+1)} disabled={!amount}
        style={amount ? s.healBtnActive : s.healBtn}
        title="Heilung anwenden">+</button>
    </div>
  )
}

function Pips({ count, filled, color, onSet }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
      data-tauri-drag-region="false">
      {[...Array(count)].map((_, i) => {
        const on = i < filled
        return (
          <button key={i} type="button"
            onClick={() => onSet(on && i === filled - 1 ? i : i + 1)}
            style={{
              width: 11, height: 11, borderRadius: '50%',
              background: on ? color : 'transparent',
              border: `1.5px solid ${color}`,
              cursor: 'pointer', padding: 0,
            }}
          />
        )
      })}
    </div>
  )
}

function SkillsOverlay({ computed, abilityScores, profBonus, onClose }) {
  // 5e Skill-Liste — Ability + Skill-Name
  const SKILLS = [
    ['acrobatics', 'dex'], ['animal handling', 'wis'], ['arcana', 'int'],
    ['athletics', 'str'], ['deception', 'cha'], ['history', 'int'],
    ['insight', 'wis'], ['intimidation', 'cha'], ['investigation', 'int'],
    ['medicine', 'wis'], ['nature', 'int'], ['perception', 'wis'],
    ['performance', 'cha'], ['persuasion', 'cha'], ['religion', 'int'],
    ['sleight of hand', 'dex'], ['stealth', 'dex'], ['survival', 'wis'],
  ]
  const skillProfs = computed?.skills || {}
  const tools = Object.keys(computed?.proficiencies?.tools || {})
  const langs = computed?.proficiencies?.languages || []
  const weapons = computed?.proficiencies?.weapons || []
  const armor = computed?.proficiencies?.armor || []

  return (
    <div style={s.overlay} data-tauri-drag-region="false" onClick={onClose}>
      <div style={s.overlayCard} onClick={e => e.stopPropagation()}>
        <div style={s.overlayHead}>
          <span style={s.overlayTitle}>Skills & Proficiencies</span>
          <button type="button" onClick={onClose} style={s.overlayClose}>×</button>
        </div>
        {/* Skills */}
        <div style={s.skillsGrid}>
          {SKILLS.map(([name, ab]) => {
            const prof = skillProfs[name]
            const mod = getModifier(abilityScores?.[ab] ?? 10)
            const bonus = prof === 'expertise' ? mod + profBonus * 2
              : prof === 'proficient' || prof === 'half' ? mod + (prof === 'half' ? Math.floor(profBonus / 2) : profBonus)
              : mod
            return (
              <div key={name} style={s.skillRow}>
                <span style={{
                  ...s.skillDot,
                  background: prof === 'expertise' ? C_YELLOW
                    : prof === 'proficient' ? C_GREEN
                    : prof === 'half' ? C_BLUE
                    : 'transparent',
                  borderColor: prof ? 'transparent' : C_BORDER,
                }} />
                <span style={s.skillAb}>{ab.slice(0, 3).toUpperCase()}</span>
                <span style={s.skillName}>{name.replace(/\b\w/g, c => c.toUpperCase())}</span>
                <span style={s.skillBonus}>{fmtMod(bonus)}</span>
              </div>
            )
          })}
        </div>
        {/* Proficiencies */}
        <div style={s.profsBlock}>
          {tools.length > 0 && <ProfRow label="Tools" items={tools} />}
          {langs.length > 0 && <ProfRow label="Languages" items={langs} />}
          {weapons.length > 0 && <ProfRow label="Weapons" items={weapons} />}
          {armor.length > 0 && <ProfRow label="Armor" items={armor} />}
        </div>
      </div>
    </div>
  )
}

function ProfRow({ label, items }) {
  return (
    <div style={s.profRow}>
      <span style={s.profLbl}>{label}</span>
      <span style={s.profItems}>{items.join(' · ')}</span>
    </div>
  )
}

function PopoutBottomNav({ activeTab, onTabChange }) {
  const tabs = [
    { id: 'default', icon: '⚔', label: 'Combat' },
    { id: 'spells',  icon: '✦', label: 'Spells' },
    { id: 'favs',    icon: '★', label: 'Favs' },
    { id: 'mastery', icon: '🛡', label: 'Mastery+Res' },
  ]
  return (
    <div style={s.bottomNav} data-tauri-drag-region="false">
      {tabs.map(t => {
        const active = activeTab === t.id
        return (
          <button key={t.id} type="button"
            onClick={() => onTabChange?.(t.id)}
            style={active ? s.navBtnOn : s.navBtnOff}>
            <span style={s.navIcon}>{t.icon}</span>
            <span style={s.navLbl}>{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function shortName(name) {
  // Abkürzung für Resource-Namen: "Ki Points" → "KI", "Bardic Inspiration" → "BI"
  if (!name) return '?'
  const words = String(name).split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words.map(w => w[0]).join('').toUpperCase().slice(0, 4)
}

function fmtMod(n) {
  const v = Number(n) || 0
  return (v >= 0 ? '+' : '') + v
}

// ── Styles ───────────────────────────────────────────────────
const s = {
  bar: {
    display: 'flex', flexDirection: 'column',
    padding: '6px 8px', marginBottom: 4, gap: 5,
    background: 'linear-gradient(180deg, var(--bg-elevated,#1b1f28) 0%, var(--bg-card,#161922) 100%)',
    border: `1px solid ${C_BORDER}`,
    borderRadius: 8,
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    position: 'relative',
    userSelect: 'none',
  },
  row: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minHeight: 28 },
  spacer: { flex: '1 1 auto', alignSelf: 'stretch', minWidth: 4 },

  // Portrait Drag-Handle (links). Bei kein-Bild Fallback auf Initialen.
  portraitSlot: {
    flex: '0 0 auto', width: 38, height: 38,
    borderRadius: 6, overflow: 'hidden',
    border: `1px solid ${C_BORDER}`,
    cursor: 'move', background: '#0f1115',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  portraitImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' },
  portraitPlaceholder: {
    color: C_MUTED, fontSize: 16, fontWeight: 700,
    fontFamily: 'inherit', userSelect: 'none', pointerEvents: 'none',
  },

  nameSlot: {
    display: 'flex', flexDirection: 'column', minWidth: 100, cursor: 'move',
    paddingRight: 6, borderRight: `1px solid ${C_BORDER}`,
  },
  nameTxt: { fontSize: 13, fontWeight: 700, color: C_TEXT, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  nameSub: { fontSize: 10, color: C_DIM, lineHeight: 1.2, whiteSpace: 'nowrap' },

  closeBtn: {
    width: 26, height: 26, padding: 0, lineHeight: 1, fontSize: 18,
    background: 'transparent', color: C_MUTED,
    border: `1px solid ${C_BORDER}`, borderRadius: 5,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  statLbl: { fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4 },
  statVal: { fontSize: 14, fontWeight: 800, color: C_TEXT, lineHeight: 1 },

  hpInline: {
    display: 'flex', flexDirection: 'column', gap: 3,
    padding: '4px 9px', borderRadius: 6,
    background: 'var(--bg-card,#1d212a)',
    border: `1px solid ${C_BORDER}`,
    minWidth: 100,
  },
  hpLine: { display: 'flex', alignItems: 'baseline', gap: 4 },
  hpVal: { fontSize: 17, fontWeight: 800, lineHeight: 1 },
  hpMax: { fontSize: 12, color: C_MUTED },
  tempHp: { marginLeft: 4, fontSize: 11, fontWeight: 700, color: C_GREEN },
  hpTrack: { height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  hpFill: { height: '100%', transition: 'width 200ms ease' },

  statGroup: { display: 'inline-flex', gap: 3, flexWrap: 'wrap' },
  stat: {
    display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
    padding: '3px 8px', minWidth: 40,
    background: 'var(--bg-card,#1d212a)',
    border: '1px solid transparent', borderRadius: 5,
    lineHeight: 1.1,
  },

  // Ability scores (with save mods)
  ab: {
    display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
    padding: '3px 7px', minWidth: 52,
    background: 'var(--bg-card,#1d212a)',
    border: `1px solid ${C_BORDER}`, borderRadius: 5,
    lineHeight: 1.15,
  },
  abName: { fontSize: 9, fontWeight: 800, color: C_MUTED, textTransform: 'uppercase', letterSpacing: 0.4 },
  abScore: { fontSize: 13, fontWeight: 700, color: C_TEXT },
  abMod: { fontSize: 11, color: C_TEXT, fontWeight: 600 },
  abSave: { fontSize: 10, fontWeight: 700, marginTop: 1, whiteSpace: 'nowrap' },

  skillsBtn: {
    padding: '4px 11px', fontSize: 11, fontWeight: 700,
    background: 'transparent', color: C_MUTED,
    border: `1px solid ${C_BORDER}`, borderRadius: 5,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  skillsBtnOn: {
    padding: '4px 11px', fontSize: 11, fontWeight: 700,
    background: `${C_BLUE}22`, color: C_BLUE,
    border: `1px solid ${C_BLUE}`, borderRadius: 5,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Gold / Resources
  gold: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 10px', borderRadius: 5,
    background: `${C_YELLOW}15`, border: `1px solid ${C_YELLOW}`,
  },
  goldIcon: { fontSize: 11, color: C_YELLOW },
  goldVal: { fontSize: 12, fontWeight: 800, color: C_TEXT },
  goldLbl: { fontSize: 10, color: C_YELLOW, fontWeight: 700 },

  resGroup: { display: 'inline-flex', gap: 4, flexWrap: 'wrap' },
  resPill: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '3px 8px', borderRadius: 5,
    background: `${C_ORANGE}15`, border: `1px solid ${C_ORANGE}`,
  },
  resLbl: { fontSize: 9.5, fontWeight: 800, color: C_ORANGE, textTransform: 'uppercase', letterSpacing: 0.4 },
  resVal: { fontSize: 11, fontWeight: 700, color: C_TEXT },

  conc: {
    padding: '3px 9px', fontSize: 11, fontWeight: 700,
    background: `${C_PURPLE}22`, color: C_PURPLE,
    border: `1px solid ${C_PURPLE}`, borderRadius: 5,
    cursor: 'pointer', fontFamily: 'inherit', maxWidth: 150,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },

  inspOn: {
    padding: '3px 9px', fontSize: 11, fontWeight: 700,
    background: `${C_YELLOW}22`, color: C_YELLOW,
    border: `1px solid ${C_YELLOW}`, borderRadius: 5,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  inspOff: {
    padding: '3px 9px', fontSize: 11, fontWeight: 700,
    background: 'transparent', color: C_DIM,
    border: `1px solid ${C_BORDER}`, borderRadius: 5,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  econGroup: { display: 'inline-flex', gap: 3 },
  econOn: {
    padding: '3px 9px', fontSize: 11, fontWeight: 800,
    background: `${C_GREEN}22`, color: C_GREEN,
    border: `1px solid ${C_GREEN}`, borderRadius: 5,
    cursor: 'pointer', fontFamily: 'inherit',
    textDecoration: 'line-through', opacity: 0.8,
  },
  econOff: {
    padding: '3px 9px', fontSize: 11, fontWeight: 800,
    background: 'transparent', color: C_TEXT,
    border: `1px solid ${C_BORDER}`, borderRadius: 5,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  roundBtn: {
    padding: '3px 9px', fontSize: 12, fontWeight: 700,
    background: 'transparent', color: C_CYAN,
    border: `1px solid ${C_CYAN}`, borderRadius: 5,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  dsLabel: { fontSize: 10, fontWeight: 700, color: C_MUTED, textTransform: 'uppercase', letterSpacing: 0.4 },

  // DMG / Heal input
  editGroup: {
    display: 'inline-flex', alignItems: 'center',
    background: 'var(--bg-card,#1d212a)',
    border: `1px solid ${C_BORDER}`,
    borderRadius: 5, overflow: 'hidden', height: 28,
  },
  editInput: {
    width: 52, padding: '3px 6px', fontSize: 13, fontWeight: 700,
    background: 'transparent', color: C_TEXT,
    border: 'none', borderLeft: `1px solid ${C_BORDER}`, borderRight: `1px solid ${C_BORDER}`,
    textAlign: 'center', fontFamily: 'inherit', outline: 'none',
  },
  dmgBtn: {
    padding: '3px 10px', fontSize: 15, fontWeight: 800, lineHeight: 1,
    background: 'transparent', color: C_DIM, border: 'none',
    cursor: 'not-allowed', fontFamily: 'inherit',
  },
  dmgBtnActive: {
    padding: '3px 10px', fontSize: 15, fontWeight: 800, lineHeight: 1,
    background: `${C_RED}22`, color: C_RED, border: 'none',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  healBtn: {
    padding: '3px 10px', fontSize: 15, fontWeight: 800, lineHeight: 1,
    background: 'transparent', color: C_DIM, border: 'none',
    cursor: 'not-allowed', fontFamily: 'inherit',
  },
  healBtnActive: {
    padding: '3px 10px', fontSize: 15, fontWeight: 800, lineHeight: 1,
    background: `${C_GREEN}22`, color: C_GREEN, border: 'none',
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Skills/Profs Overlay
  overlay: {
    position: 'absolute', top: '100%', left: 0, right: 0,
    background: 'rgba(0,0,0,0.6)', zIndex: 50,
    padding: 4,
  },
  overlayCard: {
    background: 'var(--bg-elevated,#1b1f28)',
    border: `1px solid ${C_BORDER}`, borderRadius: 8,
    padding: 8, maxHeight: '60vh', overflowY: 'auto',
    boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
  },
  overlayHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${C_BORDER}`,
  },
  overlayTitle: { fontSize: 11, fontWeight: 700, color: C_TEXT, textTransform: 'uppercase', letterSpacing: 0.4 },
  overlayClose: {
    width: 22, height: 22, padding: 0, fontSize: 14, lineHeight: 1,
    background: 'transparent', color: C_MUTED,
    border: `1px solid ${C_BORDER}`, borderRadius: 4,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  skillsGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '2px 8px', marginBottom: 6,
  },
  skillRow: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 },
  skillDot: {
    width: 8, height: 8, borderRadius: '50%', border: `1px solid ${C_BORDER}`,
    flex: '0 0 8px',
  },
  skillAb: { fontSize: 8, fontWeight: 700, color: C_DIM, width: 22 },
  skillName: { flex: 1, color: C_TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  skillBonus: { fontSize: 10, fontWeight: 800, color: C_TEXT, marginLeft: 4 },

  profsBlock: { display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 4, borderTop: `1px solid ${C_BORDER}` },
  profRow: { display: 'flex', gap: 6, fontSize: 10, alignItems: 'baseline' },
  profLbl: { fontSize: 8.5, fontWeight: 800, color: C_MUTED, textTransform: 'uppercase', minWidth: 60 },
  profItems: { color: C_TEXT },

  // Bottom Nav
  bottomNav: {
    display: 'flex', gap: 3,
    marginTop: 6, padding: '4px 2px 0 2px',
    borderTop: `1px solid ${C_BORDER}`,
  },
  navBtnOn: {
    flex: 1,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    padding: '6px 10px', fontSize: 11, fontWeight: 700,
    background: `${C_BLUE}22`, color: C_BLUE,
    border: `1px solid ${C_BLUE}`, borderRadius: 6,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  navBtnOff: {
    flex: 1,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    padding: '6px 10px', fontSize: 11, fontWeight: 700,
    background: 'transparent', color: C_MUTED,
    border: `1px solid ${C_BORDER}`, borderRadius: 6,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  navIcon: { fontSize: 13 },
  navLbl: { fontSize: 10.5 },
}
