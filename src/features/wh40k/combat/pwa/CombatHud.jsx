// src/features/wh40k/combat/pwa/CombatHud.jsx
//
// Full-bleed PWA Combat HUD. Mounted by CombatSessionPage only when
// usePwaMobile() reports we're in PWA-mobile mode. Desktop continues to
// use the existing two-column layout.
//
// Layout (top → bottom):
//   1. Sticky chrome — swipe-handle, title, round pill, CP/VP counters
//   2. Phase strip — horizontal scroll-snap with hit-target badges
//   3. Prev / next phase row — always-visible thumb-reachable nav
//   4. Body — switches between two views:
//        • "Kontext" : reminders → stratagems → abilities → once-flags,
//                      all filtered to the active phase by phaseContext.js
//        • "Einheiten": flat list of unit trackers (models / wounds / status)
//
// The HUD relies on the existing useCombatSession API for all mutations.
// No new persistence layer or session shape is introduced.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSwipe from '../../../../shared/hooks/useSwipe';
import useWakeLock from '../../../../shared/hooks/useWakeLock';
import usePwaMobile from '../../../../shared/hooks/usePwaMobile';
import { PHASES, UNIT_STATUSES, nextPhase, prevPhase } from '../schema.js';
import { buildPhaseContext } from '../phaseContext.js';
import { reminderCountsByPhase, buildContext as buildReminderContext } from '../reminders.js';
import { TAG_LABELS } from '../coreRules.js';
import './CombatHud.css';

const PHASE_ICONS = {
  command:  '✦',
  movement: '➤',
  shooting: '◎',
  charge:   '⚔',
  fight:    '✕',
  end:      '◇',
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

  // Keep the phone screen on for the entire combat session — the phone
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
      {/* ── Top chrome ──────────────────────────────────────── */}
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

      {/* ── Phase strip ─────────────────────────────────────── */}
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
          onClick={api.prevPhase} disabled={!prevPhase(phase)}>← Phase</button>
        <button type="button" className="ch-phase-nav-btn primary"
          onClick={api.nextPhase}>
          {nextPhase(phase) ? 'Phase →' : 'Runde + →'}
        </button>
      </div>

      {/* ── Body ────────────────────────────────────────────── */}
      {/*  Landscape: two columns, both views always visible — the phone is
          held wide, the player has room for everything at once and the
          tab toggle is redundant.
          Portrait: classic mobile pattern — one view at a time, sticky
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

/* ─────────────────── sub-views ─────────────────── */

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
            onClick={() => onAdjust(-1)} aria-label={`${label} −1`}>−</button>
          <button type="button" className="ch-counter-btn"
            onClick={() => onAdjust(+1)} aria-label={`${label} +1`}>+</button>
        </div>
      )}
    </div>
  );
}

function ContextView({ ctx, session, api, expanded, toggle, currentPhaseLabel }) {
  const { coreRules, detachmentRule, reminders, stratagems, abilities, onceFlags } = ctx;
  const totalCards =
    coreRules.length + (detachmentRule ? 1 : 0)
    + reminders.length + stratagems.length + abilities.length + onceFlags.length;
  if (totalCards === 0) {
    return (
      <div className="ch-empty">
        Keine spezifischen Hinweise für {currentPhaseLabel}.<br />
        Schaue in „Einheiten" für Trefferpunkte und Status.
      </div>
    );
  }
  return (
    <>
      {/* Core rules section — always visible at the top so the player can
          glance at "what do I do in this phase?" no matter the army. */}
      {coreRules.length > 0 && (
        <section className="ch-section">
          <div className="ch-section-head">
            <h3 className="ch-section-title">Phasen-Regeln</h3>
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

      {/* Detachment rule(s) — applies to your whole army for the whole game.
          Always visible across every phase since the rule is persistent. */}
      {detachmentRule && detachmentRule.rules?.length > 0 && (
        <section className="ch-section">
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

      {reminders.length > 0 && (
        <section className="ch-section">
          <div className="ch-section-head">
            <h3 className="ch-section-title">Reminder</h3>
            <span className="ch-section-count">{reminders.length}</span>
          </div>
          {reminders.map(r => (
            <ReminderCard
              key={`${r.id}:${r.unitInstanceId || 'g'}`}
              reminder={r}
              unitName={r.unitInstanceId ? session.units[r.unitInstanceId]?.name : null}
            />
          ))}
        </section>
      )}

      {stratagems.length > 0 && (
        <section className="ch-section">
          <div className="ch-section-head">
            <h3 className="ch-section-title">Stratagems</h3>
            <span className="ch-section-count">{stratagems.length}</span>
          </div>
          {stratagems.map(s => (
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

      {abilities.length > 0 && (
        <section className="ch-section">
          <div className="ch-section-head">
            <h3 className="ch-section-title">Aktive Fähigkeiten</h3>
            <span className="ch-section-count">{abilities.length}</span>
          </div>
          {abilities.map(({ unit, ability, parsed }) => (
            <AbilityCard
              key={`a:${unit.instanceId}:${ability.id || ability.name}`}
              unit={unit}
              ability={ability}
              parsed={parsed}
              expanded={expanded.has(`a:${unit.instanceId}:${ability.id || ability.name}`)}
              onToggle={() => toggle(`a:${unit.instanceId}:${ability.id || ability.name}`)}
            />
          ))}
        </section>
      )}

      {onceFlags.length > 0 && (
        <section className="ch-section">
          <div className="ch-section-head">
            <h3 className="ch-section-title">Einmalige Effekte</h3>
            <span className="ch-section-count">{onceFlags.length}</span>
          </div>
          {onceFlags.map(({ unit, ability, flag }) => {
            const used = (unit.oncePerBattleUsed || []).includes(flag.key);
            return (
              <button
                key={`o:${unit.instanceId}:${flag.key}`}
                type="button"
                className={`ch-once-btn ${used ? 'is-used' : ''}`}
                onClick={() => api.toggleUnitOnceFlag(unit.instanceId, flag.key)}
              >
                <span className="ch-once-check">{used ? '✓' : ''}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{ability.name}</div>
                  <div style={{ fontSize: 11, opacity: 0.75 }}>{unit.name} · {flag.label}</div>
                </span>
              </button>
            );
          })}
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
          <span className="ch-card-toggle" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
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

function DetachmentRuleCard({ rule, expanded, onToggle }) {
  return (
    <div className="ch-card is-strat">
      <button type="button"
        onClick={onToggle}
        style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left',
                 width: '100%', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
                 display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="ch-card-title">{rule.name || 'Detachment-Regel'}</span>
        <span className="ch-card-toggle" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
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
        {unitName && <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}> · {unitName}</span>}
      </div>
      <div className="ch-card-body">{reminder.detail}</div>
    </div>
  );
}

function StratagemCard({ strat, usage, currentRound, cp, expanded, onToggle, onApply }) {
  const usedThisRound = currentRound && usage?.roundUses?.[currentRound] > 0;
  const enoughCp = cp == null || cp >= (strat.cpCost || 0);
  return (
    <div
      className="ch-card is-strat"
      style={usedThisRound ? { opacity: 0.7, borderLeftColor: 'var(--color-success)' } : undefined}
    >
      <button type="button" className="ch-card-row"
        onClick={onToggle}
        style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left',
                 width: '100%', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
                 display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="ch-card-title">{strat.name}</span>
        <span className={`ch-cp-badge ${enoughCp ? '' : 'disabled'}`}>{strat.cpCost ?? 0} CP</span>
        <span className="ch-card-toggle" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
      </button>
      <div className="ch-chip-row">
        {strat.kind && <span className="ch-chip">{stratKindLabel(strat.kind)}</span>}
        {strat.phase && <span className="ch-chip">{strat.phase}</span>}
        {usedThisRound && (
          <span className="ch-chip" style={{ color: 'var(--color-success)' }}>✓ Verwendet R{currentRound}</span>
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
              ? `Erneut anwenden · ${strat.cpCost} CP`
              : enoughCp ? `Anwenden · ${strat.cpCost} CP`
                         : `Nicht genug CP (${cp}/${strat.cpCost})`}
          </button>
        </>
      )}
    </div>
  );
}

function AbilityCard({ unit, ability, parsed, expanded, onToggle }) {
  return (
    <div className="ch-card is-ability">
      <button type="button"
        onClick={onToggle}
        style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left',
                 width: '100%', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
                 display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="ch-card-title">{ability.name}</span>
          <span className="ch-card-toggle" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
        </div>
        <div className="ch-card-subtitle">{unit.name}</div>
      </button>
      <div className="ch-chip-row">
        {parsed.timing === 'start' && <span className="ch-chip timing-start">Start der Phase</span>}
        {parsed.timing === 'end'   && <span className="ch-chip timing-end">Ende der Phase</span>}
        {parsed.frequency === 'battle' && <span className="ch-chip freq">1× Schlacht</span>}
        {parsed.frequency === 'turn'   && <span className="ch-chip freq">1× Zug</span>}
        {parsed.frequency === 'phase'  && <span className="ch-chip freq">1× Phase</span>}
        {parsed.triggers.map(t => (
          <span key={t.tag} className="ch-chip trigger">{t.label}</span>
        ))}
      </div>
      {expanded && ability.text && (
        <div className="ch-card-body">{ability.text}</div>
      )}
    </div>
  );
}

function UnitsView({ session, api, data: _data }) {
  const units = Object.values(session.units || {});
  if (units.length === 0) {
    return (
      <div className="ch-empty">
        Diese Sitzung hat keine Einheiten gespeichert.
      </div>
    );
  }
  // Sort: alive first, then engaged, then fled, destroyed last.
  const STATUS_RANK = { alive: 0, engaged: 1, fled: 2, destroyed: 3 };
  const ordered = units.slice().sort((a, b) =>
    (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
    a.name.localeCompare(b.name)
  );
  return (
    <>
      {ordered.map(u => (
        <UnitTracker key={u.instanceId} unit={u} api={api} />
      ))}
    </>
  );
}

function UnitTracker({ unit, api }) {
  const statusColor = UNIT_STATUSES.find(s => s.id === unit.status)?.color || 'var(--color-text-muted)';
  return (
    <div className={`ch-unit-card ${unit.status === 'destroyed' ? 'is-destroyed' : ''}`}>
      <div className="ch-unit-head">
        <span className="ch-status-dot" style={{ background: statusColor }} aria-hidden="true" />
        <span className="ch-unit-name">{unit.name}</span>
      </div>

      <div className="ch-unit-stats">
        <div className="ch-unit-stat">
          <span className="ch-unit-stat-label">Modelle</span>
          <button type="button" className="ch-unit-stat-btn"
            onClick={() => api.adjustModels(unit.instanceId, -1)}
            disabled={unit.currentModels <= 0}>−</button>
          <span className="ch-unit-stat-value">{unit.currentModels}/{unit.startingModels}</span>
          <button type="button" className="ch-unit-stat-btn"
            onClick={() => api.adjustModels(unit.instanceId, +1)}
            disabled={unit.currentModels >= unit.startingModels}>+</button>
        </div>
        <div className="ch-unit-stat">
          <span className="ch-unit-stat-label">Wunden</span>
          <button type="button" className="ch-unit-stat-btn"
            onClick={() => api.applyWound(unit.instanceId, -1)}>−</button>
          <span className="ch-unit-stat-value">
            {unit.leadWoundsCurrent}/{unit.leadWoundsMax}
          </span>
          <button type="button" className="ch-unit-stat-btn"
            onClick={() => api.applyWound(unit.instanceId, +1)}>+</button>
        </div>
      </div>

      <div className="ch-unit-status-row">
        {UNIT_STATUSES.map(s => (
          <button
            key={s.id}
            type="button"
            className={`ch-unit-status-chip ${unit.status === s.id ? 'is-active' : ''}`}
            onClick={() => api.setUnitStatus(unit.instanceId, s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function stratKindLabel(kind) {
  return {
    'battle-tactic':  'Battle Tactic',
    'wargear':        'Wargear',
    'epic-deed':      'Epic Deed',
    'strategic-ploy': 'Strategic Ploy',
    'requisition':    'Requisition',
  }[kind] || kind;
}
