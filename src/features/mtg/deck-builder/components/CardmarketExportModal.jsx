// src/features/mtg/deck-builder/components/CardmarketExportModal.jsx
//
// Generates a Cardmarket-Wants-compatible decklist from the user's MTG
// wishlist with three source modes and a preview/edit step. The output
// format is the canonical MTG decklist line — `<count> <Cardname>` per
// line — which Cardmarket "Wants → Massenimport" accepts directly.
//
// Source modes
//   - "current_deck"  → buy what's missing for one specific deck
//   - "everything"    → the full wishlist across all decks
//   - "selected"      → only the rows the user ticked beforehand
//
// Duplicates toggle
//   - OFF (default)   → subtract inventory: if I already own a copy
//                       somewhere else, I won't buy it again (I'll just
//                       swap between decks)
//   - ON              → don't subtract inventory at all (or subtract
//                       only what's unallocated) — buy fresh duplicates
//
// Preview lets the user tweak per-row quantities and tick off entries
// before generating the final text. The shopping list's total Cardmarket
// price is shown live so they know what the trip will cost.

import { useEffect, useMemo, useState } from 'react';
import { Modal, Button } from '../../../../shared/ui';
import { getCardPriceEur, formatEur } from '../services/scryfall';

export default function CardmarketExportModal({
  open,
  onClose,
  decks,             // [{ id, name, data }]
  inventory,         // Map<cardId, qty>
  initialSource = 'everything',
  initialDeckId,
  preselectedRows,   // optional Set<cardId> — when opened from "selected mode"
}) {
  const [source, setSource]       = useState(initialSource);
  const [deckId, setDeckId]       = useState(initialDeckId || '');
  const [allowDups, setAllowDups] = useState(false);
  const [rows, setRows]           = useState([]);     // editable preview rows
  const [includeMap, setInclude]  = useState({});     // cardId → bool
  const [qtyMap, setQty]          = useState({});     // cardId → number
  const [copied, setCopied]       = useState(false);
  const [generated, setGenerated] = useState(null);

  // Re-initialise when opening / when source-controls change.
  useEffect(() => {
    if (!open) return;
    setSource(initialSource);
    setDeckId(initialDeckId || (decks?.[0]?.id || ''));
    setCopied(false);
    setGenerated(null);
  }, [open, initialSource, initialDeckId, decks]);

  // Build candidate rows from the chosen source + dup-toggle.
  useEffect(() => {
    if (!open) return;
    const candidate = buildCandidates({
      source, deckId, allowDups, decks, inventory, preselectedRows,
    });
    setRows(candidate);
    const inc = {};
    const qty = {};
    for (const r of candidate) {
      inc[r.cardId] = true;
      qty[r.cardId] = r.qty;
    }
    setInclude(inc);
    setQty(qty);
    setGenerated(null);
  }, [open, source, deckId, allowDups, decks, inventory, preselectedRows]);

  const totalEur = useMemo(() => {
    let sum = 0;
    for (const r of rows) {
      if (!includeMap[r.cardId]) continue;
      const q = Number(qtyMap[r.cardId]) || 0;
      const p = getCardPriceEur(r.card);
      if (p != null) sum += p * q;
    }
    return sum;
  }, [rows, includeMap, qtyMap]);

  const includedCount = useMemo(
    () => rows.reduce((s, r) => s + (includeMap[r.cardId] ? (Number(qtyMap[r.cardId]) || 0) : 0), 0),
    [rows, includeMap, qtyMap]
  );

  const handleGenerate = async () => {
    const list = rows
      .filter(r => includeMap[r.cardId] && (Number(qtyMap[r.cardId]) || 0) > 0)
      .sort((a, b) => (a.card?.name || a.cardId).localeCompare(b.card?.name || b.cardId))
      .map(r => `${qtyMap[r.cardId]} ${r.card?.name || r.cardId}`);
    const text = list.join('\n');
    setGenerated(text);
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch { /* clipboard blocked — user can still copy from the textarea */ }
    }
  };

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose}>Schließen</Button>
      {!generated && (
        <Button onClick={handleGenerate} disabled={includedCount === 0}>
          Liste generieren ({includedCount})
        </Button>
      )}
      {generated && (
        <Button onClick={() => { setGenerated(null); }}>
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
              deckId={deckId} setDeckId={setDeckId}
              decks={decks}
              allowDups={allowDups} setAllowDups={setAllowDups}
              hasPreselected={!!preselectedRows?.size}
            />

            <div style={summaryStyle}>
              <span>
                <strong>{includedCount}</strong> {includedCount === 1 ? 'Karte' : 'Karten'} ausgewählt
              </span>
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
                const checked = !!includeMap[r.cardId];
                const q = qtyMap[r.cardId] ?? r.qty;
                const eur = getCardPriceEur(r.card);
                const line = eur != null ? eur * (Number(q) || 0) : null;
                return (
                  <label
                    key={r.cardId}
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
                      onChange={(e) => setInclude(m => ({ ...m, [r.cardId]: e.target.checked }))}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.card?.name || r.cardId}
                      </div>
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
                        {r.reason}
                        {eur != null && (
                          <> · {formatEur(eur)}/Stück</>
                        )}
                      </div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={q}
                      onChange={(e) => setQty(m => ({ ...m, [r.cardId]: Math.max(0, Number(e.target.value) || 0) }))}
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
              Format ist „<code>&lt;Anzahl&gt; &lt;Kartenname&gt;</code>" pro Zeile —
              auf Cardmarket unter <em>Wants → Massenimport</em> einfügen.
            </div>
            <textarea
              value={generated}
              readOnly
              rows={Math.min(20, generated.split('\n').length + 1)}
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
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(generated);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch { /* ignore */ }
                }}
              >
                {copied ? '✓ Kopiert' : 'In Zwischenablage'}
              </Button>
              <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
                Gesamt: <strong style={{ color: 'var(--color-accent)' }}>≈ {formatEur(totalEur)}</strong>
              </span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SourceControls({
  source, setSource,
  deckId, setDeckId,
  decks,
  allowDups, setAllowDups,
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
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', color: 'var(--color-text)' }}>
        <input
          type="checkbox"
          checked={allowDups}
          onChange={(e) => setAllowDups(e.target.checked)}
        />
        Duplikate kaufen — auch Karten, die ich schon (in einem anderen Deck) habe
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
 *   { cardId, card, qty, reason }
 */
function buildCandidates({ source, deckId, allowDups, decks, inventory, preselectedRows }) {
  // Aggregate "needed by source" per card.
  const need = new Map();   // cardId → { card, count, sources: [deckName] }
  const bump = (cardId, card, n, src) => {
    if (!cardId || n <= 0) return;
    const row = need.get(cardId) || { card, count: 0, sources: [] };
    row.count += n;
    if (!row.card) row.card = card;
    if (src && !row.sources.includes(src)) row.sources.push(src);
    need.set(cardId, row);
  };

  const considerDeck = (d) => {
    const data = d.data || {};
    for (const [id, entry] of Object.entries(data.mainboard || {})) {
      bump(id, entry?.card, entry?.count || 0, d.name);
    }
    for (const [id, entry] of Object.entries(data.sideboard || {})) {
      bump(id, entry?.card, entry?.count || 0, d.name);
    }
    if (data.commander?.id) bump(data.commander.id, data.commander, 1, d.name);
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
    let toBuy;
    if (allowDups) {
      // Buy the FULL needed amount regardless of inventory.
      toBuy = row.count;
    } else {
      // Subtract everything currently owned (cross-deck swap is fine).
      const owned = inventory.get?.(cardId) || 0;
      toBuy = Math.max(0, row.count - owned);
    }
    if (toBuy <= 0) continue;
    candidates.push({
      cardId,
      card: row.card,
      qty: toBuy,
      reason: row.sources.length > 0
        ? `Für: ${row.sources.join(', ')}`
        : 'Manueller Eintrag',
    });
  }
  candidates.sort((a, b) => (a.card?.name || a.cardId).localeCompare(b.card?.name || b.cardId));
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
