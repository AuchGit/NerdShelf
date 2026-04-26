// src/features/dnd/character-builder/pages/DashboardPage.jsx
import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from '../lib/hashNav'
import { supabase } from '../lib/supabase'
import { Panel } from '../../../../shared/ui'
import DashboardLayout from '../../../../shared/dashboard/DashboardLayout'

const EDITION_ORDER = ['5e', '5.5e']
const EDITION_LABEL = { '5e': '5e', '5.5e': '5.5e' }

export default function DashboardPage({ session }) {
  const navigate = useNavigate()
  const [characters, setCharacters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadCharacters = useCallback(async () => {
    if (!session?.user?.id) return
    setLoading(true)
    const { data, error: err } = await supabase
      .from('characters')
      .select('id, name, created_at, data')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
    if (err) setError(err.message)
    else setCharacters(data || [])
    setLoading(false)
  }, [session?.user?.id])

  useEffect(() => { loadCharacters() }, [loadCharacters])

  async function handleDelete(charId, name) {
    if (!window.confirm(`Charakter "${name}" wirklich löschen?`)) return
    const { error: err } = await supabase
      .from('characters').delete()
      .eq('id', charId)
      .eq('user_id', session.user.id)
    if (err) alert(`Löschen fehlgeschlagen: ${err.message}`)
    else loadCharacters()
  }

  return (
    <>
      {error && (
        <div style={{
          maxWidth: 1200, margin: '0 auto',
          padding: 'var(--space-3) var(--space-5)',
          color: 'var(--color-danger)',
        }}>
          Fehler beim Laden: {error}
        </div>
      )}
      <DashboardLayout
        title="Meine Charaktere"
        newButtonLabel="+ Neuer Charakter"
        onNew={() => navigate('/character/new')}
        items={characters}
        loading={loading}
        getCategory={(char) => EDITION_LABEL[char.data?.meta?.edition] || char.data?.meta?.edition || 'Unbekannte Edition'}
        categoryOrder={EDITION_ORDER.map(e => EDITION_LABEL[e])}
        storageKey="dnd-dashboard-collapsed"
        emptyIcon="⚔"
        emptyTitle="Noch keine Charaktere"
        emptyDescription="Erstelle deinen ersten Charakter, um loszulegen."
        renderItem={(char) => (
          <CharacterCard
            key={char.id}
            character={char}
            onOpen={() => navigate(`/character/${char.id}`)}
            onDelete={() => handleDelete(char.id, char.name)}
          />
        )}
      />
    </>
  )
}

function CharacterCard({ character, onOpen, onDelete }) {
  const data = character.data || {}
  const classes = data.classes || []
  const totalLevel = classes.reduce((s, c) => s + (c.level || 0), 0)
  const primaryClass = classes[0]
  const race = data.species?.raceId?.split('__')[0] || ''
  const subrace = data.species?.subraceId?.split('__')[0] || ''
  const background = data.background?.backgroundId?.split('__')[0] || ''
  const portrait = data.appearance?.portrait
  const edition = data.meta?.edition

  return (
    <Panel
      style={{
        display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
        cursor: 'pointer', padding: 0,
        overflow: 'hidden',
        transition: 'transform var(--transition), border-color var(--transition)',
      }}
      onClick={onOpen}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--color-accent)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
    >
      {/* Portrait area */}
      <div style={{
        height: 140, background: 'var(--color-bg-sunken)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        {portrait ? (
          <img src={portrait} alt="" style={{
            width: '100%', height: '100%', objectFit: 'cover',
          }} />
        ) : (
          <div style={{ fontSize: 56, opacity: 0.4 }}>⚔</div>
        )}
        {edition && (
          <div style={{
            position: 'absolute', top: 8, right: 8,
            background: 'var(--color-accent)', color: 'var(--color-accent-contrast)',
            padding: '2px 8px', borderRadius: 4,
            fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)',
            textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {edition}
          </div>
        )}
      </div>

      {/* Info area */}
      <div style={{
        padding: 'var(--space-3) var(--space-4)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
        flex: 1,
      }}>
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 'var(--space-2)',
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {character.name || 'Unbenannter Charakter'}
            </div>
            {primaryClass && (
              <div style={{
                fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {primaryClass.classId} Lv.{totalLevel}
                {classes.length > 1 && ` (+${classes.length - 1})`}
              </div>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--color-text-dim)', cursor: 'pointer',
              padding: 4, borderRadius: 4, fontSize: 16, flexShrink: 0,
            }}
            title="Charakter löschen"
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-dim)'}
          >✕</button>
        </div>

        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)',
          fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)',
        }}>
          {race && (
            <span style={Pill}>
              {race}{subrace ? ` (${subrace})` : ''}
            </span>
          )}
          {background && (
            <span style={Pill}>{background}</span>
          )}
        </div>

        <div style={{
          fontSize: 'var(--fs-xs)', color: 'var(--color-text-dim)',
          borderTop: '1px solid var(--color-border)',
          paddingTop: 'var(--space-2)',
          marginTop: 'auto',
        }}>
          Erstellt: {new Date(character.created_at).toLocaleDateString('de-DE')}
        </div>
      </div>
    </Panel>
  )
}

const Pill = {
  padding: '2px 8px',
  borderRadius: 999,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text)',
  fontSize: 'var(--fs-xs)',
}