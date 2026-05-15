// src/features/wh40k/components/DetachmentInfo.jsx
//
// Detachment detail panel. Renders everything the player needs to decide
// whether a detachment fits their list: the detachment rule(s), every
// stratagem (with CP cost + phase + effect), and every enhancement
// (with point cost). Used by the army builder header so the choice is
// informed, and by the Combat Helper to surface the same info mid-game.
//
// The panel takes the *already-hydrated* dataset maps the runtime hook
// exposes, so it stays cheap (pure id lookups, no re-fetch). The visual
// language matches UnitDetail — same Panel, same section headers — so
// the two surfaces feel like one design.

import { useState } from 'react';
import { Panel } from '../../../shared/ui';

/* ─────────────────── public component ─────────────────── */

export default function DetachmentInfo({
  detachment,
  abilitiesById,
  stratagems,        // pre-filtered list (passed by parent so we don't recompute)
  enhancements,
  collapsed = false,
  onToggle,
  compact = false,   // mobile-style: tighter spacing, slightly smaller headings
  // Optional Combat-Helper integration. Pass these from the session page
  // to enable per-stratagem "Anwenden" buttons + usage indicators.
  stratagemUsage,    // { [stratagemId]: { used, lastRound, totalUses, roundUses } }
  currentRound,
  cp,
  onApplyStratagem,  // (strat) => void — deduct CP + log event
}) {
  if (!detachment) {
    return (
      <Panel padding={compact ? 'sm' : 'md'} style={emptyStyle}>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>
          Wähle ein Detachment, um seine Regeln, Stratagems und Enhancements zu sehen.
        </div>
      </Panel>
    );
  }

  const rules = (detachment.abilityIds || [])
    .map(id => abilitiesById[id])
    .filter(Boolean);

  return (
    <Panel padding={compact ? 'sm' : 'md'} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: compact ? 'var(--fs-md)' : 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)' }}>
            {detachment.name}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-text-muted)' }}>
            {rules.length} Regel{rules.length === 1 ? '' : 'n'} ·{' '}
            {stratagems.length} Stratagem{stratagems.length === 1 ? '' : 's'} ·{' '}
            {enhancements.length} Enhancement{enhancements.length === 1 ? '' : 's'}
          </div>
        </div>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            style={toggleBtnStyle}
            title={collapsed ? 'Detachment-Info anzeigen' : 'Detachment-Info verbergen'}
          >
            {collapsed ? '▾' : '▴'}
          </button>
        )}
      </header>

      {!collapsed && (
        <>
          {detachment.description && (
            <p style={descStyle}>{detachment.description}</p>
          )}

          {rules.length > 0 && (
            <Section title="Detachment-Regel" compact={compact}>
              <div style={listStyle}>
                {rules.map(r => (
                  <RuleCard key={r.id} name={r.name} text={r.text} />
                ))}
              </div>
            </Section>
          )}

          {stratagems.length > 0 && (
            <Section title={`Stratagems (${stratagems.length})`} compact={compact}>
              <div style={gridStyle}>
                {stratagems
                  .slice()
                  .sort((a, b) => (a.cpCost - b.cpCost) || a.name.localeCompare(b.name))
                  .map(s => (
                    <StratagemCard
                      key={s.id}
                      strat={s}
                      usage={stratagemUsage?.[s.id]}
                      currentRound={currentRound}
                      cp={cp}
                      onApply={onApplyStratagem}
                    />
                  ))}
              </div>
            </Section>
          )}

          {enhancements.length > 0 && (
            <Section title={`Enhancements (${enhancements.length})`} compact={compact}>
              <div style={gridStyle}>
                {enhancements
                  .slice()
                  .sort((a, b) => (a.cost - b.cost) || a.name.localeCompare(b.name))
                  .map(e => <EnhancementCard key={e.id} enh={e} />)}
              </div>
            </Section>
          )}
        </>
      )}
    </Panel>
  );
}

/* ─────────────────── sub-views ─────────────────── */

function Section({ title, children, compact }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <h3 style={{
        margin: 0,
        fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)',
        textTransform: 'uppercase', letterSpacing: 0.6,
        color: 'var(--color-text-muted)',
        paddingBottom: compact ? 0 : 2,
      }}>{title}</h3>
      {children}
    </section>
  );
}

function RuleCard({ name, text }) {
  return (
    <div style={ruleCardStyle}>
      <div style={cardTitleStyle}>{name}</div>
      {text && <div style={cardTextStyle}>{text}</div>}
    </div>
  );
}

function StratagemCard({ strat, usage, currentRound, cp, onApply }) {
  const [open, setOpen] = useState(false);

  // "Used this round" — interpreted from roundUses[currentRound] so we
  // can show a badge per round (10e stratagems are once-per-turn by
  // default; the user can still re-apply if they spent CP a second time
  // for niche cases — we don't enforce the limit).
  const usedThisRound = currentRound && usage?.roundUses?.[currentRound] > 0;
  const totalUses = usage?.totalUses || 0;

  const canApply = !!onApply;
  const enoughCp = cp == null || cp >= (strat.cpCost || 0);

  return (
    <div
      style={{
        ...stratCardStyle,
        borderColor: usedThisRound ? 'var(--color-success)' : 'var(--color-border)',
        opacity: usedThisRound ? 0.85 : 1,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          background: 'transparent', border: 'none', padding: 0, margin: 0,
          textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
          display: 'flex', flexDirection: 'column', gap: 4, width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
          <div style={{ ...cardTitleStyle, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {strat.name}
          </div>
          <span style={cpBadgeStyle} title={`${strat.cpCost} Kommandopunkt${strat.cpCost === 1 ? '' : 'e'}`}>
            {strat.cpCost} CP
          </span>
        </div>
        {(strat.kind || strat.phase || usedThisRound || totalUses > 0) && (
          <div style={metaRowStyle}>
            {strat.kind && <Chip>{stratKindLabel(strat.kind)}</Chip>}
            {strat.phase && <Chip>{strat.phase}</Chip>}
            {usedThisRound && (
              <span style={usedBadgeStyle}>✓ Verwendet R{currentRound}</span>
            )}
            {!usedThisRound && totalUses > 0 && (
              <span style={historyBadgeStyle}>{totalUses}× total</span>
            )}
          </div>
        )}
        {open && (
          <>
            {strat.target && <div style={cardSubLabelStyle}>Ziel: <span style={cardTextStyle}>{strat.target}</span></div>}
            {strat.effect && <div style={cardTextStyle}>{strat.effect}</div>}
            {strat.restriction && <div style={{ ...cardTextStyle, color: 'var(--color-warning)' }}>{strat.restriction}</div>}
          </>
        )}
      </button>
      {canApply && open && (
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onApply(strat); }}
            disabled={!enoughCp}
            style={applyBtnStyle(!enoughCp)}
            title={enoughCp
              ? `Anwenden — kostet ${strat.cpCost} CP`
              : `Nicht genug CP (${cp ?? 0}/${strat.cpCost})`}
          >
            {usedThisRound ? '+ erneut anwenden' : `Anwenden · ${strat.cpCost} CP`}
          </button>
        </div>
      )}
    </div>
  );
}

function EnhancementCard({ enh }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen(o => !o)}
      aria-expanded={open}
      style={{ ...enhCardStyle, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--color-accent)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
        <div style={{ ...cardTitleStyle, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {enh.name}
        </div>
        <span style={costBadgeStyle}>{enh.cost} Pkt</span>
      </div>
      {open && (
        <>
          {enh.text && <div style={cardTextStyle}>{enh.text}</div>}
          {enh.restriction && <div style={{ ...cardTextStyle, color: 'var(--color-warning)' }}>{enh.restriction}</div>}
        </>
      )}
    </button>
  );
}

function Chip({ children }) {
  return (
    <span style={chipStyle}>{children}</span>
  );
}

function stratKindLabel(kind) {
  return {
    'battle-tactic':  'Battle Tactic',
    'wargear':        'Wargear',
    'epic-deed':      'Epic Deed',
    'strategic-ploy': 'Strategic Ploy',
    'requisition':    'Requisition',
  }[kind] || kind;
}

/* ─────────────────── styles ─────────────────── */

const emptyStyle = { textAlign: 'center' };

const toggleBtnStyle = {
  width: 32, height: 32,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontSize: 'var(--fs-md)',
};

const descStyle = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--color-text-muted)',
};

const listStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
};

// Compact responsive grid: ~3 columns on desktop, 2 on tablet, 1 on phone.
// Cards collapse to title+badges until clicked, so the army builder /
// combat helper keep the rest of the page visible.
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 'var(--space-2)',
};

const cardSubLabelStyle = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginTop: 4,
};

const usedBadgeStyle = {
  padding: '1px 6px',
  fontSize: 'var(--fs-xs)',
  fontWeight: 'var(--fw-semibold)',
  background: 'color-mix(in srgb, var(--color-success) 18%, transparent)',
  color: 'var(--color-success)',
  border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)',
  borderRadius: 999,
  whiteSpace: 'nowrap',
};

const historyBadgeStyle = {
  padding: '1px 6px',
  fontSize: 'var(--fs-xs)',
  color: 'var(--color-text-dim)',
  background: 'transparent',
  border: '1px dashed var(--color-border)',
  borderRadius: 999,
  whiteSpace: 'nowrap',
};

function applyBtnStyle(disabled) {
  return {
    flex: 1,
    minHeight: 36,
    padding: '6px 10px',
    background: disabled ? 'transparent' : 'var(--color-accent)',
    color: disabled ? 'var(--color-text-dim)' : 'var(--color-accent-contrast)',
    border: `1px solid ${disabled ? 'var(--color-border)' : 'var(--color-accent)'}`,
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--fs-sm)',
    fontWeight: 'var(--fw-semibold)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
  };
}

const ruleCardStyle = {
  padding: 'var(--space-2) var(--space-3)',
  background: 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-sunken))',
  border: '1px solid color-mix(in srgb, var(--color-accent) 24%, var(--color-border))',
  borderRadius: 'var(--radius-md)',
};

const stratCardStyle = {
  padding: 'var(--space-2) var(--space-3)',
  background: 'var(--color-bg-sunken)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const enhCardStyle = {
  padding: 'var(--space-2) var(--space-3)',
  background: 'var(--color-bg-sunken)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
};

const cardTitleStyle = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)',
};

const cardTextStyle = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--color-text-muted)',
  lineHeight: 'var(--lh-normal)',
};

const metaRowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  marginTop: 2,
};

const chipStyle = {
  display: 'inline-block',
  padding: '1px 6px',
  fontSize: 'var(--fs-xs)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-muted)',
  border: '1px solid var(--color-border)',
  borderRadius: 999,
  whiteSpace: 'nowrap',
};

const cpBadgeStyle = {
  padding: '1px 8px',
  fontSize: 'var(--fs-xs)',
  fontWeight: 'var(--fw-semibold)',
  background: 'var(--color-accent)',
  color: 'var(--color-accent-contrast)',
  borderRadius: 999,
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

const costBadgeStyle = {
  padding: '1px 8px',
  fontSize: 'var(--fs-xs)',
  fontWeight: 'var(--fw-semibold)',
  background: 'color-mix(in srgb, var(--color-warning) 18%, transparent)',
  color: 'var(--color-warning)',
  border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)',
  borderRadius: 999,
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};
