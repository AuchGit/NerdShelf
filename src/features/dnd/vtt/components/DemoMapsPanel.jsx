// Shared-maps browser (in the Karten sidebar). Any DM can UPLOAD the active map
// as a shared map under a unique name, and LOAD any shared map as a fresh copy
// into their own campaign. No admin role required.
import { useEffect, useState } from 'react';
import { useIsDM, useVtt } from '../state/useVtt';
import { listDemoMaps, loadDemoIntoCampaign, uploadSharedMap, deleteSharedMap } from '../lib/demoMaps';
import { toast } from '../lib/toast';

export default function SharedMapsPanel() {
  const isDM = useIsDM();
  const userId = useVtt((s) => s.session.userId);
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
            {d.created_by === userId && (
              <button style={S.del} title="Eigene Shared Map aus dem Share löschen"
                onClick={async () => {
                  if (!window.confirm(`Shared Map „${d.name}" für alle aus dem Share entfernen?`)) return;
                  try { await deleteSharedMap(d.id); await refresh(); toast('Shared Map gelöscht.', 'success'); }
                  catch (e) { toast('Löschen fehlgeschlagen: ' + (e?.message || e)); }
                }}>✕</button>
            )}
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
  del: { padding: '2px 7px', fontSize: 11, background: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', borderRadius: 4, cursor: 'pointer' },
  publish: { marginTop: 4, padding: '6px', fontSize: 'var(--fs-sm)', background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700 },
};
