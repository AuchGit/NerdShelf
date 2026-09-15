// src/features/mtg/deck-builder/services/deckExport.js
// Format a deck (mainboard + sideboard) as a standard MTG decklist text block,
// compatible with MTGO/Arena/Cockatrice/Moxfield import. Cards with a chosen
// artwork carry edition + collector number — `4 Lightning Bolt (2XM) 129` —
// so re-importing (here, Arena, Moxfield) picks the same printing.

/**
 * @param {Record<string, {card, count}>} mainboard
 * @param {Record<string, {card, count}>} sideboard
 * @param {Record<string, object>} [printings]  chosen artwork per entry id
 * @returns {string}
 */
export function formatDecklist(mainboard, sideboard, printings = {}) {
  const byName = ([, a], [, b]) => a.card.name.localeCompare(b.card.name);
  const line = ([id, { card, count }]) => {
    const p = printings?.[id];
    return p?.set && p?.collector_number
      ? `${count} ${card.name} (${p.set.toUpperCase()}) ${p.collector_number}`
      : `${count} ${card.name}`;
  };

  const lines = Object.entries(mainboard || {}).sort(byName).map(line);
  const sideEntries = Object.entries(sideboard || {}).sort(byName);
  if (sideEntries.length > 0) {
    lines.push('');
    lines.push('Sideboard');
    lines.push(...sideEntries.map(line));
  }

  return lines.join('\n');
}

/**
 * Copy a decklist to the system clipboard. Returns true on success.
 */
export async function copyDecklistToClipboard(mainboard, sideboard, printings) {
  const text = formatDecklist(mainboard, sideboard, printings);
  if (!text) return false;

  // Modern API
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy
    }
  }

  // Legacy fallback (insecure contexts, older browsers)
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
