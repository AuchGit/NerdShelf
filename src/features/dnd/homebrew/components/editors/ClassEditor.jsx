// ClassEditor.jsx
//
// Strukturierter Editor für eine Homebrew-KLASSE. Das Ergebnis wird von
// loadClassList / loadClassData in die Shapes übersetzt, die der Rest der
// App erwartet — eine Homebrew-Klasse taucht damit überall auf, wo auch
// offizielle stehen: Klassenwahl bei der Erstellung, Multiclass, Level-Up,
// Sheet-Hydration (Features werden aktiv) und Foundry-Export.
//
// Bewusst NICHT abgedeckt (wäre eine eigene Baustelle): Level-Tabellen mit
// eigenen Ressourcen (classTableGroups) und optionalfeatureProgression
// (Invocations-artige Auswahlmenüs). Beides bleibt über den JSON-Editor
// erreichbar und wird beim Speichern unverändert durchgereicht.

import { useMemo, useState } from 'react'
import { Section, Field, ek } from './editorKit'
import EntryRenderer from '../../../character-builder/components/ui/EntryRenderer'
import { blankHomebrewClass } from '../../lib/homebrewClass'
import SpellListLink from './SpellListLink'

const ABILITIES = [
  { v: 'str', l: 'STR' }, { v: 'dex', l: 'DEX' }, { v: 'con', l: 'CON' },
  { v: 'int', l: 'INT' }, { v: 'wis', l: 'WIS' }, { v: 'cha', l: 'CHA' },
]
const HIT_DICE = [6, 8, 10, 12]
const CASTER_PROGS = [
  { v: '', l: 'Kein Zauberwirker' },
  { v: 'full', l: 'Voll (Wizard, Cleric …)' },
  { v: 'half', l: 'Halb (Paladin, Ranger)' },
  { v: '1/3', l: 'Drittel (Eldritch Knight)' },
  { v: 'artificer', l: 'Artificer (aufgerundet)' },
  { v: 'pact', l: 'Pact Magic (Warlock)' },
]
const SKILLS = [
  'acrobatics', 'animal handling', 'arcana', 'athletics', 'deception', 'history',
  'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception',
  'performance', 'persuasion', 'religion', 'sleight of hand', 'stealth', 'survival',
]
const ARMOR = ['light', 'medium', 'heavy', 'shield']
const WEAPONS = ['simple', 'martial']

const FEATURE_HINT = 'Regeltext. Formulierungen wie "as a bonus action" oder '
  + '"a number of times equal to your proficiency bonus" erkennt das Sheet automatisch.'

// entries[] <-> Textarea (Absatz = Eintrag)
const toText = (entries) => (entries || [])
  .map(e => (typeof e === 'string' ? e : JSON.stringify(e, null, 2))).join('\n\n')
const fromText = (txt) => String(txt || '').split(/\n\n+/).map(s => s.trim()).filter(Boolean)
  .map(s => {
    if (s.startsWith('{') || s.startsWith('[')) {
      try { return JSON.parse(s) } catch { return s }
    }
    return s
  })

function initDraft(entry) {
  const base = blankHomebrewClass(entry?.source || 'HB')
  const e = entry && entry.name ? entry : base
  const sp = e.startingProficiencies || {}
  return {
    ...base,
    ...e,
    hd: e.hd || { faces: 8 },
    proficiency: e.proficiency || [],
    startingProficiencies: {
      armor: sp.armor || [], weapons: sp.weapons || [],
      tools: sp.tools || [], skills: sp.skills || [],
    },
    classFeatures: (e.classFeatures || []).map(f => ({
      name: f.name || '', level: f.level || 1, entries: f.entries || [],
    })),
    subclasses: (e.subclasses || []).map(s => ({
      name: s.name || '', shortName: s.shortName || '', entries: s.entries || [],
      features: (s.features || []).map(f => ({
        name: f.name || '', level: f.level || 1, entries: f.entries || [],
      })),
    })),
    _localMeta: entry?._localMeta || {},
  }
}

// Skill-Wahl liegt in 5etools als [{choose:{from:[…],count:n}}] vor.
function readSkillChoice(skills) {
  const block = (skills || []).find(b => b?.choose)
  return {
    count: block?.choose?.count || 2,
    from: (block?.choose?.from || []).map(s => String(s).toLowerCase()),
  }
}

export default function ClassEditor({ entry, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => initDraft(entry))
  // Wechselt der bearbeitete Eintrag, wird der Draft neu aufgebaut. Reset
  // in der Render-Phase statt im Effekt (React-Empfehlung fuer
  // "State an Props anpassen") — kein zusaetzlicher Renderdurchlauf.
  const entryKey = `${entry?._localMeta?.id || ''}|${entry?.name || ''}`
  const [seenKey, setSeenKey] = useState(entryKey)
  if (seenKey !== entryKey) {
    setSeenKey(entryKey)
    setDraft(initDraft(entry))
  }
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const setProf = (k, v) => setDraft(d => ({
    ...d, startingProficiencies: { ...d.startingProficiencies, [k]: v },
  }))
  const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v])

  const skillChoice = useMemo(
    () => readSkillChoice(draft.startingProficiencies.skills),
    [draft.startingProficiencies.skills],
  )
  const setSkillChoice = (patch) => {
    const next = { ...skillChoice, ...patch }
    setProf('skills', next.from.length
      ? [{ choose: { from: next.from, count: next.count } }]
      : [])
  }

  // ── Klassen-Features ──
  const addFeature = () => set('classFeatures', [...draft.classFeatures, { name: '', level: 1, entries: [''] }])
  const patchFeature = (i, patch) => set('classFeatures',
    draft.classFeatures.map((f, x) => (x === i ? { ...f, ...patch } : f)))
  const removeFeature = (i) => set('classFeatures', draft.classFeatures.filter((_, x) => x !== i))

  // ── Subclasses ──
  const addSub = () => set('subclasses', [...draft.subclasses, { name: '', shortName: '', entries: [], features: [] }])
  const patchSub = (i, patch) => set('subclasses',
    draft.subclasses.map((s, x) => (x === i ? { ...s, ...patch } : s)))
  const removeSub = (i) => set('subclasses', draft.subclasses.filter((_, x) => x !== i))
  const addSubFeature = (i) => patchSub(i, {
    features: [...(draft.subclasses[i].features || []), { name: '', level: draft.subclassLevel || 3, entries: [''] }],
  })
  const patchSubFeature = (i, j, patch) => patchSub(i, {
    features: draft.subclasses[i].features.map((f, x) => (x === j ? { ...f, ...patch } : f)),
  })
  const removeSubFeature = (i, j) => patchSub(i, {
    features: draft.subclasses[i].features.filter((_, x) => x !== j),
  })

  const isCaster = !!draft.casterProgression

  function commit() {
    if (!String(draft.name || '').trim()) { alert('Bitte einen Klassen-Namen eingeben.'); return }
    const out = {
      ...draft,
      name: draft.name.trim(),
      source: (draft.source || 'HB').trim(),
      hd: { faces: parseInt(draft.hd?.faces, 10) || 8 },
      subclassLevel: parseInt(draft.subclassLevel, 10) || 3,
      subclassTitle: (draft.subclassTitle || 'Subclass').trim(),
      spellcastingAbility: isCaster ? (draft.spellcastingAbility || 'int') : null,
      casterProgression: draft.casterProgression || null,
      classFeatures: draft.classFeatures
        .filter(f => String(f.name || '').trim())
        .map(f => ({ name: f.name.trim(), level: parseInt(f.level, 10) || 1, entries: f.entries || [] })),
      subclasses: draft.subclasses
        .filter(s => String(s.name || '').trim())
        .map(s => ({
          name: s.name.trim(),
          shortName: (s.shortName || s.name).trim(),
          entries: s.entries || [],
          features: (s.features || [])
            .filter(f => String(f.name || '').trim())
            .map(f => ({ name: f.name.trim(), level: parseInt(f.level, 10) || 1, entries: f.entries || [] })),
        })),
      _localMeta: draft._localMeta,
    }
    onSave(out)
  }

  return (
    <div style={ek.wrap}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <input value={draft.name} onChange={e => set('name', e.target.value)}
          placeholder="Klassen-Name" style={{ ...ek.input, flex: 1, fontSize: 18, fontWeight: 700 }} />
        <input value={draft.source} onChange={e => set('source', e.target.value)}
          placeholder="Source" style={{ ...ek.input, width: 160 }} />
      </div>

      <Section title="Grundwerte" accent="#7aa2f7">
        <div style={ek.grid}>
          <Field label="Hit Die">
            <select value={draft.hd?.faces || 8}
              onChange={e => set('hd', { faces: parseInt(e.target.value, 10) })} style={ek.input}>
              {HIT_DICE.map(d => <option key={d} value={d}>d{d}</option>)}
            </select>
          </Field>
          <Field label="Subclass ab Stufe">
            <input type="number" min="1" max="20" value={draft.subclassLevel}
              onChange={e => set('subclassLevel', e.target.value)} style={ek.input} />
          </Field>
          <Field label="Bezeichnung der Subclass">
            <input value={draft.subclassTitle} onChange={e => set('subclassTitle', e.target.value)}
              placeholder="z.B. Pfad, Orden, Tradition" style={ek.input} />
          </Field>
        </div>
        <Field label="Rettungswürfe" hint="Saving-Throw-Proficiencies der Klasse — RAW genau zwei">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {ABILITIES.map(a => (
              <button key={a.v} type="button"
                onClick={() => set('proficiency', toggleIn(draft.proficiency, a.v))}
                style={draft.proficiency.includes(a.v) ? ek.chipOn : ek.chip}>{a.l}</button>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="Zauberwirken" accent="#b07afe"
        subtitle="Bestimmt Zauberplätze und ob vorbereitet oder fest gelernt wird">
        <div style={ek.grid}>
          <Field label="Progression">
            <select value={draft.casterProgression || ''}
              onChange={e => set('casterProgression', e.target.value || null)} style={ek.input}>
              {CASTER_PROGS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </Field>
          {isCaster && (
            <Field label="Zauber-Attribut">
              <select value={draft.spellcastingAbility || 'int'}
                onChange={e => set('spellcastingAbility', e.target.value)} style={ek.input}>
                {ABILITIES.map(a => <option key={a.v} value={a.v}>{a.l}</option>)}
              </select>
            </Field>
          )}
        </div>
        {isCaster && (
          <div style={{ fontSize: 11, color: '#9aa3b4', lineHeight: 1.6 }}>
            Eine eigene Klasse hat keine offizielle Zauberliste. Lege im Tab
            „Spell-Listen" eine Liste an und verknüpfe sie weiter unten — sonst
            stehen beim Lernen bzw. Vorbereiten keine Zauber zur Auswahl.
          </div>
        )}
      </Section>

      <Section title="Start-Proficiencies" accent="#9ece6a">
        <Field label="Rüstung">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {ARMOR.map(a => (
              <button key={a} type="button"
                onClick={() => setProf('armor', toggleIn(draft.startingProficiencies.armor, a))}
                style={draft.startingProficiencies.armor.includes(a) ? ek.chipOn : ek.chip}>{a}</button>
            ))}
          </div>
        </Field>
        <Field label="Waffen">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {WEAPONS.map(w => (
              <button key={w} type="button"
                onClick={() => setProf('weapons', toggleIn(draft.startingProficiencies.weapons, w))}
                style={draft.startingProficiencies.weapons.includes(w) ? ek.chipOn : ek.chip}>{w}</button>
            ))}
          </div>
        </Field>
        <Field label="Skills — auswählbar aus den markierten">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: '#9aa3b4' }}>Anzahl der Wahlen:</span>
            <input type="number" min="0" max="6" value={skillChoice.count}
              onChange={e => setSkillChoice({ count: parseInt(e.target.value, 10) || 1 })}
              style={{ ...ek.input, width: 70 }} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {SKILLS.map(s => (
              <button key={s} type="button"
                onClick={() => setSkillChoice({ from: toggleIn(skillChoice.from, s) })}
                style={skillChoice.from.includes(s) ? ek.chipOn : ek.chip}>{s}</button>
            ))}
          </div>
        </Field>
      </Section>

      <Section title={`Klassen-Features (${draft.classFeatures.length})`} accent="#ff9533"
        subtitle="Werden auf ihrer Stufe automatisch aktiv — Sheet und VTT lesen die Mechanik aus dem Text"
        actions={<button type="button" onClick={addFeature} style={ek.primaryMini}>+ Feature</button>}>
        {draft.classFeatures.length === 0 ? (
          <div style={ek.empty}>Noch keine Features.</div>
        ) : draft.classFeatures.map((f, i) => (
          <div key={i} style={{ ...ek.card, marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input value={f.name} onChange={e => patchFeature(i, { name: e.target.value })}
                placeholder="Feature-Name" style={{ ...ek.input, flex: 1 }} />
              <input type="number" min="1" max="20" value={f.level}
                onChange={e => patchFeature(i, { level: e.target.value })}
                title="Stufe" style={{ ...ek.input, width: 70 }} />
              <button type="button" onClick={() => removeFeature(i)} style={ek.iconBtn} title="Entfernen">×</button>
            </div>
            <textarea value={toText(f.entries)} rows={3}
              onChange={e => patchFeature(i, { entries: fromText(e.target.value) })}
              placeholder={FEATURE_HINT}
              style={{ ...ek.input, resize: 'vertical' }} />
          </div>
        ))}
      </Section>

      <Section title={`Subclasses (${draft.subclasses.length})`} accent="#4dd0e1"
        subtitle={`Auswahl auf Stufe ${draft.subclassLevel || 3}`}
        actions={<button type="button" onClick={addSub} style={ek.primaryMini}>+ Subclass</button>}>
        {draft.subclasses.length === 0 ? (
          <div style={ek.empty}>Noch keine Subclasses.</div>
        ) : draft.subclasses.map((s, i) => (
          <div key={i} style={{ ...ek.card, marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input value={s.name} onChange={e => patchSub(i, { name: e.target.value })}
                placeholder="Subclass-Name" style={{ ...ek.input, flex: 1 }} />
              <button type="button" onClick={() => removeSub(i)} style={ek.iconBtn} title="Entfernen">×</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 4px' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#9aa3b4', textTransform: 'uppercase' }}>
                Features ({(s.features || []).length})
              </span>
              <button type="button" onClick={() => addSubFeature(i)} style={ek.miniBtn}>+ Feature</button>
            </div>
            {(s.features || []).map((f, j) => (
              <div key={j} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                  <input value={f.name} onChange={e => patchSubFeature(i, j, { name: e.target.value })}
                    placeholder="Feature-Name" style={{ ...ek.input, flex: 1 }} />
                  <input type="number" min="1" max="20" value={f.level}
                    onChange={e => patchSubFeature(i, j, { level: e.target.value })}
                    title="Stufe" style={{ ...ek.input, width: 70 }} />
                  <button type="button" onClick={() => removeSubFeature(i, j)} style={ek.iconBtn} title="Entfernen">×</button>
                </div>
                <textarea value={toText(f.entries)} rows={2}
                  onChange={e => patchSubFeature(i, j, { entries: fromText(e.target.value) })}
                  placeholder="Regeltext" style={{ ...ek.input, resize: 'vertical' }} />
              </div>
            ))}
          </div>
        ))}
      </Section>

      <SpellListLink value={draft.spellListIds}
        onChange={(v) => set('spellListIds', v)}
        whatHasIt="diese Klasse" />

      <Section title="Beschreibung" accent="#9aa3b4">
        <textarea value={toText(draft.entries)} rows={4}
          onChange={e => set('entries', fromText(e.target.value))}
          placeholder="Was ist das für eine Klasse?" style={{ ...ek.input, resize: 'vertical' }} />
      </Section>

      {draft.classFeatures.some(f => f.name) && (
        <Section title="Vorschau" accent="#9aa3b4">
          {draft.classFeatures.filter(f => f.name)
            .sort((a, b) => (a.level || 1) - (b.level || 1)).map((f, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 700, color: '#7aa2f7', fontSize: 13 }}>
                  {f.name}
                  <span style={{ fontSize: 11, color: '#6b7386', fontWeight: 400 }}> · Stufe {f.level}</span>
                </div>
                <EntryRenderer entries={f.entries || []} />
              </div>
            ))}
        </Section>
      )}

      <div style={ek.footer}>
        <button type="button" onClick={onCancel} style={ek.cancelBtn}>Abbrechen</button>
        <button type="button" onClick={commit} style={ek.saveBtn}>Speichern</button>
      </div>
    </div>
  )
}
