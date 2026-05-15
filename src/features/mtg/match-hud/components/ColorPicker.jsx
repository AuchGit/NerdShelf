// src/features/mtg/match-hud/components/ColorPicker.jsx
//
// Compact swatch row. Used in the join screen and in the "own" tile's
// options modal during a match.
//
// The trailing "custom" chip opens the native HTML5 <input type="color">.
// On phones this surfaces the platform colour picker (iOS Safari and Chrome
// both have a polished one), so we don't need to ship our own HSL wheel.
// The selected hex is then stored verbatim in the `color` column — getColor()
// already accepts both preset ids and hex strings.

import { useRef } from 'react';
import { PLAYER_COLORS, isCustomColor } from '../services/playerColors';

export default function ColorPicker({ value, onChange }) {
  const inputRef = useRef(null);
  const custom = isCustomColor(value) ? value : null;

  return (
    <div className="mh-colors" role="radiogroup" aria-label="Spielerfarbe">
      {PLAYER_COLORS.map(c => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          aria-label={c.label}
          className={`mh-color-chip ${value === c.id ? 'is-active' : ''}`}
          style={{ background: c.bg }}
          onClick={() => onChange?.(c.id)}
          title={c.label}
        />
      ))}

      {/* Custom hex chip. Renders the picked colour when one exists, or a
          subtle rainbow gradient as the "pick your own" affordance. */}
      <button
        type="button"
        role="radio"
        aria-checked={!!custom}
        aria-label="Eigene Farbe"
        title="Eigene Farbe wählen"
        className={`mh-color-chip mh-color-chip-custom ${custom ? 'is-active' : ''}`}
        style={custom
          ? { background: custom }
          : {
              background:
                'conic-gradient(from 0deg, #e74c3c, #f1c40f, #2ecc71, #3498db, #9b59b6, #e74c3c)',
            }}
        onClick={() => inputRef.current?.click()}
      >
        {!custom && <span style={{
          fontSize: 18, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.6)',
          fontWeight: 700,
        }}>+</span>}
      </button>

      <input
        ref={inputRef}
        type="color"
        value={custom || '#7c3aed'}
        onChange={(e) => onChange?.(e.target.value)}
        // Visually hidden but still focusable / clickable via the chip.
        style={{
          position: 'absolute',
          width: 1, height: 1, opacity: 0, pointerEvents: 'none',
        }}
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}
