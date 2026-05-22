// src/features/dnd/character-builder/pages/CharacterViewPage.jsx
//
// Read-only summary for an imported (foreign) DnD character. Loaded via
// share_token, accessible at #/character/view/:token. We deliberately
// do NOT render the full editable sheet — the goal is "show me what my
// friend's character is" without leaking edit affordances. For deeper
// inspection the user can ask the original owner.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from '../lib/hashNav'
import { supabase } from '../lib/supabase'
import { ShareTokenBadge } from '../../../../shared/tokens'
import { Panel } from '../../../../shared/ui'

export default function CharacterViewPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [row, setRow] = useState(null)
  const [ownerName, setOwnerName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data: r, error: err } = await supabase
        .from('dnd_characters')
        .select('*')
        .eq('share_token', token)
        .maybeSingle()
      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      if (!r) { setError('Charakter nicht gefunden — der Import wurde eventuell entfernt.'); setLoading(false); return }
      setRow(r)
      const { data: prof } = await supabase
        .from('profiles').select('player_name').eq('id', r.user_id).maybeSingle()
      if (!cancelled) setOwnerName(prof?.player_name || '')
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [token])

  if (loading) return <Centered>Lade Charakter…</Centered>
  if (error) {
    return (
      <Centered>
        <div style={{ color: 'var(--color-danger)', marginBottom: 12 }}>{error}</div>
        <button onClick={() => navigate('/')} style={backBtnStyle}>← Zurück</button>
      </Centered>
    )
  }
  if (!row) return null

  const data = row.data || {}
  const classes = data.classes || []
  const totalLevel = classes.reduce((s, c) => s + (c.level || 0), 0)
  const race = data.species?.raceId?.split('__')[0] || ''
  const subrace = data.species?.subraceId?.split('__')[0] || ''
  const background = data.background?.backgroundId?.split('__')[0] || ''
  const edition = data.meta?.edition
  const portrait = data.appearance?.portrait

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 'var(--space-5)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/')} style={backBtnStyle}>← Dashboard</button>
        <h1 style={{ margin: 0, fontSize: 'var(--fs-2xl)', fontWeight: 'var(--fw-semibold)' }}>
          {row.name || 'Unbenannter Charakter'}
        </h1>
        <span style={pillStyle}>👁 Nur lesen</span>
        {ownerName && (
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
            geteilt von <strong style={{ color: 'var(--color-text)' }}>{ownerName}</strong>
          </span>
        )}
        <span style={{ flex: 1 }} />
        {row.share_token && <ShareTokenBadge token={row.share_token} label="Token" />}
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: portrait ? '180px 1fr' : '1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
        {portrait && (
          <img
            src={portrait}
            alt=""
            style={{
              width: 180, height: 240, objectFit: 'cover',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
            }}
          />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Panel>
            <SectionLabel>Übersicht</SectionLabel>
            <Row label="Stufe">{totalLevel || '—'}</Row>
            {classes.length > 0 && (
              <Row label={classes.length > 1 ? 'Klassen' : 'Klasse'}>
                {classes.map(c => `${c.classId} ${c.level}`).join(' · ')}
              </Row>
            )}
            {race && <Row label="Volk">{race}{subrace ? ` (${subrace})` : ''}</Row>}
            {background && <Row label="Hintergrund">{background}</Row>}
            {edition && <Row label="Edition">{edition}</Row>}
          </Panel>

          {data.appearance && (data.appearance.alignment || data.appearance.gender || data.appearance.age) && (
            <Panel>
              <SectionLabel>Charakter</SectionLabel>
              {data.appearance.alignment && <Row label="Gesinnung">{data.appearance.alignment}</Row>}
              {data.appearance.gender && <Row label="Geschlecht">{data.appearance.gender}</Row>}
              {data.appearance.age && <Row label="Alter">{data.appearance.age}</Row>}
            </Panel>
          )}

          {data.appearance?.backstory && (
            <Panel>
              <SectionLabel>Hintergrundgeschichte</SectionLabel>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--fs-sm)', lineHeight: 1.5 }}>
                {data.appearance.backstory}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div style={{
      display: 'flex',
      gap: 'var(--space-3)',
      padding: '4px 0',
      borderBottom: '1px solid var(--color-border)',
      fontSize: 'var(--fs-sm)',
    }}>
      <span style={{ color: 'var(--color-text-muted)', minWidth: 110 }}>{label}</span>
      <span style={{ flex: 1, fontWeight: 'var(--fw-medium)' }}>{children}</span>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 'var(--fs-xs)',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: 'var(--color-text-muted)',
      fontWeight: 'var(--fw-semibold)',
      marginBottom: 'var(--space-2)',
    }}>
      {children}
    </div>
  )
}

function Centered({ children }) {
  return <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>{children}</div>
}

const backBtnStyle = {
  background: 'transparent',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)',
  padding: '4px 12px',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const pillStyle = {
  padding: '2px 10px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
  color: 'var(--color-accent)',
  fontSize: 'var(--fs-xs)',
  fontWeight: 'var(--fw-semibold)',
  border: '1px solid var(--color-accent)',
}
