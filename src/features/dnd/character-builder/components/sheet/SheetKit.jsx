// components/sheet/SheetKit.jsx
// Shared styles + UI primitives for the reworked character sheet.
// Every sheet tab imports `S` (styles) and the small components from here
// so the look stays consistent and the tab files stay focused on content.

import { useState, useEffect, useRef } from 'react'
import useWindowWidth from '../../../../../shared/hooks/useWindowWidth'
import { S } from './sheetStyles'

// ═══════════════════════════════════════════════════════════════
// LAYOUT PRIMITIVES
// ═══════════════════════════════════════════════════════════════

export function Section({ title, action, children }) {
  return (
    <div style={S.section}>
      <div style={S.sectionHead}>
        <div style={S.sectionTitle}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

export function SideSection({ title, children, defaultOpen = false }) {
  // On phones (<=768px) render a collapsible <details> accordion; on
  // desktop / Tauri the plain block renders, pixel-identical to before.
  const { mode } = useWindowWidth()
  if (mode !== 'hidden') {
    return (
      <div style={S.sideSection}>
        <div style={S.sideSectionTitle}>{title}</div>
        {children}
      </div>
    )
  }
  return (
    <details className="dnd-side-acc" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="dnd-side-acc-body">{children}</div>
    </details>
  )
}

export function EmptyState({ title, desc }) {
  return (
    <div style={S.emptyState}>
      <div style={S.emptyTitle}>{title}</div>
      {desc && <div style={S.emptyDesc}>{desc}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════

export function SheetModal({ open, onClose, title, children, footer, width = 560 }) {
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div data-modal-root style={S.modalOverlay} onClick={onClose}>
      <div data-modal-card style={{ ...S.modalCard, maxWidth: width }} onClick={e => e.stopPropagation()}>
        <div style={S.modalHead}>
          <span style={S.modalTitle}>{title}</span>
          <button type="button" style={S.modalClose} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={S.modalBody}>{children}</div>
        {footer && <div style={S.modalFoot}>{footer}</div>}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// CARDS / CHIPS
// ═══════════════════════════════════════════════════════════════

export function InfoCard({ label, value, hint }) {
  return (
    <div style={S.infoCard}>
      <div style={S.infoCardLabel}>{label}</div>
      <div style={S.infoCardValue}>{value}</div>
      {hint && <div style={S.infoCardHint}>{hint}</div>}
    </div>
  )
}

export function Badge({ color, label, hint }) {
  return (
    <span style={{ ...S.badge, borderColor: (color || 'var(--border)') + '88', color: color || 'var(--text-muted)' }} title={hint}>
      {label}
    </span>
  )
}

export function DetailChip({ label, value }) {
  return (
    <div style={S.detailChip}>
      <span style={S.detailChipLabel}>{label}: </span>
      <span style={S.detailChipValue}>{value}</span>
    </div>
  )
}

export function TraitPill({ label, value }) {
  return (
    <div style={S.traitPill}>
      <div style={S.traitPillLabel}>{label}</div>
      <div style={S.traitPillValue}>{value}</div>
    </div>
  )
}

export function ProfBlock({ label, value }) {
  return (
    <div style={S.profBlock}>
      <span style={S.profBlockLabel}>{label}: </span>
      <span style={S.profBlockValue}>{value}</span>
    </div>
  )
}

export function SenseRow({ label, value }) {
  return (
    <div style={S.senseRow}>
      <span style={S.senseName}>{label}</span>
      <span style={S.senseValue}>{value}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// BUTTONS
// ═══════════════════════════════════════════════════════════════

export function Btn({ children, onClick, variant = 'ghost', disabled, style, title, type = 'button' }) {
  const base = variant === 'primary' ? S.btnPrimary
    : variant === 'danger' ? S.btnDanger
    : variant === 'accent' ? S.btnAccent
    : S.btnGhost
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      style={{ ...base, ...(disabled ? S.btnDisabled : {}), ...style }}>
      {children}
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════
// FORM CONTROLS
// ═══════════════════════════════════════════════════════════════

export function FormRow({ label, children, hint }) {
  return (
    <div style={S.formRow}>
      <div style={S.formLabel}>{label}</div>
      {children}
      {hint && <div style={S.formHint}>{hint}</div>}
    </div>
  )
}

export function TextInput({ value, onChange, placeholder, type = 'text', style, autoFocus, min, step }) {
  return (
    <input
      type={type} value={value ?? ''} placeholder={placeholder} autoFocus={autoFocus}
      min={min} step={step}
      onChange={e => onChange(e.target.value)}
      style={{ ...S.input, ...style }}
    />
  )
}

export function TextArea({ value, onChange, placeholder, rows = 4, style }) {
  return (
    <textarea
      value={value ?? ''} placeholder={placeholder} rows={rows}
      onChange={e => onChange(e.target.value)}
      style={{ ...S.input, resize: 'vertical', minHeight: 60, lineHeight: 1.6, ...style }}
    />
  )
}

export function SelectInput({ value, onChange, options, style }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...S.input, ...style }}>
      {options.map(o => (
        <option key={String(o.value)} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export function Checkbox({ checked, onChange, label }) {
  return (
    <label style={S.checkbox}>
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

// ── Number stepper: [-] value [+] ──────────────────────────────
export function Stepper({ value, onChange, min = 0, max = 999, step = 1, width = 46 }) {
  const dec = () => onChange(Math.max(min, (value || 0) - step))
  const inc = () => onChange(Math.min(max, (value || 0) + step))
  return (
    <div style={S.stepper}>
      <button type="button" style={S.stepBtn} onClick={dec} disabled={(value || 0) <= min}>−</button>
      <input
        style={{ ...S.stepValue, width }}
        value={value ?? 0}
        onChange={e => {
          const n = parseInt(e.target.value, 10)
          if (Number.isNaN(n)) onChange(min)
          else onChange(Math.max(min, Math.min(max, n)))
        }}
      />
      <button type="button" style={S.stepBtn} onClick={inc} disabled={(value || 0) >= max}>+</button>
    </div>
  )
}

// ── Inline editable text (click to edit, blur / Enter to save) ──
export function EditableText({ value, onSave, placeholder = 'Click to edit', style, inputStyle, multiline = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef(null)

  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select?.() } }, [editing])

  function startEdit() { setDraft(value || ''); setEditing(true) }

  function commit() {
    setEditing(false)
    if ((draft || '') !== (value || '')) onSave(draft)
  }

  if (editing) {
    if (multiline) {
      return (
        <textarea
          ref={ref} value={draft} rows={6}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          style={{ ...S.input, resize: 'vertical', minHeight: 90, lineHeight: 1.6, ...inputStyle }}
        />
      )
    }
    return (
      <input
        ref={ref} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{ ...S.input, ...inputStyle }}
      />
    )
  }

  const empty = !value
  return (
    <div
      role="button" tabIndex={0}
      onClick={startEdit}
      onKeyDown={e => { if (e.key === 'Enter') startEdit() }}
      style={{ ...S.editable, ...(empty ? S.editableEmpty : {}), ...style }}
      title="Click to edit"
    >
      {empty ? placeholder : value}
      <span style={S.editPencil}>✎</span>
    </div>
  )
}