// src/features/dnd/character-builder/lib/featureEffects.js
//
// Data-driven catalog of "this feature has a mechanical or descriptive
// effect on the sheet" — used for both pure display notes ("Adv vs.
// charmed") and applied mechanics (Resilient grants save prof, Alert
// gives +5 init, Diamond Soul makes all saves proficient).
//
// The catalog is structurally simple so adding a feature is a JSON-ish
// entry, no JS-path changes anywhere else. Each entry has:
//
//   id          — stable identifier (used as React key)
//   feature     — feature/feat/trait name as it appears in the source
//                 data; matched case-insensitively against
//                 gatherCharacterFeatures(character)
//   race        — optional: only match if this needle appears in
//                 species.raceId or species.subraceId (case-insens.)
//   className   — optional: only match if character has this class …
//   classLevel  — optional: … at this level or higher
//   subclass    — optional: substring match against any subclassId
//   fromFeats   — true if the entry should only match when a feat with
//                 this name exists on character.feats[] (used to avoid
//                 collisions like "Lucky" halfling trait vs Lucky feat)
//   effects     — array of { slot, text } pairs. `slot` is the place on
//                 the sheet the note belongs. Multiple slots = multiple
//                 entries; one feature can attach notes to several
//                 sections at once.
//   mechanic    — optional structured effect the rules engine applies:
//                   allSavesProficient: true
//                   saveProficient: ['con']               specific saves
//                   saveProficiencyFromAbilityBonus: true Resilient pattern
//                                                         (proficient in
//                                                         whichever save
//                                                         the feat's
//                                                         abilityBonus
//                                                         points at)
//                   saveBonusFromAbility: 'cha'           Aura of Protection
//                   initBonus: 5                          Alert
//                   hpPerLevel: 2                         Tough
//                   speedBonus: 10                        Mobile
//                   damageResistance: ['poison']          (passive)
//                   damageImmunity:   ['fire']
//                   damageVulnerability: ['radiant']
//
// `slot` values used today (extend freely as new notes need a home):
//   'saves'           — note attaches to the saving-throws block
//   'save:str' …      — note tied to one specific ability save
//   'concentration'   — concentration tracker
//   'attacks'         — Attacks & Actions section
//   'hp'              — Hit Points block
//   'speed'           — Speed tile / hover
//   'init'            — Initiative tile
//   'ac'              — AC tile
//   'conditions'      — Conditions section
//   'deathSaves'      — death-save pips
//   'skills'          — Skills sidebar (general note)
//   'skill:<name>'    — specific skill row

export const FEATURE_EFFECTS = [
  // ── Race / Species traits ────────────────────────────────────
  {
    id: 'fey-ancestry',
    feature: 'Fey Ancestry',
    race: 'Elf',
    effects: [
      { slot: 'saves', text: 'Vorteil gegen bezaubert (charmed)' },
      { slot: 'saves', text: 'Magie kann dich nicht in Schlaf versetzen' },
    ],
  },
  {
    id: 'brave',
    feature: 'Brave',
    race: 'Halfling',
    effects: [{ slot: 'saves', text: 'Vorteil gegen verängstigt (frightened)' }],
  },
  {
    id: 'lucky-halfling',
    feature: 'Lucky',
    race: 'Halfling',
    effects: [
      { slot: 'attacks', text: 'Halfling-Glück: würfle eine 1 auf Attack/Ability/Save neu' },
      { slot: 'saves',   text: 'Halfling-Glück: würfle 1en neu' },
    ],
  },
  {
    id: 'dwarven-resilience',
    feature: 'Dwarven Resilience',
    race: 'Dwarf',
    effects: [{ slot: 'saves', text: 'Vorteil auf Saves gegen Gift' }],
    mechanic: { damageResistance: ['poison'] },
  },
  {
    id: 'stout-resilience',
    feature: 'Stout Resilience',
    race: 'Halfling',
    effects: [{ slot: 'saves', text: 'Vorteil auf Saves gegen Gift' }],
    mechanic: { damageResistance: ['poison'] },
  },
  {
    id: 'dwarven-toughness',
    feature: 'Dwarven Toughness',
    race: 'Hill Dwarf',
    effects: [{ slot: 'hp', text: 'Dwarven Toughness: +1 HP pro Level (Hill Dwarf)' }],
    mechanic: { hpPerLevel: 1 },
  },
  {
    id: 'darkvision',
    feature: 'Darkvision',
    effects: [{ slot: 'skill:perception', text: 'Darkvision: siehst 60 ft. in Dämmerlicht / 60 ft. schwach in Dunkelheit' }],
  },
  {
    id: 'superior-darkvision',
    feature: 'Superior Darkvision',
    effects: [{ slot: 'skill:perception', text: 'Superior Darkvision: 120 ft.' }],
  },
  {
    id: 'sunlight-sensitivity',
    feature: 'Sunlight Sensitivity',
    effects: [
      { slot: 'attacks', text: 'Sunlight Sensitivity: Nachteil auf Angriffe bei direktem Sonnenlicht' },
      { slot: 'skill:perception', text: 'Sunlight Sensitivity: Nachteil auf Wahrnehmung im Sonnenlicht' },
    ],
  },

  // ── Tiefling resistances (data-driven; matches by trait name) ──────
  {
    id: 'hellish-resistance',
    feature: 'Hellish Resistance',
    race: 'Tiefling',
    effects: [{ slot: 'hp', text: 'Resistenz gegen Feuerschaden' }],
    mechanic: { damageResistance: ['fire'] },
  },
  {
    id: 'celestial-resistance',
    feature: 'Celestial Resistance',
    race: 'Aasimar',
    effects: [{ slot: 'hp', text: 'Resistenz gegen nekrotischen + strahlenden Schaden' }],
    mechanic: { damageResistance: ['necrotic', 'radiant'] },
  },
  {
    id: 'natural-armor-tortle',
    feature: 'Natural Armor',
    race: 'Tortle',
    effects: [{ slot: 'ac', text: 'Natural Armor: AC 17 (DEX-Bonus ignoriert)' }],
  },
  {
    id: 'lightfoot-stealthy',
    feature: 'Naturally Stealthy',
    race: 'Lightfoot',
    effects: [{ slot: 'skill:stealth', text: 'Naturally Stealthy: versteckte hinter einer größeren Kreatur möglich' }],
  },
  {
    id: 'wood-elf-mask',
    feature: 'Mask of the Wild',
    race: 'Wood Elf',
    effects: [{ slot: 'skill:stealth', text: 'Mask of the Wild: in natürlichem Gelände leicht versteckt' }],
  },
  {
    id: 'wood-elf-trance',
    feature: 'Fleet of Foot',
    race: 'Wood Elf',
    effects: [{ slot: 'speed', text: 'Fleet of Foot: Speed 35 ft.' }],
  },
  {
    id: 'tabaxi-cats-talent',
    feature: "Cat's Talent",
    race: 'Tabaxi',
    effects: [{ slot: 'skills', text: "Cat's Talent: Profizienz in Perception + Stealth" }],
  },
  {
    id: 'aarakocra-flight',
    feature: 'Flight',
    race: 'Aarakocra',
    effects: [{ slot: 'speed', text: 'Flight: 50 ft. Fluggeschwindigkeit (keine schwere Rüstung)' }],
  },
  {
    id: 'goliath-mountain-born',
    feature: 'Mountain Born',
    race: 'Goliath',
    effects: [
      { slot: 'hp', text: 'Mountain Born: angepasst an Höhenlagen' },
      { slot: 'hp', text: 'Resistenz gegen Kälteschaden' },
    ],
    mechanic: { damageResistance: ['cold'] },
  },
  {
    id: 'goliath-stones-endurance',
    feature: "Stone's Endurance",
    race: 'Goliath',
    effects: [{ slot: 'hp', text: "Stone's Endurance: Reaktion → reduziere Schaden um 1d12 + CON-Mod (1×/Short Rest)" }],
  },
  {
    id: 'halforc-savage-attacks',
    feature: 'Savage Attacks',
    race: 'Half-Orc',
    effects: [{ slot: 'attacks', text: 'Savage Attacks: bei Crit mit Nahkampfwaffe → 1 extra Würfel rollen' }],
  },
  {
    id: 'gnome-cunning',
    feature: 'Gnome Cunning',
    race: 'Gnome',
    effects: [
      { slot: 'save:int', text: 'Vorteil gegen Magie' },
      { slot: 'save:wis', text: 'Vorteil gegen Magie' },
      { slot: 'save:cha', text: 'Vorteil gegen Magie' },
    ],
  },
  {
    id: 'magic-resistance',
    feature: 'Magic Resistance',
    effects: [
      { slot: 'saves', text: 'Vorteil auf Saves gegen Zauber & andere magische Effekte' },
    ],
  },
  {
    id: 'relentless-endurance',
    feature: 'Relentless Endurance',
    race: 'Orc',
    effects: [
      { slot: 'hp', text: '1×/Long Rest: bei 0 HP fällst du stattdessen auf 1 HP' },
    ],
  },
  {
    id: 'aggressive',
    feature: 'Aggressive',
    race: 'Orc',
    effects: [
      { slot: 'speed', text: 'Bonusaktion: bewege deine volle Geschwindigkeit auf einen sichtbaren Feind zu' },
    ],
  },
  {
    id: 'tinker',
    feature: 'Artificer\'s Lore',
    race: 'Rock Gnome',
    effects: [
      { slot: 'skill:history', text: 'Doppelter Profizienz-Bonus bei magischen/technischen Artefakten' },
    ],
  },

  // ── Class features ───────────────────────────────────────────
  {
    id: 'rage',
    feature: 'Rage',
    className: 'Barbarian',
    classLevel: 1,
    effects: [
      { slot: 'save:str', text: 'Während Rage: Vorteil auf STR-Saves' },
      { slot: 'attacks',  text: 'Während Rage: Vorteil auf STR-Checks, +Schaden mit STR-Waffen' },
      { slot: 'hp',       text: 'Während Rage: Resistenz gegen B/P/S' },
    ],
  },
  {
    id: 'danger-sense',
    feature: 'Danger Sense',
    className: 'Barbarian',
    classLevel: 2,
    effects: [{ slot: 'save:dex', text: 'Danger Sense: Vorteil gegen sichtbare Effekte (Fallen, Zauber)' }],
  },
  {
    id: 'feral-instinct',
    feature: 'Feral Instinct',
    className: 'Barbarian',
    classLevel: 7,
    effects: [{ slot: 'init', text: 'Vorteil auf Initiative' }],
  },
  {
    id: 'persistent-rage',
    feature: 'Persistent Rage',
    className: 'Barbarian',
    classLevel: 15,
    effects: [{ slot: 'conditions', text: 'Rage endet nur willentlich oder wenn bewusstlos' }],
  },
  {
    id: 'indomitable-might',
    feature: 'Indomitable Might',
    className: 'Barbarian',
    classLevel: 18,
    effects: [{ slot: 'attacks', text: 'Min-STR-Wert auf STR-Checks = dein STR-Score' }],
  },

  {
    id: 'jack-of-all-trades',
    feature: 'Jack of All Trades',
    className: 'Bard',
    classLevel: 2,
    effects: [{ slot: 'skills', text: 'Halber Profizienz-Bonus auf ungeprofierte Ability-Checks' }],
  },

  {
    id: 'evasion-rogue',
    feature: 'Evasion',
    className: 'Rogue',
    classLevel: 7,
    effects: [{ slot: 'save:dex', text: 'Evasion: Erfolg = 0 Schaden, Fehlschlag = halber Schaden' }],
  },
  {
    id: 'evasion-monk',
    feature: 'Evasion',
    className: 'Monk',
    classLevel: 7,
    effects: [{ slot: 'save:dex', text: 'Evasion: Erfolg = 0 Schaden, Fehlschlag = halber Schaden' }],
  },
  {
    id: 'slippery-mind',
    feature: 'Slippery Mind',
    className: 'Rogue',
    classLevel: 15,
    effects: [
      { slot: 'save:wis', text: 'Profizienz in WIS-Saves' },
      { slot: 'save:cha', text: 'Profizienz in CHA-Saves' },
    ],
    mechanic: { saveProficient: ['wis', 'cha'] },
  },
  {
    id: 'uncanny-dodge',
    feature: 'Uncanny Dodge',
    className: 'Rogue',
    classLevel: 5,
    effects: [{ slot: 'ac', text: 'Reaktion: halbiere Schaden eines sichtbaren Angreifers' }],
  },

  {
    id: 'aura-of-protection',
    feature: 'Aura of Protection',
    className: 'Paladin',
    classLevel: 6,
    effects: [{ slot: 'saves', text: '+CHA-Mod auf alle Saves (du & Verbündete in 10 ft.)' }],
    mechanic: { saveBonusFromAbility: 'cha' },
  },
  {
    id: 'aura-of-courage',
    feature: 'Aura of Courage',
    className: 'Paladin',
    classLevel: 10,
    effects: [{ slot: 'conditions', text: 'Immun gegen verängstigt (du & Verbündete in 10 ft.)' }],
  },
  {
    id: 'cleansing-touch',
    feature: 'Cleansing Touch',
    className: 'Paladin',
    classLevel: 14,
    effects: [{ slot: 'concentration', text: 'Aktion: beende einen Zauber auf willigem Ziel' }],
  },

  {
    id: 'indomitable',
    feature: 'Indomitable',
    className: 'Fighter',
    classLevel: 9,
    effects: [{ slot: 'saves', text: 'Indomitable: 1×/Long Rest einen gescheiterten Save neu würfeln' }],
  },
  {
    id: 'second-wind',
    feature: 'Second Wind',
    className: 'Fighter',
    classLevel: 1,
    effects: [{ slot: 'hp', text: 'Bonusaktion: heile 1d10 + Fighter-Level HP (kurze Rast lädt nach)' }],
  },
  {
    id: 'action-surge',
    feature: 'Action Surge',
    className: 'Fighter',
    classLevel: 2,
    effects: [{ slot: 'attacks', text: '1×/Kurzrast: zusätzliche Aktion in einem Zug' }],
  },

  {
    id: 'diamond-soul',
    feature: 'Diamond Soul',
    className: 'Monk',
    classLevel: 14,
    effects: [{ slot: 'saves', text: 'Profizient in ALLEN Saving Throws' }],
    mechanic: { allSavesProficient: true },
  },
  {
    id: 'stillness-of-mind',
    feature: 'Stillness of Mind',
    className: 'Monk',
    classLevel: 7,
    effects: [{ slot: 'conditions', text: 'Aktion: beende einen Charme- oder Frightened-Effekt auf dir' }],
  },
  {
    id: 'purity-of-body',
    feature: 'Purity of Body',
    className: 'Monk',
    classLevel: 10,
    effects: [
      { slot: 'saves', text: 'Immun gegen Krankheiten & Gift' },
      { slot: 'hp',    text: 'Immun gegen Krankheiten & Gift' },
    ],
  },

  {
    id: 'natural-recovery',
    feature: 'Natural Recovery',
    className: 'Druid',
    subclass: 'Land',
    classLevel: 2,
    effects: [{ slot: 'concentration', text: 'Bei kurzer Rast: stelle Spell Slots = halber Druid-Level (round up) wieder her' }],
  },

  {
    id: 'cantrip-versatility',
    feature: 'Cantrip Versatility',
    classLevel: 4,
    effects: [{ slot: 'attacks', text: 'Bei ASI/Feat-Level: tausche einen bekannten Cantrip aus' }],
  },

  // ── Feats ─────────────────────────────────────────────────────
  {
    id: 'alert',
    feature: 'Alert',
    fromFeats: true,
    effects: [
      { slot: 'init',  text: '+5 Initiative' },
      { slot: 'init',  text: 'Du kannst nicht überrascht werden, solange bei Bewusstsein' },
    ],
    mechanic: { initBonus: 5 },
  },
  {
    id: 'war-caster',
    feature: 'War Caster',
    fromFeats: true,
    effects: [
      { slot: 'concentration', text: 'Vorteil auf Konzentrations-Saves' },
      { slot: 'attacks',       text: 'Bei Opportunity Attack: kannst statt einer Waffenattacke einen Zauber wirken' },
    ],
  },
  {
    id: 'lucky-feat',
    feature: 'Lucky',
    fromFeats: true,
    effects: [
      { slot: 'attacks', text: 'Lucky-Feat: 3×/Long Rest einen d20-Wurf wiederholen' },
      { slot: 'saves',   text: 'Lucky-Feat: 3×/Long Rest einen d20-Wurf wiederholen' },
    ],
  },
  {
    id: 'tough',
    feature: 'Tough',
    fromFeats: true,
    effects: [{ slot: 'hp', text: '+2 HP pro Charakter-Level (kumulativ)' }],
    mechanic: { hpPerLevel: 2 },
  },
  {
    id: 'mobile',
    feature: 'Mobile',
    fromFeats: true,
    effects: [{ slot: 'speed', text: '+10 ft. Speed; ignoriere schwieriges Gelände beim Sprint; +OA-Immunität gegen Ziel, das du attackiert hast' }],
    mechanic: { speedBonus: 10 },
  },
  {
    id: 'heavy-armor-master',
    feature: 'Heavy Armor Master',
    fromFeats: true,
    effects: [{ slot: 'ac', text: 'Reduziere nicht-magischen B/P/S-Schaden um 3' }],
  },
  {
    id: 'resilient',
    feature: 'Resilient',
    fromFeats: true,
    effects: [{ slot: 'saves', text: 'Resilient: Profizient in der gewählten Ability-Save' }],
    // Mechanic: the specific ability comes from feat.abilityBonus / feat.choices.ability.
    // computeProficiencies handles this — see `saveProficiencyFromAbilityBonus`.
    mechanic: { saveProficiencyFromAbilityBonus: true },
  },
  {
    id: 'inspiring-leader',
    feature: 'Inspiring Leader',
    fromFeats: true,
    effects: [{ slot: 'hp', text: 'Nach 10-Minuten-Rede: gib 6 Verbündeten temp HP = Char-Level + CHA-Mod' }],
  },
  {
    id: 'magic-initiate',
    feature: 'Magic Initiate',
    fromFeats: true,
    effects: [{ slot: 'attacks', text: '1×/Long Rest: einen Level-1 Spell aus dem Feat ohne Slot wirken' }],
  },
  {
    id: 'sentinel',
    feature: 'Sentinel',
    fromFeats: true,
    effects: [
      { slot: 'attacks', text: 'Sentinel: OA reduziert Geschwindigkeit des Ziels auf 0' },
      { slot: 'attacks', text: 'Sentinel: Disengage entfernt die OA-Immunität nicht' },
      { slot: 'attacks', text: 'Sentinel: Reaktion → OA wenn Verbündeter im 5-ft.-Radius angegriffen wird' },
    ],
  },
  {
    id: 'polearm-master',
    feature: 'Polearm Master',
    fromFeats: true,
    effects: [
      { slot: 'attacks', text: 'Polearm Master: Bonusaktion → 1d4 Bludgeoning mit dem Schaft' },
      { slot: 'attacks', text: 'Polearm Master: OA wenn ein Feind deine Reichweite betritt' },
    ],
  },
  {
    id: 'crossbow-expert',
    feature: 'Crossbow Expert',
    fromFeats: true,
    effects: [
      { slot: 'attacks', text: 'Crossbow Expert: ignoriere Loading-Eigenschaft' },
      { slot: 'attacks', text: 'Crossbow Expert: keine Disadvantage bei Ranged Attack im Nahkampf' },
      { slot: 'attacks', text: 'Crossbow Expert: Bonusaktion → Hand-Crossbow Attacke nach einer Hauptattacke' },
    ],
  },
  {
    id: 'sharpshooter',
    feature: 'Sharpshooter',
    fromFeats: true,
    effects: [
      { slot: 'attacks', text: 'Sharpshooter: ignoriere Long Range Disadvantage' },
      { slot: 'attacks', text: 'Sharpshooter: ignoriere halbe + dreiviertel Cover' },
      { slot: 'attacks', text: 'Sharpshooter: -5 Attack / +10 Schaden (optional pro Wurf)' },
    ],
  },
  {
    id: 'great-weapon-master',
    feature: 'Great Weapon Master',
    fromFeats: true,
    effects: [
      { slot: 'attacks', text: 'Great Weapon Master: -5 Attack / +10 Schaden (optional, Heavy)' },
      { slot: 'attacks', text: 'Great Weapon Master: Bonusaktion-Attacke bei Crit oder Kill' },
    ],
  },
  {
    id: 'mage-slayer',
    feature: 'Mage Slayer',
    fromFeats: true,
    effects: [
      { slot: 'attacks', text: 'Mage Slayer: Reaktion → OA wenn Caster in deinem Bereich zaubert' },
      { slot: 'saves',   text: 'Mage Slayer: Vorteil auf Saves vs. Zauber von angreifenden Casters' },
    ],
  },
  {
    id: 'athlete',
    feature: 'Athlete',
    fromFeats: true,
    effects: [
      { slot: 'speed', text: 'Athlete: aufstehen aus prone kostet 5 ft. statt halbe Geschwindigkeit' },
      { slot: 'speed', text: 'Athlete: Klettern kostet nicht extra' },
      { slot: 'skills', text: 'Athlete: Lauf-Anlauf 5 ft. statt 10 ft.' },
    ],
  },
  {
    id: 'observant',
    feature: 'Observant',
    fromFeats: true,
    effects: [
      { slot: 'skill:perception', text: 'Observant: +5 Passive Perception' },
      { slot: 'skill:investigation', text: 'Observant: +5 Passive Investigation' },
      { slot: 'skills', text: 'Observant: kannst Lippen lesen' },
    ],
  },
  {
    id: 'keen-mind',
    feature: 'Keen Mind',
    fromFeats: true,
    effects: [{ slot: 'skills', text: 'Keen Mind: perfekte Erinnerung der letzten 30 Tage' }],
  },
  {
    id: 'savage-attacker',
    feature: 'Savage Attacker',
    fromFeats: true,
    effects: [{ slot: 'attacks', text: 'Savage Attacker: 1×/Zug Waffenschaden neu würfeln' }],
  },
  {
    id: 'shield-master',
    feature: 'Shield Master',
    fromFeats: true,
    effects: [
      { slot: 'attacks', text: 'Shield Master: Bonusaktion-Shove nach Angriff' },
      { slot: 'save:dex', text: 'Shield Master: Schild-Bonus gilt für DEX-Saves' },
      { slot: 'save:dex', text: 'Shield Master: bei DEX-Save für Schaden → ggf. kein Schaden' },
    ],
  },
  {
    id: 'sentinel-shielder',
    feature: 'Dueling',
    fromFeats: true,
    effects: [{ slot: 'attacks', text: 'Fighting Style Dueling: +2 Schaden mit einhändiger Waffe' }],
  },
  {
    id: 'fighting-style-defense',
    feature: 'Defense',
    fromFeats: true,
    effects: [{ slot: 'ac', text: 'Fighting Style Defense: +1 AC mit Rüstung' }],
  },
  {
    id: 'fighting-style-archery',
    feature: 'Archery',
    fromFeats: true,
    effects: [{ slot: 'attacks', text: 'Fighting Style Archery: +2 auf Fernkampfangriffe' }],
  },
  {
    id: 'fighting-style-protection',
    feature: 'Protection',
    fromFeats: true,
    effects: [{ slot: 'ac', text: 'Fighting Style Protection: Reaktion → Disadvantage auf Angriff gegen Verbündeten in 5 ft. (Schild nötig)' }],
  },

  // ── Additional class features ─────────────────────────────────
  {
    id: 'reckless-attack',
    feature: 'Reckless Attack',
    className: 'Barbarian',
    classLevel: 2,
    effects: [{ slot: 'attacks', text: 'Reckless Attack: Vorteil auf STR-Nahkampfangriffe, aber Gegner haben Vorteil gegen dich' }],
  },
  {
    id: 'unarmored-defense-barb',
    feature: 'Unarmored Defense',
    className: 'Barbarian',
    classLevel: 1,
    effects: [{ slot: 'ac', text: 'Unarmored Defense (Barbarian): AC = 10 + DEX + CON ohne Rüstung' }],
  },
  {
    id: 'brutal-critical',
    feature: 'Brutal Critical',
    className: 'Barbarian',
    classLevel: 9,
    effects: [{ slot: 'attacks', text: 'Brutal Critical: +1 Würfel pro Stufe (Lvl 9/13/17) bei Crits' }],
  },
  {
    id: 'unarmored-defense-monk',
    feature: 'Unarmored Defense',
    className: 'Monk',
    classLevel: 1,
    effects: [{ slot: 'ac', text: 'Unarmored Defense (Monk): AC = 10 + DEX + WIS ohne Rüstung/Schild' }],
  },
  {
    id: 'unarmored-movement',
    feature: 'Unarmored Movement',
    className: 'Monk',
    classLevel: 2,
    effects: [{ slot: 'speed', text: 'Unarmored Movement: +Speed Bonus (skalierend mit Level)' }],
  },
  {
    id: 'martial-arts',
    feature: 'Martial Arts',
    className: 'Monk',
    classLevel: 1,
    effects: [
      { slot: 'attacks', text: 'Martial Arts: DEX statt STR für Monk-Waffen + Unarmed' },
      { slot: 'attacks', text: 'Martial Arts: Bonusaktion-Attacke unbewaffnet nach Attack-Aktion' },
    ],
  },
  {
    id: 'deflect-missiles',
    feature: 'Deflect Missiles',
    className: 'Monk',
    classLevel: 3,
    effects: [{ slot: 'attacks', text: 'Deflect Missiles: Reaktion → reduziere ranged-Schaden um 1d10 + DEX + Lvl; bei 0 ggf. zurückwerfen' }],
  },
  {
    id: 'slow-fall',
    feature: 'Slow Fall',
    className: 'Monk',
    classLevel: 4,
    effects: [{ slot: 'hp', text: 'Slow Fall: Reaktion → reduziere Fallschaden um 5 × Monk-Level' }],
  },
  {
    id: 'stunning-strike',
    feature: 'Stunning Strike',
    className: 'Monk',
    classLevel: 5,
    effects: [{ slot: 'attacks', text: 'Stunning Strike: nach Treffer → CON-Save (Ki DC) oder gestunnt bis Ende deines nächsten Zugs' }],
  },

  {
    id: 'cunning-action',
    feature: 'Cunning Action',
    className: 'Rogue',
    classLevel: 2,
    effects: [{ slot: 'attacks', text: 'Cunning Action: Bonusaktion → Dash / Disengage / Hide' }],
  },
  {
    id: 'sneak-attack',
    feature: 'Sneak Attack',
    className: 'Rogue',
    classLevel: 1,
    effects: [{ slot: 'attacks', text: 'Sneak Attack: 1×/Zug zusätzlicher Schaden (Adv oder Verbündeter im 5-ft.-Bereich des Ziels)' }],
  },
  {
    id: 'reliable-talent',
    feature: 'Reliable Talent',
    className: 'Rogue',
    classLevel: 11,
    effects: [{ slot: 'skills', text: 'Reliable Talent: profiziente Ability-Checks → d20-Wurf unter 10 zählt als 10' }],
  },
  {
    id: 'blindsense',
    feature: 'Blindsense',
    className: 'Rogue',
    classLevel: 14,
    effects: [{ slot: 'skill:perception', text: 'Blindsense: spürst unsichtbare Kreaturen in 10 ft.' }],
  },

  {
    id: 'extra-attack',
    feature: 'Extra Attack',
    effects: [{ slot: 'attacks', text: 'Extra Attack: 2× Angriff statt 1× bei der Attack-Aktion' }],
  },
  {
    id: 'fighting-spirit',
    feature: 'Fighting Spirit',
    classLevel: 3,
    effects: [{ slot: 'hp', text: 'Fighting Spirit: Bonusaktion → 5+ temp HP + Adv auf nächsten Angriff' }],
  },

  {
    id: 'divine-sense',
    feature: 'Divine Sense',
    className: 'Paladin',
    classLevel: 1,
    effects: [{ slot: 'skills', text: 'Divine Sense: Aktion → spüre Aberration / Celestial / Fiend / Untote in 60 ft.' }],
  },
  {
    id: 'lay-on-hands',
    feature: 'Lay on Hands',
    className: 'Paladin',
    classLevel: 1,
    effects: [{ slot: 'hp', text: 'Lay on Hands: heile bis zu 5 × Paladin-Level HP (Pool, Long Rest)' }],
  },
  {
    id: 'divine-smite',
    feature: 'Divine Smite',
    className: 'Paladin',
    classLevel: 2,
    effects: [{ slot: 'attacks', text: 'Divine Smite: nach Nahkampftreffer → Spellslot → +2d8 strahlend (mehr bei höheren Slots)' }],
  },

  {
    id: 'bardic-inspiration',
    feature: 'Bardic Inspiration',
    className: 'Bard',
    classLevel: 1,
    effects: [{ slot: 'attacks', text: 'Bardic Inspiration: Bonusaktion → gib Verbündetem 1 Inspiration-Würfel (CHA-Mod × Long Rest)' }],
  },
  {
    id: 'jack-trades',
    feature: 'Song of Rest',
    className: 'Bard',
    classLevel: 2,
    effects: [{ slot: 'hp', text: 'Song of Rest: bei Short Rest → Verbündete heilen extra Würfel' }],
  },
  {
    id: 'countercharm',
    feature: 'Countercharm',
    className: 'Bard',
    classLevel: 6,
    effects: [{ slot: 'conditions', text: 'Countercharm: Aktion → Verbündete in 30 ft. haben Adv vs. charmed / frightened' }],
  },

  {
    id: 'channel-divinity-cleric',
    feature: 'Channel Divinity',
    className: 'Cleric',
    classLevel: 2,
    effects: [{ slot: 'attacks', text: 'Channel Divinity: 1×/Rast nutze eine Channel-Option deiner Domäne' }],
  },
  {
    id: 'turn-undead',
    feature: 'Turn Undead',
    className: 'Cleric',
    classLevel: 2,
    effects: [{ slot: 'attacks', text: 'Turn Undead: Aktion → WIS-Save für Untote in 30 ft. oder sie fliehen 1 Min.' }],
  },

  {
    id: 'wild-shape',
    feature: 'Wild Shape',
    className: 'Druid',
    classLevel: 2,
    effects: [{ slot: 'hp', text: 'Wild Shape: Aktion → verwandle dich in eine Bestie (2×/Short Rest)' }],
  },
  {
    id: 'lands-stride',
    feature: "Land's Stride",
    classLevel: 6,
    effects: [
      { slot: 'speed', text: "Land's Stride: ignoriere nicht-magisches schwieriges Gelände" },
      { slot: 'speed', text: "Land's Stride: Adv vs. magisch wachsende Pflanzen-Hindernisse" },
    ],
  },

  {
    id: 'arcane-recovery',
    feature: 'Arcane Recovery',
    className: 'Wizard',
    classLevel: 1,
    effects: [{ slot: 'concentration', text: 'Arcane Recovery: bei Short Rest → einige Spell Slots zurückgewinnen (1×/Tag, max. halber Wizard-Level)' }],
  },
  {
    id: 'spell-mastery',
    feature: 'Spell Mastery',
    className: 'Wizard',
    classLevel: 18,
    effects: [{ slot: 'concentration', text: 'Spell Mastery: 1 Level-1 + 1 Level-2 Spell ohne Slot wirken' }],
  },

  {
    id: 'font-of-magic',
    feature: 'Font of Magic',
    className: 'Sorcerer',
    classLevel: 2,
    effects: [{ slot: 'concentration', text: 'Font of Magic: konvertiere Spell Slots ↔ Sorcery Points' }],
  },
  {
    id: 'metamagic',
    feature: 'Metamagic',
    className: 'Sorcerer',
    classLevel: 3,
    effects: [{ slot: 'concentration', text: 'Metamagic: bekannte Optionen modifizieren Spell (Sorcery Points)' }],
  },

  {
    id: 'pact-magic',
    feature: 'Pact Magic',
    className: 'Warlock',
    classLevel: 1,
    effects: [{ slot: 'concentration', text: 'Pact Magic: alle Slots auf höchstem Spell-Level, kurze Rast lädt nach' }],
  },
  {
    id: 'mystic-arcanum',
    feature: 'Mystic Arcanum',
    className: 'Warlock',
    classLevel: 11,
    effects: [{ slot: 'concentration', text: 'Mystic Arcanum: 1×/Tag Spell des passenden Levels (6/7/8/9) ohne Slot' }],
  },

  {
    id: 'favored-enemy',
    feature: 'Favored Enemy',
    className: 'Ranger',
    classLevel: 1,
    effects: [{ slot: 'skills', text: 'Favored Enemy: Adv. auf WIS-Survival-Checks gegen gewähltes Volk' }],
  },
  {
    id: 'natural-explorer',
    feature: 'Natural Explorer',
    className: 'Ranger',
    classLevel: 1,
    effects: [
      { slot: 'skills', text: 'Natural Explorer: doppelter Profizienz-Bonus auf INT- + WIS-Checks im Lieblings-Gelände' },
      { slot: 'speed',  text: 'Natural Explorer: schwieriges Gelände wird ignoriert; bleibt aufmerksam beim Marschieren' },
    ],
  },
]

// ── Detection ──────────────────────────────────────────────────────

function norm(s) {
  return String(s || '').toLowerCase().trim()
}
function contains(haystack, needle) {
  if (!haystack || !needle) return false
  return norm(haystack).includes(norm(needle))
}

/**
 * Build a Set of every feature name a character has gained — same
 * detection used by weapon-marking and proficiency-grant catalogs.
 * Inlined here to avoid a circular import; the two implementations are
 * intentionally aligned (kept in sync if anything changes).
 */
function gatherFeatureNames(character) {
  const set = new Set()
  // Optional features picked at level-up.
  for (const cls of (character.classes || [])) {
    const choices = cls.levelChoices || {}
    for (const lvl of Object.values(choices)) {
      for (const f of (lvl?.optionalFeatures || [])) {
        const name = typeof f === 'string' ? f : f?.name
        if (name) set.add(norm(name))
      }
    }
  }
  // Feats.
  for (const f of (character.feats || [])) {
    if (f?.featId) set.add(norm(f.featId))
    if (f?.name)   set.add(norm(f.name))
  }
  // Subclass-implied features — same table as in weaponMarkingRules.
  for (const cls of (character.classes || [])) {
    const sub = cls.subclassId || ''
    for (const [needle, implied] of SUBCLASS_IMPLIED) {
      if (contains(sub, needle)) {
        for (const name of implied) set.add(norm(name))
      }
    }
  }
  return set
}

const SUBCLASS_IMPLIED = [
  ['Hexblade',     ['Hex Warrior', "Hexblade's Curse"]],
  ['Battle Smith', ['Battle Ready']],
  ['Kensei',       ['Path of the Kensei']],
  ['Bladesinger',  ['Training in War and Song', 'Bladesong']],
  ['Soulknife',    ['Psychic Blades']],
]

/**
 * Returns the catalog entries that apply to this character. An entry
 * matches when its primary structural matcher succeeds:
 *
 *   • className (+ optional classLevel/subclass) — class feature; the
 *     character has it whenever they have that class at that level.
 *     The `feature:` name is used purely for display / FeatureNote id.
 *   • race — race/subrace trait; the character has it as long as the
 *     race token contains the matcher needle.
 *   • fromFeats — looks up the feature name on character.feats[].
 *   • subclass (without className) — any class with that subclass.
 *   • feature only — falls back to the gathered-name set, which covers
 *     optional features picked at level-up (Maneuvers, Invocations,
 *     Metamagic, Fighting Style) and subclass-implied lists.
 *
 * The earlier version required the feature name to appear in the
 * gathered set FOR EVERY ENTRY, which broke automatic class features
 * (Rage, Second Wind, Aura of Protection, …) — those are never in the
 * gathered set because they aren't picks. The matcher now uses the
 * structural fields as the authoritative gate when present, so
 * automatic class/race effects surface as soon as the level/race
 * matches.
 */
export function getActiveFeatureEffects(character, opts = {}) {
  if (!character) return []
  const features = gatherFeatureNames(character)
  // Race/subrace trait names are pulled from the 5etools `entries`
  // arrays at sheet-load time (CharacterSheetPage populates
  // species.__traitNames on `character` as a transient hint).
  // Without this hint we silently miss every "feature only" catalog
  // entry for race traits (Fey Ancestry, Brave, Dwarven Resilience,
  // …) because gatherFeatureNames doesn't see them otherwise.
  const extraNames = opts.extraFeatureNames instanceof Set
    ? opts.extraFeatureNames
    : new Set(character.species?.__traitNames || [])
  for (const n of extraNames) features.add(norm(n))
  const featSet = new Set((character.feats || []).map(f => norm(f.featId || f.name)))
  const raceTokens = `${character.species?.raceId || ''} ${character.species?.subraceId || ''}`
  const classes = character.classes || []

  const matches = []
  for (const e of FEATURE_EFFECTS) {
    let ok = false
    if (e.className) {
      const cls = classes.find(c => norm(c.classId) === norm(e.className))
      if (!cls) continue
      if (e.classLevel && (cls.level || 0) < e.classLevel) continue
      if (e.subclass && !contains(cls.subclassId, e.subclass)) continue
      ok = true
    } else if (e.subclass) {
      ok = classes.some(c => contains(c.subclassId, e.subclass))
    } else if (e.fromFeats) {
      ok = featSet.has(norm(e.feature))
    } else if (e.race) {
      // race needle must match AND (if no `feature` declared) that's
      // enough; with a feature, additionally require the trait name to
      // be present in the gathered set so we don't surface Fey
      // Ancestry effects for, say, a Half-Elf subrace that doesn't
      // have it.
      ok = contains(raceTokens, e.race) && (!e.feature || features.has(norm(e.feature)))
    } else if (e.feature) {
      ok = features.has(norm(e.feature))
    }
    if (!ok) continue
    matches.push(e)
  }
  return matches
}

/**
 * All notes attached to a slot, flat. Each result is { id, text } so
 * the renderer can use the id as a stable React key.
 */
export function getEffectsForSlot(character, slot) {
  const out = []
  for (const e of getActiveFeatureEffects(character)) {
    for (const eff of (e.effects || [])) {
      if (eff.slot === slot) out.push({ id: `${e.id}-${slot}-${out.length}`, text: eff.text, feature: e.feature })
    }
  }
  return out
}

/**
 * Aggregate the mechanical effects the rules engine should apply.
 * Returns plain numbers / sets so the consumer doesn't need to know
 * about the catalog structure.
 */
export function getMechanicalEffects(character) {
  const out = {
    initBonus:        0,
    speedBonus:       0,
    hpPerLevel:       0,
    allSavesProficient: false,
    saveProficient:   new Set(),     // ability keys
    saveBonusAbility: null,           // e.g. 'cha' (Aura of Protection)
    damageResistance:    new Set(),
    damageImmunity:      new Set(),
    damageVulnerability: new Set(),
  }
  for (const e of getActiveFeatureEffects(character)) {
    const m = e.mechanic
    if (!m) continue
    if (typeof m.initBonus === 'number') out.initBonus += m.initBonus
    if (typeof m.speedBonus === 'number') out.speedBonus += m.speedBonus
    if (typeof m.hpPerLevel === 'number') out.hpPerLevel += m.hpPerLevel
    if (m.allSavesProficient) out.allSavesProficient = true
    if (Array.isArray(m.saveProficient)) {
      for (const a of m.saveProficient) out.saveProficient.add(norm(a))
    }
    if (m.saveProficiencyFromAbilityBonus) {
      // Resilient pattern — read the chosen ability from the matching
      // feat. The feat is identified by its name on character.feats[].
      const feat = (character.feats || []).find(f => norm(f.featId || f.name) === norm(e.feature))
      const ability = feat?.abilityBonus
        ? Object.keys(feat.abilityBonus)[0]
        : feat?.choices?.ability
      if (ability) out.saveProficient.add(norm(ability))
    }
    if (m.saveBonusFromAbility) out.saveBonusAbility = m.saveBonusFromAbility
    if (Array.isArray(m.damageResistance))    for (const t of m.damageResistance)    out.damageResistance.add(norm(t))
    if (Array.isArray(m.damageImmunity))      for (const t of m.damageImmunity)      out.damageImmunity.add(norm(t))
    if (Array.isArray(m.damageVulnerability)) for (const t of m.damageVulnerability) out.damageVulnerability.add(norm(t))
  }
  return out
}
