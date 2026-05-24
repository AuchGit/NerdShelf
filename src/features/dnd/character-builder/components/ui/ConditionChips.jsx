// src/features/dnd/character-builder/components/ui/ConditionChips.jsx
//
// Toggleable strip of 5e conditions. Used by:
//   - The player sheet (OverviewTab) — onToggle writes via updateCharacter.
//   - The GM session card           — onToggle writes via patchCombatState RPC.
// Caller decides which write path to use; this component is purely presentational.

import { CONDITIONS } from '../../lib/conditions'

export default function ConditionChips({ active = [], onToggle, compact = false }) {
  const set = new Set(active || [])
  return (
    <div style={{
      display: 'flex', gap: compact ? 4 : 6, flexWrap: 'wrap',
    }}>
      {CONDITIONS.map(c => {
        const on = set.has(c.id)
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onToggle?.(c.id, !on)}
            title={`${c.label}\n${c.hint}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: compact ? '2px 7px' : '3px 9px',
              border: `1px solid ${on ? 'var(--accent-red)' : 'var(--border)'}`,
              borderRadius: 999,
              background: on ? 'color-mix(in srgb, var(--accent-red) 18%, transparent)' : 'transparent',
              color: on ? 'var(--accent-red)' : 'var(--text-dim)',
              fontSize: compact ? 10 : 11,
              fontWeight: on ? 'bold' : 'normal',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 120ms',
            }}
          >
            <span style={{ fontSize: compact ? 10 : 12 }}>{c.symbol}</span>
            <span>{c.label}</span>
          </button>
        )
      })}
    </div>
  )
}
