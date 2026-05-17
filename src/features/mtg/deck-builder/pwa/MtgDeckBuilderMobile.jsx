// src/features/mtg/deck-builder/pwa/MtgDeckBuilderMobile.jsx
//
// Mobile-first shell for the MTG deck builder. Rendered by
// MtgDeckBuilderApp INSTEAD of the desktop 3-column layout whenever
// usePwaMobile reports we're on a phone — the desktop layout is left
// completely unchanged.
//
// Layout strategy:
//   • Portrait: bottom-tab navigation between three views — "Suche"
//     (search bar + result grid), "Deck" (mainboard + sideboard
//     manager), "Karte" (full-card preview pinned from any tab).
//   • Landscape: 2-column split — Search left, Deck right. Preview
//     appears as an overlay above the right column when a card is
//     pinned, so the deck stays one tap away.
//
// Reuse strategy:
//   The parent (MtgDeckBuilderApp) still owns ALL state and handlers.
//   This component receives the already-constructed CardSearch /
//   CardList / DeckPanel / CardPreview JSX as props and just composes
//   them into the mobile shell. That way the data layer is identical
//   between mobile and desktop — no duplication, no risk of drift.
//
// State preservation:
//   Tab switching uses `display: none` rather than conditional render
//   so scroll position + Scryfall pagination cache survive tab swaps.
//   Going back to the Suche tab puts you exactly where you left it.

import { useState } from 'react';
import { ActionSheet } from '../../../../shared/ui';
import usePwaMobile from '../../../../shared/hooks/usePwaMobile';
import './MtgDeckBuilderMobile.css';

export default function MtgDeckBuilderMobile({
  // Header / chrome ---------------------------------------------------
  navigate,
  deckName, setDeckName,
  deckFormat, setDeckFormat,
  formats,                       // array of { value, label }
  coverCardId, onOpenCoverPicker,
  commander, isCommanderFormat, onRemoveCommander,
  saving, saveStatus, exportStatus, dirty,
  onSave, onImport, onExport, onAnalyze,
  // Panels (pre-built by parent) ------------------------------------
  searchPanel,        // CardSearch (filter inputs)
  cardListPanel,      // CardList result grid for the search
  deckListViewPanel,  // DeckListView alt content (when viewMode === 'view')
  deckPanelEl,        // DeckPanel (mainboard / sideboard manager)
  previewPanel,       // CardPreview
  // View state -------------------------------------------------------
  viewMode, setViewMode,
  mainCount, sideCount,
  pinnedCard,
}) {
  const { isLandscape } = usePwaMobile();
  const [tab, setTab] = useState('search'); // 'search' | 'deck' | 'preview'
  const [menuOpen, setMenuOpen] = useState(false);

  // Auto-switch to the preview tab when the user pins a card from any
  // other tab — the implicit "show me this card now" expectation.
  // Stored as a ref-equivalent via lastPinnedRef so we don't loop.
  const [lastPinnedId, setLastPinnedId] = useState(null);
  if (pinnedCard?.id && pinnedCard.id !== lastPinnedId) {
    setLastPinnedId(pinnedCard.id);
    if (!isLandscape && tab !== 'preview') setTab('preview');
  } else if (!pinnedCard && lastPinnedId) {
    setLastPinnedId(null);
  }

  const status = saveStatus || exportStatus;
  const deckCount = mainCount + sideCount;

  // ─── Header ─────────────────────────────────────────────────
  const header = (
    <header className="mtg-mob-header">
      <button
        type="button"
        className="mtg-mob-back-btn"
        onClick={() => navigate('/mtg')}
        title="Zurück zum Dashboard"
      >←</button>
      <input
        value={deckName}
        onChange={(e) => setDeckName(e.target.value)}
        className="mtg-mob-deck-name"
        placeholder="Deck-Name…"
      />
      {status && (
        <span
          className="mtg-mob-status"
          style={{ color: status.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)' }}
        >
          {status.text}
        </span>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className={`mtg-mob-save-btn ${dirty ? 'is-dirty' : ''}`}
        title={dirty ? 'Speichern' : 'Gespeichert'}
      >
        {saving ? '…' : dirty ? 'Speichern' : '✓'}
      </button>
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        className="mtg-mob-menu-btn"
        aria-label="Mehr Optionen"
      >⋯</button>
    </header>
  );

  // ─── Toolbar (format + indicators) ──────────────────────────
  // A second header row with the deck-level metadata. Stays under the
  // primary header so the deck name + save are still thumb-reachable
  // even on a tall page.
  const toolbar = (
    <div className="mtg-mob-toolbar">
      <select
        value={deckFormat}
        onChange={(e) => setDeckFormat(e.target.value)}
        className="mtg-mob-format"
        title="Deck-Format"
      >
        {formats.map(({ value, label }) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      {coverCardId && (
        <button
          type="button"
          className="mtg-mob-chip is-active"
          onClick={onOpenCoverPicker}
          title="Cover wählen"
        >✦ Cover</button>
      )}
      {isCommanderFormat && commander && (
        <button
          type="button"
          className="mtg-mob-chip is-active"
          onClick={() => {
            if (window.confirm(`Commander „${commander.name}" entfernen?`)) onRemoveCommander(null);
          }}
          title="Commander entfernen / wechseln"
        >♛ <span className="mtg-mob-chip-ellipsis">{commander.name}</span></button>
      )}
    </div>
  );

  // ─── Body panels ────────────────────────────────────────────
  // Render ALL panels at once (display:none gates which is visible)
  // so scroll positions / search pagination / typing state survive
  // tab swaps.
  const searchBody = (
    <>
      {searchPanel}
      {viewMode === 'edit' ? cardListPanel : deckListViewPanel}
    </>
  );

  const previewBody = pinnedCard ? previewPanel : (
    <div className="mtg-mob-empty">
      <div style={{ fontSize: 36, marginBottom: 12 }}>◧</div>
      <div>Tippe eine Karte in der Suche an, um sie hier zu sehen.</div>
    </div>
  );

  // ─── Action sheet items ─────────────────────────────────────
  const menuItems = [
    {
      id: 'view',
      label: viewMode === 'edit' ? 'Deck-Übersicht zeigen' : 'Zurück zur Suche',
      icon: '⇆',
      onSelect: () => setViewMode(viewMode === 'edit' ? 'view' : 'edit'),
    },
    { id: 'cover', label: 'Cover-Karte wählen', icon: '✦', onSelect: onOpenCoverPicker },
    { id: 'import', label: 'Decklist importieren', icon: '↓', onSelect: onImport },
    { id: 'export', label: 'Decklist kopieren', icon: '↑', onSelect: onExport },
    { id: 'analyze', label: 'Deck analysieren', icon: '⚡', onSelect: onAnalyze },
  ];

  return (
    <div className="mtg-mob-screen">
      {header}
      {toolbar}

      {isLandscape ? (
        // ── Landscape: side-by-side ────────────────────────────
        // Search column scrolls independently. The right column shows
        // the deck panel by default, swaps to the card preview when
        // the user has pinned a card (small "✕" button to return).
        <div className="mtg-mob-split">
          <div className="mtg-mob-col mtg-mob-col-search">
            {searchBody}
          </div>
          <div className="mtg-mob-col mtg-mob-col-deck">
            {pinnedCard ? (
              <div className="mtg-mob-preview-frame">
                <div className="mtg-mob-preview-head">
                  <span>Karten-Vorschau</span>
                  <button
                    type="button"
                    className="mtg-mob-preview-close"
                    onClick={() => setLastPinnedId(null /* let parent unpin */)}
                  >Zurück zum Deck →</button>
                </div>
                {previewPanel}
              </div>
            ) : (
              deckPanelEl
            )}
          </div>
        </div>
      ) : (
        // ── Portrait: tab-based ────────────────────────────────
        // Three panes stacked with display:none, bottom tab bar
        // switches which is visible.
        <main className="mtg-mob-main">
          <div className="mtg-mob-pane" style={{ display: tab === 'search'  ? 'flex' : 'none' }}>
            {searchBody}
          </div>
          <div className="mtg-mob-pane" style={{ display: tab === 'deck'    ? 'flex' : 'none' }}>
            {deckPanelEl}
          </div>
          <div className="mtg-mob-pane" style={{ display: tab === 'preview' ? 'flex' : 'none' }}>
            {previewBody}
          </div>
        </main>
      )}

      {!isLandscape && (
        <nav className="mtg-mob-tabs" aria-label="Deck-Builder-Ansicht">
          <TabBtn
            id="search" label="Suche" icon="⌕"
            active={tab === 'search'} onClick={() => setTab('search')}
          />
          <TabBtn
            id="deck" label="Deck" icon="◇"
            active={tab === 'deck'} onClick={() => setTab('deck')}
            badge={deckCount > 0 ? deckCount : null}
          />
          <TabBtn
            id="preview" label="Karte" icon="◧"
            active={tab === 'preview'} onClick={() => setTab('preview')}
            badge={pinnedCard ? '●' : null}
          />
        </nav>
      )}

      <ActionSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Deck-Optionen"
        items={menuItems}
      />
    </div>
  );
}

function TabBtn({ id, label, icon, active, onClick, badge }) {
  return (
    <button
      key={id}
      type="button"
      className={`mtg-mob-tab ${active ? 'is-active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="mtg-mob-tab-icon" aria-hidden="true">{icon}</span>
      <span className="mtg-mob-tab-label">{label}</span>
      {badge != null && (
        <span className="mtg-mob-tab-badge">{badge}</span>
      )}
    </button>
  );
}
