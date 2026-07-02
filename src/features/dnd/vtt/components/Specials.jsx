// "Specials" — a compact, VTT-tuned list of the usable things that DON'T show up
// as Actions: maneuvers, Sneak Attack, smites and every other "when you hit / when
// you use" rider. Fully data-driven: a feature qualifies when its rules text has a
// trigger / damage effect (or a usable trigger phrase) but NO action verb — so it
// never duplicates the Actions panel and needs no hardcoded feature names.
import { useEffect, useMemo, useState } from 'react';
import { useVtt } from '../state/useVtt';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';
import { parseFeatureEffect } from '../../character-builder/lib/featureEffectParser';
import { loadOptionalFeatureList, loadFeatList, loadClassData } from '../../character-builder/lib/dataLoader';

// Strip 5etools {@tag text|extra} markup down to readable text.
const clean = (s) => String(s).replace(/\{@\w+\s+([^}|]*)[^}]*\}/g, '$1');
function flatten(entries) {
  const out = [];
  const walk = (e) => {
    if (e == null) return;
    if (typeof e === 'string') { out.push(clean(e)); return; }
    if (Array.isArray(e)) { e.forEach(walk); return; }
    if (e.name && (e.entries || e.entry)) out.push(`${e.name}.`);
    if (e.entries) walk(e.entries);
    else if (e.entry) walk(e.entry);
    else if (e.items) walk(e.items);
  };
  walk(entries);
  return out.join('\n\n').trim();
}
// An explicit action economy verb → it's an Action, not a Special.
const hasActionVerb = (t) => /\bas\s+an?\s+(?:bonus\s+)?action\b|\bas\s+a\s+reaction\b|\b(?:take|use|spend)\s+(?:an?\s+|your\s+)?(?:bonus\s+)?action\b/i.test(t || '');
// Usable-on-a-trigger phrasing ("when you hit / when you use / you can expend …").
const looksUsable = (t) => /when(ever)? you\s+(hit|use|make|take|deal|reduce|cast|miss|are|score|roll)|when an?\b|when a creature|immediately after|as part of (?:the|a|your)|you can expend|once (?:per|on each)/i.test(t || '');

const PILL_KINDS = ['trigger', 'damage', 'damage-bonus', 'save', 'heal'];
const PILL_COLOR = { trigger: '#e0af68', damage: '#ff6b6b', 'damage-bonus': '#ff6b6b', save: '#9ab3d6', heal: '#4ade80' };

export default function Specials() {
  const myId = useVtt((s) => s.ui.myCharacterId);
  const chars = useVtt((s) => s.ui.characters || {});
  const character = myId != null ? chars[myId]?.data : null;
  const [optMap, setOptMap] = useState(null);
  const [featMap, setFeatMap] = useState(null);
  const [classMap, setClassMap] = useState(null);
  const [open, setOpen] = useState({});
  const edition = character?.meta?.edition || '5e';
  // Class/subclass features (Dreadful Strikes & Co.) come straight from the
  // class data — the VTT never runs the sheet's __activeFeatures hydration, so
  // without this load subclass riders would be missing here. Keyed on the class
  // signature so combat-state writes don't re-fetch.
  const classSig = (character?.classes || []).map((c) => `${c.classId}:${c.subclassId || ''}:${c.level || 1}`).join(',');
  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set((character?.classes || []).map((c) => c.classId).filter(Boolean))];
    Promise.all(ids.map((id) => loadClassData(edition, id).catch(() => null))).then((loaded) => {
      if (cancelled) return;
      const m = {};
      ids.forEach((id, i) => { if (loaded[i]) m[id] = loaded[i]; });
      setClassMap(m);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edition, classSig]);

  useEffect(() => {
    let cancelled = false;
    loadOptionalFeatureList(edition).then((list) => {
      if (cancelled) return;
      const m = new Map();
      for (const f of (list || [])) m.set(String(f.name).toLowerCase(), f);
      setOptMap(m);
    }).catch(() => {});
    loadFeatList(edition).then((list) => {
      if (cancelled) return;
      const m = new Map();
      for (const f of (list || [])) m.set(String(f.name).toLowerCase(), f);
      setFeatMap(m);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [edition]);

  const computed = useMemo(() => {
    if (!character) return null;
    try { return computeCharacter(character); } catch { return null; }
  }, [character]);

  const groups = useMemo(() => {
    if (!character) return [];
    const profBonus = computed?.proficiencyBonus ?? computed?.profBonus ?? 2;
    const bySrc = new Map();
    const seen = new Set();
    const add = (src, name, entries) => {
      if (!name || !Array.isArray(entries)) return;
      const key = `${src}|${name}`;
      if (seen.has(key)) return;
      const text = flatten(entries);
      if (hasActionVerb(text)) return; // belongs in Actions
      let pills;
      try { pills = parseFeatureEffect({ name, entries }, character, profBonus, { classDataMap: character.__classDataMap })?.pills || []; } catch { pills = []; }
      const usable = pills.some((p) => p.kind === 'trigger' || p.kind === 'damage' || p.kind === 'damage-bonus');
      if (!usable && !looksUsable(text)) return;
      seen.add(key);
      const shown = pills.filter((p) => PILL_KINDS.includes(p.kind));
      const item = { name, text, pills: shown };
      if (!bySrc.has(src)) bySrc.set(src, []);
      bySrc.get(src).push(item);
    };
    // 1) Optional-feature picks — maneuvers, invocations, metamagic, … (text from
    //    the catalogue). Only the usable ones survive the filter above.
    const pushPick = (classId, name) => {
      const lk = optMap?.get(String(name || '').toLowerCase());
      if (lk) add(classId, name, lk.entries);
    };
    for (const cls of (character.classes || [])) {
      for (const ch of Object.values(cls.levelChoices || {})) {
        for (const f of (ch.optionalFeatures || [])) pushPick(cls.classId, f.name);
        if (typeof ch.superiorTechniqueManeuver === 'string') pushPick(cls.classId, ch.superiorTechniqueManeuver);
      }
    }
    for (const [descId, raw] of Object.entries(character.choices || {})) {
      if (!descId.startsWith('optblock::')) continue;
      const segs = descId.split('::');
      if (segs.length < 7) continue;
      const classId = segs[2];
      const vals = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      for (const v of vals) { if (v && v.startsWith('of:')) pushPick(classId, (v.slice(3).split('|')[0] || '').trim()); }
    }
    // 2) Granted class/subclass features + racial traits that are usable riders.
    for (const f of (character.__activeFeatures || [])) add(f.classId || 'Features', f.name, f.entries);
    for (const t of (character.species?.__traits || [])) add('Volk', t.name, t.entries);
    // 2b) Class + subclass features straight from the class data (level-gated) —
    //     covers subclass riders like Dreadful Strikes when __activeFeatures
    //     isn't hydrated (the VTT never runs the sheet's hydration).
    for (const cls of (character.classes || [])) {
      const cd = classMap?.[cls.classId];
      if (!cd) continue;
      const lvl = cls.level || 1;
      for (const f of (cd.features || [])) {
        if ((f.level || 1) <= lvl) add(cls.classId, f.name, f.entries);
      }
      const subId = cls.subclassId;
      if (subId) {
        const cleanSub = String(subId).split(/__|\|/)[0].trim();
        const sub = (cd.subclasses || []).find((x) => x.id === subId || x.name === subId
          || x.id === cleanSub || x.name === cleanSub || x.shortName === cleanSub);
        const subFeatures = sub ? [
          ...(Array.isArray(sub.features) ? sub.features : []),
          ...(sub.featuresPerLevel
            ? Object.entries(sub.featuresPerLevel).flatMap(([l, fs]) => (fs || []).map((f) => ({ ...f, level: parseInt(l, 10) || 1 })))
            : []),
        ] : [];
        for (const f of subFeatures) if ((f.level || 1) <= lvl) add(cls.classId, f.name, f.entries);
      }
    }
    // 3) Feats (e.g. Dreadful Strikes "when you hit …"). character.feats store a
    //    name/featId; entries come from the feat catalogue. custom.feats (granted
    //    via the 5e.tools importer) may carry inline entries.
    const featEntries = (nm, inline) => (Array.isArray(inline) ? inline : featMap?.get(String(nm || '').toLowerCase())?.entries);
    for (const f of (character.feats || [])) { const nm = f.name || f.featId; add('Talente', nm, featEntries(nm, f.entries)); }
    for (const f of (character.custom?.feats || [])) add('Talente', f.name, featEntries(f.name, f.entries));

    return [...bySrc.entries()].map(([src, items]) => ({ src, items }));
  }, [character, computed, optMap, featMap, classMap]);

  if (!character) return <div style={S.empty}>Kein Charakter geladen.</div>;
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (!total) return <div style={S.empty}>Keine Specials. Manöver, Sneak Attack, Smites und andere „when you hit / when you use"-Effekte erscheinen hier — sobald dein Charakter welche hat.</div>;

  return (
    <div style={S.wrap}>
      {groups.map((g) => (
        <div key={g.src} style={S.group}>
          <div style={S.groupHead}>{g.src}</div>
          {g.items.map((it) => {
            const id = `${g.src}|${it.name}`;
            const isOpen = !!open[id];
            return (
              <div key={id} style={S.item}>
                <button style={S.itemHead} onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}>
                  <span style={S.caret}>{isOpen ? '▾' : '▸'}</span>
                  <span style={S.name}>{it.name}</span>
                  <span style={{ flex: 1 }} />
                  {it.pills.map((p, i) => (
                    <span key={i} style={{ ...S.pill, borderColor: PILL_COLOR[p.kind], color: PILL_COLOR[p.kind] }} title={p.title || p.label}>{p.label}</span>
                  ))}
                </button>
                {isOpen && it.text && <div style={S.body}>{it.text}</div>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const S = {
  // 4 Kategorien nebeneinander (gleiche Spaltenbreiten wie Aktionen/Pinned) —
  // spart Höhe; weitere Kategorien fließen in die nächste Zeile.
  wrap: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, alignItems: 'start', padding: '2px 2px 6px' },
  empty: { color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', padding: 8 },
  group: { display: 'flex', flexDirection: 'column', gap: 3 },
  groupHead: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-text-muted)', padding: '2px 4px' },
  item: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', overflow: 'hidden' },
  itemHead: { display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '5px 8px', background: 'transparent', border: 'none', color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' },
  caret: { color: 'var(--color-text-muted)', fontSize: 10, width: 10 },
  name: { fontWeight: 600, fontSize: 'var(--fs-sm)' },
  pill: { fontSize: 9, fontWeight: 700, border: '1px solid', borderRadius: 999, padding: '1px 6px', whiteSpace: 'nowrap' },
  body: { fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap', padding: '0 10px 8px', lineHeight: 1.4 },
};
