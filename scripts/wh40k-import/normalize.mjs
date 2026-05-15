// scripts/wh40k-import/normalize.mjs
//
// Per-source normalizers: convert each source's intermediate output into
// canonical entities (the schema.d.ts shape). Each source produces a
// PARTIAL canonical dataset; merge.mjs reconciles them later.
//
// Architectural note: normalizers don't cross-reference between sources.
// They are pure transforms (intermediate → canonical) with no awareness of
// other sources. This keeps each source's contribution auditable.

import {
  factionId, detachmentId, unitId, modelProfileId, weaponProfileId,
  abilityId, stratagemId, enhancementId, keywordId, armyRuleId,
  compositionId, wargearOptionId, slugify, withCollisionSuffix,
} from './ids.mjs';
import { stripHtml } from './parsers/util.mjs';
import {
  canonicalFactionName, canonicalKeyword, canonicalWeaponName,
} from './canonicalize.mjs';

/* ═══════════════════════════════════════════════════════════════════════
   BSData normalizer
   ═════════════════════════════════════════════════════════════════════ */

export function normalizeBsdata(parsed, factionAlignmentMap = {}) {
  const out = blankCanonical();
  const seen = makeSeenSets();

  for (const interFaction of parsed.factions || []) {
    // Canonicalise the source-supplied name so BSData/Wahapedia spelling
    // drift collapses to the same id (e.g. "Tau Empire" → "T'au Empire").
    const factionName = canonicalFactionName(interFaction.name);
    const fId = factionId(factionName);
    if (out.factions.find(f => f.id === fId)) continue;

    const armyRules = (interFaction.armyRules || []).map(r => ({
      id: armyRuleId(fId, r.name || ''),
      factionId: fId,
      name: r.name,
      text: r.text,
      source: { primary: 'bsdata', sourceIds: { bsdata: r.bsdataId } },
    }));
    out.armyRules.push(...armyRules);

    out.factions.push({
      id: fId,
      name: factionName,
      shortName: factionName,
      alignment: factionAlignmentMap[fId] || 'unaligned',
      armyRuleIds: armyRules.map(r => r.id),
      factionKeywords: dedup((interFaction.factionKeywords || []).map(canonicalKeyword)),
      source: { primary: 'bsdata', sourceIds: { bsdata: interFaction.bsdataId } },
    });

    // Detachments
    const detachmentIdByName = new Map();
    for (const d of interFaction.detachments || []) {
      if (!d.name) continue;
      const dId = collide(detachmentId(fId, d.name), [d.bsdataId, d.name], seen.detachments);
      detachmentIdByName.set(d.name, dId);

      const detAbilities = (d.abilities || []).map(a => ({
        id: collide(abilityId('detachment', dId, a.name || 'rule'), [a.name], seen.abilities),
        name: a.name || 'Detachment Rule',
        text: a.text || '',
        scope: 'detachment',
        factionId: fId,
        detachmentId: dId,
        source: { primary: 'bsdata' },
      }));
      out.abilities.push(...detAbilities);

      out.detachments.push({
        id: dId,
        factionId: fId,
        name: d.name,
        description: d.description || '',
        abilityIds: detAbilities.map(a => a.id),
        stratagemIds: [],
        enhancementIds: [],
        source: { primary: 'bsdata', sourceIds: { bsdata: d.bsdataId } },
      });
    }

    // Stratagems / enhancements (link back to detachment by name)
    for (const s of interFaction.stratagems || []) {
      const dId = detachmentIdByName.get(s.detachmentName || '') || null;
      if (!dId) continue;  // skip orphan stratagems; merge layer can rescue
      const sId = collide(stratagemId(dId, s.name), [s.bsdataId, s.name], seen.stratagems);
      out.stratagems.push({
        id: sId,
        detachmentId: dId,
        factionId: fId,
        name: s.name,
        cpCost: s.cpCost,
        kind: s.kind,
        phase: s.phase,
        target: s.target,
        effect: s.effect,
        restriction: s.restriction,
        source: { primary: 'bsdata', sourceIds: { bsdata: s.bsdataId } },
      });
      const det = out.detachments.find(x => x.id === dId);
      if (det) det.stratagemIds.push(sId);
    }
    for (const e of interFaction.enhancements || []) {
      const dId = detachmentIdByName.get(e.detachmentName || '') || null;
      if (!dId) continue;
      const eId = collide(enhancementId(dId, e.name), [e.bsdataId, e.name], seen.enhancements);
      out.enhancements.push({
        id: eId,
        detachmentId: dId,
        factionId: fId,
        name: e.name,
        cost: e.cost,
        text: e.text,
        restriction: e.restriction,
        source: { primary: 'bsdata', sourceIds: { bsdata: e.bsdataId } },
      });
      const det = out.detachments.find(x => x.id === dId);
      if (det) det.enhancementIds.push(eId);
    }

    // Units
    for (const u of interFaction.units || []) {
      if (!u.name) continue;
      const uId = collide(unitId(fId, u.name), [u.bsdataId, u.name], seen.units);

      // Profiles
      const modelProfiles = (u.stats || []).map((s, i) => {
        const baseId = modelProfileId(uId, s.name || `profile-${i}`);
        const id = collide(baseId, [s.name, String(i)], seen.modelProfiles);
        return {
          id, unitId: uId,
          name: s.name || u.name,
          m: s.m || '', t: s.t || '', sv: s.sv || '',
          w: s.w || '', ld: s.ld || '', oc: s.oc || '',
          invSv: s.invSv || null,
          source: { primary: 'bsdata' },
        };
      });
      out.modelProfiles.push(...modelProfiles);

      const weaponProfiles = (u.weapons || []).map((w, i) => {
        const wName = canonicalWeaponName(w.name) || `Weapon ${i+1}`;
        const baseId = weaponProfileId(uId, wName || `weapon-${i}`);
        const id = collide(baseId, [wName, String(i)], seen.weaponProfiles);
        return {
          id, unitId: uId,
          name: wName,
          kind: w.kind, range: w.range || (w.kind === 'melee' ? 'Melee' : ''),
          attacks: w.attacks || '',
          bs: w.bs || '', ws: w.ws || '',
          strength: w.strength || '', ap: w.ap || '', damage: w.damage || '',
          abilities: (w.abilities || []).map(canonicalKeyword),
          source: { primary: 'bsdata' },
        };
      });
      out.weaponProfiles.push(...weaponProfiles);

      const unitAbilities = (u.abilities || []).map(a => ({
        id: collide(abilityId('unit', uId, a.name || ''), [a.name], seen.abilities),
        name: a.name || 'Ability',
        text: a.text || '',
        scope: 'unit',
        factionId: fId,
        unitId: uId,
        source: { primary: 'bsdata' },
      }));
      out.abilities.push(...unitAbilities);

      // Keywords — split into faction-keywords and general
      const factionKw = new Set(interFaction.factionKeywords || []);
      const factionKeywordsForUnit = (u.keywords || []).filter(k => factionKw.has(k));

      // Composition
      const compId = compositionId(uId);
      out.unitCompositions.push({
        id: compId,
        unitId: uId,
        text: u.composition?.text || '',
        minModels: u.composition?.minModels ?? null,
        maxModels: u.composition?.maxModels ?? null,
      });

      // Wargear options
      const wargearIds = (u.wargearOptions || []).map((w, i) => {
        const id = wargearOptionId(uId, i);
        out.wargearOptions.push({ id, unitId: uId, text: w.text || '', structured: null });
        return id;
      });

      const unitKeywords = dedup((u.keywords || []).map(canonicalKeyword));
      const unitFactionKws = dedup(factionKeywordsForUnit.map(canonicalKeyword));
      out.units.push({
        id: uId,
        factionId: fId,
        name: u.name,
        role: classifyRole(unitKeywords),
        keywords: unitKeywords,
        factionKeywords: unitFactionKws,
        points: (u.costs || []).map(c => ({ models: 1, cost: c })),
        modelProfileIds: modelProfiles.map(p => p.id),
        weaponProfileIds: weaponProfiles.map(p => p.id),
        abilityIds: unitAbilities.map(a => a.id),
        compositionId: compId,
        wargearOptionIds: wargearIds,
        source: { primary: 'bsdata', sourceIds: { bsdata: u.bsdataId } },
      });
    }
  }

  // Keywords — derived from the union of all units' keywords
  const allKw = new Set();
  for (const u of out.units) for (const k of u.keywords) allKw.add(k);
  for (const f of out.factions) for (const k of f.factionKeywords) allKw.add(k);
  for (const name of allKw) {
    const factionMatch = out.factions.find(f => f.factionKeywords.includes(name));
    out.keywords.push({
      id: keywordId(name),
      name: name.toUpperCase(),
      kind: factionMatch ? 'faction' : classifyKeyword(name),
      factionId: factionMatch?.id,
      source: { primary: 'bsdata' },
    });
  }

  return out;
}

/* ═══════════════════════════════════════════════════════════════════════
   Wahapedia normalizer
   ═════════════════════════════════════════════════════════════════════ */

export function normalizeWahapedia(parsed, factionAlignmentMap = {}) {
  const out = blankCanonical();
  if (!parsed) return out;
  const seen = makeSeenSets();

  // Map Wahapedia faction_id → canonical FactionId for cross-table joins.
  const factionIdByWhpId = new Map();

  for (const f of parsed.factions || []) {
    if (!f.name) continue;
    const fId = factionId(f.name);
    factionIdByWhpId.set(f.id, fId);
    if (!out.factions.find(x => x.id === fId)) {
      out.factions.push({
        id: fId,
        name: f.name,
        shortName: f.name,
        alignment: factionAlignmentMap[fId] || 'unaligned',
        armyRuleIds: [],
        factionKeywords: [],
        source: { primary: 'wahapedia', sourceIds: { wahapedia: f.id } },
      });
    }
  }

  // Datasheets → units
  for (const ds of parsed.datasheets || []) {
    if (!ds.name) continue;
    const rawFactionKey = (ds.faction_id || '').trim();
    if (!rawFactionKey) continue;
    // Prefer the lookup we built from Factions.csv (maps short-code → canonical
    // FactionId). If the lookup misses (a datasheet references a faction
    // that's not in Factions.csv), we slug the raw key — that produces a
    // stable but ugly id like `unit-ac--…`. We tolerate it with a
    // post-import dangling-ref warning so the audit catches it.
    const fId = factionIdByWhpId.get(rawFactionKey) || factionId(rawFactionKey);
    const uId = collide(unitId(fId, ds.name), [ds.id, ds.name], seen.units);

    // Models
    const modelProfiles = (parsed.modelsByDsId.get(ds.id) || []).map((m, i) => {
      const baseId = modelProfileId(uId, m.name || `profile-${i}`);
      const id = collide(baseId, [m.name, String(i)], seen.modelProfiles);
      return {
        id, unitId: uId,
        name: m.name || ds.name,
        m: m.M || '', t: m.T || '', sv: m.Sv || '',
        w: m.W || '',
        ld: m.Ld || '', oc: m.OC || '',
        invSv: m['Sv_inv'] || m.invSv || null,
        source: { primary: 'wahapedia' },
      };
    });

    // Wahapedia ships a small number of placeholder rows (e.g. "Example
    // Wargear", legends-only fragments) with no model profile at all.
    // These are unplayable — skip the datasheet entirely so it never
    // reaches the runtime UI or the validator's no-profile gate.
    if (modelProfiles.length === 0) continue;

    out.modelProfiles.push(...modelProfiles);

    // Wargear / weapons. Wahapedia's wargear table has continuation rows
    // (subsequent profiles of a multi-profile weapon) with blank `name` —
    // and a handful of "weapon" rows with no stats at all (fortification
    // emplacements, etc.). Skip both rather than emit junk rows.
    const weaponProfiles = [];
    const dsName = (ds.name || '').toLowerCase();
    for (const w of parsed.wargearByDsId.get(ds.id) || []) {
      const wname = canonicalWeaponName(w.name);
      const range = (w.range || '').trim();
      const hasStats = (w.A || w.S || w.D || w.AP || w.BS_WS);
      if (!wname && !hasStats) continue;
      if (!wname) continue;
      const kind = /melee/i.test(range) ? 'melee' : 'ranged';
      const baseId = weaponProfileId(uId, wname);
      const id = collide(baseId, [w.line, wname], seen.weaponProfiles);
      weaponProfiles.push({
        id, unitId: uId,
        name: wname,
        kind,
        range: range || (kind === 'melee' ? 'Melee' : ''),
        attacks: w.A || '',
        bs: kind === 'ranged' ? (w.BS_WS || w.BS || '') : '',
        ws: kind === 'melee' ? (w.BS_WS || w.WS || '') : '',
        strength: w.S || '',
        ap: w.AP || '',
        damage: w.D || '',
        abilities: parseWahapediaWeaponKeywords(w.keywords || w.abilities || ''),
        note: stripHtml(w.description || ''),
        source: { primary: 'wahapedia' },
      });
    }
    out.weaponProfiles.push(...weaponProfiles);
    void dsName;

    // Abilities
    const unitAbilities = (parsed.abilitiesByDsId.get(ds.id) || []).map(a => ({
      id: collide(abilityId('unit', uId, a.name || ''), [a.line, a.name], seen.abilities),
      name: a.name || 'Ability',
      text: stripHtml(a.description || ''),
      scope: 'unit',
      factionId: fId,
      unitId: uId,
      source: { primary: 'wahapedia', sourceIds: { wahapedia: a.ability_id } },
    }));
    out.abilities.push(...unitAbilities);

    // Keywords
    const allKws = (parsed.keywordsByDsId.get(ds.id) || []);
    const keywords = dedup(allKws.map(k => k.keyword).filter(Boolean));
    const factionKeywords = dedup(allKws.filter(k => k.is_faction_keyword).map(k => k.keyword));

    // Composition
    const compRows = parsed.compositionByDsId.get(ds.id) || [];
    const compText = compRows.map(c => stripHtml(c.description || '')).join('; ');
    const compId = compositionId(uId);
    out.unitCompositions.push({
      id: compId, unitId: uId, text: compText,
      minModels: parseModelMin(compText),
      maxModels: parseModelMax(compText),
    });

    // Points
    const points = (parsed.modelCostByDsId.get(ds.id) || [])
      .map(c => ({
        models: parseModelCount(c.description) || 1,
        cost: parseInt(String(c.cost || '0').replace(/[^0-9]/g, ''), 10) || 0,
      }))
      .filter(p => p.cost > 0);

    // Wargear options (free-text only — Wahapedia doesn't structure these)
    const wgIds = (parsed.optionsByDsId.get(ds.id) || []).map((opt, i) => {
      const id = wargearOptionId(uId, i);
      out.wargearOptions.push({
        id, unitId: uId,
        text: stripHtml(opt.description || ''),
        structured: null,
      });
      return id;
    });

    out.units.push({
      id: uId,
      factionId: fId,
      name: ds.name,
      role: classifyRole(keywords, ds.role || ''),
      keywords,
      factionKeywords,
      points,
      modelProfileIds: modelProfiles.map(p => p.id),
      weaponProfileIds: weaponProfiles.map(p => p.id),
      abilityIds: unitAbilities.map(a => a.id),
      compositionId: compId,
      wargearOptionIds: wgIds,
      transportCapacity: parseInt(String(ds.transport || '').replace(/[^0-9]/g, ''), 10) || undefined,
      source: { primary: 'wahapedia', sourceIds: { wahapedia: ds.id } },
    });
  }

  // Stratagems. Wahapedia doesn't ship a Detachments.csv — detachments
  // are referenced by NAME in the stratagems and enhancements tables.
  // Auto-create detachment rows on first sight so the foreign-key from
  // stratagem.detachmentId always resolves.
  const ensureDetachment = (fId, name) => {
    if (!fId || !name) return null;
    const dId = detachmentId(fId, name);
    if (!out.detachments.find(d => d.id === dId)) {
      out.detachments.push({
        id: dId, factionId: fId, name,
        description: '',
        abilityIds: [], stratagemIds: [], enhancementIds: [],
        source: { primary: 'wahapedia' },
      });
    }
    return dId;
  };

  for (const s of parsed.stratagems || []) {
    if (!s.name) continue;
    // Skip rows with no faction context (Wahapedia ships some "core"
    // boarding-action stratagems with empty faction_id — they don't
    // belong to any datasheet pool and would crash the id generator).
    const rawFactionKey = (s.faction_id || '').trim();
    if (!rawFactionKey) continue;
    const fId = factionIdByWhpId.get(rawFactionKey) || factionId(rawFactionKey);
    const dId = s.detachment ? ensureDetachment(fId, s.detachment) : null;
    if (!dId) continue;
    const sId = collide(stratagemId(dId, s.name), [s.id, s.name], seen.stratagems);
    out.stratagems.push({
      id: sId,
      detachmentId: dId,
      factionId: fId,
      name: s.name,
      cpCost: parseInt(String(s.cp_cost || '0').replace(/[^0-9]/g, ''), 10) || 0,
      kind: classifyStratagemKind(s.type || ''),
      phase: s.phase || '',
      target: s.target || '',
      effect: stripHtml(s.description || ''),
      restriction: s.restriction || '',
      source: { primary: 'wahapedia', sourceIds: { wahapedia: s.id } },
    });
  }

  // Global keyword universe — derived from the union of every unit's
  // keyword list. The keyword `kind` is inferred from a small static
  // table (general/role/faction/unit-type/…).
  const seenKw = new Set();
  for (const u of out.units) {
    for (const k of u.keywords || []) {
      if (!k || seenKw.has(k)) continue;
      seenKw.add(k);
      const factionMatch = out.factions.find(f => (f.factionKeywords || []).includes(k));
      out.keywords.push({
        id: keywordId(k),
        name: k.toUpperCase(),
        kind: factionMatch ? 'faction' : classifyKeyword(k),
        factionId: factionMatch?.id,
        source: { primary: 'wahapedia' },
      });
    }
  }

  // Enhancements
  for (const e of parsed.enhancements || []) {
    if (!e.name) continue;
    const rawFactionKey = (e.faction_id || '').trim();
    if (!rawFactionKey) continue;
    const fId = factionIdByWhpId.get(rawFactionKey) || factionId(rawFactionKey);
    const dId = e.detachment ? ensureDetachment(fId, e.detachment) : null;
    if (!dId) continue;
    const eId = collide(enhancementId(dId, e.name), [e.id, e.name], seen.enhancements);
    out.enhancements.push({
      id: eId,
      detachmentId: dId,
      factionId: fId,
      name: e.name,
      cost: parseInt(String(e.cost || '0').replace(/[^0-9]/g, ''), 10) || 0,
      text: stripHtml(e.description || ''),
      restriction: e.restriction || '',
      source: { primary: 'wahapedia', sourceIds: { wahapedia: e.id } },
    });
  }

  return out;
}

/* ═══════════════════════════════════════════════════════════════════════
   Seed normalizer — produces a small but valid canonical dataset from the
   inline curated content. Used as a fallback when no upstream sources are
   available, and as the runtime "default" until a real import is run.
   ═════════════════════════════════════════════════════════════════════ */

export function normalizeSeed() {
  const out = blankCanonical();
  const factionsRaw = SEED_FACTIONS;
  const detachmentsRaw = SEED_DETACHMENTS;
  const unitsRaw = SEED_UNITS;

  for (const f of factionsRaw) {
    out.factions.push({
      id: f.id, name: f.name, shortName: f.shortName,
      alignment: f.alignment, color: f.color, icon: f.icon,
      armyRuleIds: [], factionKeywords: dedup(f.factionKeywords || []),
      source: { primary: 'seed' },
    });
  }
  for (const d of detachmentsRaw) {
    out.detachments.push({
      id: detachmentId(d.factionId, d.name),
      factionId: d.factionId, name: d.name,
      description: '', abilityIds: [], stratagemIds: [], enhancementIds: [],
      source: { primary: 'seed' },
    });
  }
  for (const u of unitsRaw) {
    const uId = unitId(u.factionId, u.name);

    const modelProfiles = (u.stats || []).map((s, i) => ({
      id: modelProfileId(uId, s.name || `profile-${i}`),
      unitId: uId,
      name: s.name || u.name,
      m: s.m, t: s.t, sv: s.sv, w: s.w, ld: s.ld, oc: s.oc,
      invSv: s.invSv || null,
      source: { primary: 'seed' },
    }));
    out.modelProfiles.push(...modelProfiles);

    const weaponProfiles = (u.wargear || []).map((w, i) => {
      const range = (w.range || '').trim();
      const kind = /melee/i.test(range) ? 'melee' : 'ranged';
      return {
        id: weaponProfileId(uId, w.name || `weapon-${i}`),
        unitId: uId, name: w.name, kind,
        range: range || (kind === 'melee' ? 'Melee' : ''),
        attacks: w.a || '',
        bs: kind === 'ranged' ? (w.bs || '') : '',
        ws: kind === 'melee' ? (w.ws || '') : '',
        strength: w.s || '', ap: w.ap || '', damage: w.d || '',
        abilities: w.abilities || [],
        source: { primary: 'seed' },
      };
    });
    out.weaponProfiles.push(...weaponProfiles);

    const abilities = (u.abilities || []).map(a => ({
      id: abilityId('unit', uId, a.name),
      name: a.name, text: a.text, scope: 'unit',
      factionId: u.factionId, unitId: uId,
      source: { primary: 'seed' },
    }));
    out.abilities.push(...abilities);

    const compId = compositionId(uId);
    out.unitCompositions.push({
      id: compId, unitId: uId,
      text: (u.modelCounts || []).map(n => `${n} models`).join(' / ') || '1 model',
      minModels: u.modelCounts?.[0] ?? null,
      maxModels: u.modelCounts?.[u.modelCounts.length - 1] ?? null,
    });

    const factionKw = new Set(factionsRaw.find(f => f.id === u.factionId)?.factionKeywords || []);
    out.units.push({
      id: uId, factionId: u.factionId, name: u.name,
      role: u.role, keywords: dedup(u.keywords || []),
      factionKeywords: (u.keywords || []).filter(k => factionKw.has(k)),
      points: (u.modelCounts || [1]).map((n, i) => ({
        models: n, cost: Array.isArray(u.points) ? u.points[i] : u.points,
      })),
      modelProfileIds: modelProfiles.map(p => p.id),
      weaponProfileIds: weaponProfiles.map(p => p.id),
      abilityIds: abilities.map(a => a.id),
      compositionId: compId, wargearOptionIds: [],
      source: { primary: 'seed' },
    });
  }

  // Keyword universe
  const allKw = new Set();
  for (const u of out.units) for (const k of u.keywords) allKw.add(k);
  for (const name of allKw) {
    const factionMatch = out.factions.find(f => f.factionKeywords.includes(name));
    out.keywords.push({
      id: keywordId(name), name: name.toUpperCase(),
      kind: factionMatch ? 'faction' : classifyKeyword(name),
      factionId: factionMatch?.id, source: { primary: 'seed' },
    });
  }

  return out;
}

/* ───────────────────── shared helpers ───────────────────── */

export function blankCanonical() {
  return {
    factions: [], detachments: [], units: [],
    modelProfiles: [], weaponProfiles: [],
    abilities: [], keywords: [],
    stratagems: [], enhancements: [], armyRules: [],
    unitCompositions: [], wargearOptions: [],
  };
}

function makeSeenSets() {
  return {
    factions: new Set(), detachments: new Set(), units: new Set(),
    modelProfiles: new Set(), weaponProfiles: new Set(),
    abilities: new Set(), stratagems: new Set(), enhancements: new Set(),
  };
}

function collide(baseId, disambiguators, seenSet) {
  const id = withCollisionSuffix(baseId, disambiguators, seenSet);
  seenSet.add(id);
  return id;
}

function dedup(arr) {
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    if (v == null) continue;
    const k = String(v);
    if (seen.has(k)) continue;
    seen.add(k); out.push(v);
  }
  return out;
}

/** Heuristic role classification from keywords. Battleline > Character > Vehicle > Monster > Infantry. */
export function classifyRole(keywords = [], roleHint = '') {
  const k = new Set((keywords || []).map(s => String(s).toUpperCase()));
  const hint = (roleHint || '').toLowerCase();
  if (k.has('EPIC HERO')) return 'epic-hero';
  if (k.has('CHARACTER')) return 'character';
  if (k.has('BATTLELINE')) return 'battleline';
  if (k.has('DEDICATED TRANSPORT') || hint.includes('transport')) return 'transport';
  if (k.has('AIRCRAFT')) return 'aircraft';
  if (k.has('TITANIC')) return 'titanic';
  if (k.has('FORTIFICATION')) return 'fortification';
  if (k.has('WALKER')) return 'walker';
  if (k.has('VEHICLE')) return 'vehicle';
  if (k.has('MONSTER')) return 'monster';
  if (k.has('BEAST')) return 'beast';
  if (k.has('MOUNTED')) return 'mounted';
  return 'infantry';
}

function classifyKeyword(name) {
  const KW_ROLE = new Set(['BATTLELINE', 'CHARACTER', 'EPIC HERO', 'DEDICATED TRANSPORT']);
  const KW_GENERAL = new Set([
    'INFANTRY', 'VEHICLE', 'WALKER', 'MONSTER', 'BEAST', 'MOUNTED',
    'AIRCRAFT', 'PSYKER', 'TERMINATOR', 'JUMP PACK', 'GRAV-TANK',
    'TRANSPORT', 'TITANIC', 'FORTIFICATION',
  ]);
  if (KW_ROLE.has(name)) return 'role';
  if (KW_GENERAL.has(name)) return 'general';
  return 'unit-type';
}

function classifyStratagemKind(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('battle')) return 'battle-tactic';
  if (t.includes('wargear')) return 'wargear';
  if (t.includes('epic')) return 'epic-deed';
  if (t.includes('strategic')) return 'strategic-ploy';
  if (t.includes('requisition')) return 'requisition';
  return 'battle-tactic';
}

function parseWahapediaWeaponKeywords(text) {
  if (!text) return [];
  return stripHtml(text).split(/[,;]/).map(s => s.trim().toUpperCase()).filter(Boolean);
}

function parseModelCount(desc) {
  if (!desc) return null;
  const m = String(desc).match(/(\d+)\s*model/i);
  return m ? parseInt(m[1], 10) : null;
}
function parseModelMin(text) {
  const m = String(text || '').match(/(\d+)\s*[-–]\s*\d+/);
  if (m) return parseInt(m[1], 10);
  const m2 = String(text || '').match(/(\d+)\s*model/i);
  return m2 ? parseInt(m2[1], 10) : null;
}
function parseModelMax(text) {
  const m = String(text || '').match(/\d+\s*[-–]\s*(\d+)/);
  if (m) return parseInt(m[1], 10);
  const m2 = String(text || '').match(/(\d+)\s*model/i);
  return m2 ? parseInt(m2[1], 10) : null;
}

/* ═══════════════════════════════════════════════════════════════════════
   Seed payload — kept inline so the seed normalizer has zero file deps.
   When the importer is run with real sources, this payload is unused.
   ═════════════════════════════════════════════════════════════════════ */

const SEED_FACTIONS = [
  { id: factionId('Space Marines'),     name: 'Space Marines',         shortName: 'Space Marines',  alignment: 'imperium', color: '#4a6fa5', icon: 'Ω', factionKeywords: ['IMPERIUM', 'ADEPTUS ASTARTES'] },
  { id: factionId('Adeptus Custodes'),  name: 'Adeptus Custodes',      shortName: 'Custodes',       alignment: 'imperium', color: '#c8a74a', icon: '✦', factionKeywords: ['IMPERIUM', 'ADEPTUS CUSTODES'] },
  { id: factionId('Astra Militarum'),   name: 'Astra Militarum',       shortName: 'Guard',          alignment: 'imperium', color: '#6b8e23', icon: '⚔', factionKeywords: ['IMPERIUM', 'ASTRA MILITARUM'] },
  { id: factionId('Chaos Space Marines'), name: 'Chaos Space Marines', shortName: 'CSM',            alignment: 'chaos',    color: '#9c2a2a', icon: '☠', factionKeywords: ['CHAOS', 'HERETIC ASTARTES'] },
  { id: factionId('Death Guard'),       name: 'Death Guard',           shortName: 'Death Guard',    alignment: 'chaos',    color: '#7a8c4a', icon: '✺', factionKeywords: ['CHAOS', 'DEATH GUARD'] },
  { id: factionId('Necrons'),           name: 'Necrons',               shortName: 'Necrons',        alignment: 'xenos',    color: '#3a8a4a', icon: '◆', factionKeywords: ['NECRONS'] },
  { id: factionId('Tyranids'),          name: 'Tyranids',              shortName: 'Tyranids',       alignment: 'xenos',    color: '#8a4a8a', icon: '◈', factionKeywords: ['TYRANIDS'] },
  { id: factionId('Aeldari'),           name: 'Aeldari',               shortName: 'Aeldari',        alignment: 'xenos',    color: '#4a8aa8', icon: '✧', factionKeywords: ['AELDARI'] },
  { id: factionId('Orks'),              name: 'Orks',                  shortName: 'Orks',           alignment: 'xenos',    color: '#6b9c2a', icon: '▲', factionKeywords: ['ORKS'] },
  { id: factionId("T'au Empire"),       name: "T'au Empire",           shortName: "T'au",           alignment: 'xenos',    color: '#c87a3a', icon: '◉', factionKeywords: ["T'AU EMPIRE"] },
];

const SEED_DETACHMENTS = [
  { factionId: factionId('Space Marines'),     name: 'Gladius Task Force' },
  { factionId: factionId('Space Marines'),     name: 'Ironstorm Spearhead' },
  { factionId: factionId('Space Marines'),     name: 'Firestorm Assault Force' },
  { factionId: factionId('Space Marines'),     name: 'Anvil Siege Force' },
  { factionId: factionId('Adeptus Custodes'),  name: 'Shield Host' },
  { factionId: factionId('Adeptus Custodes'),  name: 'Lions of the Emperor' },
  { factionId: factionId('Astra Militarum'),   name: 'Combined Regiment' },
  { factionId: factionId('Astra Militarum'),   name: 'Bridgehead Strike' },
  { factionId: factionId('Chaos Space Marines'), name: 'Pactbound Zealots' },
  { factionId: factionId('Chaos Space Marines'), name: 'Renegade Raiders' },
  { factionId: factionId('Death Guard'),       name: 'Plague Company' },
  { factionId: factionId('Necrons'),           name: 'Awakened Dynasty' },
  { factionId: factionId('Necrons'),           name: 'Canoptek Court' },
  { factionId: factionId('Tyranids'),          name: 'Invasion Fleet' },
  { factionId: factionId('Tyranids'),          name: 'Assimilation Swarm' },
  { factionId: factionId('Aeldari'),           name: 'Battle Host' },
  { factionId: factionId('Aeldari'),           name: 'Windrider Host' },
  { factionId: factionId('Orks'),              name: 'Waaagh! Tribe' },
  { factionId: factionId('Orks'),              name: 'Kult of Speed' },
  { factionId: factionId("T'au Empire"),       name: "Mont'ka" },
  { factionId: factionId("T'au Empire"),       name: 'Kauyon' },
];

// Curated 22-unit seed across all factions. Every unit is valid to the
// canonical schema after normalization. Replace with real import for
// production data.
const SEED_UNITS = [
  { factionId: factionId('Space Marines'), name: 'Captain', role: 'character', points: [80], modelCounts: [1],
    keywords: ['INFANTRY', 'CHARACTER', 'IMPERIUM', 'ADEPTUS ASTARTES'],
    stats: [{ name: 'Captain', m: '6"', t: '4', sv: '3+', w: '5', ld: '6+', oc: '1' }],
    abilities: [
      { name: 'Leader', text: 'This unit can be attached to one of the listed Bodyguard units.' },
      { name: 'Rites of Battle', text: "Once per battle round, the bearer's unit can re-roll a Hit roll, Wound roll, or saving throw." },
    ],
    wargear: [
      { name: 'Master-crafted bolt rifle', range: '30"', a: '2', bs: '2+', s: '4', ap: '-1', d: '2' },
      { name: 'Power fist', range: 'Melee', a: '5', ws: '2+', s: '8', ap: '-2', d: '2' },
    ],
  },
  { factionId: factionId('Space Marines'), name: 'Intercessor Squad', role: 'battleline', points: [80], modelCounts: [5],
    keywords: ['INFANTRY', 'BATTLELINE', 'IMPERIUM', 'ADEPTUS ASTARTES'],
    stats: [
      { name: 'Intercessor Sergeant', m: '6"', t: '4', sv: '3+', w: '2', ld: '6+', oc: '2' },
      { name: 'Intercessor', m: '6"', t: '4', sv: '3+', w: '2', ld: '7+', oc: '2' },
    ],
    abilities: [{ name: 'Objective Secured', text: 'Battleline units count as 2 models when contesting objectives.' }],
    wargear: [{ name: 'Bolt rifle', range: '24"', a: '2', bs: '3+', s: '4', ap: '-1', d: '1' }],
  },
  { factionId: factionId('Space Marines'), name: 'Terminator Squad', role: 'infantry', points: [170], modelCounts: [5],
    keywords: ['INFANTRY', 'TERMINATOR', 'IMPERIUM', 'ADEPTUS ASTARTES'],
    stats: [
      { name: 'Terminator Sergeant', m: '5"', t: '5', sv: '2+', w: '3', ld: '6+', oc: '1' },
      { name: 'Terminator', m: '5"', t: '5', sv: '2+', w: '3', ld: '7+', oc: '1' },
    ],
    abilities: [
      { name: 'Teleport Strike', text: 'During deployment, you can place this unit in Reserves.' },
      { name: 'Deep Strike', text: 'Arrives from any battlefield edge, more than 9" from enemy units.' },
    ],
    wargear: [
      { name: 'Storm bolter', range: '24"', a: '2', bs: '3+', s: '4', ap: '0', d: '1' },
      { name: 'Power fist', range: 'Melee', a: '3', ws: '3+', s: '8', ap: '-2', d: '2' },
    ],
  },
  { factionId: factionId('Space Marines'), name: 'Redemptor Dreadnought', role: 'vehicle', points: [210], modelCounts: [1],
    keywords: ['VEHICLE', 'WALKER', 'DREADNOUGHT', 'IMPERIUM', 'ADEPTUS ASTARTES'],
    stats: [{ name: 'Redemptor Dreadnought', m: '8"', t: '10', sv: '2+', w: '12', ld: '6+', oc: '3' }],
    abilities: [{ name: 'Duty and Honour', text: 'Re-roll Hit rolls of 1 against units that have damaged this model.' }],
    wargear: [
      { name: 'Macro plasma incinerator', range: '36"', a: 'd6+1', bs: '3+', s: '8', ap: '-3', d: '2' },
      { name: 'Redemptor fist', range: 'Melee', a: '5', ws: '3+', s: '12', ap: '-2', d: '3' },
    ],
  },
  { factionId: factionId('Adeptus Custodes'), name: 'Custodian Guard', role: 'battleline', points: [215], modelCounts: [4],
    keywords: ['INFANTRY', 'BATTLELINE', 'IMPERIUM', 'ADEPTUS CUSTODES'],
    stats: [{ name: 'Custodian Guard', m: '5"', t: '6', sv: '2+', w: '3', ld: '6+', oc: '2' }],
    abilities: [{ name: 'Aegis of the Emperor', text: 'Models in this unit have a 4+ invulnerable save.' }],
    wargear: [{ name: 'Guardian spear', range: 'Melee', a: '5', ws: '2+', s: '7', ap: '-2', d: '2' }],
  },
  { factionId: factionId('Adeptus Custodes'), name: 'Shield-Captain', role: 'character', points: [130], modelCounts: [1],
    keywords: ['INFANTRY', 'CHARACTER', 'IMPERIUM', 'ADEPTUS CUSTODES'],
    stats: [{ name: 'Shield-Captain', m: '5"', t: '6', sv: '2+', w: '6', ld: '5+', oc: '1' }],
    abilities: [{ name: 'Leader', text: 'Can attach to a Custodian Guard unit.' }],
    wargear: [{ name: 'Guardian spear', range: 'Melee', a: '6', ws: '2+', s: '7', ap: '-2', d: '2' }],
  },
  { factionId: factionId('Astra Militarum'), name: 'Cadian Shock Troops', role: 'battleline', points: [65], modelCounts: [10],
    keywords: ['INFANTRY', 'BATTLELINE', 'IMPERIUM', 'ASTRA MILITARUM'],
    stats: [
      { name: 'Sergeant', m: '6"', t: '3', sv: '5+', w: '1', ld: '7+', oc: '2' },
      { name: 'Shock Trooper', m: '6"', t: '3', sv: '5+', w: '1', ld: '8+', oc: '2' },
    ],
    abilities: [{ name: 'Voice of Command', text: 'Once per turn, this unit can issue an order.' }],
    wargear: [{ name: 'Lasgun', range: '24"', a: '1', bs: '4+', s: '3', ap: '0', d: '1' }],
  },
  { factionId: factionId('Astra Militarum'), name: 'Leman Russ Battle Tank', role: 'vehicle', points: [175], modelCounts: [1],
    keywords: ['VEHICLE', 'TANK', 'IMPERIUM', 'ASTRA MILITARUM'],
    stats: [{ name: 'Leman Russ', m: '10"', t: '11', sv: '2+', w: '13', ld: '7+', oc: '3' }],
    abilities: [{ name: 'Steel Behemoth', text: 'Can shoot even when within Engagement Range of enemies.' }],
    wargear: [
      { name: 'Battle cannon', range: '72"', a: 'd6+3', bs: '4+', s: '10', ap: '-1', d: '3' },
      { name: 'Heavy bolter', range: '36"', a: '3', bs: '4+', s: '5', ap: '-1', d: '2' },
    ],
  },
  { factionId: factionId('Chaos Space Marines'), name: 'Legionaries', role: 'battleline', points: [90], modelCounts: [5],
    keywords: ['INFANTRY', 'BATTLELINE', 'CHAOS', 'HERETIC ASTARTES'],
    stats: [
      { name: 'Aspiring Champion', m: '6"', t: '4', sv: '3+', w: '2', ld: '6+', oc: '2' },
      { name: 'Legionary', m: '6"', t: '4', sv: '3+', w: '2', ld: '7+', oc: '2' },
    ],
    abilities: [{ name: 'Profane Zeal', text: 'Re-roll Battle-shock tests.' }],
    wargear: [
      { name: 'Astartes chainsword', range: 'Melee', a: '4', ws: '3+', s: '4', ap: '-1', d: '1' },
      { name: 'Bolt pistol', range: '12"', a: '1', bs: '3+', s: '4', ap: '0', d: '1' },
    ],
  },
  { factionId: factionId('Chaos Space Marines'), name: 'Chaos Lord', role: 'character', points: [90], modelCounts: [1],
    keywords: ['INFANTRY', 'CHARACTER', 'CHAOS', 'HERETIC ASTARTES'],
    stats: [{ name: 'Chaos Lord', m: '6"', t: '4', sv: '3+', w: '5', ld: '6+', oc: '1' }],
    abilities: [{ name: 'Leader', text: 'Can lead Legionaries / Chosen / Terminators.' }],
    wargear: [{ name: 'Daemonic axe', range: 'Melee', a: '5', ws: '2+', s: '6', ap: '-2', d: '2' }],
  },
  { factionId: factionId('Death Guard'), name: 'Plague Marines', role: 'battleline', points: [90], modelCounts: [5],
    keywords: ['INFANTRY', 'BATTLELINE', 'CHAOS', 'DEATH GUARD'],
    stats: [
      { name: 'Plague Champion', m: '5"', t: '5', sv: '3+', w: '2', ld: '6+', oc: '2' },
      { name: 'Plague Marine', m: '5"', t: '5', sv: '3+', w: '2', ld: '7+', oc: '2' },
    ],
    abilities: [{ name: 'Disgustingly Resilient', text: '5+ Feel No Pain against damage of 1.' }],
    wargear: [{ name: 'Boltgun', range: '24"', a: '2', bs: '3+', s: '4', ap: '0', d: '1' }],
  },
  { factionId: factionId('Necrons'), name: 'Necron Warriors', role: 'battleline', points: [100], modelCounts: [10],
    keywords: ['INFANTRY', 'BATTLELINE', 'NECRONS'],
    stats: [{ name: 'Necron Warrior', m: '5"', t: '4', sv: '4+', w: '1', ld: '8+', oc: '2' }],
    abilities: [{ name: 'Reanimation Protocols', text: 'Slain models may return to the unit.' }],
    wargear: [{ name: 'Gauss flayer', range: '24"', a: '1', bs: '4+', s: '4', ap: '0', d: '1' }],
  },
  { factionId: factionId('Necrons'), name: 'Overlord', role: 'character', points: [85], modelCounts: [1],
    keywords: ['INFANTRY', 'CHARACTER', 'NECRONS'],
    stats: [{ name: 'Overlord', m: '5"', t: '5', sv: '3+', w: '5', ld: '6+', oc: '1' }],
    abilities: [{ name: 'Leader', text: 'Can lead Necron Warriors / Lychguard.' }],
    wargear: [{ name: 'Tachyon arrow', range: '120"', a: '1', bs: '2+', s: '16', ap: '-4', d: 'd6+6' }],
  },
  { factionId: factionId('Necrons'), name: 'Canoptek Doomstalker', role: 'vehicle', points: [140], modelCounts: [1],
    keywords: ['VEHICLE', 'WALKER', 'NECRONS'],
    stats: [{ name: 'Canoptek Doomstalker', m: '8"', t: '9', sv: '3+', w: '9', ld: '8+', oc: '2' }],
    abilities: [{ name: 'Living Metal', text: 'At the end of the turn this model regains 1 lost wound.' }],
    wargear: [{ name: 'Doomsday blaster', range: '48"', a: 'd3+3', bs: '4+', s: '10', ap: '-3', d: '3' }],
  },
  { factionId: factionId('Tyranids'), name: 'Termagants', role: 'battleline', points: [60], modelCounts: [10],
    keywords: ['INFANTRY', 'BATTLELINE', 'TYRANIDS'],
    stats: [{ name: 'Termagant', m: '6"', t: '3', sv: '5+', w: '1', ld: '7+', oc: '2' }],
    abilities: [{ name: 'Endless Multitude', text: 'Reinforce up to 10 destroyed models.' }],
    wargear: [{ name: 'Fleshborer', range: '18"', a: '1', bs: '4+', s: '4', ap: '0', d: '1' }],
  },
  { factionId: factionId('Tyranids'), name: 'Carnifex', role: 'monster', points: [105], modelCounts: [1],
    keywords: ['MONSTER', 'TYRANIDS'],
    stats: [{ name: 'Carnifex', m: '8"', t: '9', sv: '2+', w: '8', ld: '7+', oc: '3' }],
    abilities: [{ name: 'Living Battering Ram', text: '+1 to Hit on the turn it Charges.' }],
    wargear: [{ name: 'Scything talons', range: 'Melee', a: '5', ws: '3+', s: '9', ap: '-2', d: '2' }],
  },
  { factionId: factionId('Aeldari'), name: 'Guardian Defenders', role: 'battleline', points: [100], modelCounts: [10],
    keywords: ['INFANTRY', 'BATTLELINE', 'AELDARI'],
    stats: [{ name: 'Guardian Defender', m: '7"', t: '3', sv: '5+', w: '1', ld: '7+', oc: '2' }],
    abilities: [{ name: 'Battle Focus', text: 'After shooting, this unit can make a Normal move.' }],
    wargear: [{ name: 'Shuriken catapult', range: '12"', a: '2', bs: '3+', s: '4', ap: '-1', d: '1' }],
  },
  { factionId: factionId('Aeldari'), name: 'Farseer', role: 'character', points: [80], modelCounts: [1],
    keywords: ['INFANTRY', 'CHARACTER', 'PSYKER', 'AELDARI'],
    stats: [{ name: 'Farseer', m: '7"', t: '3', sv: '6+', w: '4', ld: '6+', oc: '1' }],
    abilities: [{ name: 'Doom', text: 'Re-roll wound rolls against a target enemy unit.' }],
    wargear: [{ name: 'Witchblade', range: 'Melee', a: '3', ws: '2+', s: '4', ap: '-1', d: 'd3' }],
  },
  { factionId: factionId('Orks'), name: 'Boyz', role: 'battleline', points: [90], modelCounts: [10],
    keywords: ['INFANTRY', 'BATTLELINE', 'ORKS'],
    stats: [
      { name: 'Boss Nob', m: '6"', t: '5', sv: '6+', w: '2', ld: '6+', oc: '2' },
      { name: 'Boy', m: '6"', t: '5', sv: '6+', w: '1', ld: '7+', oc: '2' },
    ],
    abilities: [{ name: 'Mob Rule', text: 'Test Battle-shock based on number of models, not wounds.' }],
    wargear: [
      { name: 'Choppa', range: 'Melee', a: '3', ws: '3+', s: '4', ap: '-1', d: '1' },
      { name: 'Slugga', range: '12"', a: '1', bs: '5+', s: '4', ap: '0', d: '1' },
    ],
  },
  { factionId: factionId('Orks'), name: 'Warboss', role: 'character', points: [75], modelCounts: [1],
    keywords: ['INFANTRY', 'CHARACTER', 'ORKS'],
    stats: [{ name: 'Warboss', m: '6"', t: '6', sv: '4+', w: '6', ld: '6+', oc: '1' }],
    abilities: [{ name: 'Waaagh!', text: 'Once per battle, declare a Waaagh! to buff your army.' }],
    wargear: [{ name: 'Power klaw', range: 'Melee', a: '5', ws: '3+', s: '10', ap: '-2', d: '2' }],
  },
  { factionId: factionId("T'au Empire"), name: 'Strike Team', role: 'battleline', points: [75], modelCounts: [5],
    keywords: ['INFANTRY', 'BATTLELINE', "T'AU EMPIRE"],
    stats: [
      { name: "Shas'ui", m: '6"', t: '3', sv: '4+', w: '1', ld: '7+', oc: '2' },
      { name: 'Fire Warrior', m: '6"', t: '3', sv: '4+', w: '1', ld: '8+', oc: '2' },
    ],
    abilities: [{ name: 'For the Greater Good', text: 'When a friendly unit is targeted, this unit can fire Overwatch.' }],
    wargear: [{ name: 'Pulse rifle', range: '30"', a: '1', bs: '4+', s: '5', ap: '0', d: '1' }],
  },
  { factionId: factionId("T'au Empire"), name: 'Crisis Battlesuits', role: 'infantry', points: [130], modelCounts: [3],
    keywords: ['MOUNTED', 'BATTLESUIT', "T'AU EMPIRE"],
    stats: [{ name: 'Crisis Battlesuit', m: '10"', t: '5', sv: '3+', w: '5', ld: '7+', oc: '1' }],
    abilities: [{ name: 'Manta Strike', text: 'Can deploy from Reserves anywhere more than 9" from enemies.' }],
    wargear: [{ name: 'Burst cannon', range: '18"', a: '4', bs: '4+', s: '5', ap: '0', d: '1' }],
  },
];
