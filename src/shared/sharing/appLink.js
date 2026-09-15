// src/shared/sharing/appLink.js
//
// `nerdshelf://` links for the desktop app. Share links are plain https
// (they must work everywhere); a browser on a PC that has the desktop app
// installed can hand the same path over to the app with this scheme, which
// the app registers (tauri-plugin-deep-link) and turns back into a route.
//
//   https://…/NerdShelf/mtg/?import=X3Q9F4MV7K2H  ↔  nerdshelf://mtg/?import=X3Q9F4MV7K2H

export const APP_SCHEME = 'nerdshelf';

/** App link for a route like "/mtg/?import=…". */
export function appLinkForRoute(route) {
  return `${APP_SCHEME}://${String(route || '').replace(/^\/+/, '')}`;
}

/** Route for an incoming app link, or null if it isn't one of ours. */
export function routeFromAppLink(url) {
  const prefix = `${APP_SCHEME}://`;
  if (typeof url !== 'string' || !url.toLowerCase().startsWith(prefix)) return null;
  const route = `/${url.slice(prefix.length).replace(/^\/+/, '')}`;
  return /^\/(mtg|wh40k|dnd)(\/|\?|$)/.test(route) ? route : null;
}
