// src/features/wh40k/Wh40kApp.jsx
//
// Top-level mount for the Warhammer 40K section. Owns the sub-routes; mounts
// inside the existing global <Layout> / <Sidebar>, so it does not own its
// own chrome. The dashboard, unit browser, army builder, favorites, and
// inventory pages are all sub-routes; each renders the shared sub-nav.

import { Routes, Route } from 'react-router-dom';
import lazyWithReload from '../../shared/lazyWithReload';
import Wh40kSubNav from './components/Wh40kSubNav';

// Pages load on first visit (Suspense boundary in the app Layout).
const Wh40kDashboard      = lazyWithReload(() => import('./Wh40kDashboard'));
const Wh40kArmyBuilderApp = lazyWithReload(() => import('./Wh40kArmyBuilderApp'));
const UnitBrowserPage     = lazyWithReload(() => import('./pages/UnitBrowserPage'));
const InventoryPage       = lazyWithReload(() => import('./pages/InventoryPage'));
const CombatDashboardPage = lazyWithReload(() => import('./pages/CombatDashboardPage'));
const CombatSessionPage   = lazyWithReload(() => import('./pages/CombatSessionPage'));
const ArmyViewPage        = lazyWithReload(() => import('./pages/ArmyViewPage'));

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
      <Route path="inventory" element={withSubNav(<InventoryPage />)} />
      <Route path="combat"    element={withSubNav(<CombatDashboardPage />)} />
      {/* Army builder + combat session take the full content area (own header) */}
      <Route path="army/new"        element={<Wh40kArmyBuilderApp />} />
      <Route path="army/view/:token" element={<ArmyViewPage />} />
      <Route path="army/:armyId"    element={<Wh40kArmyBuilderApp />} />
      <Route path="combat/:sessionId" element={<CombatSessionPage />} />
    </Routes>
  );
}
