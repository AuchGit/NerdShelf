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
import DataPanel from './components/DataPanel';
import InitiativeTracker from './components/InitiativeTracker';
import RollLogSidebar from './components/RollLogSidebar';
import TokenContextMenu from './components/TokenContextMenu';
import StatblockOverlay from './components/StatblockOverlay';
import CharacterSheetPanel from './components/CharacterSheetPanel';
import PlayerSheetCategory from './components/PlayerSheetCategory';
import InventorySidebar from './components/InventorySidebar';
import SpellsSidebar from './components/SpellsSidebar';
import PlayerBottomBar from './components/PlayerBottomBar';
import Icon from './components/Icon';
import TransitionEditor from './components/TransitionEditor';
import ContextEditorDock from './components/ContextEditorDock';
import InitiativeBar from './components/InitiativeBar';
import InitiativeFab from './components/InitiativeFab';
import TurnNotice from './components/TurnNotice';
import InitiativePrompt from './components/InitiativePrompt';
import TransitionPrompt from './components/TransitionPrompt';
import JournalSidebar from './components/JournalSidebar';
import HandoutOverlay from './components/HandoutOverlay';
import DMBottomBar from './components/DMBottomBar';
import LevelHistorySidebar from './components/LevelHistorySidebar';
import DiceTray from './components/DiceTray';
import NotesFab from './components/NotesFab';
import VttSettings from './components/VttSettings';
import Toasts from './components/Toasts';
import ShortcutOverlay from './components/ShortcutOverlay';
import BugReportModal from '../../../core/bug-report/BugReportModal';
import { useAuth } from '../../../core/auth/AuthContext';
import { openSheetPopout } from '../character-builder/lib/sheetPopout';
import { TooltipProvider, TooltipLayer } from './components/tooltip/Tooltips';
import { connectSync, getState, persistSnapshot } from './state/store';
import { setSession, presentHandout, setPaused, confirmTargeting, cancelTargeting, setContextTokens, setViewedMap } from './state/actions';
import { SupabaseAdapter } from './sync/SupabaseAdapter';
import { RelayAdapter } from './sync/RelayAdapter';
import { connectCharacterBinding, disconnectCharacterBinding } from './sync/characterBinding';
import { useIsDM, useActiveMap, useVtt } from './state/useVtt';
import { useUiScale, getConnectionMode, getRelayUrl, setConnectionMode, setRelayUrl, useConnectionMode } from './lib/vttPrefs';
import { setSessionActive } from '../character-builder/lib/campaigns';
import { startEmbeddedRelay, stopEmbeddedRelay, listLocalIps, probeRelayUrls, classifyIp } from './lib/relayHost';

// Base theme font sizes (theme.css) — scaled by the VTT UI-size preference.
const FS_BASE = { '--fs-xs': 11, '--fs-sm': 13, '--fs-md': 14, '--fs-lg': 16, '--fs-xl': 19, '--fs-2xl': 24, '--fs-3xl': 32 };

// Automatischer Chrome-Maßstab: das UI ist für 2K (2560×1440) getunt. Auf
// kleineren Schirmen skalieren wir proportional (kleinere Kante entscheidet),
// begrenzt auf einen sinnvollen Bereich, damit es nie winzig/riesig wird.
const DESIGN_W = 2560; const DESIGN_H = 1440;
function computeAutoFactor() {
  if (typeof window === 'undefined') return 1;
  const w = window.innerWidth || DESIGN_W; const h = window.innerHeight || DESIGN_H;
  return Math.max(0.72, Math.min(1.1, Math.min(w / DESIGN_W, h / DESIGN_H)));
}

export default function VttApp({ campaignId, userId, isGM = false, playerName = '', edition = '5e', onExit }) {
  const rendererRef = useRef(null);
  const [ctxMenus, setCtxMenus] = useState([]); // multiple, draggable token menus
  const [showSettings, setShowSettings] = useState(false);
  const [showBug, setShowBug] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  // `?` toggles the keyboard cheat-sheet (skipped while typing in a field).
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      if (e.key === '?') { setShowShortcuts((v) => !v); e.preventDefault(); }
      if (e.key === 'Escape') setShowShortcuts(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [sessionLive, setSessionLive] = useState(false);
  const [transportNonce, setTransportNonce] = useState(0);
  const announcedRelayUrl = useVtt((s) => s.ui.announcedRelayUrl);
  const connMode = useConnectionMode();
  const { signOut } = useAuth();

  // Switch the live sync transport without a VTT restart (bumps the connect
  // effect, which tears down the old adapter and connects the new one).
  const switchTransport = (mode, url) => {
    setConnectionMode(mode);
    if (url) setRelayUrl(url);
    setTransportNonce((n) => n + 1);
  };
  const [lanPicker, setLanPicker] = useState(null); // { ips:[], checked:Set } while the DM chooses interfaces
  const [lanStatus, setLanStatus] = useState('idle'); // player join state: idle|probing|relay|online
  // A player auto-reverts to Supabase when the GM stops hosting (URL cleared).
  useEffect(() => {
    if (isGM || connMode !== 'relay' || announcedRelayUrl) return undefined;
    const id = setTimeout(() => { switchTransport('supabase'); setLanStatus('online'); }, 0);
    return () => clearTimeout(id);
  }, [announcedRelayUrl, connMode, isGM]);

  // Player auto-join: when the DM announces LAN URL(s), probe them — if we're on
  // the same network, upgrade to the direct (relay) transport; otherwise stay
  // online (Supabase). Re-probes when the announced URL(s) change.
  useEffect(() => {
    if (isGM || !announcedRelayUrl || connMode === 'relay') return undefined;
    let cancelled = false;
    const id = setTimeout(() => {
      setLanStatus('probing');
      probeRelayUrls(announcedRelayUrl).then((url) => {
        if (cancelled) return;
        if (url) { switchTransport('relay', url); setLanStatus('relay'); }
        else setLanStatus('online');
      });
    }, 0);
    return () => { cancelled = true; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcedRelayUrl, isGM]);

  // DM starts/ends the live session. On start we offer the LAN interface picker
  // (the relay binds 0.0.0.0; the DM ticks which IPs to share over), then host +
  // announce. On stop we tear the relay down and drop everyone back to online.
  const beginSession = async (chosenIps) => {
    setLanPicker(null);
    try {
      await setSessionActive(campaignId, true);
      setSessionLive(true);
      if (chosenIps && chosenIps.length) {
        const url = await startEmbeddedRelay({ supabase, campaignId, ips: chosenIps });
        if (url) { console.log('[vtt] hosting LAN relay at', chosenIps.join(', ')); switchTransport('relay', url); }
      }
      // else: online-only session (no relay hosted/announced).
    } catch (e) { console.error('Session start failed', e); }
  };
  const toggleSession = async () => {
    if (sessionLive) {
      if (!window.confirm('Live-Session wirklich beenden?')) return;
      try {
        await setSessionActive(campaignId, false);
        setSessionLive(false);
        await stopEmbeddedRelay({ supabase, campaignId });
        switchTransport('supabase');
      } catch (e) { console.error('Session stop failed', e); }
      return;
    }
    // Starting: let the DM choose LAN interfaces (desktop). On web, online-only.
    const ips = await listLocalIps(); // [{ip, name}]
    if (ips.length) setLanPicker({ ips, checked: new Set(ips.map((e) => e.ip)) });
    else beginSession(null);
  };
  // Player: re-attempt the LAN probe on demand (e.g. after joining the network).
  const retryLan = () => {
    if (!announcedRelayUrl) return;
    setLanStatus('probing');
    probeRelayUrls(announcedRelayUrl).then((url) => {
      if (url) { switchTransport('relay', url); setLanStatus('relay'); } else setLanStatus('online');
    });
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
  // Inspiration marks the WHOLE UI (a gold ring/glow around the viewport), not
  // just the bottom bar, so you can't miss that you're holding it.
  const myInspired = useVtt((s) => {
    const cid = s.ui.myCharacterId;
    const d = cid != null ? s.ui.characters?.[cid]?.data : null;
    return !!(d?.status?.inspiration || d?.info?.inspiration);
  });
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
  // VTT UI size: scale the theme font-size variables on the root only. Das UI
  // ist für 2K (2560×1440) getunt; auf kleineren Schirmen (z.B. 1080p) skalieren
  // wir die Chrome PROPORTIONAL herunter, damit Größen/Abstände relativ gleich
  // aussehen. Der manuelle uiScale bleibt als Feineinstellung obendrauf.
  const uiScale = useUiScale();
  const [autoFactor, setAutoFactor] = useState(() => computeAutoFactor());
  useEffect(() => {
    const onResize = () => setAutoFactor(computeAutoFactor());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const effScale = uiScale * autoFactor;
  const fsVars = useMemo(() => {
    const v = {}; for (const k in FS_BASE) v[k] = `${(FS_BASE[k] * effScale).toFixed(2)}px`; return v;
  }, [effScale]);
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
    { id: 'bestiary', label: 'Kompendium', icon: '🐉', iconSrc: '/Assets/vtt/bestiary.svg', show: effDM && !!activeMap, render: () => <DataPanel edition={edition} /> },
    { id: 'initiative', label: 'Initiative', icon: '⚔', iconSrc: '/Assets/vtt/initiative.svg', show: effDM && !!activeMap, render: () => <InitiativeTracker /> },
    // DM sieht alle Würfe, Spieler nur die eigenen (Filter in der Sidebar).
    { id: 'rolllog', label: 'Roll-Log', icon: '🎲', iconSrc: '/Assets/dice-twenty-faces-twenty.svg', show: true, render: () => <RollLogSidebar /> },
    { id: 'journal', label: 'Journal', icon: '📓', iconSrc: '/Assets/vtt/journal.svg', show: true, render: () => <JournalSidebar /> },
  ].filter((s) => s.show);
  // Identical rail on both edges: open a category on the left OR the right, so
  // the DM can lay panels out symmetrically (e.g. Karten left, Initiative right).
  const [openLeft, setOpenLeft] = useState(() => (isGM ? ['maps'] : []));
  const [openRight, setOpenRight] = useState([]);
  const mkToggle = (setter) => (id) => setter((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const toggleLeft = mkToggle(setOpenLeft);
  const toggleRight = mkToggle(setOpenRight);
  // Der Initiative-FAB über der Karte öffnet die Initiative-Leiste rechts.
  useEffect(() => {
    const open = () => setOpenRight((ids) => (ids.includes('initiative') ? ids : [...ids, 'initiative']));
    window.addEventListener('vtt:open-initiative', open);
    return () => window.removeEventListener('vtt:open-initiative', open);
  }, []);

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
        // Standardbreite proportional zur Chrome-Skalierung (2K→1080p), damit
        // die Panels relativ gleich breit wirken; eigene Resizes bleiben erhalten.
        const minW = Math.round((s.width || 290) * autoFactor);
        const w = Math.max(minW, widths[s.id] || minW);
        return (
        <aside key={s.id} style={{ ...panelStyle, width: w, ...(myInspired ? S.panelInsp : null) }}>
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
    setSession({ userId, role: isGM ? 'dm' : 'player', realGM: isGM, name: playerName, campaignId });
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
  }, [campaignId, userId, isGM, transportNonce]);

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
    // Charakter-Token (eigenes ODER fremdes): Sheet als Popout-Fenster.
    //  • eigenes → editierbar. • DM auf fremdes → schreibgeschützt
    //    (`#/campaign/<id>/character/<charId>`, campaignId aus dem Prop —
    //    zuverlässig, session.campaignId war teils leer → Kampagnenseite).
    // Nur NPC-Statblock-Token öffnen das In-App-Overlay.
    if (t.characterId != null) {
      if (t.characterId === myCharacterId) openSheetPopout(t.characterId);
      else if (isGM) openSheetPopout(t.characterId, { route: `#/campaign/${campaignId}/character/${t.characterId}` });
      else setStatTokenIds((ids) => (ids.includes(tokenId) ? ids : [...ids, tokenId]));
      return;
    }
    setStatTokenIds((ids) => (ids.includes(tokenId) ? ids : [...ids, tokenId]));
  };

  return (
    <TooltipProvider>
    <div style={{ ...S.root, ...fsVars }}>
      {myInspired && <div style={S.inspirationFrame} aria-hidden />}
      {lanPicker && (
        <div style={S.lanBackdrop} onClick={() => setLanPicker(null)}>
          <div style={S.lanModal} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)', marginBottom: 6 }}>Session starten — LAN-Freigabe</div>
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', margin: '0 0 10px' }}>
              Über welche Netzwerk-Adresse(n) sollen Spieler im selben Netzwerk direkt (LAN) beitreten können?
              Spieler außerhalb deines Netzwerks verbinden sich automatisch online. Nichts anhaken = nur online.
            </p>
            {lanPicker.ips.map(({ ip, name }) => (
              <label key={ip} style={S.lanRow}>
                <input type="checkbox" checked={lanPicker.checked.has(ip)}
                  onChange={(e) => setLanPicker((p) => {
                    const checked = new Set(p.checked);
                    if (e.target.checked) checked.add(ip); else checked.delete(ip);
                    return { ...p, checked };
                  })} />
                <span style={{ fontFamily: 'monospace' }}>{ip}</span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name || 'Netzwerk'} · {classifyIp(ip, name)}
                </span>
              </label>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button style={S.iconBtn} onClick={() => setLanPicker(null)}>Abbrechen</button>
              <button style={{ ...S.viewToggle, ...S.sessionOn }} onClick={() => beginSession([...lanPicker.checked])}>
                {lanPicker.checked.size ? `Starten — ${lanPicker.checked.size} IP(s) + Online` : 'Nur online starten'}
              </button>
            </div>
          </div>
        </div>
      )}
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
          {/* Spieler-Kartenwahl: zwischen allen DM-sichtbaren Karten wechseln;
              die aktive ist markiert. Nur in der Spieler-Ansicht. */}
          {(!isDM || viewAsPlayer) && <PlayerMapSwitcher />}
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
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            {!isGM && connMode === 'relay' && (
              <span style={S.directOn} title={`LAN-Direktverbindung aktiv: ${getRelayUrl()}`}>🔌 LAN-Direkt</span>
            )}
            {!isGM && connMode !== 'relay' && announcedRelayUrl && lanStatus === 'probing' && (
              <span style={S.directProbing} title="Suche LAN-Verbindung zum DM…">🔌 LAN…</span>
            )}
            {!isGM && connMode !== 'relay' && announcedRelayUrl && lanStatus !== 'probing' && (
              <button style={S.joinDirect} onClick={retryLan}
                title={`Online verbunden. Klick: LAN-Direktverbindung erneut versuchen (${announcedRelayUrl})`}>☁ Online · LAN erneut</button>
            )}
            <button style={S.iconBtn} onClick={() => setShowShortcuts(true)} title="Tastenkürzel (?)">⌨</button>
            <button style={S.iconBtn} onClick={() => setShowSettings(true)} title="VTT-Einstellungen">⚙</button>
            <button style={S.iconBtn} onClick={() => setShowBug(true)} title="Bug melden">⚐</button>
            <button style={S.iconBtn} onClick={() => signOut?.()} title="Abmelden">⎋</button>
          </div>
        </div>
        <Toolbar />
      </div>

      {activeMap && <InitiativeBar />}
      {activeMap && <TurnNotice />}
      {activeMap && <InitiativePrompt />}
      {activeMap && <InitiativeFab />}

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

      {/* Objekt-Editoren (Zone/Wand/Licht/Terrain) in einem verschieb- und
          schließbaren Dock über der Karte. */}
      {hasContextEditor && <ContextEditorDock />}
      {/* Übergangs-Editor: eigenes schwebendes, verschieb-/schließbares Fenster
          (per Klick aufs Feld wieder öffenbar) — nicht im fixen Kontext-Block. */}
      <TransitionEditor />

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
      {showShortcuts && <ShortcutOverlay onClose={() => setShowShortcuts(false)} />}
      <Toasts />
      <TooltipLayer />
    </div>
    </TooltipProvider>
  );
}

// Spieler-Kartenwahl (Top-Toolbar): Dropdown über alle DM-sichtbaren Karten
// + die aktive. Auswahl setzt die lokal betrachtete Karte; "● aktiv"
// kennzeichnet die vom DM aktivierte. Aktiviert der DM eine neue Karte, wird
// viewedMapId serverseitig zurückgesetzt → der Spieler springt automatisch drauf.
function PlayerMapSwitcher() {
  const maps = useVtt((s) => Object.values(s.maps));
  const activeMapId = useVtt((s) => s.activeMapId);
  const viewedMapId = useVtt((s) => s.ui.viewedMapId);
  const visible = maps.filter((m) => m.id === activeMapId || m.playerVisible);
  if (visible.length <= 1) return null; // nichts zu wechseln
  const current = viewedMapId || activeMapId || '';
  return (
    <select
      value={current}
      onChange={(e) => setViewedMap(e.target.value === activeMapId ? null : e.target.value)}
      title="Karte wählen"
      style={{ padding: '3px 8px', borderRadius: 6, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontSize: 'var(--fs-sm)', maxWidth: 220 }}>
      {visible.map((m) => (
        <option key={m.id} value={m.id}>{m.name}{m.id === activeMapId ? '  ● aktiv' : ''}</option>
      ))}
    </select>
  );
}

const TOPBAR_H = 92;
const RAIL_W = 44;

const S = {
  root: { position: 'relative', height: '100%', width: '100%', overflow: 'hidden' },
  // Whole-viewport gold ring + inner glow shown while the player holds Inspiration.
  inspirationFrame: { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 95, borderRadius: 4, boxShadow: 'inset 0 0 0 3px var(--color-warning,#e0af68), inset 0 0 30px -2px var(--color-warning,#e0af68)' },
  stageBg: { position: 'absolute', inset: 0, zIndex: 0, background: '#0b0e14' },
  topbar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30 },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-elevated)' },
  back: { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  iconBtn: { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', width: 30, height: 30, cursor: 'pointer', fontSize: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  sessionOn: { background: 'color-mix(in srgb, var(--accent-green,#4ade80) 22%, transparent)', borderColor: 'var(--accent-green,#4ade80)', color: 'var(--accent-green,#4ade80)' },
  joinDirect: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none', borderRadius: 'var(--radius-md)', padding: '5px 10px', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 700 },
  directOn: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--accent-green,#4ade80)', border: '1px solid var(--accent-green,#4ade80)', borderRadius: 'var(--radius-md)', padding: '3px 8px' },
  directProbing: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '3px 8px' },
  lanBackdrop: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  lanModal: { width: 'min(440px, 92vw)', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 12px 48px #000b', padding: 16 },
  lanRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 'var(--fs-sm)' },
  viewToggle: { marginLeft: 'auto', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--fs-sm)' },

  // Icon rails (one button per category) on both edges.
  railLeft: { position: 'absolute', top: TOPBAR_H, bottom: 0, left: 0, width: RAIL_W, zIndex: 25, borderRight: '1px solid var(--color-border)', background: 'var(--color-bg-elevated)', display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 2px', overflowY: 'auto' },
  railRight: { position: 'absolute', top: TOPBAR_H, bottom: 0, right: 0, width: RAIL_W, zIndex: 25, borderLeft: '1px solid var(--color-border)', background: 'var(--color-bg-elevated)', display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 2px', overflowY: 'auto' },
  railBtn: { width: '100%', height: 40, display: 'grid', placeItems: 'center', background: 'transparent', color: 'var(--color-text)', border: '1px solid transparent', borderRadius: 'var(--radius-md)', cursor: 'pointer' },
  railBtnActive: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: '1px solid var(--color-accent)' },

  // Open category sidebars: left grows rightward, right grows leftward.
  panelsLeft: { position: 'absolute', top: TOPBAR_H, bottom: 0, left: RAIL_W, zIndex: 20, display: 'flex', flexDirection: 'row', pointerEvents: 'none' },
  panelsRight: { position: 'absolute', top: TOPBAR_H, bottom: 0, right: RAIL_W, zIndex: 20, display: 'flex', flexDirection: 'row-reverse', pointerEvents: 'none' },
  panel: { position: 'relative', pointerEvents: 'auto', width: 290, height: '100%', boxSizing: 'border-box', borderRight: '1px solid var(--color-border)', background: 'color-mix(in srgb, var(--color-bg-elevated) 94%, transparent)', backdropFilter: 'blur(3px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  panelRight: { position: 'relative', pointerEvents: 'auto', width: 290, height: '100%', boxSizing: 'border-box', borderLeft: '1px solid var(--color-border)', background: 'color-mix(in srgb, var(--color-bg-elevated) 94%, transparent)', backdropFilter: 'blur(3px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  // Inspiration vergoldet auch offene Sidebars (Bar + Bottom-Panels machen es genauso).
  panelInsp: { borderColor: 'var(--color-warning,#e0af68)', boxShadow: 'inset 0 0 0 1px var(--color-warning,#e0af68), 0 0 18px -4px var(--color-warning,#e0af68)' },
  resizeRight: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 6, cursor: 'ew-resize', zIndex: 2 },
  resizeLeft: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 6, cursor: 'ew-resize', zIndex: 2 },
  panelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 },
  panelClose: { width: 24, height: 24, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 15, lineHeight: 1 },
  panelBody: { flex: 1, minHeight: 0, padding: 12, overflowY: 'auto', overflowX: 'auto', display: 'flex', flexDirection: 'column', gap: 12 },

  // Contextual tool editors float at top-center over the map.
  topCenter: { position: 'absolute', top: TOPBAR_H + 8, left: '50%', transform: 'translateX(-50%)', zIndex: 22, width: 300, maxHeight: 'calc(100% - 110px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, pointerEvents: 'auto' },
  empty: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' },
  handoutStop: { padding: '4px 12px', background: 'var(--color-danger)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700, fontSize: 'var(--fs-sm)' },
  editorClose: { alignSelf: 'flex-end', padding: '3px 10px', background: 'color-mix(in srgb, var(--color-bg-elevated) 90%, transparent)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  pauseOn: { background: 'var(--color-warning,#e0af68)', color: '#000', border: '1px solid var(--color-warning,#e0af68)' },
  pauseBanner: { position: 'absolute', top: 'calc(var(--topbar-h, 96px))', left: '50%', transform: 'translateX(-50%)', zIndex: 30, padding: '6px 16px', background: 'color-mix(in srgb, var(--color-warning,#e0af68) 88%, #000)', color: '#000', fontWeight: 800, borderRadius: '0 0 10px 10px', boxShadow: '0 4px 16px #0008', pointerEvents: 'none' },
  targetBar: { position: 'absolute', top: 'calc(var(--topbar-h, 96px) + 8px)', left: '50%', transform: 'translateX(-50%)', zIndex: 31, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'color-mix(in srgb, var(--color-bg-elevated) 96%, transparent)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', boxShadow: '0 4px 16px #0008', fontSize: 'var(--fs-sm)' },
  targetConfirm: { padding: '4px 12px', background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700 },
  targetCancel: { padding: '4px 12px', background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' },
};
