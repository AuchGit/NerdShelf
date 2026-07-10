// VTT-native spell list: the character's spells resolved against the catalog,
// grouped by level, shown as a compact table (range / area / casting time +
// concentration/ritual pills). Each row expands to the description, an upcast
// ("at higher levels") section and a per-spell note. Casting a leveled spell
// spends a slot (patchCombat). Read-resolution reuses the sheet's helpers; no
// preparation editing here (that stays on the full sheet).
import { useEffect, useMemo, useState } from 'react';
import { useVtt } from '../state/useVtt';
import { patchCombat, applyOwnCharacter } from '../sync/characterBinding';
import { collectCharacterSpells, computeSpellSlots, spellLevelLabel } from '../../character-builder/lib/sheetUtils';
import { loadSpellList } from '../../character-builder/lib/dataLoader';
import { deriveSpellArea, DAMAGE_TYPE_COLOR } from '../../character-builder/lib/spellEffectParser';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';
import { Pinnable } from './tooltip/Tooltips';
import { rollAttack, rollDamage } from '../lib/rollDice';
import { addZone, setZoneTool, setZoneParam } from '../state/actions';
import { getSpellcastingInfo } from '../../character-builder/lib/spellcastingRules';
import SpellPrepareModal from '../../character-builder/components/sheet/SpellPrepareModal';
import { toast } from '../lib/toast';

function setPath(obj, path, value) {
  const keys = path.split('.'); let o = obj;
  for (let i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = value;
}

// Upcast-Schaden: {@scaledamage 8d6|3-9|1d6} aus entriesHigherLevel auf den
// gewirkten Grad hochrechnen. Gleiche Würfelgröße → zusammengefasste Formel
// ("10d6"), sonst lesbare Summe. Ohne Skalierung → Basis-Formel.
function scaledDamage(sp, castLevel) {
  const base = spellDamageFormula(sp);
  if (!base) return null;
  const raw = JSON.stringify(sp?.entriesHigherLevel || []) + JSON.stringify(sp?.entries || []);
  const m = /\{@scaledamage ([^}|]+)\|(\d+)-\d+\|([^}|]+)\}/.exec(raw);
  if (!m || !castLevel) return base;
  const extra = Math.max(0, castLevel - (+m[2]));
  if (!extra) return base;
  const step = m[3].replace(/\s+/g, '');
  const sm = /^(\d*)d(\d+)$/.exec(step);
  const bm = /^(\d*)d(\d+)(.*)$/.exec(base);
  if (sm && bm && sm[2] === bm[2]) return `${(+bm[1] || 1) + extra * (+sm[1] || 1)}d${bm[2]}${bm[3] || ''}`;
  return `${base}+${extra}x${step}`;
}

// "20 ft. Sphere" / "15 ft. Cone" / "30 ft. Line (5 ft. wide)" (deriveSpellArea)
// → platzierbare Zonen-Definition { type, params }. Datengetrieben aus dem
// Area-String; unbekannte/größenlose Shapes → null (kein Button).
function zoneFromArea(area) {
  const m = /^(\d+) ft\. (\w+)/.exec(area || '');
  if (!m) return null;
  const n = +m[1];
  switch (m[2]) {
    case 'Sphere': case 'Radius': case 'Cylinder': case 'Hemisphere':
      return { type: 'circle', params: { radiusFt: n } };
    case 'Cone':
      return { type: 'cone', params: { lengthFt: n } };
    case 'Cube': case 'Square':
      return { type: 'square', params: { sideFt: n } };
    case 'Line': {
      const w = /\((\d+) ft\. wide\)/.exec(area);
      return { type: 'line', params: { lengthFt: n, widthFt: w ? +w[1] : 5 } };
    }
    default: return null;
  }
}
// Selbst-Ursprung: 5etools kodiert Kegel/Linie/Würfel VOM Zaubernden aus als
// range.type (cone/line/cube/sphere/…) statt 'point'; dazu distance 'self'.
function isSelfOrigin(sp) {
  const r = sp?.range;
  if (!r) return false;
  if (r.type && r.type !== 'point') return true;
  return r.distance?.type === 'self';
}

// First rollable damage in a spell's entries ({@damage XdY} / {@scaledamage}).
function spellDamageFormula(sp) {
  const raw = JSON.stringify(sp?.entries || []);
  const m = /\{@(?:damage|dice) ([^}|]+)/.exec(raw);
  if (m) { const f = m[1].replace(/\s+/g, ''); if (/\d*d\d+/.test(f)) return f; }
  return null;
}

export default function SpellsSidebar() {
  const myId = useVtt((s) => s.ui.myCharacterId);
  const chars = useVtt((s) => s.ui.characters || {});
  const tokens = useVtt((s) => s.tokens);
  const activeMapId = useVtt((s) => s.activeMapId);
  const userId = useVtt((s) => s.session.userId);
  const character = myId != null ? chars[myId]?.data : null;
  const edition = character?.meta?.edition || '5e';
  const [catalog, setCatalog] = useState(null); // lowercase name -> spell
  const [open, setOpen] = useState({});   // expanded description
  const [upOpen, setUpOpen] = useState({}); // expanded upcast
  const [noteOpen, setNoteOpen] = useState({});
  const [castPrompt, setCastPrompt] = useState(null); // nach dem Wirken: „Schaden würfeln?"
  const [prepClass, setPrepClass] = useState(null); // Vorbereiten-Modal (classId)

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadSpellList(edition).catch(() => []);
      if (cancelled) return;
      const map = {};
      for (const sp of list || []) map[String(sp.name).toLowerCase()] = sp;
      setCatalog(map);
    })();
    return () => { cancelled = true; };
  }, [edition]);

  // Computed spellcasting (attack / save DC per class) — memoized so the table
  // can show the same DC pills as the full sheet.
  const computed = useMemo(() => {
    if (!character) return null;
    try { return computeCharacter(character); } catch { return null; }
  }, [character]);

  const byLevel = useMemo(() => {
    if (!character || !catalog) return null;
    const custom = {};
    for (const sp of (character.custom?.spells || [])) custom[String(sp.name).toLowerCase()] = sp;
    const entries = [...collectCharacterSpells(character).values()];
    const groups = {};
    for (const e of entries) {
      const sp = custom[e.name.toLowerCase()] || catalog[e.name.toLowerCase()];
      if (!sp) continue;
      const lvl = sp.level ?? 0;
      const srcClasses = Array.isArray(e.sourceClasses) ? e.sourceClasses : [];
      (groups[lvl] ||= []).push({ ...sp, _granted: e.granted, _sourceClasses: srcClasses });
    }
    for (const k in groups) groups[k].sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }, [character, catalog]);

  if (!character) return <div style={S.muted}>Kein Charakter geladen.</div>;
  if (!catalog || !byLevel) return <div style={S.muted}>Lade Zauber…</div>;

  const { slots: slotArr, warlockSlots } = computeSpellSlots(character);
  const usedSlots = character.status?.usedSpellSlots || {};
  const usedPact = character.status?.usedPactSlots || 0;
  const concentration = character.status?.concentration || null;
  const concName = concentration?.spell || concentration?.name || null;
  const spellNotes = character.status?.spellNotes || {};
  const spellcasting = computed?.spellcasting || {};
  const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
  if (!levels.length) return <div style={S.muted}>Keine Zauber.</div>;

  const slotRemaining = (lvl) => Math.max(0, (slotArr?.[lvl - 1] || 0) - (usedSlots[lvl] || 0));
  const pactRemaining = () => (warlockSlots ? Math.max(0, warlockSlots.slots - usedPact) : 0);

  // Cast a spell at a given slot level (or with a pact slot). Spends the slot,
  // sets concentration if the spell concentrates (replacing any existing one
  // after a confirm), and syncs through the combat-state RPC.
  const castSpell = (sp, slotLevel, usePact) => {
    const conc = isConc(sp);
    if (conc && concName && concName.toLowerCase() !== sp.name.toLowerCase()) {
      if (!window.confirm(`Du konzentrierst gerade auf ${concName}. Durch ${sp.name} ersetzen?`)) return;
    }
    const patch = {};
    if (usePact) patch.usedPactSlots = usedPact + 1;
    else if (slotLevel > 0) patch.usedSpellSlots = { ...usedSlots, [slotLevel]: (usedSlots[slotLevel] || 0) + 1 };
    if (conc) patch.concentration = { spell: sp.name, level: usePact ? warlockSlots?.level : slotLevel, since: new Date().toISOString() };
    if (Object.keys(patch).length) patchCombat(myId, patch);
    // Nach dem Wirken kurz anbieten: Schaden würfeln (auf den GEWIRKTEN Grad
    // hochskaliert — {@scaledamage}; Shift = Krit) und/oder das passende
    // AoE-Template platzieren (Kegel/Würfel mit Selbst-Ursprung starten am Token).
    const effLevel = usePact ? (warlockSlots?.level || slotLevel) : slotLevel;
    const dmg = scaledDamage(sp, effLevel);
    const zone = zoneFromArea(deriveSpellArea(sp));
    if (dmg || zone) setCastPrompt({ name: sp.name, level: effLevel, formula: dmg, zone, self: isSelfOrigin(sp), dmgType: (sp.damageType?.[0] || sp.damageInflict?.[0] || '').toLowerCase() });
  };

  // AoE-Template des gewirkten Zaubers platzieren. Selbst-Ursprung (Kegel,
  // Thunderwave-Würfel, …) hängt direkt am eigenen Token (exakte Position,
  // kein Grid-Snap; Richtung/Position danach per Auswahl-Tool anpassbar);
  // Fern-Flächen (Fireball & Co.) platziert man wie gewohnt per Klick.
  const placeArea = () => {
    const p = castPrompt;
    if (!p?.zone) return;
    const color = DAMAGE_TYPE_COLOR[p.dmgType] || 'var(--color-accent)';
    const hex = /^#/.test(color) ? color : '#42a5f5';
    const myToken = Object.values(tokens).find((t) => String(t.characterId) === String(myId) && t.mapId === activeMapId);
    if (p.self && myToken) {
      // createdBy = eigener User: die RLS erlaubt Mitgliedern nur das Verwalten
      // EIGENER Zonen — ohne das würde der Insert für Spieler abgelehnt.
      addZone({ type: p.zone.type, x: myToken.x, y: myToken.y, params: { directionDeg: 0, ...p.zone.params }, color: hex, createdBy: userId, level: myToken.level || undefined });
      toast(`${p.name}: Fläche am Token platziert — mit dem Auswahl-Tool drehen/verschieben.`, 'info');
    } else {
      setZoneTool(p.zone.type, hex);
      for (const [k, v] of Object.entries(p.zone.params)) setZoneParam(k, v);
      toast(`${p.name}: Klicke auf die Karte, um die Fläche zu platzieren.`, 'info');
    }
    setCastPrompt(null);
  };

  // Castable slot options for a spell row (up-cast + pact slot), like the sheet.
  const castOptions = (sp) => {
    const lvl = sp.level ?? 0;
    if (lvl === 0) return [{ key: 'c', label: 'Wirken', fn: () => castSpell(sp, 0, false) }];
    const opts = [];
    for (let L = lvl; L <= 9; L++) {
      const rem = slotRemaining(L);
      if (rem > 0) {
        const dmgAt = scaledDamage(sp, L);
        opts.push({ key: 'l' + L, label: `Grad ${L} (${rem})`, up: L > lvl, title: dmgAt ? `Schaden bei Grad ${L}: ${dmgAt}` : undefined, fn: () => castSpell(sp, L, false) });
      }
    }
    if (warlockSlots && warlockSlots.level >= lvl && pactRemaining() > 0) {
      opts.push({ key: 'pact', label: `Pakt G${warlockSlots.level} (${pactRemaining()})`, pact: true, title: scaledDamage(sp, warlockSlots.level) ? `Schaden: ${scaledDamage(sp, warlockSlots.level)}` : undefined, fn: () => castSpell(sp, warlockSlots.level, true) });
    }
    return opts;
  };
  const setNote = (name, v) => applyOwnCharacter(myId, (d) => {
    if (!d.status) d.status = {};
    d.status.spellNotes = { ...(d.status.spellNotes || {}), [name.toLowerCase()]: v };
  });

  // ── Vorbereiten direkt aus der Sidebar: gleiche Modal wie das Sheet ──
  const casterClasses = (character.classes || []).map((cls) => {
    const sub = cls.subclassId?.split('__')[0] || null;
    const mod = computed?.spellcasting?.[cls.classId]?.modifier ?? 0;
    const info = getSpellcastingInfo(cls.classId, cls.level, mod, sub, character?.meta?.edition || '5e');
    return info ? { classId: cls.classId, info, ritualCasting: !!info.ritualCasting } : null;
  }).filter(Boolean);
  const classAbbr = Object.fromEntries(casterClasses.map((c) => [c.classId, c.classId.slice(0, 2).toUpperCase()]));
  const preparedByClass = character?.status?.preparedSpells || {};
  const maxSpellLvl = (() => { let mx = 0; for (let i = 0; i < 9; i++) if ((slotArr?.[i] || 0) > 0) mx = i + 1; if (warlockSlots && warlockSlots.level > mx) mx = warlockSlots.level; return mx; })();
  const updateCharacter = (path, value) => applyOwnCharacter(myId, (d) => setPath(d, path, value));
  // Spiegel der Sheet-Logik: Pille der Zielklasse togglet, andere Klassen
  // werden konsolidiert (kein Doppel-Prep desselben Zaubers).
  const prepWithClass = (row, classId) => {
    if (!classId || row.spell.level === 0) return;
    const listOfTarget = preparedByClass[classId] || [];
    if (listOfTarget.some((n) => n.toLowerCase() === row.key)) {
      updateCharacter(`status.preparedSpells.${classId}`, listOfTarget.filter((n) => n.toLowerCase() !== row.key));
      return;
    }
    for (const cc of casterClasses) {
      if (cc.classId === classId) continue;
      const list = preparedByClass[cc.classId] || [];
      if (list.some((n) => n.toLowerCase() === row.key)) {
        updateCharacter(`status.preparedSpells.${cc.classId}`, list.filter((n) => n.toLowerCase() !== row.key));
      }
    }
    updateCharacter(`status.preparedSpells.${classId}`, [...listOfTarget, row.spell.name]);
  };
  const prepCasters = casterClasses.filter((c) => (c.info?.maxPrepared || 0) > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Vorbereiten direkt aus der Sidebar (gleiche Modal wie das Sheet). */}
      {prepCasters.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {prepCasters.map((c) => (
            <button key={c.classId} style={S.prepBtn} onClick={() => setPrepClass(c.classId)}
              title={`Zauber für ${c.classId} vorbereiten`}>
              Vorbereiten: {c.classId} ({(preparedByClass[c.classId] || []).length}/{c.info.maxPrepared})
            </button>
          ))}
        </div>
      )}
      {prepClass && (
        <SpellPrepareModal
          open={!!prepClass}
          onClose={() => setPrepClass(null)}
          character={character}
          computed={computed}
          classId={prepClass}
          casterClasses={casterClasses}
          classAbbr={classAbbr}
          preparedByClass={preparedByClass}
          maxSpellLvl={maxSpellLvl}
          updateCharacter={updateCharacter}
          applyCharacter={(mutator) => applyOwnCharacter(myId, mutator)}
          prepWithClass={prepWithClass}
        />
      )}
      {castPrompt && (
        <div style={S.castPrompt}>
          <span><b>{castPrompt.name}</b> gewirkt{castPrompt.level ? ` (Grad ${castPrompt.level})` : ''}</span>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {castPrompt.formula && (
              <button style={S.castRollBtn} onClick={(ev) => { rollDamage(ev, castPrompt.formula, `${castPrompt.name}: Schaden`); setCastPrompt(null); }}
                title="Schaden würfeln — Shift: Kritisch">{castPrompt.formula} würfeln</button>
            )}
            {castPrompt.zone && (
              <button style={S.castAreaBtn} onClick={placeArea}
                title={castPrompt.self ? 'Fläche startet am eigenen Token' : 'Fläche per Klick auf der Karte platzieren'}>
                Fläche {castPrompt.self ? 'am Token' : 'platzieren'}
              </button>
            )}
            <button style={S.dropBtn} onClick={() => setCastPrompt(null)}>✕</button>
          </span>
        </div>
      )}
      {concName && (
        <div style={S.concBanner}>
          <span>Konzentration: <b>{concName}</b>{concentration?.level ? ` (G${concentration.level})` : ''}</span>
          <button style={S.dropBtn} onClick={() => patchCombat(myId, { concentration: null })} title="Konzentration beenden">✕</button>
        </div>
      )}
      {levels.map((lvl) => {
        const max = lvl > 0 ? (slotArr?.[lvl - 1] || 0) : 0;
        const used = usedSlots[lvl] || 0;
        return (
          <div key={lvl}>
            <div style={S.levelHead}>
              <span>{spellLevelLabel ? spellLevelLabel(lvl) : (lvl === 0 ? 'Zaubertricks' : `Grad ${lvl}`)}</span>
              {lvl > 0 && max > 0 && (
                <span style={S.slotInfo}>
                  <span style={S.slotDots}>
                    {Array.from({ length: max }, (_, j) => (
                      <button key={j} title={`Slot ${j + 1}`} onClick={() => patchCombat(myId, { usedSpellSlots: { ...usedSlots, [lvl]: j < (max - used) ? max - j : max - (j + 1) } })}
                        style={{ ...S.slotDot, background: j < (max - used) ? 'var(--color-accent)' : 'var(--color-surface)' }} />
                    ))}
                  </span>
                  <span>{max - used}/{max}</span>
                </span>
              )}
            </div>
            <div style={S.table}>
              {byLevel[lvl].map((sp) => {
                const key = sp.name.toLowerCase();
                const conc = isConc(sp);
                const ritual = !!sp.meta?.ritual;
                const expanded = open[key];
                return (
                  <div key={key} style={S.spellRow}>
                    <div style={S.rowTop}>
                      <Pinnable title={sp.name} render={() => (
                        <div>
                          <div style={S.meta}>{[fmtRange(sp.range), deriveSpellArea(sp), fmtTime(sp.time || sp.castingTime), fmtDuration(sp.duration), components(sp), sp.school].filter(Boolean).join(' · ')}</div>
                          {(conc || ritual) && <div style={{ ...S.meta, color: 'var(--color-accent)' }}>{[conc && 'Konzentration', ritual && 'Ritual'].filter(Boolean).join(' · ')}</div>}
                          <div style={S.desc}>{flatten(sp.entries) || '—'}</div>
                          {sp.entriesHigherLevel?.length > 0 && <div style={{ ...S.desc, marginTop: 6 }}><b>Höhere Grade:</b> {flatten(sp.entriesHigherLevel)}</div>}
                        </div>
                      )}>
                        <button style={S.spellName} onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
                          <span style={{ width: 10, color: 'var(--color-text-muted)' }}>{expanded ? '▾' : '▸'}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sp.name}</span>
                        </button>
                      </Pinnable>
                      <span style={S.cols}>
                        <span style={S.col} title="Reichweite">{fmtRange(sp.range)}</span>
                        <span style={S.col} title="Fläche / Ziel">{deriveSpellArea(sp) || '—'}</span>
                        <span style={S.col} title="Zeit">{fmtTime(sp.time || sp.castingTime)}</span>
                      </span>
                      <span style={{ display: 'flex', gap: 2 }}>
                        {conc && <span style={S.pillC} title="Konzentration">C</span>}
                        {ritual && <span style={S.pillR} title="Ritual">R</span>}
                      </span>
                    </div>
                    {expanded && (
                      <div style={S.detail}>
                        <div style={S.chips}>
                          {(sp._sourceClasses || []).map((cls) => {
                            const sc = spellcasting[cls];
                            if (!sc) return null;
                            return <span key={cls} style={S.pillDc} title={`${cls}: Angriff ${sc.spellAttackDisplay} · SG ${sc.spellSaveDC}`}>{cls} {sc.spellAttackDisplay}/SG{sc.spellSaveDC}</span>;
                          })}
                          {(() => {
                            const atk = (sp._sourceClasses || []).map((c) => spellcasting[c]).find(Boolean)?.spellAttackDisplay;
                            const dmg = spellDamageFormula(sp);
                            return <>
                              {sp.spellAttack?.length > 0 && atk && (
                                <span role="button" tabIndex={0} style={S.pillRoll} title="Zauberangriff würfeln — Shift: Vorteil · Strg: Nachteil"
                                  onClick={(ev) => { ev.stopPropagation(); rollAttack(ev, atk, `${sp.name}: Zauberangriff`); }}>{atk}</span>
                              )}
                              {dmg && (
                                <span role="button" tabIndex={0} style={S.pillDmg} title="Schaden würfeln — Shift: Kritisch"
                                  onClick={(ev) => { ev.stopPropagation(); rollDamage(ev, dmg, `${sp.name}: Schaden`); }}>{dmg}</span>
                              )}
                            </>;
                          })()}
                        </div>
                        <div style={S.meta}>{[components(sp), fmtDuration(sp.duration), sp.school].filter(Boolean).join(' · ')}</div>
                        {/* Cast / up-cast — one button per available slot level (+ pact). */}
                        <div style={S.castRow}>
                          {(() => { const opts = castOptions(sp); return opts.length === 0
                            ? <span style={{ fontSize: 10, color: 'var(--color-danger)' }}>Keine Slots frei.</span>
                            : opts.map((o) => <button key={o.key} title={o.title} style={{ ...S.castOpt, ...(o.up ? S.castOptUp : null), ...(o.pact ? S.castOptPact : null) }} onClick={o.fn}>{o.label}</button>); })()}
                        </div>
                        <div style={S.desc}>{flatten(sp.entries)}</div>
                        {(sp.entriesHigherLevel?.length > 0) && (
                          <div>
                            <button style={S.subToggle} onClick={() => setUpOpen((o) => ({ ...o, [key]: !o[key] }))}>{upOpen[key] ? '▾' : '▸'} Höhere Grade (Upcast)</button>
                            {upOpen[key] && <div style={S.desc}>{flatten(sp.entriesHigherLevel)}</div>}
                          </div>
                        )}
                        <div>
                          <button style={S.subToggle} onClick={() => setNoteOpen((o) => ({ ...o, [key]: !o[key] }))}>{noteOpen[key] ? '▾' : '▸'} Notiz</button>
                          {noteOpen[key] && (
                            <textarea defaultValue={spellNotes[key] || ''} onBlur={(e) => setNote(sp.name, e.target.value)}
                              placeholder="Notiz zu diesem Zauber…" style={S.note} />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── formatters — robust to 5etools shape (arrays/objects) AND imported custom
// spells (plain strings / boolean flags). ──
function isConc(sp) {
  if (typeof sp.concentration === 'boolean') return sp.concentration;
  const d = Array.isArray(sp.duration) ? sp.duration : [];
  return d.some((x) => x && typeof x === 'object' && x.concentration);
}
function fmtRange(r) {
  if (!r) return '—';
  if (typeof r === 'string') return r;
  if (r.type === 'point') {
    const d = r.distance || {};
    if (d.type === 'feet') return `${d.amount} ft`;
    if (d.type === 'miles') return `${d.amount} mi`;
    return d.type || '—';
  }
  return ({ self: 'Selbst', touch: 'Berührung', sight: 'Sicht', unlimited: '∞', special: 'Speziell' }[r.type]) || r.type || '—';
}
function fmtTime(t) {
  if (typeof t === 'string') return t;
  const x = Array.isArray(t) ? t[0] : t;
  if (!x || typeof x !== 'object') return '—';
  const u = { action: 'A', bonus: 'BA', reaction: 'R', minute: 'min', hour: 'h' }[x.unit] || x.unit;
  return `${x.number || 1} ${u}`;
}
function fmtDuration(d) {
  if (!d) return '—';
  if (typeof d === 'string') return d;
  const x = Array.isArray(d) ? d[0] : d;
  if (!x || typeof x !== 'object') return '—';
  if (x.type === 'instant') return 'Sofort';
  if (x.type === 'permanent') return 'Permanent';
  if (x.type === 'special') return 'Speziell';
  const dur = x.duration || {};
  return `${x.concentration ? 'Konz., ' : ''}${dur.amount || ''} ${dur.type || ''}`.trim() || (x.type || '—');
}
function components(sp) {
  const c = sp.components || {};
  return [c.v && 'V', c.s && 'S', c.m && 'M'].filter(Boolean).join(', ') || '—';
}
function flatten(entries) {
  if (!Array.isArray(entries)) return '';
  return entries.map((e) => (typeof e === 'string' ? strip(e) : (e?.entries ? flatten(e.entries) : ''))).join('\n\n');
}
function strip(s) { return String(s).replace(/\{@\w+ ([^}]*)\}/g, (_, x) => String(x).split('|')[0]); }

const S = {
  muted: { color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' },
  levelHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-accent)', margin: '4px 0 3px' },
  slotInfo: { display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-muted)', fontWeight: 400 },
  slotDots: { display: 'flex', gap: 2 },
  slotDot: { width: 9, height: 9, borderRadius: '50%', border: '1px solid var(--color-border)', cursor: 'pointer', padding: 0 },
  concBanner: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', fontSize: 'var(--fs-sm)' },
  dropBtn: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 12 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 },
  pillDc: { fontSize: 9, fontWeight: 700, color: 'var(--color-accent)', border: '1px solid var(--color-accent)', borderRadius: 3, padding: '0 4px' },
  pillRoll: { fontSize: 10, fontWeight: 800, cursor: 'pointer', color: '#e0af68', border: '1px solid color-mix(in srgb, #e0af68 55%, transparent)', background: 'color-mix(in srgb, #e0af68 16%, transparent)', borderRadius: 999, padding: '0 6px' },
  pillDmg: { fontSize: 10, fontWeight: 700, cursor: 'pointer', color: '#ff6b6b', border: '1px solid color-mix(in srgb, #ff6b6b 55%, transparent)', background: 'color-mix(in srgb, #ff6b6b 14%, transparent)', borderRadius: 999, padding: '0 6px' },
  castPrompt: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-sm)', padding: '5px 8px', fontSize: 'var(--fs-sm)' },
  castRollBtn: { fontSize: 11, fontWeight: 800, cursor: 'pointer', color: '#ff6b6b', border: '1px solid color-mix(in srgb, #ff6b6b 55%, transparent)', background: 'color-mix(in srgb, #ff6b6b 16%, transparent)', borderRadius: 999, padding: '2px 8px' },
  prepBtn: { fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, cursor: 'pointer', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 45%, transparent)', background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' },
  castAreaBtn: { fontSize: 11, fontWeight: 800, cursor: 'pointer', color: '#7dcfff', border: '1px solid color-mix(in srgb, #7dcfff 55%, transparent)', background: 'color-mix(in srgb, #7dcfff 16%, transparent)', borderRadius: 999, padding: '2px 8px' },
  castRow: { display: 'flex', flexWrap: 'wrap', gap: 4, margin: '4px 0 6px' },
  castOpt: { fontSize: 10, fontWeight: 700, padding: '2px 8px', background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none', borderRadius: 4, cursor: 'pointer' },
  castOptUp: { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-accent)' },
  castOptPact: { background: 'var(--accent-purple, #9b6cff)', color: '#fff' },
  table: { display: 'flex', flexDirection: 'column', gap: 2 },
  spellRow: { borderRadius: 'var(--radius-sm)', border: '1px solid transparent' },
  rowTop: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px' },
  spellName: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 3, background: 'transparent', border: 'none', color: 'var(--color-text)', font: 'inherit', textAlign: 'left', cursor: 'pointer', padding: 0, fontSize: 'var(--fs-sm)' },
  cols: { display: 'flex', gap: 6, flexShrink: 0 },
  col: { fontSize: 10, color: 'var(--color-text-muted)', minWidth: 40, textAlign: 'right', whiteSpace: 'nowrap' },
  pillC: { fontSize: 9, fontWeight: 800, color: '#fff', background: 'var(--color-accent)', borderRadius: 3, padding: '0 3px' },
  pillR: { fontSize: 9, fontWeight: 800, color: '#fff', background: 'var(--color-warning,#d98e00)', borderRadius: 3, padding: '0 3px' },
  detail: { padding: '2px 8px 6px 20px' },
  meta: { fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 2 },
  desc: { fontSize: 11, lineHeight: 1.4, whiteSpace: 'pre-wrap', color: 'var(--color-text)' },
  subToggle: { background: 'transparent', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: 11, padding: '3px 0', fontWeight: 600 },
  note: { width: '100%', boxSizing: 'border-box', minHeight: 50, resize: 'vertical', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '4px 6px', fontFamily: 'inherit', fontSize: 11 },
};
