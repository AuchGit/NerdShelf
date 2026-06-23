// Notes FAB — a small button next to the dice button (bottom-right) that opens
// the player's character notes as an overlay (mirrors the dice tray pattern).
// Debounced save through applyOwnCharacter so it syncs like the sheet.
import { useEffect, useRef, useState } from 'react';
import { useVtt } from '../state/useVtt';
import { applyOwnCharacter } from '../sync/characterBinding';

function setPath(obj, path, value) {
  const keys = path.split('.'); let o = obj;
  for (let i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = value;
}

export default function NotesFab() {
  const myId = useVtt((s) => s.ui.myCharacterId);
  const chars = useVtt((s) => s.ui.characters || {});
  const character = myId != null ? chars[myId]?.data : null;
  const [open, setOpen] = useState(false);
  const [v, setV] = useState('');
  const t = useRef(null);

  useEffect(() => () => clearTimeout(t.current), []);
  if (myId == null || !character) return null;

  // Refresh the draft from the latest saved notes each time the panel opens.
  const openPanel = () => { setV(character?.personality?.notes || ''); setOpen(true); };

  const onChange = (e) => {
    const val = e.target.value;
    setV(val);
    clearTimeout(t.current);
    t.current = setTimeout(() => applyOwnCharacter(myId, (d) => setPath(d, 'personality.notes', val)), 500);
  };

  if (!open) return <button style={S.fab} onClick={openPanel} title="Notizen">📝</button>;
  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <span style={{ fontWeight: 700 }}>📝 Notizen</span>
        <button style={S.x} onClick={() => setOpen(false)}>×</button>
      </div>
      <textarea value={v} onChange={onChange} placeholder="Notizen…" style={S.area} />
    </div>
  );
}

const S = {
  // Sits just left of the dice FAB (which is right:16, 44px wide).
  fab: { position: 'absolute', right: 68, bottom: 16, zIndex: 25, width: 44, height: 44, borderRadius: '50%', border: '1px solid var(--color-border)', background: 'rgba(15,17,21,0.92)', color: 'var(--color-text)', fontSize: 20, cursor: 'pointer', boxShadow: '0 4px 16px #0007' },
  wrap: { position: 'absolute', right: 68, bottom: 16, zIndex: 26, width: 300, background: 'rgba(15,17,21,0.96)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg,10px)', boxShadow: '0 8px 30px #000a', overflow: 'hidden' },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--color-border)' },
  x: { background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 16 },
  area: { width: '100%', boxSizing: 'border-box', minHeight: 180, resize: 'vertical', background: 'var(--color-surface)', color: 'var(--color-text)', border: 'none', padding: '8px 10px', fontFamily: 'inherit', fontSize: 'var(--fs-sm)', lineHeight: 1.4, outline: 'none' },
};
