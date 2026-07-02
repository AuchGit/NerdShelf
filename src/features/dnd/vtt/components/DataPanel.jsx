// "Data" sidebar (DM). Three tabs: Monster (drop as a token — existing
// MonsterPanel), Items and Spells (search the bundled 5etools data and GIVE a
// chosen entry to a player's character). Giving writes an additive inventory
// entry via applyOwnCharacter — non-destructive; persists + syncs.
import { useEffect, useMemo, useState } from 'react';
import { useVtt } from '../state/useVtt';
import { applyOwnCharacter } from '../sync/characterBinding';
import { loadItemIndex, loadSpellList } from '../../character-builder/lib/dataLoader';
import { applyImport, parseFiveEUrl, lookupEntry, lookupEntryLive } from '../../character-builder/lib/fiveeImporter';
import MonsterPanel from './MonsterPanel';

export default function DataPanel({ edition = '5e' }) {
  const [tab, setTab] = useState('monster');
  return (
    <>
      <div style={S.tabs}>
        {[['monster', '🐉 Monster'], ['items', '🎒 Items'], ['spells', '✨ Spells']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ ...S.tab, ...(tab === id ? S.tabOn : null) }}>{label}</button>
        ))}
      </div>
      {tab === 'monster' && <MonsterPanel edition={edition} />}
      {tab === 'items' && <GiveBrowser edition={edition} kind="items" />}
      {tab === 'spells' && <GiveBrowser edition={edition} kind="spells" />}
    </>
  );
}

// Shared search-and-give browser for items & spells.
function GiveBrowser({ edition, kind }) {
  const members = useVtt((s) => (s.ui.campaignMembers || []).filter((m) => m.characterId != null));
  const chars = useVtt((s) => s.ui.characters || {});
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('');
  const [msg, setMsg] = useState(null);
  const singular = kind === 'items' ? 'item' : 'spell';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = kind === 'items' ? await loadItemIndex(edition) : await loadSpellList(edition);
        if (!cancelled) setList(Array.isArray(data) ? data : (data?.item || data?.spell || []));
      } catch (e) { if (!cancelled) setErr(e.message || String(e)); }
    })();
    return () => { cancelled = true; };
  }, [edition, kind]);

  // Default the give-target to the first available member.
  const targetId = target || members[0]?.characterId || '';

  const results = useMemo(() => {
    if (!list) return [];
    const needle = q.trim().toLowerCase();
    const base = needle ? list.filter((x) => x.name?.toLowerCase().includes(needle)) : list;
    return base.slice(0, 60);
  }, [list, q]);

  const targetCharId = () => {
    if (targetId == null || targetId === '') return null;
    return typeof targetId === 'string' ? (Number(targetId) || targetId) : targetId;
  };
  const whoName = (charId) => chars[charId]?.data?.info?.name
    || members.find((m) => String(m.characterId) === String(charId))?.name || 'Spieler';

  // Grant a spell/item to the chosen player FOR REAL — reuses the importer's
  // apply (spell → character.custom.spells = known/castable; item →
  // custom.items). Idempotent (dedupe by name+source).
  const give = (entry, foundEdition = edition, crossEdition = false) => {
    const charId = targetCharId();
    if (charId == null) { setMsg({ text: 'Kein Spieler ausgewählt.', tone: 'err' }); return; }
    const res = applyImport((mut) => applyOwnCharacter(charId, mut),
      { type: singular, entry, source: entry.source, foundEdition, crossEdition });
    if (res?.ok) setMsg({ text: `✓ „${entry.name}" an ${whoName(charId)}`, tone: 'ok' });
    else if (res?.reason === 'duplicate') setMsg({ text: `„${entry.name}" hat ${whoName(charId)} schon.`, tone: 'muted' });
    else setMsg({ text: `Konnte „${entry.name}" nicht geben (${res?.reason || 'Fehler'}).`, tone: 'err' });
  };

  // Import a single entry straight from a 5e.tools URL, then give it.
  const importFromUrl = async () => {
    if (targetCharId() == null) { setMsg({ text: 'Erst einen Spieler wählen.', tone: 'err' }); return; }
    const parsed = parseFiveEUrl(url);
    if (!parsed || parsed.type !== singular) { setMsg({ text: `Keine gültige 5e.tools-${singular}-URL.`, tone: 'err' }); return; }
    setBusy(true); setMsg({ text: 'Suche…', tone: 'muted' });
    try {
      let r = await lookupEntry({ ...parsed, currentEdition: edition });
      if (!r.found) r = await lookupEntryLive({ ...parsed, currentEdition: edition });
      if (!r.found) { setMsg({ text: 'Nicht gefunden.', tone: 'err' }); return; }
      give(r.entry, r.foundEdition, r.crossEdition);
      setUrl('');
    } catch (e) { setMsg({ text: e.message || String(e), tone: 'err' }); }
    finally { setBusy(false); }
  };

  const msgColor = msg?.tone === 'err' ? 'var(--color-danger)' : msg?.tone === 'muted' ? 'var(--color-text-muted)' : 'var(--color-accent)';
  return (
    <>
      {members.length === 0
        ? <div style={S.muted}>Keine Spieler-Charaktere in der Campaign.</div>
        : (
          <label style={{ display: 'block', marginBottom: 6 }}>
            <span style={S.lbl}>An Spieler geben:</span>
            <select value={targetId} onChange={(e) => setTarget(e.target.value)} style={S.search}>
              {members.map((m) => <option key={m.characterId} value={m.characterId}>{m.name || `Charakter ${m.characterId}`}</option>)}
            </select>
          </label>
        )}
      {/* Import a single entry directly from a 5e.tools URL, then give it. */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') importFromUrl(); }}
          placeholder={`5e.tools-${singular}-URL…`} style={{ ...S.search, flex: 1 }} />
        <button onClick={importFromUrl} disabled={busy || !url.trim()} style={S.importBtn} title="Von 5e.tools importieren & geben">↓</button>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} disabled={!list}
        placeholder={list ? (kind === 'items' ? 'Item suchen…' : 'Spell suchen…') : 'Lädt…'} style={S.search} />
      {err && <div style={S.err}>⚠ {err}</div>}
      {msg && <div style={{ fontSize: 'var(--fs-sm)', color: msgColor, margin: '6px 0' }}>{msg.text}</div>}
      <div style={S.list}>
        {results.map((x, i) => (
          <div key={`${x.name}__${x.source}__${i}`} style={S.row} title={`„${x.name}" geben`} onClick={() => give(x)}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
            {kind === 'spells' && x.level != null && <span style={S.meta}>L{x.level}</span>}
            {kind === 'items' && x.type && <span style={S.meta}>{String(x.type).split('|')[0]}</span>}
            <span style={S.add}>＋</span>
          </div>
        ))}
        {list && results.length === 0 && <div style={S.muted}>Keine Treffer.</div>}
      </div>
    </>
  );
}

const S = {
  tabs: { display: 'flex', gap: 4, marginBottom: 8 },
  tab: { flex: 1, padding: '5px 6px', fontSize: 11, fontWeight: 600, background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' },
  tabOn: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: '1px solid var(--color-accent)' },
  search: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)' },
  lbl: { display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 3 },
  list: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8, maxHeight: 260, overflowY: 'auto' },
  row: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  meta: { color: 'var(--color-text-muted)', fontSize: 11, flexShrink: 0 },
  add: { color: 'var(--color-accent)', fontWeight: 700, flexShrink: 0 },
  importBtn: { flexShrink: 0, padding: '0 10px', background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700 },
  muted: { color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', padding: '4px 6px' },
  err: { color: 'var(--color-danger)', fontSize: 'var(--fs-sm)', marginTop: 6 },
};
