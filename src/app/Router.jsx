// src/app/Router.jsx
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Layout from './Layout';
import DndCharacterApp from '../features/dnd/character-builder/DndCharacterApp';
import MtgDashboard from '../features/mtg/deck-builder/MtgDashboard';
import MtgDeckBuilderApp from '../features/mtg/deck-builder/MtgDeckBuilderApp';
import MtgInventoryPage from '../features/mtg/deck-builder/pages/MtgInventoryPage';
import MtgWishlistPage from '../features/mtg/deck-builder/pages/MtgWishlistPage';
import MtgFavoritesPage from '../features/mtg/deck-builder/pages/MtgFavoritesPage';
import Wh40kApp from '../features/wh40k/Wh40kApp';

const LAST_ROUTE_KEY = 'nerdshelf:lastRoute';

function readLastRoute() {
  try {
    const v = localStorage.getItem(LAST_ROUTE_KEY);
    if (!v || v === '/' || !v.startsWith('/')) return null;
    return v;
  } catch { return null; }
}

function RouteTracker() {
  const location = useLocation();
  useEffect(() => {
    if (location.pathname && location.pathname !== '/') {
      try {
        localStorage.setItem(LAST_ROUTE_KEY, location.pathname + location.search);
      } catch { /* ignore */ }
    }
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
          <Route path="/mtg/favorites" element={<MtgFavoritesPage />} />
          <Route path="/mtg/deck/new" element={<MtgDeckBuilderApp />} />
          <Route path="/mtg/deck/:deckId" element={<MtgDeckBuilderApp />} />
          <Route path="/wh40k/*" element={<Wh40kApp />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
