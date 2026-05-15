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
import { useWh40kData } from '../hooks/useWh40kData';
import { loadSession } from '../combat/persistence';
import { PHASES, UNIT_STATUSES, nextPhase } from '../combat/schema';
import { useCombatSession } from '../combat/useCombatSession';
import { buildContext, listRemindersForPhase, reminderCountsByPhase } from '../combat/reminders';
import DetachmentInfo from '../components/DetachmentInfo';

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

  // Tab state — only used in narrow mode
  const [tab, setTab] = useState('reminders'); // reminders|detachment|notes|units

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

  const aliveCount = Object.values(session.units).filter(u => u.status !== 'destroyed' && u.status !== 'fled').length;
  const totalCount = Object.values(session.units).length;
  const currentPhaseLabel = PHASES.find(p => p.id === session.currentPhase)?.label || session.currentPhase;

  // Reusable content panels — composed differently per layout
  const remindersPanel = (
    <Panel padding={narrow ? 'sm' : 'md'} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <h3 style={sectionTitleStyle}>Hinweise · {currentPhaseLabel}</h3>
      {phaseReminders.length === 0 ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
          Keine aktiven Hinweise für diese Phase.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {phaseReminders.map(r => (
            <ReminderRow
              key={`${r.id}:${r.unitInstanceId || 'g'}`}
              reminder={r}
              unitName={r.unitInstanceId ? session.units[r.unitInstanceId]?.name : null}
            />
          ))}
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

  const unitsPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minHeight: 0 }}>
      <h3 style={sectionTitleStyle}>Einheiten ({aliveCount}/{totalCount})</h3>
      {Object.values(session.units).length === 0 ? (
        <Panel style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
          Diese Sitzung hat keine Einheiten gespeichert.
        </Panel>
      ) : (
        Object.values(session.units).map(u => (
          <UnitCard
            key={u.instanceId}
            unit={u}
            narrow={narrow}
            onModelDelta={(d) => api.adjustModels(u.instanceId, d)}
            onStatus={(s) => api.setUnitStatus(u.instanceId, s)}
            onNotes={(n) => api.setUnitNotes(u.instanceId, n)}
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
            {tab === 'detachment' && detachmentPanel}
            {tab === 'notes'      && notesPanel}
            {tab === 'units'      && unitsPanel}
          </main>
        </>
      ) : (
        <main style={wideMainStyle}>
          <section style={leftColStyle}>
            {remindersPanel}
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

function UnitCard({ unit, narrow, onModelDelta, onStatus, onNotes }) {
  const statusMeta = UNIT_STATUSES.find(s => s.id === unit.status) || UNIT_STATUSES[0];
  return (
    <Panel padding="sm" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {unit.name}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
            {unit.role || '—'}
          </div>
        </div>
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

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        flexWrap: narrow ? 'wrap' : 'nowrap',
      }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 2,
            background: 'var(--color-surface)',
          }}
        >
          <button type="button" onClick={() => onModelDelta(-1)} style={touchBtnStyle} aria-label="Modell entfernen">−</button>
          <span style={{
            minWidth: 56, textAlign: 'center',
            fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-semibold)',
          }}>{unit.currentModels}/{unit.startingModels}</span>
          <button type="button" onClick={() => onModelDelta(+1)} style={touchBtnStyle} aria-label="Modell hinzufügen">+</button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {UNIT_STATUSES.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => onStatus(s.id)}
              style={statusBtnStyle(unit.status === s.id, s.color)}
              title={s.label}
              aria-label={s.label}
            >{s.id === unit.status ? '●' : '○'}</button>
          ))}
        </div>
      </div>

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
    </Panel>
  );
}

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
