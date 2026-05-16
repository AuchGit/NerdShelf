// src/features/wh40k/combat/factionRules.js
//
// Curated faction army rules for 10e. Each entry surfaces at the right
// PHASE so the player doesn't forget the things that don't auto-trigger:
// declaring an Oath of Moment target, picking a Doctrina Imperative,
// calling Acts of Faith, etc.
//
// The dataset's `factions.json` only carries names — there's no machine-
// readable "army rule" field. Hence this curated mapping. The rule TEXT
// is intentionally short and action-oriented (companion tone). For the
// full word-for-word definition the player still goes to their codex;
// these prompts exist to make sure nothing gets forgotten mid-turn.
//
// Adding a new entry:
//   1. Look up the `factionId` in factions.json (kebab-case).
//   2. Pick a phase id from PHASE_IDS ('command' / 'movement' /
//      'shooting' / 'charge' / 'fight' / 'end' / '*' for always).
//   3. Add an object to `FACTION_RULES` with id, factionId, phase,
//      title, text. Optional fields: timing, tags, severity.

const T_REQUIRED = 'required';
const T_OPTIONAL = 'optional';
const T_REACTIVE = 'reactive';

export const TAG_LABELS = {
  [T_REQUIRED]: 'Pflicht',
  [T_OPTIONAL]: 'Optional',
  [T_REACTIVE]: 'Reaktiv',
};

const FACTION_RULES = [
  // ─── SPACE MARINES (incl. all Chapters via detachments) ─────────────
  {
    factionId: 'space-marines',
    id: 'fr-sm-oath',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Oath of Moment: Ziel wählen',
    text:
`Bestimme JETZT eine feindliche Einheit als Eid-Träger.
Bis zu deiner nächsten Command Phase haben alle deine ADEPTUS ASTARTES-Modelle:
• +1 to Hit gegen diese Einheit
• Re-roll Hit-Rolls von 1 (gilt für jede Battleline-Einheit immer auf das Ziel)

Vergiss nicht das Ziel zwischen den Runden zu wechseln, wenn die alte Einheit weg ist.`,
  },

  // ─── CHAOS SPACE MARINES ────────────────────────────────────────────
  {
    factionId: 'chaos-space-marines',
    id: 'fr-csm-pact-shoot',
    phase: 'shooting',
    timing: 'start',
    tags: [T_OPTIONAL],
    title: 'Dark Pact ansagen?',
    text:
`Bevor eine HERETIC ASTARTES-Einheit feuert, kannst du einen Dark Pact deklarieren. Effekt für diese Phase:
• Critical Hits (rohe 6er) gelten als SUSTAINED HITS oder LETHAL HITS — du wählst
• Pro Pact-Aktion macht die Einheit am Ende der Phase einen Battle-shock-Test`,
  },
  {
    factionId: 'chaos-space-marines',
    id: 'fr-csm-pact-fight',
    phase: 'fight',
    timing: 'start',
    tags: [T_OPTIONAL],
    title: 'Dark Pact ansagen?',
    text: `Gleiche Regel wie in der Shooting Phase — auch im Nahkampf kannst du Dark Pacts deklarieren (SUSTAINED HITS oder LETHAL HITS, Battle-shock-Test danach).`,
  },

  // ─── NECRONS ────────────────────────────────────────────────────────
  {
    factionId: 'necrons',
    id: 'fr-necrons-reanimation',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Reanimation Protocols',
    text:
`Pro NECRONS-Einheit auf dem Feld: wirf für die Anzahl an Wunden, die Reanimation Pool aufgebaut hat, je einen W6.

5+ pro Modell → ein zerstörtes Modell der Starting-Strength dieser Einheit kehrt zurück (kohärent platziert).
Reanimation Pool wird verbraucht; nicht-genutzte Wunden gehen verloren.`,
  },

  // ─── TYRANIDS ───────────────────────────────────────────────────────
  {
    factionId: 'tyranids',
    id: 'fr-tyr-synapse',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Synapse-Check',
    text:
`Jede TYRANIDS-Einheit innerhalb 6" einer SYNAPSE-Einheit:
• Auto-pass Battle-shock-Tests
• Ignoriert „cannot use stratagems"-Effekte von Battle-shock

Ohne Synapse-Bubble macht die Einheit normale Battle-shock-Tests.`,
  },
  {
    factionId: 'tyranids',
    id: 'fr-tyr-shadow',
    phase: '*',
    tags: [T_REACTIVE],
    title: 'Shadow in the Warp',
    text:
`Feindliche Einheiten innerhalb 12" deiner TYRANIDS Synapse-Einheit:
• −1 Ld für Battle-shock-Tests des Gegners

Immer aktiv — keine separate Aktion nötig, aber dem Gegner ansagen.`,
  },

  // ─── AELDARI ────────────────────────────────────────────────────────
  {
    factionId: 'aeldari',
    id: 'fr-aeldari-fate',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Strands of Fate würfeln',
    text:
`Jeden Command Phase: wirf 7 W6 und behalte sie als Fate Dice.

Du kannst einen Fate Die durch JEDES gewürfelte Hit/Wound/Save/Damage/Advance/Charge ersetzen — der eigene oder der des Gegners. Ein Würfel pro Roll, pro Phase max. einer pro Einheit.

Fate Dice verfallen Ende der Schlacht.`,
  },

  // ─── DRUKHARI ───────────────────────────────────────────────────────
  {
    factionId: 'drukhari',
    id: 'fr-drukhari-pfp',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Power From Pain stacken',
    text:
`Jedes Mal wenn eine feindliche Einheit zerstört wird ODER ein DRUKHARI-Modell zerstört wird, generiert sie/dein Pool einen Pain Token.

Pro Command Phase: gib einer DRUKHARI-Einheit einen Pain Token. Effekte gestaffelt:
• 1 Token: +1 Strength oder +1 Toughness (wähle aus)
• 2 Tokens: zusätzlich Re-roll Hit 1en
• 3 Tokens: zusätzlich Re-roll Wound 1en`,
  },

  // ─── ADEPTUS CUSTODES ───────────────────────────────────────────────
  {
    factionId: 'adeptus-custodes',
    id: 'fr-custodes-katah',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Martial Ka\'tah: Stance wählen',
    text:
`Jeden Command Phase: wähle EINE Stance für deine ADEPTUS CUSTODES-Armee:
• Dacatarai (Schießen) — Sustained Hits in Ranged
• Kaptaris (Bewegung) — +2" zu allen Bewegungen
• Rendax (Nahkampf) — Lethal Hits gegen Monster / Vehicles
• Shield-Host — Critical Saves geben FNP 6+

Die Stance gilt bis zur nächsten Command Phase.`,
  },

  // ─── ORKS ───────────────────────────────────────────────────────────
  {
    factionId: 'orks',
    id: 'fr-orks-waaagh',
    phase: 'command',
    timing: 'start',
    tags: [T_REACTIVE],
    title: 'WAAAGH! ausrufen?',
    text:
`Einmal pro Schlacht, in deiner Command Phase: rufe WAAAGH! aus.

Bis Ende deines Player-Turns:
• Alle ORKS-Modelle bekommen +1 Attacke
• +1 zu Advance- und Charge-Rolls (kumulativ)
• Sv 5+ (oder besser) für jede ORKS-Einheit nicht im Engagement

Tipp: typischerweise in Runde 2 oder 3, wenn du nah genug für Charges bist.`,
  },

  // ─── ASTRA MILITARUM ────────────────────────────────────────────────
  {
    factionId: 'astra-militarum',
    id: 'fr-am-orders',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Voice of Command: Orders erteilen',
    text:
`Pro Officer (mit der „Officer" Keyword): erteile 1–2 Orders an OFFICIO PREFECTUS / Astra Militarum-Infanterie in 12" Sichtlinie.

Häufige Orders:
• Take Aim! — +1 to Hit Ranged
• Fix Bayonets! — +1 to Hit Melee
• Move! Move! Move! — Advance + Pile In
• First Rank, Fire! — Sustained Hits 1

Eine Einheit kann pro Runde mehrere Orders empfangen.`,
  },

  // ─── ADEPTUS MECHANICUS ─────────────────────────────────────────────
  {
    factionId: 'adeptus-mechanicus',
    id: 'fr-ad-mech-doctrina',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Doctrina Imperatives wählen',
    text:
`Jede Command Phase: wähle EINE Doctrina für deine SKITARII / CULT MECHANICUS-Armee:
• Protector — +1 Hit Ranged & −1 Hit Melee in Engagement
• Conqueror — +1 Hit Melee & Lethal Hits Melee
• Tech-Adept — Re-roll Wound 1en mit Ranged

Die Doctrina gilt bis zur nächsten Command Phase.`,
  },

  // ─── ADEPTA SORORITAS ───────────────────────────────────────────────
  {
    factionId: 'adepta-sororitas',
    id: 'fr-sororitas-miracle',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Acts of Faith: Miracle Dice generieren',
    text:
`Jede Command Phase: erhalte 1 Miracle Die (wirf 1W6, das Ergebnis ist dein Würfel-Pool).
Zusätzlich: pro zerstörte feindliche Einheit +1 Miracle Die (max. 1/Phase aus Verlusten).

Miracle Dice ersetzen JEDES Würfel-Ergebnis (Hit, Wound, Save, Charge, etc.). Ein Würfel pro Roll. Verfällt Ende der Schlacht.`,
  },

  // ─── DEATH GUARD ────────────────────────────────────────────────────
  {
    factionId: 'death-guard',
    id: 'fr-dg-contagion',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Nurgle\'s Gift: Contagion-Range',
    text:
`Pro DEATH GUARD-Einheit: feindliche Einheiten innerhalb deiner Contagion-Range (Runde-abhängig) bekommen −1 Toughness.

Runden:
• Runde 1: 3" Contagion-Range
• Runde 2: 6"
• Runde 3+: 9"

Vergiss nicht den Token / Marker zu setzen.`,
  },

  // ─── THOUSAND SONS ──────────────────────────────────────────────────
  {
    factionId: 'thousand-sons',
    id: 'fr-tsons-cabal',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Cabal of Sorcerers: Punkte generieren',
    text:
`Jede Command Phase: generiere Cabal Points (CP-Pool), normalerweise +1 pro PSYKER-Einheit auf dem Feld + 1 für deine erste Phase.

Cabal Points werden ausgegeben für Witchfires, Manifestations und Psychic Stratagems. Max 9 gesammelt.`,
  },

  // ─── WORLD EATERS ───────────────────────────────────────────────────
  {
    factionId: 'world-eaters',
    id: 'fr-we-blessings',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Blessings of Khorne: Stance wählen',
    text:
`Jede Command Phase: wähle eine Blessing der KHORNE-Götter für deine Armee:
• No Mercy — +1 Attacks Melee
• No Respite — Advance + Charge möglich
• No Witness — Re-roll Charge

Die Blessing gilt bis zur nächsten Command Phase. Stacken mit Blood Tithe.`,
  },
  {
    factionId: 'world-eaters',
    id: 'fr-we-blood-tithe',
    phase: '*',
    tags: [T_REACTIVE],
    title: 'Blood Tithe sammeln',
    text:
`Bei jedem zerstörten Modell (eigen oder gegnerisch) generiert deine Armee 1 Blood Tithe Point. Sammle bis zu 10 Pkt.

Ausgaben (Auswahl):
• 1 Pt: Cull the Weak (+1 Attack 1 Einheit)
• 3 Pt: Brazen Onslaught (eine Einheit fightet 2× diese Phase)
• 6 Pt: Apocalyptic Frenzy (Aura: +1 A für alle nahen Einheiten)`,
  },

  // ─── TAU EMPIRE ─────────────────────────────────────────────────────
  {
    factionId: 'tau-empire',
    id: 'fr-tau-greater-good',
    phase: 'shooting',
    timing: 'start',
    tags: [T_OPTIONAL],
    title: 'For the Greater Good: Guided-Marker',
    text:
`Ab Shooting Phase: eine T\'AU EMPIRE-Einheit kann GUIDED markieren — wähle ein feindliches Ziel.

Effekt für deine SHOOTING Phase:
• Alle T\'au-Einheiten, die JETZT auf das gleiche Ziel schießen, bekommen +1 to Hit (Battlesuits: zusätzlich Hit-Roll re-rolls von 1).

Markierung verfällt am Ende deiner Schießphase.`,
  },

  // ─── GREY KNIGHTS ───────────────────────────────────────────────────
  {
    factionId: 'grey-knights',
    id: 'fr-gk-psychic',
    phase: 'shooting',
    timing: 'start',
    tags: [T_OPTIONAL],
    title: 'Brotherhood Psykers',
    text:
`Alle GREY KNIGHTS-Einheiten sind Psyker (mit PSYKER-Keyword). Sie können PSYCHIC-Stratagems triggern.

Außerdem: alle ihre Waffen haben [PSYCHIC] — Sustained Hits 1 plus Critical Wounds geben Anti-DAEMON 4+.`,
  },

  // ─── IMPERIAL KNIGHTS ───────────────────────────────────────────────
  {
    factionId: 'imperial-knights',
    id: 'fr-ik-chivalry',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Code of Chivalry',
    text:
`Jede Command Phase: prüfe Honour Tier für jede IMPERIAL KNIGHTS-Einheit basierend auf erfüllten Vows.

Per-Vow Effekte stacken — z.B. erfüllt „Ride to Glory" gibt +1 to Hit gegen Gegner mit höherem Wound-Wert.

Vergiss nicht: Knights triggern Last Stand bei < 50% Wunden — Code Imperatives erhalten.`,
  },

  // ─── CHAOS KNIGHTS ──────────────────────────────────────────────────
  {
    factionId: 'chaos-knights',
    id: 'fr-ck-pact',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Pacts of the Damned: Trait wählen',
    text:
`Jede Command Phase: wähle eine Dark Pact für jede CHAOS KNIGHTS-Einheit. Beispiele:
• Iconoclast — +1 to Hit Ranged
• Tyrant — Re-roll Wound 1en
• Infernal — Lethal Hits

Pact gilt bis zur nächsten Command Phase.`,
  },

  // ─── GENESTEALER CULTS ──────────────────────────────────────────────
  {
    factionId: 'genestealer-cults',
    id: 'fr-cult-ambush',
    phase: 'movement',
    timing: 'start',
    tags: [T_OPTIONAL],
    title: 'Cult Ambush: Aufdecken',
    text:
`In Strategic Reserves befindliche GENESTEALER CULTS-Einheiten können in deiner Movement Phase:
• Underground arrive — >9" von jedem feindlichen Modell
• Tunnels nutzen — mehrere Optionen je Detachment

Bonus: nach dem Aufdecken können Cult-Units sofort schießen / chargen (außer normalerweise verhindert).`,
  },

  // ─── LEAGUES OF VOTANN ──────────────────────────────────────────────
  {
    factionId: 'leagues-of-votann',
    id: 'fr-votann-judgement',
    phase: '*',
    tags: [T_REACTIVE],
    title: 'Eye of the Ancestors: Judgement Tokens',
    text:
`Pro zerstörte LEAGUES-Einheit ODER pro 2 verlorene Modelle: eine feindliche Einheit deiner Wahl bekommt einen Judgement Token.

Effekte gegen markierte Einheiten:
• 1 Token: +1 to Wound
• 2 Tokens: zusätzlich Re-roll Hit-Rolls von 1
• 3 Tokens: zusätzlich Critical Wounds bei rohen 5+

Tokens bleiben für die ganze Schlacht.`,
  },

  // ─── CHAOS DAEMONS ──────────────────────────────────────────────────
  {
    factionId: 'chaos-daemons',
    id: 'fr-daemons-shadow',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Shadow of Chaos: Zonen festlegen',
    text:
`Eine Battlefield-Zone ist Shadow of Chaos solange du mindestens einen DAEMON in 6" hast.

Effekte für deine DAEMONS in einer Shadow-Zone:
• Re-roll Hit 1en
• Re-roll Charge-Wurf

Effekte für feindliche Einheiten in einer Shadow-Zone:
• −1 Ld für Battle-shock`,
  },

  // ─── EMPEROR\'S CHILDREN ────────────────────────────────────────────
  {
    factionId: 'emperors-children',
    id: 'fr-emperors-children-doom',
    phase: 'command',
    timing: 'start',
    tags: [T_REQUIRED],
    title: 'Doom of Decadence: Mode wählen',
    text:
`Jede Command Phase: wähle einen Slaaneshi-Mood für deine Armee. Optionen variieren je Detachment, klassisch:
• Sublime — +1 to Hit Melee
• Profligate — Fights First
• Exquisite — −1 to Hit von Feinden

Mode gilt bis zur nächsten Command Phase.`,
  },
];

/* ─────────────────── public API ─────────────────── */

/**
 * All faction rules for the given faction id and phase. Returns
 * universally-applicable rules (phase === '*') AND phase-specific ones.
 */
export function getFactionPhaseRules(factionId, phaseId) {
  if (!factionId) return [];
  return FACTION_RULES.filter(r =>
    r.factionId === factionId
    && (r.phase === '*' || r.phase === phaseId)
  );
}

/** True iff the dataset has any curated rules for this faction. The UI
 *  uses this to decide whether to show a section header even when the
 *  current phase has no matching rules — preserves consistency between
 *  phase switches. */
export function hasFactionRules(factionId) {
  if (!factionId) return false;
  return FACTION_RULES.some(r => r.factionId === factionId);
}
