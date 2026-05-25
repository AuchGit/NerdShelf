// src/shared/images/compressImage.js
//
// Canvas-based image resize + JPEG re-encode for upload paths that store
// the image as a base64 data URL in a JSONB column (character portraits,
// campaign banners). Raw uploads from a modern phone routinely land at
// 2-8 MB; without this step those blobs end up inside the row payload
// for every read AND every realtime broadcast — which is what caused
// the dnd_campaign_members PATCH timeouts.
//
// API:
//   const dataUrl = await compressImage(file, { maxDim: 256, quality: 0.75 })
//
// Behaviour:
//   - Reject inputs > MAX_INPUT_BYTES outright (defensive; canvas would
//     OOM long before "many MB").
//   - Honour EXIF orientation? No — most modern browsers handle that
//     automatically when drawing an HTMLImageElement to a canvas.
//   - Always emits image/jpeg. Original might have been PNG with
//     transparency; portraits/banners don't need transparency and JPEG
//     is dramatically smaller for photos.
//   - Preserves aspect ratio — `maxDim` is the longer edge cap.

const MAX_INPUT_BYTES = 20 * 1024 * 1024  // 20 MB — anything larger is rejected

/**
 * Resize + re-encode a File / Blob to a small JPEG data URL.
 *
 * @param {File|Blob} file
 * @param {{ maxDim?: number, quality?: number }} [opts]
 *   maxDim: longer edge cap in CSS pixels (default 256)
 *   quality: JPEG quality 0..1 (default 0.75)
 * @returns {Promise<string>} data:image/jpeg;base64,...
 */
export async function compressImage(file, { maxDim = 256, quality = 0.75 } = {}) {
  if (!file) throw new Error('Kein Bild ausgewählt.')
  if (file.size > MAX_INPUT_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1)
    throw new Error(`Bild ist zu groß (${mb} MB). Bitte maximal ${MAX_INPUT_BYTES / 1024 / 1024} MB hochladen.`)
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(objectUrl)
    const { width, height } = scaleToFit(img.naturalWidth, img.naturalHeight, maxDim)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    // Fill white so JPEG doesn't render transparent areas as black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * Re-compress an existing data URL (e.g. a legacy oversized portrait
 * already stored in a row). Returns the original string unchanged if it
 * isn't a `data:` URL, or rethrows if the source can't be decoded.
 */
export async function compressDataUrl(dataUrl, opts) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return dataUrl
  const blob = await (await fetch(dataUrl)).blob()
  return compressImage(blob, opts)
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload  = () => resolve(img)
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'))
    img.src = src
  })
}

function scaleToFit(srcW, srcH, maxDim) {
  const longer = Math.max(srcW, srcH)
  if (longer <= maxDim) return { width: srcW, height: srcH }
  const ratio = maxDim / longer
  return { width: Math.round(srcW * ratio), height: Math.round(srcH * ratio) }
}
