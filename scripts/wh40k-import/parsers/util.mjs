// scripts/wh40k-import/parsers/util.mjs
//
// Tiny, dependency-free helpers shared by parsers and normalizers. Kept
// separate from `wahapedia.mjs` (which imports `csv-parse`) so that
// `normalize.mjs` can remain runnable without any npm deps installed —
// which is what the seed-only path relies on.

const HTML_TAG = /<[^>]+>/g;
const NBSP = /&nbsp;/g;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** Strip HTML and decode the few entities Wahapedia uses. */
export function stripHtml(input) {
  if (!input) return '';
  let s = String(input).replace(NBSP, ' ').replace(HTML_TAG, '');
  for (const [k, v] of Object.entries(ENTITIES)) s = s.split(k).join(v);
  return s.replace(/\s+/g, ' ').trim();
}
