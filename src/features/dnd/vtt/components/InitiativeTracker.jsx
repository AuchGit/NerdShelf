// Initiative / turn tracker. DM builds the order from tokens, edits values, and
// advances turns; the active combatant + round sync to everyone. Selecting an
// entry selects its token. Clicking the 🎲 rolls d20 and AUTO-ADDS that
// combatant's initiative bonus (from the bound character, or an NPC's DEX mod).
import { useState } from 'react';
import { Button } from '../../../../shared/ui';
import Icon from './Icon';
import { useVtt, useIsDM, useSession } from '../state/useVtt';
import { setInitiative, selectToken, startCombat, endCombat } from '../state/actions';
import { getBoundCharacter } from '../sync/characterBinding';
import { useInitiativeRollEnabled } from '../lib/vttPrefs';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';

export default function InitiativeTracker() {
  const isDM = useIsDM();
  const session = useSession();
  const init = useVtt((s) => s.initiative);
  const tokens = useVtt((s) => s.tokens);
  const selectedIds = useVtt((s) => s.ui.selectedTokenIds);
  const rollEnabled = useInitiativeRollEnabled(); // per-user setting (DnD settings)
  const [lair, setLair] = useState(false); // add a Lair Action entry on start

  const commit = (next) => setInitiative(next);

  const begin = () => {
    const ids = (selectedIds && selectedIds.length) ? selectedIds : Object.keys(tokens);
    startCombat(ids, tokens, { lair });
  };
  // Descending by value; lair actions lose ties (placed after others at 20).
  const sortDesc = () => commit({ ...init, order: [...init.order].sort((a, b) => b.value - a.value || (a.lair ? 1 : 0) - (b.lair ? 1 : 0)), activeIndex: 0 });
  const setValue = (id, value) => commit({ ...init, order: init.order.map((e) => (e.id === id ? { ...e, value } : e)) });
  const remove = (id) => commit({ ...init, order: init.order.filter((e) => e.id !== id) });
  const step = (dir) => {
    if (!init.order.length) return;
    let i = init.activeIndex + dir;
    let round = init.round;
    if (i >= init.order.length) { i = 0; round++; }
    if (i < 0) { i = init.order.length - 1; round = Math.max(1, round - 1); }
    commit({ ...init, activeIndex: i, round });
  };

  // d20 + the combatant's initiative bonus (bound character, else NPC DEX mod).
  const rollInitiative = (e) => setValue(e.id, rollD20() + initBonus(tokens[e.tokenId]));
  const mayRoll = (e) => isDM || tokens[e.tokenId]?.ownerId === session.userId;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>Runde {init.round}</span>
      </div>
      {isDM && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          {!init.active
            ? <Button size="sm" onClick={begin}>Kampf starten{selectedIds?.length ? ` (${selectedIds.length})` : ''}</Button>
            : <Button size="sm" variant="danger" onClick={endCombat}>Kampf beenden</Button>}
          {init.active && <Button size="sm" variant="secondary" onClick={sortDesc}>Sortieren</Button>}
        </div>
      )}
      {isDM && !init.active && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', margin: '0 0 6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={lair} onChange={(e) => setLair(e.target.checked)} />
            <Icon src="/Assets/vtt/lair.svg" emoji="🏰" size={14} /> Lair-Action (Ini 20, verliert Gleichstände)
          </label>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
            Tokens mit Shift-Klick oder Kasten-Auswahl wählen, dann Kampf starten.
          </p>
        </>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {init.order.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>Keine Reihenfolge.</p>}
        {init.order.map((e, i) => (
          <div key={e.id} onClick={() => selectToken(e.tokenId)} style={{ ...S.row, ...(i === init.activeIndex ? S.active : null) }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {i === init.activeIndex ? '▶ ' : ''}{e.name}
            </span>
            {rollEnabled && !e.lair && mayRoll(e) && (
              <button
                title={`Würfeln (d20 + Bonus ${fmt(initBonus(tokens[e.tokenId]))})`}
                onClick={(ev) => { ev.stopPropagation(); rollInitiative(e); }}
                style={S.roll}
              ><D20Icon /></button>
            )}
            {isDM ? (
              <input
                type="number"
                value={e.value}
                onClick={(ev) => ev.stopPropagation()}
                onChange={(ev) => setValue(e.id, +ev.target.value)}
                style={S.val}
              />
            ) : <span style={S.valRO}>{e.value}</span>}
            {isDM && <span style={S.del} onClick={(ev) => { ev.stopPropagation(); remove(e.id); }}>✕</span>}
          </div>
        ))}
      </div>

      {isDM && init.order.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <Button size="sm" variant="secondary" fullWidth onClick={() => step(-1)}>◀ Zurück</Button>
          <Button size="sm" fullWidth onClick={() => step(1)}>Nächster ▶</Button>
        </div>
      )}
    </>
  );
}

// Initiative bonus for a token: a bound character's computed initiative, else an
// NPC statblock's DEX modifier, else 0.
function initBonus(token) {
  if (!token) return 0;
  if (token.characterId != null) {
    const ch = getBoundCharacter(token.characterId);
    if (ch?.data) { try { return computeCharacter(ch.data).initiative || 0; } catch { /* fall through */ } }
  }
  const sb = token.statblock;
  if (sb) {
    // 2024 stat blocks carry an explicit initiative bonus; honour it first.
    if (typeof sb.initiative === 'number') return sb.initiative;
    if (sb.initiative && typeof sb.initiative.initiative === 'number') return sb.initiative.initiative;
    // Otherwise derive from DEX (may be stored as a string in imported JSON).
    const dex = Number(sb.dex);
    if (Number.isFinite(dex)) return Math.floor((dex - 10) / 2);
  }
  return 0;
}

function fmt(n) { return (n >= 0 ? '+' : '') + n; }
function rollD20() { return 1 + Math.floor(Math.random() * 20); }

// d20 icon, falling back to a 🎲 emoji if the asset is missing.
function D20Icon() {
  const [ok, setOk] = useState(true);
  return ok
    ? <img src="/Assets/dice-twenty-faces-twenty.svg" alt="d20" width={16} height={16} onError={() => setOk(false)} style={{ display: 'block' }} />
    : <span>🎲</span>;
}

const S = {
  row: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)', border: '1px solid transparent' },
  active: { background: 'var(--color-surface)', border: '1px solid var(--color-accent)' },
  roll: { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 },
  val: { width: 44, padding: '2px 4px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', textAlign: 'center' },
  valRO: { width: 30, textAlign: 'center', color: 'var(--color-text-muted)' },
  del: { color: 'var(--color-text-muted)', cursor: 'pointer' },
};
