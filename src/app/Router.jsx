// src/app/Router.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './Layout';
import DndCharacterApp from '../features/dnd/character-builder/DndCharacterApp';
import MtgDashboard from '../features/mtg/deck-builder/MtgDashboard';
import MtgDeckBuilderApp from '../features/mtg/deck-builder/MtgDeckBuilderApp';

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dnd" replace />} />
          <Route path="/dnd/*" element={<DndCharacterApp />} />
          <Route path="/mtg" element={<MtgDashboard />} />
          <Route path="/mtg/deck/new" element={<MtgDeckBuilderApp />} />
          <Route path="/mtg/deck/:deckId" element={<MtgDeckBuilderApp />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
