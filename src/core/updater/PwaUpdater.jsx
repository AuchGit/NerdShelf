// src/core/updater/PwaUpdater.jsx
//
// Keeps the installed web app (PWA) on the latest version.
//
// A standalone PWA that's only brought back from the background never
// navigates, so the browser doesn't look for a new service worker on its
// own — updates used to need a full close + reopen. Here:
//   - check for a new version on start, whenever the app comes back to the
//     foreground, and every 20 minutes while it's visible
//   - a new version found right after start / resume, before the user has
//     touched anything and with nothing unsaved → switch over at once
//   - otherwise a small banner; bringing the app back later applies it
//     (again only with nothing unsaved)
//
// Only active in the PWA build; elsewhere `virtual:pwa-register` resolves
// to a no-op stand-in (see vite.config.js).

import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import usePwaMobile from '../../shared/hooks/usePwaMobile';
import { hasUnsavedChanges } from '../../shared/pwa/unsavedChanges';

const IS_PWA_BUILD = import.meta.env.MODE === 'pwa';
const FRESH_MS = 8000;               // "just opened" window for a silent switch
const RECHECK_MS = 20 * 60 * 1000;
const DATA_CACHE_PREFIX = 'nerdshelf-data';
const DATA_CACHE = `${DATA_CACHE_PREFIX}-${import.meta.env.VITE_APP_VERSION || 'dev'}`;

export default function PwaUpdater() {
  const [waiting, setWaiting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const applyRef = useRef(() => {});
  const { isPwaMobile } = usePwaMobile();

  useEffect(() => {
    if (!IS_PWA_BUILD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }

    let registration = null;
    let updateReady = false;
    let applying = false;
    // When the app last started or came back, and whether the user has
    // interacted since.
    let wake = { at: Date.now(), touched: false };

    const canApplyQuietly = () =>
      !wake.touched && Date.now() - wake.at < FRESH_MS && !hasUnsavedChanges();

    const updateSW = registerSW({
      immediate: true,
      onRegisteredSW(_url, reg) { registration = reg || null; },
      onNeedRefresh() {
        updateReady = true;
        if (canApplyQuietly()) apply();
        else setWaiting(true);
      },
    });

    function apply() {
      if (applying) return;
      applying = true;
      // Activates the waiting service worker and reloads the page.
      updateSW(true);
    }
    applyRef.current = apply;

    const check = () => { registration?.update().catch(() => {}); };

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      wake = { at: Date.now(), touched: false };
      if (updateReady) {
        if (!hasUnsavedChanges()) { apply(); return; }
        setDismissed(false);
      }
      check();
    };
    const onInteract = () => { wake.touched = true; };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pointerdown', onInteract, true);
    window.addEventListener('keydown', onInteract, true);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') check();
    }, RECHECK_MS);

    // Datasets are cached per app version — drop the older copies.
    if (typeof caches !== 'undefined') {
      caches.keys()
        .then(keys => Promise.all(keys
          .filter(k => k.startsWith(DATA_CACHE_PREFIX) && k !== DATA_CACHE)
          .map(k => caches.delete(k))))
        .catch(() => {});
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointerdown', onInteract, true);
      window.removeEventListener('keydown', onInteract, true);
      clearInterval(timer);
    };
  }, []);

  if (!waiting || dismissed) return null;

  const position = isPwaMobile
    ? { left: 12, right: 12, bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))' }
    : { right: 'var(--space-4)', bottom: 'var(--space-4)', width: 380 };

  return (
    <div role="status" style={{ ...S.banner, ...position }}>
      <div style={S.text}>
        <div style={S.title}>Neue Version verfügbar</div>
        <div style={S.subtitle}>
          {hasUnsavedChanges()
            ? 'Speichere zuerst deine Änderungen — dann dauert das Neuladen nur einen Moment.'
            : 'Das Neuladen dauert nur einen Moment.'}
        </div>
      </div>
      <div style={S.actions}>
        <button type="button" style={S.btnLater} onClick={() => setDismissed(true)}>Später</button>
        <button type="button" style={S.btnNow} onClick={() => applyRef.current()}>Jetzt aktualisieren</button>
      </div>
    </div>
  );
}

const S = {
  banner: {
    position: 'fixed',
    zIndex: 1100,
    maxWidth: 'calc(100vw - 24px)',
    background: 'var(--color-bg-elevated)',
    border: '1px solid var(--color-accent)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-lg)',
    padding: 'var(--space-3) var(--space-4)',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-3)',
  },
  text: { flex: '1 1 200px', minWidth: 0 },
  title: {
    fontSize: 'var(--fs-md)',
    fontWeight: 'var(--fw-semibold)',
    color: 'var(--color-text)',
  },
  subtitle: {
    fontSize: 'var(--fs-sm)',
    color: 'var(--color-text-muted)',
    marginTop: 2,
    lineHeight: 1.4,
  },
  actions: {
    display: 'flex',
    gap: 'var(--space-2)',
    marginLeft: 'auto',
  },
  btnLater: {
    padding: '8px 12px',
    background: 'transparent',
    color: 'var(--color-text-muted)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--fs-sm)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnNow: {
    padding: '8px 14px',
    background: 'var(--color-accent)',
    color: 'var(--color-accent-contrast)',
    border: '1px solid var(--color-accent)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--fs-sm)',
    fontWeight: 'var(--fw-semibold)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
