// Voll hydratisierter + berechneter Charakter für VTT-Panels.
//
// Das Sheet hydratisiert vor dem Rechnen transiente Felder (__activeFeatures,
// __grantedSpells, species.__traits, __classDataMap, __featFeatures) — im VTT
// fehlte das: Klassen-/Subclass-/Species-AKTIONEN, always-prepared Spells
// (Fey Wanderer, Hunter's Mark via Favored Enemy) und Feature-Ressourcen
// waren in Bottom-Bar/Overlay/Sidebar unsichtbar. `useVttHydrated` baut
// EXAKT dieselbe Datenlage über die GETEILTEN Sheet-Sammler
// (lib/characterHydration) — eine Quelle, nichts dupliziert; `useVttComputed`
// rechnet computeCharacter darauf.
import { useEffect, useMemo, useState } from 'react';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';
import { loadClassData, loadFeatList, loadOptionalFeatureList } from '../../character-builder/lib/dataLoader';
import { collectActiveClassFeatures, collectClassGrantedSpells, loadRaceTraits } from '../../character-builder/lib/characterHydration';

// Feats mit Entries aus dem Katalog — als SEPARATES transient-Feld
// (__featFeatures), damit Feat-Texte nur in den Prosa-Resource-
// Synthesizer laufen (Metamagic Adept +2 Sorcery Points) und NICHT in
// die Feature-Bonus-Aggregation (sonst würden Feat-Boni doppelt zählen).
export function collectFeatFeatures(character, featMap) {
  if (!featMap) return [];
  const out = [];
  const push = (nm, inline) => {
    const entries = Array.isArray(inline) ? inline : featMap.get(String(nm || '').toLowerCase())?.entries;
    if (nm && Array.isArray(entries)) out.push({ classId: null, name: nm, level: 1, entries });
  };
  for (const ft of (character?.feats || [])) push(ft.name || ft.featId, ft.entries);
  for (const ft of (character?.custom?.feats || [])) push(ft.name, ft.entries);
  return out;
}

// Geteilter Katalog-Lader (Klassendaten + Feat-/OptFeature-Maps + Species-
// Traits) — gekeyt auf Klassen-/Rassen-Signatur, damit Combat-Writes (HP …)
// keinen Refetch auslösen. dataLoader cached ohnehin modulweit.
function useHydrationData(character) {
  const classSig = (character?.classes || [])
    .map((c) => `${c.classId}:${c.subclassId || ''}:${c.level || 1}`).join(',');
  const raceSig = `${character?.species?.raceId || ''}|${character?.species?.subraceId || ''}`;
  const edition = character?.meta?.edition || '5e';
  const [data, setData] = useState(null); // { classMap, featMap, optionalFeatureMap, raceTraits }
  useEffect(() => {
    const ids = [...new Set((character?.classes || []).map((c) => c.classId).filter(Boolean))];
    let cancelled = false;
    Promise.all([
      Promise.all(ids.map((id) => loadClassData(edition, id).catch(() => null))),
      loadFeatList(edition).catch(() => []),
      loadOptionalFeatureList(edition).catch(() => []),
      loadRaceTraits(edition, character).catch(() => ({ names: [], traits: [], fixedSkills: [] })),
    ]).then(([loaded, featList, ofList, raceTraits]) => {
      if (cancelled) return;
      const classMap = {};
      ids.forEach((id, i) => { if (loaded[i]) classMap[id] = loaded[i]; });
      const featMap = new Map();
      for (const f of (featList || [])) if (f?.name) featMap.set(String(f.name).toLowerCase(), f);
      const optionalFeatureMap = new Map();
      for (const f of (ofList || [])) if (f?.name) optionalFeatureMap.set(String(f.name).toLowerCase(), f);
      setData({ classMap, featMap, optionalFeatureMap, raceTraits });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classSig, raceSig, edition]);
  return data;
}

// Voll hydratisierter Charakter (gleiche transiente Felder wie das Sheet).
// Bis die Kataloge geladen sind, kommt der rohe Charakter zurück — Panels
// rendern kurz ohne die abgeleiteten Rows und poppen dann nach.
export function useVttHydrated(character) {
  const data = useHydrationData(character);
  return useMemo(() => {
    if (!character) return null;
    if (!data) return character;
    try {
      const activeFeatures = collectActiveClassFeatures(character, data.classMap, {
        optionalFeatureMap: data.optionalFeatureMap, featMap: data.featMap,
      });
      const grantedSpells = collectClassGrantedSpells(character, data.classMap, activeFeatures);
      const speciesPatch = {};
      if (data.raceTraits?.names?.length) {
        speciesPatch.__traitNames = data.raceTraits.names;
        speciesPatch.__traits = data.raceTraits.traits;
      }
      if (data.raceTraits?.fixedSkills?.length) speciesPatch.__fixedSkills = data.raceTraits.fixedSkills;
      return {
        ...character,
        species: { ...(character.species || {}), ...speciesPatch },
        __activeFeatures: activeFeatures.length ? activeFeatures : (character.__activeFeatures || []),
        __featFeatures: collectFeatFeatures(character, data.featMap),
        __grantedSpells: grantedSpells,
        __classDataMap: data.classMap || character.__classDataMap,
      };
    } catch { return character; }
  }, [character, data]);
}

export function useVttComputed(character) {
  const hydrated = useVttHydrated(character);
  return useMemo(() => {
    if (!hydrated) return null;
    try { return computeCharacter(hydrated, hydrated.__classDataMap || {}); } catch { return null; }
  }, [hydrated]);
}
