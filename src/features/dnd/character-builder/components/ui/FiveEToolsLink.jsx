// src/features/dnd/character-builder/components/ui/FiveEToolsLink.jsx
//
// A small, low-profile "↗ 5e.tools" pill that opens the matching entry
// on https://5e.tools (or https://2014.5e.tools for 5e legacy) in the
// user's browser / system browser tab. Designed to live next to the
// title of a detail panel without competing for attention.
//
// Render-nothing when the deep link can't be built (missing source).

import { buildFiveEToolsUrl } from '../../lib/fiveeToolsLink'

export default function FiveEToolsLink({ kind, name, source, edition = '5e', label, compact = false, style }) {
  const url = buildFiveEToolsUrl({ kind, name, source, edition })
  if (!url) return null
  const isLegacy = edition !== '5.5e'
  const host = isLegacy ? '2014.5e.tools' : '5e.tools'
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Auf ${host} anzeigen`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: compact ? '1px 7px' : '2px 9px',
        borderRadius: 999, fontSize: compact ? 10 : 11,
        textDecoration: 'none',
        color: 'var(--text-muted)',
        border: '1px solid var(--border)',
        background: 'transparent',
        fontFamily: 'inherit', lineHeight: 1.2,
        transition: 'color 120ms, border-color 120ms, background 120ms',
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--accent)'
        e.currentTarget.style.borderColor = 'var(--accent)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-muted)'
        e.currentTarget.style.borderColor = 'var(--border)'
      }}
    >
      <span aria-hidden="true">↗</span>
      <span>{label ?? host}</span>
    </a>
  )
}
