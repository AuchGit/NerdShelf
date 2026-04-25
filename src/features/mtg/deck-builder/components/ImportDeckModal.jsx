// src/features/mtg/deck-builder/components/ImportDeckModal.jsx
import { useState } from 'react';
import { Modal, Button } from '../../../../shared/ui';
import { parseDecklistText, resolveCardNames, buildDeckFromParsed } from '../services/deckImport';

const EXAMPLE = `// Example:
4 Lightning Bolt
4 Counterspell
20 Island

Sideboard
2 Negate
1 Pyroblast`;

export default function ImportDeckModal({ open, onClose, onImport }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [notFound, setNotFound] = useState([]);

  async function handleImport() {
    if (!text.trim()) return;
    setBusy(true);
    setResult(null);
    setNotFound([]);

    const parsed = parseDecklistText(text);
    const allNames = [...parsed.main.map(e => e.name), ...parsed.side.map(e => e.name)];
    if (allNames.length === 0) {
      setBusy(false);
      setResult({ type: 'error', text: 'Keine Kartenzeilen erkannt.' });
      return;
    }

    const resolved = await resolveCardNames(allNames);
    const deck = buildDeckFromParsed(parsed, resolved);
    setBusy(false);

    const mainCount = Object.values(deck.mainboard).reduce((s, e) => s + e.count, 0);
    const sideCount = Object.values(deck.sideboard).reduce((s, e) => s + e.count, 0);

    if (mainCount + sideCount === 0) {
      setResult({ type: 'error', text: 'Keine Karten gefunden. Scryfall konnte keine Namen auflösen.' });
      setNotFound(deck.notFound);
      return;
    }

    setNotFound(deck.notFound);
    setResult({
      type: 'success',
      text: `${mainCount} Karten im Main, ${sideCount} im Sideboard.`,
      deck,
    });
  }

  function handleApply() {
    if (!result?.deck) return;
    onImport(result.deck);
    setText('');
    setResult(null);
    setNotFound([]);
    onClose?.();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Decklist importieren"
      width={600}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          {result?.type === 'success' ? (
            <Button onClick={handleApply}>Übernehmen</Button>
          ) : (
            <Button onClick={handleImport} disabled={busy || !text.trim()}>
              {busy ? 'Lade von Scryfall…' : 'Parsen'}
            </Button>
          )}
        </>
      }
    >
      <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--space-3)' }}>
        Füge eine Decklist im Standard-MTG-Format ein. Kommentare mit <code>//</code> oder <code>#</code>.
        Sideboard nach einer Zeile <code>Sideboard</code>.
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={EXAMPLE}
        rows={14}
        style={{
          width: '100%',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-sm)',
          padding: 'var(--space-3)',
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          resize: 'vertical',
        }}
      />

      {result && (
        <div style={{
          marginTop: 'var(--space-3)',
          padding: 'var(--space-3)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-bg-sunken)',
          fontSize: 'var(--fs-sm)',
          color: result.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)',
        }}>
          {result.text}
        </div>
      )}

      {notFound.length > 0 && (
        <details style={{ marginTop: 'var(--space-3)' }}>
          <summary style={{ color: 'var(--color-warning)', fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>
            {notFound.length} Karten konnten nicht aufgelöst werden
          </summary>
          <div style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--fs-xs)',
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
            maxHeight: 150,
            overflow: 'auto',
          }}>
            {notFound.map((n, i) => <div key={i}>{n}</div>)}
          </div>
        </details>
      )}
    </Modal>
  );
}
