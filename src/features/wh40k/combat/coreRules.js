// src/features/wh40k/combat/coreRules.js
//
// Comprehensive per-phase reference of the 10e Core Rules. These are the
// same for every army — the rulebook procedures the player needs to walk
// through during their turn — so they live in code as a curated dataset.
// Faction-, detachment- and unit-specific rules continue to flow from
// the JSON dataset (units.json, detachments.json, stratagems.json, …) via
// phaseContext, so this file does NOT replicate anything army-specific.
//
// Each entry:
//   id      — stable string used by the UI for keying + collapse state
//   title   — short, one-line label
//   text    — multi-paragraph guidance, copy-friendly across the table
//   timing  — optional 'start' | 'end' bias for sort ordering
//   tags    — chips shown alongside the title (Pflicht/Optional/etc.)

const T_REQUIRED = 'required';
const T_OPTIONAL = 'optional';
const T_REACTIVE = 'reactive';

const TAG_LABEL = {
  [T_REQUIRED]: 'Pflicht',
  [T_OPTIONAL]: 'Optional',
  [T_REACTIVE]: 'Reaktiv',
};

export const TAG_LABELS = TAG_LABEL;

export const CORE_PHASE_RULES = {
  command: [
    {
      id: 'core-cmd-cp',
      title: 'Kommandopunkt erhalten',
      timing: 'start',
      tags: [T_REQUIRED],
      text:
`Erhalte 1 CP zu Beginn deiner Command Phase (max. 15 CP gespeichert).
Ausnahme: Der Spieler, der die erste Player-Turn der Schlacht hat, erhält in seiner ersten Command Phase KEINEN CP.`,
    },
    {
      id: 'core-cmd-battle-shock',
      title: 'Battle-shock-Tests',
      timing: 'start',
      tags: [T_REQUIRED],
      text:
`Für jede Einheit, die diese Bedingungen erfüllt, machst du einen Battle-shock-Test:
• Sie ist unter halber Starting Strength
• Sie hat einen Battle-shock-Token von der vorigen Runde

Test: 2W6, scheitert wenn das Ergebnis < Ld-Wert eines Modells (höchstes Ld der Einheit zählt).
Folgen bei Battle-shock:
• OC = 0 bis Ende der nächsten Command Phase
• Einheit kann keine Stratagems verwenden
• Auto-fail Morale-Tests
Erhalte einen Battle-shock-Token.`,
    },
    {
      id: 'core-cmd-start-effects',
      title: 'Start-of-turn-Effekte',
      timing: 'start',
      tags: [T_REQUIRED],
      text:
`Löse alle Abilities, Stratagems und Detachment-Regeln auf, die "at the start of your Command phase" oder "at the start of your turn" sagen. Nutze die untenstehende Ability-Liste für die deiner Armee.`,
    },
    {
      id: 'core-cmd-objectives',
      title: 'Objective Control prüfen',
      tags: [T_REACTIVE],
      text:
`Eine Einheit hält ein Objective, wenn die Summe ihrer OC-Werte größer als die der feindlichen Einheiten in 3" davon ist. Sticky Objectives bleiben "deins" auch wenn niemand mehr in Reichweite ist, bis ein Gegner es kontrolliert.`,
    },
  ],

  movement: [
    {
      id: 'core-mov-normal',
      title: 'Normaler Bewegungsweg',
      tags: [T_OPTIONAL],
      text:
`Jede Einheit darf bis zu ihrem M-Wert (in Zoll) bewegen.
• Models dürfen nicht über andere Models hinwegfliegen (außer FLY).
• Models dürfen nicht über/durch Einheiten in Engagement Range, die nicht ihre eigene Einheit sind.
• Modelle einer Einheit müssen am Ende der Bewegung in 2" zueinander (kohärent) sein.`,
    },
    {
      id: 'core-mov-advance',
      title: 'Vorrücken (Advance)',
      tags: [T_OPTIONAL],
      text:
`Wirf einen W6 (manche Regeln modifizieren diesen Wurf) und addiere das Ergebnis zur Bewegung.
• Diese Einheit kann diese Phase nicht schießen und nicht chargen.
• AUSNAHME: Assault-Waffen dürfen geschossen werden, Assault-Einheiten dürfen chargen.
Vergib der Einheit den Tag "advanced" im Tracker.`,
    },
    {
      id: 'core-mov-fall-back',
      title: 'Zurückziehen (Fall Back)',
      tags: [T_OPTIONAL],
      text:
`Aus Engagement Range einer feindlichen Einheit raus bewegen.
• Diese Einheit kann diese Phase nicht schießen, nicht chargen.
• Sie macht einen Desperate-Escape-Test: pro Modell 1W6 — bei 1en (oder 1-2en bei Battle-shock) wird ein Modell zerstört.
Vergib den Tag "fellback".`,
    },
    {
      id: 'core-mov-remain',
      title: 'Stehenbleiben',
      tags: [T_OPTIONAL],
      text:
`Die Einheit bewegt sich nicht. Sie zählt als "Stationary" — relevant für Heavy-Waffen (volles BS), Crusader, Battleline-Buffs etc.`,
    },
    {
      id: 'core-mov-reinforcements',
      title: 'Reinforcements einsetzen',
      tags: [T_OPTIONAL],
      text:
`Einheiten in Strategic Reserves oder mit Deep-Strike-Ability dürfen kommen.
• Frühestens in deiner ZWEITEN Movement Phase.
• Spätestens am Ende der Battle Round 3 — sonst gilt sie als zerstört.
• Deep Strike: Set up >9" von feindlichen Einheiten.`,
    },
    {
      id: 'core-mov-disembark',
      title: 'Aussteigen / Einsteigen',
      tags: [T_OPTIONAL],
      text:
`Aussteigen: am Anfang der Movement Phase, alle Modelle in 3" um den Transporter platzieren, danach normal bewegen (max. M-Wert). Wenn der Transporter zerstört wurde: 9" Test je Modell, sonst tot.
Einsteigen: Modelle in 3" zum Transporter (am Ende der Bewegung).`,
    },
  ],

  shooting: [
    {
      id: 'core-shoot-select',
      title: 'Schieß-fähige Einheiten',
      timing: 'start',
      tags: [T_REQUIRED],
      text:
`Eine Einheit darf schießen, wenn sie:
• NICHT in Engagement Range einer feindlichen Einheit ist (Ausnahme: Pistolen oder BIG GUNS NEVER TIRE-Einheiten = Monster/Vehicles).
• Diese Phase nicht "Fallen Back" ist (außer Ability sagt was anderes).
• Diese Phase nicht "Advanced" ist — AUSSER mit Assault-Waffe.`,
    },
    {
      id: 'core-shoot-target',
      title: 'Zielwahl',
      tags: [T_REQUIRED],
      text:
`Wähle die Ziel(e) BEVOR du würfelst.
• Mindestens ein Modell der Einheit muss Sichtlinie auf das Ziel haben (Indirect Fire ausgenommen).
• Mindestens eine Waffe muss in Reichweite sein.
• Wenn das Ziel ein Character ist und es andere Einheiten näher gibt: nicht erlaubt (Look Out, Sir!), AUSSER der Character ist Monster/Vehicle ODER eine Battleline-Einheit ist näher.`,
    },
    {
      id: 'core-shoot-sequence',
      title: 'Angriffssequenz',
      tags: [T_REQUIRED],
      text:
`Pro Waffen-Gruppe:
1. Anzahl Attacken bestimmen (A-Wert × Modelle mit der Waffe, ggf. modifiziert).
2. Hit-Rolls (BS-Wert, modifizierte W6, max ±1 Modifier).
3. Wound-Rolls: S vs T (S≥2×T = 2+; S>T = 3+; S=T = 4+; S<T = 5+; 2×S≤T = 6+).
4. Saves: Gegner zieht beste Sv ab. Sv minus AP. Cover = +1 Sv (cap 3+ bei Infantry). Invuln-Save ignoriert AP, immer roh.
5. Damage je verlorener Save: D-Wert pro Wunde. Schaden geht an EIN Modell, bis zerstört, dann zum nächsten. Excess-Damage verfällt (außer Devastating Wounds → Critical Hits = mortal wounds).`,
    },
    {
      id: 'core-shoot-pistol',
      title: 'Pistolen-Ausnahme',
      tags: [T_OPTIONAL],
      text:
`Pistolen können in Engagement Range geschossen werden, AUSSER auf andere Einheiten in dieser selben Range. Wenn eine Einheit eine Pistole schießt, kann sie diese Phase keine andere Waffen-Gruppe abfeuern.`,
    },
    {
      id: 'core-shoot-indirect',
      title: 'Indirect Fire',
      tags: [T_OPTIONAL],
      text:
`Waffen mit [INDIRECT FIRE]: dürfen auf Ziele ohne Sichtlinie schießen.
• -1 to hit auf solche Ziele.
• Wenn Ziel keine Sichtlinie hat: +1 Sv (Benefit of Cover).
• Modifier-Cap: max -1 cumulative.`,
    },
    {
      id: 'core-shoot-bgnt',
      title: 'Big Guns Never Tire',
      tags: [T_OPTIONAL],
      text:
`Monster / Vehicles dürfen in Engagement Range einer feindlichen Einheit schießen, aber:
• -1 to hit auf alle Ranged-Attacken
• Sie dürfen nur auf Einheiten in Engagement Range zu ihnen schießen.`,
    },
  ],

  charge: [
    {
      id: 'core-chg-eligibility',
      title: 'Charge-Erlaubnis',
      timing: 'start',
      tags: [T_REQUIRED],
      text:
`Wählbar sind Einheiten, die in dieser Runde NICHT "Advanced" oder "Fallen Back" sind, NICHT bereits in Engagement Range sind, und die innerhalb 12" mindestens eines Ziels sind. AUSNAHME: Assault-Einheiten (die nach Advance chargen dürfen).`,
    },
    {
      id: 'core-chg-declare',
      title: 'Charge erklären',
      tags: [T_REQUIRED],
      text:
`Wähle bis zu drei feindliche Einheiten als Ziel(e). Alle Ziele müssen innerhalb 12" der chargenden Einheit sein. Wenn mehrere Ziele: am Ende muss MINDESTENS EIN Modell der chargenden Einheit Engagement Range zu JEDEM erklärten Ziel haben.`,
    },
    {
      id: 'core-chg-overwatch',
      title: 'Overwatch (Stratagem, 1 CP)',
      tags: [T_REACTIVE],
      text:
`Der Verteidiger darf das Overwatch-Stratagem (1 CP) verwenden:
• Eine seiner Einheiten in 24" Sichtlinie schießt auf die chargende Einheit.
• Trifft NUR bei rohen 6en (BS effektiv 6+).
• Pistolen dürfen auch nicht-Engagement-Range Ziele anvisieren.`,
    },
    {
      id: 'core-chg-roll',
      title: 'Charge-Wurf',
      tags: [T_REQUIRED],
      text:
`Wirf 2W6.
• Ergebnis = maximale Bewegung in Zoll.
• Charge gelingt, wenn die Einheit so positioniert werden kann, dass mindestens ein Modell in Engagement Range (≤1") jedes erklärten Ziels endet.
• Charge schlägt fehl → keine Bewegung.`,
    },
    {
      id: 'core-chg-move',
      title: 'Charge-Bewegung',
      tags: [T_REQUIRED],
      text:
`Bewege jedes Modell der chargenden Einheit (kein Modell darf den Charge-Wurf in Zoll überschreiten).
• Erstes Modell muss in Engagement Range eines Ziels enden.
• Folge-Modelle: in Engagement Range ODER in Kohärenz mit der Einheit.
• Modelle dürfen über Walls/Ruinen, aber keine vertikalen Wände durchqueren (außer FLY).`,
    },
    {
      id: 'core-chg-heroic',
      title: 'Heroic Intervention',
      tags: [T_REACTIVE],
      text:
`Nachdem alle Charges aufgelöst sind: jedes deiner CHARACTER-Modelle innerhalb 6" einer feindlichen Einheit, die diese Phase NICHT gechargt hat, darf eine Heroic Intervention machen — bis zu 3" Bewegung, muss in Engagement Range einer feindlichen Einheit enden.`,
    },
  ],

  fight: [
    {
      id: 'core-fight-order',
      title: 'Fights-First-Reihenfolge',
      timing: 'start',
      tags: [T_REQUIRED],
      text:
`Reihenfolge:
1. ZUERST alle Einheiten mit [FIGHTS FIRST] (chargende Einheiten haben das automatisch). Aktiver Spieler entscheidet bei Gleichstand zuerst.
2. DANN alternierend: aktiver Spieler kämpft eine Einheit, dann Gegner, dann aktiver, …
3. ZULETZT [FIGHTS LAST]-Einheiten (selten).`,
    },
    {
      id: 'core-fight-pile-in',
      title: 'Pile In',
      tags: [T_REQUIRED],
      text:
`Vor den Attacken: bewege bis zu drei Modelle der Einheit jeweils bis zu 3", um näher zum nächstgelegenen feindlichen Modell in Engagement Range zu kommen. Mehr Modelle in Engagement Range bringen = mehr potentielle Attacken.`,
    },
    {
      id: 'core-fight-attacks',
      title: 'Attacken durchführen',
      tags: [T_REQUIRED],
      text:
`Wähle Waffe(n), dann je Waffen-Gruppe:
1. Anzahl Attacken (A × Modelle in Engagement Range mit der Waffe)
2. Hit-Rolls (WS-Wert)
3. Wound, Save, Damage genau wie in der Shooting Phase
4. Allocate-Regel: Schaden zuerst an ein Modell, das bereits Wunden hat`,
    },
    {
      id: 'core-fight-vehicles',
      title: 'Vehicles im Nahkampf',
      tags: [T_OPTIONAL],
      text:
`Vehicles (außer Walker) haben -1 to hit auf Melee-Attacken. Walker bekommen den Malus nicht.`,
    },
    {
      id: 'core-fight-consolidate',
      title: 'Consolidate',
      tags: [T_REQUIRED],
      text:
`Nach allen Attacken: bewege bis zu drei Modelle jeweils bis zu 3" — jedes muss näher zum nächsten feindlichen Modell enden ODER Engagement Range ergreifen/halten ODER näher zu einem Objective Marker den die Einheit kontrolliert.`,
    },
  ],

  end: [
    {
      id: 'core-end-score-primary',
      title: 'Primary Mission werten',
      timing: 'end',
      tags: [T_REQUIRED],
      text:
`Werte die Primary-Mission nach den Mission-Regeln.
• Typische Primary-Werte: 5 / 10 / 15 VP pro gehaltenes/dominiertes Objective (max. 50 VP gesamt).
• In Battle Round 1 wird KEINE Primary gewertet — der erste Spieler.`,
    },
    {
      id: 'core-end-score-secondary',
      title: 'Secondary Missions werten',
      timing: 'end',
      tags: [T_REQUIRED],
      text:
`Werte die ausgewählten Secondary-Karten / Tactical Objectives.
• Max. 50 VP gesamt aus Secondaries pro Schlacht (8 VP pro Karte typisch).
• Fixed: vorgewählte Secondaries für die Schlacht.
• Tactical: 2 Karten ziehen je Command Phase, max. 1 fertig pro Phase werten.`,
    },
    {
      id: 'core-end-effects',
      title: 'End-of-turn-Effekte',
      timing: 'end',
      tags: [T_REQUIRED],
      text:
`Löse alle Abilities und Stratagems auf, die "at the end of your turn" oder "at the end of the battle round" sagen.
• Reset once-per-turn-Stratagems.
• Marker entfernen, die mit "at the end of the turn" auslaufen.`,
    },
    {
      id: 'core-end-cleanup',
      title: 'Bookkeeping',
      timing: 'end',
      tags: [T_OPTIONAL],
      text:
`Battle-shock-Token bleiben bis zur nächsten Command Phase aktiv.
Erinnere dich: aufgespart unerledigte CP-Refunds, Aura-Buffs zurücksetzen.
Falls Battle Round 5 abgeschlossen UND keine Sudden Death: das Spiel endet jetzt — finale VPs ermitteln.`,
    },
  ],
};

/** All entries for the given phase id, in canonical display order
 *  (start → middle → end). */
export function getCorePhaseRules(phaseId) {
  return CORE_PHASE_RULES[phaseId] || [];
}
