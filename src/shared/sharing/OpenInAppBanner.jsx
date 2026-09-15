// src/shared/sharing/OpenInAppBanner.jsx
//
// A share link opened in a desktop browser belongs in the installed
// desktop app. Handing it over is the DEFAULT: the page immediately opens
// the matching nerdshelf:// link and then gets out of the way.
//
// Browsers can't ask whether the app is installed, so we watch for the
// hand-over instead: launching the app takes the focus away from this tab.
// If the focus never leaves within a moment, the app isn't there — we
// remember that for this computer and stay in the browser silently.
//
// Once the app has taken over, this tab has nothing left to show. A tab
// the page opened itself can be closed outright; a tab the user opened
// from a link cannot (browsers refuse), so we say so and offer the button.
//
// Not shown in the desktop app itself, in the installed web app, or on
// phones — there the installed web app catches links on its own.

import { useCallback, useEffect, useRef, useState } from 'react';
import { appLinkForRoute } from './appLink';

const PREF_KEY    = 'nerdshelf:open-links-in-app'; // '0' → always stay in the browser
const MISSING_KEY = 'nerdshelf:app-missing';       // app didn't answer on this computer
const HANDOVER_MS = 1500;

function readFlag(key, value) {
  try { return localStorage.getItem(key) === value; } catch { return false; }
}

function writeFlag(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

/** The route of a shared link on this page, or null if this isn't one. */
function sharedRoute() {
  const { pathname, search } = window.location;
  const base = import.meta.env.BASE_URL || '/';
  const path = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const params = new URLSearchParams(search);
  // Import / join links carry their token as a query parameter…
  if (params.has('import') || params.has('join')) return `${path}${search}`;
  // …a shared deck is a route of its own, with no parameter to look for.
  if (/^\/?mtg\/deck\/view\/[^/]+/.test(path)) return `${path}${search}`;
  return null;
}

function initialLink() {
  if (typeof window === 'undefined') return null;
  if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) return null;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return null;
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return null;
  } catch { /* ignore */ }
  const route = sharedRoute();
  return route ? appLinkForRoute(route) : null;
}

export default function OpenInAppBanner() {
  // Read once on first render — the dashboards strip ?import= right after.
  const [link] = useState(initialLink);
  // 'idle' → user opted out of the automatic hand-over and can still click
  // 'trying' → link fired, waiting to see whether the app takes focus
  // 'handed' → the app answered; this tab is done
  // 'off'    → nothing to show (no app on this computer, or dismissed)
  const [phase, setPhase] = useState(() => {
    if (!link) return 'off';
    if (readFlag(PREF_KEY, '0')) return 'idle';
    if (readFlag(MISSING_KEY, '1')) return 'off';
    return 'trying';
  });
  const [closeFailed, setCloseFailed] = useState(false);
  const firedRef = useRef(false);

  const handOver = useCallback(() => {
    if (!link) return;
    setPhase('trying');
    setCloseFailed(false);
    try { window.location.href = link; } catch { /* ignore */ }
  }, [link]);

  // Fire the hand-over once, on the first render that wants it.
  useEffect(() => {
    if (phase !== 'trying' || firedRef.current) return;
    firedRef.current = true;
    try { window.location.href = link; } catch { /* ignore */ }
  }, [phase, link]);

  // The app taking over pulls the focus off this tab — that's our only
  // signal that it exists. Silence means it isn't installed.
  useEffect(() => {
    if (phase !== 'trying') return undefined;
    let done = false;
    const answered = () => {
      if (done) return;
      done = true;
      writeFlag(MISSING_KEY, '0');
      setPhase('handed');
    };
    const onVisibility = () => { if (document.hidden) answered(); };
    window.addEventListener('blur', answered);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      // No app on this computer — remember it and stop interrupting.
      writeFlag(MISSING_KEY, '1');
      setPhase('off');
    }, HANDOVER_MS);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('blur', answered);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [phase]);

  // The app has it — this tab is redundant. Closing only works for a
  // window the page opened; otherwise the user gets the note below.
  useEffect(() => {
    if (phase !== 'handed') return undefined;
    const timer = setTimeout(() => {
      try { window.close(); } catch { /* ignore */ }
      setTimeout(() => setCloseFailed(true), 300);
    }, 400);
    return () => clearTimeout(timer);
  }, [phase]);

  if (!link || phase === 'off') return null;

  const stayHere = () => {
    writeFlag(PREF_KEY, '0');
    setPhase('off');
  };

  return (
    <div role="dialog" aria-label="In der App öffnen" style={S.banner}>
      <div style={S.title}>
        {phase === 'handed' ? 'In der NerdShelf-App geöffnet' : 'Wird in der NerdShelf-App geöffnet …'}
      </div>
      <div style={S.text}>
        {phase === 'handed'
          ? (closeFailed
            ? 'Der Link läuft jetzt in der App. Diesen Tab kannst du schließen.'
            : 'Der Link läuft jetzt in der App.')
          : 'Geteilte Links öffnen in der Desktop-App. Ohne installierte App geht es hier im Browser weiter.'}
      </div>
      <div style={S.actions}>
        {phase === 'handed' ? (
          <>
            <button type="button" style={S.btnLater} onClick={() => setPhase('off')}>
              Hier weitermachen
            </button>
            <button type="button" style={S.btnNow} onClick={() => { try { window.close(); } catch { /* ignore */ } }}>
              Tab schließen
            </button>
          </>
        ) : (
          <>
            <button type="button" style={S.btnLater} onClick={stayHere}>
              Immer im Browser bleiben
            </button>
            <button type="button" style={S.btnNow} onClick={handOver}>
              Erneut versuchen
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const S = {
  banner: {
    position: 'fixed',
    left: 'var(--space-4)',
    bottom: 'var(--space-4)',
    width: 380,
    maxWidth: 'calc(100vw - 32px)',
    zIndex: 1100,
    background: 'var(--color-bg-elevated)',
    border: '1px solid var(--color-accent)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-lg)',
    padding: 'var(--space-3) var(--space-4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
  },
  title: { fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--color-text)' },
  text: { fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', lineHeight: 1.4 },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' },
  btnLater: {
    padding: '6px 12px', background: 'transparent', color: 'var(--color-text-muted)',
    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
    fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit',
  },
  btnNow: {
    padding: '6px 14px', background: 'var(--color-accent)', color: 'var(--color-accent-contrast)',
    border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)',
    fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', cursor: 'pointer', fontFamily: 'inherit',
  },
};
