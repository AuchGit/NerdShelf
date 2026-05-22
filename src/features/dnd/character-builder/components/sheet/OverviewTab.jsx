// components/sheet/OverviewTab.jsx
// At-a-glance combat overview with live HP, death saves and class resources.

import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getModifier } from '../../lib/characterModel'
import { modStr } from '../../lib/sheetUtils'
import { Section, InfoCard, Badge, DetailChip, Btn, Stepper } from './SheetKit'
import { S } from './sheetStyles'

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
    })
    setAmount(0)
  }
  function heal() {
    if (amount <= 0) return
    applyCharacter(d => {
      if (!d.status) d.status = {}
      const cur = d.status.currentHp ?? hp.max
      d.status.currentHp = Math.min(hp.max, cur + amount)
    })
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

export default function OverviewTab({ character, computed, abilityScores, hp, updateCharacter, applyCharacter, charId, session, onReload }) {
  const deathSaves = character.status?.deathSaves || { successes: 0, failures: 0 }
  const usedResources = character.status?.usedResources || {}
  const baseMaxHp = computed?.hp?.max || 1
  const maxHpBonus = character.status?.maxHpBonus || 0
  const hpPct = hp.max > 0 ? Math.max(0, Math.min(100, (hp.current / hp.max) * 100)) : 0

  return (
    <div className="dnd-sheet-tab-body" style={S.tabBody}>
      {/* ── Base Information ── */}
      <Section title="Base Information">
        <div style={S.identityGrid}>
          <InfoCard label="Species"
            value={character.species.subraceId
              ? `${character.species.subraceId.split('__')[0]} (${character.species.raceId?.split('__')[0]})`
              : character.species.raceId?.split('__')[0] || '—'} />
          <InfoCard label="Background" value={character.background.backgroundId?.split('__')[0] || '—'} />
          <InfoCard label="Alignment" value={character.info.alignment || '—'} />
          <InfoCard label="Experience" value={character.info.experience || 0} />
          {character.info.player && <InfoCard label="Player" value={character.info.player} />}
          <InfoCard label="Edition" value={character.meta.edition === '5.5e' ? 'D&D 2024' : 'D&D 2014'} />
        </div>
      </Section>

      {/* ── Hit Points ── */}
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
          <HpControls hp={hp} baseMaxHp={baseMaxHp} maxHpBonus={maxHpBonus}
            applyCharacter={applyCharacter} updateCharacter={updateCharacter} />
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

      {/* ── Class ── */}
      <Section title="Class">
        {character.classes.map((c, i) => (
          <div key={i} style={S.classCard}>
            <div style={S.classCardHeader}>
              <div>
                <div style={S.classCardName}>{c.classId}</div>
                <div style={S.classCardLevel}>Level {c.level}</div>
              </div>
              <div style={S.classCardBadges}>
                <Badge color="var(--accent-blue)" label={`d${c.hitDie}`} hint="Hit Die" />
                {c.subclassId && <Badge color="var(--accent-purple)" label={c.subclassId.split('__')[0]} hint={c.subclassTitle || 'Subclass'} />}
                {c.spellcastingAbility && <Badge color="var(--accent-yellow)" label={`Casting (${c.spellcastingAbility.toUpperCase()})`} />}
              </div>
            </div>
            <div style={S.classCardDetails}>
              <DetailChip label="Hit Dice" value={`${c.level}d${c.hitDie}`} />
              {c.casterProgression && (
                <DetailChip label="Casting"
                  value={c.casterProgression === 'full' ? 'Full Caster'
                    : (c.casterProgression === 'half' || c.casterProgression === '1/2') ? 'Half Caster'
                    : c.casterProgression === '1/3' ? 'Third Caster'
                    : c.casterProgression === 'pact' ? 'Pact Magic' : c.casterProgression} />
              )}
            </div>
          </div>
        ))}
      </Section>

      {/* ── Attacks ── */}
      {computed?.attacks?.length > 0 && (
        <Section title="Attacks & Actions">
          <div style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 8 }}>
            Equip weapons in the Inventory tab to add them here. Finesse weapons automatically use the higher of STR / DEX.
          </div>
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
                    <td style={S.td}>{atk.name}</td>
                    <td style={{ ...S.td, color: 'var(--accent-blue)', fontWeight: 'bold' }}>{atk.attackDisplay}</td>
                    <td style={{ ...S.td, color: 'var(--accent-red)' }}>{atk.damage}</td>
                    <td style={S.td}>{atk.damageType}</td>
                    <td style={S.td}>{atk.range}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

      {/* ── Level History ── */}
      {(character.levelHistory || []).length > 0 && (
        <Section title="Level History">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                    {i === 0 && entry.snapshot && (
                      <Btn variant="danger" style={{ padding: '4px 10px', fontSize: 11 }} onClick={async () => {
                        const snap = structuredClone(entry.snapshot)
                        if (character.appearance?.portrait)
                          snap.appearance = { ...(snap.appearance || {}), portrait: character.appearance.portrait }
                        await supabase.from('characters').update({ data: snap, name: snap.info.name })
                          .eq('id', charId).eq('user_id', session.user.id)
                        onReload()
                      }}>Undo</Btn>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      )}
    </div>
  )
}
