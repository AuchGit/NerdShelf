// src/shared/hooks/useSwipe.js
//
// Lightweight swipe detection. Spreads handlers onto a target element and
// fires the appropriate callback when the gesture exceeds a distance + speed
// threshold along the matching axis.
//
//   const sw = useSwipe({
//     onSwipeLeft:  () => deleteItem(),
//     onSwipeDown:  () => dismiss(),
//   }, { enabled: isPwaMobile });
//   <div {...sw}>…</div>
//
// Notes:
//   - Distance: 60 px default; the dominant axis (h or v) wins.
//   - Velocity: ignored gestures slower than 0.25 px/ms feel sluggish on
//     phones; the threshold filters that out by default.
//   - We don't preventDefault on pointermove — letting the page scroll
//     normally if the gesture isn't decisively horizontal feels much more
//     native than fighting the browser. Cards with `touch-action: pan-y`
//     declare their intent to the browser ahead of time.

import { useCallback, useEffect, useRef } from 'react';

export default function useSwipe(callbacks, options = {}) {
  const {
    minDistance = 60,
    minVelocity = 0.25,        // px / ms
    maxCrossAxis = 60,         // ignore if the gesture also goes too far on the perpendicular axis
    enabled = true,
  } = options;

  const cbRef = useRef(callbacks);
  useEffect(() => { cbRef.current = callbacks; }, [callbacks]);

  const startRef = useRef(null);

  const onPointerDown = useCallback((e) => {
    if (!enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  }, [enabled]);

  const onPointerUp = useCallback((e) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dt = Math.max(1, Date.now() - start.t);
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const cb = cbRef.current || {};

    if (absX > absY) {
      // Horizontal-dominant
      if (absX < minDistance) return;
      if (absY > maxCrossAxis) return;
      if (absX / dt < minVelocity) return;
      if (dx > 0) cb.onSwipeRight?.(e);
      else        cb.onSwipeLeft?.(e);
    } else {
      // Vertical-dominant
      if (absY < minDistance) return;
      if (absX > maxCrossAxis) return;
      if (absY / dt < minVelocity) return;
      if (dy > 0) cb.onSwipeDown?.(e);
      else        cb.onSwipeUp?.(e);
    }
  }, [minDistance, minVelocity, maxCrossAxis]);

  const onPointerCancel = useCallback(() => { startRef.current = null; }, []);

  return { onPointerDown, onPointerUp, onPointerCancel };
}
