// components/sheet/sheetStyles.js
// Shared inline style object for the character sheet (kept separate from
// SheetKit.jsx so that file can fast-refresh — it then exports only components).

export const S = {
  // ── Page ──
  // `height: 100vh + overflow: hidden` pins the page to the viewport so
  // inner panes (sidebar + main) own their own scroll context. Without
  // this the body falls back to the page-level scrollbar and both
  // panes track together, which the player can't independently scroll.
  // `position: relative` anchors absolute children (the header
  // dropdown overlay) to the sheet's own box, not the viewport — so
  // the overlay stays inside the D&D module instead of spilling over
  // the app shell's side nav.
  page: {
    height: '100vh', maxHeight: '100vh', background: 'var(--bg-page)', color: 'var(--text-primary)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    position: 'relative',
  },

  // ── Header ──
  header: {
    background: 'var(--bg-surface)', padding: '10px 20px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    borderBottom: '2px solid var(--border)', flexShrink: 0, gap: 12, flexWrap: 'wrap',
  },
  headerBackBtn: {
    padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13,
    whiteSpace: 'nowrap', fontFamily: 'inherit',
  },
  headerCenter: { display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 200 },
  headerPortrait: {
    width: 46, height: 46, borderRadius: 8, objectFit: 'cover',
    border: '2px solid var(--accent)', cursor: 'pointer', flexShrink: 0,
  },
  headerPortraitEmpty: {
    width: 46, height: 46, borderRadius: 8, flexShrink: 0, cursor: 'pointer',
    border: '2px dashed var(--border-strong)', background: 'var(--bg-inset)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text-dim)', fontSize: 18,
  },
  headerName: { color: 'var(--accent)', fontWeight: 'bold', fontSize: 18 },
  headerNameInput: {
    color: 'var(--accent)', fontWeight: 'bold', fontSize: 18, fontFamily: 'inherit',
    background: 'var(--bg-inset)', border: '1px solid var(--accent)', borderRadius: 6,
    padding: '2px 8px', maxWidth: 320,
  },
  headerSubline: { color: 'var(--text-muted)', fontSize: 12, marginTop: 2 },
  headerRight: { display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' },
  headerBtn: {
    padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13,
    fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  headerMobile: {
    background: 'var(--bg-surface)', padding: '8px 10px',
    display: 'flex', alignItems: 'center', gap: 8,
    borderBottom: '2px solid var(--border)', flexShrink: 0,
  },
  headerMobileTitle: { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  headerMobilePortrait: {
    width: 34, height: 34, borderRadius: 6, objectFit: 'cover',
    border: '1.5px solid var(--accent)', flexShrink: 0,
  },
  headerIconBtn: {
    width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 6,
    fontSize: 18, cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit',
  },
  exportBtn: {
    padding: '7px 14px', borderRadius: 6, border: '1px solid var(--accent-blue)',
    background: 'transparent', color: 'var(--accent-blue)', cursor: 'pointer', fontSize: 13,
    fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  exportMenu: {
    position: 'absolute', top: '110%', right: 0, background: 'var(--bg-surface)',
    border: '1px solid var(--border)', borderRadius: 8, padding: 4, zIndex: 100, minWidth: 180,
    boxShadow: '0 8px 24px var(--shadow)',
  },
  exportMenuItem: {
    display: 'block', width: '100%', padding: '8px 14px', border: 'none',
    background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13,
    textAlign: 'left', borderRadius: 6, fontFamily: 'inherit',
  },
  levelUpBtn: {
    padding: '7px 14px', borderRadius: 6, border: 'none',
    background: 'var(--accent)', color: 'var(--bg-deep)', cursor: 'pointer', fontSize: 13,
    fontWeight: 'bold', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },

  // ── Combat Bar ──
  combatBar: {
    display: 'flex', background: 'var(--bg-panel)',
    borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap',
  },
  combatStat: {
    flex: 1, minWidth: 96, padding: '10px 12px', textAlign: 'center',
    borderRight: '1px solid var(--border-subtle)',
  },
  combatStatBtn: { cursor: 'pointer' },
  combatStatValue: { fontSize: 22, fontWeight: 'bold', marginTop: 2 },
  combatStatLabel: { color: 'var(--text-muted)', fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  combatStatSub: { color: 'var(--accent-green)', fontSize: 10 },

  // ── Play toolbar (rest / inspiration) ──
  playBar: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
    padding: '6px 12px', flexShrink: 0,
  },
  playBtn: {
    padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer',
    fontSize: 12, fontFamily: 'inherit', whiteSpace: 'nowrap',
  },

  // ── Body ──
  // `minHeight: 0` is the magic incantation that lets a flex item host
  // its own scroll container — without it the children's overflow:auto
  // is meaningless and the page-level scrollbar wins.
  body: { display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 },
  sidebar: {
    width: 256, flexShrink: 0, background: 'var(--bg-card)',
    borderRight: '1px solid var(--border)', overflowY: 'auto', padding: 12,
  },
  sidePortrait: { marginBottom: 14, textAlign: 'center' },
  sidePortraitImg: {
    width: 150, height: 150, objectFit: 'cover', borderRadius: 12,
    border: '2px solid var(--border)',
  },
  sideSection: { marginBottom: 18 },
  sideSectionTitle: {
    color: 'var(--accent)', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid var(--border-subtle)',
  },
  sideHint: { color: 'var(--text-dim)', fontSize: 10, marginTop: 6, fontStyle: 'italic' },

  // ── Ability Scores ──
  abilityGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 },
  abilityBox: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '8px 4px', textAlign: 'center', cursor: 'default',
  },
  abilityAbbr: { color: 'var(--text-muted)', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
  abilityMod: { color: 'var(--accent)', fontSize: 18, fontWeight: 'bold' },
  abilityScore: { color: 'var(--text-secondary)', fontSize: 12 },
  abilityBreakdown: {
    display: 'flex', gap: 2, justifyContent: 'center', marginTop: 2,
    fontSize: 9, color: 'var(--text-muted)',
  },

  // ── Saving Throws / Skills ──
  saveRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  profDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  saveName: { color: 'var(--text-muted)', fontSize: 12, flex: 1 },
  saveValue: { color: 'var(--text-primary)', fontSize: 12, fontWeight: 'bold' },
  skillRow: { display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 },
  skillName: { color: 'var(--text-muted)', fontSize: 11, flex: 1 },
  skillAbility: { color: 'var(--text-dim)', fontSize: 10 },
  skillValue: { fontSize: 11, fontWeight: 'bold' },

  // ── Proficiencies / Senses ──
  profBlock: { marginBottom: 6 },
  profBlockLabel: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 'bold' },
  profBlockValue: { color: 'var(--text-secondary)', fontSize: 11 },
  senseRow: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 },
  senseName: { color: 'var(--text-muted)', fontSize: 11 },
  senseValue: { color: 'var(--text-primary)', fontSize: 11, fontWeight: 'bold' },

  // ── Main / Tabs ──
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 },
  tabs: {
    display: 'flex', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
    flexShrink: 0, overflowX: 'auto',
  },
  tab: {
    padding: '12px 18px', border: 'none', background: 'transparent',
    color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, borderBottom: '2px solid transparent',
    whiteSpace: 'nowrap', fontFamily: 'inherit',
  },
  tabActive: { color: 'var(--accent)', borderBottom: '2px solid var(--accent)' },
  tabContent: { flex: 1, overflowY: 'auto' },
  tabBody: { padding: '20px 24px' },

  // ── Section ──
  section: { marginBottom: 26 },
  sectionHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)', gap: 10,
  },
  sectionTitle: {
    color: 'var(--accent)', fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // ── Identity Grid ──
  identityGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 },
  infoCard: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '10px 14px',
  },
  infoCardLabel: { color: 'var(--text-muted)', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoCardValue: { color: 'var(--text-primary)', fontSize: 15, fontWeight: 'bold', marginTop: 2 },
  infoCardHint: { color: 'var(--text-dim)', fontSize: 10, marginTop: 2 },

  // ── Class Cards ──
  classCard: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10,
    padding: '14px 18px', marginBottom: 8,
  },
  classCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  classCardName: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 18 },
  classCardLevel: { color: 'var(--accent)', fontSize: 13, marginTop: 2 },
  classCardBadges: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  classCardDetails: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 },
  badge: { border: '1px solid', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 'bold' },
  detailChip: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '4px 10px', fontSize: 12,
  },
  detailChipLabel: { color: 'var(--text-muted)' },
  detailChipValue: { color: 'var(--accent)', fontWeight: 'bold' },

  // ── HP Section ──
  hpSection: { display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap' },
  hpMain: {
    background: 'var(--bg-elevated)', border: '2px solid var(--accent-red)', borderRadius: 12,
    padding: '14px 22px', textAlign: 'center', minWidth: 150,
  },
  hpLabel: { color: 'var(--accent-red)', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase' },
  hpValue: { color: 'var(--text-primary)', fontSize: 30, fontWeight: 'bold', lineHeight: 1.1 },
  hpBarTrack: { height: 8, borderRadius: 4, background: 'var(--bg-inset)', marginTop: 8, overflow: 'hidden' },
  hpBarFill: { height: '100%', background: 'var(--accent-red)', transition: 'width 0.25s' },
  hpDetails: { display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1, alignContent: 'flex-start' },

  // ── Death Saves ──
  deathSaves: {
    display: 'flex', gap: 20, marginTop: 14, padding: '10px 14px',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, flexWrap: 'wrap',
  },
  deathSaveRow: { display: 'flex', alignItems: 'center', gap: 6 },
  deathSaveLabel: { color: 'var(--text-muted)', fontSize: 12, marginRight: 4 },
  deathSaveDot: { width: 18, height: 18, borderRadius: '50%', border: '1px solid var(--border-strong)', cursor: 'pointer', padding: 0 },

  // ── Attacks ──
  attackTableWrap: { overflowX: 'auto' },
  attackTable: { width: '100%', borderCollapse: 'collapse', minWidth: 460 },
  th: {
    background: 'var(--bg-elevated)', color: 'var(--accent)', padding: '8px 12px',
    textAlign: 'left', fontSize: 12, fontWeight: 'bold',
  },
  td: { color: 'var(--text-secondary)', padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 },

  // ── Spellcasting ──
  spellcastRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' },
  spellcastClass: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 14, minWidth: 80 },

  // ── Resources ──
  resourceGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 },
  resourceBox: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '6px 10px',
  },
  resourceName: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 12, marginBottom: 2 },
  resourceValue: { color: 'var(--accent)', fontSize: 15, fontWeight: 'bold' },
  resourceRecharge: { color: 'var(--text-muted)', fontSize: 10, marginTop: 1 },
  pipRow: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 },
  pip: { width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--border-strong)', cursor: 'pointer', padding: 0 },

  // ── Spell Slots ──
  slotGrid: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  slotBox: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '8px 14px', textAlign: 'center', minWidth: 92,
  },
  slotLevel: { color: 'var(--text-muted)', fontSize: 10, marginBottom: 4, fontWeight: 'bold' },
  slotCount: { fontWeight: 'bold', fontSize: 16 },
  slotDots: { display: 'flex', gap: 4, justifyContent: 'center', marginTop: 6, flexWrap: 'wrap' },
  slotDot: { width: 14, height: 14, borderRadius: '50%', cursor: 'pointer', border: '1px solid var(--border-strong)', padding: 0 },

  // ── Spell list ──
  spellGroupHead: {
    display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0',
  },
  spellRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '8px 12px', marginBottom: 6,
  },
  spellRowMain: { flex: 1, minWidth: 0, cursor: 'pointer' },
  spellName: { color: 'var(--text-primary)', fontSize: 14, fontWeight: 600 },
  spellMeta: { color: 'var(--text-muted)', fontSize: 11, marginTop: 2 },
  spellLevelBadge: {
    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 'bold',
  },
  tag: {
    fontSize: 10, fontWeight: 'bold', padding: '1px 6px', borderRadius: 4,
    border: '1px solid', textTransform: 'uppercase', letterSpacing: 0.3,
  },

  // ── Concentration banner ──
  concBanner: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    background: 'var(--bg-elevated)', border: '1px solid var(--accent-purple)', borderRadius: 8,
    padding: '8px 14px', marginBottom: 16, flexWrap: 'wrap',
  },

  // ── Inventory ──
  currencyRow: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  currencyBox: {
    flex: 1, minWidth: 84, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 8, padding: 10, textAlign: 'center',
  },
  currencyLabel: { color: 'var(--text-muted)', fontSize: 11, marginBottom: 6 },
  totalGP: { color: 'var(--text-muted)', fontSize: 12, textAlign: 'right', marginTop: 8 },
  containerGroup: {
    border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12, overflow: 'hidden',
  },
  containerHead: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
    background: 'var(--bg-card)', borderBottom: '1px solid var(--border-subtle)',
  },
  containerTitle: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13, flex: 1 },
  itemRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)',
    background: 'var(--bg-elevated)',
  },
  itemName: { color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 },
  itemSub: { color: 'var(--text-muted)', fontSize: 11, marginTop: 1 },
  itemTag: {
    background: 'var(--bg-highlight)', fontSize: 10, padding: '2px 7px', borderRadius: 4,
  },
  miniBtn: {
    border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)',
    borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
    flexShrink: 0,
  },
  miniSelect: {
    border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)',
    borderRadius: 6, padding: '4px 6px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
    maxWidth: 130,
  },

  // ── Features ──
  featureCard: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10,
    overflow: 'hidden', marginBottom: 8,
  },
  featureCardHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
  },
  featureCardName: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 16 },
  featureCardSource: { color: 'var(--text-muted)', fontSize: 11 },
  featureCardBody: { padding: '12px 16px' },
  traitGrid: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  traitPill: {
    background: 'var(--bg-highlight)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '4px 10px', textAlign: 'center',
  },
  traitPillLabel: { color: 'var(--text-muted)', fontSize: 10 },
  traitPillValue: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 13 },
  traitLine: { marginBottom: 6 },
  traitLineLabel: { color: 'var(--text-muted)', fontSize: 12, fontWeight: 'bold', marginRight: 6 },
  traitLineValue: { color: 'var(--text-secondary)', fontSize: 13 },
  asiBlock: { marginTop: 8, marginBottom: 4 },
  asiLabel: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 'bold', marginBottom: 4 },
  asiValues: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  asiBadge: {
    background: 'var(--bg-hover)', border: '1px solid var(--accent-green)', color: 'var(--accent-green)',
    borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 'bold',
  },
  skillBadge: {
    background: 'var(--bg-hover)', border: '1px solid var(--accent-green)', borderRadius: 6,
    padding: '4px 10px', color: 'var(--accent-green)', fontSize: 12,
  },
  featCard: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '12px 16px', marginBottom: 8,
  },
  featCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' },
  featCardName: { color: 'var(--text-primary)', fontWeight: 'bold', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 },
  featCardSource: { color: 'var(--text-muted)', fontSize: 11 },
  featCardBonuses: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 },
  featBonusBadge: {
    background: 'var(--bg-hover)', border: '1px solid var(--accent-purple)', borderRadius: 6,
    padding: '2px 8px', color: 'var(--accent-purple)', fontSize: 12,
  },
  originTag: {
    background: 'var(--bg-hover)', border: '1px solid var(--accent-purple)', color: 'var(--accent-purple)',
    fontSize: 9, fontWeight: 'bold',
    padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.5,
  },

  // ── Personality ──
  appearanceSection: { display: 'flex', gap: 20, flexWrap: 'wrap' },
  bigPortraitWrap: { flexShrink: 0, position: 'relative' },
  bigPortrait: { width: 180, height: 180, objectFit: 'cover', borderRadius: 12, border: '2px solid var(--border)' },
  bigPortraitEmpty: {
    width: 180, height: 180, borderRadius: 12, border: '2px dashed var(--border-strong)',
    background: 'var(--bg-inset)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexDirection: 'column', gap: 6, color: 'var(--text-dim)', fontSize: 13, cursor: 'pointer',
  },
  appearanceDetails: { flex: 1, minWidth: 240 },
  appearanceGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 },
  appearanceLabel: { color: 'var(--text-muted)', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  personalityGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 },
  personalityCard: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px',
  },
  personalityCardHeader: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 },
  personalityCardLabel: { color: 'var(--accent)', fontSize: 12, fontWeight: 'bold' },
  textBlock: {
    color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px',
  },

  // ── Empty state ──
  emptyState: { textAlign: 'center', padding: '28px 16px' },
  emptyTitle: { color: 'var(--text-muted)', fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
  emptyDesc: { color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.5 },

  // ── Modal ──
  modalOverlay: {
    position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  modalCard: {
    width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 14, display: 'flex', flexDirection: 'column', maxHeight: '90vh',
    boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
  },
  modalHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px', borderBottom: '1px solid var(--border)',
  },
  modalTitle: { color: 'var(--accent)', fontSize: 16, fontWeight: 'bold' },
  modalClose: {
    background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 18,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  modalBody: { padding: 18, overflowY: 'auto', flex: 1 },
  modalFoot: {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '12px 18px', borderTop: '1px solid var(--border)',
  },

  // ── Buttons ──
  btnGhost: {
    padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer',
    fontSize: 13, fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  btnPrimary: {
    padding: '7px 16px', borderRadius: 6, border: 'none',
    background: 'var(--accent)', color: 'var(--bg-deep)', cursor: 'pointer',
    fontSize: 13, fontWeight: 'bold', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  btnAccent: {
    padding: '7px 14px', borderRadius: 6, border: '1px solid var(--accent)',
    background: 'transparent', color: 'var(--accent)', cursor: 'pointer',
    fontSize: 13, fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  btnDanger: {
    padding: '7px 14px', borderRadius: 6, border: '1px solid var(--accent-red)',
    background: 'transparent', color: 'var(--accent-red)', cursor: 'pointer',
    fontSize: 13, fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  btnDisabled: { opacity: 0.4, cursor: 'not-allowed' },

  // ── Form controls ──
  formRow: { marginBottom: 12 },
  formLabel: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 'bold', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  formHint: { color: 'var(--text-dim)', fontSize: 11, marginTop: 4 },
  input: {
    width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-inset)', color: 'var(--text-primary)', fontSize: 13,
    boxSizing: 'border-box', fontFamily: 'inherit',
  },
  checkbox: {
    color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 6,
  },
  stepper: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  stepBtn: {
    width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer',
    fontSize: 15, fontWeight: 'bold', fontFamily: 'inherit', flexShrink: 0,
  },
  stepValue: {
    textAlign: 'center', padding: '5px 4px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-inset)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 'bold',
    fontFamily: 'inherit',
  },

  // ── Inline editable ──
  editable: {
    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
    padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontSize: 13,
    lineHeight: 1.6, whiteSpace: 'pre-wrap', minHeight: 20,
  },
  editableEmpty: { color: 'var(--text-dim)', fontStyle: 'italic' },
  editPencil: { marginLeft: 'auto', color: 'var(--text-dim)', fontSize: 12, flexShrink: 0 },
}
