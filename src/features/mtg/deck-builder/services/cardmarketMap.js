// src/features/mtg/deck-builder/services/cardmarketMap.js
//
// Cardmarket product id → Cardmarket expansion name (+ version number).
//
// Scryfall knows each printing's Cardmarket product id (`cardmarket_id`),
// but Cardmarket's wants import needs the expansion *name* as Cardmarket
// spells it — e.g. showcase cards live in "Wilds of Eldraine: Extras", not
// "Wilds of Eldraine" — and "(V.2)" when an expansion has several products
// of the same card. Neither is available from the browser (Cardmarket's
// catalog has no CORS and no names), so `npm run mtg:cardmarket` builds
// public/data/mtg/cardmarket.json from Cardmarket's product catalog plus
// MTGJSON's expansion names. Products it doesn't cover fall back to
// Scryfall's set name.
//
// File shape:
//   e:  { [idExpansion]: name }
//   p:  { [idProduct]: [idExpansion, version?] }
//   ts: { [scryfall token set code]: [idExpansion, …] }   (parent set's expansions)
//   tk: { [idExpansion]: [token product name, …] }

let mapPromise = null;

/** Load the map once per session. Resolves to null when unavailable. */
export function loadCardmarketMap() {
  if (!mapPromise) {
    const base = import.meta.env?.BASE_URL || '/';
    mapPromise = fetch(`${base}data/mtg/cardmarket.json`)
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return mapPromise;
}

/** @returns {{ expansion: string, version: number|null } | null} */
export function cardmarketTarget(map, cardmarketId) {
  if (!map || cardmarketId == null) return null;
  const hit = map.p?.[cardmarketId];
  if (!hit) return null;
  const expansion = map.e?.[hit[0]];
  if (!expansion) return null;
  return { expansion, version: hit[1] || null };
}

// ── Tokens ────────────────────────────────────────────────────────────
// Scryfall tokens have no Cardmarket id, so they're matched by what
// Cardmarket puts into the product name: "<Name> Token (<Colour> <P/T>)".

const WUBRG = ['W', 'U', 'B', 'R', 'G'];
const COLOR_WORDS = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
const WORD_COLORS = Object.fromEntries(Object.entries(COLOR_WORDS).map(([k, v]) => [v.toLowerCase(), k]));

function describeToken(card) {
  const face = card?.card_faces?.[0];
  const name = (face?.name || card?.name || '').split(' // ')[0].trim();
  const power = card?.power ?? face?.power;
  const toughness = card?.toughness ?? face?.toughness;
  const colors = (card?.colors ?? face?.colors ?? [])
    .filter(c => WUBRG.includes(c))
    .sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
  return {
    name,
    pt: power != null && toughness != null ? `${power}/${toughness}` : null,
    colors,
    artifact: /artifact/i.test(card?.type_line || face?.type_line || ''),
  };
}

/** Cardmarket-style token name: "Goblin Token (Red 1/1)", "Treasure Token". */
export function tokenCardmarketName(card) {
  const t = describeToken(card);
  if (!t.name) return '';
  if (/emblem/i.test(card?.type_line || '')) return card.name;
  if (!t.pt) return `${t.name} Token`;
  const words = t.colors.map(c => COLOR_WORDS[c]);
  let color;
  if (words.length === 0) color = t.artifact ? 'Artifact' : 'Colorless';
  else if (words.length === 1) color = words[0];
  else if (words.length === 2) color = `${words[0]} and ${words[1]}`;
  else color = `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`;
  return `${t.name} Token (${color} ${t.pt})`;
}

/** "Beast Token (Green 3/3 Trample)" → { base, pt, colors, knownColors, extra } */
function parseTokenProduct(productName) {
  const m = productName.match(/^(.+?) Token(?: \((.+)\))?$/);
  if (!m) return null;
  const detail = m[2] || '';
  const ptMatch = detail.match(/(\*|X|\d+)\/(\*|X|\d+)/);
  const colorPart = (ptMatch ? detail.slice(0, ptMatch.index) : detail).trim();
  const colors = new Set();
  let knownColors = false;
  for (const word of colorPart.split(/[\s,]+/).filter(Boolean)) {
    const lower = word.toLowerCase();
    if (WORD_COLORS[lower]) { colors.add(WORD_COLORS[lower]); knownColors = true; }
    else if (lower === 'colorless' || lower === 'artifact') knownColors = true;
    else if (/^[WUBRGCA]+$/.test(word)) {
      for (const ch of word) if (COLOR_WORDS[ch]) colors.add(ch);
      knownColors = true;
    }
  }
  return {
    base: m[1],
    pt: ptMatch ? ptMatch[0] : null,
    colors,
    knownColors,
    extra: ptMatch ? detail.slice(ptMatch.index + ptMatch[0].length).trim() : '',
  };
}

/**
 * Exact Cardmarket token product for a Scryfall token card, searched in the
 * expansions of its parent set. Prefers the plainest name when several
 * match (e.g. without a keyword suffix).
 * @returns {{ name: string, expansion: string } | null}
 */
export function cardmarketTokenTarget(map, card) {
  if (!map?.ts || !map?.tk || !card?.set) return null;
  const want = describeToken(card);
  if (!want.name) return null;
  const wantColors = want.colors.join('');
  let best = null;
  for (const exp of map.ts[String(card.set).toLowerCase()] || []) {
    for (const productName of map.tk[exp] || []) {
      const p = parseTokenProduct(productName);
      if (!p || p.base.toLowerCase() !== want.name.toLowerCase()) continue;
      if (p.pt !== want.pt) continue;
      if (p.knownColors && WUBRG.filter(c => p.colors.has(c)).join('') !== wantColors) continue;
      if (!best || p.extra.length < best.score) {
        best = { name: productName, expansion: map.e?.[exp], score: p.extra.length };
      }
    }
  }
  return best?.expansion ? { name: best.name, expansion: best.expansion } : null;
}
