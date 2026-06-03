// PinOverlayPage.jsx
//
// Standalone-Page für ein Tauri-Overlay-Fenster pro gepinntem
// Tooltip. Wird über URL `/#/pin-overlay/<id>` erreicht. Liest
// title + html aus localStorage (`nerdshelf:pin-<id>`), das vom
// Haupt-App-Fenster vor dem Spawn gesetzt wird. Beide Webviews
// teilen sich das gleiche origin → localStorage ist gemeinsam,
// daher kein IPC nötig.
//
// Das Fenster wird mit decorations:false + alwaysOnTop:true +
// resizable:true gespawnt; dieser Page-Body bildet das Innenleben
// (Drag-Header + scrollbarer Body + Close-Button). System-Resize
// ist nativ (Drag am Fensterrand).

import { useEffect, useState, useCallback } from 'react'

function readPin(id) {
  try {
    const raw = localStorage.getItem(`nerdshelf:pin-${id}`)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

export default function PinOverlayPage({ id }) {
  const [data, setData] = useState(() => readPin(id))

  // Falls die Page rendert bevor der Spawner die Daten geschrieben
  // hat (race), kurz polling probieren. Tauri-Window startet schnell
  // und localStorage-Write ist synchron — sollte nie nötig sein,
  // ist aber billig.
  useEffect(() => {
    if (data) return
    let tries = 0
    const iv = setInterval(() => {
      tries++
      const d = readPin(id)
      if (d) { setData(d); clearInterval(iv) }
      if (tries > 20) clearInterval(iv)
    }, 50)
    return () => clearInterval(iv)
  }, [data, id])

  const close = useCallback(async () => {
    try { localStorage.removeItem(`nerdshelf:pin-${id}`) } catch { /* ignore */ }
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().close()
    } catch {
      try { window.close() } catch { /* ignore */ }
    }
  }, [id])

  // Header-Drag → native Tauri-Drag. Im Browser-Fallback (kein Tauri)
  // ist der Header ein toter Header — das Browser-Fallback-Fenster ist
  // ein normales window.open() das der User per Titelleiste bewegt.
  const startDrag = useCallback(async (e) => {
    if (e.target.closest('[data-no-drag]')) return
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().startDragging()
    } catch { /* ignore — Browser-Fallback */ }
  }, [])

  // Escape schließt das Overlay — gleicher UX wie In-App-Pins.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  if (!data) {
    return (
      <div style={overlayWrap}>
        <div style={{ ...overlayHeader, cursor: 'default' }}>
          <span style={overlayTitle}>📌 …</span>
          <button data-no-drag onClick={close} style={overlayClose}>×</button>
        </div>
        <div style={{ ...overlayBody, color: 'var(--text-dim)' }}>
          Lade Pin-Daten …
        </div>
      </div>
    )
  }

  return (
    <div style={overlayWrap}>
      <div onMouseDown={startDrag} style={overlayHeader}>
        <span style={overlayTitle}>📌 {data.title}</span>
        <button data-no-drag onClick={close} title="Schließen" style={overlayClose}>×</button>
      </div>
      <div style={overlayBody} dangerouslySetInnerHTML={{ __html: data.html || '' }} />
    </div>
  )
}

const overlayWrap = {
  width: '100vw', height: '100vh',
  display: 'flex', flexDirection: 'column',
  background: 'var(--bg-card, #1a1a1a)',
  color: 'var(--text-primary, #eee)',
  border: '1px solid var(--accent, #f1c40f)',
  borderRadius: 6,
  overflow: 'hidden',
  fontSize: 11, lineHeight: 1.5,
  fontFamily: 'inherit',
}
const overlayHeader = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 8px',
  background: 'var(--bg-elevated, #222)',
  borderBottom: '1px solid var(--border-subtle, #333)',
  cursor: 'grab',
  userSelect: 'none',
  flexShrink: 0,
}
const overlayTitle = {
  flex: 1, minWidth: 0,
  fontSize: 12, fontWeight: 700,
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}
const overlayClose = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-dim)', fontSize: 14, lineHeight: 1,
  padding: '0 4px', fontFamily: 'inherit',
}
const overlayBody = {
  flex: 1, minHeight: 0,
  overflowY: 'auto', overflowX: 'hidden',
  padding: '8px 10px',
  userSelect: 'text',
}
