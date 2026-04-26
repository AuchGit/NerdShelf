import { useLanguage } from '../../../lib/i18n'
import { setChoiceValue } from '../../../lib/choiceParser'

// ── Skill-Konstanten ───────────────────────────────────────
const ALL_SKILLS = [
  'acrobatics','animalHandling','arcana','athletics','deception',
  'history','insight','intimidation','investigation','medicine',
  'nature','perception','performance','persuasion','religion',
  'sleightOfHand','stealth','survival',
]

const SKILL_LABELS = {
  acrobatics:     'Acrobatics (DEX)',  animalHandling: 'Animal Handling (WIS)',
  arcana:         'Arcana (INT)',       athletics:      'Athletics (STR)',
  deception:      'Deception (CHA)',   history:        'History (INT)',
  insight:        'Insight (WIS)',      intimidation:   'Intimidation (CHA)',
  investigation:  'Investigation (INT)',medicine:       'Medicine (WIS)',
  nature:         'Nature (INT)',       perception:     'Perception (WIS)',
  performance:    'Performance (CHA)', persuasion:     'Persuasion (CHA)',
  religion:       'Religion (INT)',    sleightOfHand:  'Sleight of Hand (DEX)',
  stealth:        'Stealth (DEX)',     survival:       'Survival (WIS)',
}

function toSkillKey(raw) {
  if (!raw) return ''
  const s = raw.trim()
  if (SKILL_LABELS[s]) return s
  const camel = s.replace(/\s+(.)/g, (_, c) => c.toUpperCase()).replace(/^(.)/, (_, c) => c.toLowerCase())
  if (SKILL_LABELS[camel]) return camel
  const lower = s.toLowerCase().replace(/\s/g, '')
  for (const key of ALL_SKILLS) { if (key.toLowerCase() === lower) return key }
  return camel
}

function displaySkill(raw) {
  const key = toSkillKey(raw)
  return SKILL_LABELS[key] || raw
}

function camelToTitle(s) {
  if (!s) return ''
  return s.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
}

function extractSkillChoices(startingProfs) {
  const skills = startingProfs?.skills
  if (!skills || skills.length === 0) return null
  for (const entry of skills) {
    if (entry?.choose?.from && Array.isArray(entry.choose.from))
      return { count: entry.choose.count || 2, from: entry.choose.from }
    if (typeof entry?.any === 'number') return { count: entry.any, from: ALL_SKILLS }
    if (entry?.choose?.count && typeof entry.choose.from === 'string')
      return { count: entry.choose.count, from: ALL_SKILLS }
  }
  return null
}

// ── Fighting Styles ────────────────────────────────────────

const FIGHTING_STYLES = {
  Fighter: {
    '5e': [
      { id: 'Archery',                desc: '+2 bonus to attack rolls with ranged weapons.' },
      { id: 'Defense',                desc: '+1 to AC while wearing armor.' },
      { id: 'Dueling',                desc: '+2 damage when wielding a melee weapon in one hand and no other weapons.' },
      { id: 'Great Weapon Fighting',  desc: 'Reroll 1s and 2s on damage dice for two-handed weapons (keep new result).' },
      { id: 'Protection',             desc: 'When an adjacent ally is attacked, impose disadvantage as a reaction (shield required).' },
      { id: 'Two-Weapon Fighting',    desc: 'Add ability modifier to damage of off-hand attacks.' },
      { id: 'Blind Fighting',         desc: 'You have Blindsight with a range of 10 feet.' },
      { id: 'Interception',           desc: 'Reduce damage to another creature by 1d10 + proficiency bonus (reaction).' },
      { id: 'Superior Technique',     desc: 'Learn one Battle Master maneuver. Gain one superiority die (d6). (→ Maneuver unten wählen)', needsManeuver: true },
      { id: 'Thrown Weapon Fighting', desc: '+2 damage with thrown weapons; draw a weapon with the same action.' },
      { id: 'Unarmed Fighting',       desc: 'Unarmed strikes deal 1d6 (or 1d8 with free hand). Grappled targets take 1d4 at start of your turn.' },
    ],
    '5.5e': [
      { id: 'Archery',                desc: '+2 bonus to attack rolls with ranged weapons.' },
      { id: 'Defense',                desc: '+1 to AC while wearing armor.' },
      { id: 'Dueling',                desc: '+2 damage when wielding a melee weapon in one hand and no other weapons.' },
      { id: 'Great Weapon Fighting',  desc: 'Reroll 1s and 2s on damage dice for two-handed weapons.' },
      { id: 'Protection',             desc: 'When an adjacent ally is attacked, impose disadvantage as a reaction (shield required).' },
      { id: 'Two-Weapon Fighting',    desc: 'Add ability modifier to damage of off-hand attacks.' },
      { id: 'Blind Fighting',         desc: 'You have Blindsight with a range of 10 feet.' },
      { id: 'Interception',           desc: 'Reduce damage to another creature by 1d10 + proficiency bonus (reaction).' },
      { id: 'Thrown Weapon Fighting', desc: '+2 damage with thrown weapons; draw a weapon with the same action.' },
      { id: 'Unarmed Fighting',       desc: 'Unarmed strikes deal 1d6 (or 1d8 with free hand). Grappled targets take 1d4 per turn.' },
    ],
  },
  Paladin: {
    '5e': [
      { id: 'Defense',               desc: '+1 to AC while wearing armor.' },
      { id: 'Dueling',               desc: '+2 damage when wielding a melee weapon in one hand and no other weapons.' },
      { id: 'Great Weapon Fighting', desc: 'Reroll 1s and 2s on damage dice for two-handed weapons.' },
      { id: 'Protection',            desc: 'When an adjacent ally is attacked, impose disadvantage as a reaction (shield required).' },
    ],
    '5.5e': [
      { id: 'Defense',               desc: '+1 to AC while wearing armor.' },
      { id: 'Dueling',               desc: '+2 damage when wielding a melee weapon in one hand and no other weapons.' },
      { id: 'Great Weapon Fighting', desc: 'Reroll 1s and 2s on damage dice for two-handed weapons.' },
      { id: 'Protection',            desc: 'When an adjacent ally is attacked, impose disadvantage as a reaction (shield required).' },
      { id: 'Blessed Warrior',       desc: 'Learn two Cleric cantrips. Use CHA as spellcasting ability for them. (→ Cantrips im Spells-Schritt wählen)', needsSpells: 'Cleric', spellCount: 2 },
      { id: 'Blind Fighting',        desc: 'You have Blindsight with a range of 10 feet.' },
      { id: 'Interception',          desc: 'Reduce damage to another creature by 1d10 + proficiency bonus (reaction).' },
    ],
  },
  Ranger: {
    '5e': [
      { id: 'Archery',            desc: '+2 bonus to attack rolls with ranged weapons.' },
      { id: 'Defense',            desc: '+1 to AC while wearing armor.' },
      { id: 'Dueling',            desc: '+2 damage when wielding a melee weapon in one hand and no other weapons.' },
      { id: 'Two-Weapon Fighting',desc: 'Add ability modifier to damage of off-hand attacks.' },
    ],
    '5.5e': [
      { id: 'Archery',             desc: '+2 bonus to attack rolls with ranged weapons.' },
      { id: 'Defense',             desc: '+1 to AC while wearing armor.' },
      { id: 'Druidic Warrior',     desc: 'Learn two Druid cantrips. Use WIS as spellcasting ability for them. (→ Cantrips im Spells-Schritt wählen)', needsSpells: 'Druid', spellCount: 2 },
      { id: 'Two-Weapon Fighting', desc: 'Add ability modifier to damage of off-hand attacks.' },
      { id: 'Blind Fighting',      desc: 'You have Blindsight with a range of 10 feet.' },
    ],
  },
}

const CLASSES_WITH_FIGHTING_STYLE = ['Fighter', 'Paladin', 'Ranger']

// ── Battle Master Maneuvers ────────────────────────────────
const BATTLE_MASTER_MANEUVERS = [
  { id: 'Ambush',               source: 'TCE', desc: 'When you make a Dexterity (Stealth) check or an initiative roll, you can expend one superiority die and add the die to the roll.' },
  { id: 'Bait and Switch',      source: 'TCE', desc: 'When you\'re within 5 feet of a creature on your turn, you can expend one superiority die and switch places with that creature.' },
  { id: 'Brace',                source: 'TCE', desc: 'When a creature you can see moves into the reach you have with the melee weapon you\'re wielding, you can use your reaction to expend one superiority die and make one attack against the creature.' },
  { id: 'Commander\'s Strike',  source: 'PHB', desc: 'When you take the Attack action on your turn, you can forgo one of your attacks to direct one of your companions to strike.' },
  { id: 'Commanding Presence',  source: 'TCE', desc: 'When you make a Charisma (Intimidation), Charisma (Performance), or Charisma (Persuasion) check, you can expend one superiority die and add the die to the ability check.' },
  { id: 'Disarming Attack',     source: 'PHB', desc: 'When you hit a creature with a weapon attack, you can expend one superiority die to attempt to disarm the target.' },
  { id: 'Distracting Strike',   source: 'PHB', desc: 'When you hit a creature with a weapon attack, you can expend one superiority die to distract the creature, giving your allies an opening.' },
  { id: 'Evasive Footwork',     source: 'PHB', desc: 'When you move, you can expend one superiority die, rolling the die and adding the number rolled to your AC until you stop moving.' },
  { id: 'Feinting Attack',      source: 'PHB', desc: 'You can expend one superiority die and use a bonus action on your turn to feint, choosing one creature within 5 feet of you as your target.' },
  { id: 'Goading Attack',       source: 'PHB', desc: 'When you hit a creature with a weapon attack, you can expend one superiority die to attempt to goad the target into attacking you.' },
  { id: 'Grappling Strike',     source: 'TCE', desc: 'Immediately after you hit a creature with a melee attack on your turn, you can expend one superiority die and then try to grapple the target as a bonus action.' },
  { id: 'Lunging Attack',       source: 'PHB', desc: 'When you make a melee weapon attack on your turn, you can expend one superiority die to increase your reach for that attack by 5 feet.' },
  { id: 'Maneuvering Attack',   source: 'PHB', desc: 'When you hit a creature with a weapon attack, you can expend one superiority die to maneuver one of your comrades into a more advantageous position.' },
  { id: 'Menacing Attack',      source: 'PHB', desc: 'When you hit a creature with a weapon attack, you can expend one superiority die to attempt to frighten the target.' },
  { id: 'Parry',                source: 'PHB', desc: 'When another creature damages you with a melee attack, you can use your reaction and expend one superiority die to reduce the damage by the number you roll on your superiority die + your Dexterity modifier.' },
  { id: 'Precision Attack',     source: 'PHB', desc: 'When you make a weapon attack roll against a creature, you can expend one superiority die to add it to the roll.' },
  { id: 'Pushing Attack',       source: 'PHB', desc: 'When you hit a creature with a weapon attack, you can expend one superiority die to attempt to drive the target back.' },
  { id: 'Quick Toss',           source: 'TCE', desc: 'As a bonus action, you can expend one superiority die and make a ranged attack with a weapon that has the thrown property.' },
  { id: 'Rally',                source: 'PHB', desc: 'On your turn, you can use a bonus action and expend one superiority die to bolster the resolve of one of your companions.' },
  { id: 'Riposte',              source: 'PHB', desc: 'When a creature misses you with a melee attack, you can use your reaction and expend one superiority die to make a melee weapon attack against the creature.' },
  { id: 'Sweeping Attack',      source: 'PHB', desc: 'When you hit a creature with a melee weapon attack, you can expend one superiority die to attempt to damage another creature with the same attack.' },
  { id: 'Tactical Assessment',  source: 'TCE', desc: 'When you make an Intelligence (History), Intelligence (Investigation), or Wisdom (Insight) check, you can expend one superiority die and add the die to the ability check.' },
  { id: 'Trip Attack',          source: 'PHB', desc: 'When you hit a creature with a weapon attack, you can expend one superiority die to attempt to knock the target down.' },
]

// Ranger Favored Enemy (5e)
const FAVORED_ENEMIES_5E = [
  'Aberrations','Beasts','Celestials','Constructs','Dragons','Elementals',
  'Fey','Fiends','Giants','Humanoids','Monstrosities','Oozes','Plants','Undead',
]

// Ranger Natural Explorer Terrain (5e)
const FAVORED_TERRAINS_5E = [
  'Arctic','Coast','Desert','Forest','Grassland','Mountain','Swamp','Underdark',
]

function getFightingStyles(classId, edition) {
  const styles = FIGHTING_STYLES[classId]
  if (!styles) return null
  return styles[edition] || styles['5e'] || null
}

// ── Hauptkomponente ────────────────────────────────────────
// NOTE: Skill proficiency choices and Expertise have moved to Step7Proficiencies,
// which runs after Ability Scores so modifiers can be shown.
// This step now only handles non-skill class options:
//   • Fighting Style (Fighter, Paladin, Ranger)
//   • Superior Technique Maneuver
//   • Ranger Favored Enemy / Terrain (5e)
// The step is auto-skipped in CharacterCreatePage when nothing applies.

export default function Step4bProficiencies({ character, updateCharacter }) {
  const { t } = useLanguage()
  const cls = character.classes[0]
  const edition = character.meta.edition || '5e'

  const selectedFightingStyle = cls?.levelChoices?.[1]?.fightingStyle           || null
  const selectedManeuver      = cls?.levelChoices?.[1]?.superiorTechniqueManeuver || null
  const selectedFavoredEnemy  = cls?.levelChoices?.[1]?.favoredEnemy            || null
  const selectedFavoredTerrain = cls?.levelChoices?.[1]?.favoredTerrain         || null

  const fightingStyles  = getFightingStyles(cls?.classId, edition)
  const hasRangerExtras = cls?.classId === 'Ranger' && edition === '5e'

  const currentStyleObj = fightingStyles?.find(s => s.id === selectedFightingStyle) || null
  const needsManeuver   = currentStyleObj?.needsManeuver && selectedFightingStyle === 'Superior Technique'
  const needsSpellNote  = currentStyleObj?.needsSpells ? currentStyleObj : null

  // ── Fighting Style ────────────────────────────────────────
  function selectFightingStyle(id) {
    const newStyle = id === selectedFightingStyle ? null : id
    // Clear maneuver if style changes away from Superior Technique
    const patch = { fightingStyle: newStyle }
    if (newStyle !== 'Superior Technique') patch.superiorTechniqueManeuver = null
    updateLevelChoice(patch)
  }

  function selectManeuver(id) {
    updateLevelChoice({ superiorTechniqueManeuver: id === selectedManeuver ? null : id })
  }

  // ── Ranger extras ─────────────────────────────────────────
  function selectFavoredEnemy(val) {
    updateLevelChoice({ favoredEnemy: val === selectedFavoredEnemy ? null : val })
  }
  function selectFavoredTerrain(val) {
    updateLevelChoice({ favoredTerrain: val === selectedFavoredTerrain ? null : val })
  }

  // Gemeinsame Update-Funktion
  function updateLevelChoice(patch) {
    const updated = [...character.classes]
    updated[0] = {
      ...updated[0],
      levelChoices: {
        ...updated[0].levelChoices,
        1: { ...(updated[0].levelChoices?.[1] || {}), ...patch },
      },
    }
    updateCharacter('classes', updated)
  }

  // Write a choice into character.choices (unified choice storage).
  // NOTE: Class skill proficiency choices were moved to Step7Proficiencies.
  // If a toggleSkill handler is ever added back here, call:
  //   setChoice(`class:${cls.classId.toLowerCase()}:level1:skill:0`, nextSkills)
  function setChoice(id, val) {
    updateCharacter('choices', setChoiceValue(character.choices || {}, id, val))
  }

  // ── Kein Character / keine Klasse ─────────────────────────
  if (!cls) {
    return (
      <div style={styles.container}>
        <h2 style={styles.title}>{t('classOptions')}</h2>
        <p style={styles.muted}>Bitte wähle zuerst eine Klasse.</p>
      </div>
    )
  }

  const hasAnythingToPick = fightingStyles || hasRangerExtras

  if (!hasAnythingToPick) {
    return (
      <div style={styles.container}>
        <h2 style={styles.title}>{t('classOptions')}</h2>
        <p style={styles.subtitle}>{cls.classId}</p>
        <div style={styles.emptyBox}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>✓</div>
          <p style={styles.muted}>{t('noSkillChoices')}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>{t('classOptions')}</h2>
      <p style={styles.subtitle}>{cls.classId}</p>

      {/* ── Fighting Style ── */}
      {fightingStyles && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Fighting Style</div>
          <p style={styles.sectionDesc}>
            Wähle einen Fighting Style. Dieser bleibt permanent und kann nicht geändert werden.
            {!selectedFightingStyle && (
              <span style={{ color: 'var(--accent)', marginLeft: 8 }}>— noch nicht gewählt</span>
            )}
            {selectedFightingStyle && (
              <span style={{ color: 'var(--accent-green)', marginLeft: 8 }}>✓ {selectedFightingStyle}</span>
            )}
          </p>
          <div style={styles.styleGrid}>
            {fightingStyles.map(style => {
              const isSelected = selectedFightingStyle === style.id
              return (
                <div
                  key={style.id}
                  style={{ ...styles.styleCard, ...(isSelected ? styles.styleCardSelected : {}) }}
                  onClick={() => selectFightingStyle(style.id)}
                >
                  <div style={styles.styleName}>{style.id}</div>
                  <div style={styles.styleDesc}>{style.desc}</div>
                  {isSelected && <div style={styles.styleCheck}>✓ Gewählt</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Superior Technique: Maneuver Picker ── */}
      {needsManeuver && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>
            Battle Master Maneuver
            {selectedManeuver
              ? <span style={{ color: 'var(--accent-green)', marginLeft: 8, fontSize: 12, textTransform: 'none' }}>✓ {selectedManeuver}</span>
              : <span style={{ color: 'var(--accent)', marginLeft: 8, fontSize: 12, textTransform: 'none' }}>— noch nicht gewählt</span>
            }
          </div>
          <p style={styles.sectionDesc}>
            Superior Technique gibt dir ein Maneuver und einen Superiority Die (d6). Wähle ein Maneuver:
          </p>
          <div style={styles.maneuverGrid}>
            {BATTLE_MASTER_MANEUVERS.map(m => {
              const isSel = selectedManeuver === m.id
              return (
                <div
                  key={m.id}
                  style={{ ...styles.maneuverCard, ...(isSel ? styles.maneuverSelected : {}) }}
                  onClick={() => selectManeuver(m.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={styles.maneuverName}>{m.id}</div>
                    <span style={styles.maneuverSource}>{m.source}</span>
                    {isSel && <span style={{ color: 'var(--accent)', fontSize: 11, marginLeft: 'auto' }}>✓</span>}
                  </div>
                  <div style={styles.maneuverDesc}>{m.desc}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Spell-Note für Blessed/Druidic Warrior ── */}
      {needsSpellNote && (
        <div style={styles.spellNoteBox}>
          <span style={{ fontSize: 16, marginRight: 8 }}>✦</span>
          <span style={{ color: 'var(--accent-purple)', fontSize: 13 }}>
            <strong>{needsSpellNote.id}</strong> gewährt dir {needsSpellNote.spellCount} {needsSpellNote.needsSpells}-Cantrips.
            Du wählst diese im <strong>Spells-Schritt</strong> aus (unter „Cantrips aus Fighting Style").
          </span>
        </div>
      )}

      {/* ── Ranger: Favored Enemy + Natural Explorer (5e only) ── */}
      {hasRangerExtras && (
        <>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Favored Enemy</div>
            <p style={styles.sectionDesc}>
              Wähle einen Favored Enemy. Du hast advantage auf Survival-Checks um sie zu verfolgen,
              und auf Intelligence-Checks um sie zu erinnern.
            </p>
            <div style={styles.chipGrid}>
              {FAVORED_ENEMIES_5E.map(enemy => {
                const isSel = selectedFavoredEnemy === enemy
                return (
                  <button key={enemy}
                    style={{ ...styles.chip, ...(isSel ? styles.chipSelected : {}) }}
                    onClick={() => selectFavoredEnemy(enemy)}>
                    {enemy} {isSel ? '✓' : ''}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>Natural Explorer — Favored Terrain</div>
            <p style={styles.sectionDesc}>
              Wähle ein Favored Terrain. In diesem Terrain erhältst du verschiedene Boni.
            </p>
            <div style={styles.chipGrid}>
              {FAVORED_TERRAINS_5E.map(terrain => {
                const isSel = selectedFavoredTerrain === terrain
                return (
                  <button key={terrain}
                    style={{ ...styles.chip, ...(isSel ? styles.chipSelected : {}) }}
                    onClick={() => selectFavoredTerrain(terrain)}>
                    {terrain} {isSel ? '✓' : ''}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}

    </div>
  )
}
// Skills are now chosen in Step7Proficiencies (after Ability Scores),
// where modifiers are visible.

// ── Styles ─────────────────────────────────────────────────

const styles = {
  container: { maxWidth: 800, margin: '0 auto', padding: 16 },
  title:     { color: 'var(--accent)', marginBottom: 4 },
  subtitle:  { color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 },
  muted:     { color: 'var(--text-dim)', fontSize: 14 },
  emptyBox: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12,
    padding: 40, textAlign: 'center', color: 'var(--text-muted)',
  },
  section: {
    background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 12,
    padding: 16, marginBottom: 20,
  },
  sectionTitle: {
    color: 'var(--accent)', fontWeight: 'bold', fontSize: 13,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--border-subtle)',
  },
  sectionDesc: { color: 'var(--text-muted)', fontSize: 13, marginBottom: 14, marginTop: 8 },

  // Fighting Styles
  styleGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8,
  },
  styleCard: {
    background: 'var(--bg-elevated)', border: '2px solid var(--border)', borderRadius: 8,
    padding: '12px 14px', cursor: 'pointer', transition: 'all 0.15s',
  },
  styleCardSelected: { border: '2px solid var(--accent)', background: 'var(--bg-highlight)' },
  styleName:  { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13, marginBottom: 6 },
  styleDesc:  { color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 },
  styleCheck: { color: 'var(--accent)', fontSize: 11, marginTop: 6, fontWeight: 'bold' },

  // Battle Master Maneuvers
  maneuverGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8,
  },
  maneuverCard: {
    background: 'var(--bg-elevated)', border: '2px solid var(--border)', borderRadius: 8,
    padding: '10px 12px', cursor: 'pointer', transition: 'all 0.15s',
  },
  maneuverSelected: { border: '2px solid var(--accent)', background: 'var(--bg-highlight)' },
  maneuverName: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 },
  maneuverSource: {
    color: 'var(--text-dim)', fontSize: 10, background: 'var(--bg-surface)',
    padding: '1px 5px', borderRadius: 3,
  },
  maneuverDesc: { color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.4 },

  // Spell note
  spellNoteBox: {
    display: 'flex', alignItems: 'flex-start', gap: 4,
    background: 'var(--bg-card)', border: '1px solid var(--accent-purple)', borderRadius: 10,
    padding: '12px 16px', marginBottom: 20,
  },

  // Chip buttons (Favored Enemy etc)
  chipGrid: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: {
    padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13,
  },
  chipSelected: { border: '1px solid var(--accent)', color: 'var(--accent)', background: 'var(--bg-highlight)' },

  // Skills styles removed — skills now in Step7Proficiencies
}