// Levels/floors panel (DM). Ebene 1 = die Basiskarte. Weitere Ebenen bekommen
// je EIN eigenes Kartenbild (Stockwerk) — optional mit eigenem Grid. Tokens/
// Wände/Lichter filtern nach Ebene, teilen sich also dieselbe Karte. Dazu:
// Treppen/Leitern, die ein Token zwischen den Ebenen bewegen. Spieler sehen
// dieses Panel nicht; ihre Ansicht folgt der Ebene ihres Tokens.
import { useRef, useState } from 'react';
import { Button } from '../../../../shared/ui';
import { useVtt, useIsDM, useActiveMap, useTool } from '../state/useVtt';
import { addLevelDir, removeLevel, setActiveLevel, setTool, setTransitionTool } from '../state/actions';
import { TRANSITION_KINDS } from '../lib/constants';
import { importMapImage } from '../lib/mapImage';
import { uploadMapImage, saveMapOriginalLocal } from '../lib/mapStorage';

export default function LevelPanel() {
  const isDM = useIsDM();
  const map = useActiveMap();
  const tool = useTool();
  const activeLevel = useVtt((s) => s.ui.activeLevel);
  const transitionKind = useVtt((s) => s.ui.transitionKind);
  const campaignId = useVtt((s) => s.session.campaignId);
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (!isDM || !map) return null;

  // Ebenen nach floor sortiert anzeigen (oben = höchstes Stockwerk).
  const levels = [...(map.levels || [])].sort((a, b) => (b.floor ?? 0) - (a.floor ?? 0));
  const current = activeLevel || map.levels?.[0]?.id;
  const floorLabel = (f) => (f === 0 ? 'EG' : f > 0 ? `OG ${f}` : `UG ${-f}`);

  // Ein neues Stockwerk (dir: +1 höher / -1 tiefer) MIT eigenem Kartenbild
  // anlegen. Gleiche Import-Pipeline wie eine normale Karte.
  const onPickFloor = (dir) => async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const { blob, hash, width, height, origWidth, origHeight } = await importMapImage(file);
      const { imagePath, imageUrl } = await uploadMapImage(campaignId, blob, hash);
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const imageFullName = await saveMapOriginalLocal(`${hash}.${ext}`, file);
      addLevelDir(map.id, dir, {
        imageUrl, imagePath, imageFullName, width, height,
        grid: { ...map.grid, origWidth, origHeight },
      });
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };
  const dirRef = useRef(1);

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPickFloor(dirRef.current)(e)} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {levels.map((l) => (
          <div key={l.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button onClick={() => setActiveLevel(l.id)} style={{ ...S.row, ...(l.id === current ? S.active : null), flex: 1 }}>
              {l.id === current ? '● ' : ''}<b style={{ opacity: 0.7 }}>{floorLabel(l.floor ?? 0)}</b> · {l.name}{l.imageUrl ? ' 🗺' : ''}
            </button>
            {(l.floor ?? 0) !== 0 && (
              <button title="Ebene löschen" onClick={() => { if (window.confirm(`„${l.name}" löschen?`)) removeLevel(map.id, l.id); }} style={S.del}>✕</button>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <Button size="sm" variant="secondary" style={{ flex: 1 }} disabled={busy} onClick={() => addLevelDir(map.id, 1)}>+ Stockwerk ↑</Button>
        <Button size="sm" variant="secondary" style={{ flex: 1 }} disabled={busy} onClick={() => addLevelDir(map.id, -1)}>+ Keller ↓</Button>
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <Button size="sm" variant="ghost" style={{ flex: 1 }} disabled={busy} onClick={() => { dirRef.current = 1; fileRef.current?.click(); }}>{busy ? 'Lädt…' : '↑ mit Karte'}</Button>
        <Button size="sm" variant="ghost" style={{ flex: 1 }} disabled={busy} onClick={() => { dirRef.current = -1; fileRef.current?.click(); }}>{busy ? 'Lädt…' : '↓ mit Karte'}</Button>
      </div>
      {err && <p style={{ color: 'var(--color-danger)', fontSize: 'var(--fs-sm)' }}>{err}</p>}
      {levels.find((l) => l.id === current)?.imageUrl && (
        <p style={S.muted}>Dieses Stockwerk hat eine eigene Karte. Grid im „Grid"-Menü gilt für diese Ebene. Tokens/Wände/Lichter hier gehören zu dieser Ebene.</p>
      )}

      <div style={{ borderTop: '1px solid var(--color-border)', margin: '10px 0 8px' }} />
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Treppen / Leitern / Portale</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {Object.entries(TRANSITION_KINDS).map(([k, label]) => (
          <button key={k} onClick={() => setTransitionTool(k)}
            style={{ ...S.chip, ...(tool === 'transition' && transitionKind === k ? S.active : null) }}>{label}</button>
        ))}
      </div>
      <p style={S.muted}>
        Feld setzen → es wird ausgewählt. Im Editor (oben) benennen und mit anderen
        Feldern GLEICHER Art verbinden (Treppe↔Treppe, Leiter↔Leiter, Portal↔Portal).
        Portale verbinden auch auf demselben Layer. Mehrere Ziele → der Spieler wählt
        beim Betreten. Vorhandenes Feld anklicken = auswählen, Entf = löschen.
      </p>
      {tool === 'transition' && <Button size="sm" variant="secondary" fullWidth onClick={() => setTool('select')}>Fertig</Button>}
    </>
  );
}

const S = {
  row: { padding: '6px 10px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)', textAlign: 'left' },
  active: { border: '1px solid var(--color-accent)', color: 'var(--color-accent)' },
  del: { width: 26, height: 26, background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 12 },
  chip: { flex: 1, padding: '5px 0', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  muted: { color: 'var(--color-text-muted)', fontSize: 11, margin: '4px 0' },
};
