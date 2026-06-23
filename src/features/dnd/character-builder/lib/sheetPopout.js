// sheetPopout.js
//
// Spawns the character sheet in its own always-on-top window in the Tauri
// shell (PWA layout, app chrome suppressed via the `?popout=1` flag) — meant
// for use next to a VTT. In a plain browser it falls back to window.open()
// (no always-on-top there, but otherwise the same view).
//
// Extracted from CharacterSheetPage so the VTT can open a token's sheet
// without pulling the whole (heavy) sheet module into its bundle.

/**
 * Open the sheet popout for a character.
 *
 * @param {string|number} characterId  dnd_characters.id
 * @param {object} [opts]
 * @param {string} [opts.route]  Hash route to show, WITHOUT the popout flag —
 *   defaults to the owner sheet `#/character/<id>`. Pass the GM read-only
 *   route `#/campaign/<id>/character/<charId>` when the viewer isn't the owner.
 */
export async function openSheetPopout(characterId, { route } = {}) {
  const hash = route || `#/character/${characterId}`
  const sep = hash.includes('?') ? '&' : '?'
  const url = `${window.location.origin}${window.location.pathname}${hash}${sep}popout=1`
  const isTauri = typeof window !== 'undefined'
    && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  if (isTauri) {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      // Label must be unique and free of special characters.
      const label = `sheet-popout-${String(characterId).replace(/[^a-z0-9]/gi, '')}-${Date.now()}`
      const w = new WebviewWindow(label, {
        url,
        title: 'NerdShelf — Character Sheet',
        width: 420,
        height: 760,
        alwaysOnTop: true,
        decorations: false,
        resizable: true,
        skipTaskbar: false,
      })
      w.once('tauri://error', (e) => {
        console.error('[popout] WebviewWindow error', e)
        try { window.open(url, '_blank', 'width=420,height=760') } catch { /* ignore */ }
      })
      return
    } catch (e) {
      console.error('[popout] WebviewWindow import failed', e)
      // Fall through to window.open.
    }
  }
  try {
    window.open(url, 'nerdshelf-popout', 'width=420,height=760,toolbar=no,menubar=no,location=no,status=no')
  } catch (e) {
    console.error('[popout] window.open failed', e)
    alert('Popout konnte nicht geöffnet werden.')
  }
}
