// In-VTT character sheet — "Combat" category (player's own character).
//
// Reads the live character mirrored into the store by the character binding
// (ui.characters / ui.myCharacterId) so it stays in sync with the sheet, the
// session view and other clients. Combat-state edits (HP, conditions) write
// through the dnd_patch_combat_state RPC via patchCombat, exactly like the
// token context menu — so everything converges.
//
// VTT-native styling (no sheet-page chrome); the first of several sidebar
// categories (Spells / Inventory / Features come next).
import { useMemo, useState } from 'react';
import { useVtt } from '../state/useVtt';
import { patchCombat, applyOwnCharacter } from '../sync/characterBinding';
import CurrencyDots from './CurrencyDots';
import { CONDITIONS } from '../lib/constants';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';
import { modStr, ABILITY_KEYS } from '../../character-builder/lib/sheetUtils';
import { getModifier } from '../../character-builder/lib/characterModel';
import { rollSave } from '../lib/rollDice';

export default function CharacterSheetPanel() {
  const chars = useVtt((s) => s.ui.characters || {});
  const myId = useVtt((s) => s.ui.myCharacterId);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const ch = myId != null ? chars[myId] : null;
  const character = ch?.data || null;
  const computed = useMemo(() => {
    if (!character) return null;
    try { return computeCharacter(character); } catch { return null; }
  }, [character]);

  if (!character) return <div style={S.muted}>Kein Charakter geladen.</div>;
  if (!computed) return <div style={S.muted}>Charakter unvollständig (kein Level?).</div>;

  const status = character.status || {};
  const max = computed.hp?.max ?? null;
  const cur = status.currentHp ?? max;
  const temp = status.temporaryHp || 0;
  const conditions = status.conditions || [];

  const bumpHp = (d) => { if (cur == null || max == null) return; patchCombat(myId, { currentHp: Math.max(0, Math.min(max, cur + d)) }); };
  const toggleCond = (id) => {
    const next = conditions.includes(id) ? conditions.filter((c) => c !== id) : [...conditions, id];
    patchCombat(myId, { conditions: next });
  };

  const ac = computed.ac?.total ?? '—';
  const init = computed.initiative ?? 0;
  const sp = computed.speed;
  const walk = typeof sp?.walk === 'number' ? sp.walk : (typeof sp === 'number' ? sp : '—');
  const pp = computed.passivePerception ?? (10 + (computed.skills?.perception?.total ?? 0));
  const tone = hpTone(cur, max);

  const portrait = character.appearance?.portrait;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Portrait + name (top of the Character tab) */}
      <div style={S.portraitWrap}>
        {portrait
          ? <img src={portrait} alt="" style={S.portrait} />
          : <div style={{ ...S.portrait, display: 'grid', placeItems: 'center', fontSize: 40, color: 'var(--color-text-muted)' }}>⚔</div>}
        <div style={S.portraitName}>{character.info?.name || ch?.name || 'Charakter'}</div>
        <CurrencyDots
          currency={character.inventory?.currency}
          onChange={(k, v) => applyOwnCharacter(myId, (d) => {
            if (!d.inventory) d.inventory = { items: [], currency: {} };
            if (!d.inventory.currency) d.inventory.currency = {};
            d.inventory.currency[k] = v;
          })}
        />
      </div>

      {/* HP */}
      <div>
        <div style={{ ...S.hpBox, borderColor: tone }}>
          <span style={S.lbl}>HP</span>
          <span style={{ fontWeight: 800, fontSize: 18 }}>{cur}<span style={S.dim}>/{max}</span></span>
          {temp > 0 && <span style={{ color: 'var(--accent-green,#4ade80)', fontWeight: 700 }}>+{temp}</span>}
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <HpBtn onClick={() => bumpHp(-5)}>−5</HpBtn>
          <HpBtn onClick={() => bumpHp(-1)}>−1</HpBtn>
          <HpBtn onClick={() => bumpHp(+1)}>+1</HpBtn>
          <HpBtn onClick={() => bumpHp(+5)}>+5</HpBtn>
        </div>
      </div>

      {/* Top stats */}
      <div style={S.tiles}>
        <Stat label="AC" value={ac} />
        <Stat label="Init" value={modStr(init)} />
        <Stat label="Speed" value={walk} />
        <Stat label="PP" value={pp} />
      </div>

      {/* Abilities + saves */}
      <div style={S.abilities}>
        {ABILITY_KEYS.map((k) => {
          const score = computed.abilityScores?.[k] ?? 10;
          const mod = getModifier(score);
          const save = computed.savingThrows?.[k]?.total ?? mod;
          const K = k.toUpperCase();
          return (
            <div key={k} style={S.ab}>
              <div style={S.abName}>{K}</div>
              <div style={S.abScore}>{score}</div>
              <div role="button" tabIndex={0} style={{ ...S.abMod, cursor: 'pointer' }}
                title={`${K}-Attributswurf — Shift: Vorteil · Strg: Nachteil`}
                onClick={(ev) => rollSave(ev, mod, `${K}-Attributswurf`)}>{modStr(mod)}</div>
              <div role="button" tabIndex={0} style={{ ...S.abSave, cursor: 'pointer' }}
                title={`${K}-Rettungswurf — Shift: Vorteil · Strg: Nachteil`}
                onClick={(ev) => rollSave(ev, save, `${K}-Rettungswurf`)}>{modStr(save)}</div>
            </div>
          );
        })}
      </div>

      {/* Conditions */}
      <div>
        <div style={S.lbl}>Conditions</div>
        <div style={S.condGrid}>
          {CONDITIONS.map((c) => {
            const on = conditions.includes(c.id);
            return (
              <button key={c.id} title={c.label} onClick={() => toggleCond(c.id)}
                style={{ ...S.cond, ...(on ? { background: c.color, borderColor: c.color } : null) }}>
                <img src={c.icon} alt={c.label} style={{ width: 26, height: 26 }} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Skills (expandable) */}
      <div>
        <button style={S.section} onClick={() => setSkillsOpen((o) => !o)}>
          <span style={{ width: 12 }}>{skillsOpen ? '▾' : '▸'}</span> Fertigkeiten
        </button>
        {skillsOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
            {SKILLS.map(([name, ab]) => {
              const sk = computed.skills?.[name];
              const total = sk?.total ?? getModifier(computed.abilityScores?.[ab] ?? 10);
              const prof = sk?.proficient || sk?.expertise;
              // Same colour logic as the sheet: expertise stands out, proficiency
              // tints the whole row (name + value).
              const txtColor = sk?.expertise ? 'var(--accent-purple, #b98cff)' : sk?.proficient ? 'var(--color-accent)' : 'var(--color-text)';
              const dot = sk?.expertise ? 'var(--accent-purple, #b98cff)' : sk?.proficient ? 'var(--color-accent)' : 'transparent';
              return (
                <div key={name} role="button" tabIndex={0} style={{ ...S.skillRow, color: txtColor, cursor: 'pointer' }}
                  title={`${name} würfeln${sk?.expertise ? ' (Expertise)' : sk?.proficient ? ' (Übung)' : ''} — Shift: Vorteil · Strg: Nachteil`}
                  onClick={(ev) => rollSave(ev, total, `${name.charAt(0).toUpperCase()}${name.slice(1)} (Fertigkeit)`)}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, border: '1px solid var(--color-border)', flexShrink: 0 }} />
                  <span style={{ flex: 1, textTransform: 'capitalize', fontWeight: prof ? 700 : 400 }}>{name}</span>
                  <span style={{ fontWeight: 700 }}>{modStr(total)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const SKILLS = [
  ['acrobatics', 'dex'], ['animal handling', 'wis'], ['arcana', 'int'], ['athletics', 'str'],
  ['deception', 'cha'], ['history', 'int'], ['insight', 'wis'], ['intimidation', 'cha'],
  ['investigation', 'int'], ['medicine', 'wis'], ['nature', 'int'], ['perception', 'wis'],
  ['performance', 'cha'], ['persuasion', 'cha'], ['religion', 'int'], ['sleight of hand', 'dex'],
  ['stealth', 'dex'], ['survival', 'wis'],
];

function hpTone(cur, max) {
  if (cur == null || max == null || max <= 0) return 'var(--color-border)';
  const pct = cur / max;
  if (cur <= 0 || pct <= 0.25) return 'var(--color-danger)';
  if (pct <= 0.5) return 'var(--color-warning, #d98e00)';
  return 'var(--color-border)';
}

function HpBtn({ children, onClick }) {
  return <button onClick={onClick} style={S.hpBtn}>{children}</button>;
}
function Stat({ label, value }) {
  return (
    <div style={S.tile}>
      <div style={S.tileLbl}>{label}</div>
      <div style={S.tileVal}>{value}</div>
    </div>
  );
}

const S = {
  muted: { color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' },
  portraitWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
  portrait: { width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-sunken)' },
  portraitName: { fontWeight: 700, fontSize: 'var(--fs-md)', textAlign: 'center' },
  lbl: { fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  dim: { color: 'var(--color-text-muted)', fontWeight: 400 },
  hpBox: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-sunken)' },
  hpBtn: { flex: 1, padding: '5px 0', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700, fontSize: 'var(--fs-sm)' },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 },
  tile: { background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 0', textAlign: 'center' },
  tileLbl: { fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase' },
  tileVal: { fontWeight: 800, fontSize: 14 },
  abilities: { display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 3 },
  ab: { background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '3px 0', textAlign: 'center' },
  abName: { fontSize: 8, fontWeight: 800, color: 'var(--color-text-muted)' },
  abScore: { fontSize: 13, fontWeight: 700 },
  abMod: { fontSize: 11 },
  abSave: { fontSize: 10, color: 'var(--color-accent)', fontWeight: 700, borderTop: '1px solid var(--color-border)', marginTop: 2, paddingTop: 1 },
  condGrid: { display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 4 },
  cond: { aspectRatio: '1', display: 'grid', placeItems: 'center', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' },
  section: { width: '100%', display: 'flex', alignItems: 'center', gap: 4, padding: '6px 4px', background: 'transparent', color: 'var(--color-text)', border: 'none', borderTop: '1px solid var(--color-border)', cursor: 'pointer', fontWeight: 600, fontSize: 'var(--fs-sm)', textAlign: 'left' },
  skillRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', padding: '1px 4px' },
};
