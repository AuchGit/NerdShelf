// src/features/wh40k/pwa/Wh40kArmyBuilderMobile.jsx
//
// Mobile-first shell for the WH40K army builder. Rendered by
// Wh40kArmyBuilderApp INSTEAD of the desktop 2-column layout whenever
// usePwaMobile reports we're on a phone. The desktop layout is left
// completely unchanged.
//
// Layout:
//   • Compact sticky header with back / name / save + overflow menu
//   • Sticky toolbar with faction + detachment selects (the two single
//     most important choices in army building)
//   • Tab-based body — "Einheiten" (filters + grid + detail), "Armee"
//     (roster + notes), and "Detachment" (rules / strats / enhancements,
//     only when a detachment is picked)
//
// Reuse: the parent (Wh40kArmyBuilderApp) still owns all state. We
// receive the already-constructed panels (UnitFilters, UnitGrid,
// UnitDetail, ArmyPanel, DetachmentInfo) as JSX props and just place
// them. Same wiring discipline as the MTG mobile shell.

import { useState } from 'react';
import { ActionSheet } from '../../../shared/ui';
import './Wh40kArmyBuilderMobile.css';

export default function Wh40kArmyBuilderMobile({
  // Chrome --------------------------------------------------
  army, setArmy,
  factions, detachments,
  dirty, saving, onSave, saveStatus, exportStatus,
  onBack,
  // Roster meta + actions for overflow menu ----------------
  onExport,
  onClear,
  // Validation -----------------------------------------------
  validationErrors,
  // Pre-built panels ----------------------------------------
  unitFiltersPanel,
  unitGridPanel,
  unitDetailPanel,
  armyPanel,
  detachmentPanel,
  squadPanel,
  squadCount = 0,
  selectedDetachment,
  selectedUnit,
  pointsTotal,
}) {
  const [tab, setTab] = useState('units');     // 'units' | 'roster' | 'squads' | 'detach'
  const [menuOpen, setMenuOpen] = useState(false);

  const status = saveStatus || exportStatus;

  // ─── Header (compact, single row) ─────────────────────
  const header = (
    <header className="ab-mob-header">
      <button
        type="button"
        className="ab-mob-back-btn"
        onClick={onBack}
        title="Zurück"
        aria-label="Zurück"
      >←</button>
      <input
        value={army.name}
        onChange={(e) => setArmy(a => ({ ...a, name: e.target.value }))}
        placeholder="Armee-Name…"
        className="ab-mob-name-input"
      />
      {status && (
        <span
          className="ab-mob-status"
          style={{ color: status.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)' }}
        >
          {status.text}
        </span>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className={`ab-mob-save-btn ${dirty ? 'is-dirty' : ''}`}
        title={dirty ? 'Speichern' : 'Gespeichert'}
      >
        {saving ? '…' : dirty ? 'Speichern' : '✓'}
      </button>
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        className="ab-mob-menu-btn"
        aria-label="Mehr Optionen"
      >⋯</button>
    </header>
  );

  // ─── Toolbar: faction + detachment selects ────────────
  // These are the two big architectural decisions in army building, so
  // they get their own permanent row right under the header rather
  // than disappearing into the overflow menu.
  const toolbar = (
    <div className="ab-mob-toolbar">
      <select
        value={army.factionId}
        onChange={(e) => setArmy(a => ({ ...a, factionId: e.target.value, detachmentId: '' }))}
        className="ab-mob-select"
        title="Fraktion"
      >
        <option value="">— Fraktion —</option>
        {factions.map(f => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
      <select
        value={army.detachmentId}
        onChange={(e) => setArmy(a => ({ ...a, detachmentId: e.target.value }))}
        disabled={!army.factionId || detachments.length === 0}
        className="ab-mob-select"
        title="Detachment"
      >
        <option value="">— Detachment —</option>
        {detachments.map(d => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
    </div>
  );

  // ─── Validation banner (only when there are errors) ──
  const validationBanner = validationErrors?.length > 0 ? (
    <div className="ab-mob-validation">
      {validationErrors.map((e, i) => (
        <div key={i}>⚠ {e}</div>
      ))}
    </div>
  ) : null;

  // ─── Panels (display:none gating preserves scroll + state) ──
  const unitsPane = (
    <div
      className="ab-mob-pane ab-mob-pane-units"
      style={{ display: tab === 'units' ? 'flex' : 'none' }}
    >
      {unitFiltersPanel}
      {selectedUnit && (
        <div className="ab-mob-detail-overlay">
          {unitDetailPanel}
        </div>
      )}
      <div className="ab-mob-grid-wrap">
        {unitGridPanel}
      </div>
    </div>
  );

  const rosterPane = (
    <div
      className="ab-mob-pane ab-mob-pane-roster"
      style={{ display: tab === 'roster' ? 'flex' : 'none' }}
    >
      <div className="ab-mob-roster-frame">
        {armyPanel}
      </div>
      <div className="ab-mob-notes">
        <label className="ab-mob-notes-label">Notizen</label>
        <textarea
          value={army.notes}
          onChange={(e) => setArmy(a => ({ ...a, notes: e.target.value }))}
          rows={5}
          placeholder="Strategie, Listenideen, …"
          className="ab-mob-notes-input"
        />
      </div>
    </div>
  );

  const detachPane = (
    <div
      className="ab-mob-pane ab-mob-pane-detach"
      style={{ display: tab === 'detach' ? 'flex' : 'none' }}
    >
      {selectedDetachment ? detachmentPanel : (
        <div className="ab-mob-empty">
          <div style={{ fontSize: 36, marginBottom: 12 }}>✦</div>
          <div>Wähle erst ein Detachment oben in der Toolbar.</div>
        </div>
      )}
    </div>
  );

  const squadsPane = (
    <div
      className="ab-mob-pane ab-mob-pane-squads"
      style={{ display: tab === 'squads' ? 'flex' : 'none' }}
    >
      {squadPanel}
    </div>
  );

  return (
    <div className="ab-mob-screen">
      {header}
      {toolbar}
      {validationBanner}

      <main className="ab-mob-main">
        {unitsPane}
        {rosterPane}
        {squadsPane}
        {detachPane}
      </main>

      <nav className="ab-mob-tabs" aria-label="Army-Builder-Ansicht">
        <TabBtn
          id="units"
          icon="⚔"
          label="Einheiten"
          active={tab === 'units'}
          onClick={() => setTab('units')}
        />
        <TabBtn
          id="roster"
          icon="◇"
          label="Armee"
          active={tab === 'roster'}
          onClick={() => setTab('roster')}
          badge={pointsTotal != null ? `${pointsTotal}` : null}
        />
        <TabBtn
          id="squads"
          icon="⛬"
          label="Squads"
          active={tab === 'squads'}
          onClick={() => setTab('squads')}
          badge={squadCount > 0 ? `${squadCount}` : null}
        />
        <TabBtn
          id="detach"
          icon="✦"
          label="Detach"
          active={tab === 'detach'}
          onClick={() => setTab('detach')}
          disabled={!army.detachmentId}
        />
      </nav>

      <ActionSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Armee-Optionen"
        items={[
          { id: 'export', label: 'Liste exportieren', icon: '⤴', onSelect: onExport },
          { id: 'clear', label: 'Alle Einheiten entfernen', icon: '🗑', danger: true,
            onSelect: () => {
              if (window.confirm('Wirklich ALLE Einheiten aus der Armee entfernen?')) onClear?.();
            } },
        ]}
      />
    </div>
  );
}

function TabBtn({ id, icon, label, active, onClick, badge, disabled }) {
  return (
    <button
      key={id}
      type="button"
      className={`ab-mob-tab ${active ? 'is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
    >
      <span className="ab-mob-tab-icon" aria-hidden="true">{icon}</span>
      <span className="ab-mob-tab-label">{label}</span>
      {badge != null && <span className="ab-mob-tab-badge">{badge}</span>}
    </button>
  );
}
