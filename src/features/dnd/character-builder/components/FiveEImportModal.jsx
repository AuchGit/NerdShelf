// FiveEImportModal.jsx
//
// Modal für den 5e.tools-URL-Import. Drei Eingabepfade:
//   1. URL einfügen → live-Preview was importiert würde
//   2. Browse-in-App: spawnt ein zweites Tauri-Fenster mit der 5e.tools-
//      Seite (Items/Feats/Spells) der gewählten Edition; ein "Import
//      current"-Button im Modal liest die aktuelle URL des Browse-
//      Fensters via Tauri-Window-API und importiert was dort gerade
//      angezeigt wird.
//
// Cross-Edition: Wenn der Eintrag in der anderen Edition liegt als der
// Charakter, wird das in der Preview hervorgehoben und beim Import als
// `_crossEdition: true` markiert.

import { useState, useEffect, useRef, useCallback } from 'react'
import { parseFiveEUrl, lookupEntry, lookupEntryLive, applyImport, buildFiveEUrl } from '../lib/fiveeImporter'

const TYPES = [
  { id: 'spell', label: 'Spells' },
  { id: 'item',  label: 'Items'  },
  { id: 'feat',  label: 'Feats'  },
]

export default function FiveEImportModal({ open, onClose, character, applyCharacter }) {
  const charEdition = character?.meta?.edition || '5.5e'
  const [edition, setEdition]     = useState(charEdition)
  const [browseType, setBrowseType] = useState('spell')
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const browseWinRef = useRef(null)

  // Modal-Open-Sync: bei jedem Auf-Klappen Edition auf Char-Edition
  // zurücksetzen — User wechselt selten gleichzeitig Character und
  // Edition, und "default = mein Char" ist die häufigste Erwartung.
  useEffect(() => {
    if (!open) return
    setEdition(charEdition)
    setUrl('')
    setPreview(null)
    setStatus(null)
  }, [open, charEdition])

  // Live-Preview: jeder URL-Change parst + lookupt asynchron. Race-
  // Schutz via "latest url"-Ref, damit eine spät zurückkommende
  // Antwort nicht eine neuere URL-Eingabe überschreibt.
  const latestQuery = useRef('')
  useEffect(() => {
    const q = url.trim()
    latestQuery.current = q
    if (!q) { setPreview(null); return }
    const parsed = parseFiveEUrl(q)
    if (!parsed) {
      setPreview({ ok: false, reason: 'unparsable', raw: q })
      return
    }
    let cancelled = false
    setPreview({ ok: true, parsed, loading: true })
    // Erst lokalen Bestand probieren — schneller, offline-fähig.
    // Bei Treffer rendern wir sofort. Bei Miss machen wir noch einen
    // Live-Lookup gegen 5e.tools (selbe File-Struktur wie unser lokaler
    // Mirror) und übernehmen den Entry wenn er live gefunden wird.
    ;(async () => {
      const args = {
        type: parsed.type, name: parsed.name, source: parsed.source,
        edition: parsed.edition, currentEdition: charEdition,
      }
      let res = await lookupEntry(args)
      if (cancelled || latestQuery.current !== q) return
      if (!res.found) {
        // Zwischenstatus zeigen damit User weiß dass wir noch live
        // suchen — nur in der Preview, ohne den Import-Button zu blocken.
        setPreview({ ok: true, parsed, loading: true, hint: 'Suche live auf 5e.tools …' })
        res = await lookupEntryLive(args)
        if (cancelled || latestQuery.current !== q) return
      }
      setPreview({ ok: true, parsed, loading: false, result: res })
    })()
    return () => { cancelled = true }
  }, [url, charEdition])

  // Browse-Fenster spawnen — pro Edition+Type ein neues 5e.tools-
  // WebviewWindow. Wenn schon eines offen ist, navigieren wir es um
  // auf die neue Seite statt ein zweites zu öffnen.
  const openBrowse = useCallback(async () => {
    const target = buildFiveEUrl(edition, browseType)
    const isTauri = typeof window !== 'undefined'
      && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
    if (!isTauri) {
      // Browser-Fallback: einfach extern öffnen.
      window.open(target, '_blank', 'noopener')
      return
    }
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      // Label fest = "fivee-browse" → schon-offen-Detect via getByLabel.
      const label = 'fivee-browse'
      const existing = await WebviewWindow.getByLabel(label).catch(() => null)
      if (existing) {
        // Bestehendes Fenster auf neue URL bringen + nach vorne ziehen.
        try { await existing.setFocus() } catch { /* ignore */ }
        // Tauri-Window hat keine direkte navigate()-API für Webviews;
        // einfachste Lösung: Fenster zu, neu spawnen.
        try { await existing.close() } catch { /* ignore */ }
      }
      const w = new WebviewWindow(label, {
        url: target,
        title: `5e.tools — ${edition} — ${browseType}`,
        width: 1100, height: 800,
        decorations: true,
        resizable: true,
        skipTaskbar: false,
      })
      browseWinRef.current = w
      w.once('tauri://error', (e) => {
        console.error('[5etools-browse] error', e)
        // Notfall: extern öffnen.
        window.open(target, '_blank', 'noopener')
      })
    } catch (e) {
      console.error('[5etools-browse] spawn failed', e)
      window.open(target, '_blank', 'noopener')
    }
  }, [edition, browseType])

  // Aktuelle URL aus dem Browse-Fenster ziehen und ins URL-Feld
  // einfüllen — Live-Preview greift dann automatisch.
  const pullCurrentBrowseUrl = useCallback(async () => {
    setStatus(null)
    const isTauri = typeof window !== 'undefined'
      && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
    if (!isTauri) {
      setStatus({ kind: 'warn', text: 'Browse-Funktion nur in der Desktop-App verfügbar.' })
      return
    }
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      const win = await WebviewWindow.getByLabel('fivee-browse').catch(() => null)
      if (!win) {
        setStatus({ kind: 'warn', text: 'Kein Browse-Fenster offen. Erst "Browse öffnen" klicken.' })
        return
      }
      const u = await win.url()
      const s = u instanceof URL ? u.toString() : String(u)
      setUrl(s)
    } catch (e) {
      setStatus({ kind: 'err', text: `URL konnte nicht gelesen werden: ${e?.message || e}` })
    }
  }, [])

  async function doImport() {
    if (!preview?.ok || !preview.result?.found) return
    setBusy(true); setStatus(null)
    try {
      const res = applyImport(applyCharacter, {
        type: preview.parsed.type,
        entry: preview.result.entry,
        crossEdition: preview.result.crossEdition,
        foundEdition: preview.result.foundEdition,
        source: preview.parsed.source,
      })
      if (res.ok) {
        setStatus({ kind: 'ok', text: `"${preview.result.entry.name}" importiert.` })
        // URL leeren damit der Nutzer direkt den nächsten Eintrag
        // einfügen kann. Preview bleibt kurz stehen für visuelle
        // Bestätigung; nächste URL-Eingabe überschreibt sie.
        setUrl('')
      } else if (res.reason === 'duplicate') {
        setStatus({ kind: 'warn', text: 'Eintrag ist bereits importiert.' })
      } else {
        setStatus({ kind: 'err', text: `Import fehlgeschlagen: ${res.reason}` })
      }
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>📥 5etools Import</span>
          <button type="button" onClick={onClose} style={closeBtn}>×</button>
        </div>
        <div style={bodyStyle}>
          {/* Edition + Type */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={lblStyle}>Edition:
              <select value={edition} onChange={(e) => setEdition(e.target.value)} style={selectStyle}>
                <option value="5e">D&amp;D 2014 (5e)</option>
                <option value="5.5e">D&amp;D 2024 (5.5e)</option>
              </select>
            </label>
            <label style={lblStyle}>Browse-Seite:
              <select value={browseType} onChange={(e) => setBrowseType(e.target.value)} style={selectStyle}>
                {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={openBrowse} style={btnPrimary}>
              5e.tools öffnen
            </button>
            <button type="button" onClick={pullCurrentBrowseUrl} style={btnGhost}>
              ← URL aus Browse-Fenster ziehen
            </button>
          </div>

          {/* URL-Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Oder URL einfügen:</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://5e.tools/spells.html#fireball_xphb"
              style={inputStyle}
              autoFocus
            />
          </div>

          {/* Preview */}
          <PreviewBlock preview={preview} charEdition={charEdition} />

          {/* Status-Feedback */}
          {status && (
            <div style={{
              padding: '6px 10px', borderRadius: 6, fontSize: 12,
              border: '1px solid',
              borderColor: status.kind === 'err' ? 'var(--accent-red)'
                : status.kind === 'warn' ? 'var(--accent-yellow)'
                : 'var(--accent-green)',
              color: status.kind === 'err' ? 'var(--accent-red)'
                : status.kind === 'warn' ? 'var(--accent-yellow)'
                : 'var(--accent-green)',
              background: 'color-mix(in srgb, currentColor 10%, transparent)',
            }}>{status.text}</div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button type="button" onClick={onClose} style={btnGhost}>Schließen</button>
            <button type="button"
              onClick={doImport}
              disabled={busy || !preview?.ok || !preview.result?.found}
              style={{ ...btnPrimary, opacity: (busy || !preview?.result?.found) ? 0.5 : 1 }}>
              {busy ? 'Importiere …' : 'Importieren'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PreviewBlock({ preview, charEdition }) {
  if (!preview) {
    return (
      <div style={previewBoxStyle}>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          URL einfügen oder im Browse-Fenster auswählen und "URL ziehen" klicken.
        </span>
      </div>
    )
  }
  if (!preview.ok) {
    return (
      <div style={{ ...previewBoxStyle, borderColor: 'var(--accent-red)' }}>
        <span style={{ color: 'var(--accent-red)', fontSize: 12 }}>
          URL nicht erkannt — erwartet wird z. B. <code>https://5e.tools/spells.html#fireball_xphb</code>.
        </span>
      </div>
    )
  }
  const { parsed, loading, result, hint } = preview
  if (loading) {
    return (
      <div style={previewBoxStyle}>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          {hint || `Suche „${parsed.name}" im lokalen Bestand …`}
        </span>
      </div>
    )
  }
  if (!result?.found) {
    return (
      <div style={{ ...previewBoxStyle, borderColor: 'var(--accent-yellow)' }}>
        <span style={{ color: 'var(--accent-yellow)', fontSize: 12 }}>
          „{parsed.name}" ({parsed.source.toUpperCase()}) wurde weder in 5e noch in 5.5e gefunden.
        </span>
      </div>
    )
  }
  const e = result.entry
  return (
    <div style={previewBoxStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{e.name}</span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{e.source}</span>
        <span style={typePillStyle}>{parsed.type}</span>
        {result.via === 'live' && (
          <span style={{ ...typePillStyle, borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}
            title="Direkt von 5e.tools nachgeladen (nicht im lokalen Bestand)">
            live
          </span>
        )}
        {result.crossEdition && (
          <span style={crossEditionPillStyle} title={
            `Charakter ist ${charEdition}, Eintrag stammt aus ${result.foundEdition}`
          }>
            Cross-Edition · {result.foundEdition}
          </span>
        )}
      </div>
      <DescriptionPreview entry={e} />
    </div>
  )
}

function DescriptionPreview({ entry }) {
  const entries = Array.isArray(entry?.entries) ? entry.entries : []
  const firstStr = entries.find(x => typeof x === 'string')
  if (!firstStr) return null
  // 5etools-Tags grob abstreifen für die Vorschau (richtige Render
  // passiert nach Import via EntryRenderer in den jeweiligen Tabs).
  const clean = String(firstStr)
    .replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
    .slice(0, 260)
  return (
    <div style={{
      marginTop: 6, fontSize: 11, lineHeight: 1.5,
      color: 'var(--text-secondary)',
      whiteSpace: 'pre-wrap',
    }}>{clean}{firstStr.length > 260 ? ' …' : ''}</div>
  )
}

const overlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.6)', zIndex: 2000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const modalStyle = {
  width: '90vw', maxWidth: 560, maxHeight: '90vh',
  display: 'flex', flexDirection: 'column',
  background: 'var(--bg-card, #1a1a1a)',
  border: '1px solid var(--accent, #f1c40f)',
  borderRadius: 10,
  overflow: 'hidden',
  fontFamily: 'inherit',
}
const headerStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 14px',
  background: 'var(--bg-elevated)',
  borderBottom: '1px solid var(--border-subtle)',
}
const bodyStyle = {
  padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
  overflowY: 'auto',
}
const closeBtn = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-dim)', fontSize: 18, lineHeight: 1, fontFamily: 'inherit',
}
const lblStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  fontSize: 11, color: 'var(--text-muted)',
}
const selectStyle = {
  padding: '3px 6px', fontSize: 12,
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)', borderRadius: 4,
  fontFamily: 'inherit',
}
const inputStyle = {
  padding: '6px 8px', fontSize: 12,
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)', borderRadius: 6,
  fontFamily: 'inherit',
}
const btnPrimary = {
  padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid var(--accent)', background: 'var(--accent)',
  color: 'var(--bg-base, #111)', fontSize: 12, fontWeight: 700,
  fontFamily: 'inherit',
}
const btnGhost = {
  padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid var(--border)', background: 'transparent',
  color: 'var(--text-secondary)', fontSize: 12, fontFamily: 'inherit',
}
const previewBoxStyle = {
  padding: '8px 10px', borderRadius: 6,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  minHeight: 36,
}
const typePillStyle = {
  fontSize: 9, fontWeight: 800, letterSpacing: 0.3, textTransform: 'uppercase',
  padding: '1px 6px', borderRadius: 4,
  border: '1px solid var(--text-dim)', color: 'var(--text-dim)',
}
const crossEditionPillStyle = {
  fontSize: 9, fontWeight: 800, letterSpacing: 0.3, textTransform: 'uppercase',
  padding: '1px 6px', borderRadius: 4,
  border: '1px solid var(--accent-orange, #ff9533)',
  color: 'var(--accent-orange, #ff9533)',
  background: 'color-mix(in srgb, var(--accent-orange, #ff9533) 12%, transparent)',
}
