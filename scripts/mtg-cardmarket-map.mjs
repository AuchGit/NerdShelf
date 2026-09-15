// scripts/mtg-cardmarket-map.mjs
//
// Builds public/data/mtg/cardmarket.json — Cardmarket product id →
// expansion name (+ "V.n" version) for the MTG Cardmarket export.
//
//   npm run mtg:cardmarket
//
// Sources:
//   - Cardmarket product catalog (public download): idProduct, idExpansion,
//     idMetacard — but no expansion names.
//   - MTGJSON SetList: Cardmarket expansion id + name per set, plus the id
//     of the set's "Extras" expansion (named "<set>: Extras" on Cardmarket).
//
// Versions: products of the same card (idMetacard) within one expansion are
// numbered V.1, V.2, … in product id order. Only expansions with a known
// name are written; everything else falls back to Scryfall's set name in
// the app.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCTS_URL = 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_1.json';
const SETLIST_URL = 'https://mtgjson.com/api/v5/SetList.json';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/mtg/cardmarket.json');
const HEADERS = { 'User-Agent': 'NerdShelf/1.0 (cardmarket map build)', Accept: 'application/json' };

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const [catalog, setList] = await Promise.all([getJson(PRODUCTS_URL), getJson(SETLIST_URL)]);

const expansions = {};
for (const set of setList.data || []) {
  if (!set.mcmName) continue;
  if (set.mcmId && !expansions[set.mcmId]) expansions[set.mcmId] = set.mcmName;
  if (set.mcmIdExtras && !expansions[set.mcmIdExtras]) expansions[set.mcmIdExtras] = `${set.mcmName}: Extras`;
}

const groups = new Map(); // `${idExpansion}|${idMetacard}` → [idProduct]
for (const p of catalog.products || []) {
  if (!expansions[p.idExpansion]) continue;
  const key = p.idMetacard ? `${p.idExpansion}|${p.idMetacard}` : `${p.idExpansion}|p${p.idProduct}`;
  const list = groups.get(key);
  if (list) list.push(p.idProduct); else groups.set(key, [p.idProduct]);
}

const products = {};
const usedExpansions = {};
for (const [key, ids] of groups) {
  const idExpansion = Number(key.split('|')[0]);
  usedExpansions[idExpansion] = expansions[idExpansion];
  ids.sort((a, b) => a - b);
  ids.forEach((id, i) => {
    products[id] = ids.length > 1 ? [idExpansion, i + 1] : [idExpansion];
  });
}

// Tokens: Scryfall token printings carry no Cardmarket id. Cardmarket keeps
// a set's tokens in the set's expansions (mostly "<set>: Extras") under
// names like "Goblin Token (Red 1/1)", so the app matches by name within
// the expansions of the token set's parent set.
const setByTokenCode = new Map(); // scryfall token set code → { name, ids }
for (const set of setList.data || []) {
  if (!set.tokenSetCode || !set.mcmName) continue;
  const code = set.tokenSetCode.toLowerCase();
  if (!setByTokenCode.has(code)) setByTokenCode.set(code, { name: set.mcmName, ids: [] });
  const entry = setByTokenCode.get(code);
  for (const id of [set.mcmId, set.mcmIdExtras]) {
    if (id && expansions[id] && !entry.ids.includes(id)) entry.ids.push(id);
  }
}

const isTokenProduct = (name) => /\bToken\b/.test(name);
const TOKENISH = /\bToken\b|Emblem|Helper Card|Dungeon/i;

const productsByExpansion = new Map();
for (const p of catalog.products || []) {
  const list = productsByExpansion.get(p.idExpansion);
  if (list) list.push(p.name); else productsByExpansion.set(p.idExpansion, [p.name]);
}

// Newer sets keep their tokens in an expansion of their own, named
// "<Set>: Tokens" on Cardmarket — and MTGJSON has no id for it. In the
// catalog those expansions stand out: no name of ours, and nothing but
// tokens inside. Match each to a set by comparing what it holds against
// Scryfall's tokens for that set, then name it after the set.
const candidates = [];
for (const [id, names] of productsByExpansion) {
  if (expansions[id] || names.length < 5) continue;
  if (names.filter(n => TOKENISH.test(n)).length / names.length >= 0.8) {
    candidates.push({ id, names, taken: false });
  }
}

/** "Wolf Token (B 1/1) // Clue Token" → ["wolf|1/1", "clue|"] */
function faceSignatures(productName) {
  const out = [];
  for (const half of String(productName).split(/\s*\/\/\s*|\s+\/\s+/)) {
    const m = half.trim().match(/^(.+?)(?:\s+Token)?(?:\s+\((.+)\))?$/);
    if (!m) continue;
    const pt = (m[2] || '').match(/(\*|X|\d+)\/(\*|X|\d+)/);
    out.push(`${m[1].trim().toLowerCase()}|${pt ? pt[0] : ''}`);
  }
  return out;
}

async function scryfallTokenSignatures(code) {
  const out = new Set();
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`set:${code}`)}&unique=cards&include_extras=true`;
  for (let page = 0; url && page < 3; page++) {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) break;
    const json = await res.json();
    for (const card of json.data || []) {
      const faces = Array.isArray(card.card_faces) && card.card_faces.length > 1 ? card.card_faces : [card];
      for (const face of faces) {
        const power = face.power ?? card.power;
        const toughness = face.toughness ?? card.toughness;
        const name = String(face.name || card.name).split(' // ')[0].trim().toLowerCase();
        out.add(`${name}|${power != null && toughness != null ? `${power}/${toughness}` : ''}`);
      }
    }
    url = json.has_more ? json.next_page : null;
    await new Promise(r => setTimeout(r, 120));
  }
  return out;
}

// Only sets whose known expansions hold no tokens at all can be missing one.
const gaps = [...setByTokenCode].filter(([, info]) =>
  !info.ids.some(id => (productsByExpansion.get(id) || []).some(isTokenProduct)));

const discovered = [];
for (const [code, info] of gaps) {
  let want;
  try {
    want = await scryfallTokenSignatures(code);
  } catch {
    continue; // Scryfall unavailable — fall back to the named expansions only
  }
  if (want.size === 0) continue;
  let best = null;
  for (const cand of candidates) {
    if (cand.taken) continue;
    const sigs = cand.names.flatMap(faceSignatures);
    if (sigs.length === 0) continue;
    const score = sigs.filter(s => want.has(s)).length / sigs.length;
    if (score >= 0.5 && (!best || score > best.score)) best = { cand, score };
  }
  if (!best) continue;
  best.cand.taken = true;
  expansions[best.cand.id] = `${info.name}: Tokens`;
  info.ids.push(best.cand.id);
  discovered.push(`${code} → ${expansions[best.cand.id]} (#${best.cand.id}, ${Math.round(best.score * 100)}%)`);
}

const tokenSets = {};
for (const [code, info] of setByTokenCode) {
  if (info.ids.length) tokenSets[code] = info.ids;
}
const tokenExpansions = new Set(Object.values(tokenSets).flat());
const tokens = {};
for (const p of catalog.products || []) {
  if (!tokenExpansions.has(p.idExpansion)) continue;
  // Keep the " // " names: those are the double-faced token products —
  // one physical card carrying two different tokens, e.g.
  // "Wolf Token (B 1/1) // Wolf Token (G 2/2)". Dropping them lost most of
  // the catalog's token entries. Split-card singles can't slip in here,
  // because a name without "Token" never gets this far.
  if (!isTokenProduct(p.name)) continue;
  const list = tokens[p.idExpansion] || (tokens[p.idExpansion] = []);
  if (!list.includes(p.name)) list.push(p.name);
  usedExpansions[p.idExpansion] = expansions[p.idExpansion];
}

const out = {
  createdAt: new Date().toISOString(),
  catalogCreatedAt: catalog.createdAt || null,
  e: usedExpansions,
  p: products,
  ts: tokenSets,
  tk: tokens,
};
await mkdir(dirname(OUT), { recursive: true });
const json = JSON.stringify(out);
await writeFile(OUT, json);
const tokenCount = Object.values(tokens).reduce((s, l) => s + l.length, 0);
console.log(`cardmarket map: ${Object.keys(products).length} products, ${tokenCount} token names, ${Object.keys(usedExpansions).length} expansions, ${(json.length / 1e6).toFixed(2)} MB → ${OUT}`);
if (discovered.length) {
  console.log(`token expansions matched to a set (${discovered.length}):`);
  for (const line of discovered) console.log(`  ${line}`);
}
