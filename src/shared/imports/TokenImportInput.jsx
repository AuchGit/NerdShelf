// src/shared/imports/TokenImportInput.jsx
//
// Reusable "Import via token" form. Rendered above each dashboard's
// existing list. Has a single text input + button; the input accepts a
// formatted token like `X3Q9-F4MV-7K2H` or its plain form, normalizes
// both ways, and surfaces lookup results inline before the actual
// import commits.

import { useState } from 'react';
import { Button } from '../ui';
import { lookupShareToken } from './useImports';
import { formatToken } from '../tokens/shareToken';

const DOMAIN_LABEL = {
  mtg_deck:      'MTG-Decks',
  wh40k_army:    'WH40K-Armeen',
  dnd_character: 'DnD-Charaktere',
};

export default function TokenImportInput({ domain, onImport, busy = false }) {
  const [raw, setRaw] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const reset = () => {
    setRaw('');
    setPreview(null);
    setError(null);
  };

  const cleaned = raw.replace(/[^0-9A-Z]/gi, '').toUpperCase();
  const valid = cleaned.length === 12;

  async function handleLookup() {
    if (!valid) return;
    setPreviewing(true);
    setError(null);
    setSuccess(null);
    try {
      const lookup = await lookupShareToken(cleaned);
      if (!lookup) {
        setPreview(null);
        setError('Kein Eintrag zu diesem Token gefunden.');
      } else {
        setPreview(lookup);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    if (!preview) return;
    setError(null);
    try {
      await onImport(cleaned);
      setSuccess(`„${preview.entityName}" importiert.`);
      setTimeout(() => setSuccess(null), 2500);
      reset();
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  return (
    <div
      data-pwa-target="token-import"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: 'var(--space-3)',
        background: 'var(--color-bg-elevated)',
        border: '1px dashed var(--color-border)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
          ⌗ Import per Token
        </span>
        <input
          type="text"
          value={raw}
          onChange={(e) => { setRaw(e.target.value); setPreview(null); setError(null); }}
          onBlur={() => { if (valid && !preview && !previewing) handleLookup(); }}
          placeholder="X3Q9-F4MV-7K2H"
          spellCheck={false}
          autoCapitalize="characters"
          autoCorrect="off"
          style={{
            flex: 1,
            minWidth: 160,
            fontFamily: 'var(--font-mono)',
            letterSpacing: 0.5,
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 10px',
            fontSize: 'var(--fs-sm)',
            textTransform: 'uppercase',
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={handleLookup}
          disabled={!valid || previewing || busy}
        >
          {previewing ? 'Prüfe…' : 'Prüfen'}
        </Button>
        {preview && (
          <Button size="sm" onClick={handleImport} disabled={busy}>
            + In Dashboard
          </Button>
        )}
      </div>

      {preview && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-2)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-accent)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--fs-sm)',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontWeight: 'var(--fw-semibold)' }}>{preview.entityName || '(unbenannt)'}</span>
          <span style={{ color: 'var(--color-text-muted)' }}>·</span>
          <span style={{ color: 'var(--color-text-muted)' }}>
            {DOMAIN_LABEL[preview.domain] || preview.domain}
          </span>
          {preview.ownerName && (
            <>
              <span style={{ color: 'var(--color-text-muted)' }}>·</span>
              <span style={{ color: 'var(--color-text-muted)' }}>
                von <strong style={{ color: 'var(--color-text)' }}>{preview.ownerName}</strong>
              </span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <code style={{
            background: 'transparent',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--fs-xs)',
            fontFamily: 'var(--font-mono)',
          }}>
            {formatToken(cleaned)}
          </code>
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--color-danger)', fontSize: 'var(--fs-sm)' }}>
          ⚠ {error}
        </div>
      )}
      {success && (
        <div style={{ color: 'var(--color-success)', fontSize: 'var(--fs-sm)' }}>
          ✓ {success}
        </div>
      )}
    </div>
  );
}
