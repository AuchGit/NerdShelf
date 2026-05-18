// src/features/wh40k/pages/ArmyViewPage.jsx
//
// Read-only viewer for an imported (foreign) WH40K army. Loaded via
// share_token by the route /wh40k/army/view/:token. The page only
// renders — no save / no delete / no editing controls — and falls back
// to a clear error state if the user has no import record for that
// token (the RLS policy will reject the SELECT, which we surface as a
// friendly message rather than a Supabase error blob).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../../core/supabase/client';
import { useWh40kData } from '../hooks/useWh40kData';
import { totalArmyPoints, totalModelCount, entryPoints } from '../services/points';
import { ShareTokenBadge } from '../../../shared/tokens';
import { Panel } from '../../../shared/ui';

export default function ArmyViewPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { data, loading: dataLoading } = useWh40kData();
  const [row, setRow] = useState(null);
  const [ownerName, setOwnerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: r, error: err } = await supabase
        .from('wh40k_armies')
        .select('*')
        .eq('share_token', token)
        .maybeSingle();
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      if (!r) {
        setError('Armee nicht gefunden — der Import wurde eventuell entfernt.');
        setLoading(false);
        return;
      }
      setRow(r);
      // Owner display name (best-effort; RLS lets us read profiles for
      // owners of entities we have imports for).
      const { data: prof } = await supabase
        .from('profiles')
        .select('player_name')
        .eq('id', r.user_id)
        .maybeSingle();
      if (!cancelled) setOwnerName(prof?.player_name || '');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const army = useMemo(() => {
    if (!row) return null;
    return {
      name: row.name,
      factionId: row.faction,
      detachmentId: row.detachment,
      entries: row.data?.entries || {},
      notes: row.data?.notes || '',
    };
  }, [row]);

  if (loading || dataLoading) {
    return <Centered>Lade Armee…</Centered>;
  }
  if (error) {
    return (
      <Centered>
        <div style={{ color: 'var(--color-danger)', marginBottom: 12 }}>{error}</div>
        <button onClick={() => navigate('/wh40k')} style={backBtnStyle}>← Zurück</button>
      </Centered>
    );
  }
  if (!army || !data) return null;

  const faction = data.factionsById[army.factionId];
  const detachment = army.detachmentId ? data.detachmentsById?.[army.detachmentId] : null;
  const totalPts = totalArmyPoints(army.entries, data.unitsById);
  const totalModels = totalModelCount(army.entries, data.unitsById);
  const entries = Object.entries(army.entries).map(([key, e]) => ({ key, ...e }));

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 'var(--space-5)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/wh40k')} style={backBtnStyle}>← Dashboard</button>
        <h1 style={{ margin: 0, fontSize: 'var(--fs-2xl)', fontWeight: 'var(--fw-semibold)' }}>
          {army.name}
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

      <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
        {faction && <div>Fraktion: <strong style={{ color: 'var(--color-text)' }}>{faction.name}</strong></div>}
        {detachment && <div>Detachment: <strong style={{ color: 'var(--color-text)' }}>{detachment.name}</strong></div>}
        <div>Punkte: <strong style={{ color: 'var(--color-accent)' }}>{totalPts}</strong></div>
        <div>Modelle: <strong style={{ color: 'var(--color-text)' }}>{totalModels}</strong></div>
      </div>

      <Panel style={{ padding: 0 }}>
        {entries.length === 0 ? (
          <div style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            Diese Armee enthält keine Einheiten.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {entries.map(e => {
              const u = data.unitsById[e.unitId];
              if (!u) {
                return (
                  <div key={e.key} style={rowStyle}>
                    <span style={{ color: 'var(--color-danger)' }}>Unbekannte Einheit</span>
                    <span style={{ marginLeft: 'auto' }}>{e.count}×</span>
                  </div>
                );
              }
              const isSquad = !!e.squadId;
              const cost = entryPoints(e, data.unitsById);
              return (
                <div key={e.key} style={rowStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 'var(--fw-semibold)' }}>
                      {isSquad && <span style={{ color: 'var(--color-accent)', marginRight: 4 }}>⛬</span>}
                      {isSquad ? (e.squadName || u.name) : u.name}
                    </div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
                      {isSquad ? `${u.name} · ${e.modelCount} Modelle` : u.name}
                    </div>
                  </div>
                  <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'var(--fs-sm)' }}>
                    {e.count}× · <span style={{ color: 'var(--color-accent)', fontWeight: 'var(--fw-semibold)' }}>{cost} Pkt</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {army.notes && (
        <Panel style={{ marginTop: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--color-text-muted)', fontWeight: 'var(--fw-semibold)', marginBottom: 6 }}>
            Notizen
          </div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--fs-sm)' }}>{army.notes}</div>
        </Panel>
      )}
    </div>
  );
}

function Centered({ children }) {
  return (
    <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>
      {children}
    </div>
  );
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
};
const pillStyle = {
  padding: '2px 10px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
  color: 'var(--color-accent)',
  fontSize: 'var(--fs-xs)',
  fontWeight: 'var(--fw-semibold)',
  border: '1px solid var(--color-accent)',
};
const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 'var(--space-2) var(--space-3)',
  borderBottom: '1px solid var(--color-border)',
};
