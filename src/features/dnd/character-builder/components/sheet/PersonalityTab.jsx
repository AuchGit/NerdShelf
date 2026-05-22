// components/sheet/PersonalityTab.jsx
// Fully editable personality / appearance / backstory.
// All fields write straight to personality.* and appearance.* — the exact
// fields foundryExport.js reads, so the Foundry export keeps working.

import { useRef } from 'react'
import { Section, EditableText } from './SheetKit'
import { S } from './sheetStyles'

function Field({ label, value, onSave, placeholder, multiline }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={S.appearanceLabel}>{label}</div>
      <EditableText value={value} onSave={onSave} placeholder={placeholder} multiline={multiline} />
    </div>
  )
}

const APPEARANCE_FIELDS = [
  ['age', 'Age'], ['height', 'Height'], ['weight', 'Weight'],
  ['eyes', 'Eyes'], ['hair', 'Hair'], ['skin', 'Skin'],
]

export default function PersonalityTab({ character, updateCharacter }) {
  const p = character.personality || {}
  const a = character.appearance || {}
  const fileRef = useRef(null)

  function handlePortrait(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => updateCharacter('appearance.portrait', ev.target.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const setP = (key, val) => updateCharacter(`personality.${key}`, val)
  const setA = (key, val) => updateCharacter(`appearance.${key}`, val)

  return (
    <div className="dnd-sheet-tab-body" style={S.tabBody}>
      {/* ── Appearance ── */}
      <Section title="Appearance">
        <div style={S.appearanceSection}>
          <div style={S.bigPortraitWrap}>
            {a.portrait ? (
              <>
                <img src={a.portrait} style={S.bigPortrait} alt="Portrait" />
                <button
                  type="button"
                  style={{ ...S.miniBtn, position: 'absolute', top: 6, right: 6 }}
                  onClick={() => updateCharacter('appearance.portrait', null)}
                >Remove</button>
              </>
            ) : (
              <div style={S.bigPortraitEmpty} onClick={() => fileRef.current?.click()}>
                <span style={{ fontSize: 26 }}>+</span>
                <span>Upload portrait</span>
              </div>
            )}
            {a.portrait && (
              <button
                type="button"
                style={{ ...S.miniBtn, position: 'absolute', bottom: 6, right: 6 }}
                onClick={() => fileRef.current?.click()}
              >Change</button>
            )}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePortrait} />
          </div>

          <div style={S.appearanceDetails}>
            <div style={S.appearanceGrid}>
              {APPEARANCE_FIELDS.map(([key, label]) => (
                <Field key={key} label={label} value={a[key]} placeholder="—" onSave={v => setA(key, v)} />
              ))}
            </div>
            <Field label="Description" value={a.description} multiline
              placeholder="Distinguishing features, mannerisms, clothing..."
              onSave={v => setA('description', v)} />
          </div>
        </div>
      </Section>

      {/* ── Personality ── */}
      <Section title="Personality">
        <div style={S.personalityGrid}>
          <Field label="Personality Traits" value={p.traits} multiline
            placeholder="How does your character behave?" onSave={v => setP('traits', v)} />
          <Field label="Ideals" value={p.ideals} multiline
            placeholder="What principles drive your character?" onSave={v => setP('ideals', v)} />
          <Field label="Bonds" value={p.bonds} multiline
            placeholder="What connects your character to the world?" onSave={v => setP('bonds', v)} />
          <Field label="Flaws" value={p.flaws} multiline
            placeholder="What weaknesses can be exploited?" onSave={v => setP('flaws', v)} />
        </div>
      </Section>

      {/* ── Backstory ── */}
      <Section title="Backstory">
        <EditableText value={p.backstory} multiline
          placeholder="Write your character's history here. This is exported to FoundryVTT as the biography."
          onSave={v => setP('backstory', v)} />
      </Section>

      {/* ── Notes & Connections ── */}
      <Section title="Notes & Connections">
        <div style={S.personalityGrid}>
          <Field label="Allies" value={p.allies} multiline placeholder="Friendly NPCs and contacts" onSave={v => setP('allies', v)} />
          <Field label="Enemies" value={p.enemies} multiline placeholder="Rivals and threats" onSave={v => setP('enemies', v)} />
          <Field label="Organizations" value={p.organizations} multiline placeholder="Factions and groups" onSave={v => setP('organizations', v)} />
          <Field label="Treasure" value={p.treasure} multiline placeholder="Notable loot and rewards" onSave={v => setP('treasure', v)} />
        </div>
        <Field label="Session Notes" value={p.notes} multiline placeholder="Anything else worth remembering" onSave={v => setP('notes', v)} />
      </Section>
    </div>
  )
}
