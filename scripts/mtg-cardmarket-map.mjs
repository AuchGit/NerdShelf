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
const tokenSets = {};
for (const set of setList.data || []) {
  if (!set.tokenSetCode) continue;
  const ids = [set.mcmId, set.mcmIdExtras].filter(id => id && expansions[id]);
  if (ids.length) tokenSets[set.tokenSetCode.toLowerCase()] = ids;
}
const tokenExpansions = new Set(Object.values(tokenSets).flat());
const tokens = {};
for (const p of catalog.products || []) {
  if (!tokenExpansions.has(p.idExpansion)) continue;
  if (!/\bToken\b/.test(p.name) || p.name.includes(' // ')) continue;
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
