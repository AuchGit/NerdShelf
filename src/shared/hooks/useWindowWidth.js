// src/shared/hooks/useWindowWidth.js
import { useEffect, useState } from 'react';

const BREAKPOINT_FULL    = 1024;
const BREAKPOINT_COMPACT = 768;

function computeMode(w) {
  if (w >= BREAKPOINT_FULL) return 'full';
  if (w >= BREAKPOINT_COMPACT) return 'compact';
  return 'hidden';
}

/**
 * Tracks window.innerWidth (debounced ~100ms) and a derived sidebar mode.
 *  - >= 1024px → 'full'
 *  - 768–1023px → 'compact'
 *  - < 768px   → 'hidden'
 */
export default function useWindowWidth() {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? BREAKPOINT_FULL : window.innerWidth
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let timer = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setWidth(window.innerWidth), 100);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { width, mode: computeMode(width) };
}
