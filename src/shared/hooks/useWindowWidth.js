// src/shared/hooks/useWindowWidth.js
import { useEffect, useState } from 'react';

const BREAKPOINT_FULL    = 1024;
const BREAKPOINT_COMPACT = 768;

// Sidebar widths must match Sidebar.jsx
export const SIDEBAR_WIDTH = { full: 240, compact: 60, hidden: 0 };

// MTG layout thresholds (apply to *content* width = window - sidebar)
const MTG_FULL_MIN         = 1050; // both panels visible above this
const MTG_PREVIEW_RAIL_MIN = 750;  // preview rail; deck still visible

function computeMode(w) {
  if (w >= BREAKPOINT_FULL) return 'full';
  if (w >= BREAKPOINT_COMPACT) return 'compact';
  return 'hidden';
}

function computeMtgMode(contentWidth) {
  if (contentWidth >= MTG_FULL_MIN) return 'full';
  if (contentWidth >= MTG_PREVIEW_RAIL_MIN) return 'preview-rail';
  return 'both-rails';
}

/**
 * Tracks window.innerWidth (debounced ~100ms) plus derived sidebar mode,
 * available content width (window - sidebar) and MTG layout mode.
 *
 *   Sidebar:
 *     >= 1024px → 'full'    (sidebar 240px)
 *     768–1023px → 'compact' (sidebar 60px)
 *     < 768px   → 'hidden'  (sidebar 0px, overlay via hamburger)
 *
 *   MTG:
 *     contentWidth >= 1050 → 'full'         (preview + deck both visible)
 *     750–1049px           → 'preview-rail' (preview as hover rail)
 *     < 750px              → 'both-rails'   (preview + deck as hover rails)
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

  const mode = computeMode(width);
  const contentWidth = Math.max(0, width - SIDEBAR_WIDTH[mode]);
  const mtgMode = computeMtgMode(contentWidth);

  return { width, mode, contentWidth, mtgMode };
}
