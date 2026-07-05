// Worker für den Map-Import: Dekodieren + Skalieren + WebP-Encode + Hash
// laufen komplett abseits des Main-Threads (OffscreenCanvas), damit die App
// während großer Importe bedienbar bleibt. Gleiche Logik wie der
// Main-Thread-Fallback in mapImage.js.
self.onmessage = async (e) => {
  const { file, maxDim, quality } = e.data;
  try {
    const bmp = await createImageBitmap(file);
    const sw = bmp.width; const sh = bmp.height;
    let dim = maxDim;
    let blob; let width; let height;
    // Encode-Backoff: Supabase nimmt ~50 MB/Datei — größer? Kante ×0.85.
    for (let attempt = 0; attempt < 4; attempt++) {
      const longer = Math.max(sw, sh);
      const r = longer > dim ? dim / longer : 1;
      width = Math.round(sw * r); height = Math.round(sh * r);
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, width, height);
      blob = await canvas.convertToBlob({ type: 'image/webp', quality });
      if (blob.size <= 45 * 1024 * 1024) break;
      dim = Math.round(dim * 0.85);
    }
    bmp.close();
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    self.postMessage({ ok: true, blob, width, height, origWidth: sw, origHeight: sh, hash, bytes: blob.size });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.message || err) });
  }
};
