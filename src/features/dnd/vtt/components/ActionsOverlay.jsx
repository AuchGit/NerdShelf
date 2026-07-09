// Verschieb- und größenveränderbares Aktions-Overlay — die kompakte Alternative
// zur Bottom-Bar fürs Action-Tracking. Reiter: Alle (Spalten wie die Bottom-Bar),
// Pinned, Action, Bonus Action, Reaction. Position/Größe bleiben erhalten
// (localStorage). Öffnen über den Popout-Button im Aktionen-Panel der Bottom-Bar.
// Rendert per PORTAL in document.body: die Bottom-Bar hat transform +
// backdropFilter, darin würde position:fixed an der Bar kleben statt frei über
// allem zu schweben (wie das Würfelfenster).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CombatActionsExplorer } from '../../character-builder/components/sheet/OverviewTab';

const BOX_KEY = 'nerdshelf:vttActionsOverlayBox';
const TABS = [
  { id: 'all', label: 'Alle' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'action', label: 'Action' },
  { id: 'bonusAction', label: 'Bonus' },
  { id: 'reaction', label: 'Reaction' },
];

function defaultBox() {
  const W = typeof window !== 'undefined' ? window.innerWidth : 1200;
  return { x: Math.max(12, W / 2 - 330), y: 90, w: 660, h: 440 };
}

export default function ActionsOverlay({ character, computed, applyCharacter, onClose }) {
  const [box, setBox] = useState(() => {
    try { return { ...defaultBox(), ...(JSON.parse(localStorage.getItem(BOX_KEY)) || {}) }; } catch { return defaultBox(); }
  });
  const [tab, setTab] = useState('all');
  const gesture = useRef(null); // { kind: 'move'|'resize', startX, startY, box }

  useEffect(() => {
    const move = (e) => {
      const g = gesture.current;
      if (!g) return;
      const dx = e.clientX - g.startX; const dy = e.clientY - g.startY;
      if (g.kind === 'move') {
        setBox({ ...g.box, x: Math.max(0, g.box.x + dx), y: Math.max(0, g.box.y + dy) });
      } else {
        setBox({ ...g.box, w: Math.max(320, g.box.w + dx), h: Math.max(220, g.box.h + dy) });
      }
    };
    const up = () => { gesture.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  useEffect(() => { try { localStorage.setItem(BOX_KEY, JSON.stringify(box)); } catch { /* ignore */ } }, [box]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const startMove = (e) => { e.preventDefault(); gesture.current = { kind: 'move', startX: e.clientX, startY: e.clientY, box }; };
  const startResize = (e) => { e.preventDefault(); gesture.current = { kind: 'resize', startX: e.clientX, startY: e.clientY, box }; };

  return createPortal(
    <div style={{ ...S.wrap, left: box.x, top: box.y, width: box.w, height: box.h }}>
      <div style={S.head} onMouseDown={startMove} title="Ziehen zum Verschieben">
        <span style={S.title}>Aktionen</span>
        <div style={S.tabs} onMouseDown={(e) => e.stopPropagation()}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ ...S.tab, ...(tab === t.id ? S.tabOn : null) }}>{t.label}</button>
          ))}
        </div>
        <button style={S.close} onMouseDown={(e) => e.stopPropagation()} onClick={onClose} title="Schließen">✕</button>
      </div>
      <div style={S.body}>
        <CombatActionsExplorer character={character} computed={computed} applyCharacter={applyCharacter}
          embedded columns onlySlots={tab === 'all' ? null : [tab]} />
      </div>
      <div style={S.resize} onMouseDown={startResize} title="Größe ziehen" />
    </div>,
    document.body,
  );
}

const S = {
  wrap: { position: 'fixed', zIndex: 70, display: 'flex', flexDirection: 'column', background: 'color-mix(in srgb, var(--color-bg-elevated) 97%, transparent)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg,10px)', boxShadow: '0 12px 40px #000b', overflow: 'hidden' },
  head: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--color-border)', cursor: 'move', userSelect: 'none', flexShrink: 0 },
  title: { fontWeight: 700, fontSize: 'var(--fs-sm)' },
  tabs: { display: 'flex', gap: 3, flex: 1, justifyContent: 'center', flexWrap: 'wrap' },
  tab: { padding: '2px 9px', fontSize: 11, fontWeight: 700, background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 999, cursor: 'pointer' },
  tabOn: { color: 'var(--color-accent)', borderColor: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' },
  close: { width: 24, height: 24, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13, lineHeight: 1, flexShrink: 0 },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px' },
  resize: { position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'nwse-resize', background: 'linear-gradient(135deg, transparent 50%, var(--color-border) 50%)', borderBottomRightRadius: 'var(--radius-lg,10px)' },
};
