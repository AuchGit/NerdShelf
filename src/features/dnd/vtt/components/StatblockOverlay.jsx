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

// Rohtext einer Entry (Tags BLEIBEN erhalten) — für die Mechanik-Extraktion.
function rawText(e) {
  if (e == null) return '';
  if (typeof e === 'string') return e;
  if (Array.isArray(e)) return e.map(rawText).join(' ');
  if (typeof e === 'object') {
    const p = [];
    if (e.entries) p.push(rawText(e.entries)); else if (e.entry) p.push(rawText(e.entry));
    if (e.items) p.push(e.items.map(rawText).join(' '));
    return p.join(' ');
  }
  return '';
}
// Aus dem Roh-Text einer Aktion die würfelbaren Werte ziehen: Angriffsbonus
// ({@hit}/{@atk}), Schaden ({@damage/@dice} + Typ), Rettungswurf-DC ({@dc},
// {@actSave}). Wird als klickbare Wurf-Badges gerendert.
function actionRolls(e) {
  // Name mitscannen: {@recharge}/N-per-day stehen oft im Namen (z.B. "Acid
  // Breath {@recharge 5}").
  const raw = `${rawText(e?.name || '')} ${rawText(e?.entries || e)}`;
  const out = { atk: null, damages: [], dc: null, save: null, recharge: null, uses: null };
  const hit = /\{@hit ([+-]?\d+)\}/.exec(raw) || /\{@atk[r]? [^}]*\}\s*([+-]?\d+)/.exec(raw);
  if (hit) out.atk = (hit[1].startsWith('-') ? '' : '+') + hit[1];
  const dc = /\{@dc (\d+)\}/.exec(raw); if (dc) out.dc = dc[1];
  const sv = /\{@actSave (\w+)\}/i.exec(raw) || /\b(str|dex|con|int|wis|cha)\b\s+saving throw/i.exec(raw);
  if (sv) out.save = sv[1].toUpperCase();
  // "{@damage 4d10 + 5} Radiant damage" → {formula:"4d10+5", type:"Radiant"}
  for (const m of raw.matchAll(/\{@(?:damage|dice) ([^}|]+)[^}]*\}\s*(?:\(?[^)]*\)?\s*)?(\w+)?\s*damage/gi)) {
    const formula = m[1].replace(/\s+/g, '');
    if (/\d*d\d+/.test(formula)) out.damages.push({ formula, type: m[2] || '' });
  }
  const rc = /\{@recharge ?(\d*)\}/.exec(raw); if (rc) out.recharge = rc[1] ? `Aufladen ${rc[1]}–6` : 'Aufladen 6';
  const us = /(\d+)\/(day|short rest|long rest|turn)/i.exec(raw);
  if (us) out.uses = `${us[1]}/${us[2].toLowerCase().replace('day', 'Tag').replace('short rest', 'Kurze Rast').replace('long rest', 'Lange Rast').replace('turn', 'Zug')}`;
  return out;
}
const roll = (formula, label) => window.dispatchEvent(new CustomEvent('vtt:roll', { detail: { formula, label } }));

// Eine Aktion/Reaktion/… mit würfelbaren Badges (Angriff/Schaden/Rettung) +
// Beschreibungstext. Badges → klick würfelt in den Würfel-Tray.
function ActionEntry({ e }) {
  const r = actionRolls(e);
  const hasBadges = r.atk || r.damages.length || r.dc || r.recharge || r.uses;
  // Name auflösen (Tags) und den Aufladen-Zusatz raus (steht als Badge).
  const name = resolveTags(String(e?.name || '')).replace(/\s*\(Aufladen[^)]*\)/i, '').replace(/\s*\(Recharge[^)]*\)/i, '').trim();
  return (
    <div style={S.entry}>
      {name && <span style={S.entryName}>{name}. </span>}
      {hasBadges && (
        <span style={S.badges}>
          {r.recharge && <span style={S.badgeGray}>{r.recharge}</span>}
          {r.uses && <span style={S.badgeGray}>{r.uses}</span>}
          {r.atk && <button style={S.badgeAtk} title="Angriffswurf würfeln" onClick={() => roll(`1d20${r.atk}`, `${e.name}: Angriff`)}>🎲 {r.atk}</button>}
          {r.dc && <span style={S.badgeSave}>DC {r.dc}{r.save ? ` ${r.save}` : ''}</span>}
          {r.damages.map((d, i) => (
            <button key={i} style={S.badgeDmg} title="Schaden würfeln" onClick={() => roll(d.formula, `${e.name}: Schaden`)}>{d.formula}{d.type ? ` ${d.type}` : ''}</button>
          ))}
        </span>
      )}
      <span style={S.entryText}>{flattenEntries(e?.entries || e)}</span>
    </div>
  );
}

// Kompakte Verteidigungs-/Sinne-Zeile: farbiges Chip-Label + Wert.
function DefRow({ label, val, tone }) {
  if (!val) return null;
  return (
    <div style={S.defRow}>
      <span style={{ ...S.defLabel, ...(tone ? { color: tone, borderColor: `color-mix(in srgb, ${tone} 45%, transparent)` } : null) }}>{label}</span>
      <span style={S.defVal}>{val}</span>
    </div>
  );
}

// ── NPC: render the 5etools statblock compactly ──
function NpcStatblock({ m }) {
  const size = SIZE_LABELS[Array.isArray(m.size) ? m.size[0] : m.size] || '';
  const type = typeof m.type === 'string' ? m.type : (m.type?.type || '');
  // AC/HP getrennt in "große Zahl" + "kleiner Zusatz", damit die Kacheln auch
  // bei langen Quellen ("+2 Studded Leather …") ordentlich aussehen.
  const acN = acNum(m.ac); const acNote = acFrom(m.ac);
  const hpN = m.hp?.average != null ? String(m.hp.average) : '—';
  const hpNote = m.hp?.formula || '';
  const speed = speedText(m.speed);
  const lg = m._legendaryGroup || null;
  const sections = [
    ['Traits', m.trait], ['Actions', m.action], ['Bonus Actions', m.bonus],
    ['Reactions', m.reaction], ['Legendary', m.legendary], ['Mythic', m.mythic],
    // Lair Actions / Regionale Effekte kommen aus der Legendary Group
    // (per 5e.tools-Import nachgeladen).
    ['Lair Actions', lg?.lairActions], ['Regional Effects', lg?.regionalEffects],
  ];
  return (
    <div style={S.body}>
      {/* Typ + CR-Badge in einer Zeile, sofort erfassbar. */}
      <div style={S.metaRow}>
        <span style={S.sub}>{[size, type].filter(Boolean).join(' ') || '—'}</span>
        {m.cr != null && <span style={S.crBadge}>CR {crText(m.cr)} · PB +{pbFromCr(m.cr)}</span>}
      </div>
      {/* Kern-Kampfwerte als Kacheln (AC / HP / Speed) — schnell scannbar. */}
      <div style={S.statTiles}>
        <div style={S.tile}><div style={S.tileLabel}>🛡 AC</div><div style={S.tileVal}>{acN}</div>{acNote && <div style={S.tileNote}>{acNote}</div>}</div>
        <div style={S.tile}><div style={S.tileLabel}>❤ HP</div><div style={S.tileVal}>{hpN}</div>{hpNote && <div style={S.tileNote}>{hpNote}</div>}</div>
        {speed && <div style={S.tile}><div style={S.tileLabel}>👟 Speed</div><div style={S.tileValSm}>{speed}</div></div>}
      </div>
      <div style={S.abilities}>
        {ABILITIES.map((a) => {
          const score = m[a];
          return (
            <div key={a} style={S.ab}>
              <div style={S.abName}>{a.toUpperCase()}</div>
              <div style={S.abVal}>{score != null ? score : '—'}</div>
              <div style={S.abMod}>{score != null ? mod(score) : ''}</div>
            </div>
          );
        })}
      </div>
      {/* Verteidigung / Sinne als kompakte Label-Zeilen mit Chip-Label. */}
      <div style={S.defs}>
        {m.save && <DefRow label="Rettungswürfe" val={bonusObj(m.save)} />}
        {m.skill && <DefRow label="Fertigkeiten" val={bonusObj(m.skill)} />}
        {m.vulnerable?.length ? <DefRow label="Verwundbar" val={typeList(m.vulnerable)} tone="#ff9e64" /> : null}
        {m.resist?.length ? <DefRow label="Resistenzen" val={typeList(m.resist)} tone="#7dcfff" /> : null}
        {m.immune?.length ? <DefRow label="Immunitäten" val={typeList(m.immune)} tone="#4ade80" /> : null}
        {m.conditionImmune?.length ? <DefRow label="Zustandsimmun" val={typeList(m.conditionImmune)} tone="#4ade80" /> : null}
        {(m.senses?.length || m.passive != null) ? <DefRow label="Sinne" val={sensesText(m)} /> : null}
        {m.languages?.length ? <DefRow label="Sprachen" val={m.languages.map(resolveTags).join(', ')} /> : null}
      </div>
      {/* Zauberwirken: Slots pro Grad + Zauberlisten (Klassen- + innate). */}
      {(Array.isArray(m.spellcasting) ? m.spellcasting : []).map((sc, si) => {
        const scHdr = rawText(sc.headerEntries || []);
        const scDc = /\{@dc (\d+)\}/.exec(scHdr)?.[1];
        const scAtk = /\{@hit ([+-]?\d+)\}/.exec(scHdr)?.[1] || /([+-]?\d+) to hit with spell/i.exec(scHdr)?.[1];
        const scAbi = (sc.ability || '').toUpperCase(); // WIS/INT/CHA
        return (
          <div key={`sc${si}`} style={S.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
              <div style={S.sectionTitle}>{sc.name || 'Zauberwirken'}</div>
              <span style={S.badges}>
                {scDc && <span style={S.badgeSave}>{scAbi ? `${scAbi} ` : ''}DC {scDc}</span>}
                {scAtk && <button style={S.badgeAtk} title="Zauberangriff würfeln" onClick={() => roll(`1d20${scAtk.startsWith('-') ? '' : '+'}${scAtk}`, 'Zauberangriff')}>🎲 {scAtk.startsWith('-') ? '' : '+'}{scAtk}</button>}
              </span>
            </div>
            {spellcastingBlocks(sc).map((b, bi) => (
              <div key={bi} style={b.label ? S.spellLine : S.entryText}>
                {b.label && <span style={S.spellLevel}>{b.label}</span>}{b.text}
              </div>
            ))}
          </div>
        );
      })}
      {sections.map(([title, arr]) => (arr?.length ? (
        <div key={title} style={S.section}>
          <div style={S.sectionTitle}>{title}</div>
          {arr.map((e, i) => <ActionEntry key={i} e={e} />)}
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
function acNum(ac) {
  if (Array.isArray(ac)) { const f = ac[0]; return String(typeof f === 'number' ? f : (f?.ac ?? '—')); }
  return typeof ac === 'number' ? String(ac) : '—';
}
function acFrom(ac) {
  if (Array.isArray(ac)) { const f = ac[0]; if (f?.from?.length) return f.from.map(resolveTags).join(', '); }
  return '';
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
// Proficiency bonus aus der CR (5e-Tabelle) ableiten, wenn nicht angegeben.
function pbFromCr(cr) {
  const c = typeof cr === 'object' ? (cr.cr ?? cr) : cr;
  const n = c === '1/8' ? 0.125 : c === '1/4' ? 0.25 : c === '1/2' ? 0.5 : parseFloat(c);
  if (!Number.isFinite(n)) return 2;
  return Math.max(2, Math.floor((Math.max(0, n) - 1) / 4) + 2);
}
// {str:"+5",…} → "STR +5, DEX +3". Speichern/Skills sind so kodiert.
function bonusObj(o) {
  if (!o || typeof o !== 'object') return '';
  return Object.entries(o).map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)} ${resolveTags(String(v))}`).join(', ');
}
// resist/immune/vulnerable/conditionImmune: Array aus Strings ODER
// {resist:[…],note} / {immune:[…]} / {special:"…"} → lesbare Liste.
function typeList(arr) {
  if (!Array.isArray(arr)) return '';
  const out = [];
  for (const e of arr) {
    if (typeof e === 'string') out.push(resolveTags(e));
    else if (e && typeof e === 'object') {
      const inner = e.resist || e.immune || e.vulnerable || e.conditionImmune || [];
      const list = inner.map((x) => (typeof x === 'string' ? resolveTags(x) : '')).filter(Boolean).join(', ');
      const pre = e.preNote ? `${resolveTags(e.preNote)} ` : '';
      const note = e.note ? ` ${resolveTags(e.note)}` : '';
      out.push(`${pre}${list}${note}`.trim() || (e.special ? resolveTags(e.special) : ''));
    }
  }
  return out.filter(Boolean).join('; ');
}
// Sinne inkl. passiver Wahrnehmung. Darkvision & Co. stehen in m.senses.
function sensesText(m) {
  const parts = (m.senses || []).map(resolveTags);
  if (m.passive != null) parts.push(`passive Perception ${m.passive}`);
  return parts.join(', ');
}
// Spellcasting-Trait (Klassenzauber + innate) → strukturierte Blöcke:
//   Kopftext, Cantrips (at will), Level-Slots + Spells, At-will/N/day innate.
function spellcastingBlocks(sc) {
  const blocks = [];
  const spellLine = (label, spells) => spells?.length
    ? { label, text: spells.map((s) => resolveTags(String(s))).join(', ') } : null;
  if (Array.isArray(sc.headerEntries)) {
    const t = flattenEntries(sc.headerEntries);
    if (t) blocks.push({ label: '', text: t });
  }
  // Slot-Zauber pro Grad (0 = Cantrips „at will").
  for (const lvl of Object.keys(sc.spells || {}).sort()) {
    const g = sc.spells[lvl];
    if (!g) continue;
    const label = lvl === '0' ? 'Zaubertricks (nach Belieben)'
      : `Grad ${lvl}${g.slots ? ` (${g.slots} ${g.slots === 1 ? 'Slot' : 'Slots'})` : g.slots === 0 ? ' (0 Slots)' : ''}`;
    const b = spellLine(label, g.spells);
    if (b) blocks.push(b);
  }
  // Innate: at-will + N/day.
  const w = spellLine('Nach Belieben', sc.will); if (w) blocks.push(w);
  for (const key of Object.keys(sc.daily || {})) {
    const n = key.replace('e', ''); const each = key.endsWith('e') ? ' je' : '';
    const b = spellLine(`${n}/Tag${each}`, sc.daily[key]); if (b) blocks.push(b);
  }
  const r = spellLine('Ritual', sc.ritual); if (r) blocks.push(r);
  return blocks;
}

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
  panel: { position: 'fixed', zIndex: 1000, width: 390, maxHeight: '82vh', overflowY: 'auto', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 10px 40px #000b', padding: 12 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--color-border)', userSelect: 'none' },
  close: { width: 26, height: 26, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1 },
  body: { display: 'flex', flexDirection: 'column', gap: 8, fontSize: 'var(--fs-sm)' },
  metaRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  sub: { color: 'var(--color-text-muted)', fontStyle: 'italic' },
  crBadge: { flexShrink: 0, fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, color: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)' },
  line: { lineHeight: 1.5 },
  lineSm: { fontSize: 11, color: 'var(--color-text-muted)' },
  // Kern-Kampfwerte als Kacheln.
  statTiles: { display: 'flex', gap: 6 },
  tile: { flex: 1, minWidth: 0, background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '5px 8px' },
  tileLabel: { fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 },
  tileVal: { fontSize: 18, fontWeight: 800, lineHeight: 1.1 },
  tileValSm: { fontSize: 11, fontWeight: 600, lineHeight: 1.3 },
  tileNote: { fontSize: 9, color: 'var(--color-text-muted)', lineHeight: 1.25, marginTop: 1 },
  abilities: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 },
  ab: { background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '4px 0 3px', textAlign: 'center' },
  abName: { fontSize: 9, color: 'var(--color-text-muted)', fontWeight: 700 },
  abVal: { fontSize: 13, fontWeight: 800, lineHeight: 1.1 },
  abMod: { fontSize: 10, fontWeight: 700, color: 'var(--color-accent)' },
  // Verteidigung/Sinne: Chip-Label + Wert, kompakt & scannbar.
  defs: { display: 'flex', flexDirection: 'column', gap: 3 },
  defRow: { display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 11, lineHeight: 1.4 },
  defLabel: { flexShrink: 0, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '1px 5px' },
  defVal: { color: 'var(--color-text)' },
  section: { borderTop: '1px solid var(--color-border)', paddingTop: 6 },
  sectionTitle: { fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--color-accent)', marginBottom: 5 },
  entry: { fontSize: 11, lineHeight: 1.5, marginBottom: 7, color: 'var(--color-text)' },
  entryName: { fontWeight: 800, color: 'var(--color-text)' },
  entryText: { display: 'block', marginTop: 2, color: 'var(--color-text-muted)' },
  // Würfelbare/Info-Badges einer Aktion.
  badges: { display: 'inline-flex', flexWrap: 'wrap', gap: 4, verticalAlign: 'middle' },
  badgeAtk: { fontSize: 10, fontWeight: 800, padding: '1px 7px', borderRadius: 999, cursor: 'pointer', color: '#e0af68', background: 'color-mix(in srgb, #e0af68 16%, transparent)', border: '1px solid color-mix(in srgb, #e0af68 45%, transparent)' },
  badgeDmg: { fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999, cursor: 'pointer', color: '#ff6b6b', background: 'color-mix(in srgb, #ff6b6b 14%, transparent)', border: '1px solid color-mix(in srgb, #ff6b6b 45%, transparent)' },
  badgeSave: { fontSize: 10, fontWeight: 800, padding: '1px 7px', borderRadius: 999, color: '#9ab3d6', background: 'color-mix(in srgb, #9ab3d6 16%, transparent)', border: '1px solid color-mix(in srgb, #9ab3d6 45%, transparent)' },
  badgeGray: { fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999, color: 'var(--color-text-muted)', background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border)' },
  spellLine: { fontSize: 11, lineHeight: 1.5, marginBottom: 3, color: 'var(--color-text)' },
  spellLevel: { display: 'inline-block', minWidth: 92, fontWeight: 800, color: 'var(--color-accent)', marginRight: 4 },
  sheetBtn: { marginTop: 4, padding: '6px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' },
};
