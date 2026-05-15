// src/features/wh40k/combat/MissionSetup.jsx
//
// Pre-game setup. Replaces the inline "pick an army" picker in the
// Combat Dashboard with a richer flow that captures everything you
// actually need to start a 40K battle:
//
//   1. Army (or "no army")
//   2. Opponent name + faction (free text — for the session log)
//   3. Game size (Combat Patrol / Incursion / Strike Force / Onslaught)
//   4. Mission deck + Primary mission + Deployment map
//   5. Secondary mode (Fixed / Tactical) + up to 2 Fixed Secondaries
//
// The form is one screen, scrollable on mobile, and validates only the
// hard requirements (game size + primary). Everything else can be left
// blank and filled in mid-game — the helper is a companion, not a
// gatekeeper.

import { useMemo, useState } from 'react';
import { Panel, Button } from '../../../shared/ui';
import {
  GAME_SIZES, MISSION_DECKS, DEPLOYMENT_MAPS,
  PRIMARY_MISSIONS, SECONDARY_MISSIONS,
  gameSizeById, primaryById, secondaryById,
  defaultMissionState,
} from './missions';

export default function MissionSetup({ armies, onCancel, onStart }) {
  const [state, setState] = useState(() => ({
    ...defaultMissionState(),
    armyId: null,
  }));

  const set = (patch) => setState(s => ({ ...s, ...patch }));

  // Pre-filter secondaries by the chosen mode.
  const availableSecondaries = useMemo(
    () => SECONDARY_MISSIONS.filter(s => s.kind === state.secondaryMode),
    [state.secondaryMode]
  );

  const selectedArmy = armies.find(a => a.id === state.armyId) || null;
  const selectedSize = gameSizeById(state.gameSize);
  const selectedPrimary = primaryById(state.primaryId);

  const canStart = !!state.gameSize; // Primary is recommended but optional

  function buildMission() {
    return {
      gameSize: state.gameSize,
      gameSizeLabel: selectedSize?.label || '',
      deckId: state.deckId,
      deployment: state.deployment,
      primary: selectedPrimary ? {
        id: selectedPrimary.id, name: selectedPrimary.name,
        scoring: selectedPrimary.scoring, maxScore: selectedPrimary.maxScore,
      } : null,
      secondaryMode: state.secondaryMode,
      secondaries: (state.secondaryIds || []).map(id => {
        const s = secondaryById(id);
        return s ? { id: s.id, name: s.name, scoring: s.scoring, maxScore: s.maxScore, kind: s.kind } : null;
      }).filter(Boolean),
      pointLimit: selectedSize?.points || state.pointLimit,
      opponentName: state.opponentName.trim(),
      opponentArmy: state.opponentArmy.trim(),
    };
  }

  function handleStart() {
    onStart({ army: selectedArmy, mission: buildMission() });
  }

  return (
    <Panel style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <strong style={{ fontSize: 'var(--fs-lg)' }}>Neue Schlacht</strong>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" onClick={onCancel}>Abbrechen</Button>
        <Button size="sm" onClick={handleStart} disabled={!canStart}>
          Schlacht starten
        </Button>
      </div>

      {/* ── 1. Armee ── */}
      <Section label="1. Armee">
        {armies.length === 0 ? (
          <div style={mutedStyle}>
            Noch keine Armeen gespeichert. Du kannst trotzdem starten — Einheiten lassen sich später nachtragen.
          </div>
        ) : (
          <div style={cardGridStyle}>
            <PickCard
              active={state.armyId === null}
              onClick={() => set({ armyId: null })}
              title="Ohne Armee"
              subtitle="Leere Sitzung — Einheiten manuell"
            />
            {armies.map(a => (
              <PickCard
                key={a.id}
                active={state.armyId === a.id}
                onClick={() => set({ armyId: a.id })}
                title={a.name || 'Unbenannte Armee'}
                subtitle={a.faction || 'Keine Fraktion'}
              />
            ))}
          </div>
        )}
      </Section>

      {/* ── 2. Gegner ── */}
      <Section label="2. Gegner (optional)">
        <div style={twoColRowStyle}>
          <input
            type="text"
            placeholder="Name des Gegners"
            value={state.opponentName}
            onChange={(e) => set({ opponentName: e.target.value })}
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Fraktion des Gegners"
            value={state.opponentArmy}
            onChange={(e) => set({ opponentArmy: e.target.value })}
            style={inputStyle}
          />
        </div>
      </Section>

      {/* ── 3. Spielgröße ── */}
      <Section label="3. Spielgröße">
        <div style={chipRowStyle}>
          {GAME_SIZES.map(g => (
            <ChoiceChip
              key={g.id}
              active={state.gameSize === g.id}
              onClick={() => set({ gameSize: g.id, pointLimit: g.points })}
            >
              {g.label} <span style={{ opacity: 0.7 }}>· {g.points} Pkt</span>
            </ChoiceChip>
          ))}
        </div>
      </Section>

      {/* ── 4. Mission ── */}
      <Section label="4. Mission">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div>
            <SubLabel>Mission Deck</SubLabel>
            <div style={chipRowStyle}>
              {MISSION_DECKS.map(d => (
                <ChoiceChip
                  key={d.id}
                  active={state.deckId === d.id}
                  onClick={() => set({ deckId: d.id })}
                >{d.label}</ChoiceChip>
              ))}
            </div>
          </div>

          <div>
            <SubLabel>Deployment Map</SubLabel>
            <div style={chipRowStyle}>
              <ChoiceChip active={state.deployment === ''} onClick={() => set({ deployment: '' })}>
                (offen)
              </ChoiceChip>
              {DEPLOYMENT_MAPS.map(d => (
                <ChoiceChip
                  key={d.id}
                  active={state.deployment === d.id}
                  onClick={() => set({ deployment: d.id })}
                >{d.label}</ChoiceChip>
              ))}
            </div>
          </div>

          <div>
            <SubLabel>Primary Mission</SubLabel>
            <div style={cardGridStyle}>
              {PRIMARY_MISSIONS.map(p => (
                <PickCard
                  key={p.id}
                  active={state.primaryId === p.id}
                  onClick={() => set({ primaryId: state.primaryId === p.id ? '' : p.id })}
                  title={p.name}
                  subtitle={p.summary}
                  detail={p.scoring}
                />
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ── 5. Secondaries ── */}
      <Section label="5. Secondary Missions">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={chipRowStyle}>
            <ChoiceChip
              active={state.secondaryMode === 'fixed'}
              onClick={() => set({ secondaryMode: 'fixed', secondaryIds: [] })}
            >Fixed (2 wählen)</ChoiceChip>
            <ChoiceChip
              active={state.secondaryMode === 'tactical'}
              onClick={() => set({ secondaryMode: 'tactical', secondaryIds: [] })}
            >Tactical (Karten ziehen)</ChoiceChip>
          </div>
          {state.secondaryMode === 'fixed' ? (
            <div style={cardGridStyle}>
              {availableSecondaries.map(s => {
                const selected = state.secondaryIds.includes(s.id);
                return (
                  <PickCard
                    key={s.id}
                    active={selected}
                    onClick={() => {
                      const next = selected
                        ? state.secondaryIds.filter(x => x !== s.id)
                        : (state.secondaryIds.length < 2
                            ? [...state.secondaryIds, s.id]
                            : [state.secondaryIds[1], s.id]);
                      set({ secondaryIds: next });
                    }}
                    title={s.name}
                    subtitle={s.summary}
                    detail={s.scoring}
                  />
                );
              })}
            </div>
          ) : (
            <div style={mutedStyle}>
              Tactical-Modus: keine Vorauswahl. Während des Spiels kannst du die gezogenen
              Sekundärziele jederzeit als Notiz erfassen.
            </div>
          )}
        </div>
      </Section>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
        <Button variant="ghost" onClick={onCancel}>Abbrechen</Button>
        <Button onClick={handleStart} disabled={!canStart}>Schlacht starten</Button>
      </div>
    </Panel>
  );
}

/* ─────────────────── sub-views ─────────────────── */

function Section({ label, children }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <h3 style={{
        margin: 0, fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)',
        color: 'var(--color-text)',
      }}>{label}</h3>
      {children}
    </section>
  );
}

function SubLabel({ children }) {
  return (
    <div style={{
      fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)',
      textTransform: 'uppercase', letterSpacing: 0.4,
      marginBottom: 4, fontWeight: 'var(--fw-semibold)',
    }}>{children}</div>
  );
}

function ChoiceChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 12px', minHeight: 36,
        background: active ? 'var(--color-accent)' : 'var(--color-surface)',
        color: active ? 'var(--color-accent-contrast)' : 'var(--color-text)',
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderRadius: 999,
        fontSize: 'var(--fs-sm)',
        fontWeight: active ? 'var(--fw-semibold)' : 'var(--fw-medium)',
        cursor: 'pointer', fontFamily: 'inherit',
      }}
    >{children}</button>
  );
}

function PickCard({ active, onClick, title, subtitle, detail }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: 'var(--space-3)',
        background: active
          ? 'color-mix(in srgb, var(--color-accent) 12%, var(--color-bg-sunken))'
          : 'var(--color-bg-sunken)',
        color: 'var(--color-text)',
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}
    >
      <div style={{
        fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{
          width: 16, height: 16, borderRadius: '50%',
          border: '1px solid currentColor',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, flexShrink: 0,
        }}>{active ? '●' : ''}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </span>
      </div>
      {subtitle && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
          {subtitle}
        </div>
      )}
      {detail && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-dim)' }}>
          {detail}
        </div>
      )}
    </button>
  );
}

const cardGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 'var(--space-2)',
};
const chipRowStyle = {
  display: 'flex', flexWrap: 'wrap', gap: 4,
};
const twoColRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 'var(--space-2)',
};
const inputStyle = {
  width: '100%', minHeight: 40,
  padding: '8px 12px',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontFamily: 'inherit', fontSize: 'var(--fs-sm)',
};
const mutedStyle = {
  fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)',
  padding: 'var(--space-2) 0',
};
