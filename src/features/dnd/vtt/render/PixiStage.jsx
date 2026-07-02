// React wrapper that owns one Pixi Application and the VttRenderer.
//
// Pixi v8 init is async and React 19 StrictMode double-invokes effects in dev,
// so we guard with a `cancelled` flag and fully destroy on cleanup to avoid a
// duplicate canvas / double renderer.
import { useEffect, useRef } from 'react';
import { Application } from 'pixi.js';
import { VttRenderer } from './VttRenderer';

export default function PixiStage({ onContextMenu, onTransitionPrompt, onTokenActivate, onReady }) {
  const wrapRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let app = null;       // set ONLY after init() resolves (and not cancelled)
    let renderer = null;
    const wrap = wrapRef.current;

    // Crucially: never destroy an Application before its async init() resolves
    // (Pixi's ResizePlugin throws "_cancelResize is not a function" otherwise).
    // StrictMode double-invokes this effect, so the cleanup waits on `ready`.
    const ready = (async () => {
      const a = new Application();
      // Canvas clear colour from the active NerdShelf theme (read once at init;
      // Pixi wants a concrete colour, not a CSS var).
      const themeBg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-sunken').trim();
      await a.init({
        resizeTo: wrap,
        background: themeBg || '#0b0e14',
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
        preference: 'webgl',
      });
      if (cancelled) { a.destroy(true, { children: true }); return; }
      wrap.appendChild(a.canvas);
      a.canvas.style.display = 'block';
      app = a;
      renderer = new VttRenderer(a, { onContextMenu, onTransitionPrompt, onTokenActivate });
      if (import.meta.env.DEV) window.__vttRenderer = renderer; // test/debug hook
      onReady?.(renderer);
    })();

    return () => {
      cancelled = true;
      ready.finally(() => {
        renderer?.destroy();
        if (app) app.destroy(true, { children: true });
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Must fill the stage area: Pixi's `resizeTo` measures this element, so if it
  // collapsed (no CSS) the canvas would be sized too small and clip mid-window.
  return <div ref={wrapRef} className="vtt-stage-wrap" style={{ position: 'absolute', inset: 0 }} />;
}
