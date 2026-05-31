// src/app/Router.jsx
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Layout from './Layout';
import DndCharacterApp from '../features/dnd/character-builder/DndCharacterApp';
import MtgDashboard from '../features/mtg/deck-builder/MtgDashboard';
import MtgDeckBuilderApp from '../features/mtg/deck-builder/MtgDeckBuilderApp';
import DeckViewPage from '../features/mtg/deck-builder/pages/DeckViewPage';
import MtgInventoryPage from '../features/mtg/deck-builder/pages/MtgInventoryPage';
import MtgWishlistPage from '../features/mtg/deck-builder/pages/MtgWishlistPage';
import MatchHudDashboardPage from '../features/mtg/match-hud/pages/MatchHudDashboardPage';
import MatchHudSessionPage from '../features/mtg/match-hud/pages/MatchHudSessionPage';
import LocalMatchPage from '../features/mtg/match-hud/pages/LocalMatchPage';
import Wh40kApp from '../features/wh40k/Wh40kApp';

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
    return v;
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
      localStorage.setItem(LAST_ROUTE_KEY, location.pathname + location.search);
    } catch { /* ignore */ }
  }, [location.pathname, location.search]);
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
          <Route path="/mtg/deck/view/:token" element={<DeckViewPage />} />
          <Route path="/mtg/deck/:deckId" element={<MtgDeckBuilderApp />} />
          <Route path="/wh40k/*" element={<Wh40kApp />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
