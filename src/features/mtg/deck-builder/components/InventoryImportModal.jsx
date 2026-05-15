// src/features/mtg/deck-builder/components/InventoryImportModal.jsx
//
// Paste a plaintext decklist / collection list into the inventory.
// Format (one line per entry):
//
//   4 Lightning Bolt
//   2x Counterspell
//   1 Sol Ring (CMR)
//   Wrath of God          // missing count == 1
//
// Lines starting with '#' or '//' are ignored. Quantities default to 1.
// Lookup uses Scryfall's bulk named-identifier endpoint so set-codes are
// honoured but optional.
//
// Reconciliation: a card already in inventory has the imported quantity
// ADDED to it (merge semantics) rather than overwritten. Pure-add keeps
// the action idempotent for the common "I bought N more of X" workflow;
// a "replace" mode is offered behind a checkbox.

import { useMemo, useState } from 'react';
import { Modal, Button } from '../../../../shared/ui';
import { useMtgInventory } from '../hooks/useMtgInventory';
import { fetchCardsByNames } from '../services/scryfallCollection';

const LINE_RE = /^\s*(\d+)\s*x?\s+(.+?)(?:\s*\(([A-Za-z0-9]{2,5})\))?\s*$/;

function parseDecklist(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const m = line.match(LINE_RE);
    if (m) {
      entries.push({ quantity: parseInt(m[1], 10) || 1, name: m[2].trim(), set: m[3] || null });
    } else if (line.length > 0 && /^[A-Za-z]/.test(line)) {
      entries.push({ quantity: 1, name: line, set: null });
    }
  }
  return entries;
}

export default function InventoryImportModal({ open, onClose, onImported }) {
  const inv = useMtgInventory();
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [result, setResult] = useState(null); // {matched, missing}

  const preview = useMemo(() => parseDecklist(text), [text]);

  async function handleResolve() {
    if (preview.length === 0) return;
    setResolving(true);
    setResult(null);
    try {
      const resolved = await fetchCardsByNames(preview);
      const matched = resolved.filter(r => r.card);
      const missing = resolved.filter(r => !r.card);
      setResult({ matched, missing });
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setResolving(false);
    }
  }

  async function handleApply() {
    if (!result?.matched?.length) return;
    for (const r of result.matched) {
      if (replace) {
        await inv.setQuantity(r.card.id, r.quantity, r.card.name);
      } else {
        await inv.adjustQuantity(r.card.id, r.quantity, r.card.name);
      }
    }
    setText('');
    setResult(null);
    onImported?.();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Decklist / Sammlung importieren"
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          {!result && (
            <Button onClick={handleResolve} disabled={preview.length === 0 || resolving}>
              {resolving ? 'Suche…' : `${preview.length} Zeilen prüfen`}
            </Button>
          )}
          {result?.matched && (
            <Button onClick={handleApply} disabled={result.matched.length === 0}>
              {replace ? 'Ersetzen' : 'Hinzufügen'} ({result.matched.length})
            </Button>
          )}
        </>
      }
    >
      <p style={{ marginTop: 0, color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
        Eine Karte pro Zeile. Mengen werden zu vorhandenen Karten addiert (oder ersetzt, falls aktiviert).
      </p>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setResult(null); }}
        rows={12}
        spellCheck={false}
        placeholder={`4 Lightning Bolt\n2x Counterspell\n1 Sol Ring (CMR)`}
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
        }}
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'var(--space-2)', fontSize: 'var(--fs-sm)' }}>
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
        Vorhandene Mengen ersetzen statt addieren
      </label>

      {result?.error && (
        <div style={{ marginTop: 'var(--space-3)', color: 'var(--color-danger)' }}>
          Fehler bei Scryfall-Lookup: {result.error}
        </div>
      )}
      {result?.matched && (
        <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-sm)' }}>
          <div style={{ color: 'var(--color-success)' }}>
            ✓ {result.matched.length} Karten gefunden
          </div>
          {result.missing.length > 0 && (
            <details style={{ marginTop: 'var(--space-2)' }}>
              <summary style={{ color: 'var(--color-warning)', cursor: 'pointer' }}>
                ⚠ {result.missing.length} nicht gefunden
              </summary>
              <ul style={{ margin: '6px 0 0 16px', color: 'var(--color-text-muted)' }}>
                {result.missing.slice(0, 20).map((m, i) => (
                  <li key={i}>{m.quantity}× {m.name}{m.set ? ` (${m.set})` : ''}</li>
                ))}
                {result.missing.length > 20 && <li>… +{result.missing.length - 20} weitere</li>}
              </ul>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}
