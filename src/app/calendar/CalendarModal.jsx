// src/app/calendar/CalendarModal.jsx
// Tool-wide calendar: a real month grid where today is highlighted, past
// days are dimmed, and days with events get a marker. Click any day to see
// the events on it.
//
// Events come from `dnd_events`; RLS already limits them to the user's
// campaigns, so a plain SELECT returns exactly "my" events.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../core/supabase/client';
import Modal from '../../shared/ui/Modal';

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d, n) { const x = new Date(d); x.setDate(1); x.setMonth(x.getMonth() + n); return x; }
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dayKey(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
function fmtFullDate(d) {
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

export default function CalendarModal({ open, onClose }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  const [now] = useState(() => Date.now());
  const today = useMemo(() => startOfDay(new Date(now)), [now]);

  // The month currently visible in the grid (always the 1st of some month).
  const [monthCursor, setMonthCursor] = useState(() => {
    const t = new Date(now); t.setDate(1); t.setHours(0, 0, 0, 0); return t;
  });
  // The day whose events are listed below the grid.
  const [selected, setSelected] = useState(today);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('dnd_events')
        .select('*, campaign:dnd_campaigns(name)')
        .order('starts_at', { ascending: true });
      if (cancelled) return;
      if (err) { setError(err.message); setEvents([]); return; }
      setEvents(data || []); setError(null);
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Day → events map plus the events shown for the currently-selected day.
  const { eventsByDay, selectedDayEvents } = useMemo(() => {
    const map = new Map();
    for (const e of (events || [])) {
      const key = dayKey(new Date(e.starts_at));
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    return { eventsByDay: map, selectedDayEvents: map.get(dayKey(selected)) || [] };
  }, [events, selected]);

  // 6 × 7 grid starting on the Monday on or before the 1st of monthCursor.
  const days = useMemo(() => {
    const first = new Date(monthCursor);
    const jsDow = first.getDay();              // 0=Sun … 6=Sat
    const offset = (jsDow + 6) % 7;             // days back to Monday
    const gridStart = addDays(first, -offset);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [monthCursor]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Kalender" width={620}>
      {error && <div style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-3)' }}>Fehler: {error}</div>}

      {/* Month navigation */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        marginBottom: 'var(--space-3)',
      }}>
        <button type="button" onClick={() => setMonthCursor(addMonths(monthCursor, -1))} style={navBtn} aria-label="Vorheriger Monat">‹</button>
        <div style={{ flex: 1, textAlign: 'center', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-lg)' }}>
          {MONTH_NAMES[monthCursor.getMonth()]} {monthCursor.getFullYear()}
        </div>
        <button type="button" onClick={() => setMonthCursor(addMonths(monthCursor, 1))} style={navBtn} aria-label="Nächster Monat">›</button>
        <button
          type="button"
          onClick={() => {
            const t = new Date(now); t.setDate(1); t.setHours(0, 0, 0, 0);
            setMonthCursor(t); setSelected(today);
          }}
          style={{ ...navBtn, minWidth: 60, fontSize: 'var(--fs-sm)' }}
        >
          Heute
        </button>
      </div>

      {/* Weekday header */}
      <div style={gridStyle}>
        {WEEKDAY_SHORT.map(w => (
          <div key={w} style={{
            textAlign: 'center', fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)',
            color: 'var(--color-text-muted)', padding: '4px 0',
          }}>{w}</div>
        ))}
      </div>

      {/* Day grid */}
      <div style={gridStyle}>
        {days.map(d => {
          const inMonth = d.getMonth() === monthCursor.getMonth();
          const isToday = sameDay(d, today);
          const isPast = d < today && !isToday;
          const isSelected = sameDay(d, selected);
          const evs = eventsByDay.get(dayKey(d)) || [];
          const hasUpcoming = evs.some(e => new Date(e.starts_at).getTime() >= now);

          let bg = 'transparent';
          let color = 'var(--color-text)';
          let border = '1px solid transparent';
          if (!inMonth) color = 'var(--color-text-dim)';
          if (isPast) color = 'var(--color-text-dim)';
          if (isToday) border = '1.5px solid var(--color-accent)';
          if (isSelected) {
            bg = 'var(--color-accent)';
            color = 'var(--color-accent-contrast)';
            border = '1.5px solid var(--color-accent)';
          }

          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => setSelected(startOfDay(d))}
              style={{
                aspectRatio: '1 / 1',
                background: bg,
                color,
                border,
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 'var(--fs-md)',
                fontWeight: isToday ? 'var(--fw-semibold)' : 'var(--fw-regular)',
                opacity: !inMonth ? 0.45 : isPast ? 0.55 : 1,
                position: 'relative',
                padding: 0,
                transition: 'background var(--transition), border-color var(--transition)',
              }}
            >
              {d.getDate()}
              {evs.length > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: '50%',
                    bottom: 4,
                    transform: 'translateX(-50%)',
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: isSelected
                      ? 'var(--color-accent-contrast)'
                      : hasUpcoming ? 'var(--color-accent)' : 'var(--color-text-muted)',
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Selected-day event list */}
      <div style={{ marginTop: 'var(--space-5)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-4)' }}>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
          {fmtFullDate(selected)}
        </div>
        {events === null ? (
          <div style={{ color: 'var(--color-text-muted)' }}>Lade Termine…</div>
        ) : selectedDayEvents.length === 0 ? (
          <div style={{ color: 'var(--color-text-dim)', fontStyle: 'italic' }}>
            Keine Termine an diesem Tag.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {selectedDayEvents.map(e => <EventLine key={e.id} event={e} now={now} />)}
          </div>
        )}
      </div>
    </Modal>
  );
}

function EventLine({ event, now }) {
  const past = new Date(event.starts_at).getTime() < now;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
      padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
      border: '1px solid var(--color-border)', background: 'var(--color-surface)',
      opacity: past ? 0.6 : 1,
    }}>
      <div style={{
        flexShrink: 0, fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)',
        color: 'var(--color-accent)', minWidth: 48,
      }}>
        {fmtTime(event.starts_at)}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 'var(--fw-semibold)' }}>{event.title}</div>
        <div style={{ color: 'var(--color-text-dim)', fontSize: 'var(--fs-xs)' }}>
          {event.campaign?.name || 'Campaign'}
          {event.location ? ` · ${event.location}` : ''}
        </div>
        {event.description && (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', marginTop: 2, whiteSpace: 'pre-wrap' }}>
            {event.description}
          </div>
        )}
      </div>
    </div>
  );
}

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 'var(--space-1)',
};

const navBtn = {
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '6px 10px',
  minWidth: 36,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 'var(--fs-md)',
};
