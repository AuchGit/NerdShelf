// src/features/wh40k/components/SquadBuilderModal.jsx
//
// Create-or-edit dialog for a multi-unit WH40K squad preset. A "squad"
// here is a named bundle of datasheet entries — e.g. "Intercessor
// Squad + attached Lieutenant + Apothecary" — that the user can drop
// into an army with one tap from the army builder. Each entry carries
// its own model count, wargear-option checklist and free-form notes;
// the squad as a whole gets a name, optional notes and is scoped to
// one faction so the unit picker stays focused.
//
// Entry points:
//
//   1. From InventoryPage — opens with a single starter entry seeded
//      by the unit-card the user tapped (`lockedFirstUnitId`), so they
//      don't have to search for it again.
//
//   2. From the army builder ("+ Neuer Squad") — opens empty, the
//      user picks units freely (also units they don't yet own).
//
//   3. Editing an existing squad — `initial` is passed and the editor
//      loads its entries for tweaking.
//
// Mobile-first: the Modal component already morphs into a bottom
// sheet on PWA via the `data-modal-root`/`data-modal-card` hooks in
// pwa.css, so we just keep the inner layout single-column-friendly.

import { useEffect, useMemo, useState } from 'react';
import { Modal, Button } from '../../../shared/ui';
import { SearchBar } from '../../../shared/search';
import { FilterChip } from '../../../shared/filters';
import {
  getSquadSizeRange,
  squadPoints,
  totalSquadPoints,
  emptySquadEntry,
} from '../hooks/useWh40kSquads';

export default function SquadBuilderModal({
  open,
  onClose,
  data,
  canonicalWargear,
  initial,
  lockedFirstUnitId,    // pre-fill the first entry with this unit id
  factionFilter,        // restrict unit picker to one faction
  onSave,
}) {
  const editing = !!initial;
  const [name, setName] = useState('');
  const [entries, setEntries] = useState([]);
  const [notes, setNotes] = useState('');
  const [factionId, setFactionId] = useState(factionFilter || null);
  const [pickerOpenForEntry, setPickerOpenForEntry] = useState(null);  // entry.id whose unit picker is open
  const [unitSearch, setUnitSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Re-initialise whenever the modal opens with new initial / locked inputs.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setUnitSearch('');
    setSaving(false);

    if (initial) {
      setName(initial.name || '');
      setNotes(initial.notes || '');
      setEntries((initial.entries || []).map(e => ({ ...e })));
      setFactionId(initial.factionId || factionFilter || null);
    } else {
      setName('');
      setNotes('');
      setFactionId(factionFilter || null);
      // Seed with a starter entry — pre-filled if a unit was tapped.
      const seed = emptySquadEntry(lockedFirstUnitId || null);
      setEntries([seed]);
      setPickerOpenForEntry(lockedFirstUnitId ? null : seed.id);
    }
  }, [open, initial, lockedFirstUnitId, factionFilter]);

  // Faction is derived from the entries (first unit's faction), but the
  // unit picker uses the locked-in factionId to constrain options.
  // When the user assigns the first unit, lock the faction to it.
  useEffect(() => {
    if (factionId) return;
    const first = entries.find(e => e.unitId);
    if (first && data?.unitsById?.[first.unitId]) {
      setFactionId(data.unitsById[first.unitId].factionId);
    }
  }, [entries, factionId, data]);

  // ── Pre-computed display helpers ───────────────────────
  const filteredUnits = useMemo(() => {
    if (!data) return [];
    const q = unitSearch.trim().toLowerCase();
    let pool = data.units;
    if (factionId) pool = pool.filter(u => u.factionId === factionId);
    if (q) pool = pool.filter(u => u.name.toLowerCase().includes(q));
    return pool.slice(0, 80);
  }, [data, unitSearch, factionId]);

  const total = useMemo(
    () => totalSquadPoints({ entries }, data?.unitsById || {}),
    [entries, data]
  );

  const totalModels = useMemo(
    () => entries.reduce((s, e) => s + (Number(e.modelCount) || 0), 0),
    [entries]
  );

  const factionName = factionId
    ? (data?.factionsById?.[factionId]?.name || factionId)
    : 'Keine Fraktion';

  // ── Mutations ──────────────────────────────────────────
  const patchEntry = (entryId, patch) => {
    setEntries(prev => prev.map(e => e.id === entryId ? { ...e, ...patch } : e));
  };
  const removeEntry = (entryId) => {
    setEntries(prev => prev.filter(e => e.id !== entryId));
  };
  const addEntry = () => {
    const e = emptySquadEntry();
    setEntries(prev => [...prev, e]);
    setPickerOpenForEntry(e.id);
    setUnitSearch('');
  };
  const assignUnit = (entryId, unit) => {
    patchEntry(entryId, {
      unitId: unit.id,
      modelCount: getSquadSizeRange(unit).min,
      wargearOptionIds: [],
    });
    if (!factionId) setFactionId(unit.factionId);
    setPickerOpenForEntry(null);
  };

  const canSave =
    !!name.trim() &&
    entries.length > 0 &&
    entries.every(e => e.unitId);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: initial?.id,
        name: name.trim(),
        factionId,
        entries: entries.map(e => {
          const unit = data?.unitsById?.[e.unitId];
          const range = getSquadSizeRange(unit);
          const clamped = Math.max(range.min, Math.min(range.max, Number(e.modelCount) || range.min));
          return {
            id: e.id,
            unitId: e.unitId,
            modelCount: clamped,
            wargearOptionIds: Array.isArray(e.wargearOptionIds) ? e.wargearOptionIds : [],
            notes: e.notes || '',
          };
        }),
        notes: notes.trim(),
      });
      onClose();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────
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
      title={editing ? 'Squad bearbeiten' : 'Neuen Squad erstellen'}
      width={720}
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {/* Squad-level inputs */}
        <section>
          <Label>Squad-Name</Label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. „Anvil-Spearhead"
            style={textInputStyle}
          />
        </section>

        {/* Summary banner */}
        <div style={summaryStyle}>
          <span style={{ color: 'var(--color-text-muted)' }}>Fraktion:</span>
          <strong style={{ color: 'var(--color-text)' }}>{factionName}</strong>
          <span style={{ flex: 1 }} />
          <span style={{ color: 'var(--color-text-muted)' }}>
            {entries.length} {entries.length === 1 ? 'Einheit' : 'Einheiten'} ·{' '}
            <strong style={{ color: 'var(--color-text)' }}>{totalModels}</strong> Modelle
          </span>
          <span style={{
            color: 'var(--color-accent)',
            fontWeight: 'var(--fw-semibold)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {total} Pkt
          </span>
        </div>

        {/* Entries */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Label>Einheiten im Squad</Label>
          {entries.map((entry, idx) => (
            <SquadEntryRow
              key={entry.id}
              entry={entry}
              index={idx}
              data={data}
              canonicalWargear={canonicalWargear}
              pickerOpen={pickerOpenForEntry === entry.id}
              unitSearch={unitSearch}
              setUnitSearch={setUnitSearch}
              filteredUnits={filteredUnits}
              factionLocked={!!factionId}
              onOpenPicker={() => { setPickerOpenForEntry(entry.id); setUnitSearch(''); }}
              onClosePicker={() => setPickerOpenForEntry(null)}
              onAssignUnit={(unit) => assignUnit(entry.id, unit)}
              onPatch={(patch) => patchEntry(entry.id, patch)}
              onRemove={entries.length > 1 ? () => removeEntry(entry.id) : null}
            />
          ))}
          <button
            type="button"
            onClick={addEntry}
            style={addEntryBtnStyle}
          >
            + Einheit hinzufügen
          </button>
        </section>

        {/* Squad-level notes */}
        <section>
          <Label>Notizen <span style={hintStyle}>(optional)</span></Label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Wofür dieser Squad gedacht ist…"
            style={{ ...textInputStyle, resize: 'vertical', minHeight: 56 }}
          />
        </section>

        {error && (
          <div style={errorStyle}>{error}</div>
        )}
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────── */

function SquadEntryRow({
  entry, index, data, canonicalWargear,
  pickerOpen, unitSearch, setUnitSearch, filteredUnits, factionLocked,
  onOpenPicker, onClosePicker, onAssignUnit, onPatch, onRemove,
}) {
  const unit = entry.unitId ? data?.unitsById?.[entry.unitId] : null;
  const sizeRange = useMemo(() => getSquadSizeRange(unit), [unit]);
  const pts = useMemo(() => squadPoints(unit, entry.modelCount), [unit, entry.modelCount]);

  const wargearForUnit = useMemo(() => {
    if (!unit || !canonicalWargear) return [];
    return canonicalWargear.filter(w => w.unitId === unit.id);
  }, [unit, canonicalWargear]);

  const toggleWargear = (id) => {
    const next = entry.wargearOptionIds.includes(id)
      ? entry.wargearOptionIds.filter(x => x !== id)
      : [...entry.wargearOptionIds, id];
    onPatch({ wargearOptionIds: next });
  };

  return (
    <div style={entryStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <span style={entryNumStyle}>{index + 1}</span>
        {unit ? (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {unit.name}
              </div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
                {unit.composition?.text || `${entry.modelCount} Modell${entry.modelCount === 1 ? '' : 'e'}`} · {pts} Pkt
              </div>
            </div>
            <button type="button" onClick={onOpenPicker} style={miniLinkBtnStyle}>Ändern</button>
          </>
        ) : (
          <button type="button" onClick={onOpenPicker} style={pickPromptBtnStyle}>
            Einheit auswählen…
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Aus Squad entfernen"
            style={removeBtnStyle}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-dim)'}
          >✕</button>
        )}
      </div>

      {/* Inline picker */}
      {pickerOpen && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SearchBar
            value={unitSearch}
            onChange={setUnitSearch}
            placeholder={factionLocked ? 'Einheit dieser Fraktion suchen…' : 'Einheit suchen…'}
          />
          <div style={pickerListStyle}>
            {filteredUnits.length === 0 ? (
              <div style={pickerEmptyStyle}>Keine Einheiten gefunden.</div>
            ) : filteredUnits.map(u => {
              const fc = data?.factionsById?.[u.factionId];
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onAssignUnit(u)}
                  style={pickerItemStyle}
                >
                  {fc?.icon && <span style={{ marginRight: 4 }}>{fc.icon}</span>}
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
          <button type="button" onClick={onClosePicker} style={miniLinkBtnStyle}>Abbrechen</button>
        </div>
      )}

      {/* Per-entry size + wargear (only when a unit is assigned) */}
      {unit && !pickerOpen && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Size */}
          <div>
            <SubLabel>
              Modelle{' '}
              {sizeRange.fixed
                ? <span style={hintStyle}>(festgelegt: {sizeRange.min})</span>
                : <span style={hintStyle}>(erlaubt: {sizeRange.min}–{sizeRange.max})</span>}
            </SubLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => onPatch({ modelCount: Math.max(sizeRange.min, (entry.modelCount || sizeRange.min) - 1) })}
                disabled={sizeRange.fixed || entry.modelCount <= sizeRange.min}
                style={stepBtnStyle}
              >−</button>
              <input
                type="number"
                value={entry.modelCount}
                min={sizeRange.min}
                max={sizeRange.max}
                disabled={sizeRange.fixed}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isNaN(v)) return;
                  onPatch({ modelCount: Math.max(sizeRange.min, Math.min(sizeRange.max, v)) });
                }}
                style={{ ...textInputStyle, width: 80, textAlign: 'center' }}
              />
              <button
                type="button"
                onClick={() => onPatch({ modelCount: Math.min(sizeRange.max, (entry.modelCount || sizeRange.min) + 1) })}
                disabled={sizeRange.fixed || entry.modelCount >= sizeRange.max}
                style={stepBtnStyle}
              >+</button>
              {!sizeRange.fixed && Array.isArray(unit.pointsCosts) && unit.pointsCosts.length > 1 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginLeft: 'var(--space-2)' }}>
                  {unit.pointsCosts.map(t => (
                    <FilterChip
                      key={t.models}
                      active={Number(t.models) === Number(entry.modelCount)}
                      onClick={() => onPatch({ modelCount: Number(t.models) })}
                      title={`${t.models} Modelle → ${t.cost} Pkt`}
                    >
                      {t.models}/{t.cost}p
                    </FilterChip>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Wargear */}
          {wargearForUnit.length > 0 && (
            <details>
              <summary style={summaryToggleStyle}>
                Wargear-Optionen ({entry.wargearOptionIds.length}/{wargearForUnit.length})
              </summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                {wargearForUnit.map(w => {
                  const checked = entry.wargearOptionIds.includes(w.id);
                  return (
                    <label
                      key={w.id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 'var(--space-2)',
                        padding: 'var(--space-2)',
                        background: checked
                          ? 'color-mix(in srgb, var(--color-accent) 10%, var(--color-surface))'
                          : 'var(--color-surface)',
                        border: '1px solid',
                        borderColor: checked ? 'var(--color-accent)' : 'var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        fontSize: 'var(--fs-xs)',
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
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────── */

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
function SubLabel({ children }) {
  return (
    <div style={{
      fontSize: 'var(--fs-xs)',
      color: 'var(--color-text-muted)',
      marginBottom: 4,
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
  width: 32,
  height: 32,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 16,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const summaryStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 'var(--space-2) var(--space-3)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
  flexWrap: 'wrap',
};
const entryStyle = {
  padding: 'var(--space-3)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
};
const entryNumStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  background: 'var(--color-accent)',
  color: 'var(--color-accent-contrast)',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 'var(--fw-bold)',
  flexShrink: 0,
};
const removeBtnStyle = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-dim)',
  cursor: 'pointer',
  padding: 4,
  borderRadius: 4,
  fontSize: 14,
};
const addEntryBtnStyle = {
  padding: '10px 12px',
  background: 'transparent',
  color: 'var(--color-accent)',
  border: '1px dashed var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const pickPromptBtnStyle = {
  flex: 1,
  padding: '6px 10px',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  border: '1px dashed var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
};
const miniLinkBtnStyle = {
  background: 'transparent',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)',
  padding: '4px 8px',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-xs)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const pickerListStyle = {
  maxHeight: 220,
  overflowY: 'auto',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg-elevated)',
};
const pickerEmptyStyle = {
  padding: 'var(--space-3)',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--fs-sm)',
  textAlign: 'center',
};
const pickerItemStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  width: '100%',
  textAlign: 'left',
  padding: '6px 10px',
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text)',
  cursor: 'pointer',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  borderBottom: '1px solid var(--color-border)',
};
const summaryToggleStyle = {
  fontSize: 'var(--fs-xs)',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  userSelect: 'none',
};
const hintStyle = {
  fontWeight: 'var(--fw-regular)',
  textTransform: 'none',
  letterSpacing: 0,
  color: 'var(--color-text-muted)',
};
const errorStyle = {
  padding: 'var(--space-2) var(--space-3)',
  color: 'var(--color-danger)',
  background: 'color-mix(in srgb, var(--color-danger) 14%, transparent)',
  border: '1px solid var(--color-danger)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
};
