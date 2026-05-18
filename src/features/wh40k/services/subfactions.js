// src/features/wh40k/services/subfactions.js
//
// Curated faction → subfaction lookup for the WH40K browser. 10e doesn't
// model subfactions as their own dataset entities — instead a unit's
// chapter / clan / craftworld / sept / dynasty / cult shows up as a
// keyword (e.g. `Salamanders`, `Goffs`, `Sautekh`). This file maps the
// player-facing label to the keyword filter the UI should apply.
//
// Selection is mutually exclusive PER faction: picking "Salamanders"
// while "Ultramarines" is active swaps the latter out, the same way
// picking a Necron dynasty replaces the previous one. Non-subfaction
// keywords the user has selected manually (e.g. "Infantry") are left
// alone — only the keywords that belong to this faction's subfaction
// set are touched.
//
// What counts as a subfaction here is curated from the 10e Index +
// what actually appears in `units.json`. Some factions don't have
// subfaction-style keywords on individual datasheets (e.g. Adeptus
// Custodes' Shield Hosts are detachments only) — those factions simply
// get no picker. That's fine.

export const SUBFACTIONS_BY_FACTION = {
  // ─── Space Marines: Chapters ───────────────────────────────────
  'space-marines': [
    { id: 'ultramarines',   label: 'Ultramarines',    keyword: 'Ultramarines' },
    { id: 'salamanders',    label: 'Salamanders',     keyword: 'Salamanders' },
    { id: 'imperial-fists', label: 'Imperial Fists',  keyword: 'Imperial Fists' },
    { id: 'iron-hands',     label: 'Iron Hands',      keyword: 'Iron Hands' },
    { id: 'raven-guard',    label: 'Raven Guard',     keyword: 'Raven Guard' },
    { id: 'white-scars',    label: 'White Scars',     keyword: 'White Scars' },
    { id: 'blood-angels',   label: 'Blood Angels',    keyword: 'Blood Angels' },
    { id: 'dark-angels',    label: 'Dark Angels',     keyword: 'Dark Angels' },
    { id: 'black-templars', label: 'Black Templars',  keyword: 'Black Templars' },
    { id: 'space-wolves',   label: 'Space Wolves',    keyword: 'Space Wolves' },
    { id: 'deathwatch',     label: 'Deathwatch',      keyword: 'Deathwatch' },
  ],

  // ─── Aeldari: Craftworlds path vs. Ynnari / Harlequin overlap ──
  'aeldari': [
    { id: 'asuryani',   label: 'Asuryani (Craftworld)', keyword: 'Asuryani' },
    { id: 'ynnari',     label: 'Ynnari',                keyword: 'Ynnari' },
    { id: 'harlequins', label: 'Harlequins',            keyword: 'Harlequins' },
  ],

  // ─── Drukhari: Kabal / Coven / Cult ────────────────────────────
  'drukhari': [
    { id: 'kabal',             label: 'Kabal',             keyword: 'Kabal' },
    { id: 'wych-cult',         label: 'Wych Cult',         keyword: 'Wych Cult' },
    { id: 'haemonculus-covens',label: 'Haemonculus Covens',keyword: 'Haemonculus Covens' },
  ],

  // ─── Astra Militarum ───────────────────────────────────────────
  'astra-militarum': [
    { id: 'regiment',           label: 'Regiment',                 keyword: 'Regiment' },
    { id: 'militarum-tempestus',label: 'Militarum Tempestus',      keyword: 'Militarum Tempestus' },
    { id: 'cadian',             label: 'Cadian',                   keyword: 'Cadian' },
    { id: 'artillery',          label: 'Artillery',                keyword: 'Artillery' },
  ],

  // ─── Necrons: Dynasties + Cult ─────────────────────────────────
  'necrons': [
    { id: 'canoptek',       label: 'Canoptek',        keyword: 'Canoptek' },
    { id: 'destroyer-cult', label: 'Destroyer Cult',  keyword: 'Destroyer Cult' },
    { id: 'cryptek',        label: 'Cryptek',         keyword: 'Cryptek' },
    { id: 'triarch',        label: 'Triarch',         keyword: 'Triarch' },
    { id: 'noble',          label: 'Noble',           keyword: 'Noble' },
  ],

  // ─── Orks: Clans / styles ──────────────────────────────────────
  'orks': [
    { id: 'speed-freeks',  label: 'Speed Freeks',  keyword: 'Speed Freeks' },
    { id: 'beast-snagga',  label: 'Beast Snagga',  keyword: 'Beast Snagga' },
    { id: 'grots',         label: 'Grots',         keyword: 'Grots' },
    { id: 'mek',           label: 'Mek',           keyword: 'Mek' },
  ],

  // ─── T'au: Battlesuit-/Kroot-/Pathfinder-thematische Picks ─────
  'tau-empire': [
    { id: 'battlesuit',  label: 'Battlesuit',  keyword: 'Battlesuit' },
    { id: 'kroot',       label: 'Kroot',       keyword: 'Kroot' },
  ],

  // ─── Tyranids: Synapse / Vanguard / Harvester / Endless ────────
  'tyranids': [
    { id: 'synapse',           label: 'Synapse',           keyword: 'Synapse' },
    { id: 'vanguard-invader',  label: 'Vanguard Invader',  keyword: 'Vanguard Invader' },
    { id: 'harvester',         label: 'Harvester',         keyword: 'Harvester' },
    { id: 'endless-multitude', label: 'Endless Multitude', keyword: 'Endless Multitude' },
  ],

  // ─── Adeptus Mechanicus: Skitarii vs Cult Mechanicus ───────────
  'adeptus-mechanicus': [
    { id: 'skitarii',        label: 'Skitarii',        keyword: 'Skitarii' },
    { id: 'cult-mechanicus', label: 'Cult Mechanicus', keyword: 'Cult Mechanicus' },
    { id: 'tech-priest',     label: 'Tech-Priest',     keyword: 'Tech-Priest' },
  ],

  // ─── Adepta Sororitas: Penitent ────────────────────────────────
  'adepta-sororitas': [
    { id: 'penitent', label: 'Penitent', keyword: 'Penitent' },
  ],

  // ─── Adeptus Custodes ──────────────────────────────────────────
  'adeptus-custodes': [
    { id: 'anathema-psykana', label: 'Anathema Psykana (Sisters of Silence)', keyword: 'Anathema Psykana' },
  ],

  // ─── Imperial Agents ───────────────────────────────────────────
  'imperial-agents': [
    { id: 'inquisitor',        label: 'Inquisitorial',          keyword: 'Inquisitor' },
    { id: 'ordo-xenos',        label: 'Ordo Xenos',             keyword: 'Ordo Xenos' },
    { id: 'ordo-hereticus',    label: 'Ordo Hereticus',         keyword: 'Ordo Hereticus' },
    { id: 'ordo-malleus',      label: 'Ordo Malleus',           keyword: 'Ordo Malleus' },
    { id: 'officio-assassinorum', label: 'Officio Assassinorum',keyword: 'Officio Assassinorum' },
    { id: 'adeptus-arbites',   label: 'Adeptus Arbites',        keyword: 'Adeptus Arbites' },
    { id: 'deathwatch',        label: 'Deathwatch',             keyword: 'Deathwatch' },
  ],

  // ─── Imperial Knights ──────────────────────────────────────────
  'imperial-knights': [
    { id: 'questoris', label: 'Questoris',  keyword: 'Questoris' },
  ],

  // ─── Chaos Space Marines: Marks of Chaos ───────────────────────
  'chaos-space-marines': [
    { id: 'undivided', label: 'Undivided', keyword: 'Chaos Undivided' },
    { id: 'khorne',    label: 'Khorne',    keyword: 'Khorne' },
    { id: 'nurgle',    label: 'Nurgle',    keyword: 'Nurgle' },
    { id: 'tzeentch',  label: 'Tzeentch',  keyword: 'Tzeentch' },
    { id: 'slaanesh',  label: 'Slaanesh',  keyword: 'Slaanesh' },
  ],

  // ─── Chaos Daemons: Gods ───────────────────────────────────────
  'chaos-daemons': [
    { id: 'undivided', label: 'Undivided', keyword: 'Undivided' },
    { id: 'khorne',    label: 'Khorne',    keyword: 'Khorne' },
    { id: 'nurgle',    label: 'Nurgle',    keyword: 'Nurgle' },
    { id: 'tzeentch',  label: 'Tzeentch',  keyword: 'Tzeentch' },
    { id: 'slaanesh',  label: 'Slaanesh',  keyword: 'Slaanesh' },
  ],

  // ─── Chaos Knights ─────────────────────────────────────────────
  'chaos-knights': [
    { id: 'abhorrent', label: 'Abhorrent',     keyword: 'Abhorrent' },
    { id: 'war-dog',   label: 'War Dog',       keyword: 'War Dog' },
    { id: 'cerastus',  label: 'Cerastus',      keyword: 'Cerastus' },
  ],

  // ─── Death Guard: Plague Legions ───────────────────────────────
  'death-guard': [
    { id: 'plague-legions', label: 'Plague Legions', keyword: 'Plague Legions' },
  ],

  // ─── World Eaters: Blood Legions ───────────────────────────────
  'world-eaters': [
    { id: 'blood-legions', label: 'Blood Legions', keyword: 'Blood Legions' },
  ],

  // ─── Thousand Sons: Scintillating Legions ──────────────────────
  'thousand-sons': [
    { id: 'scintillating-legions', label: 'Scintillating Legions', keyword: 'Scintillating Legions' },
    { id: 'rubricae',              label: 'Rubricae',              keyword: 'Rubricae' },
  ],

  // ─── Emperor's Children ────────────────────────────────────────
  'emperors-children': [
    { id: 'legions-of-excess', label: 'Legions of Excess', keyword: 'Legions of Excess' },
  ],

  // ─── Genestealer Cults: Acolytes / Astra cover ─────────────────
  'genestealer-cults': [
    { id: 'vanguard-invader', label: 'Vanguard Invader', keyword: 'Vanguard Invader' },
    { id: 'acolyte-hybrids',  label: 'Acolyte Hybrids',  keyword: 'Acolyte Hybrids' },
    { id: 'regiment',         label: 'Astra-Tarnung',    keyword: 'Regiment' },
  ],

  // ─── Leagues of Votann ─────────────────────────────────────────
  'leagues-of-votann': [
    { id: 'hernkyn',   label: 'Hernkyn',    keyword: 'Hernkyn' },
    { id: 'cthonian',  label: 'Cthonian',   keyword: 'Cthonian' },
    { id: 'exoarmour', label: 'Exoarmour',  keyword: 'Exoarmour' },
  ],
};

/**
 * Return the curated subfaction list for a given faction id, or null if
 * this faction has no useful subfaction keywords in the dataset.
 */
export function getSubfactions(factionId) {
  return SUBFACTIONS_BY_FACTION[factionId] || null;
}

/**
 * Set of every keyword that any subfaction in this faction maps to.
 * Used by the picker to know which keywords to remove when the user
 * switches subfactions (so we don't blow away unrelated keywords the
 * user added manually).
 */
export function getSubfactionKeywords(factionId) {
  const list = SUBFACTIONS_BY_FACTION[factionId];
  if (!list) return new Set();
  return new Set(list.map(s => s.keyword));
}
