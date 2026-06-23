// Bestiary roster (DM only). Searches the edition's monsters.json (the same
// bundled 5etools data the character builder uses) and drops a chosen creature
// onto the map as an NPC token — name / HP / footprint straight from the
// statblock. Spawns at map center; the DM then drags it into place.
import { useEffect, useMemo, useState } from 'react';
import { useActiveMap } from '../state/useVtt';
import { createTokenFromStatblock } from '../state/actions';
import { loadCreatureList } from '../../character-builder/lib/dataLoader';
import { parseFiveEUrl, lookupEntry, lookupEntryLive } from '../../character-builder/lib/fiveeImporter';

export default function MonsterPanel({ edition = '5e' }) {
  const map = useActiveMap();
  const [list, setList] = useState(null); // null = not loaded yet
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [url, setUrl] = useState('');
  const [importMsg, setImportMsg] = useState(null); // { text, tone }
  const [importing, setImporting] = useState(false);

  // Lazy-load the bestiary once the panel mounts (it's a sizeable JSON).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const creatures = await loadCreatureList(edition);
        if (!cancelled) setList(creatures);
      } catch (e) {
        if (!cancelled) setErr(e.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [edition]);

  const results = useMemo(() => {
    if (!list) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list.slice(0, 50);
    return list.filter((m) => m.name.toLowerCase().includes(needle)).slice(0, 50);
  }, [list, q]);

  // Import a single creature from a pasted 5e.tools bestiary URL (local mirror
  // first, then a live fetch from 5e.tools), then drop it as an NPC token.
  async function importFromUrl() {
    const parsed = parseFiveEUrl(url);
    if (!parsed || parsed.type !== 'monster') {
      setImportMsg({ text: 'Keine gültige 5e.tools-Bestiary-URL.', tone: 'err' });
      return;
    }
    setImporting(true);
    setImportMsg({ text: 'Suche…', tone: 'muted' });
    try {
      let res = await lookupEntry({ ...parsed, currentEdition: edition });
      if (!res.found) res = await lookupEntryLive({ ...parsed, currentEdition: edition });
      if (!res.found) {
        setImportMsg({ text: 'Kreatur nicht gefunden.', tone: 'err' });
        return;
      }
      createTokenFromStatblock(res.entry);
      setImportMsg({ text: `✓ ${res.entry.name} gesetzt`, tone: 'ok' });
      setUrl('');
    } catch (e) {
      setImportMsg({ text: e.message || String(e), tone: 'err' });
    } finally {
      setImporting(false);
    }
  }

  if (!map) return null;

  const msgColor = importMsg?.tone === 'err' ? 'var(--color-danger)'
    : importMsg?.tone === 'ok' ? 'var(--color-accent)' : 'var(--color-text-muted)';

  return (
    <>
      {/* Import direkt per 5e.tools-Bestiary-URL */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') importFromUrl(); }}
          placeholder="5e.tools-Bestiary-URL…"
          style={{ ...S.search, flex: 1 }}
        />
        <button onClick={importFromUrl} disabled={importing || !url.trim()} style={S.importBtn} title="Von 5e.tools importieren">↓</button>
      </div>
      {importMsg && <div style={{ fontSize: 'var(--fs-sm)', color: msgColor, marginBottom: 6 }}>{importMsg.text}</div>}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={list ? 'Monster suchen…' : 'Lade Bestiary…'}
        disabled={!list}
        style={S.search}
      />
      {err && <div style={S.err}>⚠ {err}</div>}
      <div style={S.list}>
        {results.map((m, i) => (
          <div
            key={`${m.name}__${m.source}__${i}`}
            style={S.row}
            title={`${m.name} — auf die Map setzen`}
            onClick={() => createTokenFromStatblock(m)}
          >
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
            {m.cr != null && <span style={S.meta}>CR {String(m.cr?.cr ?? m.cr)}</span>}
            <span style={S.add}>+</span>
          </div>
        ))}
        {list && results.length === 0 && (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', padding: '4px 6px' }}>
            Keine Treffer.
          </div>
        )}
      </div>
    </>
  );
}

const S = {
  search: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)' },
  importBtn: { flexShrink: 0, padding: '0 10px', background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700 },
  err: { color: 'var(--color-danger)', fontSize: 'var(--fs-sm)', marginTop: 6 },
  list: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8, maxHeight: 260, overflowY: 'auto' },
  row: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  meta: { color: 'var(--color-text-muted)', fontSize: 11, flexShrink: 0 },
  add: { color: 'var(--color-accent)', fontWeight: 700, flexShrink: 0 },
};
