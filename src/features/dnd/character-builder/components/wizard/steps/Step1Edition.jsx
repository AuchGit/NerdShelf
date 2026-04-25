export default function Step1Edition({ character, updateCharacter }) {
  const editions = [
    {
      id: '5e',
      label: 'D&D 5e (2014)',
      subtitle: 'Player\'s Handbook 2014',
      description: 'Die klassische Edition. Rassische ASI-Boni, klassische Backgrounds ohne Feats.',
      icon: '📜',
    },
    {
      id: '5.5e',
      label: 'D&D 5.5e (2024)',
      subtitle: 'Player\'s Handbook 2024',
      description: 'Überarbeitete Regeln. Spezies statt Rassen, Backgrounds geben Feats + ASI, neue Klassendefinitionen.',
      icon: '✨',
    },
  ]

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Edition wählen</h2>
      <p style={styles.subtitle}>
        Welche Version der D&D 5e Regeln soll dieser Character verwenden?
        Du kannst die Edition später nicht mehr ändern.
      </p>

      <div style={styles.grid}>
        {editions.map(edition => {
          const isSelected = character.meta.edition === edition.id
          return (
            <div
              key={edition.id}
              style={{
                ...styles.card,
                ...(isSelected ? styles.cardSelected : {}),
              }}
              onClick={() => updateCharacter('meta.edition', edition.id)}
            >
              <div style={styles.cardIcon}>{edition.icon}</div>
              <div style={styles.cardLabel}>{edition.label}</div>
              <div style={styles.cardSub}>{edition.subtitle}</div>
              <div style={styles.cardDesc}>{edition.description}</div>
              {isSelected && <div style={styles.checkmark}>✓ Gewählt</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles = {
  container: { maxWidth: '700px', margin: '0 auto', padding: '16px' },
  title: { color: 'var(--accent)', marginBottom: '8px' },
  subtitle: { color: 'var(--text-muted)', marginBottom: '32px', lineHeight: 1.6 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' },
  card: {
    background: 'var(--bg-elevated)',
    border: '2px solid var(--border)',
    borderRadius: '12px',
    padding: '28px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  cardSelected: {
    border: '2px solid var(--accent)',
    background: 'var(--bg-hover)',
  },
  cardIcon: { fontSize: '32px' },
  cardLabel: { color: 'var(--text-primary)', fontSize: '18px', fontWeight: 'bold' },
  cardSub: { color: 'var(--accent)', fontSize: '13px' },
  cardDesc: { color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.5, marginTop: '8px' },
  checkmark: { color: 'var(--accent)', fontWeight: 'bold', marginTop: '8px' },
}