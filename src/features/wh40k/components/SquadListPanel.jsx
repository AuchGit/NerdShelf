// src/features/wh40k/components/SquadListPanel.jsx
//
// Shared list view for the user's saved WH40K squads. Renders in three
// modes depending on context:
//
//   - Inventory page: each row has edit / duplicate / delete. No "add to
//     army" affordance (there's no army on this page).
//   - Army builder: each row gains a primary "+ Armee" button that drops
//     the squad into the currently-loaded army.
//   - Mobile: same JSX — the parent gives us less horizontal space and
//     the row's flex/wrap rules keep everything stacked correctly.
//
// The list is filterable by name and (optionally) faction so the user can
// find a squad in a long collection without scrolling.

import { useMemo, useState } from 'react';
import { Button } from '../../../shared/ui';
import { SearchBar } from '../../../shared/search';
import { totalSquadPoints } from '../hooks/useWh40kSquads';

export default function SquadListPanel({
  squads,
  loading,
  tableMissing,
  unitsById,
  factionsById,
  factionFilter,         // optional: hide squads of other factions
  onAdd,                 // optional: (squad) => void   "+ Armee" button
  onEdit,                // (squad) => void
  onDuplicate,           // (squad) => void
  onDelete,              // (squad) => void
  onCreateNew,           // () => void
  emptyHint,             // optional helper text under the empty state
  compact = false,       // shorter padding for sidebar/mobile placement
}) {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (squads || []).filter(s => {
      if (factionFilter && s.factionId && s.factionId !== factionFilter) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [squads, query, factionFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <SearchBar value={query} onChange={setQuery} placeholder="Squads durchsuchen…" />
        </div>
        {onCreateNew && (
          <Button size="sm" onClick={onCreateNew}>+ Neuer Squad</Button>
        )}
      </div>

      {tableMissing && (
        <div style={hintStyle}>
          Die <code>wh40k_squads</code>-Tabelle ist noch nicht migriert — Squads werden
          nur in dieser Sitzung gespeichert (siehe <code>scripts/wh40k-squads-schema.sql</code>).
        </div>
      )}

      {loading ? (
        <div style={{ ...hintStyle, textAlign: 'center' }}>Lade Squads…</div>
      ) : visible.length === 0 ? (
        <div
          style={{
            padding: compact ? 'var(--space-3)' : 'var(--space-5)',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            background: 'var(--color-surface)',
            border: '1px dashed var(--color-border)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          {squads.length === 0 ? (
            <>
              <div style={{ fontSize: 28, marginBottom: 6 }}>⛬</div>
              <div>Noch keine Squads gespeichert.</div>
              {emptyHint && (
                <div style={{ marginTop: 6, fontSize: 'var(--fs-xs)' }}>{emptyHint}</div>
              )}
            </>
          ) : (
            <div>Keine Treffer für „{query}".</div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visible.map(s => {
            const f = factionsById[s.factionId];
            const entries = s.entries || [];
            const pts = totalSquadPoints(s, unitsById);
            const totalModels = entries.reduce((n, e) => n + (Number(e.modelCount) || 0), 0);
            const missing = entries.filter(e => !unitsById[e.unitId]).length;
            const stale = entries.length === 0 || missing === entries.length;
            // Build a compact "5× Intercessors + 1 Lieutenant + 1 Apothecary"
            // summary, truncated to keep narrow mobile rows readable.
            const summaryParts = entries.map(e => {
              const u = unitsById[e.unitId];
              const name = u?.name || '?';
              return `${e.modelCount}× ${name}`;
            });
            const summary = summaryParts.length === 0
              ? '(leer)'
              : summaryParts.length <= 3
                ? summaryParts.join(' · ')
                : `${summaryParts.slice(0, 2).join(' · ')} · +${summaryParts.length - 2} weitere`;
            return (
              <div
                key={s.id}
                style={{
                  padding: compact ? '6px 8px' : '8px 10px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  flexWrap: 'wrap',
                  opacity: stale ? 0.6 : 1,
                }}
              >
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div
                    style={{
                      fontSize: 'var(--fs-sm)',
                      fontWeight: 'var(--fw-semibold)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {f?.icon && <span style={{ marginRight: 4 }}>{f.icon}</span>}
                    {s.name}
                    <span style={{
                      marginLeft: 6,
                      fontSize: 'var(--fs-xs)',
                      color: 'var(--color-accent)',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 'var(--fw-medium)',
                    }}>
                      {pts} Pkt
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 'var(--fs-xs)',
                      color: 'var(--color-text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={summaryParts.join(' · ')}
                  >
                    {summary}
                    {totalModels > 0 && <> · {totalModels} Modelle</>}
                    {missing > 0 && missing < entries.length && (
                      <> · <span style={{ color: 'var(--color-danger)' }}>{missing} fehlt</span></>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {onAdd && (
                    <Button size="sm" onClick={() => onAdd(s)} disabled={stale}>+ Armee</Button>
                  )}
                  {onEdit && (
                    <IconBtn title="Bearbeiten" onClick={() => onEdit(s)}>✎</IconBtn>
                  )}
                  {onDuplicate && (
                    <IconBtn title="Duplizieren" onClick={() => onDuplicate(s)}>⎘</IconBtn>
                  )}
                  {onDelete && (
                    <IconBtn
                      title="Löschen"
                      onClick={() => {
                        if (window.confirm(`Squad „${s.name}" wirklich löschen?`)) onDelete(s);
                      }}
                      danger
                    >✕</IconBtn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IconBtn({ children, danger, ...rest }) {
  return (
    <button
      type="button"
      {...rest}
      style={{
        width: 28,
        height: 28,
        background: 'transparent',
        color: danger ? 'var(--color-text-dim)' : 'var(--color-text)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        fontSize: 'var(--fs-sm)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'inherit',
        WebkitTapHighlightColor: 'transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = danger
          ? 'var(--color-danger)'
          : 'var(--color-accent)';
        if (danger) e.currentTarget.style.color = 'var(--color-danger)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)';
        if (danger) e.currentTarget.style.color = 'var(--color-text-dim)';
      }}
    >
      {children}
    </button>
  );
}

const hintStyle = {
  padding: 'var(--space-2) var(--space-3)',
  fontSize: 'var(--fs-xs)',
  color: 'var(--color-text-muted)',
  background: 'var(--color-surface)',
  border: '1px dashed var(--color-border)',
  borderRadius: 'var(--radius-md)',
};
