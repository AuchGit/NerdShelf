import { useRef } from 'react'

const ALIGNMENTS = [
  'Lawful Good', 'Neutral Good', 'Chaotic Good',
  'Lawful Neutral', 'True Neutral', 'Chaotic Neutral',
  'Lawful Evil', 'Neutral Evil', 'Chaotic Evil',
]

export default function Step2BasicInfo({ character, updateCharacter }) {
  const fileRef = useRef()

  function handlePortraitUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { alert('Bild zu groß (max. 2MB)'); return }
    const reader = new FileReader()
    reader.onload = ev => updateCharacter('appearance.portrait', ev.target.result)
    reader.readAsDataURL(file)
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Grundinformationen</h2>

      {/* Portrait + Name Row */}
      <div style={styles.topRow}>
        {/* Portrait */}
        <div style={styles.portraitBox}>
          {character.appearance.portrait ? (
            <div style={styles.portraitPreview}>
              <img src={character.appearance.portrait} style={styles.portraitImg} alt="Portrait" />
              <button style={styles.removeBtn} onClick={() => updateCharacter('appearance.portrait', null)}>✕</button>
            </div>
          ) : (
            <div style={styles.portraitEmpty} onClick={() => fileRef.current?.click()}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>+</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Bild hochladen</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>PNG/JPG max. 2MB</div>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePortraitUpload} />
          {!character.appearance.portrait && (
            <button style={styles.uploadBtn} onClick={() => fileRef.current?.click()}>+ Bild wählen</button>
          )}
        </div>

        {/* Name + Player */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={styles.field}>
            <label style={styles.label}>Character-Name *</label>
            <input style={styles.input} type="text" placeholder="z.B. Aldric Sturmmantel"
              value={character.info.name}
              onChange={e => updateCharacter('info.name', e.target.value)} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Spieler-Name</label>
            <input style={styles.input} type="text" placeholder="Dein Name"
              value={character.info.player}
              onChange={e => updateCharacter('info.player', e.target.value)} />
          </div>
        </div>
      </div>

      {/* Alignment */}
      <div style={styles.field}>
        <label style={styles.label}>Gesinnung</label>
        <div style={styles.alignmentGrid}>
          {ALIGNMENTS.map(al => (
            <div key={al}
              style={{ ...styles.alignmentBox, ...(character.info.alignment === al ? styles.alignmentSelected : {}) }}
              onClick={() => updateCharacter('info.alignment', al)}>
              {al}
            </div>
          ))}
        </div>
      </div>

      {/* Appearance Row */}
      <div style={styles.row}>
        <FieldSmall label="Alter" value={character.appearance.age} onChange={v => updateCharacter('appearance.age', v)} />
        <FieldSmall label="Größe" value={character.appearance.height} onChange={v => updateCharacter('appearance.height', v)} />
        <FieldSmall label="Gewicht" value={character.appearance.weight} onChange={v => updateCharacter('appearance.weight', v)} />
        <FieldSmall label="Augen" value={character.appearance.eyes} onChange={v => updateCharacter('appearance.eyes', v)} />
        <FieldSmall label="Haare" value={character.appearance.hair} onChange={v => updateCharacter('appearance.hair', v)} />
        <FieldSmall label="Haut" value={character.appearance.skin} onChange={v => updateCharacter('appearance.skin', v)} />
      </div>
    </div>
  )
}

function FieldSmall({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 90 }}>
      <label style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 'bold' }}>{label}</label>
      <input style={styles.inputSmall} type="text" value={value || ''}
        onChange={e => onChange(e.target.value)} />
    </div>
  )
}

const styles = {
  container: { maxWidth: 700, margin: '0 auto', padding: 16 },
  title: { color: 'var(--accent)', marginBottom: 24 },
  topRow: { display: 'flex', gap: 24, marginBottom: 24, alignItems: 'flex-start' },
  portraitBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 },
  portraitEmpty: {
    width: 120, height: 120, borderRadius: 12, border: '2px dashed var(--border)',
    background: 'var(--bg-elevated)', display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer',
  },
  portraitPreview: { position: 'relative' },
  portraitImg: { width: 120, height: 120, objectFit: 'cover', borderRadius: 12, border: '2px solid var(--border)' },
  removeBtn: {
    position: 'absolute', top: -8, right: -8, width: 24, height: 24,
    borderRadius: '50%', border: 'none', background: 'var(--accent-red)', color: 'var(--text-primary)',
    cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  uploadBtn: {
    padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 },
  label: { color: 'var(--text-secondary)', fontSize: 14, fontWeight: 'bold' },
  input: {
    padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 15,
  },
  inputSmall: {
    padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 14,
  },
  row: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  alignmentGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 },
  alignmentBox: {
    padding: '10px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', cursor: 'pointer',
  },
  alignmentSelected: { border: '1px solid var(--accent)', color: 'var(--accent)', background: 'var(--bg-hover)' },
}