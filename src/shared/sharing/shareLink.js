// src/shared/sharing/shareLink.js
//
// Build shareable HTTPS deep-links for entity/campaign tokens and trigger
// the platform's native share sheet where available. Pure JS — no React.
//
// URL shape:
//   <APP_URL>/dnd/?import=<token>     – DnD character
//   <APP_URL>/mtg/?import=<token>     – MTG deck
//   <APP_URL>/wh40k/?import=<token>   – WH40K army
//   <APP_URL>/dnd/?join=<token>       – DnD campaign join
//
// The receiving section's dashboard reads its query parameter on mount
// (see useDeepLinkImport) and runs the import / join flow with the
// token pre-filled.
//
// APP_URL resolution:
//   1. In a normal web browser (the PWA): window.location.origin + the
//      Vite BASE_URL. This works for any deployment without configuration.
//   2. In Tauri desktop (window.__TAURI_INTERNALS__): falls back to the
//      hosted PWA URL — Tauri's tauri://localhost is not shareable. Set
//      VITE_PUBLIC_APP_URL at build time to override the default.

const KIND_TO_PATH = {
  mtg_deck:      'mtg',
  wh40k_army:    'wh40k',
  dnd_character: 'dnd',
  dnd_campaign:  'dnd',
}

const KIND_LABEL = {
  mtg_deck:      'MTG-Deck',
  wh40k_army:    'WH40K-Armee',
  dnd_character: 'DnD-Charakter',
  dnd_campaign:  'DnD-Campaign',
}

// Fallback for Tauri / SSR — override via VITE_PUBLIC_APP_URL or by
// editing this string when deploying to a different host.
const DEFAULT_PUBLIC_URL = 'https://auchgit.github.io/NerdShelf/'

function publicBase() {
  const env = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PUBLIC_APP_URL) || null
  if (env) return env.endsWith('/') ? env : env + '/'

  const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
  if (isTauri) return DEFAULT_PUBLIC_URL

  if (typeof window === 'undefined') return DEFAULT_PUBLIC_URL
  // Vite injects BASE_URL — '/NerdShelf/' for the PWA build, '/' for Tauri.
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
  return window.location.origin + (base.endsWith('/') ? base : base + '/')
}

/**
 * Build a shareable HTTPS URL for a token of the given kind.
 * @param {'mtg_deck'|'wh40k_army'|'dnd_character'|'dnd_campaign'} kind
 * @param {string} token
 */
export function buildShareUrl(kind, token) {
  const path = KIND_TO_PATH[kind]
  if (!path || !token) return null
  const query = kind === 'dnd_campaign' ? 'join' : 'import'
  return `${publicBase()}${path}/?${query}=${encodeURIComponent(token)}`
}

/** Human-friendly label for messages and dialog titles. */
export function shareLabel(kind, name = '') {
  const base = KIND_LABEL[kind] || 'Eintrag'
  return name ? `${base} „${name}"` : base
}

/**
 * Whether the runtime exposes the Web Share API and we're on a touch
 * device that's likely to handle it usefully. Desktops sometimes
 * advertise navigator.share but their share sheet is half-baked, so we
 * only opt in for touch input.
 */
export function canNativeShare() {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false
  if (typeof window === 'undefined') return false
  // mobile / tablet / hybrid touch devices
  try {
    if (window.matchMedia?.('(hover: none) and (pointer: coarse)').matches) return true
  } catch { /* matchMedia missing — fall through */ }
  // Tauri desktop ships chromium with `share` defined but no integration.
  if (window.__TAURI_INTERNALS__) return false
  return false
}

/**
 * Trigger the native share sheet with a message + URL. Returns true on
 * success, false if the user cancelled or the API isn't available.
 */
export async function nativeShare({ title, text, url }) {
  if (!canNativeShare()) return false
  try {
    await navigator.share({ title, text, url })
    return true
  } catch (e) {
    // AbortError = user cancelled; anything else is logged but not thrown
    // (the caller already has the URL in clipboard as a fallback).
    if (e?.name !== 'AbortError') console.warn('[share] native share failed:', e)
    return false
  }
}

/** Plain clipboard copy of the URL. Returns true on success. */
export async function copyToClipboard(text) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
