// src/features/wh40k/components/ArmyPanel.jsx
//
// Army roster panel rendered as a side rail in the army builder. Lists every
// added unit with quantity controls and aggregated points. Mirrors MTG's
// DeckPanel philosophy: lightweight, single-pane, optimised for rapid edits.

import { totalArmyPoints, totalModelCount } from '../services/points';

export default function ArmyPanel({
  army,
  unitsById,
  factionsById,
  detachments,
  onUpdateCount,
  onRemove,
  onClear,
  onExport,
}) {
  const entries = Object.values(army.entries || {});
  const totalPts = totalArmyPoints(army.entries, unitsById);
  const totalModels = totalModelCount(army.entries, unitsById);

  const factionName = factionsById[army.factionId]?.name || 'Keine Fraktion';
  const detachmentName = detachments.find(d => d.id === army.detachmentId)?.name || 'Kein Detachment';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <header
        style={{
          padding: 'var(--space-3)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)' }}>Armee</span>
          <span style={{ flex: 1 }} />
          <span
            style={{
              fontSize: 'var(--fs-lg)',
              fontWeight: 'var(--fw-bold)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--color-accent)',
            }}
          >
            {totalPts} Pkt
          </span>
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
          {factionName} · {detachmentName} · {totalModels} Modelle
        </div>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-2)' }}>
        {entries.length === 0 ? (
          <div
            style={{
              padding: 'var(--space-5)',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--fs-sm)',
            }}
          >
            Noch keine Einheiten.
            <br />
            Wähle Einheiten in der Suche, um sie hinzuzufügen.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {entries.map(e => {
              const u = unitsById[e.unitId];
              if (!u) return null;
              return (
                <div
                  key={e.unitId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 'var(--fs-sm)',
                        fontWeight: 'var(--fw-medium)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {u.name}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--fs-xs)',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      {u.points} Pkt × {e.count} = {(u.points || 0) * e.count} Pkt
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-bg-elevated)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onUpdateCount(u.id, -1)}
                      style={miniBtnStyle}
                      aria-label="Reduzieren"
                    >−</button>
                    <span
                      style={{
                        minWidth: 20,
                        textAlign: 'center',
                        fontSize: 'var(--fs-sm)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {e.count}
                    </span>
                    <button
                      type="button"
                      onClick={() => onUpdateCount(u.id, +1)}
                      style={miniBtnStyle}
                      aria-label="Erhöhen"
                    >+</button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(u.id)}
                    title="Entfernen"
                    aria-label="Entfernen"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-text-dim)',
                      cursor: 'pointer',
                      fontSize: 'var(--fs-md)',
                      padding: 2,
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-dim)'}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <footer
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          padding: 'var(--space-3)',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <button
          type="button"
          onClick={onExport}
          disabled={entries.length === 0}
          style={footerBtn(false)}
        >
          Exportieren
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={entries.length === 0}
          style={footerBtn(true)}
        >
          Leeren
        </button>
      </footer>
    </div>
  );
}

const miniBtnStyle = {
  width: 22,
  height: 22,
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text)',
  fontSize: 'var(--fs-md)',
  cursor: 'pointer',
  borderRadius: 'var(--radius-sm)',
};

function footerBtn(danger) {
  return {
    flex: 1,
    padding: '6px 10px',
    background: 'transparent',
    color: danger ? 'var(--color-danger)' : 'var(--color-text)',
    border: `1px solid ${danger ? 'var(--color-danger)' : 'var(--color-border)'}`,
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--fs-sm)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}
