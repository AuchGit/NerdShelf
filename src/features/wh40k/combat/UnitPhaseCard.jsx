// src/features/wh40k/combat/UnitPhaseCard.jsx
//
// Per-unit, per-phase card. Used by both the mobile Combat HUD
// (`combat/pwa/CombatHud.jsx`) and the desktop Combat Session page
// (`pages/CombatSessionPage.jsx`) — the layout shell differs, the
// per-unit content is identical so the user gets the same surface
// to work with regardless of how they're holding the device.
//
// What the card tells the player at a glance:
//   • Status & stats — alive/engaged/destroyed, plus the lead-model
//     stat strip with the phase-relevant stats highlighted (BS in
//     Shooting, WS/T/Sv in Fight, M in Movement / Charge, …).
//   • Phase weapons — the wargear that fires THIS phase (ranged in
//     Shooting, melee in Fight). Compact one-line summary so the
//     player can pick dice without flipping to the full datasheet.
//   • Phase abilities — abilities of this unit relevant to the active
//     phase, expandable for the full effect text.
//   • Per-unit reminders — only the ones bound to this unit, from
//     the existing reminders engine.
//   • Once-per-* effects — tap-to-mark checkboxes for abilities the
//     parser detected as one-shot.
//   • Trackers — models / wounds / status pills, with the existing
//     useCombatSession action handlers.
//   • Mehr Details — full datasheet drawer (all abilities, all
//     weapons, keywords, composition).

import { useMemo, useState } from 'react';
import { UNIT_STATUSES } from './schema.js';
import { getUnitPhaseContext, flattenLeadStats } from './unitPhaseContext.js';
import './UnitPhaseCard.css';

/**
 * @param {object}   props
 * @param {object}   props.unit          live session unit (CombatUnitState)
 * @param {object}   props.canon         hydrated canonical unit (from useWh40kData)
 * @param {string}   props.phase         current phase id
 * @param {number}   [props.currentRound] active battle round (for the per-
 *                                       phase "done" marker key)
 * @param {object}   props.abilitiesById data.abilitiesById from useWh40kData
 * @param {object}   props.api           useCombatSession api
 * @param {Array}    [props.reminders]   phase reminders (we filter for this unit)
 * @param {boolean}  [props.detailsOpen] external control of the full-datasheet drawer
 * @param {Function} [props.onToggleDetails] external toggle handler
 */
export default function UnitPhaseCard({
  unit, canon, phase, currentRound = 1, abilitiesById, api,
  reminders = [],
  detailsOpen, onToggleDetails,
}) {
  // The mobile HUD passes a centralised expanded-set + toggle so the
  // body view can preserve open cards across phase switches. Desktop
  // uses local state because each unit panel is on screen all the time
  // and re-mounting isn't a concern. Either pattern works through the
  // same prop interface — we just fall back to a local useState when
  // the parent doesn't supply one.
  const [localOpen, setLocalOpen] = useState(false);
  const detailsOn = detailsOpen ?? localOpen;
  const toggleDetails = onToggleDetails ?? (() => setLocalOpen(o => !o));

  const [abilityExpanded, setAbilityExpanded] = useState(() => new Set());
  const toggleAbility = (key) => setAbilityExpanded(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const statusColor = UNIT_STATUSES.find(s => s.id === unit.status)?.color || 'var(--color-text-muted)';
  const uctx = useMemo(
    () => getUnitPhaseContext(canon, phase, abilitiesById),
    [canon, phase, abilitiesById]
  );
  const stats = canon ? flattenLeadStats(canon) : {};
  const unitReminders = reminders.filter(r => r.unitInstanceId === unit.instanceId);
  const destroyed = unit.status === 'destroyed';

  // Per-phase done state. Each (phase, round) combo gets its own marker
  // key so the marks reset naturally as the player advances through the
  // turn. Destroyed units don't need a marker — they're sunk to the
  // bottom by their status anyway.
  const phaseDoneKey = `${phase}-r${currentRound}`;
  const isPhaseDone = !!unit.phaseDone?.[phaseDoneKey];
  const togglePhaseDone = () => api?.setUnitPhaseDone?.(unit.instanceId, phaseDoneKey, !isPhaseDone);

  return (
    <div className={`ch-unit-card ${destroyed ? 'is-destroyed' : ''} ${isPhaseDone ? 'is-phase-done' : ''}`}>
      {/* ── Head: name + points + status + per-phase done marker ─── */}
      <div className="ch-unit-head">
        <span className="ch-status-dot" style={{ background: statusColor }} aria-hidden="true" />
        <span className="ch-unit-name">{unit.name}</span>
        {canon?.points > 0 && (
          <span className="ch-unit-points">{canon.points} Pkt</span>
        )}
        {!destroyed && api?.setUnitPhaseDone && (
          <button
            type="button"
            className={`ch-phase-done-pill ${isPhaseDone ? 'is-done' : ''}`}
            onClick={togglePhaseDone}
            title={isPhaseDone ? 'Wieder als offen markieren' : 'Diese Phase erledigt'}
            aria-pressed={isPhaseDone}
          >
            {isPhaseDone ? '✓ Erledigt' : 'Phase erledigen'}
          </button>
        )}
      </div>

      {/* ── Stat strip: phase-relevant stats highlighted ─────────── */}
      {canon && (
        <StatStrip stats={stats} highlight={uctx.statHighlights} />
      )}

      {/* ── Unit-bound reminders for this phase ──────────────────── */}
      {unitReminders.length > 0 && (
        <section className="ch-unit-sub">
          <div className="ch-unit-sub-head">
            <span>Reminder</span>
            <span className="ch-unit-sub-count">{unitReminders.length}</span>
          </div>
          {unitReminders.map(r => (
            <ReminderRow key={`r:${r.id}:${r.unitInstanceId}`} reminder={r} />
          ))}
        </section>
      )}

      {/* ── Phase-relevant weapons ───────────────────────────────── */}
      {uctx.relevantWeapons.length > 0 && (
        <WeaponsSection
          title={phase === 'shooting' ? 'Fernkampfwaffen' : 'Nahkampfwaffen'}
          weapons={uctx.relevantWeapons}
        />
      )}

      {/* ── Phase-relevant abilities ─────────────────────────────── */}
      {uctx.relevantAbilities.length > 0 && (
        <section className="ch-unit-sub">
          <div className="ch-unit-sub-head">
            <span>Aktive Fähigkeiten</span>
            <span className="ch-unit-sub-count">{uctx.relevantAbilities.length}</span>
          </div>
          {uctx.relevantAbilities.map(({ ability, parsed }) => {
            const key = ability.id || ability.name;
            return (
              <UnitAbilityRow
                key={`ua:${key}`}
                ability={ability}
                parsed={parsed}
                expanded={abilityExpanded.has(key)}
                onToggle={() => toggleAbility(key)}
              />
            );
          })}
        </section>
      )}

      {/* ── Once-per-* flags (this unit) ─────────────────────────── */}
      {uctx.onceFlags.length > 0 && (
        <section className="ch-unit-sub">
          <div className="ch-unit-sub-head">
            <span>Einmalige Effekte</span>
            <span className="ch-unit-sub-count">{uctx.onceFlags.length}</span>
          </div>
          {uctx.onceFlags.map(({ ability, onceFlag }) => {
            const used = (unit.oncePerBattleUsed || []).includes(onceFlag.key);
            return (
              <button
                key={`o:${onceFlag.key}`}
                type="button"
                className={`ch-once-btn ${used ? 'is-used' : ''}`}
                onClick={() => api?.toggleUnitOnceFlag?.(unit.instanceId, onceFlag.key)}
              >
                <span className="ch-once-check">{used ? '✓' : ''}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{ability.name}</div>
                  <div style={{ fontSize: 11, opacity: 0.75 }}>{onceFlag.label}</div>
                </span>
              </button>
            );
          })}
        </section>
      )}

      {/* ── Trackers ────────────────────────────────────────────── */}
      <div className="ch-unit-stats">
        <div className="ch-unit-stat">
          <span className="ch-unit-stat-label">Modelle</span>
          <button type="button" className="ch-unit-stat-btn"
            onClick={() => api?.adjustModels?.(unit.instanceId, -1)}
            disabled={unit.currentModels <= 0}>−</button>
          <span className="ch-unit-stat-value">{unit.currentModels}/{unit.startingModels}</span>
          <button type="button" className="ch-unit-stat-btn"
            onClick={() => api?.adjustModels?.(unit.instanceId, +1)}
            disabled={unit.currentModels >= unit.startingModels}>+</button>
        </div>
        <div className="ch-unit-stat">
          <span className="ch-unit-stat-label">Wunden</span>
          <button type="button" className="ch-unit-stat-btn"
            onClick={() => api?.applyWound?.(unit.instanceId, -1)}>−</button>
          <span className="ch-unit-stat-value">
            {unit.leadWoundsCurrent}/{unit.leadWoundsMax}
          </span>
          <button type="button" className="ch-unit-stat-btn"
            onClick={() => api?.applyWound?.(unit.instanceId, +1)}>+</button>
        </div>
      </div>

      <div className="ch-unit-status-row">
        {UNIT_STATUSES.map(s => (
          <button
            key={s.id}
            type="button"
            className={`ch-unit-status-chip ${unit.status === s.id ? 'is-active' : ''}`}
            onClick={() => api?.setUnitStatus?.(unit.instanceId, s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Notes input ─────────────────────────────────────────── */}
      {api?.setUnitNotes && (
        <input
          type="text"
          className="ch-unit-notes"
          value={unit.notes || ''}
          onChange={(e) => api.setUnitNotes(unit.instanceId, e.target.value)}
          placeholder="Notiz…"
        />
      )}

      {/* ── Mehr Details drawer ─────────────────────────────────── */}
      <button
        type="button"
        className="ch-unit-details-toggle"
        onClick={toggleDetails}
        aria-expanded={detailsOn}
      >
        {detailsOn ? '▴ Weniger' : '▾ Mehr Details'}
        {canon && (
          <span className="ch-unit-details-meta">
            {uctx.allAbilities.length} Fähigkeit{uctx.allAbilities.length === 1 ? '' : 'en'}
            {' · '}{uctx.allWeapons.length} Waffe{uctx.allWeapons.length === 1 ? '' : 'n'}
          </span>
        )}
      </button>
      {detailsOn && canon && (
        <FullDatasheet uctx={uctx} canon={canon} />
      )}
    </div>
  );
}

/* ─────────────────── sub-components ─────────────────── */

function StatStrip({ stats, highlight = [] }) {
  const KEYS = [
    { k: 'm',  label: 'M'  },
    { k: 't',  label: 'T'  },
    { k: 'sv', label: 'Sv' },
    { k: 'w',  label: 'W'  },
    { k: 'ld', label: 'Ld' },
    { k: 'oc', label: 'OC' },
  ];
  return (
    <div className="ch-stat-strip">
      {KEYS.map(({ k, label }) => {
        const v = stats[k];
        if (v == null || v === '') return null;
        const isHi = highlight.includes(k);
        return (
          <span key={k} className={`ch-stat-cell ${isHi ? 'is-hi' : ''}`}>
            <span className="ch-stat-label">{label}</span>
            <span className="ch-stat-value">{v}</span>
          </span>
        );
      })}
    </div>
  );
}

function WeaponsSection({ title, weapons }) {
  return (
    <section className="ch-unit-sub">
      <div className="ch-unit-sub-head">
        <span>{title}</span>
        <span className="ch-unit-sub-count">{weapons.length}</span>
      </div>
      <div className="ch-weapon-list">
        {weapons.map((w, i) => (
          <div key={`${w.name}-${i}`} className="ch-weapon-row">
            <div className="ch-weapon-name">{w.name}</div>
            <div className="ch-weapon-stats">
              <span>{w.range || '–'}</span>
              <span>A {w.a ?? '–'}</span>
              <span>{w.bs ? `BS ${w.bs}` : w.ws ? `WS ${w.ws}` : '–'}</span>
              <span>S {w.s ?? '–'}</span>
              <span>AP {w.ap ?? '–'}</span>
              <span>D {w.d ?? '–'}</span>
            </div>
            {Array.isArray(w.abilities) && w.abilities.length > 0 && (
              <div className="ch-weapon-keywords">
                {w.abilities.map((a, j) => (
                  <span key={j} className="ch-chip">{a}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function UnitAbilityRow({ ability, parsed, expanded, onToggle }) {
  return (
    <div className="ch-card is-ability" style={{ padding: 'var(--space-2)' }}>
      <button type="button"
        onClick={onToggle}
        style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left',
                 width: '100%', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
                 display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="ch-card-title" style={{ fontSize: 'var(--fs-sm)' }}>{ability.name}</span>
          <span className="ch-card-toggle" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
        </div>
        {(parsed.timing || parsed.frequency || parsed.triggers.length > 0) && (
          <div className="ch-chip-row">
            {parsed.timing === 'start' && <span className="ch-chip timing-start">Start</span>}
            {parsed.timing === 'end'   && <span className="ch-chip timing-end">Ende</span>}
            {parsed.frequency === 'battle' && <span className="ch-chip freq">1× Schlacht</span>}
            {parsed.frequency === 'turn'   && <span className="ch-chip freq">1× Zug</span>}
            {parsed.frequency === 'phase'  && <span className="ch-chip freq">1× Phase</span>}
            {parsed.triggers.map(t => (
              <span key={t.tag} className="ch-chip trigger">{t.label}</span>
            ))}
          </div>
        )}
      </button>
      {expanded && ability.text && (
        <div className="ch-card-body" style={{ marginTop: 6 }}>{ability.text}</div>
      )}
    </div>
  );
}

function ReminderRow({ reminder }) {
  const tone = reminder.severity === 'critical' ? 'is-reminder-crit'
             : reminder.severity === 'warning'  ? 'is-reminder-warn'
             :                                    'is-reminder-info';
  return (
    <div className={`ch-card ${tone}`} style={{ padding: 'var(--space-2)' }}>
      <div className="ch-card-title" style={{ fontSize: 'var(--fs-sm)' }}>
        {reminder.title}
      </div>
      {reminder.detail && (
        <div className="ch-card-body">{reminder.detail}</div>
      )}
    </div>
  );
}

function FullDatasheet({ uctx, canon }) {
  const hidden = uctx.allAbilities.filter(a => !a.isPhaseRelevant);
  const otherWeapons = (uctx.allWeapons || []).filter(w => !uctx.relevantWeapons.includes(w));
  return (
    <div className="ch-unit-details">
      {canon.keywords?.length > 0 && (
        <div className="ch-unit-keywords">
          {canon.keywords.map(k => (
            <span key={k} className="ch-chip">{k}</span>
          ))}
        </div>
      )}

      {hidden.length > 0 && (
        <section className="ch-unit-sub" style={{ marginTop: 'var(--space-2)' }}>
          <div className="ch-unit-sub-head">
            <span>Weitere Fähigkeiten</span>
            <span className="ch-unit-sub-count">{hidden.length}</span>
          </div>
          {hidden.map(({ ability, parsed }, i) => (
            <UnitAbilityRow
              key={`ux:${ability.id || ability.name}:${i}`}
              ability={ability}
              parsed={parsed}
              expanded={false}
              onToggle={() => { /* always-collapsed inside the drawer */ }}
            />
          ))}
        </section>
      )}

      {otherWeapons.length > 0 && (
        <WeaponsSection title="Weitere Waffen" weapons={otherWeapons} />
      )}

      {canon.composition?.text && (
        <div style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--color-text-muted)',
          padding: 'var(--space-2)',
          background: 'var(--color-bg-sunken)',
          borderRadius: 'var(--radius-sm)',
        }}>
          <strong>Zusammensetzung:</strong> {canon.composition.text}
        </div>
      )}
    </div>
  );
}
