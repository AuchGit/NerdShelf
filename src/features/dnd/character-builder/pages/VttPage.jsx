// Virtual tabletop page for a campaign. Resolves the viewer's role (GM vs
// player) + display name from the campaign membership, then mounts the VTT
// full-screen. Players land here directly when they enter an active session;
// the GM reaches it via the "VTT" button in the campaign view (prep + run).
import { useEffect, useState } from 'react'
import { useNavigate } from '../lib/hashNav'
import { getCampaign, listMyMemberships } from '../lib/campaigns'
import VttApp from '../../vtt/VttApp'

export default function VttPage({ session, campaignId }) {
  const navigate = useNavigate()
  const uid = session.user.id
  const [info, setInfo] = useState(null) // { isGM, playerName } | { error }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const c = await getCampaign(campaignId)
        if (!c) { if (!cancelled) setInfo({ error: 'Campaign nicht gefunden.' }); return }
        const isGM = c.gm_id === uid
        let playerName = ''
        if (!isGM) {
          const mems = await listMyMemberships(uid)
          playerName = mems.find((m) => m.campaign_id === campaignId)?.player_name || ''
        }
        if (!cancelled) setInfo({ isGM, playerName, edition: c.edition || '5e' })
      } catch (e) {
        if (!cancelled) setInfo({ error: e.message || String(e) })
      }
    })()
    return () => { cancelled = true }
  }, [campaignId, uid])

  if (!info) return null
  if (info.error) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-danger)' }}>
        {info.error}
        <div><button onClick={() => navigate(`/campaign/${campaignId}`)} style={{ marginTop: 16 }}>← Campaign</button></div>
      </div>
    )
  }

  // Full-screen overlay above the rest of the dnd shell.
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#0b0e14' }}>
      <VttApp
        campaignId={campaignId}
        userId={uid}
        isGM={info.isGM}
        playerName={info.playerName}
        edition={info.edition}
        onExit={() => navigate(`/campaign/${campaignId}`)}
      />
    </div>
  )
}
