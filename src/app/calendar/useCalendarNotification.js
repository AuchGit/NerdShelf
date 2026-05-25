// src/app/calendar/useCalendarNotification.js
// Watches the signed-in user's campaign events for ones happening today or
// tomorrow and exposes a `{ today, tomorrow }` flag so the calendar button
// can show a notification dot:
//
//   red    — there is at least one event today
//   yellow — there is at least one event tomorrow
//
// The check fires:
//   • once on mount,
//   • whenever the window regains focus,
//   • whenever the tab becomes visible again (mobile PWA wake-up),
//   • whenever Supabase realtime pushes an INSERT / UPDATE / DELETE on
//     dnd_events (requires the table to be in the supabase_realtime
//     publication — see dnd-campaigns-schema.sql),
//   • whenever some other component dispatches `dnd-events-changed`
//     (the campaigns lib fires this after every create/update/delete
//     of a dnd_events row — covers the "no realtime configured" case),
//   • whenever the `refreshKey` dependency bumps (used by the layout to
//     re-check after the calendar modal closes).
//
// A periodic poll used to run every 60 seconds in addition to the above
// triggers. It was dropped to stop the dnd_events table from being hit
// once per user per minute — realtime + focus/visibility already cover
// the "phone wakes up" and "GM adds an event" cases that mattered, and
// the day-rollover edge case (badge stale across midnight) is handled
// naturally by the focus event the next time the user looks at the app.
//
// All updates run silently in the background — the user never has to open
// the calendar for the badge to appear.

import { useEffect, useState } from 'react';
import { supabase } from '../../core/supabase/client';

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export const EVENTS_CHANGED = 'dnd-events-changed';

export default function useCalendarNotification(refreshKey = 0) {
  const [state, setState] = useState({ today: false, tomorrow: false });

  useEffect(() => {
    let cancelled = false;

    // Await-first so no setState runs synchronously inside the effect body.
    async function check() {
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const tomorrowStart = new Date(startOfToday); tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      const dayAfterTomorrow = new Date(startOfToday); dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

      const { data, error } = await supabase
        .from('dnd_events')
        .select('starts_at')
        .gte('starts_at', startOfToday.toISOString())
        .lt('starts_at', dayAfterTomorrow.toISOString());

      if (cancelled || error) return;

      const todayKey = dayKey(startOfToday);
      const tomorrowKey = dayKey(tomorrowStart);
      let today = false, tomorrow = false;
      for (const e of (data || [])) {
        const k = dayKey(new Date(e.starts_at));
        if (k === todayKey) today = true;
        if (k === tomorrowKey) tomorrow = true;
        if (today && tomorrow) break;
      }
      setState(prev =>
        prev.today === today && prev.tomorrow === tomorrow ? prev : { today, tomorrow }
      );
    }

    check();

    const onFocus = () => check();
    const onVisibility = () => { if (document.visibilityState === 'visible') check(); };
    const onCustom = () => check();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(EVENTS_CHANGED, onCustom);

    // Supabase realtime push: instant cross-tab, cross-user refresh.
    // Silently no-ops if dnd_events isn't in the realtime publication yet.
    const channel = supabase
      .channel('dnd-events-notif')
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'dnd_events' },
          () => check())
      .subscribe();

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(EVENTS_CHANGED, onCustom);
      supabase.removeChannel(channel);
    };
  }, [refreshKey]);

  return state;
}
