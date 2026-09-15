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

function describeFace(source, card) {
  const name = (source?.name || card?.name || '').split(' // ')[0].trim();
  const power = source?.power ?? card?.power;
  const toughness = source?.toughness ?? card?.toughness;
  const colors = (source?.colors ?? card?.colors ?? [])
    .filter(c => WUBRG.includes(c))
    .sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
  return {
    name,
    pt: power != null && toughness != null ? `${power}/${toughness}` : null,
    colors,
    artifact: /artifact/i.test(source?.type_line || card?.type_line || ''),
  };
}

/**
 * One entry per printed half. Double-faced tokens carry two different
 * creatures on one card (a 2/2 green Wolf on the front, a 1/1 black one on
 * the back) and Cardmarket sells them as a single two-sided product.
 */
function describeTokenFaces(card) {
  const faces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  if (faces.length > 1) return faces.map(f => describeFace(f, card));
  return [describeFace(faces[0], card)];
}

function faceProductName(t) {
  if (!t.name) return '';
  if (!t.pt) return `${t.name} Token`;
  const words = t.colors.map(c => COLOR_WORDS[c]);
  let color;
  if (words.length === 0) color = t.artifact ? 'Artifact' : 'Colorless';
  else if (words.length === 1) color = words[0];
  else if (words.length === 2) color = `${words[0]} and ${words[1]}`;
  else color = `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`;
  return `${t.name} Token (${color} ${t.pt})`;
}

/** Cardmarket-style token name: "Goblin Token (Red 1/1)", "Treasure Token". */
export function tokenCardmarketName(card) {
  const type = card?.type_line || card?.card_faces?.[0]?.type_line || '';
  if (/emblem/i.test(type)) return card.name;
  // Helper cards a deck needs alongside its tokens — the "Day // Night"
  // indicator, "Energy Reserve", dungeons — are sold under their plain
  // name; there is no "<name> Token" product for them.
  if (type && !/token/i.test(type)) return card.name;
  return describeTokenFaces(card).map(faceProductName).filter(Boolean).join(' // ');
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
 * A double-faced token is ONE Cardmarket product naming both halves, and
 * the catalog spells those inconsistently — "Zombie (B 2/2 Decayed)
 * //Spider (G 1/2) Token", "Treasure Token// Spider Token (G 1/2)",
 * "Angel Token (W 4/4) / Knight Token (W 2/2)". Match on the parts that
 * don't vary: each half's name and its power/toughness.
 */
function matchesBothFaces(productName, faces) {
  const hay = productName.toLowerCase();
  return faces.every(f =>
    f.name
    && hay.includes(f.name.toLowerCase())
    && (!f.pt || hay.includes(f.pt)));
}

// ── Two tokens on one card ────────────────────────────────────────────
// Most tokens since Innistrad are printed back to back: one physical card
// carries two different tokens, and Cardmarket sells it as one product
// naming both. A deck that needs both halves should buy that card once,
// not two separate products.

/** Split a product name into its printed halves. */
function splitProductFaces(productName) {
  const parts = String(productName).split(/\s*\/\/\s*|\s+\/\s+/).map(s => s.trim()).filter(Boolean);
  return parts.length === 2 ? parts : null;
}

/** "Wolf Token (B 1/1)", "Zombie (B 2/2 Decayed)", "Treasure Token" → parts. */
function parseTokenFace(text) {
  const m = text.match(/^(.+?)(?:\s+Token)?(?:\s+\((.+)\))?$/);
  if (!m) return null;
  return parseTokenProduct(`${m[1]} Token${m[2] ? ` (${m[2]})` : ''}`);
}

function faceMatchesWant(face, want) {
  if (!face || !want?.name) return false;
  if (face.base.toLowerCase() !== want.name.toLowerCase()) return false;
  if (face.pt !== want.pt) return false;
  if (face.knownColors && WUBRG.filter(c => face.colors.has(c)).join('') !== want.colors.join('')) return false;
  return true;
}

/**
 * Find the Cardmarket products that cover TWO of the deck's tokens at once.
 *
 * @param {object} map
 * @param {{key: string, card: object, qty: number}[]} wanted
 * @returns {Map<string, {name, expansion, qty, primary: boolean}>}
 *   keyed by the token's row key. `primary` marks the one row that prints
 *   the line; the other half resolves to the same product and prints
 *   nothing. `qty` is the higher of the two — one card brings both sides.
 */
export function cardmarketTokenPairs(map, wanted) {
  const out = new Map();
  if (!map?.ts || !map?.tk || !Array.isArray(wanted)) return out;

  // Only halves of the same set can share a card.
  const bySet = new Map();
  for (const row of wanted) {
    const set = String(row?.card?.set || '').toLowerCase();
    if (!set) continue;
    const list = bySet.get(set) || bySet.set(set, []).get(set);
    list.push(row);
  }

  for (const [set, rows] of bySet) {
    if (rows.length < 2) continue;
    const wants = rows.map(r => ({ row: r, want: describeTokenFaces(r.card)[0] }));
    const taken = new Set();
    for (const exp of map.ts[set] || []) {
      const expansion = map.e?.[exp];
      if (!expansion) continue;
      for (const productName of map.tk[exp] || []) {
        const halves = splitProductFaces(productName);
        if (!halves) continue;
        const faces = halves.map(parseTokenFace);
        if (!faces[0] || !faces[1]) continue;

        // Both halves have to be tokens this deck actually wants, and each
        // token may only be covered once.
        let a = null;
        let b = null;
        for (const entry of wants) {
          if (taken.has(entry.row.key)) continue;
          if (!a && faceMatchesWant(faces[0], entry.want)) { a = entry; continue; }
          if (!b && faceMatchesWant(faces[1], entry.want)) b = entry;
        }
        if (!a || !b || a === b) continue;

        taken.add(a.row.key);
        taken.add(b.row.key);
        const qty = Math.max(a.row.qty || 1, b.row.qty || 1);
        out.set(a.row.key, { name: productName, expansion, qty, primary: true });
        out.set(b.row.key, { name: productName, expansion, qty, primary: false });
      }
    }
  }
  return out;
}

/**
 * Exact Cardmarket token product for a Scryfall token card, searched in the
 * expansions of its parent set. Prefers the plainest name when several
 * match (e.g. without a keyword suffix).
 * @returns {{ name: string, expansion: string } | null}
 */
export function cardmarketTokenTarget(map, card) {
  if (!map?.ts || !map?.tk || !card?.set) return null;
  const faces = describeTokenFaces(card);
  const want = faces[0];
  if (!want.name) return null;
  const wantColors = want.colors.join('');
  const expansions = map.ts[String(card.set).toLowerCase()] || [];
  let best = null;        // product printed with this token alone
  let bothFaces = null;   // product printing both halves of a two-sided token
  let onOneCard = null;   // product whose other half is something else
  for (const exp of expansions) {
    const expansion = map.e?.[exp];
    if (!expansion) continue;
    for (const productName of map.tk[exp] || []) {
      const halves = splitProductFaces(productName);
      if (halves) {
        // Two tokens on one card. Parse the halves — running the
        // single-product parser over the whole name would match the first
        // half by accident and miss the second.
        if (faces.length > 1 && !bothFaces && matchesBothFaces(productName, faces)) {
          bothFaces = { name: productName, expansion };
        }
        if (!onOneCard && halves.map(parseTokenFace).some(f => faceMatchesWant(f, want))) {
          onOneCard = { name: productName, expansion };
        }
        continue;
      }
      const p = parseTokenProduct(productName);
      if (!p || p.base.toLowerCase() !== want.name.toLowerCase()) continue;
      if (p.pt !== want.pt) continue;
      if (p.knownColors && WUBRG.filter(c => p.colors.has(c)).join('') !== wantColors) continue;
      if (!best || p.extra.length < best.score) {
        best = { name: productName, expansion, score: p.extra.length };
      }
    }
  }
  // The two-sided product wins over a single-faced one that merely shares
  // the front face's name — they are different cards.
  if (bothFaces) return bothFaces;
  if (best) return { name: best.name, expansion: best.expansion };
  // Sold only as the card it shares with another token — that is what you
  // have to buy to get it.
  if (onOneCard) return onOneCard;
  // Newer sets keep their tokens in a separate "<Set>: Tokens" expansion
  // that the catalog data doesn't name. Only when the set's own expansions
  // hold no tokens at all is that the likely home — named after the main
  // expansion (first entry).
  const setHasTokens = expansions.some(exp => (map.tk[exp] || []).length > 0);
  const parent = map.e?.[expansions[0]];
  if (parent && !setHasTokens) {
    return { name: tokenCardmarketName(card), expansion: `${parent}: Tokens`, guessed: true };
  }
  return null;
}
