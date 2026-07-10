// Wurf-Composer: kompaktes Popup beim Benutzen einer Aktion / beim Wirken
// eines Zaubers. Basis-Schaden + abhakbare Rider werden in EINEM 3D-Wurf
// gewürfelt; danach zeigt der Tray (und der Roll-Log) den Schaden
// aufgeschlüsselt pro Typ. Rider mit `active` (aktive Konzentration) sind
// vorangehakt. Shift beim Würfeln = Krit.
//
// • `onConfirm({level})`: VERZÖGERTES Verbrauchen — Action/Slot/Ressourcen
//   werden erst beim Schadenswurf ODER über den „Benutzt"-Button abgebucht;
//   Schließen über ✕/Backdrop verbraucht NICHTS (Umentscheiden erlaubt).
// • `slotOptions`/`initialLevel`/`baseAt(level)`: Slot-Wahl bei Zaubern —
//   die Grad-Chips rechnen die Formel live um ({@scaledamage}), verbraucht
//   wird der beim Bestätigen gewählte Grad.
// • `thrown {bonus}`: „Geworfen"-Schalter (Thrown Weapon Fighting) — der
//   flache Bonus wandert in die BASIS-Formel (ist Waffenschaden).
// • Rider ohne expliziten Schadenstyp erben den Typ der Basis (Sneak Attack
//   & Co. machen RAW Schaden vom Typ der Waffe).
// • 1×/Zug-Rider, die in DIESEM Initiative-Zug schon mitgewürfelt wurden,
//   sind nicht vorangehakt und tragen ein „schon benutzt"-Tag (usageKey =
//   Charakter; bewusst weiter anklickbar — Tischentscheid).
// Portal in document.body (Bars haben transform/backdropFilter).
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { rollDamageParts, rollAttack } from '../lib/rollDice';
import { usedRiders, markRidersUsed } from '../../character-builder/lib/riderTurnUse';

export default function RollComposer({
  title, base, baseAt = null, riders = [], attack = null, thrown = null,
  slotOptions = null, initialLevel = null, src, usageKey = null,
  onConfirm = null, onClose,
}) {
  const [used] = useState(() => usedRiders(usageKey));
  const [on, setOn] = useState(() => new Set(
    riders.filter((r) => r.active && !(r.perTurn && used.has(r.id))).map((r) => r.id),
  ));
  const [level, setLevel] = useState(initialLevel);
  const [thrownOn, setThrownOn] = useState(false);
  const toggle = (id) => setOn((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Verbrauch genau EINMAL — egal ob über Schadenswurf oder „Benutzt".
  const confirmed = useRef(false);
  const confirm = () => { if (confirmed.current) return; confirmed.current = true; onConfirm?.({ level }); };

  const effBase = (baseAt && level != null) ? baseAt(level) : base;
  const baseFormula = (thrownOn && thrown?.bonus) ? `${effBase.formula}+${thrown.bonus}` : effBase.formula;
  const parts = [
    { formula: baseFormula, type: effBase.type || '', label: effBase.label || 'Basis' },
    ...riders.filter((r) => on.has(r.id)).map((r) => ({ formula: r.formula, type: r.type || effBase.type || '', label: r.name })),
  ];
  const preview = parts.map((p) => p.formula).join(' + ');

  const roll = (ev) => {
    confirm();
    rollDamageParts(ev, parts, title, src);
    // Mitgewürfelte 1x/Zug-Rider für den Rest dieses Zugs als verbraucht
    // merken (fensterübergreifend; No-op ohne laufenden Kampf).
    markRidersUsed(usageKey, riders.filter((r) => r.perTurn && on.has(r.id)).map((r) => r.id));
    onClose();
  };
  // Bei Angriffs-Aktionen: ERST der Attack-Roll (d20+Bonus, Shift/Strg =
  // Vorteil/Nachteil), der Composer bleibt offen — trifft es, würfelt man
  // danach den Schaden mit den angehakten Ridern. Der Attack-Roll allein
  // verbraucht noch nichts (Fehlschlag → „Benutzt" klicken oder abbrechen).
  const atk = (ev) => { rollAttack(ev, attack.bonus, `${attack.label || title}: Angriff`, src); };
  const useOnly = () => { confirm(); onClose(); };

  return createPortal(
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.panel} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <span style={S.title}>{title}</span>
          <button style={S.x} onClick={onClose} title="Abbrechen — nichts wird verbraucht">✕</button>
        </div>
        {slotOptions && slotOptions.length > 0 && (
          <div style={S.slotRow}>
            {slotOptions.map((o) => {
              const active = o.level === level;
              const off = o.remaining <= 0 && !active;
              return (
                <button key={o.level} disabled={off}
                  style={{ ...S.slotChip, ...(active ? S.slotOn : null), ...(off ? S.slotOff : null) }}
                  title={`Grad ${o.level} — ${o.remaining} Slot${o.remaining === 1 ? '' : 's'} frei`}
                  onClick={() => setLevel(o.level)}>
                  {o.level}<span style={S.slotFree}>·{o.remaining}</span>
                </button>
              );
            })}
          </div>
        )}
        <div style={S.row}>
          <span style={S.baseLbl}>{effBase.label || 'Schaden'}</span>
          <span style={S.formula}>{baseFormula}{effBase.type ? ` ${effBase.type}` : ''}</span>
        </div>
        {thrown?.bonus != null && (
          <label style={S.row}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <input type="checkbox" checked={thrownOn} onChange={() => setThrownOn((v) => !v)} />
              <span style={S.riderName}>Geworfen</span>
              <span style={S.perTurn} title="Thrown Weapon Fighting — Bonus nur beim Wurf">Wurfbonus</span>
            </span>
            <span style={S.formula}>+{thrown.bonus}</span>
          </label>
        )}
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
            {onConfirm && (
              <button style={S.useBtn} title="Aktion/Slot verbrauchen und schließen — ohne (weiteren) Wurf" onClick={useOnly}>Benutzt</button>
            )}
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
  slotRow: { display: 'flex', flexWrap: 'wrap', gap: 4, paddingBottom: 6, marginBottom: 4, borderBottom: '1px solid var(--color-border, #3a3f4a)' },
  slotChip: { padding: '2px 8px', fontSize: 11, fontWeight: 800, background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border, #3a3f4a)', borderRadius: 999, cursor: 'pointer' },
  slotOn: { borderColor: 'var(--color-accent)', color: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' },
  slotOff: { opacity: 0.4, cursor: 'not-allowed' },
  slotFree: { fontWeight: 600, color: 'var(--color-text-muted)', marginLeft: 2 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' },
  baseLbl: { fontSize: 'var(--fs-sm)', fontWeight: 700 },
  riderName: { fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  perTurn: { flexShrink: 0, fontSize: 9, fontWeight: 800, padding: '0 5px', borderRadius: 999, color: 'var(--color-text-muted)', border: '1px solid var(--color-border, #3a3f4a)' },
  usedTag: { color: '#e0af68', borderColor: 'color-mix(in srgb, #e0af68 55%, transparent)' },
  formula: { fontSize: 11, fontWeight: 700, color: '#ff6b6b', flexShrink: 0 },
  foot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border, #3a3f4a)' },
  preview: { fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  useBtn: { padding: '4px 10px', fontSize: 'var(--fs-sm)', fontWeight: 800, background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border, #3a3f4a)', borderRadius: 999, cursor: 'pointer', flexShrink: 0 },
  atkBtn: { padding: '4px 12px', fontSize: 'var(--fs-sm)', fontWeight: 800, background: 'color-mix(in srgb, #e0af68 16%, transparent)', color: '#e0af68', border: '1px solid color-mix(in srgb, #e0af68 55%, transparent)', borderRadius: 999, cursor: 'pointer', flexShrink: 0 },
  rollBtn: { padding: '4px 14px', fontSize: 'var(--fs-sm)', fontWeight: 800, background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none', borderRadius: 999, cursor: 'pointer', flexShrink: 0 },
};
