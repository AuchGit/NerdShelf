// Wurf-Composer: kompaktes Popup beim Klick auf eine Schadens-Pill, wenn der
// Charakter On-Hit-Rider hat (Sneak Attack, aktives Hunter's Mark, …). Basis-
// Schaden + abhakbare Rider werden in EINEM 3D-Wurf gewürfelt; danach zeigt
// der Tray (und der Roll-Log) den Schaden aufgeschlüsselt pro Typ. Rider mit
// `active` (aktive Konzentration) sind vorangehakt. Shift beim Würfeln = Krit.
// 1×/Zug-Rider, die in DIESEM Initiative-Zug schon mitgewürfelt wurden, sind
// nicht vorangehakt und tragen ein „schon benutzt"-Tag (usageKey = Charakter;
// bewusst weiter anklickbar — Tischentscheid schlägt die Automatik).
// Portal in document.body (Bars haben transform/backdropFilter).
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { rollDamageParts, rollAttack } from '../lib/rollDice';
import { usedRiders, markRidersUsed } from '../../character-builder/lib/riderTurnUse';

export default function RollComposer({ title, base, riders = [], attack = null, src, usageKey = null, onClose }) {
  const [used] = useState(() => usedRiders(usageKey));
  const [on, setOn] = useState(() => new Set(
    riders.filter((r) => r.active && !(r.perTurn && used.has(r.id))).map((r) => r.id),
  ));
  const toggle = (id) => setOn((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const parts = [
    { formula: base.formula, type: base.type || '', label: base.label || 'Basis' },
    ...riders.filter((r) => on.has(r.id)).map((r) => ({ formula: r.formula, type: r.type || '', label: r.name })),
  ];
  const preview = parts.map((p) => p.formula).join(' + ');

  const roll = (ev) => {
    rollDamageParts(ev, parts, title, src);
    // Mitgewürfelte 1x/Zug-Rider für den Rest dieses Zugs als verbraucht
    // merken (fensterübergreifend; No-op ohne laufenden Kampf).
    markRidersUsed(usageKey, riders.filter((r) => r.perTurn && on.has(r.id)).map((r) => r.id));
    onClose();
  };
  // Bei Angriffs-Aktionen: ERST der Attack-Roll (d20+Bonus, Shift/Strg =
  // Vorteil/Nachteil), der Composer bleibt offen — trifft es, würfelt man
  // danach den Schaden mit den angehakten Ridern.
  const atk = (ev) => { rollAttack(ev, attack.bonus, `${attack.label || title}: Angriff`, src); };

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
              {r.perTurn && (used.has(r.id)
                ? <span style={{ ...S.perTurn, ...S.usedTag }} title="In diesem Zug schon benutzt (1x pro Zug) — anhaken übersteuert">schon benutzt</span>
                : <span style={S.perTurn} title="Nur einmal pro Zug">1×/Zug</span>)}
            </span>
            <span style={S.formula}>{r.formula}{r.type ? ` ${r.type}` : ''}</span>
          </label>
        ))}
        <div style={S.foot}>
          <span style={S.preview}>{preview}</span>
          <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {attack?.bonus != null && (
              <button style={S.atkBtn} title="Angriffswurf zuerst — Shift: Vorteil · Strg: Nachteil" onClick={atk}>Angriff {attack.bonus}</button>
            )}
            <button style={S.rollBtn} title="Shift: Kritisch (Würfel verdoppelt)" onClick={roll}>{attack ? 'Schaden' : 'Würfeln'}</button>
          </span>
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
  perTurn: { flexShrink: 0, fontSize: 9, fontWeight: 800, padding: '0 5px', borderRadius: 999, color: 'var(--color-text-muted)', border: '1px solid var(--color-border, #3a3f4a)' },
  usedTag: { color: '#e0af68', borderColor: 'color-mix(in srgb, #e0af68 55%, transparent)' },
  formula: { fontSize: 11, fontWeight: 700, color: '#ff6b6b', flexShrink: 0 },
  foot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border, #3a3f4a)' },
  preview: { fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  atkBtn: { padding: '4px 12px', fontSize: 'var(--fs-sm)', fontWeight: 800, background: 'color-mix(in srgb, #e0af68 16%, transparent)', color: '#e0af68', border: '1px solid color-mix(in srgb, #e0af68 55%, transparent)', borderRadius: 999, cursor: 'pointer', flexShrink: 0 },
  rollBtn: { padding: '4px 14px', fontSize: 'var(--fs-sm)', fontWeight: 800, background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none', borderRadius: 999, cursor: 'pointer', flexShrink: 0 },
};
