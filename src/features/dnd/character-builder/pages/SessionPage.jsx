// src/features/dnd/character-builder/pages/SessionPage.jsx
//
// GM session overview. One compact card per character in the campaign.
// Live: a Supabase realtime channel listens to dnd_characters UPDATEs for
// the members of this campaign, so HP / conditions / death saves changes
// from players (or from the GM via the patchCombatState RPC) propagate
// instantly without anyone clicking refresh.
//
// The GM can also write to HP / conditions / death saves directly on each
// card; those writes use the dnd_patch_combat_state RPC (the GM doesn't
// have row-level UPDATE on dnd_characters — the RPC validates and
// whitelists keys server-side).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '../lib/hashNav'
import { supabase } from '../lib/supabase'
import { Panel, Button } from '../../../../shared/ui'
import DndSubNav from '../components/ui/DndSubNav'
import GmSessionPrefsEditor from '../components/ui/GmSessionPrefsEditor'
import ConditionChips from '../components/ui/ConditionChips'
import SessionCardCategories from '../components/sheet/SessionCardCategories'
import { DamageResistancePills } from '../components/sheet/OverviewTab'
import { useSessionPrefs } from '../lib/useSessionPrefs'
// PASSIVE_OPTIONS / STAT_OPTIONS still drive the prefs editor; tile
// labels here use the short PASSIVE_CODE / STAT_CODE maps below.
import {
  getCampaign, listMembers, updateMemberGmNotes, classLine, patchCombatState,
  setSessionActive,
} from '../lib/campaigns'
import { computeCharacter } from '../lib/rulesEngine'
import {
  modStr, ABILITY_KEYS, COIN_TYPES,
  computeSpellSlots, computeEncumbrance, ordinal,
} from '../lib/sheetUtils'

const wrap = { maxWidth: 1500, margin: '0 auto', padding: '12px 16px' }

export default function SessionPage({ session, campaignId }) {
  const navigate = useNavigate()
  const uid = session.user.id

  const [campaign, setCampaign] = useState(null)
  const [members,  setMembers]  = useState([])
  const [chars,    setChars]    = useState({})   // characterId → { data, name } | undefined while loading
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)         // fatal load error → full-page replace
  const [transientError, setTransientError] = useState(null)  // brief patch / RPC error → toast
  const [showPrefs, setShowPrefs] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const refresh = () => setReloadKey(k => k + 1)

  useEffect(() => {
    let cancelled = false
    // No setLoading(true) here — initial state is true, and reloads should
    // refresh silently rather than hiding the whole page behind a spinner.
    ;(async () => {
      try {
        const c = await getCampaign(campaignId)
        if (cancelled) return
        if (!c) { setError('Campaign nicht gefunden.'); setLoading(false); return }
        if (c.gm_id !== uid) { setError('Nur der Spielleiter kann die Session-Übersicht öffnen.'); setLoading(false); return }
        const m = await listMembers(campaignId)
        if (cancelled) return

        const ids = m.map(x => x.character_id)
        let map = {}
        if (ids.length > 0) {
          // RLS: GM-can-see-character policy lets us pull the full data
          // for every member character without per-row joins.
          const { data: rows, error: err } = await supabase
            .from('dnd_characters').select('id, name, data').in('id', ids)
          if (err) throw err
          for (const r of (rows || [])) map[r.id] = r
        }
        if (cancelled) return
        setCampaign(c); setMembers(m); setChars(map); setError(null)
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [campaignId, uid, reloadKey])

  // ── Realtime: live updates from players (and our own RPC writes) ──
  // Subscribe once the members are known. Two channels:
  //   • dnd_characters UPDATE  → MERGE the row (don't replace) so a
  //     partial payload missing `data` doesn't blank the card.
  //   • dnd_campaign_members UPDATE (this campaign only) → patch members
  //     so GM-notes typed in another tab show up here too.
  // Requires the realtime publication in dnd-session-schema.sql.
  const characterIds = useMemo(
    () => members.map(m => String(m.character_id)).sort().join(','),
    [members],
  )
  useEffect(() => {
    if (!campaignId || !characterIds) return
    const charSet = new Set(characterIds.split(',').map(s => Number(s)))

    const channel = supabase
      .channel(`dnd-session:${campaignId}`)
      .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'dnd_characters' },
          (payload) => {
            const row = payload.new
            if (!row || !charSet.has(Number(row.id))) return
            // Merge against the previous entry so an UPDATE payload that
            // omits some columns (or comes through with data=null during
            // a partial broadcast) doesn't wipe the character.
            setChars(prev => {
              const existing = prev[row.id] || {}
              return {
                ...prev,
                [row.id]: {
                  id:   row.id,
                  name: row.name ?? existing.name,
                  data: row.data ?? existing.data,
                },
              }
            })
          })
      .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'dnd_campaign_members',
            filter: `campaign_id=eq.${campaignId}` },
          (payload) => {
            const row = payload.new
            if (!row) return
            setMembers(prev => prev.map(m => m.id === row.id ? { ...m, ...row } : m))
          })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [campaignId, characterIds])

  // ── Combat-state writer (shared by every card) ──
  // Lives in the parent so it can do optimistic local updates on the
  // chars map — clicks feel instant even if realtime is slow / not yet
  // configured. Reverts on RPC error and surfaces the message inline.
  async function patchChar(charId, patchObj) {
    if (!charId) return
    // Snapshot for rollback.
    let snapshot
    setChars(prev => {
      snapshot = prev[charId]
      if (!snapshot?.data) return prev
      const nextStatus = { ...(snapshot.data.status || {}), ...patchObj }
      return { ...prev, [charId]: { ...snapshot, data: { ...snapshot.data, status: nextStatus } } }
    })
    try {
      await patchCombatState(charId, patchObj)
    } catch (e) {
      // Revert and surface the error as a non-fatal toast (the page
      // stays interactive, unlike a fatal load error).
      setChars(prev => snapshot ? { ...prev, [charId]: snapshot } : prev)
      setTransientError(e.message || String(e))
      setTimeout(() => setTransientError(null), 3500)
    }
  }

  if (loading) return <Shell><Loading>Lade Session…</Loading></Shell>
  if (error)   return <Shell><Loading style={{ color: 'var(--color-danger)' }}>{error}</Loading></Shell>

  return (
    <Shell>
      <div style={wrap}>
        {/* ── Header — compact so it doesn't eat vertical space ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/campaign/${campaignId}`)}>← Campaign</Button>
          <h1 style={{ margin: 0, fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-bold)', flex: 1, minWidth: 0 }}>
            Session · {campaign.name}
          </h1>
          <Button size="sm" variant="ghost" onClick={refresh} title="Stand aller Charaktere neu laden">↻</Button>
          <Button size="sm" variant="secondary" onClick={() => setShowPrefs(v => !v)}>
            ⚙ Anzeige
          </Button>
          <Button
            size="sm" variant="danger"
            onClick={async () => {
              if (!window.confirm('Session beenden? Spieler verlieren ihren „Beitreten"-Button.')) return
              try { await setSessionActive(campaignId, false) }
              catch (e) { setTransientError(e.message || String(e)); return }
              navigate(`/campaign/${campaignId}`)
            }}
            title="Markiert die Session als beendet — Spieler sehen den Beitreten-Button nicht mehr."
          >
            Session beenden
          </Button>
        </div>

        {showPrefs && (
          <Panel padding="md" style={{ marginBottom: 'var(--space-3)' }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)', marginBottom: 8 }}>
              Änderungen werden sofort übernommen und gelten auch für zukünftige Sessions
              (gleiche Einstellung wie in den DnD-Settings → Spielleiter).
            </div>
            <GmSessionPrefsEditor compact />
          </Panel>
        )}

        {transientError && (
          <div style={{
            padding: '6px 12px', marginBottom: 8,
            background: 'color-mix(in srgb, var(--color-danger) 15%, transparent)',
            color: 'var(--color-danger)', fontSize: 'var(--fs-sm)',
            border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-sm)',
          }}>⚠ {transientError}</div>
        )}

        {/* ── Character grid — tighter minmax so more cards fit before
            scroll on typical desktops (1366+) ── */}
        {members.length === 0 ? (
          <Panel padding="lg" style={{ color: 'var(--color-text-muted)', textAlign: 'center' }}>
            Keine Charaktere in dieser Campaign.
          </Panel>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 10,
          }}>
            {members.map(m => (
              <SessionCard
                key={m.id}
                member={m}
                row={chars[m.character_id]}
                onPatch={patchChar}
                onOpenSheet={() => navigate(`/campaign/${campaignId}/session/character/${m.character_id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <>
      <DndSubNav active="campaigns" />
      {children}
    </>
  )
}

function Loading({ children, style }) {
  return (
    <div style={{ ...wrap, color: 'var(--color-text-muted)', textAlign: 'center', paddingTop: 'var(--space-7)', ...style }}>
      {children}
    </div>
  )
}

// ── Card ────────────────────────────────────────────────────
// Compact layout: aimed to fit ~4 cards side-by-side at 1366×768 without
// vertical scroll for a typical 4-player party.

const PAD = 8

function SessionCard({ member, row, onPatch, onOpenSheet }) {
  const { prefs } = useSessionPrefs()
  const card = member.card || {}
  const character = row?.data

  // computeCharacter is heavy — memoise per character row.
  const computed = useMemo(() => {
    if (!character) return null
    try { return computeCharacter(character) } catch { return null }
  }, [character])

  // ── Notes (debounced autosave). Initialised once from the member row;
  //    server reloads mid-edit don't clobber what the GM is typing.
  const [notes, setNotes] = useState(member.gm_notes ?? '')
  const [savedAt, setSavedAt] = useState(null)
  const [saveErr, setSaveErr] = useState(null)
  const saveTimer = useRef(null)
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  function onNotesChange(e) {
    const v = e.target.value
    setNotes(v)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await updateMemberGmNotes(member.id, v)
        setSavedAt(Date.now()); setSaveErr(null)
      } catch (err) {
        setSaveErr(err.message || String(err))
      }
    }, 600)
  }

  // ── HP / stats ──
  const status = character?.status || {}
  const maxHP = computed?.hp?.max ?? status.maxHp ?? null
  const currentHP = status.currentHp ?? maxHP
  const tempHP = status.temporaryHp || 0
  const isDown = currentHP != null && currentHP <= 0
  const conditions = status.conditions || []
  const deathSaves = status.deathSaves || { successes: 0, failures: 0 }
  const charId = row?.id

  // Combat-state writes go through the parent (optimistic local update +
  // RPC + revert on failure). No-op if we don't have a char id yet.
  const patch = (obj) => onPatch?.(charId, obj)

  function bumpHP(delta) {
    if (currentHP == null || maxHP == null) return
    patch({ currentHp: Math.max(0, Math.min(maxHP, currentHP + delta)) })
  }
  function setDeathSave(kind, n) {
    patch({ deathSaves: { ...deathSaves, [kind]: Math.max(0, Math.min(3, n)) } })
  }
  function toggleCondition(id, on) {
    const next = on ? [...conditions.filter(x => x !== id), id] : conditions.filter(x => x !== id)
    patch({ conditions: next })
  }

  const tone = hpTone(currentHP, maxHP)

  return (
    <Panel padding="none" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top: portrait + identity (compact, 44px portrait) */}
      <div style={{ display: 'flex', gap: PAD, padding: PAD, alignItems: 'center' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 'var(--radius-sm)', flexShrink: 0, overflow: 'hidden',
          background: 'var(--color-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {/* Portrait is no longer denormalized into the card (base64 blob
              was too heavy for the dnd_campaign_members row). The GM has
              full RLS access to dnd_characters, so read it from the live
              character row instead — falls back to a sword glyph for
              members whose data isn't loaded yet. */}
          {character?.appearance?.portrait
            ? <img src={character.appearance.portrait} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontSize: 20, opacity: 0.4 }}>⚔</span>}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {card.name || row?.name || 'Unbenannt'}
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {classLine(card)}
            {card.race ? <span style={{ color: 'var(--color-text-dim)' }}> · {card.race}</span> : null}
          </div>
          {member.player_name && (
            <div style={{ color: 'var(--color-text-dim)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {member.player_name}
            </div>
          )}
        </div>
      </div>

      {/* HP row — value (+ optional Hit Dice inline) + ±1/±5 buttons.
          Hit Dice is intentionally inside the HP box rather than a
          separate tile: it's a closely related "resource" stat and the
          extra tile would push the buttons to a wrap-row on narrow cards. */}
      {character && maxHP != null && (
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 4, padding: `0 ${PAD}px ${PAD}px` }}>
          <div style={{
            flex: 1, padding: '4px 8px', borderRadius: 'var(--radius-sm)',
            background: tone === 'danger' ? 'color-mix(in srgb, var(--color-danger) 18%, transparent)'
                      : tone === 'warning' ? 'color-mix(in srgb, var(--color-warning, #d98e00) 18%, transparent)'
                      : 'var(--color-bg-sunken)',
            border: `1px solid ${tone === 'danger' ? 'var(--color-danger)'
                                : tone === 'warning' ? 'var(--color-warning, #d98e00)'
                                : 'var(--color-border)'}`,
            display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>HP</span>
            <span style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-md)' }}>{currentHP}/{maxHP}</span>
            {tempHP > 0 && <span style={{ color: 'var(--accent-green, #2d8a2d)', fontSize: 10 }}>+{tempHP}</span>}
            {prefs.stats.includes('hitDice') && computed && (() => {
              const hd = renderStat('hitDice', computed, character)
              if (!hd) return null
              return (
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>HD</span>
                  <span style={{ fontWeight: 'var(--fw-semibold)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{hd.value}</span>
                </span>
              )
            })()}
          </div>
          <HpBtn onClick={() => bumpHP(-5)}>−5</HpBtn>
          <HpBtn onClick={() => bumpHP(-1)}>−1</HpBtn>
          <HpBtn onClick={() => bumpHP(+1)}>+1</HpBtn>
          <HpBtn onClick={() => bumpHP(+5)}>+5</HpBtn>
        </div>
      )}

      {/* Death saves — only when down. Two compact pip rows. */}
      {character && isDown && (
        <div style={{ padding: `0 ${PAD}px ${PAD}px`, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 9, color: 'var(--color-text-muted)',
            textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 'var(--fw-semibold)',
          }}>
            <span>Death Saves</span>
            <DeathSaveSummary s={deathSaves} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', width: 48 }}>Success</span>
            <Pips n={3} filled={deathSaves.successes} color="var(--accent-green, #2d8a2d)" onSet={n => setDeathSave('successes', n)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', width: 48 }}>Failure</span>
            <Pips n={3} filled={deathSaves.failures} color="var(--color-danger)" onSet={n => setDeathSave('failures', n)} />
          </div>
        </div>
      )}

      {/* Stats area — ordered top-to-bottom into dedicated rows so each
          group reads as a horizontal block:
            1) AC / Speed / Initiative                (combat top-line)
            2) Passive scores                         (perception family)
            3) Spell Save DC / Spell Attack            (caster-only)
            4) Saves band                             (6 abilities)
          Each row is its own grid with exactly as many columns as it
          has visible tiles — no orphan empty cells, all equal width. */}
      {!character ? (
        <StatsHint>Charakterdaten konnten nicht geladen werden.</StatsHint>
      ) : !computed ? (
        <StatsHint>Charakter unvollständig — kein Level vergeben?</StatsHint>
      ) : (
        <>
          {/* Row 1: top combat stats */}
          <TileRow
            tiles={TOP_ROW_STATS
              .filter(id => prefs.stats.includes(id))
              .map(id => renderStat(id, computed, character, prefs))
              .filter(Boolean)}
          />
          {/* Row 2: passive scores */}
          <TileRow
            tiles={prefs.passives
              .map(id => {
                const total = passiveTotal(id, computed)
                return total == null ? null : { label: passiveLabel(id), value: total }
              })
              .filter(Boolean)}
          />
          {/* Row 3: spell stats (auto-suppressed for non-casters via renderStat) */}
          <TileRow
            tiles={SPELL_ROW_STATS
              .filter(id => prefs.stats.includes(id))
              .map(id => renderStat(id, computed, character, prefs))
              .filter(Boolean)}
          />
          {/* Row 4: saves band */}
          {prefs.stats.includes('saves') && computed?.savingThrows && (
            <SavesBand st={computed.savingThrows} />
          )}
          {/* Anything not handled above (e.g. unknown future stat ids) */}
          <TileRow
            tiles={prefs.stats
              .filter(id => !SPECIAL_STATS.has(id))
              .map(id => renderStat(id, computed, character, prefs))
              .filter(Boolean)}
          />
        </>
      )}

      {/* Conditions — chips don't break mid-word; container wraps to a
          new row only between full chips. */}
      {character && (
        <div style={{ padding: `0 ${PAD}px ${PAD}px` }}>
          <ConditionChips active={conditions} onToggle={toggleCondition} compact />
        </div>
      )}

      {/* ── Optional play-state blocks (each toggleable in GM prefs) ──
          Ordered roughly by combat relevance: concentration first, then
          economy (current-turn state), then resources (slots), then
          encumbrance + currency at the bottom. */}
      {/* Concentration is always rendered — it's THE most important combat
          state and the banner already self-suppresses when the character
          isn't concentrating, so no need for a GM toggle. */}
      {character && (
        <ConcentrationBanner concentration={character.status?.concentration} />
      )}
      {character && prefs.stats.includes('actions') && (
        <ActionEconomyStrip economy={character.status?.economy} />
      )}
      {character && prefs.stats.includes('spellSlots') && computed?.spellcasting && (
        <SpellSlotStrip character={character} />
      )}
      {character && prefs.stats.includes('encumbrance') && computed?.abilityScores && (
        <EncumbranceMini character={character} abilityScores={computed.abilityScores} />
      )}

      {/* Damage resistance / immunity / vulnerability pills — same
          component used inside the player's Overview HP card. Tucked
          into the GM card under encumbrance so the row stays compact
          and the colored pills are immediately visible above the
          lookup-category bar. */}
      {character && prefs.stats.includes('resistances') && (
        <div style={{ padding: `0 ${PAD}px ${PAD}px` }}>
          <DamageResistancePills character={character} compact />
        </div>
      )}

      {/* Currency — bottom of the card, only non-zero coins shown.
          Hover a coin to see its full name. */}
      {character && prefs.stats.includes('currency') && (
        <CurrencyStrip currency={character?.inventory?.currency} />
      )}

      {/* Lookup categories — click to expand inline. Lazy-loads the
          relevant dataset (spells / feats / class data) on first open
          via the in-module caches in SessionCardCategories. */}
      {character && <SessionCardCategories character={character} />}

      {/* Notes — single-line label, 2-row textarea, no resize handle */}
      <div style={{ padding: PAD, borderTop: '1px solid var(--color-border)' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 9, color: 'var(--color-text-muted)', marginBottom: 2,
        }}>
          <span style={{ fontWeight: 'var(--fw-semibold)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            DM-Notizen
          </span>
          <span>
            {saveErr ? <span style={{ color: 'var(--color-danger)' }}>⚠ {saveErr}</span>
             : savedAt ? <span style={{ color: 'var(--color-text-dim)' }}>gespeichert</span>
             : ' '}
          </span>
        </div>
        <textarea
          value={notes}
          onChange={onNotesChange}
          rows={2}
          placeholder="Notizen…"
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'none',
            background: 'var(--color-surface)', color: 'var(--color-text)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
            padding: '4px 8px', fontSize: 11, fontFamily: 'inherit', lineHeight: 1.4,
          }}
        />
      </div>

      {/* View-sheet button — small footer */}
      <div style={{ display: 'flex', padding: 4, borderTop: '1px solid var(--color-border)' }}>
        <Button size="sm" variant="ghost" style={{ flex: 1, height: 28 }} onClick={onOpenSheet} disabled={!character}>
          Sheet öffnen
        </Button>
      </div>
    </Panel>
  )
}

// ── Display helpers ────────────────────────────────────────

function StatsHint({ children }) {
  return (
    <div style={{
      padding: `0 ${PAD}px ${PAD}px`, color: 'var(--color-text-muted)',
      fontSize: 11, fontStyle: 'italic',
    }}>{children}</div>
  )
}

// One-row grid where the column count matches the visible tile count so
// every tile fills exactly its share of the row width — no orphan empty
// cells like the previous fixed 4-col grid produced when only 2-3 stats
// were enabled.
function TileRow({ tiles }) {
  if (!tiles?.length) return null
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))`,
      gap: 4, padding: `0 ${PAD}px ${PAD}px`,
    }}>
      {tiles.map((t, i) => <Stat key={i} label={t.label} value={t.value} tooltip={t.tooltip} />)}
    </div>
  )
}

function Stat({ label, value, tone, tooltip }) {
  return (
    <div
      title={tooltip || undefined}
      style={{
        background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-sm)',
        padding: '3px 4px', textAlign: 'center', minWidth: 0,
        cursor: tooltip ? 'help' : 'default',
        border: tone === 'danger'  ? '1px solid var(--color-danger)'
              : tone === 'warning' ? '1px solid var(--color-warning, #d98e00)'
              : '1px solid var(--color-border)',
      }}>
      <div style={{
        fontSize: 9, color: 'var(--color-text-muted)',
        textTransform: 'uppercase', letterSpacing: 0.5,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {label}{tooltip && <span style={{ marginLeft: 3, color: 'var(--color-accent)' }}>↪</span>}
      </div>
      <div style={{ fontWeight: 'var(--fw-bold)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </div>
    </div>
  )
}

function hpTone(cur, max) {
  if (cur == null || max == null || max <= 0) return null
  if (cur <= 0) return 'danger'
  const pct = cur / max
  if (pct <= 0.25) return 'danger'
  if (pct <= 0.5)  return 'warning'
  return null
}

function HpBtn({ children, onClick }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        minWidth: 28, padding: '0 6px',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-surface)', color: 'var(--color-text)',
        cursor: 'pointer', fontSize: 10, fontFamily: 'inherit',
        fontWeight: 'var(--fw-semibold)',
      }}
    >{children}</button>
  )
}

// Three-state pips for death saves. Click pip N to set count to N (or to
// N-1 if already filled, so a stray double-click can be corrected).
function Pips({ n, filled, color, onSet }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {Array.from({ length: n }, (_, i) => {
        const on = i < filled
        return (
          <button
            key={i} type="button"
            onClick={() => onSet(on && i + 1 === filled ? i : i + 1)}
            style={{
              width: 16, height: 16, borderRadius: '50%',
              border: `1.5px solid ${color}`,
              background: on ? color : 'transparent',
              cursor: 'pointer', padding: 0,
            }}
            aria-label={on ? 'tick (filled)' : 'tick (empty)'}
          />
        )
      })}
    </div>
  )
}

function DeathSaveSummary({ s }) {
  if (s.failures >= 3) return <span style={{ color: 'var(--color-danger)' }}>TOT</span>
  if (s.successes >= 3) return <span style={{ color: 'var(--accent-green, #2d8a2d)' }}>stabil</span>
  return null
}

// ── PASSIVE_OPTIONS / STAT_OPTIONS → renderers ──
// Short codes shown in the tile labels so they never wrap. The full
// label still lives in the prefs editor catalog so a new option only
// needs an entry here (PASSIVE_CODE / STAT_CODE) to flip to a 3–4
// letter abbreviation at render time.

const PASSIVE_CODE = {
  perception:    'PER',
  insight:       'INS',
  investigation: 'INV',
  stealth:       'STL',
}

const STAT_CODE = {
  ac:          'AC',
  speed:       'SPD',
  initiative:  'INIT',
  hitDice:     'HD',
  spellSave:   'DC',
  spellAttack: 'ATK',
}

// Stats with dedicated render slots — they live in their own band/row,
// not in the generic 4-col tile grid.
const TOP_ROW_STATS   = ['ac', 'speed', 'initiative']
const SPELL_ROW_STATS = ['spellSave', 'spellAttack']
// 'spellSlots', 'actions', 'concentration', 'encumbrance', 'movementModes'
// each have a dedicated render block below the tile grid — keep them out
// of the generic fallthrough row so they don't appear as empty tiles.
const CUSTOM_BLOCK_STATS = new Set([
  'spellSlots', 'actions', 'concentration', 'encumbrance', 'movementModes',
])
const SPECIAL_STATS   = new Set([
  'saves', 'hitDice', 'currency',
  ...TOP_ROW_STATS, ...SPELL_ROW_STATS, ...CUSTOM_BLOCK_STATS,
])

function passiveLabel(id) {
  return PASSIVE_CODE[id] || id.slice(0, 3).toUpperCase()
}

function passiveTotal(id, computed) {
  const skill = computed?.skills?.[id]
  if (!skill) return null
  return 10 + (skill.total ?? 0)
}

function renderStat(id, computed, character, prefs) {
  const label = STAT_CODE[id] || id.slice(0, 3).toUpperCase()
  switch (id) {
    case 'ac':         return { label, value: computed?.ac?.total ?? '—' }
    case 'speed': {
      const sp = computed?.speed
      const walk = typeof sp?.walk === 'number' ? sp.walk : (typeof sp === 'number' ? sp : null)
      if (walk == null) return { label, value: '—' }
      // movementModes pref: surface fly / swim / climb / burrow in the
      // tooltip so the GM sees them without crowding the card.
      let tooltip
      if (prefs?.stats?.includes?.('movementModes') && sp && typeof sp === 'object') {
        const extra = []
        if (sp.fly)    extra.push(`Fly ${sp.fly} ft.`)
        if (sp.swim)   extra.push(`Swim ${sp.swim} ft.`)
        if (sp.climb)  extra.push(`Climb ${sp.climb} ft.`)
        if (sp.burrow) extra.push(`Burrow ${sp.burrow} ft.`)
        if (extra.length > 0) tooltip = `Walk ${walk} ft.\n${extra.join('\n')}`
      }
      return { label, value: walk, tooltip }
    }
    case 'initiative': return { label, value: modStr(computed?.initiative ?? 0) }
    case 'hitDice': {
      const total = (character?.classes || []).reduce((s, c) => s + (c.level || 0), 0)
      const used = character?.status?.hitDiceUsed || 0
      if (total <= 0) return null
      return { label, value: `${total - used}/${total}` }
    }
    case 'spellSave': {
      const sc = computed?.spellcasting
      const dcs = sc ? Object.values(sc).map(x => x.spellSaveDC).filter(v => v != null) : []
      if (!dcs.length) return null
      return { label, value: dcs.join('/') }
    }
    case 'spellAttack': {
      const sc = computed?.spellcasting
      const atks = sc ? Object.values(sc).map(x => x.spellAttackDisplay).filter(Boolean) : []
      if (!atks.length) return null
      return { label, value: atks.join('/') }
    }
    // 'saves' + 'currency' are rendered in dedicated bands outside the tile grid.
    case 'saves':    return null
    case 'currency': return null
    default: return { label, value: '—' }
  }
}

// ── Concentration banner ─────────────────────────────────────────
// Only renders if the player is actively concentrating. Single-line,
// tinted, so the GM can spot it at a glance during combat.
function ConcentrationBanner({ concentration }) {
  // Support legacy `.name` field on older saved characters.
  const spellName = concentration?.spell || concentration?.name
  if (!spellName) return null
  return (
    <div style={{
      margin: `0 ${PAD}px ${PAD}px`, padding: '4px 8px', borderRadius: 4,
      background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
      border: '1px solid var(--color-accent)',
      color: 'var(--color-accent)', fontSize: 10, fontWeight: 'var(--fw-semibold)',
      display: 'flex', alignItems: 'center', gap: 6,
    }} title="Aktive Konzentration — bei Schaden CON-Save (DC = max(10, 1/2 Schaden))">
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: 'var(--color-accent)', boxShadow: '0 0 4px var(--color-accent)',
      }} />
      <span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>Konz:</span>
      <span style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-bold)' }}>
        {spellName}{concentration.level ? ` (Lv. ${concentration.level})` : ''}
      </span>
    </div>
  )
}

// ── Action-economy strip ──────────────────────────────────────────
// Three dots: Action / Bonus Action / Reaction. Coloured when AVAILABLE,
// crossed out when used. Pure display in the GM card (the player
// toggles them on their own sheet).
function ActionEconomyStrip({ economy }) {
  const slots = [
    { id: 'action',      label: 'A',  full: 'Action',       color: 'var(--color-danger)' },
    { id: 'bonusAction', label: 'BA', full: 'Bonus Action', color: 'var(--color-warning, #d98e00)' },
    { id: 'reaction',    label: 'R',  full: 'Reaction',     color: 'var(--color-accent)' },
  ]
  return (
    <div style={{ display: 'flex', gap: 4, padding: `0 ${PAD}px ${PAD}px` }}>
      {slots.map(s => {
        const used = !!economy?.[s.id]
        return (
          <span
            key={s.id}
            title={used ? `${s.full} verbraucht` : `${s.full} verfügbar`}
            style={{
              flex: 1, padding: '2px 0', textAlign: 'center',
              borderRadius: 4,
              border: `1px solid ${used ? 'var(--color-border)' : s.color}`,
              background: used ? 'transparent' : `color-mix(in srgb, ${s.color} 18%, transparent)`,
              color: used ? 'var(--color-text-dim)' : s.color,
              fontSize: 10, fontWeight: 'var(--fw-bold)',
              textDecoration: used ? 'line-through' : 'none', opacity: used ? 0.6 : 1,
            }}
          >{s.label}</span>
        )
      })}
    </div>
  )
}

// ── Spell-slot compact strip ──────────────────────────────────────
// One pill per level that has slots, showing "L1 4/4". Pact slot gets a
// purple pill. Wraps as needed.
function SpellSlotStrip({ character }) {
  const { slots, warlockSlots } = computeSpellSlots(character) || {}
  const used = character?.status?.usedSpellSlots || {}
  const pactUsed = character?.status?.usedPactSlots || 0

  const pills = []
  for (let i = 0; i < (slots?.length || 0); i++) {
    const max = slots[i]
    if (!max || max <= 0) continue
    const lvl = i + 1
    const remaining = max - (used[lvl] || 0)
    pills.push({
      key: `slot-${lvl}`,
      label: `L${lvl}`, value: `${remaining}/${max}`,
      empty: remaining <= 0,
      tint: 'var(--color-accent)',
    })
  }
  if (warlockSlots && warlockSlots.slots > 0) {
    pills.push({
      key: 'pact',
      label: `Pact L${warlockSlots.level}`,
      value: `${warlockSlots.slots - pactUsed}/${warlockSlots.slots}`,
      empty: (warlockSlots.slots - pactUsed) <= 0,
      tint: 'color-mix(in srgb, var(--color-accent) 50%, magenta)',
    })
  }
  if (pills.length === 0) return null
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 4,
      padding: `0 ${PAD}px ${PAD}px`, fontSize: 10,
    }}>
      {pills.map(p => (
        <span
          key={p.key}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 6px', borderRadius: 999,
            border: `1px solid ${p.empty ? 'var(--color-border)' : p.tint}`,
            background: p.empty ? 'transparent' : `color-mix(in srgb, ${p.tint} 14%, transparent)`,
            color: p.empty ? 'var(--color-text-dim)' : p.tint,
            fontWeight: 'var(--fw-semibold)', opacity: p.empty ? 0.6 : 1,
          }}
        >
          <span style={{ textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 9 }}>{p.label}</span>
          <span style={{ color: p.empty ? 'inherit' : 'var(--color-text)' }}>{p.value}</span>
        </span>
      ))}
    </div>
  )
}

// ── Encumbrance mini-bar ──────────────────────────────────────────
// Tiny horizontal bar showing carried / max. Yellow if encumbered, red
// if heavy or over. Lives near currency on the user's request — at the
// bottom of the card so it doesn't crowd combat info.
function EncumbranceMini({ character, abilityScores }) {
  const enc = computeEncumbrance(character, abilityScores)
  const colour =
    enc.state === 'over'  ? 'var(--color-danger)'
    : enc.state === 'heavy' ? 'var(--color-danger)'
    : enc.state === 'enc'   ? 'var(--color-warning, #d98e00)'
    : 'var(--color-success, #4ade80)'
  return (
    <div style={{ padding: `0 ${PAD}px ${PAD}px` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 2 }}>
        <span style={{ color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Enc</span>
        <span style={{ color: colour, fontWeight: 'var(--fw-bold)' }}>{enc.carried} / {enc.max} lb</span>
      </div>
      <div style={{ height: 4, background: 'var(--color-bg-sunken)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, enc.pct)}%`, height: '100%', background: colour, transition: 'width 200ms' }} />
      </div>
    </div>
  )
}

// Compact coin strip — number + colored dot per non-zero currency.
// Hovering shows the canonical name ("Gold", "Silver", …).
function CurrencyStrip({ currency }) {
  const cur = currency || {}
  const entries = COIN_TYPES.filter(c => (cur[c.key] || 0) > 0)
  if (entries.length === 0) return null
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 8,
      padding: `0 ${PAD}px ${PAD}px`,
      fontSize: 11, fontVariantNumeric: 'tabular-nums',
    }}>
      {entries.map(c => (
        <span
          key={c.key}
          title={c.label}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            color: 'var(--color-text)', whiteSpace: 'nowrap',
          }}
        >
          <span aria-hidden="true" style={{
            width: 8, height: 8, borderRadius: '50%',
            background: c.color, flexShrink: 0,
            border: '1px solid var(--color-border)',
          }} />
          <span style={{ fontWeight: 'var(--fw-semibold)' }}>{cur[c.key]}</span>
        </span>
      ))}
    </div>
  )
}

// Dedicated saving-throw row — 6 mini-cells, one per ability. Fixed
// equal-width columns + nowrap content guarantees clean alignment
// regardless of card width.
function SavesBand({ st }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
      gap: 3, padding: `0 ${PAD}px ${PAD}px`,
    }}>
      {ABILITY_KEYS.map(k => (
        <div key={k} style={{
          background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-sm)',
          padding: '2px 0', textAlign: 'center',
          border: '1px solid var(--color-border)',
          minWidth: 0,
        }}>
          <div style={{
            fontSize: 8, color: 'var(--color-text-muted)',
            textTransform: 'uppercase', letterSpacing: 0.5,
            whiteSpace: 'nowrap',
          }}>{k}</div>
          <div style={{ fontWeight: 'var(--fw-bold)', fontSize: 11, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            {modStr(st[k]?.total ?? 0)}
          </div>
        </div>
      ))}
    </div>
  )
}
