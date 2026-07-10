// Wurf-Composer: kompaktes Popup beim Klick auf eine Schadens-Pill, wenn der
// Charakter On-Hit-Rider hat (Sneak Attack, aktives Hunter's Mark, …). Basis-
// Schaden + abhakbare Rider werden in EINEM 3D-Wurf gewürfelt; danach zeigt
// der Tray (und der Roll-Log) den Schaden aufgeschlüsselt pro Typ. Rider mit
// `active` (aktive Konzentration) sind vorangehakt. Shift beim Würfeln = Krit.
// Portal in document.body (Bars haben transform/backdropFilter).
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { rollDamageParts } from '../lib/rollDice';

export default function RollComposer({ title, base, riders = [], src, onClose }) {
  const [on, setOn] = useState(() => new Set(riders.filter((r) => r.active).map((r) => r.id)));
  const toggle = (id) => setOn((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const parts = [
    { formula: base.formula, type: base.type || '', label: base.label || 'Basis' },
    ...riders.filter((r) => on.has(r.id)).map((r) => ({ formula: r.formula, type: r.type || '', label: r.name })),
  ];
  const preview = parts.map((p) => p.formula).join(' + ');

  const roll = (ev) => { rollDamageParts(ev, parts, title, src); onClose(); };

  return createPortal(
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.panel} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <span style={S.title}>{title}</span>
          <button style={S.x} onClick={onClose}>✕</button>
        </div>
        <div style={S.row}>
          <span style={S.baseLbl}>{base.label || 'Schaden'}</span>
          <span style={S.formula}>{base.formula}{base.type ? ` ${base.type}` : ''}</span>
        </div>
        {riders.map((r) => (
          <label key={r.id} style={S.row}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <input type="checkbox" checked={on.has(r.id)} onChange={() => toggle(r.id)} />
              <span style={S.riderName}>{r.name}</span>
            </span>
            <span style={S.formula}>{r.formula}{r.type ? ` ${r.type}` : ''}</span>
          </label>
        ))}
        <div style={S.foot}>
          <span style={S.preview}>{preview}</span>
          <button style={S.rollBtn} title="Shift: Kritisch (Würfel verdoppelt)" onClick={roll}>Würfeln</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const S = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  panel: { width: 'min(340px, 92vw)', background: 'var(--color-bg-elevated, #1c1f26)', color: 'var(--color-text, #e6e6e6)', border: '1px solid var(--color-border, #3a3f4a)', borderRadius: 'var(--radius-lg,10px)', boxShadow: '0 12px 40px #000b', padding: 12 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontWeight: 700, fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  x: { background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' },
  baseLbl: { fontSize: 'var(--fs-sm)', fontWeight: 700 },
  riderName: { fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  formula: { fontSize: 11, fontWeight: 700, color: '#ff6b6b', flexShrink: 0 },
  foot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border, #3a3f4a)' },
  preview: { fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rollBtn: { padding: '4px 14px', fontSize: 'var(--fs-sm)', fontWeight: 800, background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none', borderRadius: 999, cursor: 'pointer', flexShrink: 0 },
};
