// HoverDetailTooltip.jsx
//
// Anhaltender Tooltip auf Hover, der formatierten React-Content
// (z.B. EntryRenderer für 5etools-Einträge) anzeigt. Anders als das
// browserseitige `title`-Attribut bekommt der Tooltip:
//   • CSS-Styling (eigener Hintergrund, Border, max-width)
//   • mehrzeiligen formatierten Content
//   • Position relativ zum Trigger-Element (nicht zur Maus)
//   • automatische Flip-Logik wenn unten kein Platz ist
//
// Verwendung:
//   <HoverDetailTooltip content={<EntryRenderer entries={...}/>}>
//     <span>Trigger-Text</span>
//   </HoverDetailTooltip>
//
// Performance: der content rendert nur wenn der Tooltip sichtbar ist
// (lazy via state) — keine 100 EntryRenderer im DOM.

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

const SHOW_DELAY_MS = 200
const HIDE_DELAY_MS = 80   // kurze Verzögerung damit man auf den Tooltip ziehen kann

export default function HoverDetailTooltip({ content, children, maxWidth = 380 }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, placement: 'below' })
  const triggerRef = useRef(null)
  const showTimerRef = useRef(null)
  const hideTimerRef = useRef(null)

  const computePosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Erstmal unter dem Trigger platzieren — wenn unter nicht genug
    // Platz ist, oberhalb flippen.
    const wantedHeight = 280
    const placement = (rect.bottom + wantedHeight > vh - 12 && rect.top > wantedHeight + 12)
      ? 'above' : 'below'
    const top = placement === 'below'
      ? Math.min(rect.bottom + 6, vh - 12)
      : Math.max(rect.top - 6, 12)
    // Horizontal: links am Trigger-Anfang ausrichten, aber nicht
    // rechts aus dem Viewport rauslaufen.
    const left = Math.min(Math.max(rect.left, 8), vw - maxWidth - 8)
    setPos({ top, left, placement })
  }, [maxWidth])

  const scheduleShow = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
    if (open) return
    showTimerRef.current = setTimeout(() => {
      computePosition()
      setOpen(true)
    }, SHOW_DELAY_MS)
  }, [open, computePosition])

  const scheduleHide = useCallback(() => {
    if (showTimerRef.current) { clearTimeout(showTimerRef.current); showTimerRef.current = null }
    hideTimerRef.current = setTimeout(() => setOpen(false), HIDE_DELAY_MS)
  }, [])

  useEffect(() => () => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
  }, [])

  // Wenn der Trigger gescrollt oder das Fenster resized wird während
  // der Tooltip offen ist, schließen statt fehlerhaft platziert
  // bleiben. Einfacher als Live-Reposition.
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={scheduleShow}
        onMouseLeave={scheduleHide}
        onFocus={scheduleShow}
        onBlur={scheduleHide}
        style={{ display: 'inline-block', cursor: 'help' }}
      >
        {children}
      </span>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          onMouseEnter={() => {
            if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
          }}
          onMouseLeave={scheduleHide}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            transform: pos.placement === 'above' ? 'translateY(-100%)' : 'none',
            maxWidth,
            maxHeight: 280,
            overflowY: 'auto',
            background: 'var(--bg-card, #1a1a1a)',
            border: '1px solid var(--border, #444)',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--text-primary, #eee)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            zIndex: 1500,
            pointerEvents: 'auto',
          }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  )
}
