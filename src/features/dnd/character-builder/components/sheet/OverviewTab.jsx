// components/sheet/OverviewTab.jsx
// At-a-glance play view: identity is compressed to a single strip; the
// HP block, combat stat tiles, conditions, concentration tracker,
// attacks, spellcasting and class resources are the prominent things.
// Class details and level history are tucked away because they don't
// change during a session.

import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getModifier } from '../../lib/characterModel'
import { modStr } from '../../lib/sheetUtils'
import { Section, Badge, DetailChip, Btn, Stepper } from './SheetKit'
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
  const initiative = computed?.initiative ?? getModifier(abilityScores.dex)
  const speed = computed?.speed?.walk ?? character.species?.speed ?? 30

  const concentration = character.status?.concentration

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
          <CombatTile label="AC" value={ac} color="var(--accent-blue)" />
          <CombatTile label="Initiative" value={modStr(initiative)} color="var(--accent-purple)" />
          <CombatTile label="Speed" value={`${speed} ft.`} color="var(--accent-green)" />
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
      </Section>

      {/* ── Concentration tracker ──
          Spells that say "Concentration, up to …" go here. One spell at
          a time per 5e rules; setting a new one (or taking damage and
          failing the CON save) clears the old. Long Rest auto-clears
          via CharacterSheetPage. */}
      <Section title="Concentration">
        <ConcentrationTracker
          value={concentration}
          onChange={(v) => updateCharacter('status.concentration', v || null)}
        />
      </Section>

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
                      : (c.casterProgression === 'half' || c.casterProgression === '1/2') ? '½'
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
                        const snap = structuredClone(entry.snapshot)
                        if (character.appearance?.portrait)
                          snap.appearance = { ...(snap.appearance || {}), portrait: character.appearance.portrait }
                        await supabase.from('dnd_characters').update({ data: snap, name: snap.info.name })
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

// ── Combat-stat tile (AC, Initiative, Speed, Prof Bonus) ──────────
function CombatTile({ label, value, color }) {
  return (
    <div style={combatTile}>
      <div style={{ ...combatTileValue, color }}>{value}</div>
      <div style={combatTileLabel}>{label}</div>
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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value?.spell || '')

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

  if (!value?.spell) {
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
      <span style={concentrationSpellName} onClick={() => { setDraft(value.spell); setEditing(true) }}>
        {value.spell}
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
