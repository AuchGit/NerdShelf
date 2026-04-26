// src/features/mtg/deck-builder/components/CollapsibleRail.jsx
import { useState } from 'react';

/**
 * Thin rail that expands into an absolute-positioned overlay panel on hover.
 * Used for the MTG preview / deck panels when the window gets too narrow to
 * show them inline.
 *
 *   side          : 'left' | 'right' — which side of the layout the rail sits on
 *   label         : vertical text shown on the rail
 *   expandedWidth : width (px) of the expanded overlay
 *   children      : the inline panel contents (CardPreview / DeckPanel)
 */
export default function CollapsibleRail({ side, label, expandedWidth, children, railWidth = 36 }) {
  const [hover, setHover] = useState(false);

  const borderSide = side === 'left' ? 'borderRight' : 'borderLeft';

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: railWidth,
        flexShrink: 0,
        position: 'relative',
        background: 'var(--bg-panel)',
        [borderSide]: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: hover ? 10 : 1,
      }}
      title={label}
    >
      <div style={{
        writingMode: 'vertical-rl',
        transform: 'rotate(180deg)',
        fontSize: 11,
        color: 'var(--text-mid)',
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        fontWeight: 600,
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </div>

      <div
        style={{
          position: 'absolute',
          top: 0,
          height: '100%',
          [side === 'left' ? 'left' : 'right']: railWidth,
          width: expandedWidth,
          background: 'var(--bg-panel)',
          [borderSide]: '1px solid var(--border)',
          boxShadow: hover
            ? (side === 'left' ? '4px 0 24px rgba(0,0,0,0.35)' : '-4px 0 24px rgba(0,0,0,0.35)')
            : 'none',
          transform: hover
            ? 'translateX(0)'
            : (side === 'left' ? 'translateX(-8px)' : 'translateX(8px)'),
          opacity: hover ? 1 : 0,
          pointerEvents: hover ? 'auto' : 'none',
          transition: 'transform 180ms ease-out, opacity 140ms ease-out',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          zIndex: 11,
        }}
      >
        {children}
      </div>
    </div>
  );
}
