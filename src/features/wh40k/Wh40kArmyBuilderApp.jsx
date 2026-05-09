// src/features/wh40k/Wh40kArmyBuilderApp.jsx
//
// The Warhammer 40K army builder. Mirrors the structure of MTG's deck
// builder: full-bleed page, search/results in the centre, roster panel on
// the right rail. Reuses the shared favourites + inventory hooks and the
// existing UI primitives.
//
// Persistence: rows in the `wh40k_armies` table (jsonb `data` column).
// Schema lives in `scripts/wh40k-schema.sql`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../core/supabase/client';
import { useAuth } from '../../core/auth/AuthContext';
import { useWh40kData } from './hooks/useWh40kData';
import { useWh40kFavorites } from './hooks/useWh40kFavorites';
import { useWh40kInventory } from './hooks/useWh40kInventory';
import { emptyFilters, filterAndSortUnits } from './services/filterUnits';
import { copyArmyToClipboard } from './services/armyExport';
import { validateArmy } from './services/validation';
import UnitFilters from './components/UnitFilters';
import UnitGrid from './components/UnitGrid';
import UnitDetail from './components/UnitDetail';
import ArmyPanel from './components/ArmyPanel';

const EMPTY_ARMY = {
  name: 'Unbenannte Armee',
  factionId: '',
  detachmentId: '',
  notes: '',
  entries: {},
};

export default function Wh40kArmyBuilderApp() {
  const { armyId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, loading: dataLoading, error: dataError } = useWh40kData();
  const favs = useWh40kFavorites();
  const inv = useWh40kInventory();

  const [army, setArmy] = useState(EMPTY_ARMY);
  const [loadingArmy, setLoadingArmy] = useState(!!armyId);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [exportStatus, setExportStatus] = useState(null);

  const [filters, setFilters] = useState(() => emptyFilters());
  const [selectedUnitId, setSelectedUnitId] = useState(null);

  const [dirty, setDirty] = useState(false);
  const skipDirtyRef = useRef(false);

  // ── Load existing army ───────────────────────────────
  useEffect(() => {
    if (!armyId || !user) return;
    let cancelled = false;
    (async () => {
      setLoadingArmy(true);
      const { data: row, error: err } = await supabase
        .from('wh40k_armies')
        .select('*')
        .eq('id', armyId)
        .eq('user_id', user.id)
        .single();
      if (cancelled) return;
      if (err) {
        setLoadError(err.message);
        setLoadingArmy(false);
        return;
      }
      skipDirtyRef.current = true;
      setArmy({
        name: row.name || 'Unbenannte Armee',
        factionId: row.faction || '',
        detachmentId: row.detachment || '',
        notes: row.data?.notes || '',
        entries: row.data?.entries || {},
      });
      setLoadingArmy(false);
      setTimeout(() => { skipDirtyRef.current = false; }, 0);
    })();
    return () => { cancelled = true; };
  }, [armyId, user]);

  useEffect(() => {
    if (skipDirtyRef.current) return;
    setDirty(true);
  }, [army]);

  // ── Pre-scope filter to the army's faction by default ───────
  // Once a faction is chosen, the unit browser auto-restricts to it. The
  // user can opt out by clearing the chip, but the default is the right
  // call ~95% of the time.
  useEffect(() => {
    if (!army.factionId) return;
    setFilters(prev => prev.factionIds.length === 0
      ? { ...prev, factionIds: [army.factionId] }
      : prev);
  }, [army.factionId]);

  // ── Filtered + sorted unit list ──────────────────────
  const filteredUnits = useMemo(() => {
    if (!data) return [];
    return filterAndSortUnits(data.units, filters, {
      isFavorite: favs.isFavorite,
      isOwned: inv.isOwned,
    });
  }, [data, filters, favs.isFavorite, inv.isOwned]);

  const selectedUnit = data && selectedUnitId ? data.unitsById[selectedUnitId] : null;
  const selectedFaction = selectedUnit ? data?.factionsById[selectedUnit.factionId] : null;

  // ── Mutations ────────────────────────────────────────
  const addUnit = useCallback((unit) => {
    setArmy(prev => {
      const existing = prev.entries[unit.id];
      return {
        ...prev,
        entries: {
          ...prev.entries,
          [unit.id]: existing
            ? { ...existing, count: existing.count + 1 }
            : { unitId: unit.id, count: 1 },
        },
      };
    });
  }, []);

  const updateCount = useCallback((unitId, delta) => {
    setArmy(prev => {
      const e = prev.entries[unitId];
      if (!e) return prev;
      const next = e.count + delta;
      const entries = { ...prev.entries };
      if (next <= 0) delete entries[unitId];
      else entries[unitId] = { ...e, count: next };
      return { ...prev, entries };
    });
  }, []);

  const removeUnit = useCallback((unitId) => {
    setArmy(prev => {
      const entries = { ...prev.entries };
      delete entries[unitId];
      return { ...prev, entries };
    });
  }, []);

  const clearUnits = useCallback(() => {
    setArmy(prev => ({ ...prev, entries: {} }));
  }, []);

  const inArmyCount = useCallback(
    (unitId) => army.entries[unitId]?.count || 0,
    [army.entries]
  );

  // ── Inventory bumps from the unit grid ───────────────
  const incOwned = useCallback((unit) => {
    inv.adjustQuantity(unit.id, +1, unit.name);
  }, [inv]);
  const decOwned = useCallback((unit) => {
    inv.adjustQuantity(unit.id, -1, unit.name);
  }, [inv]);

  // ── Save ─────────────────────────────────────────────
  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setSaveStatus(null);
    const payload = {
      user_id: user.id,
      name: army.name.trim() || 'Unbenannte Armee',
      faction: army.factionId || null,
      detachment: army.detachmentId || null,
      data: { entries: army.entries, notes: army.notes },
      updated_at: new Date().toISOString(),
    };

    let result;
    if (armyId) {
      result = await supabase
        .from('wh40k_armies')
        .update(payload)
        .eq('id', armyId)
        .eq('user_id', user.id)
        .select()
        .single();
    } else {
      result = await supabase
        .from('wh40k_armies')
        .insert(payload)
        .select()
        .single();
    }

    setSaving(false);
    if (result.error) {
      setSaveStatus({ type: 'error', text: result.error.message });
      return;
    }
    setSaveStatus({ type: 'success', text: 'Gespeichert' });
    setDirty(false);
    setTimeout(() => setSaveStatus(null), 2000);

    if (!armyId && result.data?.id) {
      navigate(`/wh40k/army/${result.data.id}`, { replace: true });
    }
  }

  async function handleExport() {
    if (!data) return;
    const ok = await copyArmyToClipboard({
      army: { ...army, name: army.name },
      unitsById: data.unitsById,
      factionsById: data.factionsById,
      detachments: data.detachments,
    });
    setExportStatus(ok
      ? { type: 'success', text: 'In Zwischenablage kopiert' }
      : { type: 'error', text: 'Kopieren fehlgeschlagen' });
    setTimeout(() => setExportStatus(null), 2000);
  }

  // ── Validation (advisory) ────────────────────────────
  const validation = useMemo(() => {
    if (!data) return { warnings: [], errors: [] };
    return validateArmy(army, { unitsById: data.unitsById, detachments: data.detachments });
  }, [army, data]);

  // ── Loading / error states ───────────────────────────
  if (dataLoading || loadingArmy) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>
        Lade…
      </div>
    );
  }
  if (dataError) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{ color: 'var(--color-danger)', marginBottom: 12 }}>
          40K-Datensätze konnten nicht geladen werden: {dataError}
        </div>
      </div>
    );
  }
  if (loadError) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{ color: 'var(--color-danger)', marginBottom: 12 }}>Fehler: {loadError}</div>
        <button onClick={() => navigate('/wh40k')}>Zurück zum Dashboard</button>
      </div>
    );
  }

  const factionDetachments = data.detachmentsByFaction[army.factionId] || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Header
        army={army}
        setArmy={setArmy}
        factions={data.factions}
        detachments={factionDetachments}
        dirty={dirty}
        saving={saving}
        onSave={handleSave}
        saveStatus={saveStatus}
        exportStatus={exportStatus}
        onBack={() => navigate('/wh40k')}
      />

      {validation.errors.length > 0 && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-5)',
            background: 'color-mix(in srgb, var(--color-danger) 14%, transparent)',
            color: 'var(--color-danger)',
            fontSize: 'var(--fs-sm)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          {validation.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
        </div>
      )}

      <main
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 320px',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-5)',
          minHeight: 0,
        }}
      >
        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minHeight: 0 }}>
          <UnitFilters
            filters={filters}
            setFilters={setFilters}
            factions={data.factions}
            allKeywords={data.allKeywords}
            totalCount={data.units.length}
            shownCount={filteredUnits.length}
            loading={dataLoading}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: selectedUnit ? 'minmax(0, 1fr) minmax(280px, 360px)' : '1fr',
              gap: 'var(--space-3)',
              minHeight: 0,
            }}
          >
            <div style={{ overflowY: 'auto', minHeight: 0 }}>
              <UnitGrid
                units={filteredUnits}
                factionsById={data.factionsById}
                selectedId={selectedUnitId}
                onSelect={(u) => setSelectedUnitId(prev => prev === u.id ? null : u.id)}
                isFavorite={favs.isFavorite}
                onToggleFavorite={favs.toggleFavorite}
                getOwned={inv.getQuantity}
                onIncOwned={incOwned}
                onDecOwned={decOwned}
                onAdd={addUnit}
                inArmyCount={inArmyCount}
              />
            </div>
            {selectedUnit && (
              <aside style={{ overflowY: 'auto', minHeight: 0 }}>
                <UnitDetail unit={selectedUnit} faction={selectedFaction} />
              </aside>
            )}
          </div>
        </section>

        <aside
          style={{
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          <ArmyPanel
            army={army}
            unitsById={data.unitsById}
            factionsById={data.factionsById}
            detachments={data.detachments}
            onUpdateCount={updateCount}
            onRemove={removeUnit}
            onClear={clearUnits}
            onExport={handleExport}
          />
          <div
            style={{
              padding: 'var(--space-3)',
              borderTop: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <label
              style={{
                fontSize: 'var(--fs-xs)',
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                color: 'var(--color-text-muted)',
                fontWeight: 'var(--fw-semibold)',
              }}
            >
              Notizen
            </label>
            <textarea
              value={army.notes}
              onChange={(e) => setArmy(a => ({ ...a, notes: e.target.value }))}
              rows={3}
              placeholder="Strategie, Listenideen, …"
              style={{
                width: '100%',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2)',
                fontSize: 'var(--fs-sm)',
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
          </div>
        </aside>
      </main>
    </div>
  );
}

function Header({
  army, setArmy, factions, detachments,
  dirty, saving, onSave, saveStatus, exportStatus, onBack,
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-3) var(--space-5)',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-bg-elevated)',
        flexWrap: 'wrap',
      }}
    >
      <button
        type="button"
        onClick={onBack}
        title="Zurück zum Dashboard"
        style={{
          background: 'transparent',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
          padding: '4px 10px',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--fs-sm)',
          cursor: 'pointer',
        }}
      >
        ← Armeen
      </button>
      <input
        value={army.name}
        onChange={(e) => setArmy(a => ({ ...a, name: e.target.value }))}
        placeholder="Armee-Name…"
        style={{
          background: 'transparent',
          border: '1px solid transparent',
          padding: '4px 8px',
          fontSize: 'var(--fs-lg)',
          fontWeight: 'var(--fw-semibold)',
          color: 'var(--color-text)',
          fontFamily: 'inherit',
          minWidth: 200,
          borderRadius: 'var(--radius-md)',
        }}
        onFocus={(e) => e.target.style.borderColor = 'var(--color-border)'}
        onBlur={(e) => e.target.style.borderColor = 'transparent'}
      />
      <select
        value={army.factionId}
        onChange={(e) => setArmy(a => ({ ...a, factionId: e.target.value, detachmentId: '' }))}
        title="Fraktion"
        style={selectStyle}
      >
        <option value="">(Fraktion wählen)</option>
        {factions.map(f => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
      <select
        value={army.detachmentId}
        onChange={(e) => setArmy(a => ({ ...a, detachmentId: e.target.value }))}
        disabled={!army.factionId || detachments.length === 0}
        title="Detachment"
        style={selectStyle}
      >
        <option value="">(Detachment wählen)</option>
        {detachments.map(d => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>

      <div style={{ flex: 1 }} />

      {(saveStatus || exportStatus) && (
        <span
          style={{
            fontSize: 'var(--fs-sm)',
            color: (saveStatus || exportStatus).type === 'error'
              ? 'var(--color-danger)'
              : 'var(--color-success)',
          }}
        >
          {(saveStatus || exportStatus).text}
        </span>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        style={{
          background: dirty ? 'var(--color-accent)' : 'transparent',
          color: dirty ? 'var(--color-accent-contrast)' : 'var(--color-text-muted)',
          border: `1px solid ${dirty ? 'var(--color-accent)' : 'var(--color-border)'}`,
          padding: '6px 14px',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--fs-sm)',
          fontWeight: 'var(--fw-semibold)',
          cursor: saving ? 'wait' : 'pointer',
        }}
      >
        {saving ? 'Speichere…' : dirty ? 'Speichern' : '✓ Gespeichert'}
      </button>
    </header>
  );
}

const selectStyle = {
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '6px 8px',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  minHeight: 32,
};
