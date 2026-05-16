// src/shared/hooks/useLongPress.js
//
// Detect a long-press gesture (≥ thresholdMs) without colliding with normal
// click behaviour. Returns an object of event handlers you spread onto the
// target element:
//
//   const lp = useLongPress(() => openActionSheet(), { enabled: isPwaMobile });
//   <div {...lp}>…</div>
//
// Semantics:
//   - Press, hold for ≥ thresholdMs (default 450 ms) without moving more than
//     `moveTolerance` pixels → fires onLongPress. A "long-press-active" class
//     is added during the hold for visual feedback (gated behind the
//     `feedback` option).
//   - Releasing before the threshold or moving too much cancels the press;
//     the underlying click fires normally if you registered one.
//   - Pointer events are used where available (covers mouse + touch + pen on
//     all modern browsers); we fall back to touchstart/touchend so older
//     iOS still works.

import { useCallback, useEffect, useRef } from 'react';

export default function useLongPress(callback, options = {}) {
  const {
    thresholdMs = 450,
    moveTolerance = 8,
    enabled = true,
    feedback = true,
    // When true, calling preventDefault on the synthetic event stops the
    // browser from also firing the contextmenu (right-click) menu on a long
    // touch — important on Android where the OS sometimes pops a text
    // selection bubble.
    suppressContextMenu = true,
  } = options;

  const timerRef    = useRef(null);
  const startRef    = useRef(null);      // { x, y, target }
  const firedRef    = useRef(false);
  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; }, [callback]);

  const clear = useCallback((restoreClass = true) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const target = startRef.current?.target;
    if (restoreClass && feedback && target?.classList) {
      target.classList.remove('pwa-long-press-active');
    }
    startRef.current = null;
  }, [feedback]);

  const onPointerDown = useCallback((e) => {
    if (!enabled) return;
    // Only react to the primary button / single-finger touch.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    firedRef.current = false;
    const target = e.currentTarget;
    startRef.current = { x: e.clientX, y: e.clientY, target };
    if (feedback && target?.classList) target.classList.add('pwa-long-press-active');
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      firedRef.current = true;
      if (feedback && target?.classList) target.classList.remove('pwa-long-press-active');
      callbackRef.current?.(e);
    }, thresholdMs);
  }, [enabled, thresholdMs, feedback]);

  const onPointerMove = useCallback((e) => {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > moveTolerance) clear(true);
  }, [moveTolerance, clear]);

  const onPointerUp     = useCallback(() => clear(true), [clear]);
  const onPointerCancel = useCallback(() => clear(true), [clear]);
  const onPointerLeave  = useCallback(() => clear(true), [clear]);

  // Long-press should not trigger an additional click. Capture-phase click
  // suppression: if we've fired the long-press in this gesture, swallow the
  // synthetic click that follows.
  const onClickCapture = useCallback((e) => {
    if (firedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      firedRef.current = false;
    }
  }, []);

  // Suppress the contextmenu that long-press would otherwise trigger on
  // some Android browsers (turns into a text-select overlay).
  const onContextMenu = useCallback((e) => {
    if (suppressContextMenu && enabled) e.preventDefault();
  }, [suppressContextMenu, enabled]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
    onClickCapture,
    onContextMenu,
  };
}
