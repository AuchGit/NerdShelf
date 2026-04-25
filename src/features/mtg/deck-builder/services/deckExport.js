// src/features/mtg/deck-builder/services/deckExport.js
// Format a deck (mainboard + sideboard) as a standard MTG decklist text block,
// compatible with MTGO/Arena/Cockatrice/Moxfield import.

/**
 * @param {Record<string, {card, count}>} mainboard
 * @param {Record<string, {card, count}>} sideboard
 * @returns {string}
 */
export function formatDecklist(mainboard, sideboard) {
  const mainEntries = Object.values(mainboard || {})
    .sort((a, b) => a.card.name.localeCompare(b.card.name));
  const sideEntries = Object.values(sideboard || {})
    .sort((a, b) => a.card.name.localeCompare(b.card.name));

  const lines = [];
  for (const { card, count } of mainEntries) {
    lines.push(`${count} ${card.name}`);
  }

  if (sideEntries.length > 0) {
    lines.push('');
    lines.push('Sideboard');
    for (const { card, count } of sideEntries) {
      lines.push(`${count} ${card.name}`);
    }
  }

  return lines.join('\n');
}

/**
 * Copy a decklist to the system clipboard. Returns true on success.
 */
export async function copyDecklistToClipboard(mainboard, sideboard) {
  const text = formatDecklist(mainboard, sideboard);
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
