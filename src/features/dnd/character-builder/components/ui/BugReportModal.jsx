// src/features/dnd/character-builder/components/ui/BugReportModal.jsx
// Bug reporting is global. This file only re-exports the no-op error collector
// so existing imports like `setupErrorCollector` in DndCharacterApp keep working.
// The actual collector lives in src/core/bug-report/collector.js and is
// installed by App.jsx — this is just a compatibility shim.
export function setupErrorCollector() { /* handled globally by NerdShelf */ }
export default function BugReportModal() { return null }