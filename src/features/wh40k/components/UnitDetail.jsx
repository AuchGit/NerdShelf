// src/features/wh40k/components/UnitDetail.jsx
//
// Detailed datasheet view shown alongside (or below) the unit grid. Renders
// the stats table, keywords, abilities, and wargear. Uses the shared Panel
// primitive so it visually matches every other detail surface in NerdShelf.

import { Panel } from '../../../shared/ui';

const STAT_COLUMNS = [
  { key: 'm',  label: 'M'  },
  { key: 't',  label: 'T'  },
  { key: 'sv', label: 'Sv' },
  { key: 'w',  label: 'W'  },
  { key: 'ld', label: 'Ld' },
  { key: 'oc', label: 'OC' },
];

const WARGEAR_COLUMNS = [
  { key: 'range', label: 'Range' },
  { key: 'a',     label: 'A'     },
  { key: 'bsws',  label: 'BS/WS' },
  { key: 's',     label: 'S'     },
  { key: 'ap',    label: 'AP'    },
  { key: 'd',     label: 'D'     },
];

export default function UnitDetail({ unit, faction }) {
  if (!unit) {
    return (
      <Panel style={emptyStyle}>
        <div style={{ fontSize: 32, marginBottom: 'var(--space-2)' }}>◧</div>
        <div style={{ fontSize: 'var(--fs-md)', color: 'var(--color-text-muted)' }}>
          Wähle eine Einheit, um das Datasheet zu sehen.
        </div>
      </Panel>
    );
  }

  return (
    <Panel padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        {faction && (
          <div
            aria-hidden="true"
            style={{
              width: 36, height: 36,
              flexShrink: 0,
              borderRadius: 'var(--radius-md)',
              background: `color-mix(in srgb, ${faction.color || 'var(--color-accent)'} 18%, transparent)`,
              color: faction.color || 'var(--color-text)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18,
            }}
          >
            {faction.icon || '✦'}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)' }}>
            {unit.name}
          </h2>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
            {faction?.name || unit.factionId} · {unit.role}
          </div>
        </div>
        <div
          style={{
            fontSize: 'var(--fs-xl)',
            fontWeight: 'var(--fw-bold)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {unit.points} Pkt
        </div>
      </header>

      {/* Stats table */}
      {unit.stats?.length > 0 && (
        <Section title="Statistiken">
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Profil</th>
                  {STAT_COLUMNS.map(c => (
                    <th key={c.key} style={thStyle}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {unit.stats.map((s, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{s.name}</td>
                    {STAT_COLUMNS.map(c => (
                      <td key={c.key} style={{ ...tdStyle, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                        {s[c.key] ?? '–'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Wargear */}
      {unit.wargear?.length > 0 && (
        <Section title="Bewaffnung">
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Waffe</th>
                  {WARGEAR_COLUMNS.map(c => (
                    <th key={c.key} style={thStyle}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {unit.wargear.map((w, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{w.name}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{w.range || '–'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{w.a ?? '–'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{w.bs ?? w.ws ?? '–'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{w.s ?? '–'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{w.ap ?? '–'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{w.d ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Abilities */}
      {unit.abilities?.length > 0 && (
        <Section title="Fähigkeiten">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {unit.abilities.map((a, i) => (
              <div
                key={i}
                style={{
                  padding: 'var(--space-2) var(--space-3)',
                  background: 'var(--color-bg-sunken)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <div
                  style={{
                    fontSize: 'var(--fs-sm)',
                    fontWeight: 'var(--fw-semibold)',
                    marginBottom: 4,
                  }}
                >
                  {a.name}
                </div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
                  {a.text}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Keywords */}
      {unit.keywords?.length > 0 && (
        <Section title="Schlüsselwörter">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {unit.keywords.map(k => (
              <span
                key={k}
                style={{
                  padding: '2px 8px',
                  fontSize: 'var(--fs-xs)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {k}
              </span>
            ))}
          </div>
        </Section>
      )}
    </Panel>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <h3
        style={{
          margin: 0,
          fontSize: 'var(--fs-xs)',
          fontWeight: 'var(--fw-semibold)',
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--color-text-muted)',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

const emptyStyle = {
  textAlign: 'center',
  padding: 'var(--space-6)',
  color: 'var(--color-text-muted)',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 'var(--fs-sm)',
};

const thStyle = {
  textAlign: 'left',
  padding: '4px 8px',
  borderBottom: '1px solid var(--color-border)',
  fontSize: 'var(--fs-xs)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: 'var(--color-text-muted)',
  fontWeight: 'var(--fw-semibold)',
};

const tdStyle = {
  padding: '4px 8px',
  borderBottom: '1px solid var(--color-border)',
};
