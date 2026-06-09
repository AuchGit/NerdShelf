// editorKit.jsx
//
// Geteilte Section-Komponente + Style-Toolkit für alle Homebrew-
// Editoren. Konsistente Optik über Items / Spells / Backgrounds /
// Races / Creatures / Features.

export function Section({ title, subtitle, icon, accent, actions, children }) {
  const color = accent || '#7aa2f7'
  return (
    <div style={{ ...ek.section, paddingLeft: 18 }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: color,
      }} />
      <div style={ek.sectionHead}>
        <div>
          <div style={{ ...ek.sectionTitle, color }}>
            {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
            <span>{title}</span>
          </div>
          {subtitle && <div style={ek.sectionSub}>{subtitle}</div>}
        </div>
        {actions && <div>{actions}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

export function Field({ label, hint, children }) {
  return (
    <div>
      <div style={ek.label} title={hint || undefined}>
        {label}{hint && <span style={ek.labelHint}> ⓘ</span>}
      </div>
      {children}
    </div>
  )
}

// Chip multi-select mit optional Custom-Add
export function ChipMultiSelect({ options, selected, onToggle, allowCustom }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map(o => {
        const v = typeof o === 'string' ? o : o.v
        const l = typeof o === 'string' ? o : o.l
        const on = selected.includes(v)
        return (
          <button key={v} type="button" onClick={() => onToggle(v)}
            style={on ? ek.chipOn : ek.chip}>{l}</button>
        )
      })}
      {selected.filter(s => !options.some(o => (typeof o === 'string' ? o : o.v) === s))
        .map(s => (
          <button key={s} type="button" onClick={() => onToggle(s)} style={ek.chipOn}>
            {s} ×
          </button>
        ))}
    </div>
  )
}

export const ek = {
  wrap: {
    padding: 22, borderRadius: 14, marginBottom: 16,
    background: 'linear-gradient(180deg, #1b1f28 0%, #161922 100%)',
    border: '1px solid #2a3040',
    boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
  },
  section: {
    marginBottom: 14, padding: '14px 16px',
    background: '#171a21', border: '1px solid #252a35', borderRadius: 10,
    position: 'relative', overflow: 'hidden',
  },
  sectionHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13, fontWeight: 700, letterSpacing: 0.3,
    display: 'flex', alignItems: 'center', gap: 6,
  },
  sectionSub: { fontSize: 11, color: '#9aa3b4', marginTop: 2, fontWeight: 400 },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 10, marginBottom: 8,
  },
  label: {
    fontSize: 10, fontWeight: 700, color: '#9aa3b4',
    textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4,
    display: 'inline-flex', alignItems: 'center',
  },
  labelHint: { fontSize: 9, color: '#6b7386', marginLeft: 4, cursor: 'help' },
  input: {
    width: '100%', padding: '8px 10px', fontSize: 13,
    background: '#0f1115', color: '#e6e8ee',
    border: '1px solid #2a3040', borderRadius: 6,
    fontFamily: 'inherit', outline: 'none',
  },
  checkRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 0', fontSize: 12, color: '#9aa3b4',
  },
  empty: { color: '#6b7386', fontSize: 12, padding: '12px 0', fontStyle: 'italic' },
  seg: {
    padding: '6px 14px', borderRadius: 6, fontSize: 12,
    background: 'transparent', color: '#9aa3b4',
    border: '1px solid #2a3040', cursor: 'pointer', fontFamily: 'inherit',
  },
  segOn: {
    padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
    background: 'linear-gradient(180deg, #7aa2f7 0%, #6890e6 100%)',
    color: '#0f1115', border: '1px solid #7aa2f7', cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 2px 6px rgba(122,162,247,0.3)',
  },
  chip: {
    padding: '4px 10px', borderRadius: 6, fontSize: 11,
    background: 'transparent', color: '#9aa3b4',
    border: '1px solid #2a3040', cursor: 'pointer', fontFamily: 'inherit',
  },
  chipOn: {
    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
    background: 'color-mix(in srgb, #7aa2f7 22%, transparent)',
    color: '#7aa2f7', border: '1px solid #7aa2f7',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  miniBtn: {
    padding: '5px 10px', borderRadius: 6, border: '1px solid #2a3040',
    background: '#1d212a', color: '#9aa3b4', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 12,
  },
  primaryMini: {
    padding: '5px 12px', borderRadius: 6,
    border: '1px solid #7aa2f7',
    background: 'linear-gradient(180deg, #7aa2f7 0%, #6890e6 100%)',
    color: '#0f1115', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12, fontWeight: 700,
    boxShadow: '0 2px 6px rgba(122,162,247,0.25)',
  },
  iconBtn: {
    width: 28, height: 28, padding: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', color: '#f7768e',
    border: '1px solid #2a3040', borderRadius: 6,
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 16, lineHeight: 1,
  },
  card: {
    background: '#1d212a',
    border: '1px solid #2a3040', borderRadius: 8,
    padding: 10,
  },
  footer: {
    display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18,
    paddingTop: 14, borderTop: '1px solid #252a35',
  },
  cancelBtn: {
    padding: '9px 18px', borderRadius: 8,
    border: '1px solid #2a3040', background: 'transparent',
    color: '#9aa3b4', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
  },
  saveBtn: {
    padding: '9px 22px', borderRadius: 8,
    border: 'none',
    background: 'linear-gradient(180deg, #9ece6a 0%, #82b04f 100%)',
    color: '#0f1115', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 13, fontWeight: 700,
    boxShadow: '0 3px 10px rgba(158,206,106,0.25)',
  },
}
