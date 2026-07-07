// When combat starts, a player whose token's initiative is still open (pending)
// gets this prompt: roll it in the 3D tray (the result is captured) or type a
// value. Self-hides once set. Uses the character's correct initiative bonus.
import { useState } from 'react';
import { Button } from '../../../../shared/ui';
import { useVtt, useSession } from '../state/useVtt';
import { getState } from '../state/store';
import { setInitiative } from '../state/actions';
import { getBoundCharacter } from '../sync/characterBinding';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';
import { rollForResult } from '../lib/rollDice';

export default function InitiativePrompt() {
  const session = useSession();
  const init = useVtt((s) => s.initiative);
  const tokens = useVtt((s) => s.tokens);
  const [manual, setManual] = useState('');
  const [rolling, setRolling] = useState(false);

  if (!init?.active) return null;
  const mine = (init.order || []).find((e) => e.pending && !e.lair && tokens[e.tokenId]?.ownerId === session.userId);
  if (!mine) return null;
  const t = tokens[mine.tokenId];

  const bonus = () => {
    const ch = t?.characterId != null ? getBoundCharacter(t.characterId) : null;
    try { return ch?.data ? (computeCharacter(ch.data).initiative || 0) : 0; } catch { return 0; }
  };
  const setVal = (value) => {
    const cur = getState().initiative;
    if (cur) setInitiative({ ...cur, order: cur.order.map((e) => (e.id === mine.id ? { ...e, value, pending: false } : e)) });
  };
  const roll = async () => {
    setRolling(true);
    const b = bonus();
    const total = await rollForResult(`1d20${b >= 0 ? '+' : ''}${b}`, `${t.name}: Initiative`);
    setRolling(false);
    if (total != null) setVal(total);
  };
  const enter = () => { const v = parseInt(manual, 10); if (Number.isFinite(v)) setVal(v); };

  return (
    <div style={S.wrap}>
      <div style={S.title}>Kampf startet — deine Initiative ({t?.name})</div>
      <div style={S.row}>
        <Button size="sm" onClick={roll} disabled={rolling}>{rolling ? 'Würfelt…' : `Würfeln (d20${bonus() >= 0 ? '+' : ''}${bonus()})`}</Button>
        <input type="number" placeholder="oder Wert" value={manual} onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') enter(); }} style={S.input} />
        <Button size="sm" variant="secondary" onClick={enter} disabled={manual === ''}>OK</Button>
      </div>
    </div>
  );
}

const S = {
  wrap: { position: 'absolute', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 60, background: 'color-mix(in srgb, var(--color-bg-elevated) 97%, transparent)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-lg,10px)', boxShadow: '0 10px 34px #000a', padding: '10px 14px' },
  title: { fontSize: 'var(--fs-sm)', fontWeight: 700, marginBottom: 8, textAlign: 'center' },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  input: { width: 76, padding: '4px 6px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', textAlign: 'center' },
};
