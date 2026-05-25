// src/features/mtg/match-hud/components/PlayerTile.jsx
//
// One player's HUD tile. Two roles:
//   - "own"      → the entire tile is a giant ± control. Left half = -1 life,
//                  right half = +1 life. Poison has dedicated tiny ± buttons.
//   - "readonly" → opponent view. Same colour scheme, no taps. Life still
//                  large enough to read across a table.
//
// Visual elements:
//   - Background = player colour (with high-contrast foreground via swatch)
//   - Player name + (optional) deck name at top
//   - Huge life number, centre
//   - Poison + small ± at bottom
//   - Presence dot, online/offline
//
// Tap feedback: the active half briefly flashes (controlled by a small
// timeout + className toggle — no library).

import { memo, useCallback, useRef, useState } from 'react';
import { getColor } from '../services/playerColors';

function PlayerTileBase({
  player,
  isOwn = false,
  isOnline = false,
  onLifeDelta,
  onPoisonDelta,
  onOpenSelf,
  // When true, skip the name + deck + presence + settings strip. Used by
  // the local "all on one phone" match mode where there are no per-player
  // identities — the colour alone identifies a player.
  hideMeta = false,
  // Tile rotation in degrees, applied via inline style (overrides any
  // grid-layout default). Triggers the in-tile rotate buttons when
  // onRotate is supplied.
  rotation = 0,
  onRotate,
}) {
  const swatch = getColor(player.color);
  const [flashSide, setFlashSide] = useState(null); // 'left' | 'right' | null
  const flashTimerRef = useRef(null);

  const triggerFlash = useCallback((side) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashSide(side);
    flashTimerRef.current = setTimeout(() => setFlashSide(null), 220);
  }, []);

  const tapLeft = useCallback(() => {
    if (!isOwn) return;
    triggerFlash('left');
    onLifeDelta?.(-1);
  }, [isOwn, onLifeDelta, triggerFlash]);

  const tapRight = useCallback(() => {
    if (!isOwn) return;
    triggerFlash('right');
    onLifeDelta?.(+1);
  }, [isOwn, onLifeDelta, triggerFlash]);

  // Stop the tap zones from receiving double-clicks / text selection on
  // accidental drags. Touch and mouse both come through onClick.
  const noSelect = (e) => e.preventDefault();

  // Rotation lives on the inner content div (not the outer tile box).
  // The OUTER box stays in its grid cell — keeps `overflow: hidden`
  // meaningful and prevents the rotated visual from leaking into the
  // neighbouring cells. The inner div uses container-query units to
  // swap its dimensions when rotated by 90°/270° so the rotated content
  // exactly fills the cell instead of bleeding past it.
  const normalisedRot = ((rotation % 360) + 360) % 360
  const isQuarterTurn = normalisedRot === 90 || normalisedRot === 270

  return (
    <div
      className={`mh-tile ${isOwn ? 'mh-tile-own' : 'mh-tile-readonly'}`}
      style={{
        ['--mh-tile-bg']: swatch.bg,
        ['--mh-tile-fg']: swatch.text,
      }}
    >
      <div
        className={`mh-tile-content ${isQuarterTurn ? 'mh-tile-content-quarter' : ''}`}
        style={{ ['--mh-tile-rot']: `${normalisedRot}deg` }}
      >
      {onRotate && (
        <div className="mh-tile-rotate" aria-hidden={false}>
          <button type="button" title="Drehen ←"  onClick={(e) => { e.stopPropagation(); onRotate(-90) }}>↺</button>
          <button type="button" title="Umdrehen" onClick={(e) => { e.stopPropagation(); onRotate(180) }}>⇅</button>
          <button type="button" title="Drehen →"  onClick={(e) => { e.stopPropagation(); onRotate(+90) }}>↻</button>
        </div>
      )}
      {!hideMeta && (
        <div className="mh-tile-meta">
          <span
            className={`mh-tile-presence ${isOnline ? 'mh-presence-on' : ''}`}
            aria-label={isOnline ? 'online' : 'offline'}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mh-tile-meta-name">{player.player_name || 'Spieler'}</div>
            {player.deck_name && <div className="mh-tile-meta-deck">{player.deck_name}</div>}
          </div>
        </div>
      )}

      {isOwn && onOpenSelf && !hideMeta && (
        <div className="mh-tile-actions">
          <button
            type="button"
            className="mh-tile-mini-btn"
            title="Optionen"
            onClick={onOpenSelf}
          >⚙</button>
        </div>
      )}

      <div className="mh-tile-life-wrap">
        <span className={`mh-tile-life ${isOwn ? '' : 'mh-tile-life-readonly'}`}>
          {player.life}
        </span>
      </div>

      {/* Tap zones. Cover the entire tile area beneath the meta/foot rows. */}
      <button
        type="button"
        className={`mh-tap mh-tap-left ${flashSide === 'left' ? 'mh-tap-flash' : ''}`}
        onClick={tapLeft}
        onMouseDown={noSelect}
        aria-label="Leben −1"
        disabled={!isOwn}
      >
        {isOwn && <span className="mh-tap-hint">−</span>}
      </button>
      <button
        type="button"
        className={`mh-tap mh-tap-right ${flashSide === 'right' ? 'mh-tap-flash' : ''}`}
        onClick={tapRight}
        onMouseDown={noSelect}
        aria-label="Leben +1"
        disabled={!isOwn}
      >
        {isOwn && <span className="mh-tap-hint">+</span>}
      </button>

      <div className="mh-tile-foot">
        <div className={`mh-poison ${isOwn ? '' : 'mh-poison-readonly'}`} title="Poison Counter">
          {isOwn && (
            <button
              type="button"
              className="mh-poison-btn"
              onClick={() => onPoisonDelta?.(-1)}
              aria-label="Poison −1"
            >−</button>
          )}
          <span className="mh-poison-value">
            <span aria-hidden="true" className="mh-poison-icon">☠</span>
            {player.poison}
          </span>
          {isOwn && (
            <button
              type="button"
              className="mh-poison-btn"
              onClick={() => onPoisonDelta?.(+1)}
              aria-label="Poison +1"
            >+</button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

// Memoised because in a 4-player match each tile re-renders only when *its*
// player changes — the parent state changing for an opponent shouldn't
// re-render the current player's tile.
const PlayerTile = memo(PlayerTileBase, (a, b) => (
  a.isOwn === b.isOwn
  && a.isOnline === b.isOnline
  && a.hideMeta === b.hideMeta
  && a.rotation === b.rotation
  && a.player.id === b.player.id
  && a.player.life === b.player.life
  && a.player.poison === b.player.poison
  && a.player.color === b.player.color
  && a.player.player_name === b.player.player_name
  && a.player.deck_name === b.player.deck_name
  && a.onLifeDelta === b.onLifeDelta
  && a.onPoisonDelta === b.onPoisonDelta
  && a.onOpenSelf === b.onOpenSelf
  && a.onRotate === b.onRotate
));

export default PlayerTile;
