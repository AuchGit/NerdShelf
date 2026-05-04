// src/features/mtg/deck-builder/components/DeckAnalyzerModal.jsx
import { Fragment, useMemo, useState } from 'react';
import { Modal, Button } from '../../../../shared/ui';
import {
  suggestLands,
  MANA_MODES,
  getModeLabel,
  modeToConfig,
  DEFAULT_CONFIG,
} from '../services/landSuggestion';
import { runSimulation } from '../services/consistencySim';
import { applyLandBreakdown } from '../services/applyLandSuggestion';
import { isLand } from '../services/deckAnalysis';
import './DeckAnalyzerModal.css';

const COLOR_LABEL = { W: 'W', U: 'U', B: 'B', R: 'R', G: 'G' };

const DEFAULT_RULES = () => ([
  {
    id: 'mulligan',
    type: 'MULLIGAN_TRIGGER',
    label: 'Garantierter Mulligan',
    minLands: 2,
    maxLands: 5,
    groups: [],
  },
  {
    id: 'general',
    type: 'GENERAL_HAND_QUALITY',
    label: 'Keepable Hand',
    minLands: 2,
    maxLands: 5,
    requirePlayByTurn: 2,
    groups: [],
  },
  {
    id: 'perfect',
    type: 'PERFECT_START',
    label: 'Perfekter Start',
    minLands: 3,
    maxLands: 4,
    groups: [],
  },
]);

const SLIDERS = [
  { key: 'tempo',     label: 'Tempo',      min: 'stabil',     max: 'schnell',
    tip: 'Höher → weniger getappte Länder, weniger Land-Slots' },
  { key: 'earlyGame', label: 'Early Game', min: 'late',       max: 'early',
    tip: 'Höher → frühere Curve, härtere Bestrafung getappter Länder' },
  { key: 'budget',    label: 'Budget',     min: 'premium ok', max: 'budget only',
    tip: 'Höher → Pathways/teure Duals werden gemieden, mehr Basics' },
  { key: 'greed',     label: 'Greed',      min: 'strikt',     max: 'greedy',
    tip: 'Höher → mehr Duals, höhere Quellen-Untergrenze pro Farbe' },
];

function modeTooltip(mode) {
  switch (mode) {
    case 'stable':
      return 'Stabil — balancierte Mana-Basis, Painlands als Rückgrat';
    case 'stable_budget':
      return 'Stabil · Budget — gleiche Struktur, stärkerer Budget-Einfluss';
    case 'optimized_tempo':
      return 'Optimiert · Tempo — Untapped-Lands priorisiert, schnelles Early Game';
    case 'optimized_late_game':
      return 'Optimiert · Late Game — greedy Fixing erlaubt, Ramp reduziert Land-Druck';
    case 'early_game_budget':
      return 'Early Game · Budget — nur günstige Lands, starke Early-Konsistenz';
    case 'late_game_budget':
      return 'Late Game · Budget — Cheap-Constraint mit Ramp-Skalierung, greedy Stretch';
    default:
      return '';
  }
}

function rateClass(rate) {
  if (rate >= 0.75) return 'good';
  if (rate >= 0.45) return 'mid';
  return 'bad';
}

function describeRule(rule) {
  switch (rule.type) {
    case 'CARD_IN_HAND_BY_TURN':
      return `${rule.count ?? 1}× "${rule.cardName}" bis Zug ${rule.turn}`;
    case 'COMBO_IN_OPENING_HAND':
      return `Alle in Eröffnung: ${(rule.cards || []).join(', ')}`;
    case 'MANA_REQUIREMENT_BY_TURN': {
      const colors = (rule.colors || []).join('') || '–';
      return `Bis Zug ${rule.turn}: ${rule.total ?? (rule.colors || []).length} Mana (${colors})`;
    }
    case 'MULLIGAN_TRIGGER': {
      const parts = [`mulligan außerhalb ${rule.minLands ?? 2}–${rule.maxLands ?? 5} Länder`];
      if ((rule.groups || []).length > 0) parts.push(`oder ohne ${rule.groups.length} Gruppe(n)`);
      return parts.join(' · ');
    }
    case 'GENERAL_HAND_QUALITY':
    case 'PERFECT_START': {
      const parts = [];
      const minL = rule.minLands ?? (rule.type === 'PERFECT_START' ? 0 : 2);
      const maxL = rule.maxLands ?? (rule.type === 'PERFECT_START' ? 7 : 5);
      parts.push(`${minL}–${maxL} Länder`);
      if ((rule.groups || []).length > 0) {
        parts.push(`${rule.groups.length} Gruppe(n)`);
      }
      if (rule.type === 'GENERAL_HAND_QUALITY' && (rule.requirePlayByTurn ?? 0) > 0) {
        parts.push(`spielbar bis Zug ${rule.requirePlayByTurn}`);
      }
      return parts.join(' · ');
    }
    default:
      return rule.type;
  }
}

/** Unique non-land card names, sorted, derived from a mainboard map. */
function deckCardNames(mainboard) {
  const names = new Set();
  for (const { card } of Object.values(mainboard || {})) {
    if (!card?.name) continue;
    if (isLand(card)) continue;
    names.add(card.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export default function DeckAnalyzerModal({
  open,
  onClose,
  mainboard,
  commander,
  deckFormat,
  onApplyLands,
}) {
  const [tab, setTab] = useState('lands');
  // Default preset is `stable` (no separate "standard" preset exists).
  const [manaConfig, setManaConfig] = useState(() => modeToConfig('stable'));
  const [utilityLands, setUtilityLands] = useState([]); // [{name, desiredCopies}]

  const suggestion = useMemo(() => {
    if (!open) return null;
    return suggestLands(mainboard, { commander, config: manaConfig, utilityLands });
  }, [open, mainboard, commander, manaConfig, utilityLands]);

  const [applyStatus, setApplyStatus] = useState(null);
  const [applying, setApplying] = useState(false);

  async function handleApplyLands() {
    if (!suggestion) return;
    setApplying(true);
    setApplyStatus(null);
    try {
      const { mainboard: next, missing } = await applyLandBreakdown(mainboard, suggestion.breakdown);
      onApplyLands?.(next);
      setApplying(false);
      if (missing.length > 0) {
        setApplyStatus({ type: 'error', text: `Konnte nicht auflösen: ${missing.join(', ')}` });
      } else {
        setApplyStatus({ type: 'success', text: 'Mana-Basis übernommen.' });
      }
    } catch (err) {
      setApplying(false);
      setApplyStatus({ type: 'error', text: err.message || 'Fehler beim Übernehmen' });
    }
  }

  const [rules, setRules] = useState(DEFAULT_RULES);
  const [simResult, setSimResult] = useState(null);
  const [simRunning, setSimRunning] = useState(false);
  const [iterations, setIterations] = useState(5000);

  const cardNames = useMemo(() => deckCardNames(mainboard), [mainboard]);

  function runSim() {
    setSimRunning(true);
    setTimeout(() => {
      const res = runSimulation(mainboard, rules, { iterations });
      setSimResult(res);
      setSimRunning(false);
    }, 20);
  }

  function updateRule(id, patch) {
    setRules(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
    setSimResult(null); // invalidate; user must rerun
  }
  function removeRule(id) {
    setRules(prev => prev.filter(r => r.id !== id));
    setSimResult(null);
  }
  function addCustomRule(rule) {
    setRules(prev => [...prev, rule]);
    setSimResult(null);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Deck-Analyse"
      width={720}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Schließen</Button>
          {tab === 'lands' && suggestion && (
            <>
              {applyStatus && (
                <span className={`dam-status ${applyStatus.type}`}>{applyStatus.text}</span>
              )}
              <Button onClick={handleApplyLands} disabled={applying}>
                {applying ? 'Übernehme…' : 'Mana-Basis übernehmen'}
              </Button>
            </>
          )}
          {tab === 'consistency' && (
            <Button onClick={runSim} disabled={simRunning}>
              {simRunning ? 'Simuliere…' : 'Simulation starten'}
            </Button>
          )}
        </>
      }
    >
      <div className="dam-tabs">
        <button
          className={`dam-tab ${tab === 'lands' ? 'active' : ''}`}
          onClick={() => setTab('lands')}
        >Mana-Basis</button>
        <button
          className={`dam-tab ${tab === 'consistency' ? 'active' : ''}`}
          onClick={() => setTab('consistency')}
        >Konsistenz</button>
      </div>

      {tab === 'lands' && suggestion && (
        <LandSuggestionView
          suggestion={suggestion}
          config={manaConfig}
          onChangeConfig={setManaConfig}
          utilityLands={utilityLands}
          onChangeUtilityLands={setUtilityLands}
        />
      )}

      {tab === 'consistency' && (
        <ConsistencyView
          rules={rules}
          cardNames={cardNames}
          onUpdateRule={updateRule}
          onRemoveRule={removeRule}
          onAddRule={addCustomRule}
          iterations={iterations}
          setIterations={setIterations}
          result={simResult}
          running={simRunning}
        />
      )}
    </Modal>
  );
}

function LandSuggestionView({
  suggestion, config, onChangeConfig,
  utilityLands, onChangeUtilityLands,
}) {
  const { totalLands, perColor, explanation, analysis, breakdownByCategory, cost } = suggestion;
  const usedColors = analysis.colorsUsed;

  function setSlider(key, value) {
    onChangeConfig({ ...config, [key]: Number(value) });
  }

  function applyPreset(mode) {
    onChangeConfig(modeToConfig(mode));
  }

  return (
    <div>
      <div className="dam-row" style={{ marginBottom: 8 }}>
        <span className="dam-section-title" style={{ margin: 0 }}>Presets:</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {MANA_MODES.map(m => (
            <button
              key={m}
              type="button"
              className="dam-mode-pill"
              onClick={() => applyPreset(m)}
              title={modeTooltip(m)}
            >
              {getModeLabel(m)}
            </button>
          ))}
        </div>
      </div>

      <div className="dam-sliders">
        {SLIDERS.map(s => (
          <div key={s.key} className="dam-slider-row" title={s.tip}>
            <label>
              <span className="dam-slider-label">{s.label}</span>
              <span className="dam-slider-value">{config[s.key].toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={config[s.key]}
              onChange={e => setSlider(s.key, e.target.value)}
            />
            <div className="dam-slider-ends">
              <span>{s.min}</span><span>{s.max}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="dam-summary">{explanation}</div>

      <div className="dam-grid">
        <div className="dam-stat">
          <div className="dam-stat-label">Empfohlene Länder</div>
          <div className="dam-stat-value">{totalLands}</div>
          <div className="dam-stat-sub">{analysis.landCount} aktuell im Mainboard</div>
        </div>
        <div className="dam-stat">
          <div className="dam-stat-label">Ø Manawert (Spells)</div>
          <div className="dam-stat-value">{analysis.avgCmc.toFixed(2)}</div>
          <div className="dam-stat-sub">
            {analysis.nonLandCount} Spells · {analysis.rampCount} Ramp
          </div>
        </div>
      </div>

      {usedColors.length > 0 && (
        <>
          <h3 className="dam-section-title">Quellen pro Farbe</h3>
          <div className="dam-color-row">
            {usedColors.map(c => (
              <div
                key={c}
                className={`dam-color-cell ${perColor[c] < 6 ? 'low' : ''}`}
                title={`${perColor[c]} Quellen`}
              >
                <div className="dam-cc-letter">{COLOR_LABEL[c]}</div>
                <div className="dam-cc-count">{perColor[c]}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <UtilityLandsEditor
        utilityLands={utilityLands}
        onChange={onChangeUtilityLands}
      />

      <h3 className="dam-section-title">Aufschlüsselung &amp; Kosten</h3>
      <CategorizedBreakdown
        cost={cost}
        breakdownByCategory={breakdownByCategory}
        totalLands={totalLands}
      />
    </div>
  );
}

function UtilityLandsEditor({ utilityLands, onChange }) {
  const [name, setName] = useState('');
  const [copies, setCopies] = useState(1);

  function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = utilityLands.find(u => u.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      onChange(utilityLands.map(u => u.name.toLowerCase() === trimmed.toLowerCase()
        ? { ...u, desiredCopies: u.desiredCopies + copies }
        : u));
    } else {
      onChange([...utilityLands, { name: trimmed, desiredCopies: copies }]);
    }
    setName('');
    setCopies(1);
  }

  function remove(n) {
    onChange(utilityLands.filter(u => u.name !== n));
  }

  return (
    <div className="dam-add-rule" style={{ marginBottom: 14 }}>
      <h4>Utility-Lands (hard-insert)</h4>
      <div className="dam-row">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="z.B. Bojuka Bog"
          style={{ flex: 1, minWidth: 180 }}
        />
        <input
          type="number" min={1} max={4}
          value={copies}
          onChange={e => setCopies(Math.max(1, Number(e.target.value) || 1))}
          style={{ width: 60 }}
        />
        <button className="dam-link-btn" onClick={add} type="button">+ Hinzufügen</button>
      </div>
      {utilityLands.length > 0 && (
        <div className="dam-chip-row" style={{ marginTop: 6 }}>
          {utilityLands.map(u => (
            <span key={u.name} className="dam-chip">
              {u.name} ×{u.desiredCopies}
              <button className="dam-chip-x" onClick={() => remove(u.name)} type="button">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CategorizedBreakdown({ cost, breakdownByCategory, totalLands }) {
  if (!cost || !breakdownByCategory) return null;
  const groupOrder = [
    { key: 'basics',    label: 'Basics',         match: i => i.category === 'basic' || i.category === 'colorless' },
    { key: 'dual_t1',   label: 'Duals · Tier 1', match: i => i.category === 'dual_t1' },
    { key: 'dual_t2',   label: 'Duals · Tier 2', match: i => i.category === 'dual_t2' },
    { key: 'dual_t3',   label: 'Duals · Tier 3', match: i => i.category === 'dual_t3' },
    { key: 'fixing',    label: 'Fixing-Lands',   match: i => i.category === 'fixing' },
    { key: 'utility',   label: 'Utility-Lands',  match: i => i.category === 'utility' },
    { key: 'unknown',   label: 'Sonstige',       match: i => i.category === 'unknown' },
  ];

  return (
    <ul className="dam-breakdown">
      {groupOrder.map(g => {
        const items = cost.items.filter(g.match);
        if (items.length === 0) return null;
        return (
          <Fragment key={g.key}>
            <li className="dam-breakdown-group-hdr">{g.label}</li>
            {items.map(item => (
              <li key={item.name} className="dam-breakdown-row">
                <span className="dam-bd-name">
                  {item.name}
                  {item.priceTier != null && (
                    <span className={`dam-tier-pill dam-tier-${item.priceTier}`} title={`Tier ${item.priceTier}`}>
                      T{item.priceTier}
                    </span>
                  )}
                </span>
                <span className="dam-bd-count">{item.count}×</span>
                <span className="dam-bd-unit">
                  {item.unitPriceEur != null ? `${item.unitPriceEur.toFixed(2)} €` : '—'}
                </span>
                <span className="dam-bd-sub">
                  {item.subtotalEur != null ? `${item.subtotalEur.toFixed(2)} €` : '—'}
                </span>
              </li>
            ))}
          </Fragment>
        );
      })}
      <li className="dam-breakdown-row dam-breakdown-total">
        <span className="dam-bd-name"><b>Gesamtkosten Mana-Basis</b></span>
        <span className="dam-bd-count">{totalLands}×</span>
        <span className="dam-bd-unit">—</span>
        <span className="dam-bd-sub"><b>{cost.totalEur.toFixed(2)} €</b></span>
      </li>
    </ul>
  );
}

function ConsistencyView({
  rules, cardNames,
  onUpdateRule, onRemoveRule, onAddRule,
  iterations, setIterations,
  result, running,
}) {
  return (
    <div>
      <h3 className="dam-section-title">Regeln</h3>
      {rules.length === 0 ? (
        <div className="dam-empty-msg">Keine Regeln aktiv.</div>
      ) : (
        <ul className="dam-rule-list">
          {rules.map(r => {
            const found = result?.ruleResults.find(x => x.id === r.id);
            const rate = found?.passRate ?? null;
            const isCore = r.id === 'general' || r.id === 'perfect' || r.id === 'mulligan';
            return (
              <li key={r.id} className="dam-rule">
                <div className="dam-rule-head">
                  <div className="dam-rule-label">{r.label || r.type}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {rate != null && (
                      <span className={`dam-rule-rate ${rateClass(rate)}`}>
                        {(rate * 100).toFixed(1)}%
                      </span>
                    )}
                    {!isCore && (
                      <button
                        onClick={() => onRemoveRule(r.id)}
                        title="Regel entfernen"
                        className="dam-icon-btn"
                      >×</button>
                    )}
                  </div>
                </div>
                <div className="dam-rule-meta">{describeRule(r)}</div>
                {rate != null && (
                  <div className="dam-rule-bar">
                    <div
                      className="dam-rule-bar-fill"
                      style={{ width: `${(rate * 100).toFixed(1)}%` }}
                    />
                  </div>
                )}
                {(r.type === 'GENERAL_HAND_QUALITY'
                  || r.type === 'PERFECT_START'
                  || r.type === 'MULLIGAN_TRIGGER') && (
                  <HandRequirementEditor
                    rule={r}
                    cardNames={cardNames}
                    onChange={(patch) => onUpdateRule(r.id, patch)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AdvancedRuleAdder cardNames={cardNames} onAdd={onAddRule} />

      <div className="dam-row">
        <label>Iterationen:</label>
        <select
          value={iterations}
          onChange={e => setIterations(Number(e.target.value))}
        >
          <option value={1000}>1.000 (schnell)</option>
          <option value={5000}>5.000 (Standard)</option>
          <option value={10000}>10.000 (genau)</option>
        </select>
        {result && (
          <span className="dam-status">
            {result.iterations.toLocaleString('de-DE')} Iterationen
          </span>
        )}
      </div>

      {running && (
        <div className="dam-empty-msg">Simulation läuft…</div>
      )}

      {result && !running && (
        <>
          {result.tooSmall ? (
            <div className="dam-summary">{result.summary}</div>
          ) : (
            <>
              <div className="dam-grid">
                <div className="dam-stat">
                  <div className="dam-stat-label">Keep-Rate</div>
                  <div className="dam-stat-value">{(result.keepRate * 100).toFixed(1)}%</div>
                  <div className="dam-stat-sub">Hände ohne Mulligan</div>
                </div>
                <div className="dam-stat">
                  <div className="dam-stat-label">Brick-Rate</div>
                  <div className="dam-stat-value">{(result.brickRate * 100).toFixed(1)}%</div>
                  <div className="dam-stat-sub">Nach allen Mulligans unspielbar</div>
                </div>
                {result.perfectStartRate != null && (
                  <div className="dam-stat" style={{ gridColumn: 'span 2' }}>
                    <div className="dam-stat-label">Perfekter Start</div>
                    <div className="dam-stat-value">
                      {(result.perfectStartRate * 100).toFixed(1)}%
                    </div>
                    <div className="dam-stat-sub">
                      Alle Bedingungen der „Perfekt"-Regel erfüllt
                    </div>
                  </div>
                )}
              </div>
              <div className="dam-summary">{result.summary}</div>
            </>
          )}
        </>
      )}

      {!result && !running && (
        <div className="dam-empty-msg">
          Noch keine Simulation gelaufen — drücke „Simulation starten".
        </div>
      )}
    </div>
  );
}

/** Inline editor for GENERAL_HAND_QUALITY, PERFECT_START and MULLIGAN_TRIGGER. */
function HandRequirementEditor({ rule, cardNames, onChange }) {
  const isKeep = rule.type === 'GENERAL_HAND_QUALITY';
  const isMull = rule.type === 'MULLIGAN_TRIGGER';
  const minLands = rule.minLands ?? (isKeep || isMull ? 2 : 0);
  const maxLands = rule.maxLands ?? (isKeep || isMull ? 5 : 7);
  const groups = rule.groups || [];

  function setMinLands(v) {
    const n = Math.max(0, Math.min(7, Number(v) || 0));
    onChange({ minLands: n, maxLands: Math.max(n, maxLands) });
  }
  function setMaxLands(v) {
    const n = Math.max(0, Math.min(7, Number(v) || 0));
    onChange({ maxLands: n, minLands: Math.min(n, minLands) });
  }
  function addGroup() {
    onChange({ groups: [...groups, { minCount: 1, cards: [] }] });
  }
  function updateGroup(idx, patch) {
    onChange({
      groups: groups.map((g, i) => (i === idx ? { ...g, ...patch } : g)),
    });
  }
  function removeGroup(idx) {
    onChange({ groups: groups.filter((_, i) => i !== idx) });
  }

  return (
    <div className="dam-rule-editor">
      {isMull && (
        <div className="dam-rule-meta" style={{ marginBottom: 4 }}>
          Mulligan, wenn die Hand <b>nicht</b> in diesem Bereich liegt oder
          eine Gruppe nicht erfüllt ist. Brick = Hand triggert auch nach allen
          Mulligans noch.
        </div>
      )}
      <div className="dam-row">
        <label>{isMull ? 'Akzeptiert ab:' : 'Mind. Länder:'}</label>
        <input
          type="number" min={0} max={7}
          value={minLands}
          onChange={e => setMinLands(e.target.value)}
          style={{ width: 60 }}
        />
        <label>{isMull ? 'Akzeptiert bis:' : 'Max. Länder:'}</label>
        <input
          type="number" min={0} max={7}
          value={maxLands}
          onChange={e => setMaxLands(e.target.value)}
          style={{ width: 60 }}
        />
        {isKeep && (
          <>
            <label>Spielbar bis Zug:</label>
            <input
              type="number" min={0} max={5}
              value={rule.requirePlayByTurn ?? 0}
              onChange={e => onChange({ requirePlayByTurn: Math.max(0, Number(e.target.value) || 0) })}
              style={{ width: 60 }}
              title="0 = ignorieren"
            />
          </>
        )}
      </div>

      <div className="dam-groups">
        <div className="dam-groups-head">
          <span>Karten-Gruppen</span>
          <button className="dam-link-btn" onClick={addGroup} type="button">+ Gruppe</button>
        </div>
        {groups.length === 0 && (
          <div className="dam-empty-msg" style={{ margin: '4px 0 0' }}>
            Keine Gruppen. (Optional: „mindestens 1 aus {`{Bolt, Shock}`}".)
          </div>
        )}
        {groups.map((g, idx) => (
          <GroupEditor
            key={idx}
            group={g}
            cardNames={cardNames}
            onChange={(patch) => updateGroup(idx, patch)}
            onRemove={() => removeGroup(idx)}
          />
        ))}
      </div>
    </div>
  );
}

function GroupEditor({ group, cardNames, onChange, onRemove }) {
  const [pickerValue, setPickerValue] = useState('');
  const cards = group.cards || [];

  const available = cardNames.filter(n => !cards.includes(n));

  function addCard(name) {
    if (!name || cards.includes(name)) return;
    onChange({ cards: [...cards, name] });
    setPickerValue('');
  }
  function removeCard(name) {
    onChange({ cards: cards.filter(c => c !== name) });
  }

  return (
    <div className="dam-group-row">
      <div className="dam-row" style={{ marginBottom: 4 }}>
        <label>Mind.:</label>
        <input
          type="number" min={1} max={7}
          value={group.minCount ?? 1}
          onChange={e => onChange({ minCount: Math.max(1, Number(e.target.value) || 1) })}
          style={{ width: 56 }}
        />
        <label>aus:</label>
        <select
          value={pickerValue}
          onChange={e => addCard(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        >
          <option value="">— Karte wählen —</option>
          {available.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <button
          onClick={onRemove}
          className="dam-icon-btn"
          title="Gruppe entfernen"
          type="button"
        >×</button>
      </div>
      {cards.length > 0 ? (
        <div className="dam-chip-row">
          {cards.map(name => (
            <span key={name} className="dam-chip">
              {name}
              <button
                onClick={() => removeCard(name)}
                className="dam-chip-x"
                title="Entfernen"
                type="button"
              >×</button>
            </span>
          ))}
        </div>
      ) : (
        <div className="dam-empty-msg" style={{ margin: '2px 0 0' }}>
          Wähle Karten oben, um die Gruppe zu füllen.
        </div>
      )}
    </div>
  );
}

/** Add custom rules of types CARD_IN_HAND_BY_TURN / MANA_REQUIREMENT_BY_TURN. */
function AdvancedRuleAdder({ cardNames, onAdd }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('CARD_IN_HAND_BY_TURN');
  const [cardName, setCardName] = useState('');
  const [count, setCount] = useState(1);
  const [turn, setTurn] = useState(3);
  const [colors, setColors] = useState('');
  const [total, setTotal] = useState(2);

  function handleAdd() {
    const id = `r${Date.now()}`;
    let rule;
    if (type === 'CARD_IN_HAND_BY_TURN') {
      if (!cardName) return;
      rule = {
        id, type,
        cardName,
        count: Math.max(1, Number(count) || 1),
        turn: Math.max(0, Number(turn) || 0),
        label: `${count}× ${cardName} bis Zug ${turn}`,
      };
    } else if (type === 'MANA_REQUIREMENT_BY_TURN') {
      const c = colors.toUpperCase().split('').filter(x => 'WUBRG'.includes(x));
      rule = {
        id, type,
        turn: Math.max(1, Number(turn) || 1),
        total: Math.max(0, Number(total) || c.length),
        colors: c,
        label: `Mana Zug ${turn}: ${total}${c.length ? ` (${c.join('')})` : ''}`,
      };
    }
    if (rule) {
      onAdd(rule);
      setCardName('');
      setColors('');
    }
  }

  if (!open) {
    return (
      <div style={{ marginBottom: 14 }}>
        <button className="dam-link-btn" onClick={() => setOpen(true)} type="button">
          + Erweiterte Regel hinzufügen
        </button>
      </div>
    );
  }

  return (
    <div className="dam-add-rule">
      <h4>Erweiterte Regel</h4>
      <div className="dam-row">
        <label>Typ:</label>
        <select value={type} onChange={e => setType(e.target.value)}>
          <option value="CARD_IN_HAND_BY_TURN">Karte bis Zug X</option>
          <option value="MANA_REQUIREMENT_BY_TURN">Mana-Anforderung bis Zug X</option>
        </select>
      </div>

      {type === 'CARD_IN_HAND_BY_TURN' && (
        <div className="dam-row">
          <label>Karte:</label>
          <select
            value={cardName}
            onChange={e => setCardName(e.target.value)}
            style={{ flex: 1, minWidth: 160 }}
          >
            <option value="">— Karte wählen —</option>
            {cardNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <label>Anzahl:</label>
          <input
            type="number" min={1} max={4}
            value={count}
            onChange={e => setCount(e.target.value)}
            style={{ width: 60 }}
          />
          <label>Zug:</label>
          <input
            type="number" min={0} max={10}
            value={turn}
            onChange={e => setTurn(e.target.value)}
            style={{ width: 60 }}
          />
        </div>
      )}

      {type === 'MANA_REQUIREMENT_BY_TURN' && (
        <div className="dam-row">
          <label>Zug:</label>
          <input
            type="number" min={1} max={10}
            value={turn}
            onChange={e => setTurn(e.target.value)}
            style={{ width: 60 }}
          />
          <label>Total:</label>
          <input
            type="number" min={0} max={10}
            value={total}
            onChange={e => setTotal(e.target.value)}
            style={{ width: 60 }}
          />
          <label>Farben:</label>
          <input
            value={colors}
            onChange={e => setColors(e.target.value)}
            placeholder="z.B. RR oder WUB"
            style={{ width: 120 }}
          />
        </div>
      )}

      <div className="dam-row" style={{ marginTop: 6 }}>
        <Button variant="ghost" onClick={handleAdd}>+ Hinzufügen</Button>
        <button
          className="dam-link-btn"
          onClick={() => setOpen(false)}
          type="button"
          style={{ marginLeft: 'auto' }}
        >Abbrechen</button>
      </div>
    </div>
  );
}
