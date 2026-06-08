// src/features/dnd/character-builder/components/ui/DndSubNav.jsx
//
// Sub-navigation strip for the D&D section. Same look and PWA mobile
// behaviour as MtgSubNav / Wh40kSubNav, but the D&D pages use hash routing
// inside /dnd/* so we render plain buttons + the parent's hashNav navigate
// instead of react-router NavLinks. The `active` prop tells the strip which
// tab is the current one (each page passes its own id).

import { useNavigate } from '../../lib/hashNav'

const TABS = [
  { id: 'characters', label: 'Characters', to: '/' },
  { id: 'campaigns',  label: 'Campaigns',  to: '/campaigns' },
  { id: 'homebrew',   label: 'Homebrew',   to: '/homebrew' },
]

export default function DndSubNav({ active }) {
  const navigate = useNavigate()

  return (
    <div
      // PWA-MOBILE: data-pwa-target makes mobile-layouts.css convert this
      // strip into a horizontally-scrollable snap row on a phone.
      data-pwa-target="subnav"
      style={{
        display: 'flex',
        gap: 'var(--space-1)',
        padding: 'var(--space-3) var(--space-5) 0',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
        position: 'sticky',
        top: 0,
        zIndex: 5,
      }}
    >
      {TABS.map(tab => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => navigate(tab.to)}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--fs-md)',
              fontWeight: isActive ? 'var(--fw-semibold)' : 'var(--fw-medium)',
              color: isActive ? 'var(--color-text)' : 'var(--color-text-muted)',
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${isActive ? 'var(--color-accent)' : 'transparent'}`,
              marginBottom: -1,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'color var(--transition), border-color var(--transition)',
            }}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
