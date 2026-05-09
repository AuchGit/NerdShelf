// scripts/wh40k-import/parsers/bsdata.mjs
//
// BSData (BattleScribe) XML parser.
//
// BSData ships catalogues as `.cat` (faction-specific) and `.gst` (game-wide
// shared) files; both are XML in the BattleScribe schema. The pieces we
// care about for 10e are:
//
//   <gameSystem id="…" name="Warhammer 40,000 10th Edition">
//     <costTypes>…</costTypes>          # defines 'pts', 'CP', etc.
//     <profileTypes>…</profileTypes>    # defines what a 'Unit', 'Weapon', etc. profile looks like
//     <forceEntries>…</forceEntries>    # detachment templates
//     <sharedSelectionEntries>…</sharedSelectionEntries>
//     <sharedProfiles>…</sharedProfiles>
//   </gameSystem>
//
//   <catalogue id="…" name="Space Marines">
//     <selectionEntries>
//       <selectionEntry type="unit" name="Captain">
//         <profiles>
//           <profile typeName="Unit" name="Captain">
//             <characteristics>
//               <characteristic name="M">6"</characteristic>
//               <characteristic name="T">4</characteristic>
//               …
//             </characteristics>
//           </profile>
//           <profile typeName="Ranged Weapons" name="Master-crafted bolt rifle">
//             <characteristics>…</characteristics>
//           </profile>
//         </profiles>
//         <costs><cost name="pts" value="80"/></costs>
//         <infoLinks>…</infoLinks>     # reference shared abilities / weapons
//         <selectionEntryGroups>…</selectionEntryGroups>  # wargear options
//         <categoryLinks>…</categoryLinks>                # keywords
//       </selectionEntry>
//     </selectionEntries>
//   </catalogue>
//
// The parser produces an "intermediate" shape — close to the source but
// already cleaned up (whitespace trimmed, characteristics indexed by name,
// shared profiles inlined where the unit references them). The
// normalizers (normalize.mjs) take it from there to canonical.

import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { XMLParser } from 'fast-xml-parser';

const XML_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // Preserve element order (matters for wargear options / numbered lists)
  preserveOrder: false,
  // Always-array list — when an element appears 1× or 0× we still get [].
  // This avoids if-Array.isArray checks throughout the parser.
  isArray: (name) => ARRAY_TAGS.has(name),
  // Don't convert numbers — BS values are strings ("d6+1", "2+", etc.)
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
};

const ARRAY_TAGS = new Set([
  'catalogue', 'selectionEntry', 'selectionEntryGroup', 'profile',
  'characteristic', 'cost', 'costType', 'infoLink', 'categoryLink',
  'category', 'modifier', 'condition', 'conditionGroup', 'repeat',
  'rule', 'sharedSelectionEntry', 'sharedSelectionEntryGroup',
  'sharedProfile', 'sharedRule', 'sharedInfoGroup', 'infoGroup',
  'forceEntry', 'entryLink', 'constraint', 'publication',
]);

const xml = new XMLParser(XML_OPTIONS);

/**
 * Walk a BSData repo, parse every catalogue, and produce a per-faction
 * intermediate dataset. Returns:
 *   { factions: IntermediateFaction[], shared: { abilities, profiles } }
 */
export async function parseBsdataRepo(repoPath, { logger } = {}) {
  const log = logger || console;
  const allFiles = await readdir(repoPath, { recursive: true });
  const catFiles = allFiles.filter(f => f.endsWith('.cat'));
  const gstFiles = allFiles.filter(f => f.endsWith('.gst'));

  log.info?.(`bsdata: ${catFiles.length} .cat + ${gstFiles.length} .gst files`);

  // 1. Parse the gameSystem (.gst) to capture shared profiles, rules, etc.
  const shared = { rules: new Map(), profiles: new Map(), entries: new Map() };
  for (const f of gstFiles) {
    const xmlText = await readFile(join(repoPath, f), 'utf8');
    const doc = xml.parse(xmlText);
    indexShared(doc.gameSystem || doc, shared);
  }

  // 2. Parse each catalogue (.cat) into an intermediate faction.
  const factions = [];
  for (const f of catFiles) {
    const xmlText = await readFile(join(repoPath, f), 'utf8');
    const doc = xml.parse(xmlText);
    const cat = doc.catalogue;
    if (!cat) continue;
    const faction = parseCatalogue(cat, shared, { sourceFile: basename(f) });
    if (faction) factions.push(faction);
  }
  return { factions, shared };
}

function indexShared(node, shared) {
  if (!node) return;
  // Recurse into both sharedSelectionEntries and (rare) nested catalogues.
  for (const e of asArray(node.sharedSelectionEntries?.sharedSelectionEntry)) {
    shared.entries.set(e['@_id'], e);
  }
  for (const p of asArray(node.sharedProfiles?.sharedProfile)) {
    shared.profiles.set(p['@_id'], p);
  }
  for (const r of asArray(node.sharedRules?.sharedRule || node.sharedRules?.rule)) {
    shared.rules.set(r['@_id'], r);
  }
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function attr(node, name) {
  return node?.[`@_${name}`];
}

/* ─────────────────── catalogue → faction ─────────────────── */

function parseCatalogue(cat, shared, { sourceFile }) {
  const factionName = attr(cat, 'name');
  if (!factionName) return null;

  // Extract everything we care about. BSData splits a faction across
  // selectionEntries (units), forceEntries (detachments), categoryLinks
  // (faction-keywords), publications, etc.
  const intermediate = {
    sourceFile,
    bsdataId: attr(cat, 'id'),
    name: factionName,
    units: [],
    detachments: [],
    stratagems: [],
    enhancements: [],
    abilities: [],
    factionKeywords: [],
    armyRules: [],
  };

  // Walk top-level selectionEntries (units, detachment-rule containers, …)
  for (const se of asArray(cat.selectionEntries?.selectionEntry)) {
    classifySelectionEntry(se, intermediate, shared);
  }

  // Walk forceEntries → detachments. BSData represents a 'Detachment' as a
  // forceEntry (e.g. "Patrol", or in 10e the Combat Patrol / Strike Force
  // roster sizes). Modern 10e codices put the actual *detachment-rules*
  // (Gladius, Ironstorm, …) under selectionEntries with category
  // "Detachment Rule" — we collect both shapes and reconcile later.
  for (const fe of asArray(cat.forceEntries?.forceEntry)) {
    intermediate.detachments.push(parseDetachment(fe, shared));
  }

  // Faction-wide rules (Oath of Moment, Reanimation Protocols, …) live as
  // top-level <rule> nodes.
  for (const r of asArray(cat.rules?.rule)) {
    intermediate.armyRules.push({
      bsdataId: attr(r, 'id'),
      name: attr(r, 'name'),
      text: stringifyDescription(r.description),
    });
  }

  // Top-level categoryLinks — these define which faction keywords every
  // unit in this catalogue inherits.
  for (const c of asArray(cat.categoryEntries?.categoryEntry)) {
    if (attr(c, 'name')) {
      intermediate.factionKeywords.push(attr(c, 'name'));
    }
  }

  return intermediate;
}

/* ─────────────────── selectionEntry classification ─────────────────── */
//
// A selectionEntry can be a unit, a detachment-rule, a stratagem, an
// enhancement, or a wargear-option group. The `type` attribute and
// category links discriminate.

function classifySelectionEntry(se, intermediate, shared) {
  const type = attr(se, 'type');
  const name = attr(se, 'name') || '';
  const cats = collectCategoryNames(se);

  if (type === 'unit' || type === 'model') {
    intermediate.units.push(parseUnit(se, shared));
    return;
  }
  // Detachment rule containers — modern 10e style. Their direct children
  // are stratagems and enhancements.
  if (cats.includes('Detachment') || /Detachment/i.test(name)) {
    intermediate.detachments.push(parseDetachmentSelection(se, shared));
    // Pull stratagems / enhancements declared inside this detachment.
    for (const child of asArray(se.selectionEntries?.selectionEntry)) {
      const childCats = collectCategoryNames(child);
      const childName = attr(child, 'name') || '';
      if (childCats.includes('Stratagem') || /Stratagem/i.test(type) || /Stratagem/i.test(childName)) {
        intermediate.stratagems.push(parseStratagem(child, attr(se, 'name'), shared));
      } else if (childCats.includes('Enhancement') || /Enhancement/i.test(childName)) {
        intermediate.enhancements.push(parseEnhancement(child, attr(se, 'name'), shared));
      }
    }
    return;
  }
  // Loose stratagems (older style — in 9e they were top-level).
  if (cats.includes('Stratagem')) {
    intermediate.stratagems.push(parseStratagem(se, null, shared));
    return;
  }
  if (cats.includes('Enhancement')) {
    intermediate.enhancements.push(parseEnhancement(se, null, shared));
    return;
  }
  // Anything else worth surfacing (loose abilities, etc.)
  if (type === 'upgrade' && se.profiles) {
    intermediate.abilities.push(...extractAbilities(se));
  }
}

function collectCategoryNames(se) {
  return asArray(se.categoryLinks?.categoryLink)
    .map(cl => attr(cl, 'name'))
    .filter(Boolean);
}

/* ─────────────────── unit ─────────────────── */

function parseUnit(se, shared) {
  const profiles = asArray(se.profiles?.profile).concat(
    // Resolve infoLinks pointing at sharedProfiles
    asArray(se.infoLinks?.infoLink)
      .map(il => shared.profiles.get(attr(il, 'targetId')))
      .filter(Boolean)
  );

  const stats = profiles
    .filter(p => attr(p, 'typeName') === 'Unit' || attr(p, 'typeName') === 'Model')
    .map(parseStatProfile);

  const weapons = profiles
    .filter(p => /Weapon/i.test(attr(p, 'typeName') || ''))
    .map(parseWeaponProfile);

  const abilities = profiles
    .filter(p => /Abilit/i.test(attr(p, 'typeName') || ''))
    .map(parseAbilityProfile);

  // BSData encodes points under <costs><cost name="pts" value="80"/></costs>
  const costs = asArray(se.costs?.cost)
    .filter(c => attr(c, 'name') === 'pts' || attr(c, 'name') === ' pts')
    .map(c => Number(attr(c, 'value')))
    .filter(Number.isFinite);

  const keywords = collectCategoryNames(se);

  // Wargear options live under selectionEntryGroups
  const wargearOptions = asArray(se.selectionEntryGroups?.selectionEntryGroup)
    .map((g, i) => ({
      index: i,
      text: attr(g, 'name') || '',
      // Each option entry within a group
      entries: asArray(g.selectionEntries?.selectionEntry).map(e => ({
        name: attr(e, 'name'),
        defaultAmount: Number(attr(e, 'defaultAmount') || '0') || 0,
      })),
    }));

  return {
    bsdataId: attr(se, 'id'),
    name: attr(se, 'name'),
    type: attr(se, 'type'),
    stats,
    weapons,
    abilities,
    costs,
    keywords,
    wargearOptions,
    composition: extractComposition(se),
  };
}

function parseStatProfile(p) {
  const cs = indexCharacteristics(p);
  return {
    name: attr(p, 'name'),
    typeName: attr(p, 'typeName'),
    m: cs.M, t: cs.T, sv: cs.SV, w: cs.W, ld: cs.LD, oc: cs.OC,
    invSv: cs['Inv'] || cs['Invuln'] || null,
  };
}

function parseWeaponProfile(p) {
  const cs = indexCharacteristics(p);
  const range = (cs.Range || '').trim();
  const kind = /melee/i.test(range) ? 'melee' : 'ranged';
  return {
    name: attr(p, 'name'),
    kind,
    range: range || (kind === 'melee' ? 'Melee' : ''),
    attacks: cs.A || '',
    bs: cs.BS || '',
    ws: cs.WS || '',
    strength: cs.S || '',
    ap: cs.AP || '',
    damage: cs.D || '',
    abilities: parseWeaponAbilities(cs.Keywords),
  };
}

function parseAbilityProfile(p) {
  const cs = indexCharacteristics(p);
  return {
    name: attr(p, 'name'),
    text: cs.Description || stringifyDescription(p.description),
  };
}

function indexCharacteristics(p) {
  const out = {};
  for (const c of asArray(p.characteristics?.characteristic)) {
    const k = attr(c, 'name');
    if (!k) continue;
    out[k] = (c['#text'] || '').trim();
  }
  return out;
}

/** "Assault, Devastating Wounds" → ['ASSAULT', 'DEVASTATING WOUNDS'] */
function parseWeaponAbilities(text) {
  if (!text) return [];
  return text.split(/[,;]/)
    .map(s => s.trim().toUpperCase())
    .filter(s => s && s !== '-');
}

function extractAbilities(se) {
  return asArray(se.profiles?.profile)
    .filter(p => /Abilit/i.test(attr(p, 'typeName') || ''))
    .map(parseAbilityProfile);
}

function extractComposition(se) {
  // BSData represents this loosely; the cleanest source is the constraint
  // nodes (min/max model count) plus a free-text description if present.
  const constraints = asArray(se.constraints?.constraint)
    .filter(c => attr(c, 'field') === 'selections' && attr(c, 'scope') === 'parent');
  let min, max;
  for (const c of constraints) {
    const v = Number(attr(c, 'value'));
    if (attr(c, 'type') === 'min') min = v;
    if (attr(c, 'type') === 'max') max = v;
  }
  return {
    text: attr(se, 'name') || '',
    minModels: Number.isFinite(min) ? min : null,
    maxModels: Number.isFinite(max) ? max : null,
  };
}

/* ─────────────────── detachment / stratagem / enhancement ─────────────────── */

function parseDetachment(fe, _shared) {
  return {
    bsdataId: attr(fe, 'id'),
    name: attr(fe, 'name'),
    description: stringifyDescription(fe.description),
    abilities: extractAbilities(fe),
  };
}

function parseDetachmentSelection(se, _shared) {
  return {
    bsdataId: attr(se, 'id'),
    name: attr(se, 'name'),
    description: stringifyDescription(se.description),
    abilities: extractAbilities(se),
  };
}

function parseStratagem(se, detachmentName, _shared) {
  const profiles = asArray(se.profiles?.profile);
  const cs = profiles[0] ? indexCharacteristics(profiles[0]) : {};
  const cpRaw = cs.CP || cs['CP Cost'] || '0';
  const cp = parseInt(String(cpRaw).replace(/[^0-9]/g, ''), 10) || 0;
  return {
    bsdataId: attr(se, 'id'),
    name: attr(se, 'name'),
    detachmentName: detachmentName || null,
    cpCost: cp,
    kind: classifyStratagem(cs.Type || ''),
    phase: cs['When'] || cs['Phase'] || '',
    target: cs.Target || '',
    effect: cs.Effect || stringifyDescription(se.description),
    restriction: cs.Restrictions || '',
  };
}

function classifyStratagem(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('battle tactic')) return 'battle-tactic';
  if (t.includes('wargear'))       return 'wargear';
  if (t.includes('epic'))          return 'epic-deed';
  if (t.includes('strategic ploy')) return 'strategic-ploy';
  if (t.includes('requisition'))   return 'requisition';
  return 'battle-tactic';
}

function parseEnhancement(se, detachmentName, _shared) {
  const profiles = asArray(se.profiles?.profile);
  const cs = profiles[0] ? indexCharacteristics(profiles[0]) : {};
  const costs = asArray(se.costs?.cost)
    .filter(c => attr(c, 'name') === 'pts' || attr(c, 'name') === ' pts')
    .map(c => Number(attr(c, 'value')))
    .filter(Number.isFinite);
  return {
    bsdataId: attr(se, 'id'),
    name: attr(se, 'name'),
    detachmentName: detachmentName || null,
    cost: costs[0] ?? 0,
    text: cs.Description || stringifyDescription(se.description),
    restriction: cs.Restrictions || '',
  };
}

/* ─────────────────── helpers ─────────────────── */

function stringifyDescription(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.trim();
  if (typeof d === 'object' && '#text' in d) return String(d['#text']).trim();
  return '';
}
