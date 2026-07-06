// Compact statblock / character overlay, opened by double-clicking a token.
//   • NPC token (token.statblock): renders the 5etools statblock compactly.
//   • Player token (token.characterId): shows compact character stats from the
//     live character (loaded by the character binding) + a button to pop out
//     the full sheet.
// A floating, draggable-free panel over the map; Escape or × closes it.
import { useEffect, useRef, useState } from 'react';
import { useVtt, useSession } from '../state/useVtt';
import { getBoundCharacter } from '../sync/characterBinding';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';
import { openSheetPopout } from '../../character-builder/lib/sheetPopout';
import Icon from './Icon';

// Letzte Zeigerposition global mitschreiben, damit ein per Doppelklick
// geöffnetes Statblock-Fenster in der Nähe der Maus erscheint.
let _lastPointer = null;
if (typeof window !== 'undefined') {
  window.addEventListener('pointermove', (e) => { _lastPointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
  window.addEventListener('pointerdown', (e) => { _lastPointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
}

const SIZE_LABELS = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan' };
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export default function StatblockOverlay({ tokenId, index = 0, isGM, userId, onClose }) {
  const token = useVtt((s) => s.tokens[tokenId]);
  // Nahe der Maus öffnen (letzte Zeigerposition), leicht versetzt bei mehreren.
  const [pos, setPos] = useState(() => {
    const m = _lastPointer;
    const W = typeof window !== 'undefined' ? window.innerWidth : 800;
    const Hh = typeof window !== 'undefined' ? window.innerHeight : 600;
    const x = Math.min(W - 380, Math.max(12, (m ? m.x + 16 : W - 400))) + index * 22;
    const y = Math.min(Hh - 160, Math.max(60, (m ? m.y - 20 : 80))) + index * 22;
    return { x, y };
  });
  const [dragging, setDragging] = useState(false);
  const off = useRef({ dx: 0, dy: 0 });

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Drag by the header. Listeners live only while dragging.
  useEffect(() => {
    if (!dragging) return undefined;
    const move = (e) => setPos({ x: e.clientX - off.current.dx, y: e.clientY - off.current.dy });
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [dragging]);

  if (!token) return null;

  const startDrag = (e) => {
    off.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    setDragging(true);
  };

  return (
    <div style={{ ...S.panel, left: pos.x, top: pos.y }}>
      <div style={{ ...S.head, cursor: 'move' }} onMouseDown={startDrag}>
        <span style={{ fontWeight: 700 }}>{token.name}</span>
        <button style={S.close} onClick={onClose} onMouseDown={(e) => e.stopPropagation()} aria-label="Schließen">×</button>
      </div>
      {token.statblock
        ? <NpcStatblock m={token.statblock} />
        : <CharacterStub token={token} isGM={isGM} userId={userId} />}
    </div>
  );
}

// ── NPC: render the 5etools statblock compactly ──
function NpcStatblock({ m }) {
  const size = SIZE_LABELS[Array.isArray(m.size) ? m.size[0] : m.size] || '';
  const type = typeof m.type === 'string' ? m.type : (m.type?.type || '');
  const ac = acText(m.ac);
  const hp = m.hp?.average != null ? `${m.hp.average}${m.hp.formula ? ` (${m.hp.formula})` : ''}` : '—';
  const speed = speedText(m.speed);
  const sections = [
    ['Traits', m.trait], ['Actions', m.action], ['Bonus Actions', m.bonus],
    ['Reactions', m.reaction], ['Legendary', m.legendary],
  ];
  return (
    <div style={S.body}>
      <div style={S.sub}>{[size, type].filter(Boolean).join(' ')}{m.cr != null ? ` · CR ${crText(m.cr)}` : ''}</div>
      <div style={S.line}><b>AC</b> {ac} &nbsp; <b>HP</b> {hp}</div>
      {speed && <div style={S.line}><b>Speed</b> {speed}</div>}
      <div style={S.abilities}>
        {ABILITIES.map((a) => {
          const score = m[a];
          return (
            <div key={a} style={S.ab}>
              <div style={S.abName}>{a.toUpperCase()}</div>
              <div style={S.abVal}>{score != null ? `${score} (${mod(score)})` : '—'}</div>
            </div>
          );
        })}
      </div>
      {m.senses?.length ? <div style={S.lineSm}><b>Senses</b> {m.senses.join(', ')}</div> : null}
      {m.languages?.length ? <div style={S.lineSm}><b>Languages</b> {m.languages.join(', ')}</div> : null}
      {sections.map(([title, arr]) => (arr?.length ? (
        <div key={title} style={S.section}>
          <div style={S.sectionTitle}>{title}</div>
          {arr.map((e, i) => (
            <div key={i} style={S.entry}>
              {e.name && <span style={{ fontWeight: 700, fontStyle: 'italic' }}>{e.name}. </span>}
              {flattenEntries(e.entries)}
            </div>
          ))}
        </div>
      ) : null))}
    </div>
  );
}

// ── Player: compact live stats + open-full-sheet button ──
function CharacterStub({ token, isGM, userId }) {
  const session = useSession();
  const ch = getBoundCharacter(token.characterId);
  let computed = null;
  try { computed = ch?.data ? computeCharacter(ch.data) : null; } catch { computed = null; }
  const status = ch?.data?.status || {};
  const hp = status.currentHp ?? computed?.hp?.max;
  const openSheet = () => {
    // GM viewing someone else's token → read-only GM route; otherwise the
    // owner's editable sheet.
    const route = isGM && token.ownerId !== userId
      ? `#/campaign/${session.campaignId}/character/${token.characterId}`
      : undefined;
    openSheetPopout(token.characterId, { route });
  };
  return (
    <div style={S.body}>
      {computed ? (
        <>
          <div style={S.line}>
            <b>AC</b> {computed.ac?.total ?? '—'} &nbsp;
            <b>HP</b> {hp ?? '—'}{computed.hp?.max ? ` / ${computed.hp.max}` : ''} &nbsp;
            <b>Init</b> {fmt(computed.initiative)}
          </div>
          <div style={S.abilities}>
            {ABILITIES.map((a) => {
              const score = computed.abilityScores?.[a];
              return (
                <div key={a} style={S.ab}>
                  <div style={S.abName}>{a.toUpperCase()}</div>
                  <div style={S.abVal}>{score != null ? `${score} (${mod(score)})` : '—'}</div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={S.sub}>Charakterdaten nicht geladen.</div>
      )}
      {token.characterId != null && (
        <button style={S.sheetBtn} onClick={openSheet}><Icon src="/Assets/vtt/sheet.svg" emoji="📋" size={14} /> Vollständiges Sheet öffnen</button>
      )}
    </div>
  );
}

// ── helpers ──
function acText(ac) {
  if (Array.isArray(ac)) {
    const f = ac[0];
    if (typeof f === 'number') return String(f);
    if (f?.ac) return `${f.ac}${f.from ? ` (${f.from.map(resolveTags).join(', ')})` : ''}`;
  }
  return typeof ac === 'number' ? String(ac) : '—';
}
function speedText(sp) {
  if (!sp) return '';
  if (typeof sp === 'number') return `${sp} ft.`;
  return Object.entries(sp)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => (k === 'walk' ? `${v} ft.` : `${k} ${v} ft.`))
    .join(', ');
}
function crText(cr) { return typeof cr === 'object' ? (cr.cr ?? '—') : String(cr); }
function mod(score) { const m = Math.floor((score - 10) / 2); return (m >= 0 ? '+' : '') + m; }
function fmt(n) { const v = Number(n) || 0; return (v >= 0 ? '+' : '') + v; }

// Flatten 5etools entries (strings + nested objects) to plain text, stripping
// 5etools-Entries → lesbarer Text. Verschachtelte entries/items/Tabellen werden
// eingesammelt; alle {@tag …}-Markups über resolveTags aufgelöst.
function flattenEntries(entries) {
  if (entries == null) return '';
  if (typeof entries === 'string') return resolveTags(entries);
  if (Array.isArray(entries)) return entries.map(flattenEntries).filter(Boolean).join(' ');
  if (typeof entries === 'object') {
    const parts = [];
    if (entries.name && (entries.entries || entries.entry)) parts.push(`${entries.name}.`);
    if (entries.entries) parts.push(flattenEntries(entries.entries));
    else if (entries.entry) parts.push(flattenEntries(entries.entry));
    if (entries.items) parts.push(entries.items.map(flattenEntries).filter(Boolean).join(' · '));
    return parts.filter(Boolean).join(' ');
  }
  return '';
}

// Angriffs-Typ-Kürzel (2014 + 2024) → Klartext.
const ATK_TYPE = {
  mw: 'Melee Weapon Attack:', rw: 'Ranged Weapon Attack:', 'mw,rw': 'Melee or Ranged Weapon Attack:',
  ms: 'Melee Spell Attack:', rs: 'Ranged Spell Attack:', 'ms,rs': 'Melee or Ranged Spell Attack:',
  m: 'Melee Attack Roll:', r: 'Ranged Attack Roll:', 'm,r': 'Melee or Ranged Attack Roll:',
};

// Vollständige 5etools-Tag-Auflösung. Deckt die in Statblocks üblichen Tags ab;
// alles Unbekannte fällt auf den ersten Segment-Text zurück (kein rohes {@…}).
function resolveTags(str) {
  let s = String(str);
  // Zuerst Tags OHNE Argumente (fester Ersatztext).
  s = s.replace(/\{@(h|hom|actSaveFail|actSaveSuccess|actSaveSuccessOrFail|actTrigger|actResponse)\}/g, (_, t) => ({
    h: 'Treffer: ', hom: 'Treffer oder Fehlschlag: ',
    actSaveFail: 'Misserfolg: ', actSaveSuccess: 'Erfolg: ', actSaveSuccessOrFail: 'Erfolg oder Misserfolg: ',
    actTrigger: 'Auslöser: ', actResponse: 'Reaktion: ',
  }[t] || ''));
  // Dann Tags MIT Argumenten (Pipe-getrennt; erstes Segment = Anzeige).
  s = s.replace(/\{@(\w+)(?:\s+([^}]*))?\}/g, (_, tag, args) => {
    const a = args != null ? String(args).split('|') : [];
    const first = a[0] != null ? a[0] : '';
    switch (tag) {
      case 'atk': case 'atkr': return ATK_TYPE[first.trim()] || first;
      case 'hit': case 'h': return (first.startsWith('-') ? '' : '+') + first;
      case 'dc': return `DC ${first}`;
      case 'recharge': return first ? `(Aufladen ${first}${(+first > 1 && +first < 6) ? '–6' : ''})` : '(Aufladen 6)';
      case 'actSave': return `${first.toUpperCase()}-Rettungswurf`;
      case 'chance': return `${first}%`;
      case 'damage': case 'dice': case 'scaledamage': case 'scaledice': case 'd20': case 'hitYourSpellAttack':
        return first;
      default: return first; // creature/spell/item/condition/skill/sense/variantrule/…
    }
  });
  // "Emanation [Area of Effect]" & Co.: der 5etools-Klammer-Zusatz raus.
  s = s.replace(/\s*\[Area of Effect\]/g, '');
  return s;
}

const S = {
  panel: { position: 'fixed', zIndex: 1000, width: 360, maxHeight: '80vh', overflowY: 'auto', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 10px 40px #000b', padding: 12 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--color-border)', userSelect: 'none' },
  close: { width: 26, height: 26, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1 },
  body: { display: 'flex', flexDirection: 'column', gap: 8, fontSize: 'var(--fs-sm)' },
  sub: { color: 'var(--color-text-muted)', fontStyle: 'italic' },
  line: { lineHeight: 1.5 },
  lineSm: { fontSize: 11, color: 'var(--color-text-muted)' },
  abilities: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 },
  ab: { background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '3px 0', textAlign: 'center' },
  abName: { fontSize: 9, color: 'var(--color-text-muted)', fontWeight: 700 },
  abVal: { fontSize: 11, fontWeight: 700 },
  section: { borderTop: '1px solid var(--color-border)', paddingTop: 6 },
  sectionTitle: { fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-accent)', marginBottom: 4 },
  entry: { fontSize: 11, lineHeight: 1.45, marginBottom: 6, color: 'var(--color-text)' },
  sheetBtn: { marginTop: 4, padding: '6px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' },
};
