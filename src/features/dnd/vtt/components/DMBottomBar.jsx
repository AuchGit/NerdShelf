// DM bottom bar — an at-a-glance party panel for the GM: every bound character
// with HP, AC and passive senses (Perception / Investigation / Insight) plus
// active conditions. Read-only; double-click a card opens that character's
// (read-only) sheet popout. Mirrors the player bottom bar's placement.
import { useMemo, useState } from 'react';
import { useVtt, useActiveMap } from '../state/useVtt';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';
import { openSheetPopout } from '../../character-builder/lib/sheetPopout';
import { applyHpDelta } from '../state/actions';
import { patchCombat } from '../sync/characterBinding';
import { ABILITY_KEYS, modStr } from '../../character-builder/lib/sheetUtils';
import { getModifier } from '../../character-builder/lib/characterModel';
import ToolSettings from './ToolSettings';

export default function DMBottomBar() {
  const characters = useVtt((s) => s.ui.characters || {});
  const campaignId = useVtt((s) => s.session.campaignId);
  const tool = useVtt((s) => s.ui.tool);
  const selId = useVtt((s) => s.ui.selectedTokenId);
  const selToken = useVtt((s) => (selId ? s.tokens[selId] : null));
  const activeMap = useActiveMap();
  const [open, setOpen] = useState(true);
  const tokens = useVtt((s) => s.tokens);
  // Only show party members who are actually IN the session — i.e. have a token
  // on the table. Members who haven't joined/been placed yet aren't shown.
  const presentChars = useMemo(() => new Set(Object.values(tokens).filter((t) => t.characterId != null).map((t) => String(t.characterId))), [tokens]);
  const list = useMemo(() => Object.values(characters).filter((c) => c?.data && presentChars.has(String(c.id))), [characters, presentChars]);

  const toolActive = tool && tool !== 'select';
  if (!toolActive && !selToken && list.length === 0) return null;

  return (
    <div style={S.bar}>
      {toolActive ? (
        <div style={{ ...S.row, paddingTop: 6 }}><ToolSettings map={activeMap} /></div>
      ) : selToken ? (
        <div style={{ ...S.row, padding: '12px 16px' }}><TokenDetail token={selToken} characters={characters} campaignId={campaignId} /></div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--color-border)' }}>
            <button style={{ ...S.toggle, borderBottom: 'none', flex: 1, textAlign: 'left' }} onClick={() => setOpen((o) => !o)} title="Party-Panel ein-/ausklappen">
              {open ? '▼' : '▲'} Party ({list.length})
            </button>
            <button style={S.giveAll} title="Allen Spielern Inspiration geben"
              onClick={() => list.forEach((c) => patchCombat(c.id, { inspiration: true }))}>◆ Allen Insp.</button>
          </div>
          {open && (
            <div style={S.row}>
              {list.map((c) => <PartyCard key={c.id} entry={c} campaignId={campaignId} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Quick info for the selected token: character token → its computed stats; NPC
// token → its statblock. HP is editable inline.
function TokenDetail({ token, characters, campaignId }) {
  const ch = token.characterId != null ? characters[token.characterId]?.data : null;
  const computed = useMemo(() => { if (!ch) return null; try { return computeCharacter(ch); } catch { return null; } }, [ch]);
  const sb = token.statblock || null;
  const name = token.name || ch?.info?.name || 'Token';

  let ac, hp, hpMax, speed, abilities, conds;
  if (computed) {
    ac = computed.ac?.total;
    hpMax = computed.hp?.max ?? 0;
    hp = ch.status?.currentHp ?? hpMax;
    speed = computed.speed?.walk ?? computed.speed ?? null;
    abilities = computed.abilityScores || {};
    conds = ch.status?.conditions || token.conditions || [];
  } else {
    ac = Array.isArray(sb?.ac) ? (sb.ac[0]?.ac ?? sb.ac[0]) : sb?.ac;
    hp = token.hp; hpMax = token.hpMax ?? (sb?.hp?.average);
    speed = typeof sb?.speed === 'object' ? sb.speed.walk : sb?.speed;
    abilities = sb ? { str: sb.str, dex: sb.dex, con: sb.con, int: sb.int, wis: sb.wis, cha: sb.cha } : {};
    conds = token.conditions || [];
  }

  const hpDelta = (d) => {
    if (computed) {
      const cur = ch.status?.currentHp ?? hpMax;
      patchCombat(token.characterId, { currentHp: Math.max(0, Math.min(hpMax, cur + d)) });
    } else {
      applyHpDelta(token.id, d, token);
    }
  };

  const portrait = ch?.appearance?.portrait || token.imageUrl || null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {portrait
          ? <img src={portrait} alt="" style={S.detailPortrait} />
          : <div style={{ ...S.detailPortrait, ...S.portraitFallback }}>{(name[0] || '?')}</div>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 'var(--fs-lg)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
          {token.kind && <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>{token.kind === 'player' ? 'Spieler' : 'NSC'}</div>}
        </div>
      </div>
      {ac != null && <Stat label="AC" value={ac} icon="🛡" />}
      {hp != null && (
        <div style={{ ...S.stat, minWidth: 92 }}>
          <span style={S.statLbl}>HP</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button style={S.hpBtn} onClick={() => hpDelta(-1)}>−</button>
            <b style={{ fontSize: 16 }}>{hp}{hpMax ? `/${hpMax}` : ''}</b>
            <button style={S.hpBtn} onClick={() => hpDelta(1)}>+</button>
          </span>
        </div>
      )}
      {speed != null && <Stat label="Speed" value={`${speed}ft`} />}
      <div style={{ display: 'flex', gap: 6 }}>
        {ABILITY_KEYS.map((a) => abilities[a] != null && (
          <Stat key={a} label={a.toUpperCase()} value={modStr(getModifier(abilities[a]))} />
        ))}
      </div>
      {conds.length > 0 && <div style={S.conds}>{conds.map((c) => <span key={c} style={S.cond}>{c}</span>)}</div>}
      {token.characterId != null && (
        <button style={S.act} onClick={() => openSheetPopout(token.characterId, { route: `#/campaign/${campaignId}/character/${token.characterId}` })}>Sheet öffnen</button>
      )}
    </div>
  );
}

function PartyCard({ entry, campaignId }) {
  const ch = entry.data;
  const computed = useMemo(() => { try { return computeCharacter(ch); } catch { return null; } }, [ch]);
  if (!computed) return null;
  const status = ch.status || {};
  const max = computed.hp?.max ?? 0;
  const cur = status.currentHp ?? max;
  const temp = status.temporaryHp || 0;
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  const hpColor = cur <= 0 || pct < 25 ? 'var(--color-danger)' : pct < 50 ? 'var(--color-warning,#d98e00)' : 'var(--accent-green,#4ade80)';
  const conds = status.conditions || [];
  const name = ch.info?.name || entry.name || 'Charakter';
  const portrait = ch.appearance?.portrait || null;
  const subtitle = (ch.classes || []).map((c) => `${c.classId}${c.level ? ` ${c.level}` : ''}`).join(' / ') || (ch.species?.raceId?.split('__')[0] || '');
  const openSheet = () => openSheetPopout(entry.id, { route: `#/campaign/${campaignId}/character/${entry.id}` });
  const inspired = !!(status.inspiration || ch.info?.inspiration);

  return (
    <div style={S.card} onDoubleClick={openSheet} title="Doppelklick: Sheet öffnen">
      <div style={S.cardTop}>
        {portrait
          ? <img src={portrait} alt="" style={{ ...S.portrait, borderColor: hpColor }} />
          : <div style={{ ...S.portrait, ...S.portraitFallback, borderColor: hpColor }}>{name[0] || '?'}</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ ...S.name, flex: 1 }}>{name}</div>
            <button title={inspired ? 'Inspiration entfernen' : 'Inspiration geben'}
              onClick={(e) => { e.stopPropagation(); patchCombat(entry.id, { inspiration: !inspired }); }}
              style={{ ...S.insp, ...(inspired ? S.inspOn : null) }}>◆</button>
          </div>
          {subtitle && <div style={S.subtitle}>{subtitle}</div>}
          <div style={S.hpRow}>
            <b style={{ color: hpColor, fontSize: 14 }}>{cur}</b>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>/{max}</span>
            {temp > 0 && <span style={{ color: 'var(--accent-green,#4ade80)', fontWeight: 700, fontSize: 11 }}>+{temp}</span>}
            <div style={S.track}><div style={{ ...S.fill, width: `${pct}%`, background: hpColor }} /></div>
          </div>
        </div>
      </div>
      <div style={S.stats}>
        <Stat label="AC" value={computed.ac?.total ?? '—'} icon="🛡" />
        <Stat label="WN" value={computed.passivePerception} title="Passive Wahrnehmung" />
        <Stat label="NF" value={computed.passiveInvestigation} title="Passive Nachforschung" />
        <Stat label="EB" value={computed.passiveInsight} title="Passive Einsicht" />
      </div>
      {conds.length > 0 && (
        <div style={S.conds}>{conds.map((c) => <span key={c} style={S.cond}>{c}</span>)}</div>
      )}
    </div>
  );
}

function Stat({ label, value, title, icon }) {
  return (
    <span style={S.stat} title={title || label}>
      <span style={S.statLbl}>{icon ? `${icon} ` : ''}{label}</span>
      <b style={{ fontSize: 13 }}>{value}</b>
    </span>
  );
}

const S = {
  bar: { position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 0, maxWidth: 'calc(100% - 80px)', zIndex: 23, display: 'flex', flexDirection: 'column', background: 'color-mix(in srgb, var(--color-bg-elevated) 95%, transparent)', backdropFilter: 'blur(4px)', border: '1px solid var(--color-border)', borderBottom: 'none', borderRadius: '12px 12px 0 0', boxShadow: '0 -4px 20px #0007', overflow: 'hidden' },
  toggle: { padding: '4px 12px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 700 },
  row: { display: 'flex', gap: 10, padding: '10px 14px', overflowX: 'auto' },
  card: { flexShrink: 0, width: 210, display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: 'var(--radius-lg, 10px)', background: 'linear-gradient(180deg, var(--color-surface), var(--color-bg-sunken))', border: '1px solid var(--color-border)', cursor: 'pointer', transition: 'border-color 120ms' },
  cardTop: { display: 'flex', gap: 10, alignItems: 'center' },
  portrait: { width: 46, height: 46, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid', background: 'var(--color-bg-sunken)' },
  portraitFallback: { display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 20, color: 'var(--color-text-muted)' },
  name: { fontWeight: 700, fontSize: 'var(--fs-md)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  subtitle: { fontSize: 10, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 },
  hpRow: { display: 'flex', alignItems: 'center', gap: 4 },
  stats: { display: 'flex', gap: 6, justifyContent: 'space-between' },
  stat: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: '4px 2px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)' },
  statLbl: { fontSize: 8, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' },
  track: { flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginLeft: 4 },
  fill: { height: '100%', transition: 'width 150ms' },
  conds: { display: 'flex', flexWrap: 'wrap', gap: 3 },
  cond: { fontSize: 9, padding: '1px 6px', borderRadius: 999, background: 'color-mix(in srgb, var(--color-danger) 18%, transparent)', border: '1px solid color-mix(in srgb, var(--color-danger) 40%, transparent)', color: 'var(--color-danger)', textTransform: 'capitalize' },
  hpBtn: { width: 22, height: 22, border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer', fontWeight: 800, lineHeight: 1, padding: 0 },
  act: { padding: '6px 12px', fontSize: 'var(--fs-sm)', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' },
  detailPortrait: { width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid var(--color-border)', background: 'var(--color-bg-sunken)' },
  giveAll: { padding: '4px 12px', background: 'transparent', border: 'none', color: 'var(--color-warning,#e0af68)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 700, whiteSpace: 'nowrap' },
  insp: { width: 22, height: 22, flexShrink: 0, borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-muted)', cursor: 'pointer', fontWeight: 800, lineHeight: 1, padding: 0 },
  inspOn: { border: '1px solid var(--color-warning,#e0af68)', background: 'color-mix(in srgb, var(--color-warning,#e0af68) 22%, transparent)', color: 'var(--color-warning,#e0af68)' },
};
