// src/features/mtg/deck-builder/services/scryfallTags.js
//
// Scryfall Tagger "oracle tags" — community tags describing what a card
// does (removal, ramp, draw engine, …). Scryfall search understands them
// as `otag:<slug>`, but card objects don't carry them and there is no
// per-card lookup. The source is Scryfall's daily bulk file (≈6 MB gzip,
// JSON lines, one tag per line with the oracle ids it applies to).
//
// We stream it once, reduce it to a compact index — the tag list plus
// oracle id → tag indices — keep that in IndexedDB and refresh it at most
// weekly. Tags form a hierarchy (e.g. "mana rock" → "mana producer" →
// "ramp"); like Scryfall's `otag:`, a tag also matches cards tagged with
// one of its descendants.
//
// The index helpers are pure (unit-tested); the loading section at the
// bottom needs a browser.

const BULK_LIST_URL = 'https://api.scryfall.com/bulk-data';
const BULK_TYPE = 'oracle_tags';
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const INDEX_VERSION = 1;

/** Returns i → [i, ...all ancestors of i] (memoized, cycle-safe). */
function ancestorClosure(parents) {
  const memo = new Map();
  return (i) => {
    if (memo.has(i)) return memo.get(i);
    const out = new Set([i]);
    const stack = [...(parents[i] || [])];
    while (stack.length) {
      const p = stack.pop();
      if (out.has(p)) continue;
      out.add(p);
      stack.push(...(parents[p] || []));
    }
    const arr = [...out];
    memo.set(i, arr);
    return arr;
  };
}

/**
 * Incrementally build the index from raw bulk tag objects, so the 18 MB
 * file never has to sit in memory as a whole.
 */
export function createTagIndexBuilder() {
  const tags = [];
  const byOracle = new Map();
  return {
    add(raw) {
      if (!raw?.label || (raw.type && raw.type !== 'oracle')) return;
      const idx = tags.length;
      tags.push({
        id: raw.id,
        label: raw.label,
        slug: raw.slug || raw.label.trim().replace(/\s+/g, '-'),
        description: raw.description || '',
        aliases: raw.aliases || [],
        parentIds: raw.parent_ids || [],
      });
      for (const t of raw.taggings || []) {
        if (!t?.oracle_id) continue;
        const list = byOracle.get(t.oracle_id);
        if (!list) byOracle.set(t.oracle_id, [idx]);
        else if (!list.includes(idx)) list.push(idx);
      }
    },
    finish() {
      const idxById = new Map(tags.map((t, i) => [t.id, i]));
      const parents = tags.map(t => t.parentIds.map(id => idxById.get(id)).filter(i => i != null));
      const closure = ancestorClosure(parents);
      // count = number of cards the tag matches, descendants included.
      const counts = new Array(tags.length).fill(0);
      for (const direct of byOracle.values()) {
        const all = new Set();
        for (const i of direct) for (const a of closure(i)) all.add(a);
        for (const i of all) counts[i]++;
      }
      return {
        version: INDEX_VERSION,
        tags: tags.map((t, i) => ({
          id: t.id,
          label: t.label,
          slug: t.slug,
          description: t.description,
          aliases: t.aliases,
          parents: parents[i],
          count: counts[i],
        })),
        byOracle: Object.fromEntries(byOracle),
      };
    },
  };
}

const derived = new WeakMap();
function derive(index) {
  let d = derived.get(index);
  if (!d) {
    d = {
      bySlug: new Map(index.tags.map((t, i) => [t.slug, i])),
      closure: ancestorClosure(index.tags.map(t => t.parents || [])),
    };
    derived.set(index, d);
  }
  return d;
}

export function oracleIdOf(card) {
  return card?.oracle_id || card?.card_faces?.[0]?.oracle_id || null;
}

function directTagIdx(index, card) {
  const oid = oracleIdOf(card);
  return (index && oid && index.byOracle[oid]) || [];
}

/** Tags placed directly on a card, broadest (most cards) first. */
export function tagsForCard(index, card) {
  return directTagIdx(index, card)
    .map(i => index.tags[i])
    .filter(Boolean)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Whether a card carries the tag or one of its descendants. */
export function cardHasTag(index, card, slug) {
  if (!index) return false;
  const { bySlug, closure } = derive(index);
  const target = bySlug.get(slug);
  if (target == null) return false;
  return directTagIdx(index, card).some(i => closure(i).includes(target));
}

const normalize = (s) => s.toLowerCase().replace(/[-_]+/g, ' ').trim();

/**
 * Autocomplete over labels and aliases: exact match first, then word-prefix
 * matches, then substring matches — each ranked by how many cards match.
 */
export function searchTags(index, text, { limit = 8, exclude = [] } = {}) {
  if (!index) return [];
  const q = normalize(text || '');
  const skip = new Set(exclude);
  const hits = [];
  for (const t of index.tags) {
    if (!t.count || skip.has(t.slug)) continue;
    const names = [t.label, ...(t.aliases || [])].map(normalize);
    let rank = -1;
    if (!q) rank = 2;
    else if (names.includes(q)) rank = 0;
    else if (names.some(n => n.startsWith(q) || n.includes(` ${q}`))) rank = 1;
    else if (names.some(n => n.includes(q))) rank = 2;
    if (rank >= 0) hits.push({ t, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || b.t.count - a.t.count || a.t.label.localeCompare(b.t.label));
  return hits.slice(0, limit).map(h => h.t);
}

// ── loading (browser only) ─────────────────────────────────────────────
// A tiny external store so every component shares one download.

let state = { status: 'idle', index: null, error: null };
const listeners = new Set();

function setState(patch) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribeOracleTags(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOracleTagsState() {
  return state;
}

let running = false;

/** Start loading (no-op while loading or once loaded). Safe to call often. */
export function loadOracleTags() {
  if (running || state.status === 'ready') return;
  running = true;
  if (!state.index) setState({ status: 'loading', error: null });
  run()
    .catch(err => {
      // Keep a cached index usable even if the refresh failed.
      setState({ status: state.index ? 'ready' : 'error', error: err?.message || String(err) });
    })
    .finally(() => { running = false; });
}

async function run() {
  const cached = await cacheGet().catch(() => null);
  const usable = cached?.index?.version === INDEX_VERSION;
  if (usable) setState({ status: 'ready', index: cached.index, error: null });
  if (usable && Date.now() - (cached.fetchedAt || 0) < REFRESH_MS) return;

  const meta = await fetchBulkMeta();
  if (usable && cached.updatedAt === meta.updated_at) {
    await cacheSet({ ...cached, fetchedAt: Date.now() }).catch(() => {});
    return;
  }
  const index = await downloadIndex(meta.jsonl_download_uri || meta.download_uri);
  setState({ status: 'ready', index, error: null });
  await cacheSet({ updatedAt: meta.updated_at, fetchedAt: Date.now(), index }).catch(() => {});
}

async function fetchBulkMeta() {
  const res = await fetch(BULK_LIST_URL);
  if (!res.ok) throw new Error(`Scryfall error ${res.status}`);
  const json = await res.json();
  const meta = (json.data || []).find(b => b.type === BULK_TYPE);
  if (!meta) throw new Error('Scryfall bietet gerade keine Tag-Daten an.');
  return meta;
}

async function downloadIndex(url) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Tag-Download fehlgeschlagen (${res.status})`);
  let stream = res.body;
  // The file is served as application/gzip without Content-Encoding, so
  // the browser hands us the compressed bytes.
  if (/gzip/i.test(res.headers.get('content-type') || '') || /\.gz(\?|$)/.test(url)) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Dieser Browser kann die Tag-Daten nicht entpacken.');
    }
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  const builder = createTagIndexBuilder();
  let buf = '';
  const flush = (final) => {
    let start = 0;
    let nl;
    while ((nl = buf.indexOf('\n', start)) >= 0) {
      const line = buf.slice(start, nl).trim();
      if (line) builder.add(JSON.parse(line));
      start = nl + 1;
    }
    buf = buf.slice(start);
    if (final && buf.trim()) {
      builder.add(JSON.parse(buf));
      buf = '';
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    flush(false);
  }
  flush(true);
  return builder.finish();
}

const DB_NAME = 'nerdshelf-mtg';
const STORE = 'cache';
const CACHE_KEY = 'oracle-tags';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheGet() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(CACHE_KEY);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

async function cacheSet(value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, CACHE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
