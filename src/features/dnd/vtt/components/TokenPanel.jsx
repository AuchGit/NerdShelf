// Token roster. DM can drop NPC/monster tokens and player tokens; a player can
// add their own token. New tokens spawn at the map center, snapped to grid.
import { Button } from '../../../../shared/ui';
import { useVtt, useActiveMap, useIsDM, useSession } from '../state/useVtt';
import { addToken, selectToken, removeToken, updateMap } from '../state/actions';
import { spawnMemberToken, spawnAllMemberTokens } from '../sync/characterBinding';
import { snapToGrid } from '../lib/geometry';

const PALETTE = ['#42a5f5', '#ef5350', '#66bb6a', '#ab47bc', '#ffa726', '#26c6da'];

export default function TokenPanel() {
  const map = useActiveMap();
  const isDM = useIsDM();
  const session = useSession();
  const tokens = useVtt((s) => Object.values(s.tokens));
  const members = useVtt((s) => s.ui.campaignMembers || []);

  if (!map) return null;
  const boundChars = new Set(tokens.map((t) => t.characterId).filter((x) => x != null).map(String));
  const unplaced = members.filter((m) => !boundChars.has(String(m.characterId)));

  const spawn = (partial) => {
    const center = snapToGrid(map.width / 2, map.height / 2, map.grid, partial.sizeCells || 1);
    addToken({
      ...partial,
      x: center.x, y: center.y,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    });
  };

  return (
    <>
      {isDM && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-sm)', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--color-border)', cursor: 'pointer' }}>
          <input type="checkbox" checked={map.bloodyTokens === true} onChange={(e) => updateMap(map.id, { bloodyTokens: e.target.checked })} />
          🩸 Blut-Overlay auf Token (nach fehlenden HP)
        </label>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {isDM ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => spawn({ kind: 'npc', name: 'Monster', hp: 10, hpMax: 10 })}>+ NPC / Monster</Button>
            {/* Player tokens: pick a specific member, or add everyone at once. */}
            {unplaced.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => spawnAllMemberTokens()}>
                + Alle Spieler ({unplaced.length})
              </Button>
            )}
            {unplaced.map((m) => (
              <Button key={m.characterId} size="sm" variant="ghost" onClick={() => spawnMemberToken(m.characterId)}>
                + {m.name}
              </Button>
            ))}
            {members.length === 0 && (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', margin: 0 }}>Noch keine Spieler in der Campaign.</p>
            )}
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => spawn({ kind: 'player', ownerId: session.userId, name: session.name || 'Ich', hp: 20, hpMax: 20 })}>+ Mein Token</Button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 10 }}>
        {tokens.map((t) => (
          <div key={t.id} style={S.row} onClick={() => selectToken(t.id)}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            {t.hp != null && <span style={S.hp}>{t.hp}/{t.hpMax}</span>}
            {isDM && <span style={S.del} title="Entfernen" onClick={(e) => { e.stopPropagation(); removeToken(t.id); }}>✕</span>}
          </div>
        ))}
      </div>
    </>
  );
}

const S = {
  row: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  hp: { color: 'var(--color-text-muted)', fontSize: 11 },
  del: { color: 'var(--color-text-muted)', cursor: 'pointer', padding: '0 2px' },
};
