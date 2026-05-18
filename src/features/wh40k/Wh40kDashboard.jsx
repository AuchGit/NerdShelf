// src/features/wh40k/Wh40kDashboard.jsx
//
// Lists saved 40K armies. Reuses the shared <DashboardLayout> for visual
// parity with the MTG/DnD home pages, with a per-faction grouping that
// matches MTG's per-format grouping.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../core/supabase/client';
import { useAuth } from '../../core/auth/AuthContext';
import { Panel } from '../../shared/ui';
import DashboardLayout from '../../shared/dashboard/DashboardLayout';
import { useWh40kData } from './hooks/useWh40kData';
import { totalArmyPoints } from './services/points';
import { ShareTokenBadge } from '../../shared/tokens';
import { ImportedSection, useImports } from '../../shared/imports';

export default function Wh40kDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [armies, setArmies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { data } = useWh40kData();
  const imports = useImports({ domain: 'wh40k_army' });

  const loadArmies = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data: rows, error: err } = await supabase
      .from('wh40k_armies')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (err) {
      // Soft-degrade if the table hasn't been migrated yet — show an empty
      // dashboard with an explanatory toast rather than a hard crash.
      if (/does not exist|relation|schema cache/i.test(err.message)) {
        setError('Datenbank-Migration für 40K-Armeen noch nicht ausgeführt (siehe scripts/wh40k-schema.sql).');
        setArmies([]);
      } else {
        setError(err.message);
      }
    } else {
      setArmies(rows || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { loadArmies(); }, [loadArmies]);

  async function handleDelete(armyId, name) {
    if (!window.confirm(`Armee "${name}" wirklich löschen?`)) return;
    const { error: err } = await supabase
      .from('wh40k_armies')
      .delete()
      .eq('id', armyId)
      .eq('user_id', user.id);
    if (err) alert(`Löschen fehlgeschlagen: ${err.message}`);
    else loadArmies();
  }

  async function handleDuplicate(army) {
    if (!user) return;
    const baseName = army.name || 'Unbenannte Armee';
    const newName = `${baseName} (Kopie)`;
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = army;
    const payload = {
      ...rest,
      user_id: user.id,
      name: newName,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = await supabase
      .from('wh40k_armies')
      .insert(payload)
      .select()
      .single();
    if (err) alert(`Duplizieren fehlgeschlagen: ${err.message}`);
    else loadArmies();
  }

  const factionLabel = (a) => data?.factionsById[a.faction]?.name || 'Keine Fraktion';
  const factionOrder = (data?.factions || []).map(f => f.name);

  return (
    <>
      {error && (
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: 'var(--space-3) var(--space-5)',
            color: 'var(--color-danger)',
          }}
        >
          {error}
        </div>
      )}
      <DashboardLayout
        title="Meine Armeen"
        newButtonLabel="+ Neue Armee"
        onNew={() => navigate('/wh40k/army/new')}
        items={armies}
        loading={loading}
        getCategory={factionLabel}
        categoryOrder={factionOrder}
        storageKey="wh40k-dashboard-collapsed"
        emptyIcon="✦"
        emptyTitle="Noch keine Armeen"
        emptyDescription="Erstelle deine erste 40K-Armee, um loszulegen."
        renderItem={(army) => (
          <ArmyCard
            key={army.id}
            army={army}
            unitsById={data?.unitsById || {}}
            faction={data?.factionsById[army.faction]}
            onOpen={() => navigate(`/wh40k/army/${army.id}`)}
            onDelete={() => handleDelete(army.id, army.name)}
            onDuplicate={() => handleDuplicate(army)}
          />
        )}
      />

      <ImportedSection
        title="Importierte Armeen"
        entities={imports.entities}
        owners={imports.owners}
        loading={imports.loading}
        tableMissing={imports.tableMissing}
        domain="wh40k_army"
        onImport={imports.add}
        onRemove={imports.remove}
        getSubCategory={(army) => data?.factionsById[army.faction]?.name || 'Unbekannte Fraktion'}
        subCategoryOrder={factionOrder}
        storageKey="wh40k-imports-collapsed"
        renderItem={(army, ctx) => (
          <ArmyCard
            key={army.id}
            army={army}
            unitsById={data?.unitsById || {}}
            faction={data?.factionsById[army.faction]}
            onOpen={() => navigate(`/wh40k/army/view/${army.share_token}`)}
            onRemove={ctx.onRemove}
            readOnly
            ownerName={ctx.ownerName}
          />
        )}
      />
    </>
  );
}

function ArmyCard({ army, unitsById, faction, onOpen, onDelete, onDuplicate, readOnly = false, ownerName, onRemove }) {
  const data = army.data || {};
  const entries = data.entries || {};
  const totalPts = totalArmyPoints(entries, unitsById);
  const totalUnits = Object.values(entries).reduce((s, e) => s + (e.count || 0), 0);

  return (
    <Panel
      onClick={onOpen}
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        position: 'relative',
        overflow: 'hidden',
        transition: 'border-color var(--transition)',
        borderTop: faction ? `3px solid ${faction.color || 'var(--color-accent)'}` : undefined,
      }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--color-accent)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 'var(--fs-lg)',
              fontWeight: 'var(--fw-semibold)',
              marginBottom: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {army.name || 'Unbenannte Armee'}
          </div>
          {faction && (
            <div
              style={{
                display: 'inline-block',
                fontSize: 'var(--fs-xs)',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {faction.name}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {readOnly ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
              style={iconBtnStyle}
              title="Import entfernen"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-dim)'}
            >⊘</button>
          ) : (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
                style={iconBtnStyle}
                title="Armee duplizieren"
              >⎘</button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                style={iconBtnStyle}
                title="Armee löschen"
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-dim)'}
              >✕</button>
            </>
          )}
        </div>
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

      <div
        style={{
          display: 'flex',
          gap: 'var(--space-4)',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--fs-sm)',
          alignItems: 'center',
        }}
      >
        <div>
          <span style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-semibold)' }}>{totalUnits}</span>
          {' '}Einheiten
        </div>
        <div style={{ marginLeft: 'auto', color: 'var(--color-accent)', fontWeight: 'var(--fw-semibold)', fontVariantNumeric: 'tabular-nums' }}>
          {totalPts} Pkt
        </div>
      </div>

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          fontSize: 'var(--fs-xs)',
          color: 'var(--color-text-dim)',
          borderTop: '1px solid var(--color-border)',
          paddingTop: 'var(--space-2)',
        }}
      >
        <span>Aktualisiert: {new Date(army.updated_at).toLocaleDateString('de-DE')}</span>
        <span style={{ flex: 1 }} />
        {army.share_token && <ShareTokenBadge token={army.share_token} label="Armee-Token" compact />}
      </div>
    </Panel>
  );
}

const iconBtnStyle = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-dim)',
  cursor: 'pointer',
  padding: 4,
  borderRadius: 4,
  fontSize: 14,
};
