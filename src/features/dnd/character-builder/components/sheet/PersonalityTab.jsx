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

  async function handlePortrait(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const { compressImage } = await import('../../../../../shared/images/compressImage')
      const dataUrl = await compressImage(file, { maxDim: 256, quality: 0.75 })
      updateCharacter('appearance.portrait', dataUrl)
    } catch (err) {
      alert(err.message || 'Bild konnte nicht verarbeitet werden.')
    }
  }

  const setP = (key, val) => updateCharacter(`personality.${key}`, val)
  const setA = (key, val) => updateCharacter(`appearance.${key}`, val)

  return (
    <div className="dnd-sheet-tab-body" style={S.tabBody}>
      {/* ── Basic Info ── Identity-Badges (Species/Background/
          Alignment/Edition/XP) lebten früher in der Identity-Strip
          oben auf der Overview. Da brauchten sie viel Platz für
          Daten die sich nie mid-session ändern; jetzt sind sie
          hier kompakt zentral. */}
      <Section title="Basic Info">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <BasicBadge label="Species" value={
            character.species?.subraceId
              ? `${character.species.subraceId.split('__')[0]} (${character.species.raceId?.split('__')[0]})`
              : character.species?.raceId?.split('__')[0] || '—'
          } />
          <BasicBadge label="Background" value={
            character.background?.backgroundId?.split('__')[0] || '—'
          } />
          {character.info?.alignment && (
            <BasicBadge label="Alignment" value={character.info.alignment} />
          )}
          <BasicBadge label="Edition" value={character.meta?.edition === '5.5e' ? 'D&D 2024' : 'D&D 2014'} />
          {!!character.info?.experience && (
            <BasicBadge label="XP" value={character.info.experience} />
          )}
        </div>
      </Section>

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

// Read-only Identity-Badge fuer den Basic-Info-Bereich.
function BasicBadge({ label, value }) {
  return (
    <span style={{
      display: 'inline-flex', flexDirection: 'column',
      padding: '4px 10px', borderRadius: 6,
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)',
      minWidth: 90,
    }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>{value}</span>
    </span>
  )
}
