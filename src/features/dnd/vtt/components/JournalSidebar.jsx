// Journal / handouts sidebar.
//   • DM: upload an image (+ title/notes), then "Allen zeigen" pops it as a big
//     overlay for every player (synced); entries stay here for later reference.
//   • Players: browse past handouts and open any one locally ("Ansehen").
import { useState } from 'react';
import { useVtt, useIsDM } from '../state/useVtt';
import { addJournalEntry, removeJournalEntry, presentHandout } from '../state/actions';
import { uploadHandoutImage, uploadMapToRelay, saveMapOriginalLocal } from '../lib/mapStorage';
import { getConnectionMode, getRelayUrl } from '../lib/vttPrefs';
import { renderMarkdown } from '../lib/miniMarkdown';
import { toast } from '../lib/toast';
import { sanitizeHtml } from '../lib/sanitizeHtml';
import RichTextEditor from './RichTextEditor';
import HandoutOverlay from './HandoutOverlay';

export default function JournalSidebar() {
  const isDM = useIsDM();
  const journal = useVtt((s) => s.journal || []);
  const presentedId = useVtt((s) => s.presentedHandout);
  const campaignId = useVtt((s) => s.session.campaignId);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null); // locally-opened entry

  // Import a .md/.txt file → convert markdown to HTML and drop it into the editor.
  const importMd = async (f) => {
    if (!f) return;
    try {
      const txt = await f.text();
      const html = sanitizeHtml(renderMarkdown(txt));
      setBody((b) => (b ? `${b}${html}` : html));
      if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
    } catch (e) { console.warn('[vtt] markdown import failed', e?.message); }
  };

  const add = async () => {
    if (!file && !title.trim()) return;
    setBusy(true);
    try {
      let img = {};
      if (file) {
        img = await uploadHandoutImage(campaignId, file);
        // Keep the full-res original in the relay maps dir so a direct connection
        // serves it uncompressed (built live from the relay address at view time).
        const ext = (file.name.split('.').pop() || 'png').toLowerCase();
        const name = `h_${Math.random().toString(36).slice(2, 10)}.${ext}`;
        img.imageFullName = await saveMapOriginalLocal(name, file);
        if (img.imageFullName && getConnectionMode() === 'relay' && getRelayUrl()) {
          try { await uploadMapToRelay(getRelayUrl(), name, file); } catch (e3) { console.warn('[vtt] relay handout PUT failed', e3?.message); }
        }
      }
      addJournalEntry({ title: title.trim() || file?.name || 'Handout', body: body.trim(), ...img });
      setTitle(''); setBody(''); setFile(null);
    } catch (e) {
      console.error('[vtt] handout upload failed', e);
      toast('Handout-Upload fehlgeschlagen: ' + (e?.message || e));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {isDM && (
        <div style={S.add}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel" style={S.input} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Handout-Text</span>
            <label style={{ ...S.miniBtn, cursor: 'pointer' }} title="Eine Markdown-/Text-Datei importieren">↧ Markdown
              <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" style={{ display: 'none' }}
                onChange={(e) => { importMd(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>
          <RichTextEditor value={body} onChange={setBody} />
          <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Bild (optional):
            <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} style={S.file} />
          </label>
          <button style={S.addBtn} disabled={busy} onClick={add}>{busy ? 'Lädt…' : '+ Eintrag'}</button>
        </div>
      )}

      {journal.length === 0 ? (
        <div style={S.muted}>Noch keine Handouts.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[...journal].reverse().map((e) => {
            const shown = presentedId === e.id;
            return (
              <div key={e.id} style={{ ...S.row, ...(shown ? S.rowShown : null) }}>
                {e.imageUrl
                  ? <img src={e.imageUrlFull || e.imageUrl} alt="" style={S.thumb} onClick={() => setView(e)}
                      onError={(ev) => { if (e.imageUrlFull && ev.target.src !== e.imageUrl) ev.target.src = e.imageUrl; }} />
                  : <div style={{ ...S.thumb, display: 'grid', placeItems: 'center' }}>📜</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.rowTitle}>{e.title}</div>
                  <div style={S.actions}>
                    <button style={S.act} onClick={() => setView(e)}>Ansehen</button>
                    {isDM && (shown
                      ? <button style={{ ...S.act, ...S.actStop }} onClick={() => presentHandout(null)}>Stoppen</button>
                      : <button style={{ ...S.act, ...S.actShow }} onClick={() => presentHandout(e.id)}>Allen zeigen</button>)}
                    {isDM && <button style={S.act} onClick={() => { if (confirm('Eintrag löschen?')) removeJournalEntry(e.id); }}>✕</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view && <HandoutOverlay entry={view} onClose={() => setView(null)} />}
    </div>
  );
}

const S = {
  muted: { color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' },
  add: { display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8, borderBottom: '1px solid var(--color-border)' },
  file: { fontSize: 11, color: 'var(--color-text-muted)' },
  input: { padding: '5px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' },
  textarea: { padding: '6px 8px', minHeight: 140, resize: 'vertical', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontFamily: 'inherit', fontSize: 'var(--fs-sm)', lineHeight: 1.45 },
  miniBtn: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', fontSize: 11, background: 'var(--color-bg-sunken)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer' },
  previewBox: { minHeight: 140, maxHeight: 320, overflow: 'auto', padding: '6px 10px', background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)', lineHeight: 1.45 },
  addBtn: { padding: '6px', background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700 },
  row: { display: 'flex', gap: 8, padding: 6, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' },
  rowShown: { borderColor: 'var(--color-accent)', boxShadow: '0 0 0 1px var(--color-accent)' },
  thumb: { width: 48, height: 48, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', flexShrink: 0, background: 'var(--color-bg-sunken)' },
  rowTitle: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 },
  actions: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  act: { padding: '2px 8px', fontSize: 11, background: 'var(--color-bg-sunken)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer' },
  actShow: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none' },
  actStop: { background: 'var(--color-danger)', color: '#fff', border: 'none' },
};
