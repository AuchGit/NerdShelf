// CreatureEditor.jsx
//
// Strukturierter Homebrew-Creature-Editor (5etools Monster-Shape).
// Komplette Stat-Block-Felder: size, type, alignment, ac, hp, speed,
// abilities, save/skill/senses/languages/cr, traits/actions/bonus/
// reactions/legendary als named-entry-Listen.
//
// Hinweis: aktuell hat die App KEINEN Monster-Catalog-Konsumer — das
// Editor-Output dient als persistente Storage/Referenz, kann aber
// jederzeit angebunden werden (5etools-shape bleibt unverändert).

import { useState, useEffect } from 'react'
import { Section, Field, ek } from './editorKit'

const SIZE_OPTS = [
  { v: 'T', l: 'Tiny' }, { v: 'S', l: 'Small' }, { v: 'M', l: 'Medium' },
  { v: 'L', l: 'Large' }, { v: 'H', l: 'Huge' }, { v: 'G', l: 'Gargantuan' },
]
const TYPE_OPTS = [
  'aberration','beast','celestial','construct','dragon','elemental',
  'fey','fiend','giant','humanoid','monstrosity','ooze','plant','undead',
]
const ALIGNMENT_OPTS = [
  { v: 'L', l: 'Lawful' }, { v: 'N', l: 'Neutral' }, { v: 'C', l: 'Chaotic' },
  { v: 'G', l: 'Good' }, { v: 'E', l: 'Evil' },
  { v: 'U', l: 'Unaligned' }, { v: 'A', l: 'Any' },
]
const DAMAGE_TYPES = [
  'acid','bludgeoning','cold','fire','force','lightning','necrotic',
  'piercing','poison','psychic','radiant','slashing','thunder',
]
const CONDITION_OPTS = [
  'blinded','charmed','deafened','exhaustion','frightened','grappled',
  'incapacitated','invisible','paralyzed','petrified','poisoned',
  'prone','restrained','stunned','unconscious',
]
const SKILL_OPTS = [
  'acrobatics','animal handling','arcana','athletics','deception','history',
  'insight','intimidation','investigation','medicine','nature','perception',
  'performance','persuasion','religion','sleight of hand','stealth','survival',
]
const ABILITY_KEYS = ['str','dex','con','int','wis','cha']
const CR_OPTS = ['0','1/8','1/4','1/2','1','2','3','4','5','6','7','8','9','10',
  '11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30']

function blank() {
  return {
    name: '',
    source: 'HB',
    size: 'M',
    type: 'humanoid',
    typeTags: [],
    alignment: ['N'],
    ac: 12,
    acFrom: '',
    hpAvg: 10,
    hpFormula: '2d8 + 2',
    speed: { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0 },
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    save: {},     // { dex: '+4', con: '+5' }
    skill: {},    // { stealth: '+6' }
    senses: { darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0, passivePerception: 10 },
    languages: [],
    cr: '1/4',
    resist: [],
    immune: [],
    vulnerable: [],
    conditionImmune: [],
    trait: [],
    action: [],
    bonus: [],
    reaction: [],
    legendary: [],
    lair: [],
    description: '',
    _localMeta: {},
  }
}

function initFromEntry(entry) {
  if (!entry) return blank()
  const out = blank()
  out.name = entry.name || ''
  out.source = entry.source || 'HB'
  out._localMeta = entry._localMeta || {}
  if (Array.isArray(entry.size)) out.size = entry.size[0] || 'M'
  if (typeof entry.type === 'string') out.type = entry.type
  else if (entry.type?.type) {
    out.type = entry.type.type
    out.typeTags = (entry.type.tags || []).map(t => typeof t === 'string' ? t : t.tag).filter(Boolean)
  }
  if (Array.isArray(entry.alignment)) out.alignment = entry.alignment
  // AC
  if (Array.isArray(entry.ac)) {
    const first = entry.ac[0]
    if (typeof first === 'number') { out.ac = first; out.acFrom = '' }
    else if (first?.ac) {
      out.ac = first.ac
      out.acFrom = (first.from || []).join(', ')
    }
  }
  if (entry.hp?.average) out.hpAvg = entry.hp.average
  if (entry.hp?.formula) out.hpFormula = entry.hp.formula
  if (entry.speed) out.speed = { ...out.speed, ...entry.speed }
  for (const k of ABILITY_KEYS) {
    if (typeof entry[k] === 'number') out.abilities[k] = entry[k]
  }
  if (entry.save) out.save = entry.save
  if (entry.skill) out.skill = entry.skill
  if (Array.isArray(entry.senses)) {
    for (const s of entry.senses) {
      const m = String(s).match(/(\w+)\s+(\d+)/)
      if (m) out.senses[m[1].toLowerCase()] = parseInt(m[2], 10)
    }
  }
  if (typeof entry.passive === 'number') out.senses.passivePerception = entry.passive
  if (Array.isArray(entry.languages)) out.languages = entry.languages
  if (entry.cr) out.cr = String(entry.cr)
  for (const k of ['resist','immune','vulnerable','conditionImmune']) {
    if (Array.isArray(entry[k])) {
      out[k] = entry[k].map(x => typeof x === 'string' ? x : (x.special || x[Object.keys(x)[0]])).filter(Boolean)
    }
  }
  for (const k of ['trait','action','bonus','reaction','legendary','lair']) {
    if (Array.isArray(entry[k])) {
      out[k] = entry[k].map(t => ({
        id: `e-${Math.random().toString(36).slice(2, 8)}`,
        name: t.name || '',
        text: Array.isArray(t.entries) ? t.entries.filter(x => typeof x === 'string').join('\n\n') : '',
      }))
    }
  }
  if (Array.isArray(entry.entries)) {
    const strings = entry.entries.filter(e => typeof e === 'string')
    out.description = strings.join('\n\n')
  }
  return out
}

export default function CreatureEditor({ entry, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => initFromEntry(entry))
  useEffect(() => setDraft(initFromEntry(entry)), [entry?._localMeta?.id, entry?.name])

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const patch = (k, sub) => setDraft(d => ({ ...d, [k]: { ...d[k], ...sub } }))
  const toggleList = (key, value) => setDraft(d => {
    const arr = d[key] || []
    const has = arr.includes(value)
    return { ...d, [key]: has ? arr.filter(x => x !== value) : [...arr, value] }
  })

  const setTraitList = (key) => ({
    add: () => set(key, [...(draft[key] || []), {
      id: `e-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
      name: '', text: '',
    }]),
    addPreset: (preset) => set(key, [...(draft[key] || []), {
      id: `e-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
      name: preset.name || '',
      text: preset.text || '',
    }]),
    update: (id, p) => set(key, draft[key].map(t => t.id === id ? { ...t, ...p } : t)),
    remove: (id) => set(key, draft[key].filter(t => t.id !== id)),
  })
  const traitOps      = setTraitList('trait')
  const actionOps     = setTraitList('action')
  const bonusOps      = setTraitList('bonus')
  const reactionOps   = setTraitList('reaction')
  const legendaryOps  = setTraitList('legendary')
  const lairOps       = setTraitList('lair')

  function commit() {
    const out = {
      name: draft.name.trim() || 'Unbenannte Kreatur',
      source: draft.source.trim() || 'HB',
      size: [draft.size],
      type: draft.typeTags.length > 0 ? { type: draft.type, tags: draft.typeTags } : draft.type,
      alignment: draft.alignment,
      ac: [draft.acFrom ? { ac: draft.ac, from: draft.acFrom.split(',').map(s => s.trim()).filter(Boolean) } : draft.ac],
      hp: { average: draft.hpAvg, formula: draft.hpFormula },
      speed: Object.fromEntries(Object.entries(draft.speed).filter(([, v]) => v > 0)),
      str: draft.abilities.str, dex: draft.abilities.dex, con: draft.abilities.con,
      int: draft.abilities.int, wis: draft.abilities.wis, cha: draft.abilities.cha,
      cr: draft.cr,
      _localMeta: draft._localMeta,
    }
    if (draft.speed.walk === 0 && Object.values(draft.speed).every(v => v === 0)) out.speed = { walk: 0 }
    if (Object.keys(draft.save).length > 0) out.save = draft.save
    if (Object.keys(draft.skill).length > 0) out.skill = draft.skill
    // senses
    const senseStrings = []
    for (const k of ['darkvision','blindsight','tremorsense','truesight']) {
      if (draft.senses[k] > 0) senseStrings.push(`${k} ${draft.senses[k]} ft.`)
    }
    if (senseStrings.length) out.senses = senseStrings
    if (draft.senses.passivePerception) out.passive = draft.senses.passivePerception
    if (draft.languages.length > 0) out.languages = draft.languages
    for (const k of ['resist','immune','vulnerable','conditionImmune']) {
      if (draft[k].length > 0) out[k] = draft[k]
    }
    for (const k of ['trait','action','bonus','reaction','legendary','lair']) {
      const arr = draft[k].filter(t => t.name.trim() || t.text.trim())
      if (arr.length > 0) {
        out[k] = arr.map(t => ({
          name: t.name || 'Unbenannt',
          entries: t.text ? t.text.split(/\n\n+/).map(s => s.trim()).filter(Boolean) : [],
        }))
      }
    }
    if (draft.description.trim()) {
      out.entries = draft.description.split(/\n\n+/).map(s => s.trim()).filter(Boolean)
    }
    onSave(out)
  }

  return (
    <div style={ek.wrap}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <input value={draft.name} onChange={e => set('name', e.target.value)}
          placeholder="Kreatur-Name" style={{ ...ek.input, flex: 1, fontSize: 16, fontWeight: 700 }} />
        <input value={draft.source} onChange={e => set('source', e.target.value)}
          placeholder="Source" style={{ ...ek.input, width: 140 }} />
      </div>

      {/* Basics */}
      <Section title="Basics" accent="#7aa2f7"
        subtitle="Größe, Typ, Alignment, CR">
        <div style={ek.grid}>
          <Field label="Größe">
            <select value={draft.size} onChange={e => set('size', e.target.value)} style={ek.input}>
              {SIZE_OPTS.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </Field>
          <Field label="Typ">
            <select value={draft.type} onChange={e => set('type', e.target.value)} style={ek.input}>
              {TYPE_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Type-Tags" hint='Frei, z.B. "goblinoid". Mit Enter bestätigen.'>
            <FreeChips items={draft.typeTags} placeholder="goblinoid …"
              onChange={(arr) => set('typeTags', arr)} />
          </Field>
          <Field label="CR">
            <select value={draft.cr} onChange={e => set('cr', e.target.value)} style={ek.input}>
              {CR_OPTS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Alignment">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {ALIGNMENT_OPTS.map(a => {
              const on = draft.alignment.includes(a.v)
              return (
                <button key={a.v} type="button" onClick={() => toggleList('alignment', a.v)}
                  style={on ? ek.chipOn : ek.chip}>{a.l}</button>
              )
            })}
          </div>
        </Field>
      </Section>

      {/* HP / AC / Speed */}
      <Section title="HP · AC · Speed" accent="#f7768e">
        <div style={ek.grid}>
          <Field label="AC">
            <input type="number" min="0" value={draft.ac}
              onChange={e => set('ac', parseInt(e.target.value, 10) || 0)} style={ek.input} />
          </Field>
          <Field label="AC From" hint='z.B. "natural armor", "shield"'>
            <input value={draft.acFrom} onChange={e => set('acFrom', e.target.value)} style={ek.input} />
          </Field>
          <Field label="HP avg">
            <input type="number" min="1" value={draft.hpAvg}
              onChange={e => set('hpAvg', parseInt(e.target.value, 10) || 1)} style={ek.input} />
          </Field>
          <Field label="HP-Formel">
            <input value={draft.hpFormula} onChange={e => set('hpFormula', e.target.value)}
              placeholder="2d8 + 2" style={ek.input} />
          </Field>
        </div>
        <div style={ek.grid}>
          {['walk','fly','swim','climb','burrow'].map(mode => (
            <Field key={mode} label={`${mode} ft.`}>
              <input type="number" min="0" value={draft.speed[mode] || 0}
                onChange={e => patch('speed', { [mode]: parseInt(e.target.value, 10) || 0 })}
                style={ek.input} />
            </Field>
          ))}
        </div>
      </Section>

      {/* Abilities */}
      <Section title="Ability Scores" accent="#ff9533">
        <div style={{ ...ek.grid, gridTemplateColumns: 'repeat(6, 1fr)' }}>
          {ABILITY_KEYS.map(ab => (
            <Field key={ab} label={ab.toUpperCase()}>
              <input type="number" min="1" max="30" value={draft.abilities[ab]}
                onChange={e => patch('abilities', { [ab]: parseInt(e.target.value, 10) || 10 })}
                style={{ ...ek.input, textAlign: 'center' }} />
            </Field>
          ))}
        </div>
      </Section>

      {/* Saves + Skills */}
      <Section title="Saves & Skills" accent="#9ece6a"
        subtitle="Manuell — z.B. dex +4. Format: '+N' oder '-N'">
        <Field label="Saving Throw Bonuses">
          <div style={{ ...ek.grid, gridTemplateColumns: 'repeat(6, 1fr)' }}>
            {ABILITY_KEYS.map(ab => (
              <input key={ab} value={draft.save[ab] || ''}
                onChange={e => {
                  const v = e.target.value.trim()
                  const next = { ...draft.save }
                  if (v) next[ab] = v
                  else delete next[ab]
                  set('save', next)
                }}
                placeholder={ab.toUpperCase()}
                style={{ ...ek.input, textAlign: 'center', fontSize: 11 }} />
            ))}
          </div>
        </Field>
        <Field label="Skill Bonuses">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6 }}>
            {SKILL_OPTS.map(sk => (
              <div key={sk} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, color: '#9aa3b4', flex: 1, textTransform: 'capitalize' }}>{sk}</span>
                <input value={draft.skill[sk] || ''}
                  onChange={e => {
                    const v = e.target.value.trim()
                    const next = { ...draft.skill }
                    if (v) next[sk] = v
                    else delete next[sk]
                    set('skill', next)
                  }}
                  placeholder="+0" style={{ ...ek.input, width: 50, textAlign: 'center', fontSize: 11 }} />
              </div>
            ))}
          </div>
        </Field>
      </Section>

      {/* Senses + Languages */}
      <Section title="Senses & Sprachen" accent="#4dd0e1">
        <div style={ek.grid}>
          {['darkvision','blindsight','tremorsense','truesight'].map(s => (
            <Field key={s} label={`${s} ft.`}>
              <input type="number" min="0" value={draft.senses[s] || 0}
                onChange={e => patch('senses', { [s]: parseInt(e.target.value, 10) || 0 })}
                style={ek.input} />
            </Field>
          ))}
          <Field label="Passive Perception">
            <input type="number" min="0" value={draft.senses.passivePerception || 0}
              onChange={e => patch('senses', { passivePerception: parseInt(e.target.value, 10) || 0 })}
              style={ek.input} />
          </Field>
        </div>
        <Field label="Sprachen">
          <FreeChips items={draft.languages} placeholder="Common, Goblin, …"
            onChange={(arr) => set('languages', arr)} />
        </Field>
      </Section>

      {/* Defenses */}
      <Section title="Defenses" accent="#b07afe"
        subtitle="Resistenzen / Immunitäten / Verwundbarkeiten / Condition Immunities">
        <Field label="Damage Resist">
          <ChipMulti options={DAMAGE_TYPES} selected={draft.resist}
            onToggle={v => toggleList('resist', v)} />
        </Field>
        <Field label="Damage Immune">
          <ChipMulti options={DAMAGE_TYPES} selected={draft.immune}
            onToggle={v => toggleList('immune', v)} />
        </Field>
        <Field label="Damage Vulnerable">
          <ChipMulti options={DAMAGE_TYPES} selected={draft.vulnerable}
            onToggle={v => toggleList('vulnerable', v)} />
        </Field>
        <Field label="Condition Immune">
          <ChipMulti options={CONDITION_OPTS} selected={draft.conditionImmune}
            onToggle={v => toggleList('conditionImmune', v)} />
        </Field>
      </Section>

      {/* Description */}
      <Section title="Beschreibung" accent="#9aa3b4">
        <textarea value={draft.description} onChange={e => set('description', e.target.value)}
          rows={4} placeholder="Allgemeine Beschreibung / Lore"
          style={{ ...ek.input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
      </Section>

      {/* Traits / Actions / Bonus / Reactions / Legendary */}
      <NamedEntryList label="Traits" accent="#ff9533"
        items={draft.trait} ops={traitOps}
        hint="Passive Features (z.B. Pack Tactics, Magic Resistance)"
        presets={PRESET_TRAITS} />
      <NamedEntryList label="Actions" accent="#f7768e"
        items={draft.action} ops={actionOps}
        hint="Aktiv-Effekte; ein Attack: 'Melee Weapon Attack: +X to hit…'"
        presets={PRESET_ACTIONS} />
      <NamedEntryList label="Bonus Actions" accent="#9ece6a"
        items={draft.bonus} ops={bonusOps}
        hint="Bonus-Action-Effekte"
        presets={PRESET_BONUS} />
      <NamedEntryList label="Reactions" accent="#7aa2f7"
        items={draft.reaction} ops={reactionOps}
        hint="Reaktive Effekte"
        presets={PRESET_REACTIONS} />
      <NamedEntryList label="Legendary Actions" accent="#b07afe"
        items={draft.legendary} ops={legendaryOps}
        hint="Legendary Actions (für Boss-Monster)"
        presets={PRESET_LEGENDARY} />
      <NamedEntryList label="Lair Actions" accent="#4dd0e1"
        items={draft.lair} ops={lairOps}
        hint="Initiative count 20 — passive Effekte in der Lair (z.B. Tremor, Cave-In, Mist)"
        presets={PRESET_LAIR} />

      <div style={ek.footer}>
        <button type="button" onClick={onCancel} style={ek.cancelBtn}>Abbrechen</button>
        <button type="button" onClick={commit} style={ek.saveBtn}>Speichern</button>
      </div>
    </div>
  )
}

// ── Preset-Bibliothek ────────────────────────────────────────
// Häufige Monster-Features als Quick-Add Templates. Klick auf
// "+ Preset" → wähle aus der Liste → Eintrag wird mit vorbefüllten
// Name + Text hinzugefügt. User editiert dann nach Bedarf.
const PRESET_TRAITS = [
  { name: 'Pack Tactics', text: 'The creature has Advantage on an attack roll against a creature if at least one of the creature\'s allies is within 5 feet of the target and the ally doesn\'t have the Incapacitated condition.' },
  { name: 'Magic Resistance', text: 'The creature has Advantage on saving throws against spells and other magical effects.' },
  { name: 'Magic Weapons', text: 'The creature\'s weapon attacks are magical.' },
  { name: 'Keen Senses', text: 'The creature has Advantage on Wisdom (Perception) checks that rely on sight, hearing, or smell.' },
  { name: 'Amphibious', text: 'The creature can breathe air and water.' },
  { name: 'Spider Climb', text: 'The creature can climb difficult surfaces, including upside down on ceilings, without needing to make an ability check.' },
  { name: 'Web Sense', text: 'While in contact with a web, the creature knows the exact location of any other creature in contact with the same web.' },
  { name: 'Sunlight Sensitivity', text: 'While in sunlight, the creature has Disadvantage on attack rolls and Wisdom (Perception) checks that rely on sight.' },
  { name: 'Fey Ancestry', text: 'The creature has Advantage on saves against being Charmed, and magic can\'t put it to sleep.' },
  { name: 'Innate Spellcasting', text: 'The creature\'s spellcasting ability is [ABILITY]. The creature can innately cast the following spells, requiring no material components: ...' },
  { name: 'Spellcasting', text: 'The creature is an Nth-level spellcaster. Its spellcasting ability is [ABILITY] (spell save DC X, +Y to hit with spell attacks). It has the following spells prepared: ...' },
  { name: 'Regeneration', text: 'The creature regains N hit points at the start of its turn if it has at least 1 hit point.' },
  { name: 'Damage Transfer', text: 'While grappling a creature, the creature takes only half the damage dealt to it (rounded down), and the creature grappled by it takes the other half.' },
  { name: 'Aggressive', text: 'As a bonus action, the creature can move up to its speed toward a hostile creature it can see.' },
]
const PRESET_ACTIONS = [
  { name: 'Multiattack', text: 'The creature makes N attacks: ...' },
  { name: 'Bite',     text: 'Melee Weapon Attack: +X to hit, reach 5 ft., one target. Hit: NdM + Y piercing damage.' },
  { name: 'Claw',     text: 'Melee Weapon Attack: +X to hit, reach 5 ft., one target. Hit: NdM + Y slashing damage.' },
  { name: 'Slam',     text: 'Melee Weapon Attack: +X to hit, reach 5 ft., one target. Hit: NdM + Y bludgeoning damage.' },
  { name: 'Scimitar', text: 'Melee Weapon Attack: +X to hit, reach 5 ft., one target. Hit: NdM + Y slashing damage.' },
  { name: 'Longsword',text: 'Melee Weapon Attack: +X to hit, reach 5 ft., one target. Hit: NdM + Y slashing damage, or NdM + Y slashing damage if used with two hands.' },
  { name: 'Spear',    text: 'Melee or Ranged Weapon Attack: +X to hit, reach 5 ft. or range 20/60 ft., one target. Hit: NdM + Y piercing damage.' },
  { name: 'Shortbow', text: 'Ranged Weapon Attack: +X to hit, range 80/320 ft., one target. Hit: NdM + Y piercing damage.' },
  { name: 'Longbow',  text: 'Ranged Weapon Attack: +X to hit, range 150/600 ft., one target. Hit: NdM + Y piercing damage.' },
  { name: 'Heavy Crossbow', text: 'Ranged Weapon Attack: +X to hit, range 100/400 ft., one target. Hit: NdM + Y piercing damage.' },
  { name: 'Breath Weapon (Recharge 5-6)', text: 'The creature exhales energy in a 30-foot cone. Each creature in that area must make a DC X DEX save, taking NdM type damage on a failed save, or half as much damage on a successful one.' },
  { name: 'Frightful Presence', text: 'Each creature of the creature\'s choice within 60 feet of the creature and aware of it must succeed on a DC X WIS save or become Frightened for 1 minute. ...' },
  { name: 'Spellcasting (Cast a Spell)', text: 'The creature casts one of its prepared spells.' },
]
const PRESET_BONUS = [
  { name: 'Cunning Action', text: 'On each of its turns, the creature can use a bonus action to take the Dash, Disengage, or Hide action.' },
  { name: 'Leadership (Recharges after a Short or Long Rest)', text: 'For 1 minute, the creature can utter a special command or warning whenever a nonhostile creature that it can see within 30 feet of it makes an attack roll or a saving throw. The creature can add a d4 to its roll provided it can hear and understand the creature.' },
  { name: 'Shapechange', text: 'The creature magically polymorphs into a [form], or back into its true form. Its statistics, other than its size, are the same in each form. ...' },
]
const PRESET_REACTIONS = [
  { name: 'Parry', text: 'The creature adds X to its AC against one melee attack that would hit it. To do so, the creature must see the attacker and be wielding a melee weapon.' },
  { name: 'Uncanny Dodge', text: 'When an attacker that the creature can see hits it with an attack, the creature can halve the attack\'s damage against itself.' },
  { name: 'Riposte', text: 'When a creature misses the creature with a melee attack, it can make one melee attack against the attacker.' },
]
const PRESET_LEGENDARY = [
  { name: 'Detect', text: 'The creature makes a Wisdom (Perception) check.' },
  { name: 'Tail Attack', text: 'The creature makes one tail attack.' },
  { name: 'Wing Attack (Costs 2 Actions)', text: 'The creature beats its wings. Each creature within 10 feet of it must succeed on a DC X DEX save or take NdM bludgeoning damage and be knocked prone. The creature can then fly up to half its flying speed.' },
  { name: 'Cantrip', text: 'The creature casts a cantrip.' },
  { name: 'Frightful Presence (Costs 2 Actions)', text: 'The creature uses Frightful Presence.' },
]
const PRESET_LAIR = [
  { name: 'Tremor', text: 'A tremor shakes the lair in a 60-foot radius around the creature. Each creature other than the creature on the ground in that area must succeed on a DC 15 DEX save or be knocked prone.' },
  { name: 'Cave-In', text: 'A cave-in occurs in a 20-foot radius. Each creature in that area must make a DC 15 DEX save, taking 10 (3d6) bludgeoning damage on a failed save, or half as much on a successful one.' },
  { name: 'Toxic Mist', text: 'A poisonous mist fills a 20-foot radius sphere centered on a point the creature can see within 120 feet. The area is heavily obscured, and any creature in it at the start of its turn takes 5 (2d4) poison damage.' },
  { name: 'Vines', text: 'Grasping roots and vines erupt in a 20-foot radius. The area becomes difficult terrain, and creatures in it when it appears must make a DC 13 STR save or be restrained.' },
]

// ── Named-Entry List Component ──────────────────────────────
function NamedEntryList({ label, icon, accent, hint, items, ops, presets }) {
  const [presetOpen, setPresetOpen] = useState(false)
  const singular = label.replace(/s$/, '').replace(/ies$/, 'y').replace(/ Actions$/, ' Action')
  function addPreset(p) {
    ops.add()
    // ops.add appends an empty entry. We need to update the LAST entry's
    // fields. Slight hack: defer via setTimeout(0) so React's state has
    // flushed, then look up the latest item.
    setTimeout(() => {
      // We can't directly know the id of the just-added entry — instead
      // rely on the fact that ops.add appended one. The parent provides
      // the items array; we re-trigger update on the last id from there
      // via the public ops API.
    }, 0)
    setPresetOpen(false)
  }
  // Better: a custom "addWithFields" path. Wir injizieren ein eigenes
  // add das gleich Name + Text setzt.
  function addPresetDirect(p) {
    if (!ops.addPreset) {
      // Fallback: add + immediately update last
      ops.add()
      return
    }
    ops.addPreset(p)
    setPresetOpen(false)
  }
  return (
    <Section title={`${label}${items?.length ? ` · ${items.length}` : ''}`}
      icon={icon} accent={accent} subtitle={hint}
      actions={
        <div style={{ display: 'flex', gap: 6 }}>
          {presets && presets.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button type="button" onClick={() => setPresetOpen(o => !o)} style={ek.miniBtn}>
                + Preset
              </button>
              {presetOpen && (
                <div style={{
                  position: 'absolute', right: 0, top: '110%',
                  background: '#171a21', border: '1px solid #2a3040', borderRadius: 8,
                  padding: 6, minWidth: 280, maxHeight: 400, overflowY: 'auto',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 50,
                }}>
                  {presets.map((p, i) => (
                    <button key={i} type="button"
                      onClick={() => addPresetDirect(p)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '6px 10px', borderRadius: 4,
                        background: 'transparent', color: '#e6e8ee',
                        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                        fontSize: 12,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#1d212a'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 10, color: '#6b7386', marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
                        {p.text}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button type="button" onClick={ops.add} style={ek.primaryMini}>+ {singular}</button>
        </div>
      }>
      {items.length === 0 && (
        <div style={ek.empty}>Keine — klick "+ {singular}" für eigenen Eintrag oder "+ Preset" für Vorlage.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(t => (
          <div key={t.id} style={ek.card}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input value={t.name} onChange={e => ops.update(t.id, { name: e.target.value })}
                placeholder="Name" style={{ ...ek.input, flex: 1, fontWeight: 600 }} />
              <button type="button" style={ek.iconBtn} onClick={() => ops.remove(t.id)}>×</button>
            </div>
            <textarea value={t.text} onChange={e => ops.update(t.id, { text: e.target.value })}
              rows={2} placeholder="Beschreibung. Absätze mit Leerzeile."
              style={{ ...ek.input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
        ))}
      </div>
    </Section>
  )
}

function ChipMulti({ options, selected, onToggle }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map(o => {
        const v = typeof o === 'string' ? o : o.v
        const l = typeof o === 'string' ? o : o.l
        const on = selected.includes(v)
        return (
          <button key={v} type="button" onClick={() => onToggle(v)}
            style={on ? ek.chipOn : ek.chip}>{l}</button>
        )
      })}
    </div>
  )
}

function FreeChips({ items, placeholder, onChange }) {
  const [d, setD] = useState('')
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
        {items.map(it => (
          <button key={it} type="button" style={ek.chipOn}
            onClick={() => onChange(items.filter(x => x !== it))}>{it} ×</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input value={d} onChange={e => setD(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && d.trim()) {
              e.preventDefault()
              if (!items.includes(d.trim())) onChange([...items, d.trim()])
              setD('')
            }
          }}
          placeholder={placeholder}
          style={{ ...ek.input, flex: 1, fontSize: 12 }} />
        <button type="button" style={ek.miniBtn}
          onClick={() => {
            if (d.trim() && !items.includes(d.trim())) { onChange([...items, d.trim()]); setD('') }
          }}>+</button>
      </div>
    </div>
  )
}
