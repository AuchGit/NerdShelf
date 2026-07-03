// Voll berechneter Charakter für VTT-Panels.
//
// Das Sheet hydratisiert `__activeFeatures` + `__classDataMap` transient
// (CharacterSheetPage) — im VTT fehlte beides. Folge: Ressourcen aus
// Feature-Tabellen (Battle Master Superiority Dice, Soulknife Energy Dice, …)
// und tabellenskalierte Zähler (Second Wind & Co.) waren in der Bottom-Bar
// unsichtbar, und Feature-Boni (z.B. Defense +1 AC) fehlten im AC-Badge.
//
// Dieser Hook lädt die Klassendaten (dataLoader cached modul-weit), sammelt
// die aktiven Klassen-/Subclass-Features (Level-gegated, TCE-Variants nur
// wenn aktiviert) und rechnet computeCharacter damit — gleiche Datenlage wie
// auf dem Sheet, rein datengetrieben.
import { useEffect, useMemo, useState } from 'react';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';
import { loadClassData } from '../../character-builder/lib/dataLoader';
import { isVariantEnabled } from '../../character-builder/lib/optionalFeatureVariants';

export function collectVttActiveFeatures(character, classMap) {
  const out = [];
  for (const cls of (character?.classes || [])) {
    const cd = classMap?.[cls.classId];
    if (!cd) continue;
    const lvl = cls.level || 1;
    const push = (f, level) => {
      if (!f?.name || (level || 1) > lvl) return;
      if (f.isClassFeatureVariant && !isVariantEnabled(character, cls.classId, f.name)) return;
      out.push({ classId: cls.classId, name: f.name, level: level || 1, entries: f.entries || [] });
    };
    for (const f of (cd.features || [])) push(f, f?.level);
    const subId = cls.subclassId;
    if (!subId) continue;
    const cleanSub = String(subId).split(/__|\|/)[0].trim();
    const sub = (cd.subclasses || []).find((x) => x.id === subId || x.name === subId
      || x.id === cleanSub || x.name === cleanSub || x.shortName === cleanSub);
    if (!sub) continue;
    for (const f of (Array.isArray(sub.features) ? sub.features : [])) push(f, f?.level);
    if (sub.featuresPerLevel) {
      for (const [l, fs] of Object.entries(sub.featuresPerLevel)) {
        const level = parseInt(l, 10) || 1;
        for (const f of (fs || [])) { if (f && typeof f === 'object') push(f, level); }
      }
    }
  }
  return out;
}

export function useVttComputed(character) {
  const classSig = (character?.classes || [])
    .map((c) => `${c.classId}:${c.subclassId || ''}:${c.level || 1}`).join(',');
  const edition = character?.meta?.edition || '5e';
  const [classMap, setClassMap] = useState(null);
  useEffect(() => {
    const ids = [...new Set((character?.classes || []).map((c) => c.classId).filter(Boolean))];
    if (!ids.length) { setClassMap(null); return undefined; }
    let cancelled = false;
    Promise.all(ids.map((id) => loadClassData(edition, id).catch(() => null))).then((loaded) => {
      if (cancelled) return;
      const m = {};
      ids.forEach((id, i) => { if (loaded[i]) m[id] = loaded[i]; });
      setClassMap(m);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classSig, edition]);
  return useMemo(() => {
    if (!character) return null;
    try {
      const feats = classMap ? collectVttActiveFeatures(character, classMap) : [];
      const hydrated = {
        ...character,
        __activeFeatures: feats.length ? feats : (character.__activeFeatures || []),
        __classDataMap: classMap || character.__classDataMap,
      };
      return computeCharacter(hydrated, classMap || {});
    } catch { return null; }
  }, [character, classMap]);
}
