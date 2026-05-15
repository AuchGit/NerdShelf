// src/features/wh40k/Wh40kApp.jsx
//
// Top-level mount for the Warhammer 40K section. Owns the sub-routes; mounts
// inside the existing global <Layout> / <Sidebar>, so it does not own its
// own chrome. The dashboard, unit browser, army builder, favorites, and
// inventory pages are all sub-routes; each renders the shared sub-nav.

import { Routes, Route } from 'react-router-dom';
import Wh40kDashboard from './Wh40kDashboard';
import Wh40kArmyBuilderApp from './Wh40kArmyBuilderApp';
import UnitBrowserPage from './pages/UnitBrowserPage';
import FavoritesPage from './pages/FavoritesPage';
import InventoryPage from './pages/InventoryPage';
import CombatDashboardPage from './pages/CombatDashboardPage';
import CombatSessionPage from './pages/CombatSessionPage';
import Wh40kSubNav from './components/Wh40kSubNav';

function withSubNav(node) {
  return (
    <>
      <Wh40kSubNav />
      {node}
    </>
  );
}

export default function Wh40kApp() {
  return (
    <Routes>
      <Route index            element={withSubNav(<Wh40kDashboard />)} />
      <Route path="units"     element={withSubNav(<UnitBrowserPage />)} />
      <Route path="favorites" element={withSubNav(<FavoritesPage />)} />
      <Route path="inventory" element={withSubNav(<InventoryPage />)} />
      <Route path="combat"    element={withSubNav(<CombatDashboardPage />)} />
      {/* Army builder + combat session take the full content area (own header) */}
      <Route path="army/new"        element={<Wh40kArmyBuilderApp />} />
      <Route path="army/:armyId"    element={<Wh40kArmyBuilderApp />} />
      <Route path="combat/:sessionId" element={<CombatSessionPage />} />
    </Routes>
  );
}
