// Shared-maps browser (in the Karten sidebar). Any DM can UPLOAD the active map
// as a shared map under a unique name, and LOAD any shared map as a fresh copy
// into their own campaign. No admin role required.
import { useEffect, useState } from 'react';
import { useIsDM } from '../state/useVtt';
import { listDemoMaps, loadDemoIntoCampaign, uploadSharedMap } from '../lib/demoMaps';

export default function SharedMapsPanel() {
  const isDM = useIsDM();
  const [maps, setMaps] = useState([]);
  const [busy, setBusy] = useState(false);
  const refresh = () => listDemoMaps().then(setMaps);
  useEffect(() => { refresh(); }, []);

  const upload = async () => {
    const name = window.prompt('Name der Shared Map (eindeutig):', '');
    if (name === null) return;
    if (!name.trim()) { alert('Bitte einen Namen eingeben.'); return; }
    setBusy(true);
    try { await uploadSharedMap(name); await refresh(); alert('Map hochgeladen.'); }
    catch (e) {
      alert(e?.message === 'NAME_TAKEN'
        ? 'Dieser Name ist bereits vergeben — bitte einen anderen wählen.'
        : ('Upload fehlgeschlagen: ' + (e?.message || e)));
    }
    finally { setBusy(false); }
  };

  return (
    <div style={S.wrap}>
      <div style={S.title}>Shared Maps</div>
      {maps.length === 0
        ? <div style={S.muted}>Keine Shared Maps verfügbar.</div>
        : maps.map((d) => (
          <div key={d.id} style={S.row}>
            <span style={S.name} title={d.name}>{d.name}</span>
            <button style={S.btn} onClick={() => loadDemoIntoCampaign(d)} title="Als Kopie in diese Campaign laden">Load</button>
          </div>
        ))}
      {isDM && <button style={S.publish} disabled={busy} onClick={upload} title="Aktive Map unter eindeutigem Namen teilen">{busy ? '…' : '⬆ Upload map'}</button>}
    </div>
  );
}

const S = {
  wrap: { borderTop: '1px solid var(--color-border)', marginTop: 10, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 },
  title: { fontWeight: 600, fontSize: 'var(--fs-sm)' },
  muted: { color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' },
  row: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)' },
  name: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  btn: { padding: '2px 8px', fontSize: 11, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer' },
  publish: { marginTop: 4, padding: '6px', fontSize: 'var(--fs-sm)', background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700 },
};
