// src/features/mtg/deck-builder/services/deckImport.js
// Parse a standard MTG decklist text format.
// Supported patterns:
//   4 Lightning Bolt
//   4x Lightning Bolt
//   4 Lightning Bolt (LEA) 161     ← edition + collector number (Arena, Moxfield)
//   1 Lightning Bolt [M10]         ← edition only
//   1 Sol Ring (CMR) 472 *F*       ← markers like *F* are ignored
//   Mainboard marker: "Deck", "Mainboard", "Main Deck"
//   Sideboard marker: "Sideboard", "SB:"  (everything after goes to sideboard)
//
// An edition in the line picks exactly that printing as the card's artwork
// in the deck (see deckPrintings.js). If Scryfall doesn't know the printing,
// the card comes in with its default printing instead.
//
// Split and double-faced cards ("Fire // Ice", "Delver of Secrets //
// Insectile Aberration"): Scryfall's collection endpoint matches only the
// FRONT face name — the full name comes back as not_found. Every name is
// therefore looked up by its front face, and both spellings (plus the
// unspaced "Fire//Ice" some exports write) map back to the same card.

import { printingSummary } from './deckPrintings';

const SECTION_PATTERNS = {
  main: /^\s*(deck|mainboard|main\s*deck|maindeck)\s*:?\s*$/i,
  side: /^\s*(sideboard|side\s*deck|sb)\s*:?\s*$/i,
};

const LINE_PATTERN = /^\s*(\d+)\s*x?\s+(.+?)\s*$/i;
const MARKERS = /(?:\s+\*[A-Za-z]+\*)+$/;
const PRINT_SUFFIX = /\s+[([]([A-Za-z0-9]{2,6})[)\]](?:\s+([^\s()[\]]+))?$/;

const COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
const BATCH = 75;

/**
 * Parse a decklist text block into
 * { main: [{name, count, set, collector}], side: [...] }.
 * `set` (lowercase) and `collector` are null when the line has no edition.
 * @param {string} text
 */
export function parseDecklistText(text) {
  const main = [];
  const side = [];
  let current = main;

  for (const raw of (text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('#')) continue;
    if (SECTION_PATTERNS.main.test(line)) { current = main; continue; }
    if (SECTION_PATTERNS.side.test(line)) { current = side; continue; }
    // "SB: 4 Lightning Bolt" shorthand (Magic Workstation)
    const sbShort = line.match(/^SB:\s*(.+)$/i);
    const workLine = sbShort ? sbShort[1].trim() : line;
    const target = sbShort ? side : current;

    const m = workLine.match(LINE_PATTERN);
    if (!m) continue;
    const count = parseInt(m[1], 10);
    const entry = parseCardPart(m[2]);
    if (!count || !entry.name) continue;
    target.push({ ...entry, count });
  }

  return { main, side };
}

function parseCardPart(raw) {
  const rest = raw.replace(MARKERS, '').trim();
  const print = rest.match(PRINT_SUFFIX);
  if (print) {
    const name = rest.slice(0, print.index).trim();
    if (name) return { name, set: print[1].toLowerCase(), collector: print[2] || null };
  }
  return { name: cleanName(rest), set: null, collector: null };
}

function cleanName(name) {
  // Strip trailing set codes like "(LEA) 161" or "[M10]" if the regex didn't
  return name.replace(/\s*[[(][^\])]+[\])]\s*\S*$/, '').trim();
}

async function fetchCollection(identifiers) {
  const data = [];
  const notFound = [];
  for (let i = 0; i < identifiers.length; i += BATCH) {
    const batch = identifiers.slice(i, i + BATCH);
    try {
      const res = await fetch(COLLECTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: batch }),
      });
      if (!res.ok) {
        notFound.push(...batch);
      } else {
        const json = await res.json();
        data.push(...(json.data || []));
        notFound.push(...(json.not_found || []));
      }
    } catch {
      notFound.push(...batch);
    }
    // be nice to Scryfall's rate limit
    if (i + BATCH < identifiers.length) await new Promise(r => setTimeout(r, 100));
  }
  return { data, notFound };
}

/**
 * Look up card names via Scryfall's collection endpoint (batch, up to 75).
 * Returns { found: [{name, card}], notFound: [name] }.
 */
export async function resolveCardNames(names) {
  const uniq = [...new Set(names.map(lookupName).filter(Boolean))];
  const { data, notFound } = await fetchCollection(uniq.map(name => ({ name })));
  return {
    found: data.map(card => ({ name: nameKey(card.name), card })),
    notFound: notFound.map(x => x.name).filter(Boolean),
  };
}

/** Lookup key for a card name: lowercase, "//" always spaced the same. */
function nameKey(name) {
  return String(name || '').replace(/\s*\/\/\s*/g, ' // ').trim().toLowerCase();
}

/**
 * The name to ASK Scryfall for. Its collection endpoint knows split and
 * double-faced cards by their front face only, so "Fire // Ice" (and
 * "Fire//Ice") have to go over the wire as "Fire".
 */
export function lookupName(name) {
  return nameKey(name).split(' // ')[0].trim();
}

/** Full and front-face name of a card — both map back to it. */
function namesOf(card) {
  const full = nameKey(card.name);
  const front = lookupName(card.name);
  return front === full ? [full] : [full, front];
}

function printKey({ name, set, collector }) {
  return collector
    ? `${set}#${String(collector).toLowerCase()}`
    : `${set}|${nameKey(name)}`;
}

/**
 * Resolve a parsed decklist: every name to its default printing, and every
 * line with an edition to that exact printing.
 * @returns {{ found, notFound, prints: Map<string, object> }}
 */
export async function resolveDecklist(parsed) {
  const entries = [...parsed.main, ...parsed.side];
  const named = await resolveCardNames(entries.map(e => e.name));

  const identifiers = new Map();
  for (const e of entries) {
    if (!e.set || identifiers.has(printKey(e))) continue;
    identifiers.set(printKey(e), e.collector
      ? { set: e.set, collector_number: e.collector }
      : { name: lookupName(e.name), set: e.set });
  }
  const prints = new Map();
  if (identifiers.size > 0) {
    const { data } = await fetchCollection([...identifiers.values()]);
    for (const card of data) {
      prints.set(`${card.set}#${String(card.collector_number).toLowerCase()}`, card);
      for (const n of namesOf(card)) prints.set(`${card.set}|${n}`, card);
    }
  }
  return { ...named, prints };
}

/**
 * Combine parsed list + resolved cards into deck entry objects.
 * Entries are keyed by the default printing (like cards added from the
 * search); a line's edition becomes the entry's artwork in `printings`.
 * @returns { mainboard, sideboard, printings, notFound, fallbacks }
 *   fallbacks: lines whose edition wasn't found (imported with default art)
 */
export function buildDeckFromParsed(parsed, resolved) {
  const byName = new Map();
  for (const { card } of resolved.found) {
    for (const n of namesOf(card)) if (!byName.has(n)) byName.set(n, card);
  }
  const prints = resolved.prints || new Map();
  const printings = {};
  const missing = new Set();
  const fallbacks = new Set();

  function build(entries) {
    const out = {};
    for (const e of entries) {
      const exact = e.set ? prints.get(printKey(e)) : null;
      const card = byName.get(nameKey(e.name)) || byName.get(lookupName(e.name)) || exact;
      if (!card) { missing.add(e.name); continue; }
      if (e.set && !exact) {
        fallbacks.add(`${e.name} (${e.set.toUpperCase()}${e.collector ? ` ${e.collector}` : ''})`);
      }
      const existing = out[card.id];
      out[card.id] = existing
        ? { card, count: existing.count + e.count }
        : { card, count: e.count };
      if (exact && !printings[card.id]) printings[card.id] = printingSummary(exact);
    }
    return out;
  }

  return {
    mainboard: build(parsed.main),
    sideboard: build(parsed.side),
    printings,
    notFound: [...missing],
    fallbacks: [...fallbacks],
  };
}
