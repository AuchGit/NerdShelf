// src/shared/imports/ImportedSection.jsx
//
// Renders the importer's read-only collection of someone-else's entities
// at the bottom of each domain dashboard. Two-level grouping:
//
//   ── 🤝 <Spielername> (n) ───────────────────────
//   ├── <Subkategorie A> (e.g. faction / format / edition)
//   │     [item card]  [item card]  …
//   └── <Subkategorie B>
//         [item card] …
//
// Both layers collapse independently, persisting state per-domain in
// localStorage. Subkategorie cards reuse the same `renderItem(item)`
// callback the parent dashboard already uses for its owned items —
// callers just pass a *read-only* variant.

import { useEffect, useState, useCallback, useMemo } from 'react';
import TokenImportInput from './TokenImportInput';

export default function ImportedSection({
  title = 'Importierte Einträge',
  entities,
  owners,
  loading,
  tableMissing,
  domain,
  onImport,
  onRemove,
  getSubCategory,           // (entity) => string
  subCategoryOrder = [],
  renderItem,               // (entity, { token, ownerName }) => JSX
  storageKey,               // for collapse-state persistence
  emptyIfEmpty = true,      // if true, hide the whole section when there are no imports
}) {
  // Group by ownerId → subCategory → [entities]
  const grouped = useMemo(() => {
    const byOwner = new Map();
    for (const e of entities || []) {
      const ownerId = e.user_id;
      if (!byOwner.has(ownerId)) byOwner.set(ownerId, new Map());
      const ownerMap = byOwner.get(ownerId);
      const sub = (getSubCategory(e) || 'Sonstige').toString();
      if (!ownerMap.has(sub)) ownerMap.set(sub, []);
      ownerMap.get(sub).push(e);
    }
    return [...byOwner.entries()];
  }, [entities, getSubCategory]);

  const [collapsed, setCollapsed] = useState(() => {
    if (!storageKey) return new Set();
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });
  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify([...collapsed])); } catch {}
  }, [collapsed, storageKey]);

  const toggle = useCallback((key) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const totalImports = (entities || []).length;
  if (emptyIfEmpty && totalImports === 0 && tableMissing) {
    // If the table isn't there at all, surface a single subtle hint
    // alongside the import input rather than the full empty-state block.
  }

  return (
    <section
      style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: 'var(--space-3) var(--space-5) var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--space-2)',
          borderTop: '1px solid var(--color-border)',
          paddingTop: 'var(--space-3)',
        }}
      >
        <h2 style={{
          margin: 0,
          fontSize: 'var(--fs-lg)',
          fontWeight: 'var(--fw-semibold)',
          color: 'var(--color-text-muted)',
        }}>
          🤝 {title}
        </h2>
        {totalImports > 0 && (
          <span style={{ color: 'var(--color-text-dim)', fontSize: 'var(--fs-sm)' }}>
            {totalImports} Eintr{totalImports === 1 ? 'ag' : 'äge'}
          </span>
        )}
      </header>

      <TokenImportInput domain={domain} onImport={onImport} busy={loading} />

      {tableMissing && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-3)',
            fontSize: 'var(--fs-xs)',
            color: 'var(--color-warning)',
            background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',
            border: '1px solid var(--color-warning)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          Import-Tabellen (mtg_imports / wh40k_imports / dnd_imports) nicht migriert — bitte
          <code> scripts/split-nerdshelf-tables.sql</code> in Supabase einspielen.
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', textAlign: 'center' }}>
          Lade Imports…
        </div>
      ) : totalImports === 0 ? (
        <div
          style={{
            padding: 'var(--space-4)',
            background: 'var(--color-surface)',
            border: '1px dashed var(--color-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--fs-sm)',
            textAlign: 'center',
          }}
        >
          Trage oben einen geteilten Token ein, um den entsprechenden Eintrag hier eingehängt zu sehen (nur lesbar).
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {grouped.map(([ownerId, subMap]) => {
            const playerName = owners?.[ownerId] || 'Unbekannter Spieler';
            const playerKey = `owner:${ownerId}`;
            const playerCollapsed = collapsed.has(playerKey);
            const ownerCount = [...subMap.values()].reduce((s, arr) => s + arr.length, 0);

            // Sort sub-categories
            const subs = [...subMap.entries()];
            subs.sort(([a], [b]) => {
              const ai = subCategoryOrder.indexOf(a);
              const bi = subCategoryOrder.indexOf(b);
              if (ai !== -1 && bi !== -1) return ai - bi;
              if (ai !== -1) return -1;
              if (bi !== -1) return 1;
              return a.localeCompare(b);
            });

            return (
              <div key={ownerId} style={ownerCardStyle}>
                <button type="button" onClick={() => toggle(playerKey)} style={ownerHeaderStyle}>
                  <span style={{ fontSize: 14 }}>{playerCollapsed ? '▸' : '▾'}</span>
                  <span style={{ fontWeight: 'var(--fw-semibold)' }}>👤 {playerName}</span>
                  <span style={ownerCountStyle}>{ownerCount}</span>
                </button>

                {!playerCollapsed && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-3)' }}>
                    {subs.map(([sub, items]) => {
                      const subKey = `${playerKey}::${sub}`;
                      const subCollapsed = collapsed.has(subKey);
                      return (
                        <div key={sub} style={subSectionStyle}>
                          <button type="button" onClick={() => toggle(subKey)} style={subHeaderStyle}>
                            <span style={{ fontSize: 12 }}>{subCollapsed ? '▸' : '▾'}</span>
                            <span style={{ textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)', color: 'var(--color-text-muted)' }}>
                              {sub}
                            </span>
                            <span style={subCountStyle}>{items.length}</span>
                          </button>
                          {!subCollapsed && (
                            <div style={gridStyle}>
                              {items.map(item => renderItem(item, {
                                token:     item.share_token,
                                ownerName: playerName,
                                onRemove:  () => onRemove?.(item.share_token),
                              }))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const ownerCardStyle = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
};
const ownerHeaderStyle = {
  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
  width: '100%',
  padding: 'var(--space-3)',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--color-border)',
  textAlign: 'left',
  cursor: 'pointer',
  color: 'var(--color-text)',
  fontFamily: 'inherit',
  fontSize: 'var(--fs-md)',
};
const ownerCountStyle = {
  marginLeft: 'auto',
  padding: '2px 10px',
  borderRadius: 999,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  fontSize: 'var(--fs-xs)',
  color: 'var(--color-text-muted)',
  fontWeight: 'var(--fw-medium)',
};
const subSectionStyle = {
  display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
};
const subHeaderStyle = {
  display: 'flex', alignItems: 'center', gap: 6,
  background: 'transparent', border: 'none',
  textAlign: 'left',
  cursor: 'pointer',
  color: 'var(--color-text)',
  padding: '2px 4px',
  fontFamily: 'inherit',
};
const subCountStyle = {
  fontSize: 'var(--fs-xs)',
  color: 'var(--color-text-muted)',
  marginLeft: 4,
};
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
  gap: 'var(--space-3)',
};
