// ItemEditor.jsx
//
// Strukturierter Homebrew-Item Editor mit MEHREREN Actions/Reactions/
// Passives pro Item. Speichert die Action-Daten als strukturiertes
// _hbActions-Array — die Engine in OverviewTab liest diese Felder
// DIREKT (kein Entries-Text-Parsing). Pills werden 1:1 aus den
// gespeicherten Feldern gebaut.
//
// Template-Loading: wenn ein 5etools-Item als Vorlage geladen wird,
// extrahiert parseTemplateActions() versuchsweise Actions aus dem
// entries-Text und befüllt die strukturierten Felder vor.

import { useState, useEffect } from 'react'
import EntryRenderer from '../../../character-builder/components/ui/EntryRenderer'
import GrantSpellPicker, { SpellPickerModal } from './GrantSpellPicker'
import { DAMAGE_TYPE_COLOR } from '../../../character-builder/lib/spellEffectParser'

const TYPE_OPTIONS = [
  { v: 'M',  l: 'M — Melee Weapon' },
  { v: 'R',  l: 'R — Ranged Weapon' },
  { v: 'LA', l: 'LA — Light Armor' },
  { v: 'MA', l: 'MA — Medium Armor' },
  { v: 'HA', l: 'HA — Heavy Armor' },
  { v: 'S',  l: 'S — Shield' },
  { v: 'G',  l: 'G — Gear / Tool' },
  { v: 'P',  l: 'P — Potion / Consumable' },
  { v: 'W',  l: 'W — Wondrous Item' },
  { v: 'RG', l: 'RG — Ring' },
  { v: 'RD', l: 'RD — Rod' },
  { v: 'WD', l: 'WD — Wand' },
  { v: 'SC', l: 'SC — Scroll' },
  { v: 'A',  l: 'A — Ammunition' },
]
const RARITY_OPTIONS = ['none', 'common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact']
const WEAPON_CAT = [
  { v: '',         l: '(none)' },
  { v: 'simple',   l: 'Simple' },
  { v: 'martial',  l: 'Martial' },
]
const DMG_TYPE_OPTIONS = [
  { v: '',   l: '(keiner)' },
  { v: 'B',  l: 'Bludgeoning' },
  { v: 'P',  l: 'Piercing' },
  { v: 'S',  l: 'Slashing' },
  { v: 'A',  l: 'Acid' },
  { v: 'C',  l: 'Cold' },
  { v: 'F',  l: 'Fire' },
  { v: 'O',  l: 'Force' },
  { v: 'L',  l: 'Lightning' },
  { v: 'N',  l: 'Necrotic' },
  { v: 'I',  l: 'Poison' },
  { v: 'Y',  l: 'Psychic' },
  { v: 'R',  l: 'Radiant' },
  { v: 'T',  l: 'Thunder' },
  { v: 'HE', l: 'Healing (heilt statt Schaden)' },
]
const ACTION_COSTS = [
  { v: 'action',         l: 'Action' },
  { v: 'bonus',          l: 'Bonus Action' },
  { v: 'reaction',       l: 'Reaction' },
  { v: 'attack-replace', l: 'Attack Replacement (1 deiner Attacks)' },
  { v: 'passive',        l: 'Passive (Trigger / On-Hit)' },
]
const REST_OPTS = [
  { v: 'none',  l: 'unbegrenzt' },
  { v: 'short', l: 'pro Short Rest' },
  { v: 'long',  l: 'pro Long Rest' },
  { v: 'dawn',  l: 'wieder bei Sonnenaufgang' },
  { v: 'day',   l: 'pro Day' },
]
const SAVE_ABILITIES = ['', 'str', 'dex', 'con', 'int', 'wis', 'cha']

// Weapon properties — 5etools short codes mit voller Label-Anzeige
const PROPERTY_OPTS = [
  { v: 'A',  l: 'Ammunition' },
  { v: 'F',  l: 'Finesse' },
  { v: 'H',  l: 'Heavy' },
  { v: 'L',  l: 'Light' },
  { v: 'LD', l: 'Loading' },
  { v: 'R',  l: 'Reach' },
  { v: 'S',  l: 'Special' },
  { v: 'T',  l: 'Thrown' },
  { v: '2H', l: 'Two-Handed' },
  { v: 'V',  l: 'Versatile' },
]

// 5.5e Mastery (XPHB) — Weapon-Mastery-Eigenschaften
const MASTERY_OPTS = [
  { v: 'Vex',    l: 'Vex' },
  { v: 'Sap',    l: 'Sap' },
  { v: 'Nick',   l: 'Nick' },
  { v: 'Topple', l: 'Topple' },
  { v: 'Push',   l: 'Push' },
  { v: 'Slow',   l: 'Slow' },
  { v: 'Graze',  l: 'Graze' },
  { v: 'Cleave', l: 'Cleave' },
]

// Passive-Grants Optionen — alles was ein homebrew-Item ZUSÄTZLICH
// zum Standard "+N AC/Weapon/Spell" gewähren kann sobald attuned +
// equipped. Wird in _hbPassiveGrants gespeichert.
const SKILL_LIST = [
  'acrobatics','animal handling','arcana','athletics','deception','history',
  'insight','intimidation','investigation','medicine','nature','perception',
  'performance','persuasion','religion','sleight of hand','stealth','survival',
]
const ABILITIES_GR = ['str','dex','con','int','wis','cha']
const DAMAGE_TYPES_GR = [
  'acid','bludgeoning','cold','fire','force','lightning','necrotic',
  'piercing','poison','psychic','radiant','slashing','thunder',
]
const CONDITION_LIST = [
  'blinded','charmed','deafened','exhaustion','frightened','grappled',
  'incapacitated','invisible','paralyzed','petrified','poisoned',
  'prone','restrained','stunned','unconscious',
]
const TOOL_LIST = [
  "thieves' tools","disguise kit","forgery kit","herbalism kit",
  "smith's tools","tinker's tools","cartographer's tools","cook's utensils",
  "alchemist's supplies","calligrapher's supplies",
]

// Magic-Bonus-Felder — werden vom rulesEngine direkt konsumiert sobald
// das Item attuned + equipped ist. Werte als String "+1" / "+2" / etc.
const MAGIC_BONUS_FIELDS = [
  { key: 'bonusAc',           label: 'AC',                 hint: 'Cloak of Protection +1, Bracers of Defense +2, …' },
  { key: 'bonusWeapon',       label: 'Attack + Damage',    hint: '+1 weapon: alle Attacks UND Damage' },
  { key: 'bonusWeaponAttack', label: 'nur Attack',         hint: 'nur Attack-Roll-Bonus (selten)' },
  { key: 'bonusWeaponDamage', label: 'nur Damage',         hint: 'nur Damage-Bonus (selten)' },
  { key: 'bonusSpellAttack',  label: 'Spell Attack',       hint: 'Rod of the Pact Keeper, Wand of the War Mage, …' },
  { key: 'bonusSpellSaveDc',  label: 'Spell Save DC',      hint: 'Robe of the Archmagi, Staff of Power, …' },
  { key: 'bonusSavingThrow',  label: 'Saves',              hint: 'Cloak of Protection: alle Saves' },
  { key: 'bonusAbilityCheck', label: 'Ability Checks',     hint: 'Stone of Good Luck +1, etc.' },
]

function newAction() {
  return {
    id: `a-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
    name: 'Aktivieren',
    // activations[] = Mehrfach-Aktivierungs-Logik. Beispiele:
    //   • [{cost:'action'}]                    → klassisch Action
    //   • [{cost:'action'},{cost:'bonus'}], or → Action ODER Bonus Action
    //                                            (Spieler wählt)
    //   • [{cost:'action'},{cost:'reaction'}], and → kostet beides gleichzeitig
    // 'cost' bleibt für Backward-Compat erhalten und wird beim Save
    // mit activations[0].cost synchronisiert.
    activations: [{ cost: 'action' }],
    activationMode: 'or',
    cost: 'action',
    description: '',
    damageDice: '',
    damageType: '',
    saveAbility: '',
    saveDc: '',           // string — kann Formel sein wie '8+PB+WIS' oder fixed '13'
    attackBonus: '',
    attackRoll: false,    // erzwingt Attack-Roll auch ohne Damage (Fey Dart-style)
    chargesMax: 0,        // number ODER Formel-string wie 'PB'
    chargesCost: 1,
    chargesRest: 'long',  // base reset (short/long/dawn/day/none)
    rechargeFormula: '',  // optional dice-formula z.B. '1d6+4' wenn Recharge geworfen wird
    critEffect: '',       // optionale Notiz für 'on crit'
    target: '',           // einzelnes Ziel — z.B. "1 creature within 30 ft"
    area: '',             // Flächen-Effekt — z.B. "10 ft Sphere", "Kegel 15 ft"
    // Spells die diese Action castet — Action-Tracker zeigt sie als
    // klickbare Pills mit Level/School-Info.
    spells: [],
  }
}

// Parsen einer existing item entries für Action-Extraktion (Template-Load).
// Geht durch BEIDE Layer: top-level strings UND nested object-entries
// (list-items, sub-entries-blocks). Splittet jeden String in Sätze
// und schaut PER SATZ ob ein Action-Slot triggert. Charges + Reset
// werden ITEM-WEIT zusammengezogen (sind oft in einem separaten Satz
// statt zusammen mit der Action-Klausel).
function parseTemplateActions(entries) {
  if (!Array.isArray(entries)) return []
  // 1. Alle string-Sätze aus den entries extrahieren (auch nested).
  const allStrings = []
  const walk = (n) => {
    if (typeof n === 'string') { allStrings.push(n); return }
    if (Array.isArray(n)) { for (const x of n) walk(x); return }
    if (n && typeof n === 'object') {
      if (Array.isArray(n.entries)) walk(n.entries)
      if (Array.isArray(n.items)) walk(n.items)
      if (n.name && Array.isArray(n.entries)) {
        // named sub-section — wir behalten den Namen als "Section-Hint"
        walk(n.entries)
      }
    }
  }
  walk(entries)
  if (allStrings.length === 0) return []

  // 2. Item-weite Charges-Info (oft in eigenem Satz wie "This wand has
  //    7 charges and regains 1d6 expended charges at dawn.")
  const flat = allStrings.join(' ').replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
  let itemChargesMax = 0
  let itemChargesRest = 'long'
  const chM = flat.match(/\b(?:has|with|hold(?:s|ing))\s+(\d+)\s+charges?/i)
                 || flat.match(/(\d+)\s+charges?\b/i)
  if (chM) itemChargesMax = parseInt(chM[1], 10) || 0
  if (/short or long rest/i.test(flat)) itemChargesRest = 'short'
  else if (/long rest/i.test(flat)) itemChargesRest = 'long'
  else if (/(?:at dawn|each (?:morning|day at dawn))/i.test(flat)) itemChargesRest = 'dawn'
  else if (/\b(?:per day|each day|daily)\b/i.test(flat)) itemChargesRest = 'day'

  // 3. Pro String/Satz: prüfen ob ein Action-Slot drinsteht.
  const out = []
  const DAMAGE_TYPE_MAP = { acid: 'A', bludgeoning: 'B', cold: 'C', fire: 'F', force: 'O', lightning: 'L', necrotic: 'N', piercing: 'P', poison: 'I', psychic: 'Y', radiant: 'R', slashing: 'S', thunder: 'T' }

  for (const rawStr of allStrings) {
    // Sätze splitten — Action-Klausel kann in der Mitte stehen
    const sentences = rawStr.split(/(?<=[.!?])\s+/).filter(Boolean)
    for (const sentence of sentences) {
      let cost = null
      if (/\b(?:use|take|spend|expend)\s+(?:an?\s+)?action\b/i.test(sentence) || /\bas an action\b/i.test(sentence)) cost = 'action'
      else if (/\b(?:use|take|spend|expend)\s+(?:a\s+)?bonus action\b/i.test(sentence) || /\bas a bonus action\b/i.test(sentence)) cost = 'bonus'
      else if (/\b(?:use|take|spend)\s+(?:a\s+|your\s+)?reaction\b/i.test(sentence) || /\bas a reaction\b/i.test(sentence)) cost = 'reaction'
      else if (/\bwhen you hit\b|\bon a hit\b|\bif you hit\b|\bwhen you damage\b/i.test(sentence)) cost = 'passive'
      if (!cost) continue

      const act = newAction()
      act.cost = cost
      // Plain-text Description (Tags resolven)
      act.description = sentence.replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1').trim()

      // Damage: erstmal {@damage} Tag, dann freitext "NdM <type> damage"
      const dmgTag = sentence.match(/\{@damage\s+([^|}]+)\}\s*([A-Za-z]+)?/i)
      const dmgPlain = sentence.match(/(\d+d\d+(?:\s*\+\s*\d+)?)\s*([A-Za-z]+)?\s+damage/i)
      const dmgM = dmgTag || dmgPlain
      if (dmgM) {
        act.damageDice = dmgM[1].trim().replace(/\s+/g, '')
        if (dmgM[2]) {
          const tLow = dmgM[2].toLowerCase()
          act.damageType = DAMAGE_TYPE_MAP[tLow] || dmgM[2][0].toUpperCase()
        }
      }

      // Save
      const saveM = sentence.match(/(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving\s+throw/i)
      if (saveM) act.saveAbility = saveM[1].slice(0, 3).toLowerCase()
      const dcM = sentence.match(/\bDC\s*(\d+)/i)
      if (dcM) act.saveDc = dcM[1]

      // Attack-Bonus (selten in items, aber manche magic weapons)
      const atkM = sentence.match(/([+-]\d+)\s+(?:bonus\s+)?(?:to\s+)?attack\s+roll/i)
      if (atkM) act.attackBonus = atkM[1]

      // Charges für diese Action: explicit oder vom item-weiten Pool
      const expM = sentence.match(/expend\s+(\d+)\s+(?:or more\s+)?(?:of\s+(?:its|the)\s+)?charges?/i)
      if (expM) act.chargesCost = parseInt(expM[1], 10) || 1
      if (itemChargesMax > 0) {
        act.chargesMax = itemChargesMax
        act.chargesRest = itemChargesRest
      }

      // Name extrahieren: erste paar Wörter ohne Prefix, oder Spell-Name
      const spellTagM = sentence.match(/\{@spell\s+([^|}]+)/i)
      if (spellTagM) {
        act.name = spellTagM[1].trim().replace(/\b\w/g, c => c.toUpperCase())
      } else {
        // Erstes "to X" / "to do Y" Pattern als Action-Name
        const verbM = sentence.match(/\bto\s+(cast|fire|cause|attack|invoke|summon|teleport|deal|create|conjure|use|command)\s+[^.,;]{0,40}/i)
        if (verbM) {
          act.name = verbM[0].replace(/^to\s+/i, '').slice(0, 40).replace(/^./, c => c.toUpperCase())
        } else {
          // Fallback: erstes Sub des Satzes nach Prefix
          let cleanName = sentence.replace(/^[^.,;]*?(?:as |you can use |use )?\b(?:an action|a bonus action|a reaction),?\s*/i, '')
          cleanName = cleanName.split(/[.!?,;]/)[0].slice(0, 50).trim()
          act.name = cleanName.charAt(0).toUpperCase() + cleanName.slice(1) || 'Aktion'
        }
      }
      if (act.name.length > 50) act.name = act.name.slice(0, 47) + '…'
      out.push(act)
    }
  }
  return out
}

// Migration: alte Actions hatten nur `cost`. Hier ergänzen wir
// `activations` + `activationMode` ohne `cost` zu entfernen
// (Backward-Compat für anderen Reader).
function migrateAction(a) {
  if (!a) return a
  const next = { ...a }
  if (!Array.isArray(next.activations) || next.activations.length === 0) {
    next.activations = [{ cost: next.cost || 'action' }]
  }
  if (!next.activationMode) next.activationMode = 'or'
  if (!next.cost && next.activations[0]?.cost) next.cost = next.activations[0].cost
  return next
}

function normalizeEntry(entry) {
  const initial = { ...(entry || {}) }
  if (!Array.isArray(initial._hbActions)) {
    initial._hbActions = parseTemplateActions(initial.entries)
  }
  initial._hbActions = (initial._hbActions || []).map(migrateAction)
  if (!Array.isArray(initial.property)) initial.property = []
  if (!Array.isArray(initial.mastery)) initial.mastery = []
  return initial
}

export default function ItemEditor({ entry, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => normalizeEntry(entry))
  useEffect(() => {
    setDraft(normalizeEntry(entry))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?._localMeta?.id, entry?.name])

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const setAction = (id, patch) => setDraft(d => ({
    ...d,
    _hbActions: (d._hbActions || []).map(a => a.id === id ? { ...a, ...patch } : a),
  }))
  const addAction = () => setDraft(d => ({ ...d, _hbActions: [...(d._hbActions || []), newAction()] }))
  const removeAction = (id) => setDraft(d => ({ ...d, _hbActions: (d._hbActions || []).filter(a => a.id !== id) }))
  // Dupliziert eine Action direkt unter dem Original — neue ID, Name +
  // " (Kopie)", alle übrigen Felder verbatim übernommen. Damit kann der
  // User mit einer Vorlage-Action mehrere Varianten anlegen ohne alles
  // neu zu tippen.
  const duplicateAction = (id) => setDraft(d => {
    const arr = d._hbActions || []
    const idx = arr.findIndex(a => a.id === id)
    if (idx < 0) return d
    const orig = arr[idx]
    const clone = {
      ...orig,
      id: `a-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
      name: (orig.name || 'Action') + ' (Kopie)',
    }
    const next = [...arr]
    next.splice(idx + 1, 0, clone)
    return { ...d, _hbActions: next }
  })
  const toggleList = (key, value) => setDraft(d => {
    const arr = d[key] || []
    const has = arr.includes(value)
    return { ...d, [key]: has ? arr.filter(x => x !== value) : [...arr, value] }
  })

  function commit() {
    const out = { ...draft }
    if (!out.weight) delete out.weight
    if (!out.value) delete out.value
    if (!out.ac) delete out.ac
    if (!out.dmg1) delete out.dmg1
    if (!out.dmgType) delete out.dmgType
    if (!out.weaponCategory) delete out.weaponCategory
    if (!out.property?.length) delete out.property
    if (!out.mastery?.length) delete out.mastery
    if (!out.reqAttune) delete out.reqAttune
    if (!out._hbActions?.length) delete out._hbActions
    if (!out._hbGrants?.length) delete out._hbGrants
    if (!out._hbSharedCharges) delete out._hbSharedCharges
    // _hbPassiveGrants: leere Felder wegputzen damit der gespeicherte
    // Eintrag klein bleibt und der Engine-Scan keinen no-op macht.
    if (out._hbPassiveGrants) {
      const g = { ...out._hbPassiveGrants }
      for (const k of Object.keys(g)) {
        const v = g[k]
        if (Array.isArray(v) && v.length === 0) delete g[k]
        else if (typeof v === 'object' && v && !Array.isArray(v)) {
          const sub = Object.fromEntries(Object.entries(v).filter(([, x]) => x))
          if (Object.keys(sub).length === 0) delete g[k]
          else g[k] = sub
        } else if (!v) delete g[k]
      }
      if (Object.keys(g).length === 0) delete out._hbPassiveGrants
      else out._hbPassiveGrants = g
    }
    if (!out.dmg2)     delete out.dmg2
    if (!out.range)    delete out.range
    if (!out.strength) delete out.strength
    if (!out.stealth)  delete out.stealth
    if (!out.wondrous) delete out.wondrous
    // Magic-Bonus-Felder: leere Strings raus, sonst rulesEngine
    // interpretiert "" als "+0" und das wäre ein no-op aber unsauber.
    for (const f of MAGIC_BONUS_FIELDS) {
      if (!out[f.key] || !String(out[f.key]).trim()) delete out[f.key]
    }
    // Sync entries-Feld aus den strukturierten Actions damit FeaturesTab
    // und alte Parser eine human-readable Beschreibung haben. _hbActions
    // bleibt aber Single Source of Truth für die Engine.
    const composed = []
    if (out.description) composed.push(out.description)
    for (const a of (out._hbActions || [])) {
      const lines = []
      const costPhrase = a.cost === 'action' ? 'As an action,'
        : a.cost === 'bonus' ? 'As a bonus action,'
        : a.cost === 'reaction' ? 'As a reaction,'
        : ''
      let body = a.description.trim()
      if (costPhrase && !body.toLowerCase().startsWith(costPhrase.toLowerCase())) {
        body = `${costPhrase} ${body.charAt(0).toLowerCase()}${body.slice(1)}`
      }
      if (a.damageDice) {
        const t = a.damageType ? ` ${a.damageType}` : ''
        if (!/damage/i.test(body)) body += ` dealing {@damage ${a.damageDice}}${t} damage`
      }
      if (a.saveAbility && a.saveDc) {
        body += `, requiring a DC ${a.saveDc} ${a.saveAbility.toUpperCase()} saving throw`
      }
      lines.push(body.trim().replace(/,\s*$/, '') + '.')
      if (a.chargesMax > 0) {
        const restPhrase = REST_OPTS.find(r => r.v === a.chargesRest)?.l || ''
        lines.push(`This action consumes ${a.chargesCost} charge${a.chargesCost > 1 ? 's' : ''} (${a.chargesMax} max, regains ${restPhrase}).`)
      }
      composed.push(lines.join(' '))
    }
    if (composed.length === 0 && out.description) composed.push(out.description)
    out.entries = composed.length > 0 ? composed : (out.entries || [])
    delete out.description
    onSave(out)
  }

  const isWeapon = ['M', 'R'].includes(draft.type)
  const isArmor  = ['LA', 'MA', 'HA', 'S'].includes(draft.type)

  return (
    <div style={ed.wrap}>
      {/* Name + Source */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <input value={draft.name || ''} onChange={e => set('name', e.target.value)}
          placeholder="Name" style={{ ...ed.input, flex: 1, fontSize: 16, fontWeight: 700 }} />
        <input value={draft.source || ''} onChange={e => set('source', e.target.value)}
          placeholder="Source" style={{ ...ed.input, width: 140 }} />
      </div>

      {/* Grundeigenschaften */}
      <Section title="Grundeigenschaften" icon="◆" accent="#7aa2f7">
        <div style={ed.grid}>
          <Field label="Typ">
            <select value={draft.type || ''} onChange={e => set('type', e.target.value)} style={ed.input}>
              {TYPE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </Field>
          <Field label="Rarity">
            <select value={draft.rarity || 'none'} onChange={e => set('rarity', e.target.value)} style={ed.input}>
              {RARITY_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Gewicht (lb)">
            <input type="number" step="0.1" value={draft.weight ?? ''} onChange={e => set('weight', e.target.value ? parseFloat(e.target.value) : null)} style={ed.input} />
          </Field>
          <Field label="Wert (Kupfer)">
            <input type="number" value={draft.value ?? ''} onChange={e => set('value', e.target.value ? parseInt(e.target.value, 10) : null)} style={ed.input} />
          </Field>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
          <label style={ed.checkRow}>
            <input type="checkbox" checked={!!draft.reqAttune}
              onChange={e => set('reqAttune', e.target.checked ? true : false)} />
            <span>verlangt Attunement</span>
          </label>
          <label style={ed.checkRow}>
            <input type="checkbox" checked={!!draft.wondrous}
              onChange={e => set('wondrous', e.target.checked)} />
            <span>Wondrous Item</span>
          </label>
          {draft.reqAttune && (
            <input value={typeof draft.reqAttune === 'string' ? draft.reqAttune : ''}
              onChange={e => set('reqAttune', e.target.value || true)}
              placeholder='Attunement-Bedingung (optional, z.B. "by a wizard")'
              style={{ ...ed.input, flex: 1, minWidth: 200 }} />
          )}
        </div>
      </Section>

      {/* Waffen-Stats (conditional) */}
      {isWeapon && (
        <Section title="Waffen-Stats" icon="⚔" accent="#f7768e"
          subtitle="Damage, Versatile, Range, Properties, Mastery">
          <div style={ed.grid}>
            <Field label="Damage">
              <input value={draft.dmg1 || ''} onChange={e => set('dmg1', e.target.value)}
                placeholder="1d8" style={ed.input} />
            </Field>
            <Field label="Damage-Type">
              <select value={draft.dmgType || ''} onChange={e => set('dmgType', e.target.value)} style={ed.input}>
                {DMG_TYPE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </Field>
            <Field label="Versatile Damage" hint="2-handed Damage, z.B. 1d10. Nur wenn Versatile-Property gesetzt.">
              <input value={draft.dmg2 || ''} onChange={e => set('dmg2', e.target.value)}
                placeholder="—" style={ed.input} />
            </Field>
            <Field label="Range" hint='5etools-Format z.B. "30/120" für Thrown/Ranged'>
              <input value={draft.range || ''} onChange={e => set('range', e.target.value)}
                placeholder="—" style={ed.input} />
            </Field>
            <Field label="Kategorie">
              <select value={draft.weaponCategory || ''} onChange={e => set('weaponCategory', e.target.value)} style={ed.input}>
                {WEAPON_CAT.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Properties" hint="5etools-Standard weapon properties">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {PROPERTY_OPTS.map(p => {
                const on = (draft.property || []).includes(p.v)
                return (
                  <button key={p.v} type="button" onClick={() => toggleList('property', p.v)}
                    style={on ? ed.chipOn : ed.chip} title={p.l}>{p.l}</button>
                )
              })}
            </div>
          </Field>
          <Field label="Weapon Mastery (5.5e)" hint='5.5e XPHB-Weapon-Mastery. Mehrere erlaubt — der Spieler wählt eine pro Long Rest aus.'>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {MASTERY_OPTS.map(m => {
                const on = (draft.mastery || []).includes(m.v)
                return (
                  <button key={m.v} type="button" onClick={() => toggleList('mastery', m.v)}
                    style={on ? ed.chipOn : ed.chip}>{m.l}</button>
                )
              })}
            </div>
          </Field>
        </Section>
      )}

      {/* Armor-Stats (conditional) */}
      {isArmor && (
        <Section title="Rüstungs-Stats" icon="🛡" accent="#4dd0e1"
          subtitle="AC, Stealth-Disadvantage, Strength-Requirement">
          <div style={ed.grid}>
            <Field label="AC">
              <input type="number" value={draft.ac ?? ''}
                onChange={e => set('ac', e.target.value ? parseInt(e.target.value, 10) : null)}
                style={ed.input} />
            </Field>
            <Field label="Stealth Disadvantage">
              <select value={draft.stealth ? 'true' : 'false'}
                onChange={e => set('stealth', e.target.value === 'true')} style={ed.input}>
                <option value="false">Nein</option>
                <option value="true">Ja</option>
              </select>
            </Field>
            <Field label="Strength Requirement" hint='5etools-Format "Str 13" / "Str 15"'>
              <input value={draft.strength || ''} onChange={e => set('strength', e.target.value)}
                placeholder="—" style={ed.input} />
            </Field>
          </div>
        </Section>
      )}

      {/* Passive Grants — proficiencies, init, speed, senses, resists */}
      <PassiveGrantsSection draft={draft} set={set} />

      {/* Magic-Boni (kollabiert default; nur sichtbar wenn benutzt) */}
      <MagicBonusSection draft={draft} set={set} />

      {/* Beschreibung */}
      <Section title="Beschreibung" icon="✎" accent="#9aa3b4">
        <textarea value={draft.description || ''} onChange={e => set('description', e.target.value)}
          rows={3} placeholder="Flavor-Text. Effekte gehören in die Aktionen-Sektion."
          style={{ ...ed.input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
      </Section>

      {/* Charges */}
      <Section title="Charges" icon="⚡" accent="#ff9533"
        subtitle={draft._hbSharedCharges
          ? 'Shared: alle Aktionen ziehen aus einem Pool.'
          : 'Individual: jede Aktion hat eigene Charges.'}>
        <div style={{ display: 'flex', gap: 4, marginBottom: draft._hbSharedCharges ? 10 : 0 }}>
          <button type="button"
            onClick={() => set('_hbSharedCharges', null)}
            style={!draft._hbSharedCharges ? ed.segOn : ed.seg}>Individual</button>
          <button type="button"
            onClick={() => set('_hbSharedCharges', draft._hbSharedCharges || { max: 'PB', rest: 'long', rechargeFormula: '' })}
            style={draft._hbSharedCharges ? ed.segOn : ed.seg}>Shared Pool</button>
        </div>
        {draft._hbSharedCharges && (
          <div style={ed.grid}>
            <Field label="Max" hint="Zahl oder Formel wie PB, WIS, 1d6+4">
              <input value={draft._hbSharedCharges.max ?? ''}
                onChange={e => set('_hbSharedCharges', { ...draft._hbSharedCharges, max: e.target.value })}
                placeholder="10 oder PB" style={ed.input} />
            </Field>
            <Field label="Reset">
              <select value={draft._hbSharedCharges.rest || 'long'}
                onChange={e => set('_hbSharedCharges', { ...draft._hbSharedCharges, rest: e.target.value })}
                style={ed.input}>
                {REST_OPTS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </Field>
            <Field label="Recharge-Roll" hint="Optional, z.B. 1d6+4">
              <input value={draft._hbSharedCharges.rechargeFormula || ''}
                onChange={e => set('_hbSharedCharges', { ...draft._hbSharedCharges, rechargeFormula: e.target.value })}
                placeholder="—" style={ed.input} />
            </Field>
          </div>
        )}
      </Section>

      {/* Aktionen */}
      <Section
        title={`Aktionen${draft._hbActions?.length ? ` · ${draft._hbActions.length}` : ''}`}
        icon="⚙"
        accent="#b07afe"
        subtitle="Im Sheet sichtbar wenn attuned + equipped."
        actions={<button type="button" onClick={addAction} style={ed.primaryMini}>+ Aktion</button>}
      >
        {(!draft._hbActions || draft._hbActions.length === 0) && (
          <div style={ed.empty}>Keine Aktionen. "+ Aktion" um eine hinzuzufügen.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(draft._hbActions || []).map(a => (
            <ActionBlock key={a.id} action={a}
              sharedPool={!!draft._hbSharedCharges}
              onChange={(patch) => setAction(a.id, patch)}
              onRemove={() => removeAction(a.id)}
              onDuplicate={() => duplicateAction(a.id)}
            />
          ))}
        </div>
      </Section>

      {/* Gewährte Spells */}
      <Section title="Gewährte Spells" icon="📖" accent="#4dd0e1"
        subtitle="Verfügbar wenn attuned + equipped.">
        <GrantSpellPicker
          grants={draft._hbGrants || []}
          onChange={(next) => set('_hbGrants', next)}
        />
      </Section>

      <div style={ed.footer}>
        <button type="button" onClick={onCancel} style={ed.cancelBtn}>Abbrechen</button>
        <button type="button" onClick={commit} style={ed.saveBtn}>Speichern</button>
      </div>
    </div>
  )
}

// ── Passive Grants Section: alles was das Item dem Spieler zusätzlich
//    gibt sobald attuned + equipped. Storage: item._hbPassiveGrants
function PassiveGrantsSection({ draft, set }) {
  const g = draft._hbPassiveGrants || {}
  const setG = (patch) => set('_hbPassiveGrants', { ...g, ...patch })
  const toggle = (key, value) => {
    const arr = g[key] || []
    const has = arr.includes(value)
    setG({ [key]: has ? arr.filter(x => x !== value) : [...arr, value] })
  }
  const hasAny = Object.keys(g).length > 0 && Object.values(g).some(v =>
    Array.isArray(v) ? v.length > 0 : (typeof v === 'object' ? Object.keys(v || {}).length > 0 : !!v)
  )
  const [open, setOpen] = useState(hasAny)
  const cnt = [
    g.skillProficiencies, g.skillExpertise, g.toolProficiencies, g.languages,
    g.savingThrows, g.damageResist, g.damageImmune, g.damageVulnerable,
    g.conditionImmune,
  ].filter(a => Array.isArray(a) && a.length > 0).length
    + (g.initBonus ? 1 : 0)
    + (g.hpBonus ? 1 : 0)
    + (g.speedBonus && Object.values(g.speedBonus).some(v => v > 0) ? 1 : 0)
    + (g.senses && Object.values(g.senses).some(v => v > 0) ? 1 : 0)

  return (
    <Section
      title={`Passive Grants${cnt ? ` · ${cnt}` : ''}`}
      icon="✨"
      accent="#b07afe"
      subtitle={cnt
        ? 'Aktive Grants — werden bei attuned + equipped automatisch angewendet'
        : 'Skill-/Tool-Profs, Init, Movement, Senses, Resistenzen, …'}
      actions={
        <button type="button" onClick={() => setOpen(o => !o)} style={ed.miniBtn}>
          {open ? 'Zuklappen' : 'Aufklappen'}
        </button>
      }
    >
      {open && (
        <>
          {/* Skill Proficiencies + Expertise */}
          <Field label="Skill Proficiencies" hint="Gewährt Proficiency in diesen Skills">
            <ChipMulti options={SKILL_LIST} selected={g.skillProficiencies || []}
              onToggle={v => toggle('skillProficiencies', v)} />
          </Field>
          <Field label="Skill Expertise" hint="Doppelter Prof-Bonus auf diese Skills (nur sinnvoll wenn Spieler Prof darin hat)">
            <ChipMulti options={SKILL_LIST} selected={g.skillExpertise || []}
              onToggle={v => toggle('skillExpertise', v)} />
          </Field>
          {/* Tool Profs */}
          <Field label="Tool Proficiencies">
            <ChipMulti options={TOOL_LIST} selected={g.toolProficiencies || []}
              onToggle={v => toggle('toolProficiencies', v)} />
          </Field>
          {/* Save Profs */}
          <Field label="Saving Throw Proficiencies">
            <ChipMulti options={ABILITIES_GR.map(a => ({ v: a, l: a.toUpperCase() }))}
              selected={g.savingThrows || []} onToggle={v => toggle('savingThrows', v)} />
          </Field>
          {/* Languages */}
          <Field label="Sprachen">
            <ChipMulti options={['Common','Dwarvish','Elvish','Giant','Gnomish','Goblin','Halfling','Orc','Abyssal','Celestial','Draconic','Deep Speech','Infernal','Primordial','Sylvan','Undercommon']}
              selected={g.languages || []} onToggle={v => toggle('languages', v)} />
          </Field>
          {/* Numeric Boni */}
          <div style={ed.grid}>
            <Field label="Initiative-Bonus" hint='+N oder Formel wie "PB"'>
              <input value={g.initBonus || ''} onChange={e => setG({ initBonus: e.target.value })}
                placeholder="—" style={ed.input} />
            </Field>
            <Field label="Max-HP-Bonus" hint="Zahl, addiert auf HP-Max">
              <input value={g.hpBonus || ''} onChange={e => setG({ hpBonus: e.target.value })}
                placeholder="—" style={ed.input} />
            </Field>
          </div>
          {/* Speed-Boni pro Modus */}
          <Field label="Speed-Bonus (ft)">
            <div style={{ ...ed.grid, gridTemplateColumns: 'repeat(5, 1fr)' }}>
              {['walk','fly','swim','climb','burrow'].map(m => (
                <Field key={m} label={m}>
                  <input type="number" value={g.speedBonus?.[m] || 0}
                    onChange={e => setG({ speedBonus: { ...(g.speedBonus || {}), [m]: parseInt(e.target.value, 10) || 0 } })}
                    style={{ ...ed.input, textAlign: 'center' }} />
                </Field>
              ))}
            </div>
          </Field>
          {/* Senses */}
          <Field label="Senses (ft)" hint="0 = nicht verändert">
            <div style={{ ...ed.grid, gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {['darkvision','blindsight','tremorsense','truesight'].map(s => (
                <Field key={s} label={s}>
                  <input type="number" value={g.senses?.[s] || 0}
                    onChange={e => setG({ senses: { ...(g.senses || {}), [s]: parseInt(e.target.value, 10) || 0 } })}
                    style={{ ...ed.input, textAlign: 'center' }} />
                </Field>
              ))}
            </div>
          </Field>
          {/* Resistances / Immunities */}
          <Field label="Damage Resistance">
            <DamageChips options={DAMAGE_TYPES_GR} selected={g.damageResist || []}
              onToggle={v => toggle('damageResist', v)} />
          </Field>
          <Field label="Damage Immunity">
            <DamageChips options={DAMAGE_TYPES_GR} selected={g.damageImmune || []}
              onToggle={v => toggle('damageImmune', v)} />
          </Field>
          <Field label="Damage Vulnerability">
            <DamageChips options={DAMAGE_TYPES_GR} selected={g.damageVulnerable || []}
              onToggle={v => toggle('damageVulnerable', v)} />
          </Field>
          <Field label="Condition Immunity">
            <ChipMulti options={CONDITION_LIST} selected={g.conditionImmune || []}
              onToggle={v => toggle('conditionImmune', v)} />
          </Field>
        </>
      )}
    </Section>
  )
}

// Inline-Chip-Multi (klein) — wiederverwendet im PassiveGrants
function ChipMulti({ options, selected, onToggle }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map(o => {
        const v = typeof o === 'string' ? o : o.v
        const l = typeof o === 'string' ? (o.charAt(0).toUpperCase() + o.slice(1)) : o.l
        const on = selected.includes(v)
        return (
          <button key={v} type="button" onClick={() => onToggle(v)}
            style={on ? ed.chipOn : ed.chip}>{l}</button>
        )
      })}
    </div>
  )
}

// Damage-Type-Chips — verwenden die globale DAMAGE_TYPE_COLOR-Palette
// damit Fire = orange, Cold = ice-blau, Radiant = gold, etc. visuell
// konsistent mit dem Rest des Sheets (Spell-Damage-Pills, Resistance-
// Anzeige etc.).
function DamageChips({ options, selected, onToggle }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map(t => {
        const on = selected.includes(t)
        const color = DAMAGE_TYPE_COLOR[t] || '#7aa2f7'
        const label = t.charAt(0).toUpperCase() + t.slice(1)
        return (
          <button key={t} type="button" onClick={() => onToggle(t)}
            style={on ? {
              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: `${color}33`,  // ~20% alpha als Hex-Suffix
              color, border: `1px solid ${color}`,
              cursor: 'pointer', fontFamily: 'inherit',
            } : {
              padding: '4px 10px', borderRadius: 6, fontSize: 11,
              background: 'transparent', color: '#9aa3b4',
              border: `1px solid ${color}55`,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ── Magic-Bonus Section: kollabierbar, default closed außer wenn
//    schon ein Wert gesetzt ist. Engine konsumiert die Bonus-Felder
//    automatisch sobald das Item attuned + equipped ist (rulesEngine).
function MagicBonusSection({ draft, set }) {
  const hasAny = MAGIC_BONUS_FIELDS.some(f => draft[f.key])
  const [open, setOpen] = useState(hasAny)
  const count = MAGIC_BONUS_FIELDS.filter(f => draft[f.key]).length
  return (
    <Section
      title={`Magic-Boni${count ? ` · ${count}` : ''}`}
      icon="✦"
      accent="#9ece6a"
      subtitle={count ? `${count} Bonus-Feld(er) gesetzt` : 'Optional: Cloak of Protection / +1 Weapon / Spell-Focus-Boni …'}
      actions={
        <button type="button" onClick={() => setOpen(o => !o)} style={ed.miniBtn}>
          {open ? 'Zuklappen' : 'Aufklappen'}
        </button>
      }
    >
      {open && (
        <div style={ed.grid}>
          {MAGIC_BONUS_FIELDS.map(f => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <input value={draft[f.key] || ''} onChange={e => set(f.key, e.target.value)}
                placeholder="—" style={ed.input} />
            </Field>
          ))}
        </div>
      )}
    </Section>
  )
}

// ── Section wrapper: konsistente Karten mit Accent-Stripe + Icon ──
function Section({ title, subtitle, icon, accent, actions, children }) {
  const color = accent || '#7aa2f7'
  return (
    <div style={{ ...ed.section, paddingLeft: 18 }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: color,
      }} />
      <div style={ed.sectionHead}>
        <div>
          <div style={{ ...ed.sectionTitle, color }}>
            {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
            <span>{title}</span>
          </div>
          {subtitle && <div style={ed.sectionSub}>{subtitle}</div>}
        </div>
        {actions && <div>{actions}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

function ActionBlock({ action: a, sharedPool, onChange, onRemove, onDuplicate }) {
  const [open, setOpen] = useState(false)
  const activations = Array.isArray(a.activations) && a.activations.length > 0
    ? a.activations
    : [{ cost: a.cost || 'action' }]
  const mode = a.activationMode || 'or'
  const costList = activations.map(act => act.cost).filter(Boolean)
  const costLabels = costList.map(c =>
    ACTION_COSTS.find(o => o.v === c)?.l.replace(' (1 deiner Attacks)', '') || c,
  )
  const joiner = mode === 'and' ? ' + ' : ' / '
  const sumBits = [costLabels.join(joiner) || 'Action']
  if (a.damageDice) sumBits.push(`${a.damageDice}${a.damageType ? ' ' + a.damageType : ''}`)
  if (a.saveAbility && a.saveDc) sumBits.push(`${a.saveAbility.toUpperCase()} ${a.saveDc}`)
  if (a.chargesCost) sumBits.push(`${a.chargesCost} ${a.chargesCost === 1 ? 'charge' : 'charges'}`)

  function toggleActivation(cost) {
    const has = costList.includes(cost)
    let next
    if (has) {
      // Mindestens EINE Aktivierung muss bleiben.
      if (costList.length === 1) return
      next = activations.filter(act => act.cost !== cost)
    } else {
      next = [...activations, { cost }]
    }
    onChange({
      activations: next,
      cost: next[0]?.cost || 'action',
    })
  }
  function setMode(newMode) {
    onChange({ activationMode: newMode })
  }

  return (
    <div style={ed.action}>
      <div style={ed.actionHead}>
        <button type="button" onClick={() => setOpen(o => !o)} style={ed.actionToggle}
          title={open ? 'Zuklappen' : 'Aufklappen'}>{open ? '▾' : '▸'}</button>
        <input value={a.name} onChange={e => onChange({ name: e.target.value })}
          placeholder="Action-Name" style={{ ...ed.input, flex: 1, fontWeight: 600 }} />
        <button type="button" onClick={onDuplicate} style={{ ...ed.iconBtn, color: '#9aa3b4' }}
          title="Duplizieren">⎘</button>
        <button type="button" onClick={onRemove} style={ed.iconBtn} title="Entfernen">×</button>
      </div>
      <div style={ed.actionCostRow}>
        <span style={{ fontSize: 10, color: '#6b7386', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Aktivierung:
        </span>
        {ACTION_COSTS.map(o => {
          const on = costList.includes(o.v)
          return (
            <button key={o.v} type="button" onClick={() => toggleActivation(o.v)}
              style={on ? ed.miniChipOn : ed.miniChip}
              title={o.l}>
              {o.l.replace(' (1 deiner Attacks)', '')}
            </button>
          )
        })}
        {costList.length > 1 && (
          <div style={ed.modeToggle}>
            <button type="button" onClick={() => setMode('or')}
              style={mode === 'or' ? ed.miniSegOn : ed.miniSeg}
              title="Spieler wählt EINE der Aktivierungen">ODER</button>
            <button type="button" onClick={() => setMode('and')}
              style={mode === 'and' ? ed.miniSegOn : ed.miniSeg}
              title="Alle Aktivierungs-Kosten gleichzeitig erforderlich">UND</button>
          </div>
        )}
      </div>
      {!open && (
        <div style={ed.actionSummary}>{sumBits.join(' · ')}</div>
      )}
      {open && (
        <div style={ed.actionBody}>
          <textarea value={a.description} onChange={e => onChange({ description: e.target.value })}
            rows={2} placeholder="Beschreibung was die Aktion macht"
            style={{ ...ed.input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
          <div style={ed.grid}>
            <Field label="Target" hint='Einzelziel — z.B. "1 creature within 30 ft", "1 willing creature"'>
              <input value={a.target || ''} onChange={e => onChange({ target: e.target.value })}
                placeholder="—" style={ed.input} />
            </Field>
            <Field label="Area" hint='Flächen-Effekt — z.B. "10 ft Sphere", "Kegel 15 ft", "Linie 30 ft × 5 ft"'>
              <input value={a.area || ''} onChange={e => onChange({ area: e.target.value })}
                placeholder="—" style={ed.input} />
            </Field>
          </div>
          <div style={ed.grid}>
            <Field label={a.damageType === 'HE' ? 'Healing' : 'Damage'} hint="Leer = kein Effekt. z.B. 3d6 oder 1d4+PB">
              <input value={a.damageDice} onChange={e => onChange({ damageDice: e.target.value })}
                placeholder="—" style={ed.input} />
            </Field>
            <Field label="Type">
              <select value={a.damageType} onChange={e => onChange({ damageType: e.target.value })} style={ed.input}>
                {DMG_TYPE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </Field>
            <Field label="Attack-Bonus" hint="Optional, z.B. +7 oder PB+DEX">
              <input value={a.attackBonus} onChange={e => onChange({ attackBonus: e.target.value })}
                placeholder="—" style={ed.input} />
            </Field>
          </div>
          <label style={ed.checkRow}>
            <input type="checkbox" checked={!!a.attackRoll}
              onChange={e => onChange({ attackRoll: e.target.checked })} />
            <span title="z.B. Fey Dart: Attack-Roll nötig, aber Treffer macht keinen Damage — wählt nur den Effekt aus">
              Attack-Roll erforderlich (auch ohne Damage)
            </span>
          </label>
          <div style={ed.grid}>
            <Field label="Save">
              <select value={a.saveAbility} onChange={e => onChange({ saveAbility: e.target.value })} style={ed.input}>
                {SAVE_ABILITIES.map(s => <option key={s} value={s}>{s ? s.toUpperCase() : '(kein Save)'}</option>)}
              </select>
            </Field>
            <Field label="Save-DC" hint="Zahl wie 15 ODER Formel wie 8+PB+WIS">
              <input value={a.saveDc} onChange={e => onChange({ saveDc: e.target.value })}
                placeholder="—" style={ed.input} />
            </Field>
            <Field label="Crit-Effekt" hint="Was passiert bei Crit. Erscheint als Pill auf dem Sheet.">
              <input value={a.critEffect || ''} onChange={e => onChange({ critEffect: e.target.value })}
                placeholder="—" style={ed.input} />
            </Field>
          </div>
          <ActionSpellsRow spells={a.spells || []}
            onChange={(next) => onChange({ spells: next })} />
          <div style={ed.grid}>
            {sharedPool ? (
              <Field label="Pool-Cost" hint="Wie viele Pool-Charges diese Aktion zieht">
                <input type="number" min="1" value={a.chargesCost}
                  onChange={e => onChange({ chargesCost: parseInt(e.target.value, 10) || 1 })}
                  style={ed.input} />
              </Field>
            ) : (
              <>
                <Field label="Charges max" hint="0 = unbegrenzt. Zahl oder Formel wie PB">
                  <input value={typeof a.chargesMax === 'number' ? (a.chargesMax || '') : (a.chargesMax || '')}
                    onChange={e => {
                      const v = e.target.value.trim()
                      if (v === '') onChange({ chargesMax: 0 })
                      else if (/^-?\d+$/.test(v)) onChange({ chargesMax: parseInt(v, 10) })
                      else onChange({ chargesMax: v })
                    }}
                    placeholder="—" style={ed.input} />
                </Field>
                {(a.chargesMax && a.chargesMax !== 0) && (
                  <>
                    <Field label="Cost / Use">
                      <input type="number" min="1" value={a.chargesCost}
                        onChange={e => onChange({ chargesCost: parseInt(e.target.value, 10) || 1 })}
                        style={ed.input} />
                    </Field>
                    <Field label="Reset">
                      <select value={a.chargesRest} onChange={e => onChange({ chargesRest: e.target.value })} style={ed.input}>
                        {REST_OPTS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                      </select>
                    </Field>
                    <Field label="Recharge-Roll" hint="Optional, z.B. 1d6+4">
                      <input value={a.rechargeFormula || ''} onChange={e => onChange({ rechargeFormula: e.target.value })}
                        placeholder="—" style={ed.input} />
                    </Field>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── ActionSpellsRow: kleine Spell-Verknüpfung mit Modal-Picker ───
// Erscheint pro Action. Spells werden im Sheet als klickbare Pills
// angezeigt (Engine zeigt Name + Level/School-Info).
function ActionSpellsRow({ spells, onChange }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const addSpell = (sp) => {
    if (!sp?.name) return
    if (spells.some(s => s.name.toLowerCase() === sp.name.toLowerCase())) return
    onChange([...spells, { name: sp.name, source: sp.source || '' }])
    setPickerOpen(false)
  }
  const removeSpell = (name) => onChange(spells.filter(s => s.name.toLowerCase() !== name.toLowerCase()))
  return (
    <div>
      <div style={{ ...ed.label, marginBottom: 6 }}>Spell-Verknüpfung
        <span style={ed.labelHint} title='Spells die diese Action casten lässt. Erscheinen im Action-Tracker als klickbare Pills mit Level/School-Info.'> ⓘ</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {spells.length === 0 && (
          <span style={{ fontSize: 11, color: '#6b7386', fontStyle: 'italic' }}>
            Keine Spells verknüpft.
          </span>
        )}
        {spells.map(s => (
          <button key={s.name} type="button" onClick={() => removeSpell(s.name)}
            style={ed.chipOn} title={`Entfernen: ${s.name}`}>
            {s.name} ×
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setPickerOpen(true)} style={ed.miniBtn}>
        + Spell verknüpfen
      </button>
      {pickerOpen && (
        <SpellPickerModal
          defaultEdition="5.5e"
          alreadyAdded={new Set(spells.map(s => s.name.toLowerCase()))}
          onPick={addSpell}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <div style={ed.label} title={hint || undefined}>
        {label}{hint && <span style={ed.labelHint}> ⓘ</span>}
      </div>
      {children}
    </div>
  )
}

const ed = {
  // Outer card — gradient surface
  wrap: {
    padding: 22, borderRadius: 14, marginBottom: 16,
    background: 'linear-gradient(180deg, #1b1f28 0%, #161922 100%)',
    border: '1px solid #2a3040',
    boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
  },
  // Section wrapper — subtle elevated card with colored left-rail
  section: {
    marginBottom: 14, padding: '14px 16px',
    background: '#171a21',
    border: '1px solid #252a35',
    borderRadius: 10,
    position: 'relative',
    overflow: 'hidden',
  },
  sectionHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13, fontWeight: 700,
    color: 'var(--accent, #7aa2f7)',
    letterSpacing: 0.3,
    display: 'flex', alignItems: 'center', gap: 6,
  },
  sectionSub: {
    fontSize: 11, color: '#9aa3b4',
    marginTop: 2, fontWeight: 400,
  },
  // Grid + labels
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 8 },
  label: {
    fontSize: 10, fontWeight: 700, color: '#9aa3b4',
    textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4,
    display: 'inline-flex', alignItems: 'center',
  },
  labelHint: { fontSize: 9, color: '#6b7386', marginLeft: 4, cursor: 'help' },
  input: {
    width: '100%', padding: '8px 10px', fontSize: 13,
    background: '#0f1115', color: '#e6e8ee',
    border: '1px solid #2a3040', borderRadius: 6,
    fontFamily: 'inherit', outline: 'none', transition: 'border-color 120ms',
  },
  checkRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 0', fontSize: 12, color: '#9aa3b4',
  },
  empty: {
    color: '#6b7386', fontSize: 12, padding: '12px 0',
    fontStyle: 'italic',
  },
  // Segmented control
  seg: {
    padding: '6px 14px', borderRadius: 6, fontSize: 12,
    background: 'transparent', color: '#9aa3b4',
    border: '1px solid #2a3040', cursor: 'pointer', fontFamily: 'inherit',
  },
  segOn: {
    padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
    background: 'linear-gradient(180deg, #7aa2f7 0%, #6890e6 100%)',
    color: '#0f1115', border: '1px solid #7aa2f7', cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 2px 6px rgba(122,162,247,0.3)',
  },
  // Action card
  action: {
    background: '#1d212a',
    border: '1px solid #2a3040', borderRadius: 8,
    overflow: 'hidden',
    transition: 'border-color 120ms',
  },
  actionHead: {
    display: 'flex', gap: 6, alignItems: 'center',
    padding: 8,
  },
  actionToggle: {
    width: 28, height: 28, padding: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: '#0f1115', color: '#9aa3b4',
    border: '1px solid #2a3040', borderRadius: 6,
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
  },
  actionSummary: {
    padding: '0 12px 8px 42px',
    fontSize: 11, color: '#6b7386',
  },
  actionCostRow: {
    padding: '4px 12px 8px 42px',
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
  },
  miniChip: {
    padding: '2px 8px', borderRadius: 4, fontSize: 10,
    background: 'transparent', color: '#9aa3b4',
    border: '1px solid #2a3040', cursor: 'pointer', fontFamily: 'inherit',
  },
  miniChipOn: {
    padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
    background: 'rgba(122, 162, 247, 0.22)',
    color: '#7aa2f7', border: '1px solid #7aa2f7',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  // Standard-Chip (Weapon-Properties, Skills, Languages, etc.)
  chip: {
    padding: '4px 10px', borderRadius: 6, fontSize: 11,
    background: 'transparent', color: '#9aa3b4',
    border: '1px solid #2a3040', cursor: 'pointer', fontFamily: 'inherit',
  },
  chipOn: {
    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
    background: 'rgba(122, 162, 247, 0.22)',
    color: '#7aa2f7', border: '1px solid #7aa2f7',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  modeToggle: {
    display: 'inline-flex', marginLeft: 6,
    borderRadius: 4, overflow: 'hidden',
    border: '1px solid #2a3040',
  },
  miniSeg: {
    padding: '2px 8px', fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
    background: 'transparent', color: '#9aa3b4',
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
  },
  miniSegOn: {
    padding: '2px 8px', fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
    background: 'linear-gradient(180deg, #ff9533 0%, #e6802b 100%)',
    color: '#0f1115', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
  },
  actionBody: {
    padding: '8px 12px 12px 12px',
    borderTop: '1px solid #252a35',
    background: 'linear-gradient(180deg, #1a1e26 0%, #1d212a 100%)',
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  iconBtn: {
    width: 28, height: 28, padding: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', color: '#f7768e',
    border: '1px solid #2a3040', borderRadius: 6,
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 16, lineHeight: 1,
  },
  // Buttons
  miniBtn: {
    padding: '5px 10px', borderRadius: 6, border: '1px solid #2a3040',
    background: '#1d212a', color: '#9aa3b4', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 12,
  },
  primaryMini: {
    padding: '5px 12px', borderRadius: 6,
    border: '1px solid #7aa2f7',
    background: 'linear-gradient(180deg, #7aa2f7 0%, #6890e6 100%)',
    color: '#0f1115', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 12, fontWeight: 700,
    boxShadow: '0 2px 6px rgba(122,162,247,0.25)',
  },
  // Footer
  footer: {
    display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18,
    paddingTop: 14, borderTop: '1px solid #252a35',
  },
  cancelBtn: {
    padding: '9px 18px', borderRadius: 8,
    border: '1px solid #2a3040', background: 'transparent',
    color: '#9aa3b4', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
  },
  saveBtn: {
    padding: '9px 22px', borderRadius: 8,
    border: 'none',
    background: 'linear-gradient(180deg, #9ece6a 0%, #82b04f 100%)',
    color: '#0f1115', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 13, fontWeight: 700,
    boxShadow: '0 3px 10px rgba(158,206,106,0.25)',
  },
}
