// Map library. DM imports maps (compressed → WebP), activates one for the table
// (synced to all), and toggles which maps appear in the players' navigation.
// Players get a navigation list of the DM-exposed maps — the active map is
// always pinned at the top — and can browse them locally.
import { useRef, useState } from 'react';
import { Button } from '../../../../shared/ui';
import SharedMapsPanel from './DemoMapsPanel';
import { useVtt, useIsDM } from '../state/useVtt';
import { addMap, setActiveMap, setViewedMap, setMapPlayerVisible, addWalls, addLights, removeMap, updateMap } from '../state/actions';
import { importMapImage } from '../lib/mapImage';
import { parseUvtt } from '../lib/uvtt';
import { uploadMapImage, uploadMapToRelay, saveMapOriginalLocal } from '../lib/mapStorage';
import { getConnectionMode, getRelayUrl } from '../lib/vttPrefs';
import { persistMapDurable } from '../lib/persistMap';

export default function MapManager() {
  const isDM = useIsDM();
  const maps = useVtt((s) => Object.values(s.maps));
  const activeMapId = useVtt((s) => s.activeMapId);
  const viewedMapId = useVtt((s) => s.ui.viewedMapId);
  const campaignId = useVtt((s) => s.session.campaignId);
  const fileRef = useRef(null);
  const uvttRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      // Kompression (langsamster Schritt: WebP-Encode) und Original-Speichern
      // laufen PARALLEL — der Original-Name hasht die Originaldatei selbst,
      // damit er nicht auf das Kompressions-Ergebnis warten muss.
      const [{ blob, hash, width, height, origWidth, origHeight, bytes }, imageFullName] = await Promise.all([
        importMapImage(file),
        (async () => {
          const buf = await file.arrayBuffer();
          const digest = await crypto.subtle.digest('SHA-256', buf);
          const ohash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
          const ext = (file.name.split('.').pop() || 'png').toLowerCase();
          // ALWAYS keep the UNTOUCHED original in the relay's local maps dir
          // (desktop) so a direct connection later serves it full-res.
          return saveMapOriginalLocal(`${ohash}.${ext}`, file);
        })(),
      ]);
      const { imagePath, imageUrl } = await uploadMapImage(campaignId, blob, hash).catch((e4) => {
        throw new Error('Online-Upload fehlgeschlagen: ' + (e4?.message || e4));
      });
      // If we're already hosting, also PUT it now so an in-progress session gets
      // it immediately (otherwise it's there for the next host start).
      if (imageFullName && getConnectionMode() === 'relay' && getRelayUrl()) {
        try { await uploadMapToRelay(getRelayUrl(), imageFullName, file); } catch (e3) { console.warn('[vtt] relay map PUT failed', e3?.message); }
      }
      // origWidth/origHeight travel inside the grid jsonb (no schema change):
      // the calibration UI needs them so "72 dpi" typed from the ORIGINAL's
      // resolution converts onto the compressed map correctly.
      const id = addMap({ name: file.name.replace(/\.[^.]+$/, ''), imageUrl, imageFullName, imagePath, width, height, grid: { origWidth, origHeight } });
      setActiveMap(id);
      await persistMapDurable(id, campaignId); // garantiert in Supabase, überlebt Schließen/Relay-Only
      console.log(`[vtt] map uploaded: ${width}×${height}, ${(bytes / 1024).toFixed(0)} KB${imageFullName ? ' (+ full-res original kept for direct connection)' : ''}`);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const onPickUvtt = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const { name, blob, hash, width, height, gridSize, walls, lights } = await parseUvtt(file);
      const { imagePath, imageUrl } = await uploadMapImage(campaignId, blob, hash);
      const id = addMap({ name, imageUrl, imagePath, width, height, grid: { size: gridSize } });
      setActiveMap(id);
      await persistMapDurable(id, campaignId);
      const n = addWalls(id, walls);
      const nl = lights?.length ? addLights(id, lights) : 0;
      console.log(`[vtt] UVTT imported: ${width}×${height}, grid ${Math.round(gridSize)}px, ${n} wall segments, ${nl} lights`);
    } catch (e2) {
      setErr('UVTT-Import fehlgeschlagen: ' + e2.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Player navigation: active first, then other exposed maps ----
  if (!isDM) {
    const nav = maps
      .filter((m) => m.id === activeMapId || m.playerVisible)
      .sort((a, b) => (a.id === activeMapId ? -1 : b.id === activeMapId ? 1 : 0));
    const current = viewedMapId || activeMapId;
    return (
      <>
        {nav.length === 0 && <p style={S.muted}>Der DM hat noch keine Map geöffnet.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {nav.map((m) => (
            <button key={m.id}
              onClick={() => setViewedMap(m.id === activeMapId ? null : m.id)}
              style={{ ...S.item, ...(m.id === current ? S.itemActive : null) }}>
              <span style={S.name}>{m.name}</span>
              {m.id === activeMapId && <span style={{ fontSize: 11 }}>● aktiv</span>}
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />
      <input ref={uvttRef} type="file" accept=".uvtt,.dd2vtt,.df2vtt,application/json" hidden onChange={onPickUvtt} />
      <div style={{ display: 'flex', gap: 6 }}>
        <Button size="sm" fullWidth disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Importiere… (große Bilder brauchen einen Moment)' : '+ Bild-Map'}
        </Button>
        <Button size="sm" variant="secondary" fullWidth disabled={busy} onClick={() => uvttRef.current?.click()} title="Universal VTT (.uvtt/.dd2vtt) inkl. Wände & Türen">
          + UVTT
        </Button>
      </div>
      {err && <p style={{ color: 'var(--color-danger)', fontSize: 'var(--fs-sm)' }}>{err}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
        {maps.length === 0 && <p style={S.muted}>Noch keine Maps.</p>}
        {[...maps].sort((a, b) => (a.id === activeMapId ? -1 : b.id === activeMapId ? 1 : 0)).map((m) => {
          const active = m.id === activeMapId;
          return (
            <div key={m.id} style={{ ...S.item, ...(active ? S.itemActive : null) }}>
              <img
                src="/Assets/map/active.svg" alt="●"
                title={active ? 'Aktiv für alle' : 'Für alle aktivieren'}
                onClick={() => setActiveMap(m.id)}
                style={{ ...S.icon, opacity: active ? 1 : 0.4 }}
              />
              {/* the whole name is clickable to activate (robust) */}
              <button onClick={() => setActiveMap(m.id)} style={S.nameBtn} title={active ? 'Aktiv' : 'Für alle aktivieren'}>
                <span style={S.name}>{m.name}</span>
                {active && <span style={{ fontSize: 11, color: 'var(--color-accent)' }}>● aktiv</span>}
              </button>
              <span
                title="Map umbenennen (für alle)"
                onClick={() => { const n = window.prompt('Map umbenennen:', m.name); if (n && n.trim()) updateMap(m.id, { name: n.trim() }); }}
                style={S.rename}
              >✎</span>
              <img
                src="/Assets/map/invisible.svg" alt="👁"
                title={m.playerVisible ? 'Für Spieler sichtbar — verbergen' : 'Für Spieler verborgen — einblenden'}
                onClick={() => setMapPlayerVisible(m.id, !m.playerVisible)}
                style={{ ...S.icon, opacity: m.playerVisible ? 0.4 : 1 }}
              />
              <span
                title="Map löschen"
                onClick={() => { if (window.confirm(`Map „${m.name}" löschen? Tokens/Wände/Lichter dieser Map gehen verloren.`)) removeMap(m.id); }}
                style={S.del}
              >✕</span>
            </div>
          );
        })}
      </div>
      <p style={S.muted}>Linkes Symbol = für alle aktivieren. Rechtes Symbol hell = für Spieler verborgen (klicken zum Ein-/Ausblenden). Aktive Map sehen Spieler immer.</p>
      <SharedMapsPanel />
    </>
  );
}

const S = {
  muted: { color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', margin: '4px 0' },
  item: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)' },
  itemActive: { border: '1px solid var(--color-accent)', color: 'var(--color-accent)' },
  nameBtn: { flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer', textAlign: 'left', padding: 0, minWidth: 0 },
  name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  icon: { cursor: 'pointer', width: 18, height: 18, flexShrink: 0 },
  del: { cursor: 'pointer', color: 'var(--color-text-muted)', flexShrink: 0, padding: '0 2px', fontSize: 12 },
  rename: { cursor: 'pointer', color: 'var(--color-text-muted)', flexShrink: 0, padding: '0 2px', fontSize: 12 },
};
