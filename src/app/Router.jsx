// src/app/Router.jsx
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { routeFromAppLink } from '../shared/sharing/appLink';
import { useEffect } from 'react';
import Layout from './Layout';
import lazyWithReload from '../shared/lazyWithReload';

// Every section loads its code when first opened (Suspense in Layout), so
// the app starts with a small bundle and an update only re-downloads the
// parts that changed.
const DndCharacterApp       = lazyWithReload(() => import('../features/dnd/character-builder/DndCharacterApp'));
const MtgDashboard          = lazyWithReload(() => import('../features/mtg/deck-builder/MtgDashboard'));
const MtgDeckBuilderApp     = lazyWithReload(() => import('../features/mtg/deck-builder/MtgDeckBuilderApp'));
const MtgInventoryPage      = lazyWithReload(() => import('../features/mtg/deck-builder/pages/MtgInventoryPage'));
const MtgWishlistPage       = lazyWithReload(() => import('../features/mtg/deck-builder/pages/MtgWishlistPage'));
const MatchHudDashboardPage = lazyWithReload(() => import('../features/mtg/match-hud/pages/MatchHudDashboardPage'));
const MatchHudSessionPage   = lazyWithReload(() => import('../features/mtg/match-hud/pages/MatchHudSessionPage'));
const LocalMatchPage        = lazyWithReload(() => import('../features/mtg/match-hud/pages/LocalMatchPage'));
const Wh40kApp              = lazyWithReload(() => import('../features/wh40k/Wh40kApp'));

const LAST_ROUTE_KEY = 'nerdshelf:lastRoute';

// Routes that point at *transient* state and should not be auto-resumed on
// the next app launch. A user who closes the app mid-match and re-opens it
// the next day shouldn't be teleported back into a session that's been over
// for hours (or, worse, into a session that's broken in some way — they'd
// have no way out because the HUD covers the side navigation). The
// dashboard handles "resume an active match" explicitly via the
// "Deine Matches" list, which is a much better recovery surface.
function isEphemeralRoute(pathname) {
  if (!pathname) return false;
  if (/^\/mtg\/match\/[^/]+/.test(pathname)) return true;
  return false;
}

// Share links carry ?import= / ?join=. Resuming such a route on the next
// launch would run the import again ("schon importiert") — never store them.
const DEEP_LINK_PARAMS = ['import', 'join'];
function withoutDeepLinkParams(route) {
  const q = route.indexOf('?');
  if (q < 0) return route;
  const params = new URLSearchParams(route.slice(q + 1));
  for (const p of DEEP_LINK_PARAMS) params.delete(p);
  const rest = params.toString();
  return route.slice(0, q) + (rest ? `?${rest}` : '');
}

function readLastRoute() {
  try {
    const v = localStorage.getItem(LAST_ROUTE_KEY);
    if (!v || v === '/' || !v.startsWith('/')) return null;
    // Even if a stale ephemeral route is sitting in storage from a previous
    // version of the app, ignore it. The user lands on the default page.
    if (isEphemeralRoute(v)) {
      try { localStorage.removeItem(LAST_ROUTE_KEY); } catch { /* ignore */ }
      return null;
    }
    return withoutDeepLinkParams(v);
  } catch { return null; }
}

function RouteTracker() {
  const location = useLocation();
  useEffect(() => {
    if (!location.pathname || location.pathname === '/') return;
    if (isEphemeralRoute(location.pathname)) return;
    // Popout-Routen NICHT als letzte Route persistieren — sonst startet
    // das Hauptfenster beim nächsten Launch versehentlich im Popout-
    // Modus (kein Sidebar, kein Header) und der User sieht "nur das
    // Sheet" ohne zu wissen warum.
    if (/[?&]popout=1\b/.test(location.search || '')) return;
    try {
      localStorage.setItem(LAST_ROUTE_KEY, withoutDeepLinkParams(location.pathname + location.search));
    } catch { /* ignore */ }
  }, [location.pathname, location.search]);
  return null;
}

// Desktop app: nerdshelf:// links (from "In der App öffnen" in the browser)
// start or focus the app — open the route they point at.
function DeepLinkListener() {
  const navigate = useNavigate();
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return undefined;
    let cancelled = false;
    let unlisten = null;
    const open = (urls) => {
      const route = routeFromAppLink(Array.isArray(urls) ? urls[0] : null);
      if (route && !cancelled) navigate(route);
    };
    import('@tauri-apps/plugin-deep-link')
      .then(async ({ getCurrent, onOpenUrl }) => {
        if (cancelled) return;
        open(await getCurrent().catch(() => null)); // link that launched the app
        const stop = await onOpenUrl(open);          // links while it runs
        if (cancelled) stop(); else unlisten = stop;
      })
      .catch(() => { /* plugin unavailable — nothing to listen to */ });
    return () => { cancelled = true; unlisten?.(); };
  }, [navigate]);
  return null;
}

function RootRedirect() {
  const last = readLastRoute();
  return <Navigate to={last || '/dnd'} replace />;
}

export default function Router() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <RouteTracker />
      <DeepLinkListener />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/dnd/*" element={<DndCharacterApp />} />
          <Route path="/mtg" element={<MtgDashboard />} />
          <Route path="/mtg/wishlist" element={<MtgWishlistPage />} />
          <Route path="/mtg/inventory" element={<MtgInventoryPage />} />
          <Route path="/mtg/match" element={<MatchHudDashboardPage />} />
          {/* /local must precede the :joinCode route so it isn't parsed
              as a (impossible) join code. */}
          <Route path="/mtg/match/local" element={<LocalMatchPage />} />
          <Route path="/mtg/match/:joinCode" element={<MatchHudSessionPage />} />
          <Route path="/mtg/deck/new" element={<MtgDeckBuilderApp />} />
          {/* Shared deck: the builder in read-only mode. The key keeps it a
              separate instance from the own-deck routes (a copy navigates
              from here to /mtg/deck/:id). */}
          <Route path="/mtg/deck/view/:token" element={<MtgDeckBuilderApp key="shared" readOnly />} />
          <Route path="/mtg/deck/:deckId" element={<MtgDeckBuilderApp />} />
          <Route path="/wh40k/*" element={<Wh40kApp />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
