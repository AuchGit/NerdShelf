// Vom DM angeforderter Wurf (Save/Check): der Ziel-Spieler bekommt diesen
// Prompt — im 3D-Tray würfeln (korrekter eigener Bonus, Ergebnis landet im
// Roll-Log) oder einen Wert von Hand eintragen. Nach der Antwort verschwindet
// der Prompt lokal; der DM sieht die Ergebnisse im Roll-Log und beendet die
// Anforderung in seiner Party-Leiste.
import { useMemo, useState } from 'react';
import { Button } from '../../../../shared/ui';
import { useVtt } from '../state/useVtt';
import { logRoll } from '../state/actions';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';
import { getModifier } from '../../character-builder/lib/characterModel';
import { rollForResult } from '../lib/rollDice';

export default function RollRequestPrompt() {
  const req = useVtt((s) => s.rollRequest);
  const myId = useVtt((s) => s.ui.myCharacterId);
  const ch = useVtt((s) => (s.ui.myCharacterId != null ? s.ui.characters?.[s.ui.myCharacterId] : null));
  const [answeredId, setAnsweredId] = useState(null);
  const [manual, setManual] = useState('');
  const [rolling, setRolling] = useState(false);

  const character = ch?.data || null;
  const computed = useMemo(() => {
    if (!character) return null;
    try { return computeCharacter(character); } catch { return null; }
  }, [character]);

  if (!req || myId == null || !character) return null;
  if (!(req.characterIds || []).some((id) => String(id) === String(myId))) return null;
  if (answeredId === req.id) return null;

  const AB = String(req.ability || 'dex').toUpperCase();
  const isSave = req.kind === 'save';
  const bonus = isSave
    ? (computed?.savingThrows?.[req.ability]?.total ?? getModifier(computed?.abilityScores?.[req.ability] ?? 10))
    : getModifier(computed?.abilityScores?.[req.ability] ?? 10);
  const label = `Angefordert: ${AB} ${isSave ? 'Save' : 'Check'}${req.dc ? ` (DC ${req.dc})` : ''}`;
  const src = { name: character.info?.name || ch?.name || 'Spieler', portrait: character.appearance?.portrait || null };

  const roll = async () => {
    setRolling(true);
    await rollForResult(`1d20${bonus >= 0 ? '+' : ''}${bonus}`, label, null, src);
    setRolling(false);
    setAnsweredId(req.id); // Ergebnis steht im Roll-Log (Tray loggt automatisch)
  };
  const enter = () => {
    const v = parseInt(manual, 10);
    if (!Number.isFinite(v)) return;
    logRoll({ ...src, label, formula: 'manuell', mode: null, total: v, dice: [] });
    setAnsweredId(req.id);
    setManual('');
  };

  return (
    <div style={S.wrap}>
      <div style={S.title}>Der DM fordert: <b>{AB} {isSave ? 'Save' : 'Check'}{req.dc ? ` (DC ${req.dc})` : ''}</b></div>
      <div style={S.row}>
        <Button size="sm" onClick={roll} disabled={rolling}>{rolling ? 'Würfelt…' : `Würfeln (d20${bonus >= 0 ? '+' : ''}${bonus})`}</Button>
        <input type="number" placeholder="oder Wert" value={manual} onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') enter(); }} style={S.input} />
        <Button size="sm" variant="secondary" onClick={enter} disabled={manual === ''}>OK</Button>
      </div>
    </div>
  );
}

const S = {
  wrap: { position: 'absolute', top: 118, left: '50%', transform: 'translateX(-50%)', zIndex: 60, background: 'color-mix(in srgb, var(--color-bg-elevated) 97%, transparent)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-lg,10px)', boxShadow: '0 10px 34px #000a', padding: '10px 14px' },
  title: { fontSize: 'var(--fs-sm)', marginBottom: 8, textAlign: 'center' },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  input: { width: 76, padding: '4px 6px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', textAlign: 'center' },
};
