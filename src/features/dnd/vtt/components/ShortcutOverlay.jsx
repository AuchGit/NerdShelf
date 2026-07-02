// Keyboard cheat-sheet: toggled with `?` (and closable with Esc/click). One
// data-driven list — add a shortcut here and it shows up, nothing else to wire.
const GROUPS = [
  {
    title: 'Spielen',
    keys: [
      ['W A S D', 'Ausgewähltes Token Feld für Feld bewegen'],
      ['Klick auf Tür/Fenster', 'Öffnen / schließen (Auswahl-Werkzeug)'],
      ['Klick auf Lichtschalter', 'Licht an / aus'],
      ['Doppelklick Token', 'Statblock / Charakterbogen öffnen'],
      ['Rechtsklick Token', 'Token-Menü (HP, Zustände, Licht, …)'],
      ['Mausrad', 'Zoomen · Ziehen mit Mittel-/Rechtstaste = Karte bewegen'],
    ],
  },
  {
    title: 'DM — Bearbeiten',
    keys: [
      ['Shift beim Platzieren', 'Frei platzieren (ohne Grid-Einrasten)'],
      ['Esc / Enter', 'Wandzug beenden · Tür-/Fenster-Entwurf abbrechen'],
      ['Doppelklick Wand', 'Ganzen Wand-Zug / Loop auswählen'],
      ['Entf / Backspace', 'Ausgewähltes Element löschen'],
      ['Strg beim Endpunkt-Ziehen', 'Nur diesen Endpunkt bewegen (Verbund lösen)'],
    ],
  },
  {
    title: 'Allgemein',
    keys: [
      ['Strg + Z', 'Rückgängig'],
      ['Strg + Y / Strg + Shift + Z', 'Wiederholen'],
      ['?', 'Diese Übersicht ein-/ausblenden'],
    ],
  },
];

export default function ShortcutOverlay({ onClose }) {
  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.panel} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <span style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>⌨ Tastenkürzel</span>
          <button style={S.x} onClick={onClose}>×</button>
        </div>
        <div style={S.cols}>
          {GROUPS.map((g) => (
            <div key={g.title} style={S.group}>
              <div style={S.groupTitle}>{g.title}</div>
              {g.keys.map(([k, desc]) => (
                <div key={k} style={S.row}>
                  <span style={S.kbd}>{k}</span>
                  <span style={S.desc}>{desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const S = {
  backdrop: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  panel: { width: 'min(720px, 94vw)', maxHeight: '86vh', overflowY: 'auto', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 12px 48px #000b', padding: 16 },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  x: { background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 22, lineHeight: 1 },
  cols: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 },
  group: {},
  groupTitle: { fontWeight: 700, fontSize: 'var(--fs-sm)', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-text-muted)', marginBottom: 6 },
  row: { display: 'flex', alignItems: 'baseline', gap: 10, padding: '3px 0' },
  kbd: { flexShrink: 0, minWidth: 120, fontFamily: 'monospace', fontSize: 12, background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '1px 6px', textAlign: 'center' },
  desc: { fontSize: 'var(--fs-sm)', color: 'var(--color-text)' },
};
