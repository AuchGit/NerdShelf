import { useState, useMemo } from 'react'
import { useLanguage } from '../../lib/i18n'

export default function BrowsePanel({
  items,
  selectedId,
  onSelect,
  renderListItem,
  renderDetail,
  searchKeys = ['name'],
  filters = [],
  loading = false,
}) {
  const { t } = useLanguage()
  const [search, setSearch] = useState('')
  const [activeFilters, setActiveFilters] = useState({})
  const [detailItem, setDetailItem] = useState(null)

  const filtered = useMemo(() => {
    let result = items
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(item =>
        searchKeys.some(key => String(item[key] || '').toLowerCase().includes(q))
      )
    }
    for (const [key, value] of Object.entries(activeFilters)) {
      if (value && value !== '__all__') {
        result = result.filter(item => String(item[key]) === value)
      }
    }
    return result
  }, [items, search, activeFilters])

  const selectedDetail = detailItem || items.find(i => i.id === selectedId) || null

  if (loading) {
    return (
      <div style={styles.loading}>{t('loadingData')}</div>
    )
  }

  return (
    <div style={styles.outer}>
      <div style={styles.container}>
        {/* Linke Spalte */}
        <div style={styles.left}>
          <div style={styles.leftTop}>
            <input
              style={styles.search}
              placeholder={t('search')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
            {filters.length > 0 && (
              <div style={styles.filterRow}>
                {filters.map(f => (
                  <select
                    key={f.key}
                    style={styles.filterSelect}
                    value={activeFilters[f.key] || '__all__'}
                    onChange={e => setActiveFilters(prev => ({ ...prev, [f.key]: e.target.value }))}
                  >
                    <option value="__all__">{f.label}: Alle</option>
                    {f.options.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ))}
              </div>
            )}
          </div>

          <div style={styles.list}>
            {filtered.length === 0 && (
              <div style={styles.noResults}>{t('noResults')}</div>
            )}
            {filtered.map(item => {
              const isSelected = item.id === selectedId
              const isViewing = item.id === detailItem?.id
              return (
                <div
                  key={item.id}
                  style={{
                    ...styles.listItem,
                    ...(isSelected ? styles.listItemSelected : {}),
                    ...(isViewing && !isSelected ? styles.listItemViewing : {}),
                  }}
                  onClick={() => setDetailItem(item)}
                >
                  {renderListItem(item, isSelected)}
                </div>
              )
            })}
          </div>
        </div>

        {/* Rechte Spalte */}
        <div style={styles.right}>
          {selectedDetail ? (
            <>
              <div style={styles.detailScroll}>
                {renderDetail(selectedDetail)}
              </div>
              <div style={styles.detailFooter}>
                <button
                  style={{
                    ...styles.selectBtn,
                    ...(selectedId === selectedDetail.id ? styles.selectBtnActive : {}),
                  }}
                  onClick={() => onSelect(selectedDetail)}
                >
                  {selectedId === selectedDetail.id ? t('selected') : t('select')}
                </button>
              </div>
            </>
          ) : (
            <div style={styles.detailEmpty}>
              {t('lang') === 'en'
                ? '← Select an entry from the list'
                : '← Wähle einen Eintrag aus der Liste'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const styles = {
  outer: { width: '100%' },
  container: {
    display: 'grid', gridTemplateColumns: '280px 1fr',
    border: '1px solid var(--border)', borderRadius: 12,
    overflow: 'hidden', height: '60vh', minHeight: 400, maxHeight: 600,
  },
  left: {
    borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
    background: 'var(--bg-card)', overflow: 'hidden',
  },
  leftTop: { flexShrink: 0, padding: '10px 10px 6px', borderBottom: '1px solid var(--border-subtle)' },
  search: {
    width: '100%', padding: '8px 10px', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--bg-surface)',
    color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box',
  },
  filterRow: { display: 'flex', gap: 6, marginTop: 6 },
  filterSelect: {
    flex: 1, padding: '5px 6px', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--bg-surface)',
    color: 'var(--text-muted)', fontSize: 12,
  },
  list: { flex: 1, overflowY: 'auto', padding: 6 },
  listItem: { padding: '9px 10px', borderRadius: 7, cursor: 'pointer', marginBottom: 2, border: '1px solid transparent' },
  listItemSelected: { background: 'var(--bg-highlight)', border: '1px solid var(--accent)' },
  listItemViewing: { background: 'var(--bg-hover)', border: '1px solid var(--border)' },
  noResults: { color: 'var(--text-dim)', padding: 24, textAlign: 'center', fontSize: 14 },
  right: { display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)', overflow: 'hidden' },
  detailScroll: { flex: 1, overflowY: 'auto', padding: 20 },
  detailFooter: {
    flexShrink: 0, padding: '14px 20px',
    borderTop: '1px solid var(--border)', background: 'var(--bg-card)',
  },
  selectBtn: {
    width: '100%', padding: 11, borderRadius: 8,
    border: '2px solid var(--accent)', background: 'transparent',
    color: 'var(--accent)', fontSize: 15, fontWeight: 'bold', cursor: 'pointer',
  },
  selectBtnActive: { background: 'var(--accent)', color: 'var(--bg-deep)' },
  detailEmpty: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--border)', fontSize: 15,
  },
  loading: {
    height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--accent)', fontSize: 16,
    border: '1px solid var(--border)', borderRadius: 12,
  },
}