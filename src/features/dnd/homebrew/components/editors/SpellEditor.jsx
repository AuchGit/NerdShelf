// SpellEditor.jsx
//
// Strukturierter Editor für Homebrew-Spells. 5etools-Felder
// (level, school, time, range, components, duration, classes,
// damageInflict, savingThrow, spellAttack, scalingLevelDice,
// entries, entriesHigherLevel) als Dropdowns/Toggles. Resultat-
// Object wird direkt von loadSpellList konsumiert (siehe
// dataLoader.loadSpellList Homebrew-Branch).

import { useState, useEffect } from 'react'
import EntryRenderer from '../../../character-builder/components/ui/EntryRenderer'
import { loadClassList } from '../../../character-builder/lib/dataLoader'

const SCHOOLS = [
  { v: 'A', l: 'A — Abjuration' },
  { v: 'C', l: 'C — Conjuration' },
  { v: 'D', l: 'D — Divination' },
  { v: 'E', l: 'E — Enchantment' },
  { v: 'V', l: 'V — Evocation' },
  { v: 'I', l: 'I — Illusion' },
  { v: 'N', l: 'N — Necromancy' },
  { v: 'T', l: 'T — Transmutation' },
]
const CAST_UNITS = ['action', 'bonus', 'reaction', 'minute', 'hour']
const DURATION_TYPES = [
  { v: 'instant', l: 'Instantaneous' },
  { v: 'permanent', l: 'Permanent' },
  { v: 'special', l: 'Special' },
  { v: 'timed', l: 'Timed (specify)' },
]
const DURATION_UNITS = ['round', 'minute', 'hour', 'day']
const RANGE_TYPES = [
  { v: 'point', l: 'Point (Distance)' },
  { v: 'self', l: 'Self' },
  { v: 'touch', l: 'Touch' },
  { v: 'sight', l: 'Sight' },
  { v: 'unlimited', l: 'Unlimited' },
  { v: 'special', l: 'Special' },
]
const DAMAGE_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
]
const SAVE_ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']
// Fallback bis die echten Klassendaten geladen sind — danach kommt die
// Liste datengetrieben aus loadClassList (beide Editionen, Union).
const CLASSES_FALLBACK = ['Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Warlock', 'Wizard', 'Artificer']

// Erster NdM-Würfelausdruck aus den Beschreibungs-Entries (für die
// Skalierungs-Generatoren). {@damage 8d6} und blankes 8d6 zählen beide.
function firstDiceIn(entries) {
  const flat = (entries || []).map(e => (typeof e === 'string' ? e : JSON.stringify(e))).join(' ')
  const m = flat.match(/(\d+)d(\d+)/)
  return m ? { n: parseInt(m[1], 10), die: parseInt(m[2], 10) } : null
}

export default function SpellEditor({ entry, onSave, onCancel }) {
  const [draft, setDraft] = useState(entry)
  useEffect(() => setDraft(entry), [entry])
  // Klassen datengetrieben (Union 5e + 5.5e) — Homebrew-Spells können
  // beiden Editionen zugeordnet werden; dataLoader cached die Files.
  const [classOpts, setClassOpts] = useState(CLASSES_FALLBACK)
  useEffect(() => {
    let cancelled = false
    Promise.all([loadClassList('5e').catch(() => []), loadClassList('5.5e').catch(() => [])])
      .then(([a, b]) => {
        if (cancelled) return
        const names = [...new Set([...(a || []), ...(b || [])].map(c => c?.name).filter(Boolean))].sort()
        if (names.length) setClassOpts(names)
      })
    return () => { cancelled = true }
  }, [])

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))

  // Helper für Time / Range / Duration / Components — 5etools-Shape ist
  // verschachtelt, also abstrahieren wir's hier auf flachen UI-State.
  const time = draft.time?.[0] || { number: 1, unit: 'action' }
  const setTime = (patch) => set('time', [{ ...time, ...patch }])

  const range = draft.range || { type: 'point', distance: { type: 'self' } }
  const setRangeType = (t) => {
    if (t === 'point') set('range', { type: 'point', distance: { type: 'feet', amount: 30 } })
    else if (t === 'self') set('range', { type: 'point', distance: { type: 'self' } })
    else if (t === 'touch') set('range', { type: 'point', distance: { type: 'touch' } })
    else set('range', { type: t })
  }
  const setRangeDistance = (amount) => set('range', {
    ...range,
    distance: { ...(range.distance || {}), type: 'feet', amount },
  })

  const duration = draft.duration?.[0] || { type: 'instant' }
  const setDuration = (patch) => set('duration', [{ ...duration, ...patch }])

  const comps = draft.components || {}
  const setComp = (k, v) => set('components', { ...comps, [k]: v })

  const damageTypes = draft.damageInflict || []
  const toggleDmg = (t) => {
    const has = damageTypes.includes(t)
    set('damageInflict', has ? damageTypes.filter(x => x !== t) : [...damageTypes, t])
  }
  const saves = draft.savingThrow || []
  const toggleSave = (s) => {
    const has = saves.includes(s)
    set('savingThrow', has ? saves.filter(x => x !== s) : [...saves, s])
  }
  const classes = draft.classes || []
  const toggleClass = (c) => {
    const has = classes.includes(c)
    set('classes', has ? classes.filter(x => x !== c) : [...classes, c])
  }
  // Spell Attack (M/R) — der VTT-Roll-Prompt zeigt nur mit diesem Feld
  // einen Angriffswurf-Button an.
  const atk = draft.spellAttack || []
  const toggleAtk = (t) => {
    const has = atk.includes(t)
    set('spellAttack', has ? atk.filter(x => x !== t) : [...atk, t])
  }
  const isRitual = !!draft.meta?.ritual
  const setRitual = (on) => {
    const meta = { ...(draft.meta || {}) }
    if (on) meta.ritual = true
    else delete meta.ritual
    set('meta', meta)
  }

  // ── Skalierungs-Generatoren ──
  // Cantrip: scalingLevelDice (5/11/17, ein Würfel mehr pro Stufe) — wird
  // von spellEffectParser + Roll-Prompt konsumiert. Leveled: kanonischer
  // Upcast-Satz mit {@scaledamage}-Tag, den der Slot-Picker live umrechnet.
  const baseDice = firstDiceIn(draft.entries)
  function genCantripScaling() {
    if (!baseDice) return
    const { n, die } = baseDice
    const d = (mult) => `${n * mult}d${die}`
    set('scalingLevelDice', {
      label: `${n}d${die}`,
      scaling: { 1: d(1), 5: d(2), 11: d(3), 17: d(4) },
    })
  }
  function genUpcastText() {
    if (!baseDice) return
    const lvl = draft.level ?? 1
    const step = `1d${baseDice.die}`
    const base = `${baseDice.n}d${baseDice.die}`
    const txt = `When you cast this spell using a spell slot of level ${lvl + 1} or higher, the damage increases by {@scaledamage ${base}|${lvl}-9|${step}} for each slot level above ${lvl}.`
    set('entriesHigherLevel', [{ type: 'entries', name: 'Using a Higher-Level Spell Slot', entries: [txt] }])
  }

  // Entries / entriesHigherLevel als Textarea (jeder Absatz = Eintrag)
  const entriesText = Array.isArray(draft.entries)
    ? draft.entries.map(e => typeof e === 'string' ? e : JSON.stringify(e)).join('\n\n')
    : ''
  const setEntriesText = (txt) => {
    const arr = txt.split(/\n\n+/).map(s => s.trim()).filter(Boolean).map(s => {
      if (s.startsWith('{') || s.startsWith('[')) {
        try { return JSON.parse(s) } catch { return s }
      }
      return s
    })
    set('entries', arr)
  }
  const higherText = Array.isArray(draft.entriesHigherLevel) && draft.entriesHigherLevel[0]?.entries
    ? draft.entriesHigherLevel[0].entries.filter(e => typeof e === 'string').join('\n\n')
    : ''
  const setHigherText = (txt) => {
    const lines = txt.split(/\n\n+/).map(s => s.trim()).filter(Boolean)
    if (lines.length === 0) {
      const next = { ...draft }; delete next.entriesHigherLevel; setDraft(next)
    } else {
      set('entriesHigherLevel', [{
        type: 'entries',
        name: 'Using a Higher-Level Spell Slot',
        entries: lines,
      }])
    }
  }

  function commit() {
    if (!String(draft.name || '').trim()) {
      alert('Bitte einen Spell-Namen eingeben.')
      return
    }
    const out = { ...draft }
    if (!out.entries?.length) delete out.entries
    if (!out.classes?.length) delete out.classes
    if (!out.damageInflict?.length) delete out.damageInflict
    if (!out.savingThrow?.length) delete out.savingThrow
    if (!out.spellAttack?.length) delete out.spellAttack
    if (!out.scalingLevelDice) delete out.scalingLevelDice
    if (out.meta && Object.keys(out.meta).length === 0) delete out.meta
    onSave(out)
  }

  return (
    <div style={ed.wrap}>
      <div style={ed.headerRow}>
        <input value={draft.name || ''} onChange={e => set('name', e.target.value)}
          placeholder="Spell-Name" style={{ ...ed.input, flex: 1, fontSize: 18, fontWeight: 700 }} />
        <input value={draft.source || ''} onChange={e => set('source', e.target.value)}
          placeholder="Source" style={{ ...ed.input, width: 160 }} />
      </div>

      <div style={ed.grid}>
        <Field label="Level">
          <select value={draft.level ?? 0} onChange={e => set('level', parseInt(e.target.value, 10))} style={ed.input}>
            {[0,1,2,3,4,5,6,7,8,9].map(l => <option key={l} value={l}>{l === 0 ? 'Cantrip' : `Level ${l}`}</option>)}
          </select>
        </Field>
        <Field label="Schule">
          <select value={draft.school || 'E'} onChange={e => set('school', e.target.value)} style={ed.input}>
            {SCHOOLS.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
        </Field>
        <Field label="Casting Time">
          <div style={{ display: 'flex', gap: 4 }}>
            <input type="number" min="1" value={time.number}
              onChange={e => setTime({ number: parseInt(e.target.value, 10) || 1 })}
              style={{ ...ed.input, width: 60 }} />
            <select value={time.unit} onChange={e => setTime({ unit: e.target.value })} style={{ ...ed.input, flex: 1 }}>
              {CAST_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </Field>
        <Field label="Range">
          <div style={{ display: 'flex', gap: 4 }}>
            <select value={range.type === 'point' ? (range.distance?.type === 'self' ? 'self' : range.distance?.type === 'touch' ? 'touch' : 'point') : range.type}
              onChange={e => setRangeType(e.target.value)} style={{ ...ed.input, flex: 1 }}>
              {RANGE_TYPES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            {range.type === 'point' && !['self','touch'].includes(range.distance?.type) && (
              <input type="number" value={range.distance?.amount ?? 30}
                onChange={e => setRangeDistance(parseInt(e.target.value, 10) || 0)}
                style={{ ...ed.input, width: 70 }} placeholder="ft" />
            )}
          </div>
        </Field>
      </div>

      <div style={ed.grid}>
        <Field label="Components">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={ed.checkbox}><input type="checkbox" checked={!!comps.v} onChange={e => setComp('v', e.target.checked)} /> V</label>
            <label style={ed.checkbox}><input type="checkbox" checked={!!comps.s} onChange={e => setComp('s', e.target.checked)} /> S</label>
            <label style={ed.checkbox}><input type="checkbox" checked={!!comps.m} onChange={e => setComp('m', e.target.checked ? (comps.m || true) : false)} /> M</label>
            {comps.m !== false && comps.m && (
              <input value={typeof comps.m === 'string' ? comps.m : ''}
                onChange={e => setComp('m', e.target.value || true)}
                placeholder="Material (z.B. a pinch of dust)" style={{ ...ed.input, flex: 1 }} />
            )}
          </div>
        </Field>
        <Field label="Duration">
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <select value={duration.type} onChange={e => setDuration({ type: e.target.value })} style={{ ...ed.input, flex: 1, minWidth: 140 }}>
              {DURATION_TYPES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            {duration.type === 'timed' && (
              <>
                <input type="number" value={duration.duration?.amount ?? 1}
                  onChange={e => setDuration({ duration: { ...(duration.duration || {}), amount: parseInt(e.target.value, 10) || 1 } })}
                  style={{ ...ed.input, width: 60 }} />
                <select value={duration.duration?.type || 'minute'}
                  onChange={e => setDuration({ duration: { ...(duration.duration || {}), type: e.target.value } })}
                  style={{ ...ed.input, width: 100 }}>
                  {DURATION_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
                <label style={ed.checkbox}>
                  <input type="checkbox" checked={!!duration.concentration}
                    onChange={e => setDuration({ concentration: e.target.checked })} /> Conc.
                </label>
              </>
            )}
          </div>
        </Field>
      </div>

      <Field label="Klassen-Listen (welche Klassen können den Spell lernen/preparen)">
        <div style={ed.chipGrid}>
          {classOpts.map(c => {
            const on = classes.includes(c)
            return (
              <button key={c} type="button" onClick={() => toggleClass(c)}
                style={on ? ed.chipOn : ed.chip}>{c}</button>
            )
          })}
        </div>
      </Field>

      <div style={ed.grid}>
        <Field label="Spell Attack (zeigt im Roll-Prompt den Angriffs-Button)">
          <div style={ed.chipGrid}>
            <button type="button" onClick={() => toggleAtk('M')}
              style={atk.includes('M') ? ed.chipOn : ed.chip}>Melee</button>
            <button type="button" onClick={() => toggleAtk('R')}
              style={atk.includes('R') ? ed.chipOn : ed.chip}>Ranged</button>
          </div>
        </Field>
        <Field label="Ritual">
          <label style={ed.checkbox}>
            <input type="checkbox" checked={isRitual} onChange={e => setRitual(e.target.checked)} />
            Kann als Ritual gewirkt werden
          </label>
        </Field>
      </div>

      <div style={ed.grid}>
        <Field label="Damage Types">
          <div style={ed.chipGrid}>
            {DAMAGE_TYPES.map(t => {
              const on = damageTypes.includes(t)
              return (
                <button key={t} type="button" onClick={() => toggleDmg(t)}
                  style={on ? ed.chipOn : ed.chip}>{t}</button>
              )
            })}
          </div>
        </Field>
        <Field label="Saving Throw">
          <div style={ed.chipGrid}>
            {SAVE_ABILITIES.map(s => {
              const on = saves.includes(s)
              return (
                <button key={s} type="button" onClick={() => toggleSave(s)}
                  style={on ? ed.chipOn : ed.chip}>{s.slice(0,3).toUpperCase()}</button>
              )
            })}
          </div>
        </Field>
      </div>

      <Field label="Beschreibung (jeder Absatz = ein Eintrag)">
        <textarea value={entriesText} onChange={e => setEntriesText(e.target.value)}
          rows={8} style={{ ...ed.input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
      </Field>

      {(draft.level ?? 0) === 0 ? (
        <Field label="Cantrip-Skalierung (5. / 11. / 17. Stufe)">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={genCantripScaling} disabled={!baseDice}
              title={baseDice ? `Erzeugt ${baseDice.n}d${baseDice.die} → ${baseDice.n * 2}d${baseDice.die} → ${baseDice.n * 3}d${baseDice.die} → ${baseDice.n * 4}d${baseDice.die}` : 'Zuerst einen Würfelausdruck (z.B. 1d8) in die Beschreibung schreiben'}
              style={{ ...ed.chip, opacity: baseDice ? 1 : 0.5 }}>
              Aus Beschreibung erzeugen
            </button>
            {draft.scalingLevelDice && (
              <>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {Object.entries(draft.scalingLevelDice.scaling || {}).map(([lv, d]) => `L${lv}: ${d}`).join(' · ')}
                </span>
                <button type="button" onClick={() => set('scalingLevelDice', null)} style={ed.chip}>Entfernen</button>
              </>
            )}
          </div>
        </Field>
      ) : (
        <Field label="Upcast (At Higher Levels)">
          <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <button type="button" onClick={genUpcastText} disabled={!baseDice}
              title={baseDice ? 'Erzeugt den Standard-Satz mit {@scaledamage} — der Slot-Picker im Roll-Prompt rechnet die Würfel dann live um' : 'Zuerst einen Würfelausdruck (z.B. 8d6) in die Beschreibung schreiben'}
              style={{ ...ed.chip, opacity: baseDice ? 1 : 0.5 }}>
              +1 Würfel pro Slot-Level generieren
            </button>
          </div>
          <textarea value={higherText} onChange={e => setHigherText(e.target.value)}
            rows={3} placeholder="When you cast this spell using a spell slot of …"
            style={{ ...ed.input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
        </Field>
      )}

      {Array.isArray(draft.entries) && draft.entries.length > 0 && (
        <Field label="Vorschau (Tags wie {@damage 8d6} werden gerendert)">
          <div style={{ padding: '10px 14px', background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}>
            <EntryRenderer entries={draft.entries} />
            {Array.isArray(draft.entriesHigherLevel) && draft.entriesHigherLevel.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                <EntryRenderer entries={draft.entriesHigherLevel} />
              </div>
            )}
          </div>
        </Field>
      )}

      <div style={ed.footer}>
        <button type="button" onClick={onCancel} style={ed.cancelBtn}>Abbrechen</button>
        <button type="button" onClick={commit} style={ed.saveBtn}>Speichern</button>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <div style={ed.label}>{label}</div>
      {children}
    </div>
  )
}

const ed = {
  wrap: { padding: 20, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', marginBottom: 16 },
  headerRow: { display: 'flex', gap: 8, marginBottom: 16 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  input: { width: '100%', padding: '8px 10px', fontSize: 13, background: 'var(--bg-inset)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit' },
  checkbox: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' },
  chipGrid: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  chip: { padding: '4px 10px', borderRadius: 6, fontSize: 11, background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' },
  chipOn: { padding: '4px 10px', borderRadius: 6, fontSize: 11, background: 'color-mix(in srgb, var(--accent) 22%, transparent)', color: 'var(--accent)', border: '1px solid var(--accent)', cursor: 'pointer', fontFamily: 'inherit' },
  footer: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 },
  cancelBtn: { padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 },
  saveBtn: { padding: '8px 20px', borderRadius: 8, border: '2px solid var(--accent)', background: 'var(--accent)', color: 'var(--bg-base, #111)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700 },
}
