// src/features/mtg/deck-builder/components/CardmarketExportModal.jsx
//
// Generates a Cardmarket-Wants-compatible decklist from the user's MTG
// wishlist with three source modes and a preview/edit step. The output
// format is the canonical MTG decklist line — `<count> <Cardname>` per
// line — which Cardmarket "Wants → Massenimport" accepts directly. Cards
// with a fixed artwork get the exact Cardmarket product appended:
// `<count> <Cardname> (V.<n>) (<Expansion>)` (see cardmarketMap.js).
//
// Source modes
//   - "current_deck"  → buy what's missing for one specific deck
//   - "everything"    → the full wishlist across all decks
//   - "selected"      → only the rows the user ticked beforehand
//
// Duplicates toggle
//   - OFF (default)   → subtract owned copies (services/ownedCopies.js):
//                       without a fixed artwork any printing counts, with
//                       one only that printing
//   - ON              → don't subtract the collection at all — buy fresh
//                       duplicates
//
// Preview lets the user tweak per-row quantities and tick off entries
// before generating the final text. The shopping list's total Cardmarket
// price is shown live so they know what the trip will cost.
//
// The parent mounts this modal per opening, so props seed the state.

import { useEffect, useMemo, useState } from 'react';
import { Modal, Button } from '../../../../shared/ui';
import { getCardPriceEur, formatEur } from '../services/scryfall';
import { isBasicLand } from '../services/deckAnalysis';
import { applyPrinting, cardmarketLine, printingLabel } from '../services/deckPrintings';
import { ownedCopiesOf, allocateOwnedCopies } from '../services/ownedCopies';
import {
  loadCardmarketMap, cardmarketTarget, cardmarketTokenTarget, tokenCardmarketName,
  cardmarketTokenPairs,
} from '../services/cardmarketMap';
import { collectTokenRefs, loadTokenCards, tokenKeyOf } from '../services/deckTokens';
import { fetchCardsByIds } from '../services/scryfallCollection';

export default function CardmarketExportModal({
  open,
  onClose,
  decks,             // [{ id, name, data }]
  ownedIndex,        // services/ownedCopies buildOwnedIndex(collection)
  initialSource = 'everything',
  initialDeckId,
  preselectedRows,   // optional Set<cardId> — when opened from "selected mode"
}) {
  const [source, setSource]       = useState(initialSource);
  const [deckId, setDeckId]       = useState(initialDeckId || '');
  const [allowDups, setAllowDups] = useState(false);
  // When generating from a specific deck, the user can decide whether
  // their "Ideen" pool feeds the shopping list. Default: include
  // (ideas exist precisely to land on the wishlist), but a quick
  // checkbox lets them stick to ONLY playable cards when they don't
  // want to pay for speculative additions yet.
  const [includeIdeas, setIncludeIdeas] = useState(true);
  // Tokens auto-resolved via Scryfall's `all_parts` array (every card
  // that creates a token carries a reference to the token's printing
  // there). When checked we walk every included card and append the
  // tokens as extra rows in the preview — `1 Treasure`, `1 Goblin`
  // etc. — in the same `<count> <name>` format Cardmarket's bulk
  // wants-import expects, so the user can copy-paste once.
  const [includeTokens, setIncludeTokens] = useState(true);
  // Cards with an artwork chosen in the deck builder are ordered as that
  // exact Cardmarket product. Off → plain `<count> <name>`, any edition.
  const [useArtworks, setUseArtworks] = useState(true);
  const [copied, setCopied]       = useState(false);
  const [busy, setBusy]           = useState(false);

  // Full token cards (colour, power/toughness, oracle id) for merging
  // identical tokens, the deck's token counts and Cardmarket names.
  const [tokenCards, setTokenCards] = useState(null);
  useEffect(() => {
    const ids = new Set();
    for (const d of decks || []) {
      const data = d.data || {};
      const refs = collectTokenRefs([data.mainboard, data.sideboard, data.ideas], data.commander);
      for (const id of refs.keys()) ids.add(id);
    }
    if (ids.size === 0) return;
    let cancelled = false;
    loadTokenCards([...ids])
      .then(cards => { if (!cancelled) setTokenCards(cards); })
      .catch(() => { /* tokens fall back to the names from all_parts */ });
    return () => { cancelled = true; };
  }, [decks]);

  // Decks may still be loading when the modal opens — fall back to the
  // first one without writing state.
  const effectiveDeckId = deckId || decks?.[0]?.id || '';
  // Row edits and the generated text belong to the settings they were made
  // with; changing a setting starts from the fresh candidate list.
  const settingsKey = JSON.stringify([source, effectiveDeckId, allowDups, includeIdeas, includeTokens, useArtworks]);
  const [edits, setEdits]         = useState({ key: null, include: {}, qty: {} });
  const [output, setOutput]       = useState(null); // { key, text, fallbacks }

  const rows = useMemo(() => buildCandidates({
    source, deckId: effectiveDeckId, allowDups, decks, ownedIndex, preselectedRows,
    includeIdeas, includeTokens, useArtworks, tokenCards,
  }), [source, effectiveDeckId, allowDups, decks, ownedIndex, preselectedRows, includeIdeas, includeTokens, useArtworks, tokenCards]);

  const myEdits = edits.key === settingsKey ? edits : { key: settingsKey, include: {}, qty: {} };
  const isIncluded = (r) => myEdits.include[r.key] ?? true;
  const qtyOf = (r) => Number(myEdits.qty[r.key] ?? r.qty) || 0;
  const setIncluded = (r, value) => setEdits({ ...myEdits, include: { ...myEdits.include, [r.key]: value } });
  const setQtyFor = (r, value) => setEdits({ ...myEdits, qty: { ...myEdits.qty, [r.key]: value } });
  const generated = output?.key === settingsKey ? output : null;

  let totalEur = 0;
  let includedCount = 0;
  for (const r of rows) {
    if (!isIncluded(r)) continue;
    const q = qtyOf(r);
    includedCount += q;
    const p = getCardPriceEur(r.card);
    if (p != null) totalEur += p * q;
  }

  const copyText = async (text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — user can still copy from the textarea */ }
  };

  const handleGenerate = async () => {
    const chosen = rows
      .filter(r => isIncluded(r) && qtyOf(r) > 0)
      .sort((a, b) =>
        (a.card?.name || a.cardId).localeCompare(b.card?.name || b.cardId)
        || (a.printing?.set_name || '').localeCompare(b.printing?.set_name || ''));

    // Resolve fixed artworks (and tokens) to Cardmarket products.
    const printings = new Map(chosen.filter(r => r.printing).map(r => [r.printing.id, r.printing]));
    const hasTokens = chosen.some(r => r.card?._isToken);
    let map = null;
    if (printings.size > 0 || hasTokens) {
      setBusy(true);
      try {
        map = await loadCardmarketMap();
        // Artworks chosen before the Cardmarket id was stored: look it up.
        const missingIds = [...printings.values()].filter(p => p.cardmarket_id == null).map(p => p.id);
        if (missingIds.length > 0) {
          const cards = await fetchCardsByIds(missingIds).catch(() => []);
          for (const c of cards) {
            printings.set(c.id, { ...printings.get(c.id), cardmarket_id: c.cardmarket_id ?? null });
          }
        }
      } finally {
        setBusy(false);
      }
    }

    // Tokens printed back to back: if the deck needs both halves of one
    // physical card, it buys that card once instead of two products.
    const pairs = cardmarketTokenPairs(
      map,
      chosen.filter(r => r.card?._isToken).map(r => ({ key: r.key, card: r.card, qty: qtyOf(r) })),
    );

    let fallbacks = 0;
    let tokenFallbacks = 0;
    const tokenLinks = [];
    const text = chosen.map(r => {
      const qty = qtyOf(r);
      if (r.card?._isToken) {
        const pair = pairs.get(r.key);
        if (pair) {
          // The other half prints the shared line.
          if (!pair.primary) return null;
          tokenLinks.push({ qty: pair.qty, name: pair.name, url: cardmarketSearchUrl(pair.name) });
          return `${pair.qty} ${pair.name} (${pair.expansion})`;
        }
        const target = cardmarketTokenTarget(map, r.card);
        if (!target || target.guessed) tokenFallbacks++;
        const productName = target?.name || tokenCardmarketName(r.card);
        tokenLinks.push({ qty, name: productName, url: cardmarketSearchUrl(productName) });
        return target
          ? `${qty} ${productName} (${target.expansion})`
          : `${qty} ${productName}`;
      }
      const printing = r.printing ? printings.get(r.printing.id) : null;
      const target = printing ? cardmarketTarget(map, printing.cardmarket_id) : null;
      if (printing && !target) fallbacks++;
      return cardmarketLine(qty, r.card?.name || r.cardId, printing, target);
    }).filter(Boolean).join('\n');

    setOutput({ key: settingsKey, text, fallbacks, tokenFallbacks, tokenLinks });
    copyText(text);
  };

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose}>Schließen</Button>
      {!generated && (
        <Button onClick={handleGenerate} disabled={includedCount === 0 || busy}>
          {busy ? 'Suche Cardmarket-Editionen…' : `Liste generieren (${includedCount})`}
        </Button>
      )}
      {generated && (
        <Button onClick={() => setOutput(null)}>
          Zurück zur Vorschau
        </Button>
      )}
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title="Cardmarket-Liste exportieren" width={760} footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {!generated && (
          <>
            <SourceControls
              source={source} setSource={setSource}
              deckId={effectiveDeckId} setDeckId={setDeckId}
              decks={decks}
              allowDups={allowDups} setAllowDups={setAllowDups}
              includeIdeas={includeIdeas} setIncludeIdeas={setIncludeIdeas}
              includeTokens={includeTokens} setIncludeTokens={setIncludeTokens}
              useArtworks={useArtworks} setUseArtworks={setUseArtworks}
              hasPreselected={!!preselectedRows?.size}
            />

            <div style={summaryStyle}>
              <span>
                <strong>{includedCount}</strong> {includedCount === 1 ? 'Karte' : 'Karten'} ausgewählt
              </span>
              <button
                type="button"
                onClick={() => {
                  // Promote every included non-basic-land row to a full
                  // playset (4 copies). Basics stay where they are —
                  // nobody wants 4-of basics in their Cardmarket cart.
                  const qty = { ...myEdits.qty };
                  for (const r of rows) {
                    if (!isIncluded(r) || isBasicLand(r.card)) continue;
                    if (qtyOf(r) < 4) qty[r.key] = 4;
                  }
                  setEdits({ ...myEdits, qty });
                }}
                style={miniBtnStyle}
                title="Setzt alle ausgewählten Nicht-Basics auf 4 Kopien"
              >
                Alle → 4×
              </button>
              <span style={{ marginLeft: 'auto' }}>
                Gesamt:{' '}
                <strong style={{ color: 'var(--color-accent)', fontVariantNumeric: 'tabular-nums' }}>
                  ≈ {formatEur(totalEur)}
                </strong>
              </span>
            </div>

            <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
              {rows.length === 0 ? (
                <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  Keine Karten zum Kaufen — diese Auswahl ist schon vollständig in deiner Sammlung.
                </div>
              ) : rows.map(r => {
                const checked = isIncluded(r);
                const q = qtyOf(r);
                const eur = getCardPriceEur(r.card);
                const line = eur != null ? eur * q : null;
                const cardIsBasic = isBasicLand(r.card);
                // Playset toggle: shows current state + delta cost if
                // the user clicks "→ 4". A second click reverts to the
                // original suggester quantity. Basics hide the button
                // (4-of basics in a Cardmarket cart makes no sense).
                const isPlayset = q >= 4;
                const playsetDelta = eur != null && !isPlayset && q < 4
                  ? eur * (4 - q)
                  : null;
                return (
                  <label
                    key={r.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      padding: '6px 10px',
                      borderBottom: '1px solid var(--color-border)',
                      background: checked ? 'transparent' : 'var(--color-bg-sunken)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setIncluded(r, e.target.checked)}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontWeight: 'var(--fw-medium)',
                        fontSize: 'var(--fs-sm)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}>
                        {r.card?.name || r.cardId}
                        {r.card?._isToken && (
                          <span
                            title="Automatisch aus Oracle-Text erkannt"
                            style={{
                              fontSize: 9,
                              fontWeight: 'var(--fw-bold)',
                              letterSpacing: 0.5,
                              padding: '1px 6px',
                              borderRadius: 999,
                              background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
                              color: 'var(--color-accent)',
                              border: '1px solid var(--color-accent)',
                              textTransform: 'uppercase',
                            }}
                          >
                            Token
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
                        {r.reason}
                        {r.printing && <> · Artwork: {printingLabel(r.printing)}</>}
                        {eur != null && (
                          <> · {formatEur(eur)}/Stück</>
                        )}
                      </div>
                    </div>
                    {!cardIsBasic && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          // Toggle between current suggester quantity and 4.
                          setQtyFor(r, q >= 4 ? r.qty : 4);
                        }}
                        style={{
                          ...playsetBtnStyle,
                          background: isPlayset ? 'var(--color-accent)' : 'transparent',
                          color: isPlayset ? 'var(--color-accent-contrast)' : 'var(--color-text-muted)',
                          borderColor: isPlayset ? 'var(--color-accent)' : 'var(--color-border)',
                        }}
                        title={
                          isPlayset
                            ? `Volles Playset — auf ${r.qty} zurücksetzen`
                            : playsetDelta != null
                              ? `Auf 4 erhöhen (+${formatEur(playsetDelta)})`
                              : 'Auf 4 erhöhen'
                        }
                      >
                        4×{playsetDelta != null && (
                          <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.85 }}>
                            +{formatEur(playsetDelta)}
                          </span>
                        )}
                      </button>
                    )}
                    <input
                      type="number"
                      min={0}
                      value={q}
                      onChange={(e) => setQtyFor(r, Math.max(0, Number(e.target.value) || 0))}
                      style={qtyInputStyle}
                      onClick={(e) => e.preventDefault()}
                    />
                    <span style={{
                      minWidth: 70,
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 'var(--fs-sm)',
                      color: 'var(--color-text-muted)',
                    }}>
                      {line != null ? formatEur(line) : '—'}
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {generated != null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
              Format ist „<code>&lt;Anzahl&gt; &lt;Kartenname&gt;</code>" pro Zeile, bei gewähltem
              Artwork mit Version und Edition dahinter — auf Cardmarket unter <em>Wants → Massenimport</em> einfügen.
              Du kannst die Liste hier vor dem Kopieren noch ändern.
            </div>
            {generated.fallbacks > 0 && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-warning)' }}>
                {generated.fallbacks === 1 ? '1 Zeile' : `${generated.fallbacks} Zeilen`} ohne genaue
                Cardmarket-Zuordnung — dort steht der Editionsname von Scryfall. Cardmarket meldet nach
                dem Import, falls es eine Zeile nicht findet.
              </div>
            )}
            {generated.tokenFallbacks > 0 && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
                {generated.tokenFallbacks === 1 ? '1 Token' : `${generated.tokenFallbacks} Tokens`} ohne sichere
                Zuordnung — findet der Massenimport sie nicht, öffne sie unten direkt auf Cardmarket.
              </div>
            )}
            <textarea
              value={generated.text}
              onChange={(e) => setOutput({ ...generated, text: e.target.value })}
              rows={Math.min(20, generated.text.split('\n').length + 1)}
              style={{
                width: '100%',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-sm)',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2)',
                resize: 'vertical',
                whiteSpace: 'pre',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Button size="sm" onClick={() => copyText(generated.text)}>
                {copied ? '✓ Kopiert' : 'In Zwischenablage'}
              </Button>
              <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
                Gesamt: <strong style={{ color: 'var(--color-accent)' }}>≈ {formatEur(totalEur)}</strong>
              </span>
            </div>
            {generated.tokenLinks?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1, 4px)' }}>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
                  Tokens direkt auf Cardmarket öffnen:
                </div>
                <div style={tokenLinkListStyle}>
                  {generated.tokenLinks.map(t => (
                    <a
                      key={t.url}
                      href={t.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => openExternal(e, t.url)}
                      style={tokenLinkStyle}
                    >
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.qty}× {t.name}
                      </span>
                      <span style={{ flexShrink: 0, color: 'var(--color-accent)', fontWeight: 'var(--fw-semibold)' }}>
                        Cardmarket ↗
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// Cardmarket product search for one name — the reliable manual way to add
// a token the wants import doesn't recognise.
function cardmarketSearchUrl(name) {
  return `https://www.cardmarket.com/de/Magic/Products/Search?searchString=${encodeURIComponent(name)}`;
}

// In the desktop app a plain link would open inside the app window — hand
// it to the system browser instead.
function openExternal(event, url) {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) return;
  event.preventDefault();
  import('@tauri-apps/plugin-opener')
    .then(({ openUrl }) => openUrl(url))
    .catch(() => { try { window.open(url, '_blank'); } catch { /* ignore */ } });
}

function SourceControls({
  source, setSource,
  deckId, setDeckId,
  decks,
  allowDups, setAllowDups,
  includeIdeas, setIncludeIdeas,
  includeTokens, setIncludeTokens,
  useArtworks, setUseArtworks,
  hasPreselected,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <RadioPill name="source" value="everything" current={source} onChange={setSource}>
          Alle Wünsche
        </RadioPill>
        <RadioPill name="source" value="current_deck" current={source} onChange={setSource}>
          Fehlend für ein Deck
        </RadioPill>
        {hasPreselected && (
          <RadioPill name="source" value="selected" current={source} onChange={setSource}>
            Nur ausgewählte
          </RadioPill>
        )}
      </div>
      {source === 'current_deck' && (
        <select
          value={deckId}
          onChange={(e) => setDeckId(e.target.value)}
          style={selectStyle}
        >
          {(decks || []).length === 0
            ? <option value="">Keine Decks vorhanden</option>
            : (decks.map(d => (
              <option key={d.id} value={d.id}>
                {d.name || 'Unbenanntes Deck'}{d.format ? ` · ${d.format}` : ''}
              </option>
            )))}
        </select>
      )}
      <label style={checkboxLabelStyle}>
        <input
          type="checkbox"
          checked={allowDups}
          onChange={(e) => setAllowDups(e.target.checked)}
        />
        Duplikate kaufen — auch Karten, die ich schon (in einem anderen Deck) habe
      </label>
      <label style={checkboxLabelStyle}>
        <input
          type="checkbox"
          checked={!!includeIdeas}
          onChange={(e) => setIncludeIdeas?.(e.target.checked)}
        />
        Ideen einbeziehen — Karten aus dem Ideen-Pool des Decks mit in die Liste
      </label>
      <label style={checkboxLabelStyle}>
        <input
          type="checkbox"
          checked={!!includeTokens}
          onChange={(e) => setIncludeTokens?.(e.target.checked)}
        />
        Tokens einbeziehen — automatisch alle Tokens hinzufügen, die meine Karten erzeugen
      </label>
      <label style={checkboxLabelStyle}>
        <input
          type="checkbox"
          checked={!!useArtworks}
          onChange={(e) => setUseArtworks?.(e.target.checked)}
        />
        Gewählte Artworks übernehmen — genau diese Ausgabe auf Cardmarket bestellen
      </label>
    </div>
  );
}

function RadioPill({ name, value, current, onChange, children }) {
  const active = current === value;
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 999,
        background: active ? 'var(--color-accent)' : 'transparent',
        color: active ? 'var(--color-accent-contrast)' : 'var(--color-text-muted)',
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
        cursor: 'pointer',
        fontSize: 'var(--fs-sm)',
        fontWeight: active ? 'var(--fw-semibold)' : 'var(--fw-medium)',
      }}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={active}
        onChange={() => onChange(value)}
        style={{ display: 'none' }}
      />
      {children}
    </label>
  );
}

/**
 * Build the candidate row list for the preview. Each candidate has:
 *   { key, cardId, card, printing, qty, reason }
 * `key` is unique per row — one card can appear once per chosen artwork.
 */
function buildCandidates({
  source, deckId, allowDups, decks, ownedIndex, preselectedRows,
  includeIdeas = true, includeTokens = true, useArtworks = true, tokenCards = null,
}) {
  // Aggregate "needed by source" per card, split by chosen artwork.
  const need = new Map();   // cardId → { card, count, sources: [deckName], parts }
  const bump = (cardId, card, n, src, printing) => {
    if (!cardId || n <= 0) return;
    const row = need.get(cardId) || { card, count: 0, sources: [], parts: [] };
    row.count += n;
    if (!row.card) row.card = card;
    if (src && !row.sources.includes(src)) row.sources.push(src);
    const part = row.parts.find(p => (p.printing?.id || null) === (printing?.id || null));
    if (part) part.count += n;
    else row.parts.push({ printing: printing || null, count: n });
    need.set(cardId, row);
  };

  const considerDeck = (d) => {
    const data = d.data || {};
    const printings = useArtworks ? (data.printings || {}) : {};
    for (const [id, entry] of Object.entries(data.mainboard || {})) {
      bump(id, entry?.card, entry?.count || 0, d.name, printings[id]);
    }
    for (const [id, entry] of Object.entries(data.sideboard || {})) {
      bump(id, entry?.card, entry?.count || 0, d.name, printings[id]);
    }
    // Ideas pool: cards the user is considering. They go into the
    // wishlist / Cardmarket list with the "(Ideen)" tag so it's clear
    // why they're in the shopping cart. Skipped when the user
    // unchecks the "Ideen einbeziehen" checkbox.
    if (includeIdeas) {
      for (const [id, entry] of Object.entries(data.ideas || {})) {
        bump(id, entry?.card, entry?.count || 0, `${d.name} (Ideen)`, printings[id]);
      }
    }
    if (data.commander?.id) {
      bump(data.commander.id, data.commander, 1, d.name, printings[data.commander.id]);
    }
  };

  if (source === 'current_deck') {
    const d = (decks || []).find(x => x.id === deckId);
    if (d) considerDeck(d);
  } else {
    for (const d of (decks || [])) considerDeck(d);
  }

  // Convert to the candidate shape, applying the duplicates toggle.
  const candidates = [];
  for (const [cardId, row] of need) {
    if (preselectedRows && source === 'selected' && !preselectedRows.has(cardId)) continue;
    // allowDups → buy the FULL needed amount regardless of the collection.
    // Otherwise subtract owned copies (cross-deck swap is fine).
    const parts = allowDups
      ? row.parts
      : allocateOwnedCopies(row.parts, ownedCopiesOf(ownedIndex, cardId, row.card?.name));
    for (const part of parts) {
      if (part.count <= 0) continue;
      candidates.push({
        key: part.printing ? `${cardId}@${part.printing.id}` : cardId,
        cardId,
        card: applyPrinting(row.card, part.printing),
        printing: part.printing,
        qty: part.count,
        reason: row.sources.length > 0
          ? `Für: ${row.sources.join(', ')}`
          : 'Manueller Eintrag',
      });
    }
  }
  candidates.sort((a, b) =>
    (a.card?.name || a.cardId).localeCompare(b.card?.name || b.cardId)
    || (a.printing?.set_name || '').localeCompare(b.printing?.set_name || ''));

  // ── Tokens via Scryfall's all_parts ───────────────────────
  // Every card that creates a token links the token printing in its
  // `all_parts` (see services/deckTokens.js). Identical tokens from
  // different cards merge (oracle id, once the token cards are loaded);
  // each deck contributes the count set in its Tokens tab (default 1,
  // 0 = don't buy). Rows go at the END so they read as an addendum.
  if (includeTokens) {
    const tokens = new Map();  // key → { key, card, qty, sources: Set }
    const include = source === 'selected' && preselectedRows
      ? (id) => preselectedRows.has(id)
      : null;
    const considerTokens = (d) => {
      const data = d.data || {};
      const zones = includeIdeas
        ? [data.mainboard, data.sideboard, data.ideas]
        : [data.mainboard, data.sideboard];
      const perDeck = new Map();
      for (const [id, ref] of collectTokenRefs(zones, data.commander, include)) {
        const full = tokenCards?.get(id);
        const key = tokenKeyOf(full, id);
        let row = perDeck.get(key);
        if (!row) {
          perDeck.set(key, (row = {
            card: full
              ? { ...full, _isToken: true }
              // Not loaded (yet): what all_parts knows. No price → "—".
              : { id, name: ref.name, type_line: ref.type_line || 'Token', prices: undefined, _isToken: true },
            sources: new Set(),
          }));
        }
        for (const s of ref.sources) row.sources.add(s);
      }
      for (const [key, row] of perDeck) {
        const count = data.tokens?.[key] ?? 1;
        if (count <= 0) continue;
        let t = tokens.get(key);
        if (!t) tokens.set(key, (t = { key, card: row.card, qty: 0, sources: new Set() }));
        t.qty += count;
        for (const s of row.sources) t.sources.add(s);
      }
    };
    if (source === 'current_deck') {
      const d = (decks || []).find(x => x.id === deckId);
      if (d) considerTokens(d);
    } else {
      for (const d of (decks || [])) considerTokens(d);
    }

    // Deduplicate against any token-id that was ALREADY in the
    // candidate list (e.g. user manually wishlisted a token).
    const existingCardIds = new Set(candidates.map(c => c.cardId));
    const tokenRows = [];
    for (const t of tokens.values()) {
      if (existingCardIds.has(t.card.id)) continue;
      const sources = [...t.sources];
      tokenRows.push({
        key: `token:${t.key}`,
        cardId: t.card.id,
        printing: null,
        card: t.card,
        qty: t.qty,
        reason: `Token aus: ${sources.slice(0, 3).join(', ')}${sources.length > 3 ? ` …+${sources.length - 3}` : ''}`,
      });
    }
    tokenRows.sort((a, b) => a.card.name.localeCompare(b.card.name));
    candidates.push(...tokenRows);
  }

  return candidates;
}

const summaryStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 'var(--space-2) var(--space-3)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
};
const checkboxLabelStyle = {
  display: 'flex', alignItems: 'center', gap: 6,
  fontSize: 'var(--fs-sm)', color: 'var(--color-text)',
};
const selectStyle = {
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '6px 10px',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  alignSelf: 'flex-start',
  minWidth: 200,
};
const qtyInputStyle = {
  width: 60,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '4px 6px',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  textAlign: 'center',
};
const playsetBtnStyle = {
  border: '1px solid',
  borderRadius: 'var(--radius-md)',
  padding: '3px 8px',
  fontSize: 'var(--fs-xs)',
  fontWeight: 'var(--fw-semibold)',
  fontFamily: 'inherit',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
const tokenLinkListStyle = {
  display: 'flex',
  flexDirection: 'column',
  maxHeight: 220,
  overflowY: 'auto',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
};
const tokenLinkStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-2)',
  minHeight: 40,
  padding: '6px 10px',
  borderBottom: '1px solid var(--color-border)',
  color: 'var(--color-text)',
  fontSize: 'var(--fs-sm)',
  textDecoration: 'none',
};
const miniBtnStyle = {
  padding: '3px 8px',
  fontSize: 'var(--fs-xs)',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
