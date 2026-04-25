// src/features/mtg/deck-builder/services/deckImport.js
// Parse a standard MTG decklist text format.
// Supported patterns:
//   4 Lightning Bolt
//   4x Lightning Bolt
//   4 Lightning Bolt (LEA) 161
//   1 Lightning Bolt [M10]
//   Mainboard marker: "Deck", "Mainboard", "Main Deck"
//   Sideboard marker: "Sideboard", "SB:"  (everything after goes to sideboard)

const SECTION_PATTERNS = {
  main: /^\s*(deck|mainboard|main\s*deck|maindeck)\s*:?\s*$/i,
  side: /^\s*(sideboard|side\s*deck|sb)\s*:?\s*$/i,
};

const LINE_PATTERN = /^\s*(\d+)\s*x?\s+(.+?)(?:\s+\([^)]+\)\s*\S*)?\s*$/i;

/**
 * Parse a decklist text block into { main: [{name,count}], side: [{name,count}] }.
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
    const name = cleanName(m[2]);
    if (!count || !name) continue;
    target.push({ name, count });
  }

  return { main, side };
}

function cleanName(name) {
  // Strip trailing set codes like "(LEA) 161" or "[M10]" if the regex didn't
  return name.replace(/\s*[\[\(][^\])]+[\])]\s*\S*$/, '').trim();
}

/**
 * Look up card names via Scryfall's collection endpoint (batch, up to 75).
 * Returns { found: [{name, card}], notFound: [name] }.
 */
export async function resolveCardNames(names) {
  const uniq = [...new Set(names.map(n => n.toLowerCase()))];
  const found = [];
  const notFound = [];

  // Scryfall /cards/collection accepts up to 75 identifiers per call
  for (let i = 0; i < uniq.length; i += 75) {
    const batch = uniq.slice(i, i + 75);
    const body = { identifiers: batch.map(n => ({ name: n })) };

    try {
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        for (const n of batch) notFound.push(n);
        continue;
      }
      const json = await res.json();
      for (const card of (json.data || [])) {
        found.push({ name: card.name.toLowerCase(), card });
      }
      for (const miss of (json.not_found || [])) {
        notFound.push(miss.name);
      }
    } catch (e) {
      for (const n of batch) notFound.push(n);
    }
    // be nice to Scryfall's rate limit
    if (i + 75 < uniq.length) await new Promise(r => setTimeout(r, 100));
  }

  return { found, notFound };
}

/**
 * Combine parsed list + resolved cards into deck entry objects.
 * @returns { mainboard, sideboard, notFound }
 */
export function buildDeckFromParsed(parsed, resolved) {
  const byName = new Map();
  for (const { name, card } of resolved.found) {
    byName.set(name, card);
  }

  function build(entries) {
    const out = {};
    for (const { name, count } of entries) {
      const card = byName.get(name.toLowerCase());
      if (!card) continue;
      const existing = out[card.id];
      out[card.id] = existing
        ? { card, count: existing.count + count }
        : { card, count };
    }
    return out;
  }

  return {
    mainboard: build(parsed.main),
    sideboard: build(parsed.side),
    notFound: resolved.notFound,
  };
}
