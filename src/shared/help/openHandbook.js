// src/shared/help/openHandbook.js
//
// Öffnet das Benutzerhandbuch (public/handbuch.html) — in der Tauri-Shell als
// eigenes Fenster, im Browser als neuer Tab. Die Datei liegt in `public/`, wird
// also vom normalen Build mit ausgeliefert und braucht kein Netz.
//
// Der Absprung landet direkt beim passenden Kapitel: `anchorForLocation()`
// leitet aus der aktuellen Route den Anker im Handbuch ab (Router-Pfad für
// MTG/WH40K, Hash-Route für den DnD-Teil). Die Anker sind die `id`s der
// <section>-Elemente in handbuch.html — kommen dort welche dazu, hier ergänzen.

const SECTION_BY_HASH = [
  [/^#?\/campaign\/[^/]+\/vtt/, 'dnd-vtt'],
  [/^#?\/campaign\/[^/]+\/session/, 'dnd-session'],
  [/^#?\/campaign\//, 'dnd-campaigns'],
  [/^#?\/campaigns/, 'dnd-campaigns'],
  [/^#?\/homebrew/, 'dnd-homebrew'],
  [/^#?\/character\/new/, 'dnd-erstellen'],
  [/^#?\/character\/[^/]+\/levelup/, 'dnd-levelup'],
  [/^#?\/character\/[^/]+\/edit/, 'dnd-erstellen'],
  [/^#?\/character\//, 'dnd-sheet'],
];

const SECTION_BY_PATH = [
  [/^\/mtg\/deck/, 'mtg-builder'],
  [/^\/mtg\/wishlist/, 'mtg-wunschliste'],
  [/^\/mtg\/inventory/, 'mtg-sammlung'],
  [/^\/mtg\/match/, 'mtg-match'],
  [/^\/mtg/, 'mtg'],
  [/^\/wh40k\/units/, 'w40k-einheiten'],
  [/^\/wh40k\/inventory/, 'w40k-sammlung'],
  [/^\/wh40k\/combat/, 'w40k-combat'],
  [/^\/wh40k\/army/, 'w40k-armeen'],
  [/^\/wh40k/, 'w40k'],
];

/**
 * Kapitel-Anker für die aktuelle (oder eine übergebene) Adresse.
 * @param {{pathname?: string, hash?: string}} [loc]
 * @returns {string} section-id in handbuch.html
 */
export function anchorForLocation(loc) {
  const pathname = loc?.pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  const hash = loc?.hash ?? (typeof window !== 'undefined' ? window.location.hash : '');

  // DnD läuft auf Hash-Routen innerhalb von /dnd/*.
  if (/\/dnd(\/|$)/.test(pathname) || /^#?\/(character|campaign|campaigns|homebrew)/.test(hash)) {
    for (const [re, id] of SECTION_BY_HASH) if (re.test(hash)) return id;
    return 'dnd';
  }
  for (const [re, id] of SECTION_BY_PATH) if (re.test(pathname)) return id;
  return 'start-ueberblick';
}

async function appVersion() {
  try {
    if (!('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) return '';
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return '';
  }
}

/**
 * Handbuch öffnen.
 * @param {string} [anchor] Kapitel-Anker; ohne Angabe aus der aktuellen Route.
 */
export async function openHandbook(anchor) {
  const section = anchor || anchorForLocation();
  const base = import.meta.env.BASE_URL || '/';
  const version = await appVersion();
  const url = `${window.location.origin}${base}handbuch.html${version ? `?v=${encodeURIComponent(version)}` : ''}#${section}`;

  // Ein bereits offenes Handbuch springt selbst zum Kapitel: es lauscht auf
  // das `storage`-Event dieses Schlüssels (gleicher Origin in allen Fenstern).
  try {
    localStorage.setItem('nerdshelf:handbuch-goto', JSON.stringify({ section, t: Date.now() }));
  } catch { /* Storage gesperrt — dann bleibt es beim Anker in der URL */ }

  const isTauri = typeof window !== 'undefined'
    && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  if (isTauri) {
    try {
      const { WebviewWindow, getAllWebviewWindows } = await import('@tauri-apps/api/webviewWindow');
      // Ein Handbuch-Fenster reicht: existiert es schon, holen wir es nach
      // vorne (das Kapitel findet es über den storage-Schlüssel oben selbst).
      // Schlägt die Abfrage fehl, fallen wir auf "neu öffnen" zurück statt in
      // den Browser-Zweig — window.open ist in der Shell kein guter Ersatz.
      try {
        const existing = (await getAllWebviewWindows()).find((w) => w.label === 'handbook');
        if (existing) {
          await existing.setFocus();
          return;
        }
      } catch { /* kein Fenster gefunden / Abfrage nicht möglich → neu öffnen */ }
      const w = new WebviewWindow('handbook', {
        url,
        title: 'NerdShelf — Handbuch',
        width: 1180,
        height: 860,
        resizable: true,
      });
      w.once('tauri://error', (e) => {
        console.error('[handbuch] WebviewWindow error', e);
        try { window.open(url, '_blank'); } catch { /* ignore */ }
      });
      return;
    } catch (e) {
      console.error('[handbuch] WebviewWindow import failed', e);
      // weiter zum Browser-Fallback
    }
  }

  try {
    window.open(url, 'nerdshelf-handbuch');
  } catch (e) {
    console.error('[handbuch] window.open failed', e);
  }
}

export default openHandbook;
