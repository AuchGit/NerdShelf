// components/sheet/OverviewTab.jsx
// At-a-glance play view: identity is compressed to a single strip; the
// HP block, combat stat tiles, conditions, concentration tracker,
// attacks, spellcasting and class resources are the prominent things.
// Class details and level history are tucked away because they don't
// change during a session.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { getModifier } from '../../lib/characterModel'
import { modStr, masteryShortDesc } from '../../lib/sheetUtils'
import { undoLevelUp } from '../../lib/levelUpEngine'
import { getEffectsForSlot, getMechanicalEffects } from '../../lib/featureEffects'
import { loadItemIndex } from '../../lib/dataLoader'
import { Section, Badge, DetailChip, Btn, Stepper, FeatureNoteList } from './SheetKit'
import { S } from './sheetStyles'
import ConditionChips from '../ui/ConditionChips'

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
function HpControls({ hp, baseMaxHp, maxHpBonus, applyCharacter, updateCharacter }) {
  const [amount, setAmount] = useState(0)

  function damage() {
    if (amount <= 0) return
    applyCharacter(d => {
      if (!d.status) d.status = {}
      let dmg = amount
      let t = d.status.temporaryHp || 0
      if (t > 0) { const a = Math.min(t, dmg); t -= a; dmg -= a; d.status.temporaryHp = t }
      const cur = d.status.currentHp ?? hp.max
      d.status.currentHp = Math.max(0, cur - dmg)
    }, { changedPaths: ['status.temporaryHp', 'status.currentHp'] })
    setAmount(0)
  }
  function heal() {
    if (amount <= 0) return
    applyCharacter(d => {
      if (!d.status) d.status = {}
      const cur = d.status.currentHp ?? hp.max
      d.status.currentHp = Math.min(hp.max, cur + amount)
    }, { changedPaths: ['status.currentHp'] })
    setAmount(0)
  }

  const row = { display: 'flex', alignItems: 'center', gap: 10 }
  const label = { color: 'var(--text-muted)', fontSize: 12, minWidth: 110 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 220 }}>
      <div style={row}>
        <span style={label}>Current HP</span>
        <Stepper value={hp.current} min={0} max={hp.max}
          onChange={v => updateCharacter('status.currentHp', v)} width={56} />
      </div>
      <div style={row}>
        <span style={label}>Temporary HP</span>
        <Stepper value={hp.temporary} min={0} max={999}
          onChange={v => updateCharacter('status.temporaryHp', v)} width={56} />
      </div>
      <div style={row}>
        <span style={label}>Max HP adjust</span>
        <Stepper value={maxHpBonus} min={-999} max={999}
          onChange={v => updateCharacter('status.maxHpBonus', v)} width={56} />
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>
        Base max {baseMaxHp}
        {maxHpBonus ? ` · adjust ${maxHpBonus > 0 ? '+' : ''}${maxHpBonus} · effective ${hp.max}` : ''}
      </div>
      <div style={{ ...row, marginTop: 2 }}>
        <Stepper value={amount} min={0} max={999} onChange={setAmount} width={56} />
        <Btn variant="danger" disabled={amount <= 0} onClick={damage} style={{ padding: '6px 12px' }}>Damage</Btn>
        <Btn variant="primary" disabled={amount <= 0} onClick={heal} style={{ padding: '6px 12px' }}>Heal</Btn>
      </div>
    </div>
  )
}

export default function OverviewTab({ character, computed, abilityScores, hp, updateCharacter, applyCharacter, charId, session, onReload, readOnly = false }) {
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
      </div>

      {/* ── Hero row: HP block on the left, combat tiles on the right ──
          On phones this stacks vertically. */}
      <div style={heroRow}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <Section title="Hit Points">
          <div style={S.hpSection}>
            <div style={S.hpMain}>
              <div style={S.hpLabel}>Hit Points</div>
              <div style={S.hpValue}>{hp.current} / {hp.max}</div>
              {hp.temporary > 0 && (
                <div style={{ color: 'var(--accent-green)', fontSize: 12, fontWeight: 'bold' }}>+{hp.temporary} temp</div>
              )}
              <div style={S.hpBarTrack}>
                <div style={{ ...S.hpBarFill, width: `${hpPct}%` }} />
              </div>
            </div>
            {!readOnly && (
              <HpControls hp={hp} baseMaxHp={baseMaxHp} maxHpBonus={maxHpBonus}
                applyCharacter={applyCharacter} updateCharacter={updateCharacter} />
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <DetailChip label="HP Method" value={character.hpPreference?.method === 'roll' ? 'Roll' : 'Average'} />
            <DetailChip label="Hit Dice" value={character.classes.map(c => `${c.level}d${c.hitDie}`).join(' + ')} />
            <DetailChip label="CON" value={modStr(getModifier(abilityScores.con))} />
          </div>
          <DamageResistancePills character={character} />
          <FeatureNoteList notes={getEffectsForSlot(character, 'hp')} />

          {/* Death saves */}
          <div style={S.deathSaves}>
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
        </Section>
        </div>

        <div style={combatTileColumn}>
          <CombatTile
            label="AC"
            value={ac}
            color="var(--accent-blue)"
            tooltip={acTooltip}
            badge={acHasNotes ? '✦' : null}
          />
          <CombatTile
            label="Initiative"
            value={modStr(initiative)}
            color="var(--accent-purple)"
            tooltip={initTooltip}
            badge={initFeatureNotes.length > 0 ? '✦' : null}
          />
          <CombatTile
            label={extraSpeeds.length > 0 ? `Speed · +${extraSpeeds.length}` : 'Speed'}
            value={speedValue}
            color="var(--accent-green)"
            tooltip={speedTooltip}
            badge={extraSpeeds.length > 0 ? '↪' : null}
          />
          <CombatTile label="Prof Bonus" value={modStr(profBonus)} color="var(--accent-yellow)" />
        </div>
      </div>

      {/* ── Conditions ── */}
      <Section title="Conditions">
        <ConditionChips
          active={character.status?.conditions || []}
          onToggle={(id, on) => {
            const cur = character.status?.conditions || []
            const next = on ? [...cur.filter(x => x !== id), id] : cur.filter(x => x !== id)
            updateCharacter('status.conditions', next)
          }}
        />
        <FeatureNoteList notes={getEffectsForSlot(character, 'conditions')} />
      </Section>

      {/* ── Combat economy + Concentration on one row when wide ──
          Both are play-only state. The economy badges (Action / Bonus
          Action / Reaction) track what the player has used this turn.
          "Neue Runde" resets all three to unused — a single button is
          faster than three taps in initiative order. */}
      <div style={twoColumnRow}>
        <Section title="Combat-Aktionen">
          <CombatEconomy
            value={economy}
            onChange={(next) => updateCharacter('status.economy', next)}
          />
        </Section>
        <Section title="Konzentration">
          <ConcentrationTracker
            value={concentration}
            onChange={(v) => updateCharacter('status.concentration', v || null)}
          />
          <FeatureNoteList notes={getEffectsForSlot(character, 'concentration')} />
        </Section>
      </div>

      {/* ── Attacks ── */}
      {computed?.attacks?.length > 0 && (
        <Section title="Attacks & Actions">
          <div style={S.attackTableWrap}>
            <table style={S.attackTable}>
              <thead>
                <tr>
                  <th style={S.th}>Name</th>
                  <th style={S.th}>Attack</th>
                  <th style={S.th}>Damage</th>
                  <th style={S.th}>Type</th>
                  <th style={S.th}>Range</th>
                </tr>
              </thead>
              <tbody>
                {computed.attacks.map((atk, i) => (
                  <tr key={i}>
                    <td style={S.td}>
                      {atk.name}
                      {atk.markedAs && (
                        <span style={markedBadge} title={atk.markedAs.note}>
                          {atk.markedAs.label}
                        </span>
                      )}
                      {atk.mastery?.length > 0 && atk.mastery.map((m) => {
                        const desc = masteryShortDesc(m)
                        return (
                          <span key={m} style={masteryBadge}
                                title={desc ? `Weapon Mastery: ${m} — ${desc}` : '5.5e Weapon Mastery'}>
                            {m}{desc ? ` (${desc})` : ''}
                          </span>
                        )
                      })}
                    </td>
                    <td style={{ ...S.td, color: 'var(--accent-blue)', fontWeight: 'bold' }}>{atk.attackDisplay}</td>
                    <td style={{ ...S.td, color: 'var(--accent-red)' }}>{atk.damage}</td>
                    <td style={S.td}>{atk.damageType}</td>
                    <td style={S.td}>{atk.range}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 6 }}>
            Waffen in der Inventory-Tab ausrüsten. Finesse-Waffen nehmen automatisch den höheren von STR / DEX.
          </div>
          <FeatureNoteList notes={getEffectsForSlot(character, 'attacks')} />
          <WeaponMasteryPicker character={character} computed={computed} updateCharacter={updateCharacter} />
        </Section>
      )}

      {/* ── Spellcasting ── */}
      {computed?.spellcasting && Object.keys(computed.spellcasting).length > 0 && (
        <Section title="Spellcasting">
          {Object.entries(computed.spellcasting).map(([cls, data]) => (
            <div key={cls} style={S.spellcastRow}>
              <span style={S.spellcastClass}>{cls}</span>
              <DetailChip label="Ability" value={data.ability.toUpperCase()} />
              <DetailChip label="Spell Attack" value={data.spellAttackDisplay} />
              <DetailChip label="Save DC" value={data.spellSaveDC} />
            </div>
          ))}
        </Section>
      )}

      {/* ── Class Resources ── */}
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

      {/* ── Class summary strip — one row per class, compact ── */}
      <Section title="Class">
        <div style={classStrip}>
          {character.classes.map((c, i) => (
            <div key={i} style={classRow}>
              <div style={classMain}>
                <span style={classNameLabel}>{c.classId}</span>
                <span style={classLevelLabel}>Lv. {c.level}</span>
                {c.subclassId && (
                  <Badge color="var(--accent-purple)" label={c.subclassId.split('__')[0]} hint={c.subclassTitle || 'Subclass'} />
                )}
              </div>
              <div style={classMeta}>
                <Badge color="var(--accent-blue)" label={`d${c.hitDie}`} hint="Hit Die" />
                {c.spellcastingAbility && <Badge color="var(--accent-yellow)" label={c.spellcastingAbility.toUpperCase()} hint="Casting Ability" />}
                {c.casterProgression && (
                  <span style={classProg} title="Caster Progression">
                    {c.casterProgression === 'full' ? 'Full'
                      // "artificer" is the 5.5e XPHB key for both
                      // Ranger and Paladin (the 2024 unified half-
                      // caster progression). Display it as the half-
                      // caster glyph so the badge reads the same as
                      // its 5e counterpart.
                      : (c.casterProgression === 'half'
                        || c.casterProgression === '1/2'
                        || c.casterProgression === 'artificer') ? '½'
                      : c.casterProgression === '1/3' ? '⅓'
                      : c.casterProgression === 'pact' ? 'Pact' : c.casterProgression}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Level History — collapsed by default; no longer eats screen ── */}
      {(character.levelHistory || []).length > 0 && (
        <details style={historyDetails}>
          <summary style={historySummary}>
            Level History
            <span style={historyCount}>({character.levelHistory.length})</span>
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {[...(character.levelHistory || [])].reverse().map((entry, i) => {
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
                      <Btn variant="danger" style={{ padding: '4px 10px', fontSize: 11 }} onClick={async () => {
                        // Use the engine's undoLevelUp helper — it grafts the
                        // LIVE levelHistory back onto the restored snapshot so
                        // step-by-step undos keep working (each entry's
                        // snapshot stays available for the NEXT click).
                        // The old code wrote `entry.snapshot` straight to the
                        // DB, which is the snapshot-with-stripped-nested-
                        // history. That broke the chain after the first undo.
                        const restored = undoLevelUp(character, 0)
                        if (!restored) { alert('Kein Snapshot verfügbar.'); return }
                        if (character.appearance?.portrait) {
                          restored.appearance = { ...(restored.appearance || {}), portrait: character.appearance.portrait }
                        }
                        await supabase.from('dnd_characters')
                          .update({ data: restored, name: restored.info.name })
                          .eq('id', charId).eq('user_id', session.user.id)
                        onReload()
                      }}>Undo</Btn>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </details>
      )}
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
  // Collapsed by default — the block can grow to dozens of weapon
  // chips per class and a sheet-open shouldn't bury the rest of the
  // attacks section under it. Expanded view shows the full picker;
  // collapsed view shows only the player's current picks.
  const [expanded, setExpanded] = useState(false)
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

  if (!wm || wm.perClass.length === 0) return null

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

  // Group by weapon category so the picker reads "simple … martial …"
  // rather than 30 weapons in a flat line.
  const grouped = { simple: [], martial: [], other: [] }
  for (const w of catalog) {
    const cat = String(w.weaponCategory || '').toLowerCase()
    if (cat === 'simple') grouped.simple.push(w)
    else if (cat === 'martial') grouped.martial.push(w)
    else grouped.other.push(w)
  }

  // Build a quick lookup of mastery names for currently-picked weapons,
  // so the collapsed view can show each picked weapon's technique on
  // the chip ("Longsword · Sap").
  const masteryByName = new Map()
  for (const w of catalog) masteryByName.set(w.name.toLowerCase(), w.mastery)

  return (
    <div style={wmpStyle.wrap}>
      <div style={wmpStyle.title}
           onClick={() => setExpanded(e => !e)}
           role="button" tabIndex={0}
           onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setExpanded(v => !v) }}>
        <span style={{ cursor: 'pointer' }}>
          {expanded ? '▼' : '▶'} Weapon Mastery
        </span>
      </div>
      {wm.perClass.map(pc => (
        <div key={pc.classIndex} style={wmpStyle.classBlock}>
          <div style={wmpStyle.classHead}>
            <span>{pc.classId}</span>
            <span style={{ color: pc.picked.length >= pc.count ? 'var(--accent-green)' : 'var(--accent)' }}>
              {pc.picked.length}/{pc.count} gewählt
            </span>
          </div>
          {/* Collapsed view: show only the player's current picks. */}
          {!expanded && (
            pc.picked.length === 0 ? (
              <div style={wmpStyle.empty}>Noch keine Mastery gewählt — auf „Weapon Mastery" klicken zum Wählen.</div>
            ) : (
              <div style={wmpStyle.grid}>
                {pc.picked.map(name => {
                  const m = masteryByName.get(name.toLowerCase()) || []
                  return (
                    <span key={name} style={{ ...wmpStyle.chip, ...wmpStyle.chipOn, cursor: 'default' }}>
                      ✓ {name}
                      <span style={wmpStyle.chipMastery}>
                        {' · '}{m.map(s => {
                          const d = masteryShortDesc(s); return d ? `${s} (${d})` : s
                        }).join('/')}
                      </span>
                    </span>
                  )
                })}
              </div>
            )
          )}
          {/* Expanded view: full catalog picker, grouped by category. */}
          {expanded && (catalog.length === 0 ? (
            <div style={wmpStyle.empty}>
              {loaded ? 'Keine Mastery-Waffen in den Daten gefunden.' : 'Lade Waffenkatalog …'}
            </div>
          ) : (
            <>
              {['simple', 'martial', 'other'].filter(g => grouped[g].length > 0).map(g => (
                <div key={g} style={wmpStyle.groupBlock}>
                  <div style={wmpStyle.groupLabel}>
                    {g === 'simple' ? 'Simple' : g === 'martial' ? 'Martial' : 'Andere'}
                  </div>
                  <div style={wmpStyle.grid}>
                    {grouped[g].map(w => {
                      const isPicked = pc.picked.some(p => p.toLowerCase() === w.name.toLowerCase())
                      const isFull = pc.picked.length >= pc.count
                      const disabled = !isPicked && isFull
                      return (
                        <button
                          key={w.name} type="button"
                          onClick={() => togglePick(pc.classIndex, w.name, pc.count)}
                          disabled={disabled}
                          title={`Mastery: ${w.mastery.join(', ')}`}
                          style={{
                            ...wmpStyle.chip,
                            ...(isPicked ? wmpStyle.chipOn : {}),
                            opacity: disabled ? 0.4 : 1,
                            cursor: disabled ? 'not-allowed' : 'pointer',
                          }}>
                          {isPicked && '✓ '}{w.name}
                          <span style={wmpStyle.chipMastery}>
                            {' · '}{w.mastery.map(m => {
                              const d = masteryShortDesc(m); return d ? `${m} (${d})` : m
                            }).join('/')}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </>
          ))}
        </div>
      ))}
      {expanded && (
        <div style={wmpStyle.hint}>
          Tipp: Bei einer Long Rest darfst du eine Wahl gegen eine andere tauschen.
        </div>
      )}
    </div>
  )
}
const wmpStyle = {
  wrap: { marginTop: 10, padding: '8px 10px', background: 'var(--bg-inset)',
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

function DamageResistancePills({ character }) {
  const m = getMechanicalEffects(character)
  const has = m.damageResistance.size + m.damageImmunity.size + m.damageVulnerability.size > 0
  if (!has) return null
  const renderGroup = (set, label, color) => {
    if (set.size === 0) return null
    return (
      <div style={drGroup} title={`${label} gegen: ${[...set].join(', ')}`}>
        <span style={{ ...drLabel, color }}>{label}</span>
        {[...set].map(t => (
          <span key={t} style={{ ...drPill, borderColor: color, color }}>{t}</span>
        ))}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      {renderGroup(m.damageResistance,    'Resistenz',    'var(--accent-green)')}
      {renderGroup(m.damageImmunity,      'Immunität',    'var(--accent-blue)')}
      {renderGroup(m.damageVulnerability, 'Verwundbarkeit', 'var(--accent-red)')}
    </div>
  )
}
const drGroup = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }
const drLabel = { fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5 }
const drPill = {
  padding: '1px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
  border: '1px solid', textTransform: 'capitalize',
  background: 'transparent',
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
function CombatEconomy({ value, onChange }) {
  const slots = [
    { id: 'action',      label: 'Action',       color: 'var(--accent-red)' },
    { id: 'bonusAction', label: 'Bonus Action', color: 'var(--accent-yellow)' },
    { id: 'reaction',    label: 'Reaction',     color: 'var(--accent-purple)' },
  ]
  function toggle(id) {
    onChange({ ...(value || {}), [id]: !value?.[id] })
  }
  function reset() {
    onChange({ action: false, bonusAction: false, reaction: false })
  }
  const anyUsed = !!(value?.action || value?.bonusAction || value?.reaction)

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

// Flex (not grid) so the tile column drops below the HP section on
// narrow screens — the 4 stat tiles never need to wrap individually,
// only the whole column.
const heroRow = {
  display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap',
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
