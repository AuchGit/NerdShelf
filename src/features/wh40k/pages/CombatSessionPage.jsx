// src/features/wh40k/pages/CombatSessionPage.jsx
//
// Combat Helper — session detail. Responsive layout:
//
//   Desktop (≥ 1024px content width):
//     ┌──────────────────────────────────────────────────────────────┐
//     │ Header (name · round · CP/VP)                                │
//     │ Phase strip                                                  │
//     │ ┌─────── Reminders / Detachment / Notes ───┐ ┌── Units ──┐  │
//     │ │                                          │ │           │  │
//     │ └──────────────────────────────────────────┘ └───────────┘  │
//     └──────────────────────────────────────────────────────────────┘
//
//   Mobile/narrow (< 1024px):
//     - Header collapses; CP/VP counters wrap below the title
//     - Phase strip scrolls horizontally with snap points
//     - Body switches to a TAB bar (Hinweise | Detachment | Notizen | Einheiten)
//       so only one panel competes for the screen at a time
//     - Touch targets ≥ 40px (matches theme.css mobile media query)
//
// All breakpoint decisions come from the shared `useWindowWidth` hook so
// the Combat Helper feels consistent with the MTG deck builder and
// global Layout chrome.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Panel } from '../../../shared/ui';
import useWindowWidth from '../../../shared/hooks/useWindowWidth';
import usePwaMobile from '../../../shared/hooks/usePwaMobile';
import { useWh40kData } from '../hooks/useWh40kData';
import { loadSession } from '../combat/persistence';
import { PHASES, UNIT_STATUSES, nextPhase } from '../combat/schema';
import { useCombatSession } from '../combat/useCombatSession';
import { buildContext, listRemindersForPhase, reminderCountsByPhase } from '../combat/reminders';
import { detectOnceFlag } from '../combat/onceFlags';
import DetachmentInfo from '../components/DetachmentInfo';
import CombatHud from '../combat/pwa/CombatHud';
import UnitPhaseCard from '../combat/UnitPhaseCard';

/** Mobile threshold for content width (excluding sidebar). */
const NARROW_MAX = 900;

export default function CombatSessionPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { data, loading: dataLoading } = useWh40kData();
  const [session, api] = useCombatSession(null);
  const [missing, setMissing] = useState(false);

  const { contentWidth } = useWindowWidth();
  const narrow = contentWidth < NARROW_MAX;
  const { isPwaMobile } = usePwaMobile();

  // Tab state — only used in narrow mode
  const [tab, setTab] = useState('reminders'); // reminders|scoring|detachment|notes|units

  // Hydrate session on mount / id change
  useEffect(() => {
    if (!sessionId) return;
    const s = loadSession(sessionId);
    if (!s) { setMissing(true); return; }
    api.replace(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const reminderCtx = useMemo(
    () => session ? buildContext(session, data?.unitsById) : null,
    [session, data]
  );
  const phaseReminders = useMemo(
    () => (reminderCtx ? listRemindersForPhase(reminderCtx) : []),
    [reminderCtx]
  );
  const phaseCounts = useMemo(
    () => (reminderCtx ? reminderCountsByPhase(reminderCtx) : {}),
    [reminderCtx]
  );

  // Resolve detachment from the session's snapshotted army
  const detachment = (session?.detachmentId && data?.detachmentsById)
    ? data.detachmentsById[session.detachmentId]
    : null;
  const detachmentStrats = detachment ? (data?.stratagemsByDetachment?.[detachment.id] || []) : [];
  const detachmentEnhs   = detachment ? (data?.enhancementsByDetachment?.[detachment.id] || []) : [];

  if (missing) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-3)' }}>
          Combat-Sitzung nicht gefunden.
        </div>
        <Button onClick={() => navigate('/wh40k/combat')}>Zurück</Button>
      </div>
    );
  }
  if (!session || dataLoading) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>Lade…</div>;
  }

  // PWA on a phone → drop into the dedicated full-bleed companion. The
  // existing desktop two-column layout below is left untouched so anyone
  // running the Tauri shell or a normal desktop browser keeps their
  // current workflow exactly as it was.
  if (isPwaMobile) {
    return <CombatHud session={session} api={api} data={data} />;
  }

  const aliveCount = Object.values(session.units).filter(u => u.status !== 'destroyed' && u.status !== 'fled').length;
  const totalCount = Object.values(session.units).length;
  const currentPhaseLabel = PHASES.find(p => p.id === session.currentPhase)?.label || session.currentPhase;

  // Per-unit reminders now live inside each unit's UnitPhaseCard (which
  // matches the mobile companion). The left "Hinweise" panel here therefore
  // surfaces only ARMY-WIDE reminders — the global-scope ones.
  const globalReminders = phaseReminders.filter(r => r.scope === 'global');
  const remindersPanel = (
    <Panel padding={narrow ? 'sm' : 'md'} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <h3 style={sectionTitleStyle}>Hinweise · {currentPhaseLabel}</h3>
      {globalReminders.length === 0 ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
          Keine allgemeinen Hinweise für diese Phase — siehe die einzelnen Einheiten.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {globalReminders.map(r => (
            <ReminderRow
              key={`${r.id}:g`}
              reminder={r}
              unitName={null}
            />
          ))}
        </div>
      )}
    </Panel>
  );

  const scoringPanel = (
    <Panel padding={narrow ? 'sm' : 'md'} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <h3 style={sectionTitleStyle}>Punkte (VP)</h3>
      <ScoringTable
        title="Du"
        rows={session.scoring?.rows || []}
        onAdjust={(rowId, delta) => api.scoreRow('player', rowId, delta)}
        total={session.vp}
      />
      <ScoringTable
        title={session.mission?.opponentName || 'Gegner'}
        rows={session.scoring?.opponentRows || []}
        onAdjust={(rowId, delta) => api.scoreRow('opponent', rowId, delta)}
        total={session.opponentVp}
        subtle
      />
      {session.mission?.primary && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)', paddingTop: 'var(--space-2)', borderTop: '1px dashed var(--color-border)' }}>
          <strong style={{ color: 'var(--color-text)' }}>Primary:</strong> {session.mission.primary.scoring}
        </div>
      )}
    </Panel>
  );

  const detachmentPanel = (
    <DetachmentInfo
      detachment={detachment}
      abilitiesById={data?.abilitiesById || {}}
      stratagems={detachmentStrats}
      enhancements={detachmentEnhs}
      compact={narrow}
      stratagemUsage={session.stratagemUsage}
      currentRound={session.currentRound}
      cp={session.cp}
      onApplyStratagem={(strat) =>
        api.applyStratagem(strat.id, strat.cpCost || 0, strat.name)
      }
    />
  );

  const notesPanel = (
    <Panel padding={narrow ? 'sm' : 'md'} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <h3 style={sectionTitleStyle}>Phasen-Notizen</h3>
      <textarea
        value={(session.roundLog.find(r => r.round === session.currentRound)?.phases?.[session.currentPhase]?.notes) || ''}
        onChange={(e) => api.setPhaseNotes(session.currentPhase, e.target.value)}
        rows={narrow ? 6 : 4}
        placeholder="Plays, Würfelmemos, Reminder…"
        style={textareaStyle}
      />
    </Panel>
  );

  // Sort: alive first, then engaged, fled, destroyed — same order the
  // mobile companion uses, so the two surfaces feel like one product.
  const STATUS_RANK = { alive: 0, engaged: 1, fled: 2, destroyed: 3 };
  const orderedUnits = Object.values(session.units || {}).slice().sort((a, b) =>
    (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
    a.name.localeCompare(b.name)
  );

  const unitsPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minHeight: 0 }}>
      <h3 style={sectionTitleStyle}>Einheiten ({aliveCount}/{totalCount})</h3>
      {orderedUnits.length === 0 ? (
        <Panel style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
          Diese Sitzung hat keine Einheiten gespeichert.
        </Panel>
      ) : (
        orderedUnits.map(u => (
          <UnitPhaseCard
            key={u.instanceId}
            unit={u}
            canon={data?.unitsById?.[u.unitId] || null}
            phase={session.currentPhase}
            abilitiesById={data?.abilitiesById || {}}
            api={api}
            reminders={phaseReminders}
          />
        ))
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header style={headerStyle(narrow)}>
        <button onClick={() => navigate('/wh40k/combat')} style={backBtnStyle} title="Zurück">← Sitzungen</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {session.name}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
            Runde <strong style={{ color: 'var(--color-text)' }}>{session.currentRound}</strong>
            {' · '}Einheiten {aliveCount}/{totalCount}
            {session.armyName ? <> · {session.armyName}</> : null}
            {detachment ? <> · {detachment.name}</> : null}
            {session.mission?.gameSizeLabel ? <> · {session.mission.gameSizeLabel}</> : null}
            {session.mission?.primary?.name ? <> · {session.mission.primary.name}</> : null}
            {session.mission?.opponentName ? <> · vs {session.mission.opponentName}</> : null}
          </div>
        </div>
        <div style={countersGroupStyle(narrow)}>
          <Counter label="CP" value={session.cp} onAdjust={api.adjustCp} max={15} />
          <Counter label="VP" value={session.vp} onAdjust={api.adjustVp} />
          <Counter label="Gegner" value={session.opponentVp} onAdjust={api.adjustOpponentVp} subtle />
        </div>
      </header>

      {/* ── Phase strip (horizontally scrollable on mobile) ─────────────── */}
      <div style={phaseStripStyle}>
        <div style={phaseStripInnerStyle}>
          {PHASES.map(p => {
            const isActive = session.currentPhase === p.id;
            const cnt = phaseCounts[p.id] || {};
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => api.setPhase(p.id)}
                style={phaseBtnStyle(isActive, narrow)}
                title={`${p.label}${cnt.total ? ` — ${cnt.total} Hinweise` : ''}`}
              >
                <span>{narrow ? p.short : p.short}</span>
                {cnt.critical > 0 && <Pill color="var(--color-danger)">{cnt.critical}</Pill>}
                {cnt.warning > 0 && <Pill color="var(--color-warning)">{cnt.warning}</Pill>}
              </button>
            );
          })}
        </div>
        <div style={phaseNavBtnsStyle(narrow)}>
          <Button variant="secondary" size="sm" onClick={api.prevPhase}>←</Button>
          <Button size="sm" onClick={api.nextPhase}>
            {nextPhase(session.currentPhase) ? '→' : 'Runde +'}
          </Button>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      {narrow ? (
        <>
          {/* Tab bar — replaces the desktop two-column layout */}
          <div style={tabBarStyle}>
            <TabBtn active={tab === 'reminders'} onClick={() => setTab('reminders')}
              badge={phaseReminders.length}>
              Hinweise
            </TabBtn>
            <TabBtn active={tab === 'scoring'} onClick={() => setTab('scoring')}>
              VP
            </TabBtn>
            {detachment && (
              <TabBtn active={tab === 'detachment'} onClick={() => setTab('detachment')}>
                Detachment
              </TabBtn>
            )}
            <TabBtn active={tab === 'notes'} onClick={() => setTab('notes')}>
              Notizen
            </TabBtn>
            <TabBtn active={tab === 'units'} onClick={() => setTab('units')}
              badge={totalCount}>
              Einheiten
            </TabBtn>
          </div>
          <main style={narrowMainStyle}>
            {tab === 'reminders'  && remindersPanel}
            {tab === 'scoring'    && scoringPanel}
            {tab === 'detachment' && detachmentPanel}
            {tab === 'notes'      && notesPanel}
            {tab === 'units'      && unitsPanel}
          </main>
        </>
      ) : (
        <main style={wideMainStyle}>
          <section style={leftColStyle}>
            {remindersPanel}
            {scoringPanel}
            {detachment && detachmentPanel}
            {notesPanel}
          </section>
          <aside style={rightColStyle}>
            {unitsPanel}
          </aside>
        </main>
      )}
    </div>
  );
}

/* ─────────────────── sub-views ─────────────────── */

function ScoringTable({ title, rows, onAdjust, total, subtle }) {
  if (!rows.length) {
    return (
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
        Keine Mission gewählt — VP-Tracking nutzt nur Gesamtsumme.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)',
        opacity: subtle ? 0.85 : 1,
      }}>
        <strong style={{ fontSize: 'var(--fs-sm)' }}>{title}</strong>
        <span style={{ flex: 1 }} />
        <span style={{
          fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums',
          fontSize: 'var(--fs-lg)',
          color: subtle ? 'var(--color-text-muted)' : 'var(--color-accent)',
        }}>{total ?? 0}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map(r => (
          <div
            key={r.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 6px',
              background: 'var(--color-bg-sunken)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <span style={{
              flex: 1, minWidth: 0,
              fontSize: 'var(--fs-xs)',
              color: r.kind === 'primary' ? 'var(--color-accent)' : 'var(--color-text)',
              fontWeight: r.kind === 'primary' ? 'var(--fw-semibold)' : 'var(--fw-medium)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {r.kind === 'primary' ? '◆' : '◇'} {r.name}
            </span>
            <button type="button" onClick={() => onAdjust(r.id, -1)}
              style={miniBtnStyle} aria-label={`${r.name} −1`}
              disabled={r.value <= 0}>−</button>
            <span style={{
              minWidth: 44, textAlign: 'center',
              fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-semibold)',
              fontSize: 'var(--fs-sm)',
            }}>{r.value || 0}<span style={{ color: 'var(--color-text-dim)' }}>/{r.max}</span></span>
            <button type="button" onClick={() => onAdjust(r.id, +1)}
              style={miniBtnStyle} aria-label={`${r.name} +1`}
              disabled={r.value >= r.max}>+</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Counter({ label, value, onAdjust, max, subtle }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '4px 8px',
        background: subtle ? 'transparent' : 'var(--color-bg-sunken)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <button type="button" onClick={() => onAdjust(-1)} style={counterBtnStyle} aria-label={`${label} reduzieren`}>−</button>
      <span
        style={{
          minWidth: 24, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
          fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-md)',
          color: subtle ? 'var(--color-text-muted)' : 'var(--color-text)',
        }}
      >{value ?? 0}{max ? `/${max}` : ''}</span>
      <button type="button" onClick={() => onAdjust(+1)} style={counterBtnStyle} aria-label={`${label} erhöhen`}>+</button>
    </div>
  );
}

function Pill({ color, children }) {
  return (
    <span style={{
      background: `color-mix(in srgb, ${color} 22%, transparent)`,
      color, padding: '0 6px',
      fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)',
      borderRadius: 999,
    }}>{children}</span>
  );
}

function TabBtn({ active, onClick, children, badge }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={tabBtnStyle(active)}
    >
      <span>{children}</span>
      {badge > 0 && (
        <span style={{
          background: 'var(--color-bg-sunken)', color: 'var(--color-text-muted)',
          padding: '0 6px', fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)',
          borderRadius: 999, fontVariantNumeric: 'tabular-nums',
        }}>{badge}</span>
      )}
    </button>
  );
}

function ReminderRow({ reminder, unitName }) {
  const colour = {
    critical: 'var(--color-danger)',
    warning:  'var(--color-warning)',
    info:     'var(--color-text-muted)',
  }[reminder.severity] || 'var(--color-text-muted)';
  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
        padding: 'var(--space-2)',
        borderLeft: `3px solid ${colour}`,
        background: 'var(--color-bg-sunken)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <span style={{ color: colour, fontSize: 'var(--fs-md)', lineHeight: 1 }}>
        {reminder.severity === 'critical' ? '✗' : reminder.severity === 'warning' ? '!' : 'i'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)' }}>
          {reminder.title}
          {unitName && <span style={{ marginLeft: 6, color: 'var(--color-text-muted)', fontWeight: 'var(--fw-medium)' }}>· {unitName}</span>}
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>{reminder.detail}</div>
      </div>
    </div>
  );
}

/**
 * Expanded unit card. Shows the live combat state at the top (status,
 * model count, wound tracker, notes) and opens a drawer with the
 * datasheet reference + once-per-battle toggles on tap. Designed for a
 * phone-first tabletop workflow:
 *
 *   - Big ± buttons (40px) for wounds (top priority during a turn)
 *   - One-tap status switch
 *   - Drawer hides the datasheet detail until you need it
 *   - Once-per-battle / once-per-game abilities auto-surface as toggles
 */
function UnitCard({
  unit, unitCanon, narrow,
  onModelDelta, onWound, onStatus, onNotes, onToggleOnceFlag,
}) {
  const [open, setOpen] = useState(false);
  const statusMeta = UNIT_STATUSES.find(s => s.id === unit.status) || UNIT_STATUSES[0];

  // Derive ability list with once-flag detection. unitCanon contains the
  // hydrated `abilities: [{name, text}]` projection from useWh40kData.
  const onceAbilities = (unitCanon?.abilities || [])
    .map(a => ({ ability: a, flag: detectOnceFlag(a) }))
    .filter(x => x.flag);

  // For multi-wound models, the wound bar takes priority. Squads with
  // 1W models effectively just use the model counter.
  const leadMax = unit.leadWoundsMax || 1;
  const leadCur = unit.leadWoundsCurrent || 0;
  const leadRemaining = Math.max(0, leadMax - leadCur);
  const woundPct = leadMax > 0 ? (leadRemaining / leadMax) * 100 : 100;

  const destroyed = unit.status === 'destroyed' || unit.currentModels <= 0;

  return (
    <Panel padding="sm" style={{
      display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
      opacity: destroyed ? 0.55 : 1,
      borderColor: destroyed ? 'var(--color-border)' : undefined,
    }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          style={{
            flex: 1, minWidth: 0, textAlign: 'left',
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            fontFamily: 'inherit', color: 'inherit',
          }}
        >
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {unit.name}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
            {unit.role || '—'} {open ? '· ▾' : '· ▸'}
          </div>
        </button>
        <span
          style={{
            padding: '2px 8px', borderRadius: 999, fontSize: 'var(--fs-xs)',
            fontWeight: 'var(--fw-semibold)',
            background: `color-mix(in srgb, ${statusMeta.color} 16%, transparent)`,
            color: statusMeta.color,
          }}
          title={statusMeta.label}
        >{statusMeta.label}</span>
      </div>

      {/* ── Trackers row ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: leadMax > 1
          ? (narrow ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)')
          : '1fr',
        gap: 'var(--space-2)',
      }}>
        {/* Model counter */}
        <Tracker
          label="Modelle"
          value={`${unit.currentModels}/${unit.startingModels}`}
          onDec={() => onModelDelta(-1)}
          onInc={() => onModelDelta(+1)}
          decDisabled={unit.currentModels <= 0}
          incDisabled={unit.currentModels >= unit.startingModels}
        />
        {/* Wound bar (single multi-wound model OR character) */}
        {leadMax > 1 && (
          <Tracker
            label={`Wunden Lead (W ${leadMax})`}
            value={`${leadRemaining}`}
            onDec={() => onWound(+1)}
            onInc={() => onWound(-1)}
            decDisabled={destroyed}
            incDisabled={leadCur === 0 && unit.currentModels >= unit.startingModels}
            bar={woundPct}
            tone={woundPct < 50 ? 'warning' : woundPct < 25 ? 'danger' : 'success'}
            invertButtons // − applies damage, + heals
          />
        )}
      </div>

      {/* ── Status quick-switch ── */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {UNIT_STATUSES.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => onStatus(s.id)}
            style={statusBtnStyle(unit.status === s.id, s.color)}
            title={s.label}
            aria-label={s.label}
          >{s.id === unit.status ? '●' : '○'} <span style={{ fontSize: 'var(--fs-xs)' }}>{s.label}</span></button>
        ))}
      </div>

      {/* ── Notes ── */}
      <input
        type="text"
        value={unit.notes || ''}
        onChange={(e) => onNotes(e.target.value)}
        placeholder="Notiz…"
        style={{
          width: '100%',
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '6px 8px',
          fontSize: 'var(--fs-sm)',
          fontFamily: 'inherit',
          minHeight: narrow ? 40 : undefined,
        }}
      />

      {/* ── Drawer: datasheet reference ── */}
      {open && unitCanon && (
        <UnitDrawer
          unitCanon={unitCanon}
          oncePerBattleUsed={unit.oncePerBattleUsed || []}
          onToggleOnceFlag={onToggleOnceFlag}
          onceAbilities={onceAbilities}
        />
      )}
    </Panel>
  );
}

/** Reusable little ± tracker with optional progress bar (for wounds). */
function Tracker({ label, value, onDec, onInc, decDisabled, incDisabled, bar, tone, invertButtons }) {
  const toneColor = tone === 'danger'
    ? 'var(--color-danger)'
    : tone === 'warning' ? 'var(--color-warning)'
    : tone === 'success' ? 'var(--color-success)'
    : 'var(--color-accent)';
  const decLabel = invertButtons ? '−1 Wunde' : '−1';
  const incLabel = invertButtons ? 'heilen' : '+1';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      padding: '4px 6px',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--color-surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)',
          textTransform: 'uppercase', letterSpacing: 0.4, flex: 1,
        }}>{label}</span>
        <span style={{
          fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-semibold)',
          fontSize: 'var(--fs-md)', color: toneColor,
        }}>{value}</span>
      </div>
      {bar != null && (
        <div style={{
          height: 6, background: 'var(--color-bg-sunken)',
          borderRadius: 999, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${bar}%`,
            background: toneColor, transition: 'width var(--transition)',
          }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          onClick={onDec}
          disabled={decDisabled}
          style={trackerBtnStyle(decDisabled)}
          title={decLabel}
        >−</button>
        <button
          type="button"
          onClick={onInc}
          disabled={incDisabled}
          style={trackerBtnStyle(incDisabled)}
          title={incLabel}
        >+</button>
      </div>
    </div>
  );
}

/** Drawer with weapons / abilities / keywords + once-per-battle togglers. */
function UnitDrawer({ unitCanon, oncePerBattleUsed, onToggleOnceFlag, onceAbilities }) {
  const usedSet = new Set(oncePerBattleUsed);
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
      paddingTop: 'var(--space-2)',
      borderTop: '1px dashed var(--color-border)',
    }}>
      {/* Once-per-battle toggles — surfaced first because they're the
          single most-forgotten thing in a real game. */}
      {onceAbilities.length > 0 && (
        <DrawerSection title="Einmal-pro-Schlacht / Zug">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {onceAbilities.map(({ ability, flag }) => {
              const isUsed = usedSet.has(flag.key);
              return (
                <button
                  key={flag.key}
                  type="button"
                  onClick={() => onToggleOnceFlag(flag.key)}
                  style={onceFlagBtnStyle(isUsed)}
                  aria-pressed={isUsed}
                >
                  <span style={{
                    width: 18, height: 18, borderRadius: 4,
                    border: '1px solid currentColor',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 'var(--fs-xs)',
                  }}>{isUsed ? '✓' : ''}</span>
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ability.name}
                    </div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
                      {flag.label}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </DrawerSection>
      )}

      {/* Stats */}
      {unitCanon.stats?.length > 0 && (
        <DrawerSection title="Profile">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-xs)' }}>
              <thead>
                <tr>
                  <th style={drawerThStyle}>Profil</th>
                  {['M','T','Sv','W','Ld','OC'].map(c => (
                    <th key={c} style={drawerThStyle}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {unitCanon.stats.map((s, i) => (
                  <tr key={i}>
                    <td style={drawerTdStyle}>{s.name}</td>
                    <td style={drawerTdStyle}>{s.m}</td>
                    <td style={drawerTdStyle}>{s.t}</td>
                    <td style={drawerTdStyle}>{s.sv}</td>
                    <td style={drawerTdStyle}>{s.w}</td>
                    <td style={drawerTdStyle}>{s.ld}</td>
                    <td style={drawerTdStyle}>{s.oc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DrawerSection>
      )}

      {/* Weapons */}
      {unitCanon.wargear?.length > 0 && (
        <DrawerSection title={`Waffen (${unitCanon.wargear.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
            {unitCanon.wargear.map((w, i) => (
              <div key={i} style={{
                padding: '4px 8px',
                background: 'var(--color-bg-sunken)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--fs-xs)',
              }}>
                <div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--color-text)' }}>
                  {w.name}
                </div>
                <div style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {w.range || '—'} · A {w.a || '–'} · {w.bs ? `BS ${w.bs}` : w.ws ? `WS ${w.ws}` : ''} · S {w.s || '–'} · AP {w.ap || '0'} · D {w.d || '1'}
                </div>
                {w.abilities?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                    {w.abilities.slice(0, 6).map((a, j) => (
                      <span key={j} style={{
                        padding: '0 4px',
                        fontSize: 10, letterSpacing: 0.4,
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-surface)',
                        color: 'var(--color-text-muted)',
                        borderRadius: 4,
                      }}>{a}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </DrawerSection>
      )}

      {/* Abilities */}
      {unitCanon.abilities?.length > 0 && (
        <DrawerSection title={`Fähigkeiten (${unitCanon.abilities.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
            {unitCanon.abilities.map((a, i) => (
              <div key={i} style={{
                padding: '4px 8px',
                background: 'var(--color-bg-sunken)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
              }}>
                <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)' }}>{a.name}</div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>{a.text}</div>
              </div>
            ))}
          </div>
        </DrawerSection>
      )}

      {/* Keywords */}
      {unitCanon.keywords?.length > 0 && (
        <DrawerSection title="Keywords">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {unitCanon.keywords.map(k => (
              <span key={k} style={{
                padding: '0 6px', fontSize: 10, letterSpacing: 0.4,
                background: 'var(--color-surface)', color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: 4, textTransform: 'uppercase',
              }}>{k}</span>
            ))}
          </div>
        </DrawerSection>
      )}
    </div>
  );
}

function DrawerSection({ title, children }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <h4 style={{
        margin: 0, fontSize: 10, fontWeight: 'var(--fw-semibold)',
        textTransform: 'uppercase', letterSpacing: 0.6,
        color: 'var(--color-text-muted)',
      }}>{title}</h4>
      {children}
    </section>
  );
}

function trackerBtnStyle(disabled) {
  return {
    flex: 1, minHeight: 40,
    background: 'var(--color-bg-elevated)',
    color: disabled ? 'var(--color-text-dim)' : 'var(--color-text)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
  };
}

function onceFlagBtnStyle(isUsed) {
  return {
    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
    width: '100%', minHeight: 40,
    padding: 'var(--space-2)',
    background: isUsed ? 'color-mix(in srgb, var(--color-success) 14%, transparent)' : 'var(--color-bg-sunken)',
    color: isUsed ? 'var(--color-success)' : 'var(--color-text)',
    border: `1px solid ${isUsed ? 'var(--color-success)' : 'var(--color-border)'}`,
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  };
}

const drawerThStyle = {
  textAlign: 'left',
  padding: '2px 6px',
  fontSize: 10, color: 'var(--color-text-muted)',
  borderBottom: '1px solid var(--color-border)',
  textTransform: 'uppercase', letterSpacing: 0.4,
};
const drawerTdStyle = {
  padding: '2px 6px',
  borderBottom: '1px solid var(--color-border)',
  fontVariantNumeric: 'tabular-nums',
};

/* ─────────────────── styles ─────────────────── */

function headerStyle(narrow) {
  return {
    display: 'flex',
    alignItems: narrow ? 'flex-start' : 'center',
    gap: 'var(--space-3)',
    padding: narrow ? 'var(--space-2) var(--space-3)' : 'var(--space-3) var(--space-5)',
    borderBottom: '1px solid var(--color-border)',
    background: 'var(--color-bg-elevated)',
    flexWrap: 'wrap',
  };
}
function countersGroupStyle(narrow) {
  return {
    display: 'flex',
    gap: narrow ? 4 : 'var(--space-2)',
    flexWrap: 'wrap',
    width: narrow ? '100%' : undefined,
    justifyContent: narrow ? 'space-between' : 'flex-end',
  };
}
const backBtnStyle = {
  background: 'transparent', border: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)', padding: '6px 10px',
  borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)', cursor: 'pointer',
  minHeight: 32,
};
const phaseStripStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 'var(--space-2) var(--space-3)',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  position: 'sticky',
  top: 0,
  zIndex: 5,
};
const phaseStripInnerStyle = {
  display: 'flex',
  flex: 1,
  gap: 'var(--space-1)',
  overflowX: 'auto',
  scrollSnapType: 'x proximity',
  msOverflowStyle: 'none',
  scrollbarWidth: 'thin',
};
function phaseBtnStyle(active, narrow) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: narrow ? '8px 10px' : '6px 10px',
    minHeight: narrow ? 40 : 32,
    flexShrink: 0,
    scrollSnapAlign: 'start',
    background: active ? 'var(--color-bg-elevated)' : 'transparent',
    color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
    border: '1px solid',
    borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
    borderRadius: 'var(--radius-md)',
    fontWeight: active ? 'var(--fw-semibold)' : 'var(--fw-medium)',
    fontSize: 'var(--fs-sm)',
    cursor: 'pointer', fontFamily: 'inherit',
  };
}
function phaseNavBtnsStyle(narrow) {
  return {
    display: 'flex',
    gap: 4,
    flexShrink: 0,
  };
}
const tabBarStyle = {
  display: 'flex',
  gap: 4,
  padding: 'var(--space-2) var(--space-3)',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  overflowX: 'auto',
  scrollbarWidth: 'thin',
};
function tabBtnStyle(active) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 12px',
    minHeight: 40,
    background: active ? 'var(--color-bg-elevated)' : 'transparent',
    color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
    border: '1px solid',
    borderColor: active ? 'var(--color-accent)' : 'transparent',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'inherit',
    fontSize: 'var(--fs-sm)',
    fontWeight: active ? 'var(--fw-semibold)' : 'var(--fw-medium)',
    cursor: 'pointer',
    flexShrink: 0,
  };
}
const narrowMainStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  padding: 'var(--space-3)',
  minHeight: 0,
  overflowY: 'auto',
};
const wideMainStyle = {
  flex: 1,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 380px)',
  gap: 'var(--space-3)',
  padding: 'var(--space-3) var(--space-5)',
  minHeight: 0,
};
const leftColStyle = {
  display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
  minHeight: 0, overflowY: 'auto',
};
const rightColStyle = {
  display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
  minHeight: 0, overflowY: 'auto',
};
const sectionTitleStyle = {
  margin: 0,
  fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)',
  textTransform: 'uppercase', letterSpacing: 0.6,
  color: 'var(--color-text-muted)',
};
const textareaStyle = {
  width: '100%',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-2)',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  resize: 'vertical',
};
const miniBtnStyle = {
  width: 28, height: 28, padding: 0,
  background: 'var(--color-bg-elevated)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--fs-md)', lineHeight: 1, fontFamily: 'inherit',
  cursor: 'pointer',
};
const counterBtnStyle = {
  width: 32, height: 32, padding: 0,
  background: 'transparent', border: 'none',
  color: 'var(--color-text)', cursor: 'pointer',
  fontSize: 'var(--fs-md)', lineHeight: 1, fontFamily: 'inherit',
};
const touchBtnStyle = {
  width: 40, height: 40, padding: 0,
  background: 'transparent', border: 'none',
  color: 'var(--color-text)', cursor: 'pointer',
  fontSize: 'var(--fs-lg)', lineHeight: 1, fontFamily: 'inherit',
};
function statusBtnStyle(active, color) {
  return {
    width: 36, height: 36, padding: 0,
    background: active ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
    color: active ? color : 'var(--color-text-dim)',
    border: '1px solid', borderColor: active ? color : 'var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer', fontSize: 'var(--fs-md)', lineHeight: 1,
  };
}
