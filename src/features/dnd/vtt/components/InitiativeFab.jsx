// Schwebender DM-Button über der Karte (wie der Würfel-Button): startet den
// Kampf mit der AKTUELLEN Token-Auswahl (oder allen Tokens der Map/Ebene, wenn
// nichts gewählt ist) und öffnet die Initiative-Leiste. Läuft schon ein Kampf,
// fügt der Button die gewählten Tokens NACHTRÄGLICH hinzu.
import { useVtt, useIsDM, useActiveMap } from '../state/useVtt';
import { startCombat, addToCombat } from '../state/actions';

export default function InitiativeFab() {
  const isDM = useIsDM();
  const map = useActiveMap();
  const tokens = useVtt((s) => s.tokens);
  const activeLevel = useVtt((s) => s.ui.activeLevel);
  const selIds = useVtt((s) => s.ui.selectedTokenIds || []);
  const selOne = useVtt((s) => s.ui.selectedTokenId);
  const init = useVtt((s) => s.initiative);
  if (!isDM || !map) return null;

  const active = !!init?.active;
  const selected = selIds.length ? selIds : (selOne ? [selOne] : []);

  const onClick = () => {
    const base = map.levels?.[0]?.id || null;
    // Auswahl, sonst alle Tokens der aktuellen Map+Ebene.
    let ids = selected;
    if (!ids.length) {
      ids = Object.values(tokens)
        .filter((t) => t.mapId === map.id && (t.level || base) === (activeLevel || base))
        .map((t) => t.id);
    }
    if (!ids.length) return;
    if (active) addToCombat(ids, tokens);
    else startCombat(ids, tokens);
    window.dispatchEvent(new CustomEvent('vtt:open-initiative'));
  };

  const label = active
    ? (selected.length ? `+ ${selected.length} zum Kampf` : 'Initiative')
    : (selected.length ? `⚔ Kampf (${selected.length})` : '⚔ Kampf starten');

  return (
    <button style={S.fab} onClick={onClick}
      title={active ? 'Ausgewählte Tokens zum laufenden Kampf hinzufügen' : 'Kampf mit Auswahl starten (nichts gewählt = alle) und Initiative öffnen'}>
      {label}
    </button>
  );
}

const S = {
  fab: {
    position: 'absolute', left: 16, bottom: 16, zIndex: 25, height: 40, padding: '0 14px',
    borderRadius: 20, border: '1px solid var(--color-border)',
    background: 'color-mix(in srgb, var(--color-bg-elevated) 92%, transparent)',
    color: 'var(--color-text)', fontSize: 'var(--fs-sm)', fontWeight: 700, cursor: 'pointer',
    boxShadow: '0 4px 16px #0007',
  },
};
