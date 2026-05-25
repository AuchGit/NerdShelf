// src/features/dnd/character-builder/pages/DashboardPage.jsx
import { useEffect, useState, useCallback, memo } from 'react'
import { useNavigate } from '../lib/hashNav'
import { supabase } from '../lib/supabase'
import { Panel } from '../../../../shared/ui'
import DashboardLayout from '../../../../shared/dashboard/DashboardLayout'
import { ShareTokenBadge } from '../../../../shared/tokens'
import { ImportedSection, useImports } from '../../../../shared/imports'
import { ShareButton, useDeepLinkImport } from '../../../../shared/sharing'
import { readList, writeList, invalidate, subscribe } from '../../../../shared/cache/listCache'
import DndSubNav from '../components/ui/DndSubNav'

const EDITION_ORDER = ['5e', '5.5e']
const EDITION_LABEL = { '5e': '5e', '5.5e': '5.5e' }

export default function DashboardPage({ session }) {
  const navigate = useNavigate()
  const uid = session?.user?.id
  const cacheKey = uid ? `dnd_characters:${uid}` : null
  const cached = cacheKey ? readList(cacheKey) : null
  const [characters, setCharacters] = useState(() => cached ?? [])
  const [loading, setLoading] = useState(() => !cached)
  const [error, setError] = useState(null)
  const [importStatus, setImportStatus] = useState(null)
  const imports = useImports({ domain: 'dnd_character' })

  // Deep link: `<APP>/dnd/?import=<token>` (when the link is a character —
  // the route already lands on the character dashboard so this is the
  // right place to consume it). `?join=` is handled in CampaignsPage.
  useDeepLinkImport({
    param: 'import',
    onToken: async (token) => {
      try {
        const r = await imports.add(token)
        setImportStatus({ ok: true, msg: `„${r.entityName}" hinzugefügt.` })
      } catch (e) {
        setImportStatus({ ok: false, msg: e.message || String(e) })
      }
      setTimeout(() => setImportStatus(null), 4000)
    },
  })

  const loadCharacters = useCallback(async () => {
    if (!uid) return
    // Background revalidate: no spinner if cache already populated.
    //
    // The dashboard card only reads a handful of fields out of the
    // character `data` JSONB (classes, species, background, portrait,
    // edition). Pulling the full `data` (10-50 KB per row, dominated by
    // class features + spells + inventory) was the dominant egress on
    // every dashboard load. JSONB path selection lets PostgREST project
    // just what we need server-side — typical payload drops 80%+.
    const { data, error: err } = await supabase
      .from('dnd_characters')
      .select(`
        id, name, created_at, share_token,
        classes:data->classes,
        species:data->species,
        background:data->background,
        portrait:data->appearance->>portrait,
        edition:data->meta->>edition
      `)
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
    if (err) {
      setError(err.message)
    } else {
      // Reshape back into the { data: { classes, species, ... } } form
      // CharacterCard expects, so nothing downstream has to change.
      const rows = (data || []).map(r => ({
        id: r.id,
        name: r.name,
        created_at: r.created_at,
        share_token: r.share_token,
        data: {
          classes: r.classes || [],
          species: r.species || {},
          background: r.background || {},
          appearance: { portrait: r.portrait || null },
          meta: { edition: r.edition || null },
        },
      }))
      setCharacters(rows)
      writeList(`dnd_characters:${uid}`, rows)
    }
    setLoading(false)
  }, [uid])

  useEffect(() => { loadCharacters() }, [loadCharacters])

  useEffect(() => {
    if (!cacheKey) return
    return subscribe(cacheKey, (next) => {
      if (next === null) loadCharacters()
      else setCharacters(next)
    })
  }, [cacheKey, loadCharacters])

  async function handleDelete(charId, name) {
    if (!window.confirm(`Charakter "${name}" wirklich löschen?`)) return
    const { error: err } = await supabase
      .from('dnd_characters').delete()
      .eq('id', charId)
      .eq('user_id', session.user.id)
    if (err) { alert(`Löschen fehlgeschlagen: ${err.message}`); return }
    if (cacheKey) invalidate(cacheKey)
    loadCharacters()
  }

  return (
    <>
      <DndSubNav active="characters" />
      {error && (
        <div style={{
          maxWidth: 1200, margin: '0 auto',
          padding: 'var(--space-3) var(--space-5)',
          color: 'var(--color-danger)',
        }}>
          Fehler beim Laden: {error}
        </div>
      )}
      {importStatus && (
        <div style={{
          maxWidth: 1200, margin: '0 auto',
          padding: 'var(--space-2) var(--space-5)',
          fontSize: 'var(--fs-sm)',
          color: importStatus.ok ? 'var(--color-success)' : 'var(--color-danger)',
        }}>
          {importStatus.ok ? '✓ ' : '⚠ '}{importStatus.msg}
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

      <ImportedSection
        title="Importierte Charaktere"
        entities={imports.entities}
        owners={imports.owners}
        loading={imports.loading}
        tableMissing={imports.tableMissing}
        domain="dnd_character"
        onImport={imports.add}
        onRemove={imports.remove}
        getSubCategory={(char) => EDITION_LABEL[char.data?.meta?.edition] || char.data?.meta?.edition || 'Unbekannte Edition'}
        subCategoryOrder={EDITION_ORDER.map(e => EDITION_LABEL[e])}
        storageKey="dnd-imports-collapsed"
        renderItem={(char, ctx) => (
          <CharacterCard
            key={char.id}
            character={char}
            onOpen={() => navigate(`/character/view/${char.share_token}`)}
            onRemove={ctx.onRemove}
            readOnly
            ownerName={ctx.ownerName}
          />
        )}
      />
    </>
  )
}

// memo with a custom compare that ignores the click-handler props.
// Those are inline arrow functions from the parent's renderItem prop and
// change reference on every render; their *behaviour* is fully captured
// by the character reference (id + the closed-over navigate / delete
// callbacks, which are themselves stable). Comparing just the data lets
// the cards stay mounted across unrelated parent re-renders.
const CharacterCard = memo(function CharacterCard({ character, onOpen, onDelete, readOnly = false, ownerName, onRemove }) {
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
                {classes.map(c => `${c.classId} ${c.level}`).join(' / ')}
                {classes.length > 1 && ` · Lv.${totalLevel}`}
              </div>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); readOnly ? onRemove?.() : onDelete(); }}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--color-text-dim)', cursor: 'pointer',
              padding: 4, borderRadius: 4, fontSize: 16, flexShrink: 0,
            }}
            title={readOnly ? 'Import entfernen' : 'Charakter löschen'}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-dim)'}
          >{readOnly ? '⊘' : '✕'}</button>
        </div>

        {readOnly && ownerName && (
          <div style={{
            fontSize: 'var(--fs-xs)',
            color: 'var(--color-text-dim)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}>
            👁 Nur lesen · von {ownerName}
          </div>
        )}

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
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          fontSize: 'var(--fs-xs)', color: 'var(--color-text-dim)',
          borderTop: '1px solid var(--color-border)',
          paddingTop: 'var(--space-2)',
          marginTop: 'auto',
        }}>
          <span>Erstellt: {new Date(character.created_at).toLocaleDateString('de-DE')}</span>
          <span style={{ flex: 1 }} />
          {character.share_token && !readOnly && (
            <>
              <ShareTokenBadge token={character.share_token} label="Charakter-Token" compact />
              <ShareButton kind="dnd_character" token={character.share_token} name={character.name} compact />
            </>
          )}
        </div>
      </div>
    </Panel>
  )
}, (a, b) => (
  a.character === b.character
  && a.readOnly === b.readOnly
  && a.ownerName === b.ownerName
))

const Pill = {
  padding: '2px 8px',
  borderRadius: 999,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text)',
  fontSize: 'var(--fs-xs)',
}