// src/features/wh40k/pages/CombatDashboardPage.jsx
//
// Lists local Combat Helper sessions and lets the user spin up a new one
// from any saved army. New sessions are created via a small inline army
// picker (no modal — keeps the flow one click shorter than the army
// builder's "+ Neue Armee" route).

import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../core/supabase/client';
import { useAuth } from '../../../core/auth/AuthContext';
import { Button, Panel } from '../../../shared/ui';
import DashboardLayout from '../../../shared/dashboard/DashboardLayout';
import { useWh40kData } from '../hooks/useWh40kData';
import { listSessions, deleteSession, saveSession } from '../combat/persistence';
import { createSession, PHASES } from '../combat/schema';
import MissionSetup from '../combat/MissionSetup';

export default function CombatDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data } = useWh40kData();
  const [sessions, setSessions] = useState([]);
  const [armies, setArmies] = useState([]);
  const [showNew, setShowNew] = useState(false);

  const reload = () => setSessions(listSessions());
  useEffect(() => { reload(); }, []);

  // Load armies for the picker (Supabase, same shape as the army dashboard)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data: rows } = await supabase
        .from('wh40k_armies')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      if (!cancelled) setArmies(rows || []);
    })();
    return () => { cancelled = true; };
  }, [user]);

  function startSession({ army, mission }) {
    // The wh40k dataset is large (1700+ units). If the user clicks before
    // it has finished loading we still create the session, but with an
    // empty unit lookup — the units snapshot just stays empty until the
    // user adjusts manually. Better than swallowing the click silently.
    const unitsById = data?.unitsById || {};
    const sessionName = army?.name
      || (mission?.opponentName ? `vs ${mission.opponentName}` : null)
      || (mission?.primary?.name ? `${mission.primary.name}` : null)
      || 'Unbenannte Schlacht';
    const session = createSession({
      army: army ? {
        id: army.id, name: army.name,
        factionId: army.faction, detachmentId: army.detachment,
        shareToken: army.share_token,
        data: army.data || { entries: {} },
      } : null,
      unitsById,
      name: sessionName,
      mission: mission || null,
    });
    saveSession(session);
    navigate(`/wh40k/combat/${session.id}`);
  }

  function handleDelete(id, name) {
    if (!window.confirm(`Sitzung "${name}" wirklich löschen?`)) return;
    deleteSession(id);
    reload();
  }

  // DashboardLayout doesn't render children; render the picker overlay
  // above the layout so it's visible the moment "Neue Sitzung" is clicked.
  // `clamp()` tightens horizontal padding on narrow viewports so the
  // picker isn't pinched off-screen.
  return (
    <>
      {showNew && (
        <div style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: 'var(--space-4) clamp(var(--space-3), 3vw, var(--space-5)) 0',
        }}>
          <MissionSetup
            armies={armies}
            onStart={(payload) => { setShowNew(false); startSession(payload); }}
            onCancel={() => setShowNew(false)}
          />
        </div>
      )}
      <DashboardLayout
        title="Combat Helper"
        newButtonLabel="+ Neue Sitzung"
        onNew={() => setShowNew(s => !s)}
        items={sessions}
        loading={false}
        getCategory={(s) => 'Sitzungen'}
        storageKey="wh40k-combat-collapsed"
        emptyIcon="⚔"
        emptyTitle="Noch keine Combat-Sitzung"
        emptyDescription={
          showNew
            ? 'Wähle oben eine Armee oder starte eine leere Sitzung.'
            : 'Starte eine neue Sitzung über den Button oben.'
        }
        renderItem={(s) => (
          <SessionCard
            key={s.id}
            session={s}
            onOpen={() => navigate(`/wh40k/combat/${s.id}`)}
            onDelete={() => handleDelete(s.id, s.name)}
          />
        )}
      />
    </>
  );
}

function SessionCard({ session, onOpen, onDelete }) {
  const phaseLabel = PHASES.find(p => p.id === session.currentPhase)?.short || session.currentPhase;
  return (
    <Panel
      onClick={onOpen}
      style={{
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
        transition: 'border-color var(--transition)',
      }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--color-accent)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.name}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
            {session.armyName || '—'}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Löschen"
          style={{ background: 'transparent', border: 'none', color: 'var(--color-text-dim)', cursor: 'pointer', padding: 4 }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-dim)'}
        >✕</button>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)' }}>
        <span><strong style={{ color: 'var(--color-text)' }}>R{session.currentRound}</strong> · {phaseLabel}</span>
        <span style={{ marginLeft: 'auto' }}>
          VP <strong style={{ color: 'var(--color-text)' }}>{session.vp || 0}</strong> — {session.opponentVp || 0}
        </span>
      </div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-dim)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-2)' }}>
        {session.updatedAt ? `Zuletzt: ${new Date(session.updatedAt).toLocaleString('de-DE')}` : '—'}
      </div>
    </Panel>
  );
}

function ArmyPicker({ armies, onPick, onCancel }) {
  return (
    <Panel style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        <strong>Armee auswählen</strong>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" onClick={onCancel}>Abbrechen</Button>
        <Button variant="secondary" size="sm" onClick={() => onPick(null)}>Ohne Armee</Button>
      </div>
      {armies.length === 0 ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
          Keine Armeen gespeichert. Erstelle eine im Army Builder oder starte eine leere Sitzung.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 'var(--space-2)',
        }}>
          {armies.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => onPick(a)}
              style={{
                textAlign: 'left',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2) var(--space-3)',
                cursor: 'pointer',
                color: 'var(--color-text)',
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--color-accent)'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
            >
              <div style={{ fontWeight: 'var(--fw-semibold)' }}>{a.name || 'Unbenannte Armee'}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
                {a.faction || 'Keine Fraktion'}
              </div>
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}
