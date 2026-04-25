// src/shared/dashboard/DashboardLayout.jsx
//
// Reusable dashboard scaffolding for tool home pages (DnD, MTG, …).
// Renders: page header, section toolbar (title + "new" button), grouping of
// items into collapsible categories, empty state.
//
// The caller passes:
//   - title:           page title (e.g. "Meine Charaktere")
//   - newButtonLabel:  e.g. "+ Neuer Charakter"
//   - onNew():         click handler for the new-button
//   - items:           array of any shape
//   - getCategory(item): string used as group key (e.g. item.format / edition)
//   - categoryOrder:   optional, an array of category keys defining display order
//   - renderItem(item): JSX for a single card
//   - emptyIcon, emptyTitle, emptyDescription: empty state copy
//   - loading:         boolean
//   - storageKey:      localStorage key used to remember collapsed categories

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Button, Panel } from '../ui';

const FALLBACK_CATEGORY = 'Sonstige';

export default function DashboardLayout({
  title,
  newButtonLabel,
  onNew,
  items,
  getCategory,
  categoryOrder,
  renderItem,
  emptyIcon = '✦',
  emptyTitle = 'Noch nichts hier',
  emptyDescription,
  loading = false,
  storageKey,
}) {
  // Group items by category
  const grouped = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      const cat = (getCategory(item) || FALLBACK_CATEGORY).toString();
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(item);
    }
    // Build ordered list of [category, items[]]
    const ordered = [];
    if (categoryOrder?.length) {
      for (const c of categoryOrder) {
        if (map.has(c)) {
          ordered.push([c, map.get(c)]);
          map.delete(c);
        }
      }
    }
    // Remaining categories alphabetically (fallback last)
    const remaining = [...map.entries()].sort(([a], [b]) => {
      if (a === FALLBACK_CATEGORY) return 1;
      if (b === FALLBACK_CATEGORY) return -1;
      return a.localeCompare(b);
    });
    return [...ordered, ...remaining];
  }, [items, getCategory, categoryOrder]);

  // Collapse state, persisted per dashboard
  const [collapsed, setCollapsed] = useState(() => {
    if (!storageKey) return new Set();
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify([...collapsed])); } catch {}
  }, [collapsed, storageKey]);

  const toggle = useCallback((cat) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  return (
    <div style={S.container}>
      <div style={S.toolbar}>
        <h1 style={S.title}>{title}</h1>
        {onNew && <Button onClick={onNew}>{newButtonLabel}</Button>}
      </div>

      {loading ? (
        <div style={S.loading}>Lade…</div>
      ) : items.length === 0 ? (
        <Panel style={S.empty}>
          <div style={S.emptyIcon}>{emptyIcon}</div>
          <div style={S.emptyTitle}>{emptyTitle}</div>
          {emptyDescription && (
            <div style={S.emptyDesc}>{emptyDescription}</div>
          )}
          {onNew && <Button onClick={onNew}>{newButtonLabel}</Button>}
        </Panel>
      ) : (
        <div style={S.sections}>
          {grouped.map(([category, catItems]) => {
            const isCollapsed = collapsed.has(category);
            return (
              <section key={category} style={S.section}>
                <button
                  type="button"
                  style={S.sectionHeader}
                  onClick={() => toggle(category)}
                >
                  <span style={S.chevron}>{isCollapsed ? '▸' : '▾'}</span>
                  <span style={S.sectionTitle}>{category}</span>
                  <span style={S.sectionCount}>{catItems.length}</span>
                </button>
                {!isCollapsed && (
                  <div style={S.grid}>
                    {catItems.map(renderItem)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

const S = {
  container: {
    padding: 'var(--space-5)',
    maxWidth: 1200,
    margin: '0 auto',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 'var(--space-5)',
  },
  title: {
    margin: 0,
    fontSize: 'var(--fs-2xl)',
    fontWeight: 'var(--fw-semibold)',
  },
  loading: {
    textAlign: 'center',
    padding: 'var(--space-6)',
    color: 'var(--color-text-muted)',
  },
  empty: {
    textAlign: 'center',
    padding: 'var(--space-7)',
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 'var(--space-3)',
  },
  emptyTitle: {
    fontSize: 'var(--fs-lg)',
    marginBottom: 'var(--space-2)',
  },
  emptyDesc: {
    color: 'var(--color-text-muted)',
    marginBottom: 'var(--space-4)',
  },
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-5)',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    padding: 'var(--space-2) var(--space-3)',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
  chevron: {
    width: 14,
    color: 'var(--color-text-muted)',
    fontSize: 'var(--fs-sm)',
    transition: 'transform var(--transition)',
  },
  sectionTitle: {
    flex: 1,
    fontSize: 'var(--fs-lg)',
    fontWeight: 'var(--fw-semibold)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionCount: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-muted)',
    padding: '2px 10px',
    borderRadius: 999,
    fontSize: 'var(--fs-xs)',
    fontWeight: 'var(--fw-medium)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 'var(--space-4)',
  },
};
