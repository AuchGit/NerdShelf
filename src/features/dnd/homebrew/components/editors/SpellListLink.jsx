// SpellListLink.jsx
//
// Wiederverwendbarer Block für JEDEN Homebrew-Editor (Rasse, Background,
// Feature, Item): welche Homebrew-Spell-Listen hängen an diesem Eintrag?
//
// Gespeichert wird als `spellListIds: [<local_id>]`. Wer den Eintrag hat
// (Rasse gewählt, Background gewählt, Feature aktiv, Item ausgerüstet),
// bekommt die Zauber der verknüpften Listen zusätzlich zur Auswahl —
// siehe character-builder/lib/characterSpellLists.js.

import { useEffect, useState } from 'react'
import { Section, ek } from './editorKit'
import { listHomebrew } from '../../lib/homebrewStore'

export default function SpellListLink({ value, onChange, whatHasIt = 'diesen Eintrag' }) {
  const [lists, setLists] = useState(null)
  useEffect(() => {
    let cancelled = false
    listHomebrew('spelllists')
      .then(l => { if (!cancelled) setLists(l || []) })
      .catch(() => { if (!cancelled) setLists([]) })
    return () => { cancelled = true }
  }, [])

  const selected = Array.isArray(value) ? value.map(String) : []
  const toggle = (id) => {
    const key = String(id)
    onChange(selected.includes(key)
      ? selected.filter(x => x !== key)
      : [...selected, key])
  }

  return (
    <Section title="Verknüpfte Spell-Listen" accent="#b07afe"
      subtitle={`Wer ${whatHasIt} hat, bekommt die Zauber dieser Listen zusätzlich zur Auswahl.`}>
      {lists === null ? (
        <div style={ek.empty}>Lädt Spell-Listen…</div>
      ) : lists.length === 0 ? (
        <div style={ek.empty}>
          Noch keine Spell-Listen angelegt — im Tab „Spell-Listen" erstellst du eine.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {lists.map(l => {
            const id = String(l?._localMeta?.id || '')
            if (!id) return null
            const on = selected.includes(id)
            return (
              <button key={id} type="button" onClick={() => toggle(id)}
                title={`${(l.spells || []).length} Zauber`}
                style={on ? ek.chipOn : ek.chip}>
                {l.name} ({(l.spells || []).length})
              </button>
            )
          })}
        </div>
      )}
    </Section>
  )
}
