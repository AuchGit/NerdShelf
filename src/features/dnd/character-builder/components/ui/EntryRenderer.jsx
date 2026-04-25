import { parseTags } from '../../lib/tagParser'

export default function EntryRenderer({ entries, depth = 0 }) {
  if (!entries || entries.length === 0) return null
  return (
    <div>
      {entries.map((entry, i) => {
        if (typeof entry === 'string') {
          return (
            <p key={i} style={{ ...styles.text, marginLeft: depth * 16 }}>
              {parseTags(entry)}
            </p>
          )
        }
        if (typeof entry === 'object') {
          switch (entry.type) {
            case 'entries':
              return (
                <div key={i} style={{ marginLeft: depth * 16, marginBottom: 8 }}>
                  {entry.name && <div style={styles.sectionName}>{entry.name}</div>}
                  <EntryRenderer entries={entry.entries} depth={depth + (entry.name ? 1 : 0)} />
                </div>
              )
            case 'list':
              return (
                <ul key={i} style={{ ...styles.list, marginLeft: depth * 16 }}>
                  {(entry.items || []).map((item, j) => (
                    <li key={j} style={styles.listItem}>
                      {typeof item === 'string' ? parseTags(item) : parseTags(item.name || item.entry || '')}
                    </li>
                  ))}
                </ul>
              )
            case 'table':
              return (
                <div key={i} style={{ marginBottom: 12, overflowX: 'auto' }}>
                  {entry.caption && <div style={styles.tableCaption}>{entry.caption}</div>}
                  <table style={styles.table}>
                    {entry.colLabels && (
                      <thead>
                        <tr>
                          {entry.colLabels.map((h, j) => (
                            <th key={j} style={styles.th}>{parseTags(h)}</th>
                          ))}
                        </tr>
                      </thead>
                    )}
                    <tbody>
                      {(entry.rows || []).map((row, j) => (
                        <tr key={j}>
                          {(Array.isArray(row) ? row : [row]).map((cell, k) => (
                            <td key={k} style={styles.td}>
                              {typeof cell === 'string' ? parseTags(cell) : parseTags(cell?.entry || '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            default:
              if (entry.entries) {
                return (
                  <div key={i}>
                    {entry.name && <div style={styles.sectionName}>{entry.name}</div>}
                    <EntryRenderer entries={entry.entries} depth={depth + 1} />
                  </div>
                )
              }
              return null
          }
        }
        return null
      })}
    </div>
  )
}

const styles = {
  text: { color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 8, fontSize: 14 },
  sectionName: { color: 'var(--accent)', fontWeight: 'bold', marginTop: 12, marginBottom: 4, fontSize: 14 },
  list: { color: 'var(--text-secondary)', paddingLeft: 20, marginBottom: 8 },
  listItem: { marginBottom: 4, lineHeight: 1.5, fontSize: 14 },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 },
  tableCaption: { color: 'var(--accent)', fontWeight: 'bold', marginBottom: 4, fontSize: 13 },
  th: { background: 'var(--bg-highlight)', color: 'var(--accent)', padding: '6px 10px', border: '1px solid var(--border)', textAlign: 'left' },
  td: { color: 'var(--text-secondary)', padding: '5px 10px', border: '1px solid var(--border-subtle)' },
}