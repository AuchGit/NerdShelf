import { createContext, useContext, useState } from 'react'

const T = {
  de: {
    appTitle: '⚔ DnD Character Builder',
    logout: 'Abmelden', back: '← Zurück', loading: 'Laden...', search: 'Suchen...',
    next: 'Weiter →', finish: '✓ Character erstellen', saving: 'Speichern...',
    open: 'Öffnen', select: 'Auswählen', selected: '✓ Gewählt',
    noResults: 'Keine Ergebnisse.', loadingData: 'Lade Daten...', source: 'Quelle',

    myCharacters: 'Meine Characters', newCharacter: '+ Neuer Character',
    noCharacters: 'Noch keine Characters.', createFirst: 'Ersten Character erstellen',

    // 9 Schritte — Reihenfolge: Edition, Grundinfo, Rasse, Background, Klasse,
    //              Klassen-Optionen, Ability Scores, Zauber, Übersicht
    steps: ['Edition','Grundinfo','Rasse','Background','Klasse','Klassen-Optionen','Ability Scores','Zauber','Übersicht'],

    chooseEdition: 'Edition wählen',
    editionNote: 'Die Edition kann später nicht mehr geändert werden.',
    edition5e: 'D&D 5e (2014)', edition5eSub: "Player's Handbook 2014",
    edition5eDesc: 'Die klassische Edition. Rassische ASI-Boni, klassische Backgrounds ohne Feats.',
    edition55e: 'D&D 5.5e (2024)', edition55eSub: "Player's Handbook 2024",
    edition55eDesc: 'Überarbeitete Regeln. Spezies statt Rassen, Backgrounds geben Feats + ASI.',

    charName: 'Character-Name', charNamePlaceholder: 'z.B. Aldric Sturmmantel',
    playerName: 'Spieler-Name', alignment: 'Gesinnung',
    age: 'Alter', height: 'Größe', weight: 'Gewicht',
    eyes: 'Augenfarbe', hair: 'Haarfarbe', skin: 'Hautfarbe',

    chooseRace: 'Rasse wählen', chooseSpecies: 'Spezies wählen',
    raceSubtitle5e: 'Deine Rasse gibt dir Ability Score Boni, Traits und manchmal Zauber.',
    raceSubtitle55e: 'In 5.5e bestimmt deine Spezies körperliche Merkmale. ASI-Boni wählst du frei.',
    subraceTitle: 'Unterrasse wählen',
    speed: 'Geschwindigkeit', size: 'Größe', hasSubraces: 'Hat Unterrassen',
    traits: 'Traits', languages: 'Sprachen',

    chooseClass: 'Klasse wählen',
    classSubtitle: 'Deine Startklasse. Multiclassing kannst du später beim Levelup hinzufügen.',
    hitDie: 'Trefferwürfel', casterType: 'Caster-Typ',
    spellcastingAbility: 'Zaubern-Attribut', subclassAt: 'Subklasse bei Level',
    noCaster: 'Kein Caster', fullCaster: 'Full Caster', halfCaster: 'Half Caster',
    thirdCaster: '1/3 Caster', pactMagic: 'Pact Magic',

    // ── Klassen-Optionen (Step 4b) ──
    classOptions: 'Klassen-Optionen',
    skillsChooseFrom: (count) => `Wähle ${count} Skills aus deiner Klassen-Liste:`,
    skillsSelected: 'gewählt',
    skillsRemaining1: 'Noch 1 Skill wählen.',
    skillsRemainingN: (n) => `Noch ${n} Skills wählen.`,
    allSkillsChosen: 'Alle Skills gewählt!',
    alreadyFromBackground: 'Bereits aus Background',
    noSkillChoices: 'Diese Klasse hat keine wählbaren Skill-Proficiencies.',

    chooseBackground: 'Background wählen',
    bgSubtitle: 'Dein Background definiert wer dein Character vor dem Abenteuer war.',
    bgSubtitle55e: 'In 5.5e gibt dein Background außerdem einen Feat und Ability Score Boni.',
    skills: 'Skills', tools: 'Tools', givesFeat: 'Gibt Feat',

    abilityScores: 'Ability Scores',
    standardArray: 'Standard Array', standardArrayDesc: '15,14,13,12,10,8 verteilen',
    pointBuy: 'Point Buy', pointBuyDesc: '27 Punkte verteilen',
    roll3d6: '⚅ 3d6', roll3d6Desc: '3 Würfel pro Score',
    roll4d6: '⚅ 4d6 Drop Lowest', roll4d6Desc: 'Bestes aus 4 Würfeln',
    manual: '✎ Manuell', manualDesc: 'Frei eingeben',
    rollBtn: '⚅ Würfeln!', rollResults: 'Ergebnisse',
    pointsLeft: 'Punkte übrig', availableValues: 'Verfügbare Werte', allAssigned: '✓ Alle verteilt',
    speciesASIMethod: 'Wie werden Spezies-ASI-Boni angewendet?',
    asiFixed: 'Standard (feste Rassen-Boni)',
    asiFreePlus2Plus1: '+2/+1 frei wählen (Tasha\'s Optional)',
    asiFreePlus1Plus1Plus1: '+1/+1/+1 frei wählen (Tasha\'s Optional)',
    asiOriginFeat: '+1/+1 + Origin Feat',
    chooseASITarget: 'Auf welches Attribut?',

    // ── HP ──
    hpMethod: 'HP-Methode (für Level-Ups)',
    hpMethodNote: 'Level 1 HP ist immer Maximum. Wähle wie HP bei zukünftigen Level-Ups berechnet werden.',
    hpAverage: '⌀ Durchschnitt',
    hpRoll: '⚅ Würfeln',
    hpLevel1Preview: 'Level 1 HP (immer Max)',

    // ── Zauber (Step 7) ──
    chooseSpells: 'Zauber auswählen',
    noSpellcasting: 'Diese Klasse hat kein Spellcasting.',
    noSpellsAtLevel1: 'Keine Zauber-Auswahl bei Level 1 für diese Klasse.',
    preparedCasterNote: 'Als Prepared Caster bereitest du täglich Zauber aus deiner Klassenliste vor. Hier wählst du nur deine Cantrips.',
    spellbookNote: 'Du beginnst mit 6 Zaubern in deinem Spellbook.',

    str: 'Stärke', strAbbr: 'STR', strDesc: 'Athletik, Nahkampf',
    dex: 'Geschicklichkeit', dexAbbr: 'DEX', dexDesc: 'Akrobatik, Fernkampf, Initiative',
    con: 'Konstitution', conAbbr: 'CON', conDesc: 'HP, Konzentration',
    int: 'Intelligenz', intAbbr: 'INT', intDesc: 'Arkane Magie, Geschichte',
    wis: 'Weisheit', wisAbbr: 'WIS', wisDesc: 'Göttliche Magie, Wahrnehmung',
    cha: 'Charisma', chaAbbr: 'CHA', chaDesc: 'Soziale Interaktion, Überzeugung',

    reviewTitle: 'Übersicht', reviewNote: 'Alles korrekt? Du kannst danach alle Details noch anpassen.',
    name: 'Name', edition: 'Edition', race: 'Rasse', class: 'Klasse', background: 'Background',

    errEdition: 'Bitte wähle eine Edition.',
    errName: 'Bitte gib einen Character-Namen ein (min. 2 Zeichen).',
    errRace: 'Bitte wähle eine Rasse.',
    errClass: 'Bitte wähle eine Klasse.',
    errSkills: 'Bitte wähle alle erforderlichen Skill-Proficiencies.',
    errBackground: 'Bitte wähle einen Background.',
    errAbilities: 'Bitte wähle eine Methode und verteile alle Ability Scores.',
    errSpells: 'Bitte wähle alle erforderlichen Zauber und Cantrips.',
    errSave: 'Fehler beim Speichern. Bitte versuche es erneut.',
  },
  en: {
    appTitle: '⚔ DnD Character Builder',
    logout: 'Sign Out', back: '← Back', loading: 'Loading...', search: 'Search...',
    next: 'Next →', finish: '✓ Create Character', saving: 'Saving...',
    open: 'Open', select: 'Select', selected: '✓ Selected',
    noResults: 'No results.', loadingData: 'Loading data...', source: 'Source',

    myCharacters: 'My Characters', newCharacter: '+ New Character',
    noCharacters: 'No characters yet.', createFirst: 'Create first character',

    // 9 steps — order matches CharacterCreatePage.jsx:
    // Edition, BasicInfo, Race, Background, Class, ClassOptions, AbilityScores, Spells, Review
    steps: ['Edition','Basic Info','Race','Background','Class','Class Options','Ability Scores','Spells','Review'],

    chooseEdition: 'Choose Edition',
    editionNote: 'The edition cannot be changed later.',
    edition5e: 'D&D 5e (2014)', edition5eSub: "Player's Handbook 2014",
    edition5eDesc: 'The classic edition. Racial ASI bonuses, classic backgrounds without feats.',
    edition55e: 'D&D 5.5e (2024)', edition55eSub: "Player's Handbook 2024",
    edition55eDesc: 'Revised rules. Species instead of races, backgrounds grant feats + ASI.',

    charName: 'Character Name', charNamePlaceholder: 'e.g. Aldric Stormcloak',
    playerName: 'Player Name', alignment: 'Alignment',
    age: 'Age', height: 'Height', weight: 'Weight',
    eyes: 'Eye Color', hair: 'Hair Color', skin: 'Skin Color',

    chooseRace: 'Choose Race', chooseSpecies: 'Choose Species',
    raceSubtitle5e: 'Your race grants ability score bonuses, traits, and sometimes spells.',
    raceSubtitle55e: 'In 5.5e your species determines physical traits. ASI bonuses are chosen freely.',
    subraceTitle: 'Choose Subrace',
    speed: 'Speed', size: 'Size', hasSubraces: 'Has Subraces',
    traits: 'Traits', languages: 'Languages',

    chooseClass: 'Choose Class',
    classSubtitle: 'Your starting class. Multiclassing can be added later when leveling up.',
    hitDie: 'Hit Die', casterType: 'Caster Type',
    spellcastingAbility: 'Spellcasting Ability', subclassAt: 'Subclass at Level',
    noCaster: 'Non-Caster', fullCaster: 'Full Caster', halfCaster: 'Half Caster',
    thirdCaster: '1/3 Caster', pactMagic: 'Pact Magic',

    // ── Class Options (Step 4b) ──
    classOptions: 'Class Options',
    skillsChooseFrom: (count) => `Choose ${count} skills from your class list:`,
    skillsSelected: 'selected',
    skillsRemaining1: '1 more skill to choose.',
    skillsRemainingN: (n) => `${n} more skills to choose.`,
    allSkillsChosen: 'All skills chosen!',
    alreadyFromBackground: 'Already from Background',
    noSkillChoices: 'This class has no skill proficiency choices.',

    chooseBackground: 'Choose Background',
    bgSubtitle: 'Your background defines who your character was before adventuring.',
    bgSubtitle55e: 'In 5.5e your background also grants a feat and ability score bonuses.',
    skills: 'Skills', tools: 'Tools', givesFeat: 'Grants Feat',

    abilityScores: 'Ability Scores',
    standardArray: 'Standard Array', standardArrayDesc: 'Assign 15,14,13,12,10,8',
    pointBuy: 'Point Buy', pointBuyDesc: 'Spend 27 points',
    roll3d6: '⚅ 3d6', roll3d6Desc: '3 dice per score',
    roll4d6: '⚅ 4d6 Drop Lowest', roll4d6Desc: 'Best of 4 dice',
    manual: '✎ Manual', manualDesc: 'Enter freely',
    rollBtn: '⚅ Roll!', rollResults: 'Results',
    pointsLeft: 'Points left', availableValues: 'Available Values', allAssigned: '✓ All assigned',
    speciesASIMethod: 'How to apply species ASI bonuses?',
    asiFixed: 'Standard (fixed racial bonuses)',
    asiFreePlus2Plus1: '+2/+1 choose freely (Tasha\'s Optional)',
    asiFreePlus1Plus1Plus1: '+1/+1/+1 choose freely (Tasha\'s Optional)',
    asiOriginFeat: '+1/+1 + Origin Feat',
    chooseASITarget: 'Which ability?',

    // ── HP ──
    hpMethod: 'HP Method (for Level-Ups)',
    hpMethodNote: 'Level 1 HP is always maximum. Choose how HP is calculated on future level-ups.',
    hpAverage: '⌀ Average',
    hpRoll: '⚅ Roll',
    hpLevel1Preview: 'Level 1 HP (always max)',

    // ── Spells (Step 7) ──
    chooseSpells: 'Choose Spells',
    noSpellcasting: 'This class has no spellcasting.',
    noSpellsAtLevel1: 'No spell choices at level 1 for this class.',
    preparedCasterNote: 'As a prepared caster you choose spells each day from your full class list. Here you only choose your cantrips.',
    spellbookNote: 'You start with 6 spells in your spellbook.',

    str: 'Strength', strAbbr: 'STR', strDesc: 'Athletics, melee combat',
    dex: 'Dexterity', dexAbbr: 'DEX', dexDesc: 'Acrobatics, ranged combat, initiative',
    con: 'Constitution', conAbbr: 'CON', conDesc: 'HP, concentration',
    int: 'Intelligence', intAbbr: 'INT', intDesc: 'Arcane magic, history',
    wis: 'Wisdom', wisAbbr: 'WIS', wisDesc: 'Divine magic, perception',
    cha: 'Charisma', chaAbbr: 'CHA', chaDesc: 'Social interaction, persuasion',

    reviewTitle: 'Review', reviewNote: 'Everything correct? You can adjust all details afterward.',
    name: 'Name', edition: 'Edition', race: 'Race', class: 'Class', background: 'Background',

    errEdition: 'Please choose an edition.',
    errName: 'Please enter a character name (min. 2 characters).',
    errRace: 'Please choose a race.',
    errClass: 'Please choose a class.',
    errSkills: 'Please select all required skill proficiencies.',
    errBackground: 'Please choose a background.',
    errAbilities: 'Please choose a method and assign all ability scores.',
    errSpells: 'Please select all required cantrips and spells.',
    errSave: 'Error saving. Please try again.',
  }
}

const LanguageContext = createContext()

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState('de')
  const t = key => {
    const val = T[lang][key] ?? T['en'][key] ?? key
    // Erlaubt Funktions-Keys wie skillsChooseFrom(count)
    return val
  }
  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}
