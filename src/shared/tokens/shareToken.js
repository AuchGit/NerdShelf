// src/shared/tokens/shareToken.js
//
// Generate stable, opaque, human-friendly "share tokens" for user-owned
// entities (MTG decks, WH40K armies, DnD characters). The token is the
// public identity of an entity — it travels with exports, can be quoted
// in a URL, and survives renames of the entity itself.
//
// Design:
//   - 12 chars, base32 (Crockford alphabet — no ambiguous 0/O, 1/l, etc.).
//     ~60 bits of entropy → collision-resistant up to ~10⁹ entities.
//   - Generated client-side using window.crypto.getRandomValues, with a
//     deterministic Math.random fallback for non-browser test contexts.
//   - Stored in a single nullable column `share_token` on the entity's
//     table; a unique index lets the runtime look an entity up by token
//     without scanning.
//   - NEVER regenerated on update — the token is the entity's permanent
//     fingerprint. `ensureToken(row)` returns the existing token or
//     mints a new one only when it's missing.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const TOKEN_LEN = 12;

function randomBytes(n) {
  const out = new Uint8Array(n);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(out);
  } else {
    // Test / SSR fallback. Math.random isn't cryptographically secure
    // but the tokens here aren't auth-critical — they're identifiers.
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

/** Mint a fresh share token. */
export function newShareToken() {
  const bytes = randomBytes(TOKEN_LEN);
  let out = '';
  for (let i = 0; i < TOKEN_LEN; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/**
 * Get the entity's token, generating one if absent. Used in save flows:
 *
 *   const token = ensureToken(deckRow);
 *   await supabase.from('mtg_decks').update({ share_token: token }) ...
 */
export function ensureToken(row, field = 'share_token') {
  if (row && row[field]) return row[field];
  return newShareToken();
}

/**
 * Format a token for display (groups of 4 with hyphens):
 *   "X3Q9F4MV7K2H" → "X3Q9-F4MV-7K2H"
 */
export function formatToken(token) {
  if (!token) return '';
  return String(token)
    .replace(/[^0-9A-Z]/gi, '')
    .toUpperCase()
    .match(/.{1,4}/g)
    ?.join('-') ?? token;
}

/** Copy a token (formatted) to the clipboard. */
export async function copyToken(token) {
  try {
    await navigator.clipboard.writeText(formatToken(token));
    return true;
  } catch {
    return false;
  }
}
