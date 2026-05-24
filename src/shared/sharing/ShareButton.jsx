// src/shared/sharing/ShareButton.jsx
//
// Small share-icon button that lives next to a token chip on each card.
// On touch devices it triggers the OS share sheet with a pre-written
// message; everywhere else it just copies the share URL to the clipboard.
//
// Stays presentation-light so it can sit inside any existing card layout —
// the parent decides the wrapper / placement.

import { useState } from 'react'
import { buildShareUrl, canNativeShare, nativeShare, copyToClipboard, shareLabel } from './shareLink'
import { formatToken } from '../tokens/shareToken'

/**
 * @param {object} props
 * @param {'mtg_deck'|'wh40k_army'|'dnd_character'|'dnd_campaign'} props.kind
 * @param {string} props.token
 * @param {string} [props.name]   Entity name — used in the share message text.
 * @param {boolean} [props.compact=false]
 * @param {object} [props.style]
 */
export default function ShareButton({ kind, token, name = '', compact = false, style }) {
  const [state, setState] = useState('idle') // 'idle' | 'copied' | 'shared' | 'error'

  if (!token) return null
  const url = buildShareUrl(kind, token)
  if (!url) return null

  async function onClick(e) {
    e.stopPropagation(); e.preventDefault()

    const label = shareLabel(kind, name)
    const message = `Schau dir an: ${label}\nToken: ${formatToken(token)}\n${url}`

    // Mobile / touch: open the native share sheet with the message body.
    if (canNativeShare()) {
      const ok = await nativeShare({ title: label, text: message, url })
      if (ok) {
        setState('shared')
        setTimeout(() => setState('idle'), 1500)
        return
      }
      // user cancelled or share failed — fall through to clipboard so we
      // still leave them with the link in hand.
    }

    const ok = await copyToClipboard(url)
    setState(ok ? 'copied' : 'error')
    setTimeout(() => setState('idle'), ok ? 1500 : 2200)
  }

  const { icon, label, fg, bg, bd } = renderState(state)

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${shareLabel(kind, name)} teilen`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: compact ? '1px 6px' : '2px 8px',
        background: bg,
        color: fg,
        border: `1px solid ${bd}`,
        borderRadius: 999,
        fontSize: compact ? 10 : 'var(--fs-xs)',
        fontFamily: 'inherit',
        cursor: 'pointer',
        transition: 'background var(--transition), color var(--transition), border-color var(--transition)',
        ...style,
      }}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function renderState(state) {
  switch (state) {
    case 'copied': return { icon: '✓', label: 'Link kopiert', fg: 'var(--color-success)', bg: 'color-mix(in srgb, var(--color-success) 18%, transparent)', bd: 'var(--color-success)' }
    case 'shared': return { icon: '✓', label: 'Geteilt',      fg: 'var(--color-success)', bg: 'color-mix(in srgb, var(--color-success) 18%, transparent)', bd: 'var(--color-success)' }
    case 'error':  return { icon: '⚠', label: 'Fehler',       fg: 'var(--color-danger)',  bg: 'color-mix(in srgb, var(--color-danger) 18%, transparent)',  bd: 'var(--color-danger)' }
    default:       return { icon: '↗', label: 'Teilen',       fg: 'var(--color-text-muted)', bg: 'var(--color-bg-sunken)', bd: 'var(--color-border)' }
  }
}
