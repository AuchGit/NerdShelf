// VTT shell, embedded in a NerdShelf campaign. The map is a full-screen
// background; toolbars/sidebars float over it so collapsing a panel never
// shifts the map. Role + identity come from the campaign membership; state
// syncs through the SupabaseAdapter (campaign-scoped, persistent).
//
// Props:
//   campaignId  — the dnd campaign this VTT belongs to
//   userId      — auth user id (token ownership / sync sender)
//   isGM        — true → DM (full editor); false → player
//   playerName  — display name
//   onExit      — optional back handler (e.g. navigate to the campaign)
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../core/supabase/client';
import PixiStage from './render/PixiStage';
import Toolbar from './components/Toolbar';
import MapManager from './components/MapManager';
import GridControls from './components/GridControls';
import LevelPanel from './components/LevelPanel';
import TokenPanel from './components/TokenPanel';
import MonsterPanel from './components/MonsterPanel';
import InitiativeTracker from './components/InitiativeTracker';
import TokenContextMenu from './components/TokenContextMenu';
import StatblockOverlay from './components/StatblockOverlay';
import CharacterSheetPanel from './components/CharacterSheetPanel';
import PlayerSheetCategory from './components/PlayerSheetCategory';
import InventorySidebar from './components/InventorySidebar';
import SpellsSidebar from './components/SpellsSidebar';
import PlayerBottomBar from './components/PlayerBottomBar';
import Icon from './components/Icon';
import ZoneEditor from './components/ZoneEditor';
import WallEditor from './components/WallEditor';
import LightEditor from './components/LightEditor';
import TerrainEditor from './components/TerrainEditor';
import InitiativeBar from './components/InitiativeBar';
import TurnNotice from './components/TurnNotice';
import TransitionPrompt from './components/TransitionPrompt';
import JournalSidebar from './components/JournalSidebar';
import HandoutOverlay from './components/HandoutOverlay';
import DMBottomBar from './components/DMBottomBar';
import LevelHistorySidebar from './components/LevelHistorySidebar';
import DiceTray from './components/DiceTray';
import NotesFab from './components/NotesFab';
import VttSettings from './components/VttSettings';
import BugReportModal from '../../../core/bug-report/BugReportModal';
import { useAuth } from '../../../core/auth/AuthContext';
import { openSheetPopout } from '../character-builder/lib/sheetPopout';
import { TooltipProvider, TooltipLayer } from './components/tooltip/Tooltips';
import { connectSync, getState, persistSnapshot } from './state/store';
import { setSession, presentHandout, selectZone, selectTerrain, setPaused, confirmTargeting, cancelTargeting, setContextTokens } from './state/actions';
import { SupabaseAdapter } from './sync/SupabaseAdapter';
import { RelayAdapter } from './sync/RelayAdapter';
import { connectCharacterBinding, disconnectCharacterBinding } from './sync/characterBinding';
import { useIsDM, useActiveMap, useVtt } from './state/useVtt';
import { useUiScale, getConnectionMode, getRelayUrl } from './lib/vttPrefs';
import { setSessionActive } from '../character-builder/lib/campaigns';

// Base theme font sizes (theme.css) — scaled by the VTT UI-size preference.
const FS_BASE = { '--fs-xs': 11, '--fs-sm': 13, '--fs-md': 14, '--fs-lg': 16, '--fs-xl': 19, '--fs-2xl': 24, '--fs-3xl': 32 };

export default function VttApp({ campaignId, userId, isGM = false, playerName = '', edition = '5e', onExit }) {
  const rendererRef = useRef(null);
  const [ctxMenus, setCtxMenus] = useState([]); // multiple, draggable token menus
  const [showSettings, setShowSettings] = useState(false);
  const [showBug, setShowBug] = useState(false);
  const [sessionLive, setSessionLive] = useState(false);
  const { signOut } = useAuth();

  // DM starts/ends the live session straight from the VTT — flips
  // dnd_campaigns.session_active so players can join (▶ Zur Session) or are
  // dropped when it ends.
  const toggleSession = async () => {
    const next = !sessionLive;
    if (next === false && !window.confirm('Live-Session wirklich beenden?')) return;
    try { await setSessionActive(campaignId, next); setSessionLive(next); }
    catch (e) { console.error('Session toggle failed', e); }
  };
  const [travelPrompt, setTravelPrompt] = useState(null);
  const [statTokenIds, setStatTokenIds] = useState([]); // double-click stat/sheet overlays (multiple)
  // A GM who also plays can flip the whole VTT between DM tools and the player
  // view (their own sheet + bottom bar). Server-side perms are unaffected.
  const [viewAsPlayer, setViewAsPlayer] = useState(false);
  const isDM = useIsDM();
  const activeMap = useActiveMap();
  const hasContextEditor = useVtt((s) => !!(s.ui.selectedZoneId || s.ui.selectedWallId || s.ui.selectedLightId || s.ui.selectedTerrainId));
  const myCharacterId = useVtt((s) => s.ui.myCharacterId);
  const paused = useVtt((s) => s.paused);
  const targeting = useVtt((s) => s.ui.targeting);
  // Handout the DM is currently showing everyone (synced); each client can
  // dismiss it locally. Re-presenting clears the local dismissal.
  const presentedId = useVtt((s) => s.presentedHandout);
  const journal = useVtt((s) => s.journal || []);
  // A player can locally dismiss the DM's presented handout (stored by id, so a
  // newly presented one always shows again).
  const [dismissedHandout, setDismissedHandout] = useState(null);
  const presentedHandout = presentedId && dismissedHandout !== presentedId ? journal.find((e) => e.id === presentedId) : null;
  // VTT UI size: scale the theme font-size variables on the root only.
  const uiScale = useUiScale();
  const fsVars = useMemo(() => {
    const v = {}; for (const k in FS_BASE) v[k] = `${Math.round(FS_BASE[k] * uiScale)}px`; return v;
  }, [uiScale]);
  // Each category is its own collapsible sidebar, toggled by an icon button on
  // the left edge. Multiple can be open at once (side by side).
  // `icon` is an emoji placeholder; once SVGs are dropped into public/Assets/vtt
  // just set `iconSrc` (e.g. '/Assets/vtt/maps.svg') and it renders instead.
  // Effective role: a GM who is also a player sees ONLY DM sidebars in DM view
  // and ONLY player sidebars in player view (clean separation).
  const effDM = isDM && !viewAsPlayer;
  const effPlayer = (!isDM || viewAsPlayer) && myCharacterId != null;
  const SIDEBARS = [
    { id: 'maps', label: 'Karten', icon: '🗺', iconSrc: '/Assets/vtt/maps.svg', show: effDM, render: () => <MapManager /> },
    { id: 'grid', label: 'Grid · Fog · Licht', icon: '⚙', iconSrc: '/Assets/vtt/grid.svg', show: effDM && !!activeMap, render: () => <GridControls map={activeMap} /> },
    { id: 'levels', label: 'Ebenen', icon: '🪜', iconSrc: '/Assets/vtt/levels.svg', show: effDM && !!activeMap, render: () => <LevelPanel /> },
    { id: 'sheet', label: 'Charakter', icon: '📜', iconSrc: '/Assets/vtt/character.svg', show: effPlayer, render: () => <CharacterSheetPanel /> },
    { id: 'spells', label: 'Zauber', icon: '✦', iconSrc: '/Assets/vtt/spells.svg', show: effPlayer, width: 380, render: () => <SpellsSidebar /> },
    { id: 'inventory', label: 'Inventar', icon: '🎒', iconSrc: '/Assets/vtt/inventory.svg', show: effPlayer, render: () => <InventorySidebar /> },
    { id: 'features', label: 'Features', icon: '✨', iconSrc: '/Assets/vtt/features.svg', show: effPlayer, width: 400, render: () => <PlayerSheetCategory tab="features" /> },
    { id: 'personality', label: 'Persönlichkeit', icon: '📖', iconSrc: '/Assets/vtt/personality.svg', show: effPlayer, width: 380, render: () => <PlayerSheetCategory tab="personality" /> },
    { id: 'levelhistory', label: 'Level-Historie', icon: '📈', iconSrc: '/Assets/vtt/levelhistory.svg', show: effPlayer, render: () => <LevelHistorySidebar /> },
    { id: 'tokens', label: 'Tokens', icon: '👤', iconSrc: '/Assets/vtt/tokens.svg', show: effDM, render: () => <TokenPanel /> },
    { id: 'bestiary', label: 'Bestiary', icon: '🐉', iconSrc: '/Assets/vtt/bestiary.svg', show: effDM && !!activeMap, render: () => <MonsterPanel edition={edition} /> },
    { id: 'initiative', label: 'Initiative', icon: '⚔', iconSrc: '/Assets/vtt/initiative.svg', show: effDM && !!activeMap, render: () => <InitiativeTracker /> },
    { id: 'journal', label: 'Journal', icon: '📓', iconSrc: '/Assets/vtt/journal.svg', show: true, render: () => <JournalSidebar /> },
  ].filter((s) => s.show);
  // Identical rail on both edges: open a category on the left OR the right, so
  // the DM can lay panels out symmetrically (e.g. Karten left, Initiative right).
  const [openLeft, setOpenLeft] = useState(() => (isGM ? ['maps'] : []));
  const [openRight, setOpenRight] = useState([]);
  const mkToggle = (setter) => (id) => setter((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const toggleLeft = mkToggle(setOpenLeft);
  const toggleRight = mkToggle(setOpenRight);

  // Per-sidebar width overrides (drag the inner edge to widen; never below the
  // category's minimum width).
  const [widths, setWidths] = useState({});
  const resizeRef = useRef(null);
  useEffect(() => {
    const move = (e) => {
      const r = resizeRef.current; if (!r) return;
      const delta = r.side === 'left' ? (e.clientX - r.startX) : (r.startX - e.clientX);
      setWidths((w) => ({ ...w, [r.id]: Math.max(r.minW, r.startW + delta) }));
    };
    const up = () => { resizeRef.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  const startPanelResize = (id, side, minW) => (e) => { e.preventDefault(); resizeRef.current = { id, side, startX: e.clientX, startW: widths[id] || minW, minW }; };
  // Reorder a panel WITHIN its side (swap with its neighbour). dir -1 = toward
  // the window edge, +1 = inward. First in the array sits at the edge.
  const reorderPanel = (id, side, dir) => {
    const setter = side === 'left' ? setOpenLeft : setOpenRight;
    setter((arr) => {
      const i = arr.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return arr;
      const next = [...arr];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const renderRail = (open, toggle, railStyle) => (
    <div style={railStyle}>
      {SIDEBARS.map((s) => (
        <button key={s.id} title={s.label} onClick={() => toggle(s.id)} style={{ ...S.railBtn, ...(open.includes(s.id) ? S.railBtnActive : null) }}>
          <Icon src={s.iconSrc} emoji={s.icon} size={22} />
        </button>
      ))}
    </div>
  );
  const renderPanels = (open, toggle, containerStyle, panelStyle, side) => (
    <div style={containerStyle}>
      {open.map((id) => SIDEBARS.find((s) => s.id === id)).filter(Boolean).map((s) => {
        const minW = s.width || 290;
        const w = Math.max(minW, widths[s.id] || minW);
        return (
        <aside key={s.id} style={{ ...panelStyle, width: w }}>
          <div style={side === 'left' ? S.resizeRight : S.resizeLeft} onMouseDown={startPanelResize(s.id, side, minW)} title="Breite ziehen" />
          <div style={S.panelHead}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
              <Icon src={s.iconSrc} emoji={s.icon} size={18} />
              {s.label}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={S.panelClose} title="Richtung Rand" onClick={() => reorderPanel(s.id, side, -1)}>{side === 'left' ? '‹' : '›'}</button>
              <button style={S.panelClose} title="Nach innen" onClick={() => reorderPanel(s.id, side, +1)}>{side === 'left' ? '›' : '‹'}</button>
              <button style={S.panelClose} title="Schließen" onClick={() => toggle(s.id)}>×</button>
            </div>
          </div>
          <div style={S.panelBody}>{s.render()}</div>
        </aside>
        );
      })}
    </div>
  );

  useEffect(() => {
    setSession({ userId, role: isGM ? 'dm' : 'player', name: playerName, campaignId });
    // Transport: Supabase (cloud) or a direct WebSocket relay hosted on the GM's
    // PC (no cloud). Battlemap state flows through the chosen adapter; character
    // sheets still load from Supabase (see connectCharacterBinding).
    const mode = getConnectionMode();
    const relayUrl = getRelayUrl();
    const useRelay = mode === 'relay' && /^wss?:\/\//i.test(relayUrl);
    const adapter = useRelay
      ? new RelayAdapter({ url: relayUrl, userId })
      : new SupabaseAdapter({ supabase, campaignId, userId });
    connectSync(adapter);
    // Relay mode: the GM is the authoritative host — push a snapshot to the
    // relay periodically so it can persist state (survives disconnects) and
    // bootstrap late joiners.
    let persistTimer = null;
    if (useRelay && isGM) {
      const t0 = setTimeout(persistSnapshot, 2500);
      persistTimer = setInterval(persistSnapshot, 10000);
      persistTimer = { interval: persistTimer, t0 };
    }
    // Bind tokens to their real characters (HP/conditions ↔ dnd_characters).
    connectCharacterBinding({ supabase, campaignId, isGM, userId });
    return () => {
      disconnectCharacterBinding();
      adapter.disconnect();
      if (persistTimer) { clearInterval(persistTimer.interval); clearTimeout(persistTimer.t0); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, userId, isGM]);

  // Effective role (GM can preview the player view). Drives UI gating + renderer.
  useEffect(() => {
    setSession({ role: isGM && !viewAsPlayer ? 'dm' : 'player' });
  }, [isGM, viewAsPlayer]);

  // Open a token's context menu. Several can be open at once (DM / followers);
  // re-opening an existing one just repositions it. They persist until closed
  // via their ✕ (a map click no longer dismisses them).
  const handleContextMenu = (tokenId, x, y) => setCtxMenus((m) =>
    m.some((e) => e.tokenId === tokenId) ? m.map((e) => (e.tokenId === tokenId ? { ...e, x, y } : e)) : [...m, { tokenId, x, y }]);
  const closeCtxMenu = (tokenId) => setCtxMenus((m) => m.filter((e) => e.tokenId !== tokenId));
  // Keep the store informed which tokens have an open menu, so the renderer
  // won't deselect them on an empty-map click.
  useEffect(() => { setContextTokens(ctxMenus.map((e) => e.tokenId)); }, [ctxMenus]);
  // Double-click a token: NPCs (statblock) and characters both open an overlay.
  // Multiple can be open at once; double-clicking the same token is a no-op.
  const handleTokenActivate = (tokenId) => {
    const t = getState().tokens[tokenId];
    if (!t || !(t.statblock || t.characterId != null)) return;
    // Double-clicking YOUR OWN character token opens the full sheet popout
    // window; everything else opens the in-app statblock/sheet overlay.
    if (t.characterId != null && t.characterId === myCharacterId) {
      openSheetPopout(t.characterId);
      return;
    }
    setStatTokenIds((ids) => (ids.includes(tokenId) ? ids : [...ids, tokenId]));
  };

  return (
    <TooltipProvider>
    <div style={{ ...S.root, ...fsVars }}>
      <div style={S.stageBg}>
        {activeMap ? (
          <PixiStage
            onContextMenu={handleContextMenu}
            onTokenActivate={handleTokenActivate}
            onTransitionPrompt={(tokenId, transitionId) => setTravelPrompt({ tokenId, transitionId })}
            onReady={(r) => { rendererRef.current = r; }}
          />
        ) : (
          <div style={S.empty}>
            <div>
              <h2 style={{ margin: '0 0 8px' }}>Keine aktive Map</h2>
              <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
                {isDM ? 'Importiere links eine Map und aktiviere sie für den Tisch.' : 'Warte, bis der DM eine Map öffnet.'}
              </p>
            </div>
          </div>
        )}
      </div>

      <div style={S.topbar}>
        <div style={S.header}>
          {onExit && <button style={S.back} onClick={onExit}>← Zurück</button>}
          <span style={{ fontWeight: 600 }}>Battlemap</span>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>{isDM ? 'DM' : (playerName || 'Spieler')}</span>
          {isGM && (
            <button style={S.viewToggle} onClick={() => setViewAsPlayer((v) => !v)}
              title="Zwischen DM-Werkzeugen und Spieler-Ansicht wechseln">
              {viewAsPlayer ? '👁 Spieler-Ansicht' : '🛠 DM-Ansicht'}
            </button>
          )}
          {isDM && (
            <button style={{ ...S.viewToggle, ...(sessionLive ? S.sessionOn : null) }} onClick={toggleSession}
              title={sessionLive ? 'Live-Session beenden' : 'Live-Session starten — Spieler können der Map beitreten'}>
              {sessionLive ? '■ Session beenden' : '▶ Session starten'}
            </button>
          )}
          {isDM && (
            <button style={{ ...S.viewToggle, ...(paused ? S.pauseOn : null) }} onClick={() => setPaused(!paused)}
              title="Session einfrieren — Spieler können nicht bewegen/agieren">
              {paused ? '▶ Fortsetzen' : '⏸ Pause'}
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button style={S.iconBtn} onClick={() => setShowSettings(true)} title="VTT-Einstellungen">⚙</button>
            <button style={S.iconBtn} onClick={() => setShowBug(true)} title="Bug melden">⚐</button>
            <button style={S.iconBtn} onClick={() => signOut?.()} title="Abmelden">⎋</button>
          </div>
        </div>
        <Toolbar />
      </div>

      {activeMap && <InitiativeBar />}
      {activeMap && <TurnNotice />}

      {paused && (
        <div style={S.pauseBanner}>⏸ Session pausiert{isDM ? ' — nur du kannst noch bearbeiten' : ' — warte auf den DM'}</div>
      )}

      {targeting && (
        <div style={S.targetBar}>
          <span>🎯 {targeting.label || 'Ziel wählen'}{targeting.rangeFt ? ` · ${targeting.rangeFt} ft` : ''} · {targeting.targets.length} Ziel(e)</span>
          <button style={S.targetConfirm} onClick={() => confirmTargeting()}>Bestätigen</button>
          <button style={S.targetCancel} onClick={() => cancelTargeting()}>Abbrechen</button>
        </div>
      )}

      {/* Identical icon rails on both edges; categories open on either side. */}
      {renderRail(openLeft, toggleLeft, S.railLeft)}
      {renderRail(openRight, toggleRight, S.railRight)}
      {renderPanels(openLeft, toggleLeft, S.panelsLeft, S.panel, 'left')}
      {renderPanels(openRight, toggleRight, S.panelsRight, S.panelRight, 'right')}

      {/* Player (or GM previewing as player): play surface for your character. */}
      {myCharacterId != null && activeMap && (!isDM || viewAsPlayer) && <PlayerBottomBar />}
      {/* DM tools view: active tool's settings, otherwise party passives. */}
      {isDM && !viewAsPlayer && activeMap && <DMBottomBar />}

      {/* Contextual editors (zone/wall/light) float at top-center over the map.
          A close button deselects without forcing any edit. */}
      {hasContextEditor && (
        <div style={S.topCenter}>
          <button style={S.editorClose} title="Auswahl schließen" onClick={() => { selectZone(null); selectTerrain(null); }}>✕ Schließen</button>
          <ZoneEditor />
          <WallEditor />
          <LightEditor />
          <TerrainEditor />
        </div>
      )}

      {ctxMenus.map((m) => (
        <TokenContextMenu key={m.tokenId} tokenId={m.tokenId} x={m.x} y={m.y} onClose={() => closeCtxMenu(m.tokenId)} />
      ))}
      {statTokenIds.map((id, i) => (
        <StatblockOverlay
          key={id}
          tokenId={id}
          index={i}
          isGM={isDM}
          userId={userId}
          onClose={() => setStatTokenIds((ids) => ids.filter((x) => x !== id))}
        />
      ))}
      {travelPrompt && (
        <TransitionPrompt tokenId={travelPrompt.tokenId} transitionId={travelPrompt.transitionId} onClose={() => setTravelPrompt(null)} />
      )}
      {/* DM-presented handout: shown to everyone (synced). DM's close stops it
          for all; a player's close only hides it for themselves. */}
      {presentedHandout && (
        <HandoutOverlay
          entry={presentedHandout}
          onClose={() => (isDM ? presentHandout(null) : setDismissedHandout(presentedHandout.id))}
          footer={isDM
            ? <button style={S.handoutStop} onClick={() => presentHandout(null)}>Für alle beenden</button>
            : <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Schließen blendet es nur für dich aus.</span>}
        />
      )}
      {activeMap && <DiceTray />}
      {activeMap && effPlayer && <NotesFab />}
      {showSettings && <VttSettings onClose={() => setShowSettings(false)} />}
      <BugReportModal open={showBug} onClose={() => setShowBug(false)} />
      <TooltipLayer />
    </div>
    </TooltipProvider>
  );
}

const TOPBAR_H = 92;
const RAIL_W = 44;

const S = {
  root: { position: 'relative', height: '100%', width: '100%', overflow: 'hidden' },
  stageBg: { position: 'absolute', inset: 0, zIndex: 0, background: '#0b0e14' },
  topbar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30 },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-elevated)' },
  back: { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  iconBtn: { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', width: 30, height: 30, cursor: 'pointer', fontSize: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  sessionOn: { background: 'color-mix(in srgb, var(--accent-green,#4ade80) 22%, transparent)', borderColor: 'var(--accent-green,#4ade80)', color: 'var(--accent-green,#4ade80)' },
  viewToggle: { marginLeft: 'auto', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--fs-sm)' },

  // Icon rails (one button per category) on both edges.
  railLeft: { position: 'absolute', top: TOPBAR_H, bottom: 0, left: 0, width: RAIL_W, zIndex: 25, borderRight: '1px solid var(--color-border)', background: 'var(--color-bg-elevated)', display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 2px', overflowY: 'auto' },
  railRight: { position: 'absolute', top: TOPBAR_H, bottom: 0, right: 0, width: RAIL_W, zIndex: 25, borderLeft: '1px solid var(--color-border)', background: 'var(--color-bg-elevated)', display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 2px', overflowY: 'auto' },
  railBtn: { width: '100%', height: 40, display: 'grid', placeItems: 'center', background: 'transparent', color: 'var(--color-text)', border: '1px solid transparent', borderRadius: 'var(--radius-md)', cursor: 'pointer' },
  railBtnActive: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: '1px solid var(--color-accent)' },

  // Open category sidebars: left grows rightward, right grows leftward.
  panelsLeft: { position: 'absolute', top: TOPBAR_H, bottom: 0, left: RAIL_W, zIndex: 20, display: 'flex', flexDirection: 'row', pointerEvents: 'none' },
  panelsRight: { position: 'absolute', top: TOPBAR_H, bottom: 0, right: RAIL_W, zIndex: 20, display: 'flex', flexDirection: 'row-reverse', pointerEvents: 'none' },
  panel: { position: 'relative', pointerEvents: 'auto', width: 290, height: '100%', boxSizing: 'border-box', borderRight: '1px solid var(--color-border)', background: 'rgba(15,17,21,0.94)', backdropFilter: 'blur(3px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  panelRight: { position: 'relative', pointerEvents: 'auto', width: 290, height: '100%', boxSizing: 'border-box', borderLeft: '1px solid var(--color-border)', background: 'rgba(15,17,21,0.94)', backdropFilter: 'blur(3px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  resizeRight: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 6, cursor: 'ew-resize', zIndex: 2 },
  resizeLeft: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 6, cursor: 'ew-resize', zIndex: 2 },
  panelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 },
  panelClose: { width: 24, height: 24, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 15, lineHeight: 1 },
  panelBody: { flex: 1, minHeight: 0, padding: 12, overflowY: 'auto', overflowX: 'auto', display: 'flex', flexDirection: 'column', gap: 12 },

  // Contextual tool editors float at top-center over the map.
  topCenter: { position: 'absolute', top: TOPBAR_H + 8, left: '50%', transform: 'translateX(-50%)', zIndex: 22, width: 300, maxHeight: 'calc(100% - 110px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, pointerEvents: 'auto' },
  empty: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' },
  handoutStop: { padding: '4px 12px', background: 'var(--color-danger)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700, fontSize: 'var(--fs-sm)' },
  editorClose: { alignSelf: 'flex-end', padding: '3px 10px', background: 'rgba(15,17,21,0.9)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  pauseOn: { background: 'var(--color-warning,#e0af68)', color: '#000', border: '1px solid var(--color-warning,#e0af68)' },
  pauseBanner: { position: 'absolute', top: 'calc(var(--topbar-h, 96px))', left: '50%', transform: 'translateX(-50%)', zIndex: 30, padding: '6px 16px', background: 'color-mix(in srgb, var(--color-warning,#e0af68) 88%, #000)', color: '#000', fontWeight: 800, borderRadius: '0 0 10px 10px', boxShadow: '0 4px 16px #0008', pointerEvents: 'none' },
  targetBar: { position: 'absolute', top: 'calc(var(--topbar-h, 96px) + 8px)', left: '50%', transform: 'translateX(-50%)', zIndex: 31, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'rgba(15,17,21,0.96)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', boxShadow: '0 4px 16px #0008', fontSize: 'var(--fs-sm)' },
  targetConfirm: { padding: '4px 12px', background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700 },
  targetCancel: { padding: '4px 12px', background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' },
};
