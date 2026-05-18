// src/features/wh40k/components/SquadBuilderModal.jsx
//
// Create-or-edit dialog for a single WH40K squad — the named preset of
// (unit, modelCount, wargearOptionIds, notes) that the user can later
// drop into an army with one tap.
//
// Two entry points:
//
//   1. From InventoryPage ("Squad anlegen" inside a faction section).
//      The unit is preselected (the unit-card the user tapped) and the
//      filtered unit list is hidden — they only edit size/wargear/name.
//
//   2. From Wh40kArmyBuilderApp (Trupps tab → "Neuer Trupp"). Here the
//      modal also shows a unit picker because the user may want to build
//      a squad from a unit they don't own.
//
// Mobile-first: the Modal component already turns into a bottom-sheet on
// PWA via the `data-modal-root` / `data-modal-card` hooks in pwa.css, so
// we only need to keep our internal layout single-column-friendly.

import { useEffect, useMemo, useState } from 'react';
import { Modal, Button } from '../../../shared/ui';
import { SearchBar } from '../../../shared/search';
import { FilterChip } from '../../../shared/filters';
import { getSquadSizeRange, squadPoints } from '../hooks/useWh40kSquads';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {object} props.data - useWh40kData result (`units`, `unitsById`,
 *                              `factionsById`, `wargearOptionsByUnit`?)
 * @param {Array} props.canonicalWargear - canonical.wargearOptions array
 * @param {object} [props.initial] - existing squad to edit; omit for new
 * @param {string} [props.lockedUnitId] - if set, unit picker is hidden
 *                                        and only this unit's settings
 *                                        are editable
 * @param {string} [props.factionFilter] - prefilter unit picker to this
 *                                          faction (e.g. when the user
 *                                          opens the modal from a faction
 *                                          section in the inventory)
 * @param {(squad: object) => Promise<void>} props.onSave
 */
export default function SquadBuilderModal({
  open,
  onClose,
  data,
  canonicalWargear,
  initial,
  lockedUnitId,
  factionFilter,
  onSave,
}) {
  const editing = !!initial;
  const [unitId, setUnitId] = useState(initial?.unitId || lockedUnitId || '');
  const [name, setName] = useState(initial?.name || '');
  const [modelCount, setModelCount] = useState(initial?.modelCount ?? 1);
  const [wargearOptionIds, setWargearOptionIds] = useState(
    initial?.wargearOptionIds || []
  );
  const [notes, setNotes] = useState(initial?.notes || '');
  const [unitSearch, setUnitSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Reset state whenever the modal re-opens with new initial values.
  useEffect(() => {
    if (!open) return;
    setUnitId(initial?.unitId || lockedUnitId || '');
    setName(initial?.name || '');
    setModelCount(initial?.modelCount ?? 1);
    setWargearOptionIds(initial?.wargearOptionIds || []);
    setNotes(initial?.notes || '');
    setUnitSearch('');
    setError(null);
  }, [open, initial, lockedUnitId]);

  const unit = unitId ? data?.unitsById[unitId] : null;
  const faction = unit ? data?.factionsById[unit.factionId] : null;
  const sizeRange = useMemo(() => getSquadSizeRange(unit), [unit]);

  // When a unit is selected, snap the model count into its legal range
  // and propose a default squad name.
  useEffect(() => {
    if (!unit) return;
    setModelCount(prev => {
      const n = Number(prev) || sizeRange.min;
      if (n < sizeRange.min) return sizeRange.min;
      if (n > sizeRange.max) return sizeRange.max;
      return n;
    });
    setName(prev => prev || `${unit.name}`);
  }, [unit, sizeRange.min, sizeRange.max]);

  const wargearForUnit = useMemo(() => {
    if (!unit || !canonicalWargear) return [];
    return canonicalWargear.filter(w => w.unitId === unit.id);
  }, [unit, canonicalWargear]);

  const filteredUnits = useMemo(() => {
    if (!data) return [];
    const q = unitSearch.trim().toLowerCase();
    let pool = data.units;
    if (factionFilter) pool = pool.filter(u => u.factionId === factionFilter);
    if (q) pool = pool.filter(u => u.name.toLowerCase().includes(q));
    return pool.slice(0, 80); // keep the picker fast on mobile
  }, [data, unitSearch, factionFilter]);

  const points = useMemo(() => squadPoints(unit, modelCount), [unit, modelCount]);

  const toggleWargear = (id) => {
    setWargearOptionIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const canSave = !!unit && !!name.trim() && modelCount >= sizeRange.min && modelCount <= sizeRange.max;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: initial?.id,
        unitId: unit.id,
        factionId: unit.factionId,
        name: name.trim(),
        modelCount,
        wargearOptionIds,
        notes: notes.trim(),
      });
      onClose();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={saving}>Abbrechen</Button>
      <Button onClick={handleSave} disabled={!canSave || saving}>
        {saving ? 'Speichere…' : editing ? 'Aktualisieren' : 'Speichern'}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Trupp bearbeiten' : 'Neuen Trupp erstellen'}
      width={620}
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {!lockedUnitId && !editing && (
          <section>
            <Label>Einheit wählen</Label>
            <SearchBar
              value={unitSearch}
              onChange={setUnitSearch}
              placeholder="Einheit suchen…"
            />
            <div
              style={{
                marginTop: 'var(--space-2)',
                maxHeight: 220,
                overflowY: 'auto',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface)',
              }}
            >
              {filteredUnits.length === 0 ? (
                <div style={{
                  padding: 'var(--space-3)',
                  color: 'var(--color-text-muted)',
                  fontSize: 'var(--fs-sm)',
                  textAlign: 'center',
                }}>
                  Keine Einheiten gefunden.
                </div>
              ) : filteredUnits.map(u => {
                const fc = data?.factionsById[u.factionId];
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setUnitId(u.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 10px',
                      border: 'none',
                      background: unitId === u.id ? 'var(--color-accent)' : 'transparent',
                      color: unitId === u.id ? 'var(--color-accent-contrast)' : 'var(--color-text)',
                      cursor: 'pointer',
                      fontSize: 'var(--fs-sm)',
                      fontFamily: 'inherit',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    {fc?.icon && <span>{fc.icon}</span>}
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.name}
                    </span>
                    <span style={{ opacity: 0.7, fontSize: 'var(--fs-xs)' }}>
                      {u.points ?? '—'} Pkt
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {unit ? (
          <>
            <section style={summaryStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {faction?.icon && <span style={{ fontSize: 22 }}>{faction.icon}</span>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {unit.name}
                  </div>
                  {faction && (
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {faction.name}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)', color: 'var(--color-accent)', fontVariantNumeric: 'tabular-nums' }}>
                    {points} Pkt
                  </div>
                  {unit.composition?.text && (
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
                      {unit.composition.text}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section>
              <Label>Trupp-Name</Label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. „Veteranen, links"
                style={textInputStyle}
              />
            </section>

            <section>
              <Label>
                Modelle{' '}
                {sizeRange.fixed ? (
                  <span style={hintStyle}>(festgelegt: {sizeRange.min})</span>
                ) : (
                  <span style={hintStyle}>(erlaubt: {sizeRange.min}–{sizeRange.max})</span>
                )}
              </Label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  onClick={() => setModelCount(n => Math.max(sizeRange.min, n - 1))}
                  disabled={sizeRange.fixed || modelCount <= sizeRange.min}
                  style={stepBtnStyle}
                >−</button>
                <input
                  type="number"
                  value={modelCount}
                  min={sizeRange.min}
                  max={sizeRange.max}
                  disabled={sizeRange.fixed}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isNaN(v)) return;
                    setModelCount(Math.max(sizeRange.min, Math.min(sizeRange.max, v)));
                  }}
                  style={{ ...textInputStyle, width: 80, textAlign: 'center' }}
                />
                <button
                  type="button"
                  onClick={() => setModelCount(n => Math.min(sizeRange.max, n + 1))}
                  disabled={sizeRange.fixed || modelCount >= sizeRange.max}
                  style={stepBtnStyle}
                >+</button>
                {!sizeRange.fixed && Array.isArray(unit.pointsCosts) && unit.pointsCosts.length > 1 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginLeft: 'var(--space-2)' }}>
                    {unit.pointsCosts.map(t => (
                      <FilterChip
                        key={t.models}
                        active={Number(t.models) === Number(modelCount)}
                        onClick={() => setModelCount(Number(t.models))}
                        title={`${t.models} Modelle → ${t.cost} Pkt`}
                      >
                        {t.models}/{t.cost}p
                      </FilterChip>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {wargearForUnit.length > 0 && (
              <section>
                <Label>Wargear-Optionen</Label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {wargearForUnit.map(w => {
                    const checked = wargearOptionIds.includes(w.id);
                    return (
                      <label
                        key={w.id}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 'var(--space-2)',
                          padding: 'var(--space-2)',
                          background: checked ? 'color-mix(in srgb, var(--color-accent) 12%, var(--color-surface))' : 'var(--color-surface)',
                          border: '1px solid',
                          borderColor: checked ? 'var(--color-accent)' : 'var(--color-border)',
                          borderRadius: 'var(--radius-md)',
                          cursor: 'pointer',
                          fontSize: 'var(--fs-sm)',
                          lineHeight: 1.35,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleWargear(w.id)}
                          style={{ marginTop: 2 }}
                        />
                        <span style={{ flex: 1, minWidth: 0 }}>{w.text}</span>
                      </label>
                    );
                  })}
                </div>
              </section>
            )}

            <section>
              <Label>Notizen <span style={hintStyle}>(optional)</span></Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Hervorhebungen, Bemalstand, Loadout-Details…"
                style={{ ...textInputStyle, resize: 'vertical', minHeight: 64 }}
              />
            </section>
          </>
        ) : (
          <div style={{
            padding: 'var(--space-5)',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            background: 'var(--color-surface)',
            border: '1px dashed var(--color-border)',
            borderRadius: 'var(--radius-md)',
          }}>
            Wähle oben eine Einheit, um den Trupp zu konfigurieren.
          </div>
        )}

        {error && (
          <div style={{
            padding: 'var(--space-2) var(--space-3)',
            color: 'var(--color-danger)',
            background: 'color-mix(in srgb, var(--color-danger) 14%, transparent)',
            border: '1px solid var(--color-danger)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--fs-sm)',
          }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Label({ children }) {
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
  );
}

const textInputStyle = {
  width: '100%',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '8px 10px',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const stepBtnStyle = {
  width: 36,
  height: 36,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 18,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const summaryStyle = {
  padding: 'var(--space-3)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
};

const hintStyle = {
  fontWeight: 'var(--fw-regular)',
  textTransform: 'none',
  letterSpacing: 0,
  color: 'var(--color-text-muted)',
};
