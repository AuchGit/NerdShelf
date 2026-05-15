// src/features/mtg/match-hud/services/matchCodes.js
//
// Generate short, human-friendly join codes for live Match HUD sessions.
//
// Design:
//   - 6 characters from a no-ambiguity alphabet (no 0/O, 1/I/L), uppercase.
//   - ~10⁹ permutations — collisions are vanishingly rare with handfuls of
//     concurrent matches, but we still treat the DB UNIQUE constraint as the
//     source of truth and retry on conflict (see matchApi.createMatch).
//   - Codes are case-normalised on read/write so users can type lowercase on
//     their phone without it mattering.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;

function randomBytes(n) {
  const out = new Uint8Array(n);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(out);
  } else {
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

/** Mint a fresh join code. Caller is responsible for retrying on DB collision. */
export function newJoinCode() {
  const bytes = randomBytes(CODE_LEN);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Normalise user input: strip whitespace, uppercase, drop unsupported chars.
 *  Used both on create (defensive) and on join (to be forgiving). */
export function normaliseCode(raw) {
  if (!raw) return '';
  return String(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LEN);
}

/** Display a code split into two groups: "ABC-DEF". Reads better aloud. */
export function formatCode(code) {
  const c = normaliseCode(code);
  if (c.length <= 3) return c;
  return `${c.slice(0, 3)}-${c.slice(3)}`;
}
