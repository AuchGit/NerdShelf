// src/shared/sharing/OpenInAppBanner.jsx
//
// A share link opened in a desktop browser: offer to continue in the
// installed desktop app instead (via the nerdshelf:// scheme). Browsers
// can't tell whether the app is installed, so this is an offer — with an
// option to always do it for future links on this computer.
//
// Not shown in the desktop app itself, in the installed web app, or on
// phones (there the installed web app catches links on its own).

import { useEffect, useState } from 'react';
import { appLinkForRoute } from './appLink';

const ALWAYS_KEY = 'nerdshelf:open-links-in-app';

function initialLink() {
  if (typeof window === 'undefined') return null;
  if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) return null;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return null;
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return null;
  } catch { /* ignore */ }
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  if (!params.has('import') && !params.has('join')) return null;
  const base = import.meta.env.BASE_URL || '/';
  const path = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  return appLinkForRoute(`${path}${search}`);
}

function readAlways() {
  try { return localStorage.getItem(ALWAYS_KEY) === '1'; } catch { return false; }
}

export default function OpenInAppBanner() {
  // Read once on first render — the dashboards strip ?import= right after.
  const [link] = useState(initialLink);
  const [always, setAlways] = useState(readAlways);
  const [closed, setClosed] = useState(false);
  // "Always" chosen earlier → the page hands over right away (effect below).
  const [opened, setOpened] = useState(() => !!link && readAlways());

  useEffect(() => {
    if (link && readAlways()) window.location.href = link;
  }, [link]);

  if (!link || closed) return null;

  const openInApp = () => {
    try { localStorage.setItem(ALWAYS_KEY, always ? '1' : '0'); } catch { /* ignore */ }
    window.location.href = link;
    setOpened(true);
  };

  return (
    <div role="dialog" aria-label="In der App öffnen" style={S.banner}>
      <div style={S.title}>
        {opened ? 'Wird in der NerdShelf-App geöffnet …' : 'In der NerdShelf-App öffnen?'}
      </div>
      <div style={S.text}>
        {opened
          ? 'Falls sich nichts tut, ist die Desktop-App hier nicht installiert — dann geht es einfach im Browser weiter.'
          : 'Du hast einen geteilten Link geöffnet. Mit installierter Desktop-App geht es dort weiter.'}
      </div>
      {!opened && (
        <label style={S.check}>
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
          Links auf diesem Computer immer in der App öffnen
        </label>
      )}
      <div style={S.actions}>
        <button type="button" style={S.btnLater} onClick={() => setClosed(true)}>
          {opened ? 'Schließen' : 'Im Browser bleiben'}
        </button>
        {!opened && (
          <button type="button" style={S.btnNow} onClick={openInApp}>In der App öffnen</button>
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
  check: {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 'var(--fs-sm)', color: 'var(--color-text)',
  },
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
