// src/features/wh40k/combat/pwa/CombatHud.jsx
//
// Full-bleed PWA Combat HUD. Mounted by CombatSessionPage only when
// usePwaMobile() reports we're in PWA-mobile mode. Desktop continues to
// use the existing two-column layout.
//
// Layout (top â†’ bottom):
//   1. Sticky chrome â€” swipe-handle, title, round pill, CP/VP counters
//   2. Phase strip â€” horizontal scroll-snap with hit-target badges
//   3. Prev / next phase row â€” always-visible thumb-reachable nav
//   4. Body â€” switches between two views:
//        â€¢ "Kontext" : reminders â†’ stratagems â†’ abilities â†’ once-flags,
//                      all filtered to the active phase by phaseContext.js
//        â€¢ "Einheiten": flat list of unit trackers (models / wounds / status)
//
// The HUD relies on the existing useCombatSession API for all mutations.
// No new persistence layer or session shape is introduced.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSwipe from '../../../../shared/hooks/useSwipe';
import useWakeLock from '../../../../shared/hooks/useWakeLock';
import usePwaMobile from '../../../../shared/hooks/usePwaMobile';
import { PHASES, nextPhase, prevPhase } from '../schema.js';
import { buildPhaseContext } from '../phaseContext.js';
import { reminderCountsByPhase, buildContext as buildReminderContext } from '../reminders.js';
import { TAG_LABELS } from '../coreRules.js';
import UnitPhaseCard from '../UnitPhaseCard.jsx';
import './CombatHud.css';

const PHASE_ICONS = {
  command:  'âœ¦',
  movement: 'âž¤',
  shooting: 'â—Ž',
  charge:   'âš”',
  fight:    'âœ•',
  end:      'â—‡',
};

export default function CombatHud({ session, api, data }) {
  const navigate = useNavigate();
  const { isLandscape } = usePwaMobile();
  const [view, setView] = useState('context'); // 'context' | 'units' (portrait-only)
  // Track which stratagem / ability card has its full text expanded.
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (key) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // Swipe-down on the chrome to leave the session (matches Match HUD).
  const topSwipe = useSwipe(
    { onSwipeDown: () => navigate('/wh40k/combat') },
    { minDistance: 60 }
  );

  // Keep the phone screen on for the entire combat session â€” the phone
  // sits face-up on the table next to the army, auto-locking would
  // force constant unlocks between phases. No-op outside of touch PWAs.
  useWakeLock(true);

  const phase = session.currentPhase;
  const ctx = useMemo(
    () => buildPhaseContext(session, data),
    [session, data]
  );
  const counts = useMemo(
    () => reminderCountsByPhase(buildReminderContext(session, data?.unitsById)),
    [session, data]
  );
  const aliveCount = Object.values(session.units || {})
    .filter(u => u.status !== 'destroyed' && u.status !== 'fled').length;
  const totalCount = Object.values(session.units || {}).length;
  const currentPhaseDef = PHASES.find(p => p.id === phase);

  return (
    <div className="ch-screen">
      {/* â”€â”€ Top chrome â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="ch-top" {...topSwipe} style={{ touchAction: 'pan-x' }}>
        <span className="pwa-swipe-handle" aria-hidden="true" />

        <div className="ch-title-row">
          <div className="ch-title-name" title={session.name}>{session.name}</div>
          <span className="ch-round-pill">R{session.currentRound}</span>
        </div>
        <div className="ch-title-meta">
          {session.armyName && <span>{session.armyName}</span>}
          {session.detachmentId && data?.detachmentsById?.[session.detachmentId] && (
            <span>{data.detachmentsById[session.detachmentId].name}</span>
          )}
          {session.mission?.primary?.name && <span>{session.mission.primary.name}</span>}
          <span>{aliveCount}/{totalCount} Einheiten</span>
        </div>

        <div className="ch-counter-row">
          <CounterTile label="CP" value={session.cp} max={15}
            accent onAdjust={api.adjustCp} />
          <CounterTile label="VP" value={session.vp}
            accent onAdjust={api.adjustVp} />
          <CounterTile label="Gegner" value={session.opponentVp}
            onAdjust={api.adjustOpponentVp} />
          <CounterTile label="Phase" value={currentPhaseDef?.short || phase}
            text onAdjust={null} />
        </div>
      </div>

      {/* â”€â”€ Phase strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="ch-phases" role="tablist">
        {PHASES.map(p => {
          const c = counts[p.id] || {};
          const active = phase === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`ch-phase ${active ? 'is-active' : ''}`}
              onClick={() => api.setPhase(p.id)}
            >
              <span className="ch-phase-icon" aria-hidden="true">{PHASE_ICONS[p.id]}</span>
              <span className="ch-phase-name">{p.short}</span>
              {(c.critical || c.warning || c.info) > 0 && (
                <span className="ch-phase-badges">
                  {c.critical > 0 && <span className="ch-phase-badge crit">{c.critical}</span>}
                  {c.warning > 0 && <span className="ch-phase-badge warn">{c.warning}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="ch-phase-nav">
        <button type="button" className="ch-phase-nav-btn"
          onClick={api.prevPhase} disabled={!prevPhase(phase)}>â† Phase</button>
        <button type="button" className="ch-phase-nav-btn primary"
          onClick={api.nextPhase}>
          {nextPhase(phase) ? 'Phase â†’' : 'Runde + â†’'}
        </button>
      </div>

      {/* â”€â”€ Body â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {/*  Landscape: two columns, both views always visible â€” the phone is
          held wide, the player has room for everything at once and the
          tab toggle is redundant.
          Portrait: classic mobile pattern â€” one view at a time, sticky
          bottom tabs to switch. */}
      <div className={`ch-body ${isLandscape ? 'ch-body-landscape' : ''}`}>
        {isLandscape ? (
          <>
            <div className="ch-body-col">
              <ContextView
                ctx={ctx}
                session={session}
                api={api}
                expanded={expanded}
                toggle={toggle}
                currentPhaseLabel={currentPhaseDef?.label}
              />
            </div>
            <div className="ch-body-col ch-body-col-right">
              <div className="ch-section-head" style={{ marginBottom: 'var(--space-2)' }}>
                <h3 className="ch-section-title">Einheiten</h3>
                <span className="ch-section-count">{aliveCount}/{totalCount}</span>
              </div>
              <UnitsView
                session={session}
                api={api}
                data={data}
                phase={phase}
                expanded={expanded}
                toggle={toggle}
                reminders={ctx.reminders}
              />
            </div>
          </>
        ) : (
          <>
            {view === 'context' ? (
              <ContextView
                ctx={ctx}
                session={session}
                api={api}
                expanded={expanded}
                toggle={toggle}
                currentPhaseLabel={currentPhaseDef?.label}
              />
            ) : (
              <UnitsView
                session={session}
                api={api}
                data={data}
                phase={phase}
                expanded={expanded}
                toggle={toggle}
                reminders={ctx.reminders}
              />
            )}

            <div className="ch-view-tabs">
              <button type="button"
                className={`ch-view-tab ${view === 'context' ? 'is-active' : ''}`}
                onClick={() => setView('context')}>
                Hinweise
                {(ctx.reminders.length + ctx.stratagems.length + ctx.abilities.length) > 0 && (
                  <span className="ch-view-tab-badge">
                    {ctx.reminders.length + ctx.stratagems.length + ctx.abilities.length}
                  </span>
                )}
              </button>
              <button type="button"
                className={`ch-view-tab ${view === 'units' ? 'is-active' : ''}`}
                onClick={() => setView('units')}>
                Einheiten
                <span className="ch-view-tab-badge">{aliveCount}/{totalCount}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ sub-views â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function CounterTile({ label, value, max, accent, text, onAdjust }) {
  return (
    <div className="ch-counter">
      <span className="ch-counter-label">{label}</span>
      <span
        className={`ch-counter-value ${accent ? 'ch-counter-accent' : ''}`}
        style={text ? { fontSize: 14, fontWeight: 700, lineHeight: 1.4 } : undefined}
      >
        {value}{max ? <span style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>/{max}</span> : null}
      </span>
      {onAdjust && (
        <div className="ch-counter-controls">
          <button type="button" className="ch-counter-btn"
            onClick={() => onAdjust(-1)} aria-label={`${label} âˆ’1`}>âˆ’</button>
          <button type="button" className="ch-counter-btn"
            onClick={() => onAdjust(+1)} aria-label={`${label} +1`}>+</button>
        </div>
      )}
    </div>
  );
}

function ContextView({ ctx, session, api, expanded, toggle, currentPhaseLabel }) {
  const { coreRules, factionRules, detachmentRule, reminders, stratagems } = ctx;
  // Per-unit reminders are rendered inside each unit's card; the context
  // column shows ARMY-WIDE reminders here (global-scope).
  const globalReminders = reminders.filter(r => r.scope === 'global');

  // Stratagems applied THIS ROUND become "active effects" the player has
  // to remember during the rest of the turn. We split the available
  // stratagems list in two so the active ones can lead the column with
  // a focused visual treatment, while the unused remainder stays
  // available but visually quieter.
  const activeStratagems = stratagems.filter(s => {
    const used = session.stratagemUsage?.[s.id]?.roundUses?.[session.currentRound];
    return used && used > 0;
  });
  const availableStratagems = stratagems.filter(s => !activeStratagems.includes(s));

  const totalCards =
    coreRules.length + (factionRules?.length || 0) + (detachmentRule ? 1 : 0)
    + globalReminders.length + activeStratagems.length + availableStratagems.length;
  if (totalCards === 0) {
    return (
      <div className="ch-empty">
        Keine allgemeinen Hinweise für {currentPhaseLabel}.<br />
        Schaue in „Einheiten" — dort siehst du pro Einheit ihre Phasen-Aktionen.
      </div>
    );
  }

  const hasFocus =
    activeStratagems.length > 0
    || (factionRules && factionRules.length > 0)
    || (detachmentRule && detachmentRule.rules?.length > 0)
    || globalReminders.length > 0;

  return (
    <>
      {/* ─── FOCUS LAYER ───────────────────────────────────────────
          Everything the player explicitly chose / triggered, plus the
          standing army rule and any state-driven reminders. This is
          the "what's special right now?" view. Comes first, brighter
          backgrounds, accent-coloured headings. */}
      {hasFocus && <div className="ch-focus-wrap">
        {/* Stratagems applied THIS round — the most volatile, action-
            relevant thing on screen. Lead with them so the player
            doesn't forget to resolve them mid-phase. */}
        {activeStratagems.length > 0 && (
          <section className="ch-section is-focus">
            <div className="ch-section-head">
              <h3 className="ch-section-title">Aktiv diese Runde</h3>
              <span className="ch-section-count">{activeStratagems.length}</span>
            </div>
            {activeStratagems.map(s => (
              <StratagemCard
                key={s.id}
                strat={s}
                usage={session.stratagemUsage?.[s.id]}
                currentRound={session.currentRound}
                cp={session.cp}
                expanded={expanded.has(`s:${s.id}`)}
                onToggle={() => toggle(`s:${s.id}`)}
                onApply={() => api.applyStratagem(s.id, s.cpCost || 0, s.name)}
                isActiveNow
              />
            ))}
          </section>
        )}

        {/* Faction army rule — Oath / Doctrina / Acts of Faith / … */}
        {factionRules && factionRules.length > 0 && (
          <section className="ch-section is-focus">
            <div className="ch-section-head">
              <h3 className="ch-section-title">Army-Regel</h3>
              <span className="ch-section-count">{factionRules.length}</span>
            </div>
            {factionRules.map(rule => (
              <FactionRuleCard
                key={rule.id}
                rule={rule}
                expanded={expanded.has(`f:${rule.id}`)}
                onToggle={() => toggle(`f:${rule.id}`)}
              />
            ))}
          </section>
        )}

        {/* Detachment rule(s) — passive, applies all game. */}
        {detachmentRule && detachmentRule.rules?.length > 0 && (
          <section className="ch-section is-focus">
            <div className="ch-section-head">
              <h3 className="ch-section-title">Detachment · {detachmentRule.name}</h3>
              <span className="ch-section-count">{detachmentRule.rules.length}</span>
            </div>
            {detachmentRule.rules.map(rule => (
              <DetachmentRuleCard
                key={rule.id}
                rule={rule}
                expanded={expanded.has(`d:${rule.id}`)}
                onToggle={() => toggle(`d:${rule.id}`)}
              />
            ))}
          </section>
        )}

        {/* State-driven reminders (CP gain, battle-shock due, …). */}
        {globalReminders.length > 0 && (
          <section className="ch-section is-focus">
            <div className="ch-section-head">
              <h3 className="ch-section-title">Reminder</h3>
              <span className="ch-section-count">{globalReminders.length}</span>
            </div>
            {globalReminders.map(r => (
              <ReminderCard
                key={`${r.id}:g`}
                reminder={r}
                unitName={null}
              />
            ))}
          </section>
        )}
      </div>}

      {/* ─── BACKGROUND LAYER ──────────────────────────────────────
          Standard rulebook and the rest of the available stratagem
          catalogue. Visually quieter so the focus layer above wins
          the eye. */}
      {coreRules.length > 0 && (
        <section className="ch-section is-secondary">
          <div className="ch-section-head">
            <h3 className="ch-section-title">Phasen-Ablauf</h3>
            <span className="ch-section-count">{coreRules.length}</span>
          </div>
          {coreRules.map(rule => (
            <CoreRuleCard
              key={rule.id}
              rule={rule}
              expanded={expanded.has(`r:${rule.id}`)}
              onToggle={() => toggle(`r:${rule.id}`)}
            />
          ))}
        </section>
      )}

      {availableStratagems.length > 0 && (
        <section className="ch-section is-secondary">
          <div className="ch-section-head">
            <h3 className="ch-section-title">Stratagems verfügbar</h3>
            <span className="ch-section-count">{availableStratagems.length}</span>
          </div>
          {availableStratagems.map(s => (
            <StratagemCard
              key={s.id}
              strat={s}
              usage={session.stratagemUsage?.[s.id]}
              currentRound={session.currentRound}
              cp={session.cp}
              expanded={expanded.has(`s:${s.id}`)}
              onToggle={() => toggle(`s:${s.id}`)}
              onApply={() => api.applyStratagem(s.id, s.cpCost || 0, s.name)}
            />
          ))}
        </section>
      )}

    </>
  );
}

function CoreRuleCard({ rule, expanded, onToggle }) {
  return (
    <div
      className={`ch-card ${rule.timing === 'start' ? 'is-reminder-info'
                          : rule.timing === 'end'   ? 'is-reminder-warn'
                          : ''}`}
    >
      <button type="button"
        onClick={onToggle}
        style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left',
                 width: '100%', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
                 display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="ch-card-title">{rule.title}</span>
          <span className="ch-card-toggle" aria-hidden="true">{expanded ? 'â–´' : 'â–¾'}</span>
        </div>
        {(rule.tags?.length > 0 || rule.timing) && (
          <div className="ch-chip-row">
            {rule.timing === 'start' && <span className="ch-chip timing-start">Phasen-Start</span>}
            {rule.timing === 'end'   && <span className="ch-chip timing-end">Phasen-Ende</span>}
            {(rule.tags || []).map(t => (
              <span key={t} className="ch-chip">{TAG_LABELS[t] || t}</span>
            ))}
          </div>
        )}
      </button>
      {expanded && (
        <div className="ch-card-body">{rule.text}</div>
      )}
    </div>
  );
}

function FactionRuleCard({ rule, expanded, onToggle }) {
  return (
    <div
      className="ch-card"
      style={{
        borderLeft: `4px solid ${
          rule.timing === 'start' ? 'var(--color-success)'
          : rule.timing === 'end'  ? 'var(--color-warning)'
          :                          'var(--color-accent)'
        }`,
      }}
    >
      <button type="button"
        onClick={onToggle}
        style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left',
                 width: '100%', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
                 display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="ch-card-title">{rule.title}</span>
          <span className="ch-card-toggle" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
        </div>
        <div className="ch-chip-row">
          {rule.timing === 'start' && <span className="ch-chip timing-start">Phasen-Start</span>}
          {rule.timing === 'end'   && <span className="ch-chip timing-end">Phasen-Ende</span>}
          {(rule.tags || []).map(t => (
            <span key={t} className="ch-chip">{TAG_LABELS[t] || t}</span>
          ))}
          {rule.name && (
            <span className="ch-chip" style={{ color: 'var(--color-accent)' }}>
              {rule.name}
            </span>
          )}
        </div>
      </button>
      {expanded && rule.text && (
        <div className="ch-card-body">{rule.text}</div>
      )}
    </div>
  );
}

function DetachmentRuleCard({ rule, expanded, onToggle }) {
  return (
    <div className="ch-card is-strat">
      <button type="button"
        onClick={onToggle}
        style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left',
                 width: '100%', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
                 display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="ch-card-title">{rule.name || 'Detachment-Regel'}</span>
        <span className="ch-card-toggle" aria-hidden="true">{expanded ? 'â–´' : 'â–¾'}</span>
      </button>
      {expanded && rule.text && (
        <div className="ch-card-body">{rule.text}</div>
      )}
    </div>
  );
}

function ReminderCard({ reminder, unitName }) {
  const klass =
    reminder.severity === 'critical' ? 'is-reminder-crit' :
    reminder.severity === 'warning'  ? 'is-reminder-warn' :
                                       'is-reminder-info';
  return (
    <div className={`ch-card ${klass}`}>
      <div className="ch-card-title">
        {reminder.title}
        {unitName && <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}> Â· {unitName}</span>}
      </div>
      <div className="ch-card-body">{reminder.detail}</div>
    </div>
  );
}

function StratagemCard({ strat, usage, currentRound, cp, expanded, onToggle, onApply, isActiveNow = false }) {
  const usedThisRound = currentRound && usage?.roundUses?.[currentRound] > 0;
  const enoughCp = cp == null || cp >= (strat.cpCost || 0);
  // When the parent flags this card as "active now", we lean into the
  // success-green treatment instead of just dimming it — the player
  // wants to SEE this card, it represents an effect currently on the
  // table.
  const cardStyle = isActiveNow
    ? { borderLeftColor: 'var(--color-success)' }
    : usedThisRound
      ? { opacity: 0.7, borderLeftColor: 'var(--color-success)' }
      : undefined;
  return (
    <div
      className={`ch-card is-strat ${isActiveNow ? 'is-active-strat' : ''}`}
      style={cardStyle}
    >
      <button type="button" className="ch-card-row"
        onClick={onToggle}
        style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left',
                 width: '100%', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
                 display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="ch-card-title">{strat.name}</span>
        <span className={`ch-cp-badge ${enoughCp ? '' : 'disabled'}`}>{strat.cpCost ?? 0} CP</span>
        <span className="ch-card-toggle" aria-hidden="true">{expanded ? 'â–´' : 'â–¾'}</span>
      </button>
      <div className="ch-chip-row">
        {strat.kind && <span className="ch-chip">{stratKindLabel(strat.kind)}</span>}
        {strat.phase && <span className="ch-chip">{strat.phase}</span>}
        {usedThisRound && (
          <span className="ch-chip" style={{ color: 'var(--color-success)' }}>âœ“ Verwendet R{currentRound}</span>
        )}
      </div>
      {expanded && (
        <>
          {strat.target && (
            <div className="ch-card-body">
              <strong style={{ color: 'var(--color-text)' }}>Ziel:</strong> {strat.target}
            </div>
          )}
          {strat.effect && <div className="ch-card-body">{strat.effect}</div>}
          {strat.restriction && (
            <div className="ch-card-body" style={{ color: 'var(--color-warning)' }}>
              {strat.restriction}
            </div>
          )}
          <button
            type="button"
            className="ch-apply-btn"
            disabled={!enoughCp}
            onClick={onApply}
          >
            {usedThisRound
              ? `Erneut anwenden Â· ${strat.cpCost} CP`
              : enoughCp ? `Anwenden Â· ${strat.cpCost} CP`
                         : `Nicht genug CP (${cp}/${strat.cpCost})`}
          </button>
        </>
      )}
    </div>
  );
}

function UnitsView({ session, api, data, phase, expanded, toggle, reminders = [] }) {
  const units = Object.values(session.units || {});
  if (units.length === 0) {
    return (
      <div className="ch-empty">
        Diese Sitzung hat keine Einheiten gespeichert.
      </div>
    );
  }
  // Sort priority:
  //   1. Phase-done units sink to the bottom (player can "work down" the
  //      list until everything is ticked).
  //   2. Within still-pending units, status rank (alive → engaged →
  //      fled → destroyed).
  //   3. Alphabetical tiebreak so the order is stable across renders.
  const STATUS_RANK = { alive: 0, engaged: 1, fled: 2, destroyed: 3 };
  const phaseKey = `${phase}-r${session.currentRound}`;
  const ordered = units.slice().sort((a, b) => {
    const aDone = !!a.phaseDone?.[phaseKey];
    const bDone = !!b.phaseDone?.[phaseKey];
    if (aDone !== bDone) return aDone ? 1 : -1;
    return (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
      a.name.localeCompare(b.name);
  });
  return (
    <>
      {ordered.map(u => (
        <UnitPhaseCard
          key={u.instanceId}
          unit={u}
          canon={data?.unitsById?.[u.unitId] || null}
          phase={phase}
          currentRound={session.currentRound}
          api={api}
          abilitiesById={data?.abilitiesById || {}}
          expanded={expanded}
          toggle={toggle}
          reminders={reminders}
        />
      ))}
    </>
  );
}

/* The per-unit card lives in ../UnitPhaseCard.jsx so the desktop
 * CombatSessionPage can share exactly the same component + styles
 * without dragging in the full-bleed phone chrome of this file. */

function stratKindLabel(kind) {
  return {
    'battle-tactic':  'Battle Tactic',
    'wargear':        'Wargear',
    'epic-deed':      'Epic Deed',
    'strategic-ploy': 'Strategic Ploy',
    'requisition':    'Requisition',
  }[kind] || kind;
}
