// src/features/mtg/deck-builder/pwa/MtgDeckViewerMobile.jsx
//
// Read-only deck viewer for phones — the "Ansehen" tab of the mobile deck
// builder and the shared-deck page on phones. Nothing here edits the deck:
// switch zone, pick a sort order, flip between a card grid and a compact
// list, and tap a card to see it full-screen. The full-screen view is a
// carousel: the neighbour cards are already rendered (images preloaded),
// the track follows the finger and slides on release, so stepping through
// the deck never re-mounts or flashes.
//
// Receives display zones that already carry the deck's chosen artwork.
// Sort / layout / column count are per-device display preferences and
// live in localStorage.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import useBackGuard from '../../../../shared/hooks/useBackGuard';
import useLocalizedCard from '../hooks/useLocalizedCard';
import ManaSymbol from '../components/ManaSymbol';
import {
  getCardImage, getCardFaces, getCardLayout, getManaCost, parseManaCost,
  getCardPriceEur, formatEur,
} from '../services/scryfall';
import { organizeDeck } from '../services/deckOrganize';
import { printingLabel } from '../services/deckPrintings';
import './MtgDeckViewerMobile.css';

const SORTS = [
  { id: 'type',   label: 'Typ' },
  { id: 'name',   label: 'Name' },
  { id: 'cmc',    label: 'Manakosten' },
  { id: 'color',  label: 'Farbe' },
  { id: 'rarity', label: 'Seltenheit' },
  { id: 'price',  label: 'Preis' },
];
const COLS = [1, 2, 3, 4];

// Same palette and wording as the deck tiles on the MTG dashboard, so the
// colour split reads the same wherever it shows up.
const COLOR_STYLE = {
  W: '#e0b352', U: '#4a8fd9', B: '#8a7fa8',
  R: '#e06a5a', G: '#6ab06a', C: '#808080',
};
const COLOR_LABEL = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };

/** Colour split of the deck proper (mainboard + commander), like the tile. */
function colorSplit(mainboard, commander) {
  const counts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const add = (card, count) => {
    if (!card || count <= 0) return;
    const colors = card.colors || card.card_faces?.[0]?.colors || [];
    if (colors.length === 0) counts.C += count;
    else for (const c of colors) if (counts[c] !== undefined) counts[c] += count;
  };
  for (const entry of Object.values(mainboard || {})) add(entry?.card, entry?.count || 0);
  if (commander) add(commander, 1);
  const entries = Object.entries(counts)
    .filter(([c, v]) => v > 0 && c !== 'C')
    .sort((a, b) => b[1] - a[1]);
  if (counts.C > 0) entries.push(['C', counts.C]);
  return { entries, total: entries.reduce((s, [, v]) => s + v, 0) };
}

const PREFS_KEY = 'mtg-mobile-viewer:v2';
const DEFAULT_PREFS = { sort: 'type', sort2: '', layout: 'grid', cols: 2 };

function readPrefs() {
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    return stored ? { ...DEFAULT_PREFS, ...JSON.parse(stored) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

const countOf = (deck) => Object.values(deck).reduce((s, e) => s + (e.count || 0), 0);
const eurOf = (deck) => Object.values(deck).reduce((s, e) => {
  const p = getCardPriceEur(e.card);
  return p != null ? s + p * (e.count || 0) : s;
}, 0);

export default function MtgDeckViewerMobile({
  mainboard, sideboard, ideas, commander, tokens,
  // Shared decks have no tab bar at the bottom — the colour split of the
  // deck goes there instead.
  showColors = false,
}) {
  const [prefs, setPrefs] = useState(readPrefs);
  const [zoneId, setZoneId] = useState('main');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [openIndex, setOpenIndex] = useState(null);

  // Back gesture while a card is full-screen: close the card, stay in the
  // deck. Only from the deck itself does Back leave the deck.
  useBackGuard(openIndex != null, useCallback(() => setOpenIndex(null), []));

  // Only explicit choices are stored, so a changed default still applies.
  const setPref = (key, value) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const zones = useMemo(() => [
    { id: 'main',  label: 'Mainboard', deck: mainboard || {} },
    { id: 'side',  label: 'Sideboard', deck: sideboard || {} },
    { id: 'ideas', label: 'Ideen',     deck: ideas || {} },
    // Tokens set to 0 ("don't buy") aren't shown.
    { id: 'tokens', label: 'Tokens',   deck: Object.fromEntries(Object.entries(tokens || {}).filter(([, e]) => e.count > 0)) },
  ].map(z => ({ ...z, count: countOf(z.deck), eur: eurOf(z.deck) })), [mainboard, sideboard, ideas, tokens]);

  const colors = useMemo(
    () => (showColors ? colorSplit(mainboard, commander) : null),
    [showColors, mainboard, commander]
  );

  const zone = zones.find(z => z.id === zoneId) || zones[0];
  const withCommander = zone.id === 'main' && !!commander;
  const sort2 = prefs.sort2 && prefs.sort2 !== prefs.sort ? prefs.sort2 : '';

  const groups = useMemo(() => {
    const organized = organizeDeck(zone.deck, prefs.sort, sort2 || null);
    const all = withCommander
      ? [{ groupLabel: 'Commander', groupCount: 1, entries: [{ card: commander, count: 1 }] }, ...organized]
      : organized;
    // `start` = index of the group's (and each sub-group's) first card in
    // the flat order used by the full-screen view.
    const starts = [];
    all.forEach((g, i) => starts.push(i === 0 ? 0 : starts[i - 1] + all[i - 1].entries.length));
    return all.map((g, i) => {
      if (!g.subgroups) return { ...g, start: starts[i] };
      const subStarts = [];
      g.subgroups.forEach((s, j) => subStarts.push(
        j === 0 ? starts[i] : subStarts[j - 1] + g.subgroups[j - 1].entries.length
      ));
      return {
        ...g,
        start: starts[i],
        subgroups: g.subgroups.map((s, j) => ({ ...s, start: subStarts[j] })),
      };
    });
  }, [zone.deck, prefs.sort, sort2, withCommander, commander]);

  // Flat order for the full-screen viewer — same order as on screen.
  const flat = useMemo(() => groups.flatMap(g => g.entries), [groups]);
  // Count badges only where they carry information (not in singleton decks).
  const showCounts = flat.some(e => e.count > 1);

  const zoneEur = zone.eur + (withCommander ? (getCardPriceEur(commander) ?? 0) : 0);
  const zoneCount = zone.count + (withCommander ? 1 : 0);

  const groupKey = (label) => `${zone.id}:${prefs.sort}:${sort2}:${label}`;

  const renderEntries = (entries, start) => (prefs.layout === 'grid' ? (
    <div
      className={`mdv-grid ${prefs.cols === 1 ? 'is-single' : ''}`}
      style={{ gridTemplateColumns: `repeat(${prefs.cols}, 1fr)` }}
    >
      {entries.map((e, i) => (
        <GridTile
          key={e.card.id}
          entry={e}
          showCount={showCounts}
          onOpen={() => setOpenIndex(start + i)}
        />
      ))}
    </div>
  ) : (
    <div className="mdv-list">
      {entries.map((e, i) => (
        <ListRow key={e.card.id} entry={e} onOpen={() => setOpenIndex(start + i)} />
      ))}
    </div>
  ));
  const toggleGroup = (label) => setCollapsed(prev => {
    const next = new Set(prev);
    const k = groupKey(label);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  return (
    <div className="mdv">
      <div className="mdv-controls">
        <div className="mdv-zones">
          {zones
            .filter(z => z.id === 'main' || z.count > 0 || z.id === zone.id)
            .map(z => (
              <button
                key={z.id}
                type="button"
                className={`mdv-zone ${z.id === zone.id ? 'is-active' : ''}`}
                onClick={() => setZoneId(z.id)}
                aria-pressed={z.id === zone.id}
              >
                {z.label}
                <span className="mdv-zone-count">{z.count + (z.id === 'main' && commander ? 1 : 0)}</span>
              </button>
            ))}
        </div>

        <div className="mdv-sortrow">
          <label className="mdv-select">
            <span>Sortieren</span>
            <select value={prefs.sort} onChange={(e) => setPref('sort', e.target.value)}>
              {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="mdv-select">
            <span>dann nach</span>
            <select value={sort2} onChange={(e) => setPref('sort2', e.target.value)}>
              <option value="">–</option>
              {SORTS.filter(s => s.id !== prefs.sort).map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mdv-row">
          <span className="mdv-summary">
            {zoneCount} {zoneCount === 1 ? 'Karte' : 'Karten'}
            {zoneEur > 0 && <> · ≈ {formatEur(zoneEur)}</>}
          </span>
          <div className="mdv-seg" role="group" aria-label="Darstellung">
            <button
              type="button"
              className={prefs.layout === 'grid' ? 'is-active' : ''}
              onClick={() => setPref('layout', 'grid')}
            >Raster</button>
            <button
              type="button"
              className={prefs.layout === 'list' ? 'is-active' : ''}
              onClick={() => setPref('layout', 'list')}
            >Liste</button>
          </div>
          {prefs.layout === 'grid' && (
            <div className="mdv-seg" role="group" aria-label="Spalten">
              {COLS.map(c => (
                <button
                  key={c}
                  type="button"
                  className={prefs.cols === c ? 'is-active' : ''}
                  onClick={() => setPref('cols', c)}
                >{c}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {flat.length === 0 ? (
        <div className="mdv-empty">
          {zone.id === 'main' ? 'Das Mainboard ist noch leer.' : `Keine Karten in „${zone.label}".`}
        </div>
      ) : (
        <div className="mdv-body">
          {groups.map((g, gi) => {
            const isCollapsed = g.groupLabel && collapsed.has(groupKey(g.groupLabel));
            const { start } = g;
            return (
              <section key={g.groupLabel ?? `g${gi}`} className="mdv-group">
                {g.groupLabel && (
                  <button
                    type="button"
                    className="mdv-group-hdr"
                    onClick={() => toggleGroup(g.groupLabel)}
                    aria-expanded={!isCollapsed}
                  >
                    <span className="mdv-group-caret" aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                    <span>{g.groupLabel}</span>
                    <span className="mdv-group-count">{g.groupCount}</span>
                  </button>
                )}
                {!isCollapsed && (g.subgroups
                  ? g.subgroups.map(s => (
                    <div key={s.label} className="mdv-sub">
                      <div className="mdv-sub-hdr">
                        <span>{s.label}</span>
                        <span className="mdv-group-count">{s.count}</span>
                      </div>
                      {renderEntries(s.entries, s.start)}
                    </div>
                  ))
                  : renderEntries(g.entries, start))}
              </section>
            );
          })}
        </div>
      )}

      {colors && colors.total > 0 && (
        <div className="mdv-colors">
          <div
            className="mdv-colors-bar"
            role="img"
            aria-label={colors.entries.map(([c, n]) => `${COLOR_LABEL[c]} ${n}`).join(', ')}
          >
            {colors.entries.map(([c, n]) => (
              <span
                key={c}
                className="mdv-colors-seg"
                style={{ flex: n, background: COLOR_STYLE[c] }}
                title={`${COLOR_LABEL[c]}: ${n} (${Math.round((n / colors.total) * 100)}%)`}
              />
            ))}
          </div>
          <div className="mdv-colors-legend">
            {colors.entries.map(([c, n]) => (
              <span key={c} className="mdv-colors-item" title={COLOR_LABEL[c]}>
                <i style={{ background: COLOR_STYLE[c] }} aria-hidden="true" />
                {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {openIndex != null && flat[openIndex] && (
        <CardLightbox
          entries={flat}
          index={openIndex}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </div>
  );
}

function GridTile({ entry, showCount, onOpen }) {
  const { card, count } = entry;
  const img = getCardImage(card, 'normal');
  return (
    <button type="button" className="mdv-tile" onClick={onOpen} aria-label={`${count}× ${card.name}`}>
      {img
        ? <img src={img} alt="" loading="lazy" />
        : <span className="mdv-tile-fallback">{card.name}</span>}
      {showCount && <span className="mdv-count">{count}×</span>}
    </button>
  );
}

function ListRow({ entry, onOpen }) {
  const { card, count } = entry;
  const img = getCardImage(card, 'small');
  const eur = getCardPriceEur(card);
  const syms = parseManaCost(getManaCost(card));
  return (
    <button type="button" className="mdv-line" onClick={onOpen}>
      <span className="mdv-line-count">{count}</span>
      <span className="mdv-line-thumb" style={img ? { backgroundImage: `url(${img})` } : undefined} aria-hidden="true" />
      <span className="mdv-line-main">
        <span className="mdv-line-name">{card.name}</span>
        <span className="mdv-line-type">{card.type_line?.split('—')[0].trim()}</span>
      </span>
      <span className="mdv-line-mana">
        {syms.map((s, i) => <ManaSymbol key={i} symbol={s} size="xs" />)}
      </span>
      <span className="mdv-line-price">{eur != null ? formatEur(eur) : ''}</span>
    </button>
  );
}

// ── Full-screen carousel ──────────────────────────────────────────────

const SLIDE_MS = 220;

function moveTrack(el, px, animate) {
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.style.transition = animate && !reduce
    ? `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0.7, 0.2, 1)`
    : 'none';
  el.style.transform = `translate3d(${px}px, 0, 0)`;
}

function CardLightbox({ entries, index, onIndex, onClose }) {
  const stageRef = useRef(null);
  const trackRef = useRef(null);
  const dragRef = useRef(null);
  const pendingRef = useRef({ dir: 0, timer: null });
  const [faces, setFaces] = useState({}); // card id → shown face (double-faced cards)

  // The index moved: the neighbour slide already sits in the middle of the
  // re-rendered window, so the track snaps back to 0 without animation.
  useLayoutEffect(() => {
    moveTrack(trackRef.current, 0, false);
  }, [index]);

  useEffect(() => {
    const pending = pendingRef.current;
    return () => clearTimeout(pending.timer);
  }, []);

  const commit = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending.dir) return;
    const dir = pending.dir;
    pending.dir = 0;
    clearTimeout(pending.timer);
    onIndex(index + dir);
  }, [index, onIndex]);

  const go = useCallback((dir) => {
    if (pendingRef.current.dir) return;
    const target = index + dir;
    if (target < 0 || target >= entries.length) {
      moveTrack(trackRef.current, 0, true);
      return;
    }
    const width = stageRef.current?.clientWidth || window.innerWidth;
    pendingRef.current.dir = dir;
    moveTrack(trackRef.current, -dir * width, true);
    // transitionend can be skipped (reduced motion, hidden tab) — commit anyway.
    pendingRef.current.timer = setTimeout(commit, SLIDE_MS + 80);
  }, [index, entries.length, commit]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  const onTouchStart = (e) => {
    if (pendingRef.current.dir) return;
    const t = e.touches[0];
    dragRef.current = { x: t.clientX, y: t.clientY, dx: 0, axis: null, at: Date.now() };
  };
  const onTouchMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const t = e.touches[0];
    const dx = t.clientX - drag.x;
    const dy = t.clientY - drag.y;
    if (!drag.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (drag.axis !== 'x') return;
    // Rubber band at the first / last card.
    const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === entries.length - 1);
    drag.dx = atEdge ? dx * 0.3 : dx;
    moveTrack(trackRef.current, drag.dx, false);
  };
  const onTouchEnd = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.axis !== 'x') return;
    const width = stageRef.current?.clientWidth || window.innerWidth;
    const speed = Math.abs(drag.dx) / Math.max(1, Date.now() - drag.at);
    if (Math.abs(drag.dx) > width * 0.2 || (Math.abs(drag.dx) > 30 && speed > 0.5)) {
      go(drag.dx < 0 ? 1 : -1);
    } else {
      moveTrack(trackRef.current, 0, true);
    }
  };

  const current = entries[index];

  return (
    <div className="mdv-lb" role="dialog" aria-modal="true" aria-label={current.card.name}>
      <div className="mdv-lb-top">
        <span className="mdv-lb-pos">{index + 1} / {entries.length}</span>
        <button type="button" className="mdv-lb-btn" onClick={onClose} aria-label="Schließen">✕</button>
      </div>

      <div
        className="mdv-lb-stage"
        ref={stageRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div
          className="mdv-lb-track"
          ref={trackRef}
          onTransitionEnd={(e) => {
            if (e.target === trackRef.current && e.propertyName === 'transform') commit();
          }}
        >
          {[-1, 0, 1].map(offset => {
            const entry = entries[index + offset];
            if (!entry) return null;
            const id = entry.card.id;
            return (
              <LightboxSlide
                key={id}
                entry={entry}
                offset={offset}
                face={faces[id] || 0}
                onFlip={() => setFaces(f => ({ ...f, [id]: f[id] ? 0 : 1 }))}
                onClose={onClose}
              />
            );
          })}
        </div>
      </div>

      <div className="mdv-lb-nav">
        <button type="button" className="mdv-lb-btn" onClick={() => go(-1)} disabled={index === 0} aria-label="Vorherige Karte">‹</button>
        <button type="button" className="mdv-lb-btn" onClick={() => go(1)} disabled={index === entries.length - 1} aria-label="Nächste Karte">›</button>
      </div>
    </div>
  );
}

function LightboxSlide({ entry, offset, face, onFlip, onClose }) {
  const { count } = entry;
  // Full-screen is where the card is actually read — show it in the
  // language chosen in the MTG settings when that printing exists.
  const card = useLocalizedCard(entry.card);
  const faces = getCardFaces(card);
  const isDouble = getCardLayout(card) === 'double_faced';
  const shown = faces[face] || faces[0];
  const img = shown?.image_uri_large || shown?.image_uri;
  const eur = getCardPriceEur(card);
  const syms = parseManaCost(shown?.mana_cost || getManaCost(card));
  const active = offset === 0;
  const priceText = eur == null
    ? null
    : count > 1 ? `${formatEur(eur)} · ∑ ${formatEur(eur * count)}` : formatEur(eur);
  const closeOnBackdrop = (e) => { if (e.target === e.currentTarget) onClose(); };

  return (
    <div
      className="mdv-lb-slide"
      style={{ transform: `translate3d(${offset * 100}%, 0, 0)` }}
      aria-hidden={!active}
      onClick={closeOnBackdrop}
    >
      <div className="mdv-lb-card" onClick={closeOnBackdrop}>
        {img
          ? <img src={img} alt={shown?.name || card.name} className="mdv-lb-img" draggable={false} />
          : <div className="mdv-lb-fallback">{card.name}</div>}
        {isDouble && (
          <button
            type="button"
            className="mdv-lb-btn mdv-lb-flip"
            onClick={onFlip}
            tabIndex={active ? 0 : -1}
            aria-label="Andere Seite zeigen"
          >↻</button>
        )}
      </div>

      <div className="mdv-lb-info">
        <div className="mdv-lb-titlerow">
          <span className="mdv-lb-qty" aria-label={`${count} im Deck`}>{count}×</span>
          <span className="mdv-lb-name">{isDouble ? shown?.name : card.name}</span>
          {syms.length > 0 && (
            <span className="mdv-lb-mana">
              {syms.map((s, i) => <ManaSymbol key={i} symbol={s} size="sm" />)}
            </span>
          )}
        </div>
        <div className="mdv-lb-sub">{shown?.type_line || card.type_line}</div>
        <div className="mdv-lb-sub">
          {[printingLabel(card), priceText].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  );
}
