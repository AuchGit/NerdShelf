// components/sheet/SpellsTab.jsx
// Complete spell list (every spell the character knows, not just level 1),
// interactive spell slots, casting with up-casting, and concentration tracking.

import { useState, useEffect, useMemo } from 'react'
import EntryRenderer from '../ui/EntryRenderer'
import { Section, EmptyState, Btn, SheetModal } from './SheetKit'
import { S } from './sheetStyles'
import {
  collectCharacterSpells, computeSpellSlots, ordinal, spellLevelLabel, SCHOOL_NAMES,
} from '../../lib/sheetUtils'

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

const LEVEL_COLORS = ['var(--accent-blue)', 'var(--accent)', 'var(--accent)', 'var(--accent)',
  'var(--accent-purple)', 'var(--accent-purple)', 'var(--accent-purple)', 'var(--accent-red)',
  'var(--accent-red)', 'var(--accent-red)']

function levelColor(lvl) { return LEVEL_COLORS[Math.min(9, lvl)] || 'var(--accent)' }

export default function SpellsTab({ character, computed, updateCharacter, applyCharacter }) {
  const [spellMap, setSpellMap] = useState(null)
  const [detail, setDetail] = useState(null)
  const edition = character.meta?.edition || '5e'

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { loadSpellList } = await import('../../lib/dataLoader')
      const list = await loadSpellList(edition)
      if (cancelled) return
      const m = new Map()
      for (const s of list) m.set(s.name.toLowerCase(), s)
      setSpellMap(m)
    }
    load()
    return () => { cancelled = true }
  }, [edition])

  // ── Enrich every collected spell with level / school / description ──
  const { byLevel, hasAny } = useMemo(() => {
    const collected = collectCharacterSpells(character)
    const customByName = {}
    for (const c of (character.custom?.spells || [])) customByName[c.name?.toLowerCase()] = c
    const meta = character.spellMetadata || {}

    const enriched = collected.map(c => {
      const loaded = spellMap?.get(c.name.toLowerCase())
      const custom = customByName[c.name.toLowerCase()]
      const m = meta[c.name] || {}
      const level = loaded?.level ?? custom?.level ?? m.level ?? 0
      return {
        name: c.name,
        origins: c.origins,
        sourceClasses: c.sourceClasses,
        level,
        school: loaded?.school || custom?.school || m.school || 'U',
        concentration: loaded?.concentration ?? custom?.concentration ?? m.concentration ?? false,
        ritual: loaded?.ritual ?? custom?.ritual ?? m.ritual ?? false,
        castingTime: loaded?.castingTime || custom?.castingTime || m.castingTime || '—',
        range: loaded?.range || custom?.range || m.range || '—',
        duration: loaded?.duration || custom?.duration || m.duration || '—',
        components: loaded?.components || {},
        entries: loaded?.entries || custom?.entries || (custom?.description ? [custom.description] : []),
        entriesHigherLevel: loaded?.entriesHigherLevel || custom?.entriesHigherLevel || [],
      }
    })

    const groups = {}
    for (const sp of enriched) {
      if (!groups[sp.level]) groups[sp.level] = []
      groups[sp.level].push(sp)
    }
    for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.name.localeCompare(b.name))
    return { byLevel: groups, hasAny: enriched.length > 0 }
  }, [character, spellMap])

  const { slots, warlockSlots } = computeSpellSlots(character)
  const usedSlots = character.status?.usedSpellSlots || {}
  const usedPact = character.status?.usedPactSlots || 0
  const concentration = character.status?.concentration || null
  const hasSpellcasting = character.classes.some(c => c.spellcastingAbility)

  // ── Slot helpers ──────────────────────────────────────────
  function slotRemaining(level) {
    if (!slots || !slots[level - 1]) return 0
    return Math.max(0, slots[level - 1] - (usedSlots[level] || 0))
  }
  function pactRemaining() {
    return warlockSlots ? Math.max(0, warlockSlots.slots - usedPact) : 0
  }

  function setSlotUsed(level, used) {
    const max = slots?.[level - 1] || 0
    updateCharacter(`status.usedSpellSlots.${level}`, Math.max(0, Math.min(max, used)))
  }
  function setPactUsed(used) {
    const max = warlockSlots?.slots || 0
    updateCharacter('status.usedPactSlots', Math.max(0, Math.min(max, used)))
  }

  // ── Casting ───────────────────────────────────────────────
  function castSpell(spell, slotLevel, usePact) {
    if (spell.concentration && concentration && concentration.name !== spell.name) {
      if (!window.confirm(`You are concentrating on ${concentration.name}. Replace it with ${spell.name}?`)) return
    }
    applyCharacter(d => {
      if (!d.status) d.status = {}
      if (usePact) {
        d.status.usedPactSlots = (d.status.usedPactSlots || 0) + 1
      } else if (slotLevel > 0) {
        if (!d.status.usedSpellSlots) d.status.usedSpellSlots = {}
        d.status.usedSpellSlots[slotLevel] = (d.status.usedSpellSlots[slotLevel] || 0) + 1
      }
      if (spell.concentration) {
        d.status.concentration = { name: spell.name, level: usePact ? warlockSlots?.level : slotLevel }
      }
    })
    setDetail(null)
  }

  // True if at least one slot (regular or pact) could cast this spell —
  // only controls whether the Cast button is enabled. The actual slot
  // level is always chosen by the player in the cast dialog.
  function hasCastableSlot(spell) {
    for (let lvl = spell.level; lvl <= 9; lvl++) {
      if (slotRemaining(lvl) > 0) return true
    }
    if (warlockSlots && warlockSlots.level >= spell.level && pactRemaining() > 0) return true
    return false
  }

  if (!hasSpellcasting && !hasAny) {
    return (
      <div className="dnd-sheet-tab-body" style={S.tabBody}>
        <EmptyState title="No Spellcasting" desc="This character has no spells or spell slots." />
      </div>
    )
  }

  const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b)

  return (
    <div className="dnd-sheet-tab-body" style={S.tabBody}>
      {/* ── Spellcasting overview ── */}
      {computed?.spellcasting && Object.keys(computed.spellcasting).length > 0 && (
        <Section title="Spellcasting">
          {Object.entries(computed.spellcasting).map(([clsName, sc]) => (
            <div key={clsName} style={S.spellcastRow}>
              <span style={S.spellcastClass}>{clsName}</span>
              <div style={S.detailChip}><span style={S.detailChipLabel}>Ability: </span><span style={S.detailChipValue}>{sc.ability.toUpperCase()}</span></div>
              <div style={S.detailChip}><span style={S.detailChipLabel}>Spell Attack: </span><span style={S.detailChipValue}>{sc.spellAttackDisplay}</span></div>
              <div style={S.detailChip}><span style={S.detailChipLabel}>Save DC: </span><span style={S.detailChipValue}>{sc.spellSaveDC}</span></div>
            </div>
          ))}
        </Section>
      )}

      {/* ── Concentration banner ── */}
      {concentration && (
        <div style={S.concBanner}>
          <span style={{ color: 'var(--accent-purple)', fontSize: 13, fontWeight: 'bold' }}>
            Concentrating on {concentration.name}
            {concentration.level ? ` (Level ${concentration.level})` : ''}
          </span>
          <Btn variant="ghost" onClick={() => updateCharacter('status.concentration', null)}>Drop</Btn>
        </div>
      )}

      {/* ── Spell slots ── */}
      {(slots || warlockSlots) && (
        <Section title="Spell Slots">
          <div style={S.slotGrid}>
            {slots && slots.map((max, i) => {
              const level = i + 1
              if (max === 0) return null
              const used = usedSlots[level] || 0
              const remaining = max - used
              return (
                <div key={level} style={S.slotBox}>
                  <div style={S.slotLevel}>{ordinal(level)} Level</div>
                  <div style={{ ...S.slotCount, color: remaining > 0 ? 'var(--accent)' : 'var(--accent-red)' }}>
                    {remaining} / {max}
                  </div>
                  <div style={S.slotDots}>
                    {Array.from({ length: max }, (_, j) => (
                      <button
                        key={j} type="button"
                        onClick={() => setSlotUsed(level, j < remaining ? max - j : max - (j + 1))}
                        style={{ ...S.slotDot, background: j < remaining ? 'var(--accent)' : 'var(--bg-inset)' }}
                        aria-label={`slot ${j + 1}`}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
            {warlockSlots && (
              <div style={{ ...S.slotBox, borderColor: 'var(--accent-purple)' }}>
                <div style={S.slotLevel}>Pact · {ordinal(warlockSlots.level)} Lv.</div>
                <div style={{ ...S.slotCount, color: pactRemaining() > 0 ? 'var(--accent-purple)' : 'var(--accent-red)' }}>
                  {pactRemaining()} / {warlockSlots.slots}
                </div>
                <div style={S.slotDots}>
                  {Array.from({ length: warlockSlots.slots }, (_, j) => {
                    const rem = pactRemaining()
                    return (
                      <button
                        key={j} type="button"
                        onClick={() => setPactUsed(j < rem ? warlockSlots.slots - j : warlockSlots.slots - (j + 1))}
                        style={{ ...S.slotDot, background: j < rem ? 'var(--accent-purple)' : 'var(--bg-inset)' }}
                        aria-label={`pact slot ${j + 1}`}
                      />
                    )
                  })}
                </div>
              </div>
            )}
          </div>
          <div style={S.sideHint}>Click a pip to spend or restore a slot. A Long Rest restores all slots.</div>
        </Section>
      )}

      {/* ── Spells by level ── */}
      {!hasAny && <EmptyState title="No spells known" desc="Spells chosen at level-up will appear here." />}

      {levels.map(level => (
        <Section key={level} title={`${spellLevelLabel(level)} (${byLevel[level].length})`}>
          {byLevel[level].map(spell => {
            const canCast = hasCastableSlot(spell)
            return (
              <div key={spell.name} style={S.spellRow}>
                <div style={{ ...S.spellLevelBadge, background: levelColor(level) + '22', color: levelColor(level) }}>
                  {level === 0 ? 'C' : level}
                </div>
                <div style={S.spellRowMain} onClick={() => setDetail(spell)}>
                  <div style={S.spellName}>{spell.name}</div>
                  <div style={S.spellMeta}>
                    {SCHOOL_NAMES[spell.school] || spell.school}
                    {spell.castingTime !== '—' ? ` · ${spell.castingTime}` : ''}
                    {spell.range !== '—' ? ` · ${spell.range}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                  {spell.concentration && (
                    <span style={{ ...S.tag, borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}>Conc</span>
                  )}
                  {spell.ritual && (
                    <span style={{ ...S.tag, borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>Ritual</span>
                  )}
                  {spell.origins.includes('race') && (
                    <span style={{ ...S.tag, borderColor: 'var(--accent-green)', color: 'var(--accent-green)' }}>Race</span>
                  )}
                  {spell.origins.includes('feat') && (
                    <span style={{ ...S.tag, borderColor: 'var(--accent-yellow)', color: 'var(--accent-yellow)' }}>Feat</span>
                  )}
                  {level === 0 ? (
                    <Btn variant="ghost" style={{ padding: '5px 12px', fontSize: 12 }}
                      onClick={() => setDetail(spell)}>
                      Cast
                    </Btn>
                  ) : (
                    <Btn variant="primary" disabled={!canCast} style={{ padding: '5px 12px', fontSize: 12 }}
                      onClick={() => setDetail(spell)}
                      title={canCast ? 'Choose a slot level to cast' : 'No spell slots available'}>
                      Cast
                    </Btn>
                  )}
                </div>
              </div>
            )
          })}
        </Section>
      ))}

      {/* ── Spell detail / cast modal ── */}
      <SpellDetailModal
        spell={detail}
        onClose={() => setDetail(null)}
        slotRemaining={slotRemaining}
        pactRemaining={pactRemaining}
        warlockSlots={warlockSlots}
        onCast={castSpell}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// SPELL DETAIL MODAL
// ═══════════════════════════════════════════════════════════════

function SpellDetailModal({ spell, onClose, slotRemaining, pactRemaining, warlockSlots, onCast }) {
  if (!spell) return null

  const castOptions = []
  if (spell.level === 0) {
    castOptions.push({ label: 'Cast (cantrip)', fn: () => onCast(spell, 0, false) })
  } else {
    for (let lvl = spell.level; lvl <= 9; lvl++) {
      const rem = slotRemaining(lvl)
      if (rem > 0) {
        castOptions.push({
          label: lvl === spell.level ? `Cast at Level ${lvl} (${rem} left)` : `Up-cast at Level ${lvl} (${rem} left)`,
          fn: () => onCast(spell, lvl, false),
        })
      }
    }
    if (warlockSlots && warlockSlots.level >= spell.level && pactRemaining() > 0) {
      castOptions.push({
        label: `Cast with Pact Slot (Level ${warlockSlots.level}, ${pactRemaining()} left)`,
        fn: () => onCast(spell, warlockSlots.level, true),
      })
    }
  }

  return (
    <SheetModal
      open={!!spell}
      onClose={onClose}
      title={spell.name}
      width={620}
      footer={<Btn variant="ghost" onClick={onClose}>Close</Btn>}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={S.detailChip}><span style={S.detailChipLabel}>Level: </span><span style={S.detailChipValue}>{spell.level === 0 ? 'Cantrip' : spell.level}</span></div>
        <div style={S.detailChip}><span style={S.detailChipLabel}>School: </span><span style={S.detailChipValue}>{SCHOOL_NAMES[spell.school] || spell.school}</span></div>
        <div style={S.detailChip}><span style={S.detailChipLabel}>Cast: </span><span style={S.detailChipValue}>{spell.castingTime}</span></div>
        <div style={S.detailChip}><span style={S.detailChipLabel}>Range: </span><span style={S.detailChipValue}>{spell.range}</span></div>
        <div style={S.detailChip}><span style={S.detailChipLabel}>Duration: </span><span style={S.detailChipValue}>{spell.duration}</span></div>
        <div style={S.detailChip}><span style={S.detailChipLabel}>Components: </span><span style={S.detailChipValue}>{formatComponents(spell.components)}</span></div>
      </div>

      {(spell.concentration || spell.ritual) && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {spell.concentration && <span style={{ ...S.tag, borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}>Concentration</span>}
          {spell.ritual && <span style={{ ...S.tag, borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>Ritual</span>}
        </div>
      )}

      {/* Cast actions — choose the slot level (base level or up-cast) */}
      <div style={{
        marginBottom: 14, padding: '12px 14px', borderRadius: 8,
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      }}>
        <div style={{ ...S.formLabel, marginBottom: 8 }}>
          {spell.level === 0 ? 'Cast' : 'Cast at slot level'}
        </div>
        {castOptions.length === 0 ? (
          <div style={{ color: 'var(--accent-red)', fontSize: 13 }}>No spell slots available.</div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {castOptions.map((opt, i) => (
              <Btn key={i} variant="primary" onClick={opt.fn}>{opt.label}</Btn>
            ))}
          </div>
        )}
      </div>

      {spell.entries?.length > 0 ? (
        <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          <EntryRenderer entries={spell.entries} />
          {spell.entriesHigherLevel?.length > 0 && (
            <div style={{ marginTop: 10 }}><EntryRenderer entries={spell.entriesHigherLevel} /></div>
          )}
        </div>
      ) : (
        <div style={{ color: 'var(--text-dim)', fontSize: 13, fontStyle: 'italic' }}>
          No description available for this spell.
        </div>
      )}
    </SheetModal>
  )
}
