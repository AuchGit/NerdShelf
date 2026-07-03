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
import { isVariantEnabled } from '../../character-builder/lib/optionalFeatureVariants';

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

// Alle Pill-Arten des Parsers bekommen hier eine Farbe — was keine hat,
// wird nicht angezeigt. Deutlich breiter als früher, damit z.B. AC-/Save-
// Boni (Arcane Deflection) und Angriffszahl (Extra Attack) sichtbar sind.
const PILL_COLOR = {
  trigger: '#e0af68', damage: '#ff6b6b', 'damage-bonus': '#ff6b6b', save: '#9ab3d6',
  heal: '#4ade80', cost: '#c792ea', uses: '#c792ea', ac: '#9ab3d6', attack: '#e0af68',
  utility: '#7dcfff', advantage: '#4ade80', resist: '#38bdf8', reroll: '#7dcfff',
  crit: '#ff9e64', speed: '#7dcfff',
};

// Rein passive, bereits woanders angerechnete Effekte gehören NICHT in die
// Specials: Skill-/Check-/Initiative-Boni stecken in den Skills bzw. der
// Initiative, Options-Grants ("you learn two Metamagic options") tauchen als
// eigene Picks auf, Concentration-Advantage ist ein Dauerzustand. Text-
// Patterns statt Namenslisten; greift nur wenn KEIN aktiver Rider
// (Schaden/Kosten) am Feature hängt.
const PASSIVE_PATTERNS = [
  /\byou gain proficiency in\b/i,
  /\bgain a bonus to (?:the|that|this) check\b/i,
  /\badd your proficiency(?: bonus)? to (?:the|that|your) (?:roll|check|initiative)\b/i,
  /\byou learn (?:one|two|three|\d+)[^.]{0,60}\boptions? of your choice\b/i,
  /\badvantage on [^.]{0,60}\bsaving throws?\b[^.]{0,40}\bconcentration\b/i,
  /\bperform the somatic components?\b/i,
  // Mastery-/Property-Grants ("use the weapon mastery properties of three
  // kinds of weapons of your choice") — die Auswahl passiert im eigenen
  // Picker, nicht in den Specials.
  /\bpropert(?:y|ies) of (?:one|two|three|four|\d+) kinds? of\b[^.]{0,80}\bweapons?\b/i,
];

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

  const items = useMemo(() => {
    if (!character) return [];
    const profBonus = computed?.proficiencyBonus ?? computed?.profBonus ?? 2;
    const out = [];
    const seen = new Set();
    const classIds = new Set((character.classes || []).map((c) => c.classId));
    const add = (src, name, entries) => {
      if (!name || !Array.isArray(entries)) return;
      // Dedup nur über den Namen — gleiche Features aus mehreren Quellen
      // (Klasse + __activeFeatures) erscheinen im flachen Grid nur einmal.
      const key = String(name).toLowerCase();
      if (seen.has(key)) return;
      const text = flatten(entries);
      if (hasActionVerb(text)) return; // belongs in Actions
      let pills;
      try {
        // classId + geladene Class-Daten mitgeben → Pill-Werte skalieren mit
        // dem Level (Sneak-Attack-Spalte: 1d6 → 2d6 → …). Im VTT gibt es kein
        // __classDataMap vom Sheet, wir haben aber classMap selbst geladen.
        const feature = classIds.has(src) ? { name, entries, classId: src } : { name, entries };
        pills = parseFeatureEffect(feature, character, profBonus, { classDataMap: classMap || character.__classDataMap })?.pills || [];
      } catch { pills = []; }
      const active = pills.some((p) => p.kind === 'damage' || p.kind === 'damage-bonus' || p.kind === 'cost');
      // Passiv-Filter: bereits angerechnete Boni/Grants raus — außer es hängt
      // ein aktiver Rider dran.
      if (!active && PASSIVE_PATTERNS.some((re) => re.test(text))) return;
      const usable = active || pills.some((p) => p.kind === 'trigger' || p.kind === 'uses');
      if (!usable && !looksUsable(text)) return;
      seen.add(key);
      out.push({ name, text, pills: pills.filter((p) => PILL_COLOR[p.kind]) });
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
      for (const v of vals) {
        if (!v) continue;
        if (v.startsWith('of:')) pushPick(classId, (v.slice(3).split('|')[0] || '').trim());
        // 2024: Fighting Style / Epic Boon sind Feat-Picks ('ft:Name|Source')
        // — der Text kommt aus dem Feat-Katalog statt aus optionalfeatures.
        else if (v.startsWith('ft:')) {
          const nm = (v.slice(3).split('|')[0] || '').trim();
          const lk = featMap?.get(nm.toLowerCase());
          if (lk) add(classId, nm, lk.entries);
        }
      }
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
        if ((f.level || 1) > lvl) continue;
        // TCE-Optional-Variants (Favored Foe & Co.) sind opt-in — nur zeigen
        // wenn der Spieler sie wirklich aktiviert hat.
        if (f.isClassFeatureVariant && !isVariantEnabled(character, cls.classId, f.name)) continue;
        add(cls.classId, f.name, f.entries);
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
        for (const f of subFeatures) {
          if ((f.level || 1) > lvl) continue;
          if (f.isClassFeatureVariant && !isVariantEnabled(character, cls.classId, f.name)) continue;
          add(cls.classId, f.name, f.entries);
        }
      }
    }
    // 3) Feats (e.g. Dreadful Strikes "when you hit …"). character.feats store a
    //    name/featId; entries come from the feat catalogue. custom.feats (granted
    //    via the 5e.tools importer) may carry inline entries.
    const featEntries = (nm, inline) => (Array.isArray(inline) ? inline : featMap?.get(String(nm || '').toLowerCase())?.entries);
    for (const f of (character.feats || [])) { const nm = f.name || f.featId; add('Talente', nm, featEntries(nm, f.entries)); }
    for (const f of (character.custom?.feats || [])) add('Talente', f.name, featEntries(f.name, f.entries));

    return out;
  }, [character, computed, optMap, featMap, classMap]);

  if (!character) return <div style={S.empty}>Kein Charakter geladen.</div>;
  if (!items.length) return <div style={S.empty}>Keine Specials. Manöver, Sneak Attack, Smites und andere „when you hit / when you use"-Effekte erscheinen hier — sobald dein Charakter welche hat.</div>;

  // Ein flaches Grid ohne Kategorie-Überschriften — nutzt die volle Breite,
  // egal wie viele Einträge eine "Kategorie" gehabt hätte.
  return (
    <div style={S.grid}>
      {items.map((it) => {
        const isOpen = !!open[it.name];
        return (
          <div key={it.name} style={S.item}>
            <button style={S.itemHead} title={it.name} onClick={() => setOpen((o) => ({ ...o, [it.name]: !o[it.name] }))}>
              <span style={S.caret}>{isOpen ? '▾' : '▸'}</span>
              <span style={S.name}>{it.name}</span>
              {it.pills.map((p, i) => (
                <span key={i} style={{ ...S.pill, borderColor: PILL_COLOR[p.kind], color: PILL_COLOR[p.kind] }} title={p.title || p.label}>{p.label}</span>
              ))}
            </button>
            {isOpen && it.text && <div style={S.body}>{it.text}</div>}
          </div>
        );
      })}
    </div>
  );
}

const S = {
  // Flaches Grid ohne Kategorien: füllt die volle Breite, Einträge fließen
  // von links nach rechts.
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))', gap: 6, alignItems: 'start', padding: '2px 2px 6px' },
  empty: { color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)', padding: 8 },
  item: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', overflow: 'hidden' },
  itemHead: { display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '5px 8px', background: 'transparent', border: 'none', color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' },
  caret: { color: 'var(--color-text-muted)', fontSize: 10, width: 10, flexShrink: 0 },
  // Einzeilig: lange Namen werden mit … abgekürzt (voller Name im Tooltip),
  // die Pills bleiben rechts sichtbar.
  name: { fontWeight: 600, fontSize: 'var(--fs-sm)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' },
  pill: { fontSize: 9, fontWeight: 700, border: '1px solid', borderRadius: 999, padding: '1px 6px', whiteSpace: 'nowrap', flexShrink: 0 },
  body: { fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap', padding: '0 10px 8px', lineHeight: 1.4 },
};
