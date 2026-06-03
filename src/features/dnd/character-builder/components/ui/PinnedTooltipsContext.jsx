// PinnedTooltipsContext.jsx
//
// Globaler Pinned-Tooltip-Layer. HoverDetailTooltip ruft beim
// Rechtsklick `add({ title, content, anchor })` auf — der Layer
// erzeugt eine eigenständige Card die:
//   • am Anker-Punkt aufpoppt
//   • per Header gezogen werden kann (draggable)
//   • einen Resize-Griff unten rechts hat (resizable)
//   • einen × Close-Button hat
//   • intern scrollt wenn der Content höher ist als die Card
//
// Die Cards leben außerhalb der Trigger-Lifecycles — der Trigger kann
// unmounten (Tab wechseln, Spell de-preparen, ...) und die Pin bleibt.

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

const Ctx = createContext(null)

let nextId = 1

// Helfer: System-wide Pin als eigenes Tauri-WebviewWindow spawnen.
// Macht das Pin sichtbar auch wenn das Hauptfenster nicht im Vorder-
// grund ist (alwaysOnTop). Content wird per renderToStaticMarkup zu
// HTML serialisiert und über localStorage übergeben (geteilter
// origin zwischen Tauri-Webviews → kein IPC nötig).
//
// Liefert true wenn der Spawn erfolgreich gestartet wurde, sonst
// false (Provider fällt dann auf In-App-Card zurück).
async function spawnTauriOverlay({ id, title, content, x, y, width, height }) {
  if (typeof window === 'undefined') return false
  const isTauri = ('__TAURI_INTERNALS__' in window) || ('__TAURI__' in window)
  if (!isTauri) return false
  try {
    const { renderToStaticMarkup } = await import('react-dom/server')
    let html = ''
    try { html = renderToStaticMarkup(content) } catch { html = '' }
    const payload = { title, html }
    try {
      localStorage.setItem(`nerdshelf:pin-${id}`, JSON.stringify(payload))
    } catch { /* fall through to in-app */ return false }

    // Tauri-Fenster-Koordinaten sind Screen-relativ (Logical px), x/y
    // aus dem Caller sind Viewport-relativ. Wir holen die Inner-Position
    // des Hauptfensters (Top-Left des Content-Bereichs, ohne Titelleiste/
    // Border) und konvertieren über scaleFactor von Physical → Logical;
    // dann addieren wir die Viewport-Offsets. Ergebnis: Pin-Overlay
    // spawnt genau dort wo der Tooltip stand.
    let screenX
    let screenY
    if (typeof x === 'number' && typeof y === 'number') {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const cur = getCurrentWindow()
        const innerPos = await cur.innerPosition()
        const scale = await cur.scaleFactor()
        // innerPosition liefert PhysicalPosition (physische Pixel auf dem
        // Monitor). Tauri-Window-Optionen erwarten logische Pixel — also
        // durch scale teilen.
        const baseX = innerPos.x / scale
        const baseY = innerPos.y / scale
        screenX = Math.max(0, Math.round(baseX + x))
        screenY = Math.max(0, Math.round(baseY + y))
      } catch {
        // Fallback: einfach die Viewport-Koords nehmen — besser als ganz
        // ohne Position spawnen.
        screenX = Math.max(0, Math.round(x))
        screenY = Math.max(0, Math.round(y))
      }
    }

    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const safeId = id.replace(/[^a-z0-9]/gi, '')
    const label = `pin-overlay-${safeId}-${Date.now()}`
    const url = `${window.location.origin}${window.location.pathname}#/pin-overlay/${encodeURIComponent(id)}`
    const w = new WebviewWindow(label, {
      url,
      title: title || 'NerdShelf Pin',
      width:  Math.max(220, width  || 380),
      height: Math.max(160, height || 280),
      x: screenX,
      y: screenY,
      alwaysOnTop: true,
      decorations: false,
      resizable: true,
      skipTaskbar: false,
      transparent: false,
    })
    return new Promise((resolve) => {
      let settled = false
      const settle = (ok) => { if (!settled) { settled = true; resolve(ok) } }
      w.once('tauri://error', (e) => {
        console.error('[pin-overlay] WebviewWindow error', e)
        try { localStorage.removeItem(`nerdshelf:pin-${id}`) } catch { /* ignore */ }
        settle(false)
      })
      w.once('tauri://created', () => settle(true))
      // Sicherheits-Timeout: wenn weder created noch error nach 600ms
      // feuert, einfach optimistisch true zurück — Spawn ist meist
      // schon im Gange.
      setTimeout(() => settle(true), 600)
    })
  } catch (e) {
    console.error('[pin-overlay] spawn failed', e)
    try { localStorage.removeItem(`nerdshelf:pin-${id}`) } catch { /* ignore */ }
    return false
  }
}

export function PinnedTooltipsProvider({ children }) {
  const [pins, setPins] = useState([])

  const add = useCallback((pin) => {
    // Dedup: gleicher Anker → bestehende Pin fokussieren statt
    // verdoppeln. Funktioniert auch wenn die alte Pin als Tauri-
    // Overlay läuft (focusOverlay) — fallback In-App-Card setzt nur
    // z.
    if (pin.anchorKey) {
      const dup = pins.find(p => p.anchorKey === pin.anchorKey)
      if (dup) {
        setPins(prev => prev.map(p => p === dup ? { ...p, z: nextId++ } : p))
        return
      }
    }
    const id = `pin-${nextId++}`
    const title = pin.title || 'Detail'
    const x = typeof pin.x === 'number' ? pin.x : 80
    const y = typeof pin.y === 'number' ? pin.y : 80
    const width  = pin.width  || 380
    const height = pin.height || 280

    // Erst Tauri-Overlay versuchen — das ist das System-wide Sichtbare.
    // Wenn das nicht klappt (Browser-Modus, Spawn-Fehler), als In-App-
    // Card rendern, damit der Right-Click trotzdem ein sichtbares
    // Resultat liefert.
    spawnTauriOverlay({ id, title, content: pin.content, x, y, width, height })
      .then((ok) => {
        if (!ok) {
          setPins(prev => [...prev, {
            id, x, y, width, height, z: nextId++,
            title, content: pin.content,
            anchorKey: pin.anchorKey,
          }])
        }
      })
  }, [pins])

  const remove = useCallback((id) => {
    setPins(prev => prev.filter(p => p.id !== id))
  }, [])

  const update = useCallback((id, patch) => {
    setPins(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
  }, [])

  const focus = useCallback((id) => {
    setPins(prev => prev.map(p => p.id === id ? { ...p, z: nextId++ } : p))
  }, [])

  return (
    <Ctx.Provider value={{ pins, add, remove, update, focus }}>
      {children}
      <PinnedLayer pins={pins} remove={remove} update={update} focus={focus} />
    </Ctx.Provider>
  )
}

export function usePinnedTooltips() {
  const v = useContext(Ctx)
  // Wenn kein Provider drüber sitzt: no-op. Erlaubt es HoverDetail
  // Tooltip auch in Popout-Fenstern / Builder-Pages zu nutzen ohne
  // dass das gesamte Pin-System mitlaufen muss.
  return v || { pins: [], add: () => {}, remove: () => {}, update: () => {}, focus: () => {} }
}

function PinnedLayer({ pins, remove, update, focus }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      {pins.map(pin => (
        <PinnedCard key={pin.id} pin={pin} remove={remove} update={update} focus={focus} />
      ))}
    </>,
    document.body,
  )
}

function PinnedCard({ pin, remove, update, focus }) {
  const cardRef = useRef(null)
  const dragState = useRef(null)
  const resizeState = useRef(null)

  // Drag-Handler. Pointer-Capture wäre hübscher, aber wir wollen
  // dass der Tooltip auch außerhalb der Card weiter geschoben werden
  // kann — also globale window.mousemove/mouseup während Drag.
  const onHeaderMouseDown = useCallback((e) => {
    if (e.button !== 0) return // nur LMB
    if (e.target.closest('[data-no-drag]')) return
    e.preventDefault()
    focus(pin.id)
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pin.x,
      origY: pin.y,
    }
    const onMove = (ev) => {
      const s = dragState.current
      if (!s) return
      update(pin.id, {
        x: Math.max(0, s.origX + (ev.clientX - s.startX)),
        y: Math.max(0, s.origY + (ev.clientY - s.startY)),
      })
    }
    const onUp = () => {
      dragState.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [pin.id, pin.x, pin.y, update, focus])

  const onResizeMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    focus(pin.id)
    resizeState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origW: pin.width,
      origH: pin.height,
    }
    const onMove = (ev) => {
      const s = resizeState.current
      if (!s) return
      update(pin.id, {
        width:  Math.max(180, s.origW + (ev.clientX - s.startX)),
        height: Math.max(120, s.origH + (ev.clientY - s.startY)),
      })
    }
    const onUp = () => {
      resizeState.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [pin.id, pin.width, pin.height, update, focus])

  // Escape schließt die zuletzt fokussierte Card. Reicht für 99 %
  // der "ich will das wegklicken"-Fälle; explizite × bleibt.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        const top = document.activeElement
        if (top && cardRef.current && cardRef.current.contains(top)) {
          remove(pin.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pin.id, remove])

  return (
    <div
      ref={cardRef}
      onMouseDown={() => focus(pin.id)}
      style={{
        position: 'fixed',
        left: pin.x, top: pin.y,
        width: pin.width, height: pin.height,
        background: 'var(--bg-card, #1a1a1a)',
        border: '1px solid var(--accent, #f1c40f)',
        borderRadius: 8,
        boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
        zIndex: 1500 + (pin.z || 0),
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        fontSize: 11, lineHeight: 1.5,
        color: 'var(--text-primary, #eee)',
        userSelect: 'none',
      }}
      tabIndex={-1}
    >
      <div
        onMouseDown={onHeaderMouseDown}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 8px',
          background: 'var(--bg-elevated, #222)',
          borderBottom: '1px solid var(--border-subtle, #333)',
          cursor: 'grab',
          flexShrink: 0,
        }}
      >
        <span style={{
          flex: 1, minWidth: 0,
          fontSize: 12, fontWeight: 700,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>📌 {pin.title}</span>
        <button
          type="button"
          data-no-drag
          onClick={() => remove(pin.id)}
          title="Schließen"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-dim)', fontSize: 14, lineHeight: 1,
            padding: '0 4px', fontFamily: 'inherit',
          }}
        >×</button>
      </div>
      <div style={{
        flex: 1, minHeight: 0,
        overflowY: 'auto', overflowX: 'hidden',
        padding: '8px 10px',
        userSelect: 'text',
      }}>
        {pin.content}
      </div>
      <div
        onMouseDown={onResizeMouseDown}
        title="Größe ändern"
        style={{
          position: 'absolute', right: 0, bottom: 0,
          width: 14, height: 14,
          cursor: 'nwse-resize',
          background: 'linear-gradient(135deg, transparent 50%, var(--border) 50%, var(--border) 60%, transparent 60%, transparent 70%, var(--border) 70%, var(--border) 80%, transparent 80%)',
        }}
      />
    </div>
  )
}
