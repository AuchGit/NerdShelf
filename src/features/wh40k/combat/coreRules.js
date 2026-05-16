// src/features/wh40k/combat/coreRules.js
//
// Per-phase reference of the 10e Core Rules — written for a player who's
// holding their phone at the table mid-game, not for someone reading the
// rulebook on the couch. So:
//
//   • Companion tone — short, conversational, second person. Tells the
//     player WHAT to do next, then how. No encyclopedic detail.
//   • Action-oriented titles ("Charge-Sequenz", "Wer kann chargen?",
//     "Overwatch reagiert") rather than rulebook headings.
//   • Steps are numbered or bulleted so the player can glance and pick
//     up where they paused.
//
// Faction-, detachment- and unit-specific rules continue to come from
// the JSON dataset via phaseContext + UnitPhaseCard; this file does NOT
// duplicate anything army-specific.

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
      title: '+1 CP einsammeln',
      timing: 'start',
      tags: [T_REQUIRED],
      text:
`Du bekommst 1 CP — max. 15 gespeichert.

Ausnahme: im ALLERERSTEN Player-Turn der Schlacht bekommt der erste Spieler keinen CP.`,
    },
    {
      id: 'core-cmd-battle-shock',
      title: 'Battle-shock-Tests durchführen',
      timing: 'start',
      tags: [T_REQUIRED],
      text:
`Für jede Einheit, die …
• unter halber Starting Strength steht, ODER
• einen Battle-shock-Token hat
… einen Test machen: 2W6 + Ld. Schafft den Threshold der Einheit? Sonst Battle-shock.

Battle-shocked:
• OC = 0 bis Ende deiner nächsten Command Phase
• Keine Stratagems verwendbar
• Token nehmen`,
    },
    {
      id: 'core-cmd-start-effects',
      title: '„Start of your turn"-Effekte',
      timing: 'start',
      tags: [T_REQUIRED],
      text:
`Schau in den Unit-Karten — jede Fähigkeit, die mit „at the start of your Command phase" oder „at the start of your turn" markiert ist, wird jetzt aufgelöst.

Auch Detachment-Regeln + Stratagems mit Command-Phase-Timing.`,
    },
    {
      id: 'core-cmd-objectives',
      title: 'Objective-Kontrolle prüfen',
      tags: [T_OPTIONAL],
      text:
`Eine Einheit hält ein Objective, wenn ihre OC-Summe größer ist als die der gegnerischen Einheiten in 3" darum herum.

Sticky Objectives bleiben deins, bis ein Gegner es kontrolliert — auch wenn niemand mehr in Reichweite steht.`,
    },
  ],

  movement: [
    {
      id: 'core-mov-flow',
      title: 'Bewegungs-Optionen',
      timing: 'start',
      tags: [T_OPTIONAL],
      text:
`Pro Einheit eine der vier Optionen wählen:

1. Normale Bewegung — bis zu M Zoll
2. Advance — +W6 Zoll, aber kein Schießen / Charge diese Runde (außer Assault-Waffen / -Einheiten)
3. Fall Back — aus Engagement raus, Desperate-Escape-Test
4. Stehenbleiben — zählt als „Stationary" (relevant für Heavy-Waffen)

Am Ende: 2" Kohärenz wahren.`,
    },
    {
      id: 'core-mov-advance',
      title: 'Advance würfeln',
      tags: [T_OPTIONAL],
      text:
`Wirf 1W6 und addiere das Ergebnis zu deiner Bewegung.

Konsequenz: diese Einheit darf diese Runde
• NICHT schießen (außer mit [ASSAULT] Waffen)
• NICHT chargen (außer ASSAULT-Einheiten)`,
    },
    {
      id: 'core-mov-fall-back',
      title: 'Fall Back (aus Engagement)',
      tags: [T_OPTIONAL],
      text:
`Engagement Range verlassen. Diese Einheit:
• kann NICHT schießen
• kann NICHT chargen
• macht Desperate-Escape-Test: pro Modell 1W6 — bei 1en (bei Battle-shock: 1-2en) wird ein Modell zerstört.`,
    },
    {
      id: 'core-mov-reinforcements',
      title: 'Reinforcements einsetzen',
      tags: [T_OPTIONAL],
      text:
`Strategic Reserves & Deep Strike kommen JETZT.

• Frühestens deine ZWEITE Movement Phase
• Spätestens Ende Battle Round 3 — sonst zerstört
• Deep Strike: setze die Einheit > 9" von feindlichen Modellen entfernt ab`,
    },
    {
      id: 'core-mov-transports',
      title: 'Aus- / Einsteigen',
      tags: [T_OPTIONAL],
      text:
`Aussteigen am Anfang der Bewegung: Modelle in 3" um den Transporter platzieren, danach normal bewegen (M-Wert).

Einsteigen am Ende der Bewegung: Modelle in 3" zum Transporter, der nicht 'advanced' ist.`,
    },
  ],

  shooting: [
    {
      id: 'core-shoot-flow',
      title: 'Schießphase-Ablauf',
      timing: 'start',
      tags: [T_REQUIRED],
      text:
`Pro Einheit (eine nach der anderen):

1. Ziel(e) wählen — Sichtlinie + Reichweite nötig
2. Pro Waffen-Gruppe: Hit, Wound, Save, Damage abwickeln
3. Gegner zieht Modelle weg

Schau in der Unit-Card — dort siehst du nur die Fernkampf-Waffen, die JETZT geschossen werden.`,
    },
    {
      id: 'core-shoot-eligibility',
      title: 'Wer darf schießen?',
      tags: [T_OPTIONAL],
      text:
`Eine Einheit darf schießen wenn sie …
• NICHT in Engagement steht (Ausnahme: Pistolen, BIG GUNS NEVER TIRE)
• Diese Runde NICHT „Fallen Back" ist (außer Sonderregel)
• Diese Runde NICHT „Advanced" ist (außer [ASSAULT]-Waffen)`,
    },
    {
      id: 'core-shoot-target',
      title: 'Zielwahl-Regeln',
      tags: [T_REQUIRED],
      text:
`Vor dem Würfeln festlegen:
• Mindestens ein Modell muss Sichtlinie haben (außer [INDIRECT FIRE])
• Mindestens eine Waffe in Reichweite
• Character als Ziel: nur wenn KEINE nähere Einheit existiert (Look Out, Sir)
  Ausnahmen: Monster/Vehicle-Character, oder Battleline-Einheit näher`,
    },
    {
      id: 'core-shoot-sequence',
      title: 'Würfel-Sequenz',
      tags: [T_REQUIRED],
      text:
`Pro Waffe:
1. Anzahl Attacken (A × Modelle mit der Waffe)
2. Hit-Roll: BS, max ±1 Modifier
3. Wound-Roll: S vs T
   2× T = 2+ · > T = 3+ · = T = 4+ · < T = 5+ · ≤ ½T = 6+
4. Saves: Sv − AP, oder Invul (ignoriert AP)
5. Damage: D pro durchgelassene Wunde, Excess verfällt`,
    },
    {
      id: 'core-shoot-special',
      title: 'Spezialfälle',
      tags: [T_OPTIONAL],
      text:
`• Pistolen: in Engagement erlaubt, aber nur Pistolen diese Phase
• Big Guns Never Tire: Monster/Vehicles dürfen in Engagement schießen, −1 to hit
• Indirect Fire: ohne Sichtlinie möglich, −1 to hit, Ziel bekommt Benefit of Cover`,
    },
  ],

  charge: [
    {
      id: 'core-chg-flow',
      title: 'Charge-Sequenz',
      timing: 'start',
      tags: [T_REQUIRED],
      text:
`So läuft jeder Charge ab:

1. Einheit wählen (in 12" eines Ziels, nicht advanced/fellback, noch nicht in Engagement)
2. Bis zu 3 Ziele erklären — alle in 12"
3. Gegner darf Overwatch ansagen (1 CP)
4. 2W6 würfeln — Ergebnis = max. Bewegung
5. Bewegen — Engagement Range (≤1") zu ALLEN Zielen erreichen, sonst Charge schlägt fehl

Nach allen Charges: Heroic Intervention für deine CHARACTER.`,
    },
    {
      id: 'core-chg-eligibility',
      title: 'Wer kann chargen?',
      tags: [T_OPTIONAL],
      text:
`Charge-fähig sind Einheiten die …
• in 12" eines feindlichen Modells sind
• diese Runde NICHT „advanced" sind (außer [ASSAULT]-Einheiten)
• NICHT „Fallen Back" sind
• NICHT bereits in Engagement Range stehen`,
    },
    {
      id: 'core-chg-roll',
      title: '2W6 würfeln',
      tags: [T_REQUIRED],
      text:
`Wirf zwei W6 — das Ergebnis ist deine maximale Charge-Bewegung in Zoll.

Charge gelingt NUR, wenn am Ende mindestens ein Modell deiner Einheit Engagement Range (≤1") zu JEDEM erklärten Ziel hat.

Schlägt fehl → keine Bewegung, weiter zum nächsten Charge.`,
    },
    {
      id: 'core-chg-overwatch',
      title: 'Overwatch (Gegner reagiert)',
      tags: [T_REACTIVE],
      text:
`Verteidiger darf nach deiner Charge-Erklärung Overwatch ansagen (Stratagem, 1 CP):

Eine seiner Einheiten in 24" Sichtlinie schießt auf die chargende Einheit. Trifft NUR bei rohen 6en (BS effektiv 6+). Pistolen erlaubt.`,
    },
    {
      id: 'core-chg-heroic',
      title: 'Heroic Intervention',
      tags: [T_REACTIVE],
      text:
`Nach allen Charges deiner Runde:

Jedes deiner CHARACTER-Modelle innerhalb 6" einer feindlichen Einheit, die diese Phase NICHT gechargt hat, darf bis zu 3" Bewegung machen — muss in Engagement Range enden.`,
    },
  ],

  fight: [
    {
      id: 'core-fight-order',
      title: 'Fight-Reihenfolge',
      timing: 'start',
      tags: [T_REQUIRED],
      text:
`Reihenfolge:

1. ZUERST alle Einheiten mit [FIGHTS FIRST]. Charger haben das automatisch. Bei Gleichstand entscheidet der Active Player.
2. DANN alternierend — du eine Einheit, dann Gegner, dann du, …
3. ZULETZT [FIGHTS LAST]-Einheiten (selten).`,
    },
    {
      id: 'core-fight-step',
      title: 'Fight-Schritte pro Einheit',
      tags: [T_REQUIRED],
      text:
`1. Pile In: bis zu 3 Modelle bewegen je 3" Richtung nächstes feindliches Modell (in Engagement bleiben)
2. Attacken auswählen (Melee-Waffen — siehe Unit-Card)
3. Hit / Wound / Save / Damage abwickeln
4. Consolidate: bis zu 3 Modelle bewegen je 3" — näher zum Gegner ODER zu einem Objective`,
    },
    {
      id: 'core-fight-sequence',
      title: 'Würfel-Sequenz',
      tags: [T_REQUIRED],
      text:
`Pro Waffe identisch zum Schießen:
1. Anzahl Attacken (A × Modelle in Engagement)
2. Hit-Roll: WS
3. Wound-Roll: S vs T (gleiches Schema wie Shooting)
4. Saves & Damage

Vehicles (außer Walker) im Nahkampf: −1 to hit.`,
    },
  ],

  end: [
    {
      id: 'core-end-score',
      title: 'Punkte werten',
      timing: 'end',
      tags: [T_REQUIRED],
      text:
`Primary: nach Mission-Regeln (typ. 5/10/15 VP pro Objective, max 50).
• Battle Round 1: der erste Spieler wertet KEINE Primary in seinem ersten Turn.

Secondary: ausgewählte Karten / Tactical Objectives werten (max 50 VP gesamt).`,
    },
    {
      id: 'core-end-effects',
      title: '„End of turn"-Effekte',
      timing: 'end',
      tags: [T_REQUIRED],
      text:
`Schau in den Unit-Karten:
• alle „at the end of your turn"-Abilities auflösen
• Once-per-Turn-Stratagems wieder freischalten
• ablaufende Marker entfernen

Battle-shock-Token: bleiben bis zur nächsten Command Phase.`,
    },
    {
      id: 'core-end-game',
      title: 'Spielende?',
      tags: [T_OPTIONAL],
      text:
`Nach Battle Round 5 endet das Spiel — finale VPs ermitteln.

Sudden Death früher möglich, wenn Mission das vorsieht (z.B. Tabling).`,
    },
  ],
};

/** All entries for the given phase id, in canonical display order
 *  (start → middle → end). */
export function getCorePhaseRules(phaseId) {
  return CORE_PHASE_RULES[phaseId] || [];
}
