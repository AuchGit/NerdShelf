// src/features/mtg/deck-builder/pwa/MtgDeckViewerMobile.jsx
//
// Read-only deck viewer for phones — the "Ansehen" tab of the mobile deck
// builder. Nothing here edits the deck: switch zone, pick a sort order,
// flip between a card grid and a compact list, and tap a card to see it
// full-screen (swipe or arrows to step through the deck in sort order).
//
// Receives display zones that already carry the deck's chosen artwork.
// Sort / layout / column count are per-device display preferences and
// live in localStorage.

import { useEffect, useMemo, useRef, useState } from 'react';
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
const COLS = [2, 3, 4];

const PREFS_KEY = 'mtg-mobile-viewer';
const DEFAULT_PREFS = { sort: 'type', layout: 'grid', cols: 3 };

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

export default function MtgDeckViewerMobile({ mainboard, sideboard, ideas, commander }) {
  const [prefs, setPrefs] = useState(readPrefs);
  const [zoneId, setZoneId] = useState('main');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [openIndex, setOpenIndex] = useState(null);

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }, [prefs]);
  const setPref = (key, value) => setPrefs(p => ({ ...p, [key]: value }));

  const zones = useMemo(() => [
    { id: 'main',  label: 'Mainboard', deck: mainboard || {} },
    { id: 'side',  label: 'Sideboard', deck: sideboard || {} },
    { id: 'ideas', label: 'Ideen',     deck: ideas || {} },
  ].map(z => ({ ...z, count: countOf(z.deck), eur: eurOf(z.deck) })), [mainboard, sideboard, ideas]);

  const zone = zones.find(z => z.id === zoneId) || zones[0];
  const withCommander = zone.id === 'main' && !!commander;

  const groups = useMemo(() => {
    const organized = organizeDeck(zone.deck, prefs.sort);
    const all = withCommander
      ? [{ groupLabel: 'Commander', groupCount: 1, entries: [{ card: commander, count: 1 }] }, ...organized]
      : organized;
    // `start` = index of the group's first card in the flat order below.
    const starts = [];
    all.forEach((g, i) => starts.push(i === 0 ? 0 : starts[i - 1] + all[i - 1].entries.length));
    return all.map((g, i) => ({ ...g, start: starts[i] }));
  }, [zone.deck, prefs.sort, withCommander, commander]);

  // Flat order for the full-screen viewer — same order as on screen.
  const flat = useMemo(() => groups.flatMap(g => g.entries), [groups]);

  const zoneEur = zone.eur + (withCommander ? (getCardPriceEur(commander) ?? 0) : 0);
  const zoneCount = zone.count + (withCommander ? 1 : 0);

  const groupKey = (label) => `${zone.id}:${prefs.sort}:${label}`;
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

        <div className="mdv-sorts" role="group" aria-label="Sortierung">
          {SORTS.map(s => (
            <button
              key={s.id}
              type="button"
              className={`mdv-pill ${prefs.sort === s.id ? 'is-active' : ''}`}
              onClick={() => setPref('sort', s.id)}
              aria-pressed={prefs.sort === s.id}
            >{s.label}</button>
          ))}
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
                {!isCollapsed && (prefs.layout === 'grid' ? (
                  <div className="mdv-grid" style={{ gridTemplateColumns: `repeat(${prefs.cols}, 1fr)` }}>
                    {g.entries.map((e, i) => (
                      <GridTile key={e.card.id} entry={e} onOpen={() => setOpenIndex(start + i)} />
                    ))}
                  </div>
                ) : (
                  <div className="mdv-list">
                    {g.entries.map((e, i) => (
                      <ListRow key={e.card.id} entry={e} onOpen={() => setOpenIndex(start + i)} />
                    ))}
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}

      {openIndex != null && flat[openIndex] && (
        <CardLightbox
          key={flat[openIndex].card.id}
          entries={flat}
          index={openIndex}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </div>
  );
}

function GridTile({ entry, onOpen }) {
  const { card, count } = entry;
  const img = getCardImage(card, 'normal');
  return (
    <button type="button" className="mdv-tile" onClick={onOpen} aria-label={`${count}× ${card.name}`}>
      {img
        ? <img src={img} alt="" loading="lazy" />
        : <span className="mdv-tile-fallback">{card.name}</span>}
      {count > 1 && <span className="mdv-count">{count}×</span>}
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

function CardLightbox({ entries, index, onIndex, onClose }) {
  const { card, count } = entries[index];
  const [face, setFace] = useState(0);
  const touch = useRef(null);

  const faces = getCardFaces(card);
  const isDouble = getCardLayout(card) === 'double_faced';
  const shown = faces[face] || faces[0];
  const img = shown?.image_uri_large || shown?.image_uri;
  const eur = getCardPriceEur(card);

  const hasPrev = index > 0;
  const hasNext = index < entries.length - 1;
  const prev = () => { if (hasPrev) onIndex(index - 1); };
  const next = () => { if (hasNext) onIndex(index + 1); };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < entries.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, entries.length, onIndex, onClose]);

  const onTouchStart = (e) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) next(); else prev();
  };

  const stop = (e) => e.stopPropagation();
  const setLabel = printingLabel(card);

  return (
    <div className="mdv-lb" role="dialog" aria-modal="true" aria-label={card.name} onClick={onClose}>
      <div className="mdv-lb-top" onClick={stop}>
        <span className="mdv-lb-pos">{index + 1} / {entries.length}</span>
        <button type="button" className="mdv-lb-btn" onClick={onClose} aria-label="Schließen">✕</button>
      </div>

      <div className="mdv-lb-stage" onClick={stop} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {img
          ? <img src={img} alt={shown?.name || card.name} className="mdv-lb-img" />
          : <div className="mdv-lb-fallback">{card.name}</div>}
        {isDouble && (
          <button
            type="button"
            className="mdv-lb-btn mdv-lb-flip"
            onClick={() => setFace(f => (f === 0 ? 1 : 0))}
            aria-label="Andere Seite zeigen"
          >↻</button>
        )}
      </div>

      <div className="mdv-lb-info" onClick={stop}>
        <div className="mdv-lb-name">{isDouble ? shown?.name : card.name}</div>
        <div className="mdv-lb-meta">
          <span>{count}×</span>
          {setLabel && <span>{setLabel}</span>}
          {eur != null && <span>{formatEur(eur)}</span>}
        </div>
      </div>

      <div className="mdv-lb-nav" onClick={stop}>
        <button type="button" className="mdv-lb-btn" onClick={prev} disabled={!hasPrev} aria-label="Vorherige Karte">‹</button>
        <button type="button" className="mdv-lb-btn" onClick={next} disabled={!hasNext} aria-label="Nächste Karte">›</button>
      </div>
    </div>
  );
}
