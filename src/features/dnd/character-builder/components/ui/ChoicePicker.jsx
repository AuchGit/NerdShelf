// components/ui/ChoicePicker.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Generic choice-picker component. Renders any ChoiceDescriptor from choiceParser.
// Adapts UI per type:
//   'color'      → coloured swatches (Dragonborn ancestry)
//   'optfeature' → expandable feature cards (Fighting Style, Metamagic, etc.)
//   'ability'    → ability-score chips with +N badge
//   default      → pill/chip strip (skills, tools, languages, weapons, …)
//
// Props:
//   descriptor   ChoiceDescriptor          (from choiceParser)
//   value        string | string[] | null  (from character.choices[descriptor.id])
//   onChange     (newValue) => void        newValue = string (count=1) or string[]
//   options      ChoiceOption[] | null     optional override (e.g. dynamic spell list)
//   renderOption (option, isSelected) => ReactNode  optional custom row renderer
//   disabled     boolean
// ─────────────────────────────────────────────────────────────────────────────

import { asArray } from '../../lib/choiceParser'

export default function ChoicePicker({
  descriptor,
  value,
  onChange,
  options: optionsProp,
  renderOption,
  disabled = false,
  disabledValues = [],   // FIX 3: values already granted elsewhere — shown as disabled pills
}) {
  if (!descriptor) return null

  const options  = optionsProp || descriptor.options || []
  const selected = asArray(value)
  const isSingle = descriptor.count === 1
  const isFull   = selected.length >= descriptor.count
  const isDone   = selected.length >= descriptor.count
  const disabledSet = new Set(disabledValues)

  function toggle(optValue) {
    if (disabled || disabledSet.has(optValue)) return
    const has = selected.includes(optValue)
    if (isSingle) {
      onChange(has ? null : optValue)
    } else {
      if (has) {
        const next = selected.filter(v => v !== optValue)
        onChange(next.length === 0 ? null : next)
      } else {
        if (isFull) return
        onChange([...selected, optValue])
      }
    }
  }

  // ── Header shared by all variants ─────────────────────────────────────────
  const Header = (
    <div style={S.label}>
      <span>{descriptor.label}</span>
      {isDone
        ? <span style={{ ...S.counter, background:'var(--bg-highlight)', color:'var(--accent-green)', border:'1px solid #2a6a3a' }}>
            ✓ Done
          </span>
        : <span style={S.counter}>{selected.length}/{descriptor.count}</span>
      }
    </div>
  )

  // ── Color / Dragonborn ancestry ────────────────────────────────────────────
  if (descriptor.type === 'color') {
    return (
      <div>
        {Header}
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:6 }}>
          {options.map(opt => {
            const isSel = selected.includes(opt.value)
            if (renderOption) {
              return (
                <div key={opt.value} onClick={() => toggle(opt.value)}
                     style={{ cursor: disabled ? 'default' : 'pointer' }}>
                  {renderOption(opt, isSel)}
                </div>
              )
            }
            return (
              <button key={opt.value}
                      onClick={() => toggle(opt.value)}
                      title={opt.label}
                      disabled={disabled}
                      style={{
                        ...S.swatch,
                        background:   opt.meta?.color || 'var(--text-dim)',
                        outline:      isSel ? '3px solid #e2b96f' : '3px solid transparent',
                        outlineOffset: 2,
                        opacity:      disabled && !isSel ? 0.5 : 1,
                        cursor:       disabled ? 'default' : 'pointer',
                      }}>
                <span style={S.swatchLabel}>{opt.value[0].toUpperCase()}</span>
              </button>
            )
          })}
        </div>
        {selected.length > 0 && (
          <div style={{ color:'var(--accent)', fontSize:12, marginTop:6 }}>
            ✓ {options.find(o => o.value === selected[0])?.label}
            {options.find(o => o.value === selected[0])?.meta?.damage &&
              <span style={{ color:'var(--text-muted)', marginLeft:6 }}>
                ({options.find(o => o.value === selected[0]).meta.damage} damage)
              </span>
            }
          </div>
        )}
      </div>
    )
  }

  // ── Optional features (Fighting Style, Metamagic, Invocations…) ───────────
  if (descriptor.type === 'optfeature') {
    return (
      <div>
        {Header}
        {options.length === 0 && (
          <div style={{ color:'var(--text-muted)', fontSize:13, marginTop:8 }}>
            Loading options…
          </div>
        )}
        <div style={S.cardGrid}>
          {options.map(opt => {
            const isSel    = selected.includes(opt.value)
            const canPick  = isSel || !isFull
            if (renderOption) {
              return (
                <div key={opt.value}
                     onClick={() => canPick && toggle(opt.value)}
                     style={{ cursor: (!canPick || disabled) ? 'default' : 'pointer',
                              opacity: !canPick && !isSel ? 0.4 : 1 }}>
                  {renderOption(opt, isSel)}
                </div>
              )
            }
            return (
              <div key={opt.value}
                   onClick={() => !disabled && canPick && toggle(opt.value)}
                   style={{
                     ...S.card,
                     borderColor: isSel ? 'var(--accent)' : 'var(--border)',
                     background:  isSel ? 'var(--bg-highlight)' : 'var(--bg-card)',
                     cursor:      (disabled || !canPick) ? 'default' : 'pointer',
                     opacity:     (!canPick && !isSel) ? 0.4 : 1,
                   }}>
                <div style={{ color: isSel ? 'var(--accent)' : 'var(--text-secondary)', fontWeight:'bold', fontSize:13 }}>
                  {isSel && '✓ '}{opt.label}
                </div>
                {opt.description && (
                  <div style={{ color:'var(--text-muted)', fontSize:11, marginTop:4, lineHeight:1.5 }}>
                    {opt.description}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Ability score choices ──────────────────────────────────────────────────
  if (descriptor.type === 'ability') {
    return (
      <div>
        {Header}
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:6 }}>
          {options.map(opt => {
            const isSel   = selected.includes(opt.value)
            const canPick = isSel || !isFull
            return (
              <button key={opt.value}
                      disabled={disabled || (!canPick && !isSel)}
                      onClick={() => toggle(opt.value)}
                      style={{
                        ...S.abilityChip,
                        borderColor:  isSel ? 'var(--accent)' : 'var(--border)',
                        background:   isSel ? 'var(--bg-highlight)' : 'var(--bg-card)',
                        color:        isSel ? 'var(--accent)' : 'var(--text-muted)',
                        opacity:      (!canPick && !isSel) ? 0.35 : 1,
                        cursor:       (disabled || (!canPick && !isSel)) ? 'default' : 'pointer',
                      }}>
                <div style={{ fontWeight:'bold', fontSize:13 }}>{opt.label}</div>
                {opt.meta?.amount && (
                  <div style={{ fontSize:11, color: isSel ? 'var(--accent-green)' : 'var(--text-dim)', fontWeight:'bold' }}>
                    +{opt.meta.amount}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Default: pill strip (skills, tools, languages, weapons, variants…) ─────
  return (
    <div>
      {Header}
      {options.length === 0 && (
        <div style={{ color:'var(--text-muted)', fontSize:13, marginTop:8 }}>Loading options…</div>
      )}
      <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:6 }}>
        {options.map(opt => {
          const isSel       = selected.includes(opt.value)
          const isGranted   = disabledSet.has(opt.value)
          const canPick     = isSel || !isFull
          const isDisabled  = isGranted || disabled || (!canPick && !isSel)
          if (renderOption) {
            return (
              <div key={opt.value}
                   onClick={() => !isDisabled && canPick && toggle(opt.value)}
                   style={{ cursor: isDisabled ? 'default' : 'pointer',
                            opacity: isDisabled && !isGranted && !isSel ? 0.4 : 1 }}>
                {renderOption(opt, isSel)}
              </div>
            )
          }
          return (
            <button key={opt.value}
                    disabled={isDisabled}
                    onClick={() => toggle(opt.value)}
                    style={{
                      ...S.pill,
                      background:  isGranted ? 'var(--bg-inset)' : isSel ? 'var(--bg-highlight)' : 'var(--bg-card)',
                      borderColor: isGranted ? 'var(--bg-highlight)' : isSel ? 'var(--accent)' : 'var(--border)',
                      color:       isGranted ? 'var(--text-dim)' : isSel ? 'var(--accent)' : 'var(--text-muted)',
                      cursor:      isDisabled ? 'default' : 'pointer',
                      opacity:     (isDisabled && !isGranted && !isSel) ? 0.4 : 1,
                    }}>
              {isGranted && <span style={{ marginRight:4, fontSize:10 }}>✓</span>}
              {isSel && !isGranted && <span style={{ marginRight:4 }}>✓</span>}
              {opt.label}
              {isGranted && <span style={{ marginLeft:6, fontSize:9, color:'var(--text-dim)' }}>granted</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ChoiceGroup — renders a list of ChoiceDescriptors with section heading
// Convenience wrapper for rendering all choices of one source at once.
//
// Props:
//   descriptors   ChoiceDescriptor[]
//   choices       character.choices object
//   onSetChoice   (id, value) => void
//   title         string
//   optionsMap    { [id]: ChoiceOption[] }  override options per id (for dynamic types)
// ─────────────────────────────────────────────────────────────────────────────

export function ChoiceGroup({ descriptors, choices, onSetChoice, title, optionsMap = {} }) {
  if (!descriptors || descriptors.length === 0) return null

  return (
    <div style={{ marginBottom:20 }}>
      {title && <div style={S.groupTitle}>{title}</div>}
      <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
        {descriptors.map(d => (
          <ChoicePicker
            key={d.id}
            descriptor={d}
            value={choices?.[d.id] ?? null}
            onChange={val => onSetChoice(d.id, val)}
            options={optionsMap[d.id] || d.options}
          />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const S = {
  label: {
    color:'var(--text-secondary)', fontWeight:'bold', fontSize:13,
    marginBottom:4, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap',
  },
  counter: {
    background:'var(--bg-highlight)', border:'1px solid #2a4a6a', borderRadius:999,
    padding:'2px 10px', fontSize:11, color:'var(--text-muted)', fontWeight:'normal',
  },
  pill: {
    border:'1px solid', borderRadius:999,
    padding:'5px 13px', fontSize:12,
    fontFamily:'inherit', transition:'all 0.12s',
    display:'inline-flex', alignItems:'center',
  },
  card: {
    border:'1px solid', borderRadius:8,
    padding:'10px 14px',
    transition:'all 0.12s',
  },
  cardGrid: {
    display:'grid',
    gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))',
    gap:8, marginTop:8,
  },
  swatch: {
    width:36, height:36, borderRadius:6,
    border:'none', transition:'outline 0.1s',
    display:'flex', alignItems:'center', justifyContent:'center',
  },
  swatchLabel: {
    color:'var(--text-primary)', fontWeight:'bold', fontSize:12,
    textShadow:'0 1px 3px #000',
  },
  abilityChip: {
    border:'1px solid', borderRadius:8,
    padding:'6px 14px', minWidth:56, textAlign:'center',
    fontFamily:'inherit', transition:'all 0.12s',
    display:'flex', flexDirection:'column', alignItems:'center',
  },
  groupTitle: {
    color:'var(--accent)', fontWeight:'bold', fontSize:15,
    marginBottom:10, paddingBottom:6,
    borderBottom:'1px solid #1a3a5a',
  },
}