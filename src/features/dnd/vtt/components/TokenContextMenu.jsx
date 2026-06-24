// Foundry-style right-click menu on a token: toggle conditions (shown in token
// corners) and change HP by typing a number + Enter (negative = damage).
// Permissions: the token owner or the DM.
import { useEffect, useRef, useState } from 'react';
import { useVtt, useIsDM, useSession } from '../state/useVtt';
import { toggleCondition, applyHpDelta, updateToken, removeToken, cycleTokenLight, selectToken, setHoverToken } from '../state/actions';
import { CONDITIONS, LIGHT_PRESETS, DEFAULT_LIGHT, DISPOSITIONS } from '../lib/constants';
import { openSheetPopout } from '../../character-builder/lib/sheetPopout';
import { uploadHandoutImage } from '../lib/mapStorage';
import Icon from './Icon';

export default function TokenContextMenu({ tokenId, x, y, onClose }) {
  const token = useVtt((s) => s.tokens[tokenId]);
  const isDM = useIsDM();
  const session = useSession();
  const members = useVtt((s) => s.ui.campaignMembers || []);
  const [hpInput, setHpInput] = useState('');
  const [lightFt, setLightFt] = useState('');
  const [auraFt, setAuraFt] = useState('');
  const [auraColor, setAuraColor] = useState('#6c8cff');
  const [tab, setTab] = useState('main');
  const [uploading, setUploading] = useState(false);
  const selectedTokenId = useVtt((s) => s.ui.selectedTokenId);
  const ref = useRef(null);
  const fileRef = useRef(null);
  // Draggable position (initialised from the open coordinates).
  const [pos, setPos] = useState({ x, y });
  const dragRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Drag the menu by its header.
  useEffect(() => {
    const move = (e) => {
      if (!dragRef.current) return;
      setPos({ x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy });
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  const startDrag = (e) => { dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; };

  // Hovering the menu highlights its token on the map (coupling); clear on unmount.
  useEffect(() => () => setHoverToken(null), []);

  if (!token) return null;
  const mayEdit = isDM || (token.kind === 'player' && token.ownerId === session.userId);
  if (!mayEdit) return null;

  const applyHp = () => {
    const delta = parseInt(hpInput, 10);
    if (!Number.isNaN(delta)) applyHpDelta(tokenId, delta, token);
    setHpInput('');
  };

  const addAura = () => {
    const n = parseInt(auraFt, 10);
    if (Number.isNaN(n) || n <= 0) return;
    updateToken(tokenId, { auras: [...(token.auras || []), { id: 'aura_' + Math.random().toString(36).slice(2, 8), radiusFt: n, color: auraColor }] });
    setAuraFt('');
  };
  const removeAura = (id) => updateToken(tokenId, { auras: (token.auras || []).filter((a) => a.id !== id) });

  // DM grants/revokes player control of a token. 'all' = every player. When the
  // result is exactly ONE specific player, the token adopts that player's colour
  // automatically (so followers/pets read as belonging to them).
  const toggleController = (who) => {
    const cur = token.controllers || [];
    const next = cur.includes(who) ? cur.filter((x) => x !== who) : [...cur, who];
    const patch = { controllers: next };
    const single = next.filter((x) => x !== 'all');
    if (!next.includes('all') && single.length === 1) {
      const m = members.find((mm) => mm.userId === single[0]);
      if (m?.color) patch.color = m.color;
    }
    updateToken(tokenId, patch);
  };

  // DM grants/revokes a single player's sight of this invisible token.
  const toggleVisibleTo = (uid) => {
    if (!uid) return;
    const cur = token.visibleTo || [];
    const next = cur.includes(uid) ? cur.filter((x) => x !== uid) : [...cur, uid];
    updateToken(tokenId, { visibleTo: next });
  };

  // Custom light radius (ft). 0 / empty turns the light off; otherwise dim =
  // entered value, bright = half. Keeps the current color if one is set.
  const applyLightFt = () => {
    const dimFt = parseInt(lightFt, 10);
    if (Number.isNaN(dimFt) || dimFt <= 0) { updateToken(tokenId, { light: null }); }
    else updateToken(tokenId, { light: { brightFt: Math.round(dimFt / 2), dimFt, color: token.light?.color || DEFAULT_LIGHT.color } });
    setLightFt('');
  };

  // Upload a custom portrait for this token (e.g. an NPC with no image, or to
  // replace a broken 5etools URL). Reuses the vtt-maps bucket handout path.
  const uploadImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !session.campaignId) return;
    setUploading(true);
    try {
      const { imageUrl } = await uploadHandoutImage(session.campaignId, file);
      updateToken(tokenId, { imageUrl });
    } catch (err) {
      console.error('Token-Bild Upload fehlgeschlagen', err);
    } finally {
      setUploading(false);
    }
  };

  // Open the character sheet popout next to the VTT (Foundry-style overlay).
  // The owner gets their editable sheet; the GM opens the read-only GM sheet.
  const openSheet = () => {
    const route = isDM && token.ownerId !== session.userId
      ? `#/campaign/${session.campaignId}/character/${token.characterId}`
      : undefined;
    openSheetPopout(token.characterId, { route });
    onClose();
  };

  // keep menu on-screen (it scrolls if taller than the viewport)
  const left = Math.min(pos.x, window.innerWidth - 260);
  const top = Math.max(8, Math.min(pos.y, window.innerHeight - 140));
  const isSelected = selectedTokenId === tokenId;

  const tabs = [
    { id: 'main', label: 'Aktionen' },
    { id: 'cond', label: 'Conditions' },
    ...(isDM ? [{ id: 'dm', label: 'DM' }] : []),
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'main';

  return (
    <div ref={ref} style={{ ...S.menu, left, top, ...(isSelected ? S.menuSelected : null) }}
      onClick={(e) => { e.stopPropagation(); selectToken(tokenId); }}
      onMouseEnter={() => setHoverToken(tokenId)} onMouseLeave={() => setHoverToken(null)}>
      <div style={S.header} onMouseDown={startDrag} title="Ziehen zum Verschieben">
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'grab' }}>{token.name}</span>
        <span style={{ cursor: 'pointer', color: 'var(--color-text-muted)' }} onClick={(e) => { e.stopPropagation(); onClose(); }}>✕</span>
      </div>
      <div style={S.tabs}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ ...S.tab, ...(activeTab === t.id ? S.tabActive : null) }}>{t.label}</button>
        ))}
      </div>

      {activeTab === 'main' && (
        <>
          {token.characterId != null && (
            <button style={S.sheet} onClick={openSheet}><Icon src="/Assets/vtt/sheet.svg" emoji="📋" size={14} /> Sheet öffnen</button>
          )}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={uploadImage} />
          <button style={S.sheet} disabled={uploading} onClick={() => fileRef.current?.click()}>
            🖼 {uploading ? 'Lädt…' : (token.imageUrl ? 'Bild ersetzen' : 'Bild hochladen')}
          </button>
          {token.hp != null && (
            <div style={S.section}>
              <div style={S.label}>HP: {token.hp}{token.hpMax ? ` / ${token.hpMax}` : ''}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input autoFocus type="number" placeholder="+5 / -7" value={hpInput}
                  onChange={(e) => setHpInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyHp(); }} style={S.hpInput} />
                <button style={S.apply} onClick={applyHp}>↵</button>
              </div>
            </div>
          )}
          <div style={S.section}>
            <div style={S.label}>Licht{token.light && !token.light.preset ? ` (${token.light.dimFt} ft)` : ''}</div>
            <button style={S.sheet} onClick={() => cycleTokenLight(tokenId, token)}>
              <Icon src="/Assets/vtt/light.svg" emoji="🔦" size={14} /> {token.light?.preset ? (LIGHT_PRESETS[token.light.preset]?.label || token.light.preset) : (token.light ? `${token.light.dimFt} ft` : 'Aus')}
            </button>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <input type="number" min="0" placeholder="ft" value={lightFt}
                onChange={(e) => setLightFt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyLightFt(); }} style={S.hpInput} />
              <button style={S.apply} onClick={applyLightFt} title="Eigene Reichweite setzen">↵</button>
            </div>
          </div>
          <div style={S.section}>
            <div style={S.label}>Umkreis (ft)</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" min="1" placeholder="ft" value={auraFt} onChange={(e) => setAuraFt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addAura(); }} style={S.hpInput} />
              <input type="color" value={auraColor} onChange={(e) => setAuraColor(e.target.value)} title="Farbe" style={{ width: 30, height: 28, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
              <button style={S.apply} onClick={addAura} title="Umkreis hinzufügen">+</button>
            </div>
            {(token.auras || []).map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 'var(--fs-sm)' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: a.color, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{a.radiusFt} ft</span>
                <span style={{ cursor: 'pointer', color: 'var(--color-text-muted)' }} onClick={() => removeAura(a.id)}>✕</span>
              </div>
            ))}
          </div>
        </>
      )}

      {activeTab === 'cond' && (
        <>
          <div style={S.section}>
            <div style={S.condGrid}>
              {CONDITIONS.map((c) => {
                const on = token.conditions.includes(c.id);
                return (
                  <button key={c.id} title={c.label} onClick={() => toggleCondition(tokenId, c.id, token)}
                    style={{ ...S.cond, ...(on ? { background: c.color, border: `1px solid ${c.color}`, color: '#fff' } : null) }}>
                    <img src={c.icon} alt={c.label} style={{ width: 26, height: 26 }} />
                  </button>
                );
              })}
            </div>
          </div>
          {isDM && token.conditions.includes('invisible') && (
            <div style={S.section}>
              <div style={S.label}>Unsichtbar — sichtbar für</div>
              {members.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Keine Spieler in der Campaign.</div>
              ) : members.map((m) => {
                const on = (token.visibleTo || []).includes(m.userId);
                return (
                  <label key={m.userId || m.characterId} style={S.visRow}>
                    <input type="checkbox" checked={on} disabled={!m.userId} onChange={() => toggleVisibleTo(m.userId)} />
                    <span>{m.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}

      {activeTab === 'dm' && isDM && (
        <>
          <div style={S.section}>
            <div style={S.label}>Disposition (Ringfarbe)</div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {DISPOSITIONS.map((d) => (
                <button key={d.id} title={d.label} onClick={() => updateToken(tokenId, { color: d.color })}
                  style={{ ...S.disp, background: d.color, outline: token.color === d.color ? '2px solid #fff' : 'none' }} />
              ))}
              <input type="color" value={token.color || '#888888'} onChange={(e) => updateToken(tokenId, { color: e.target.value })}
                title="Eigene Farbe" style={{ width: 28, height: 24, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 'auto' }} />
            </div>
          </div>
          <div style={S.section}>
            <div style={S.label}>Größe</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[1, 2, 3].map((sz) => (
                <button key={sz} onClick={() => updateToken(tokenId, { sizeCells: sz })}
                  style={{ ...S.size, ...(token.sizeCells === sz ? S.sizeActive : null) }}>{sz}×{sz}</button>
              ))}
            </div>
            {token.ownerId && (
              <button style={S.sheet} title="Erkundete Bereiche (Memory/Fog) dieses Spielers zurücksetzen"
                onClick={() => { updateToken(tokenId, { sightResetAt: Date.now() }); onClose(); }}>
                👁 Sicht zurücksetzen
              </button>
            )}
          </div>
          <div style={S.section}>
            <div style={S.label} title="Blut-Overlay für dieses Token: Auto folgt der Karteneinstellung.">🩸 Blut-Overlay</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[{ v: null, l: 'Auto' }, { v: 'on', l: 'An' }, { v: 'off', l: 'Aus' }].map((o) => (
                <button key={o.l} onClick={() => updateToken(tokenId, { bloodied: o.v })}
                  style={{ ...S.size, ...((token.bloodied ?? null) === o.v ? S.sizeActive : null) }}>{o.l}</button>
              ))}
            </div>
          </div>
          <div style={S.section}>
            <div style={S.label}>Kontrolle (Spieler dürfen dieses Token steuern & durch es sehen)</div>
            <label style={S.visRow}>
              <input type="checkbox" checked={(token.controllers || []).includes('all')} onChange={() => toggleController('all')} />
              <span>Alle Spieler</span>
            </label>
            {members.filter((m) => m.userId).map((m) => (
              <label key={m.userId} style={S.visRow}>
                <input type="checkbox" checked={(token.controllers || []).includes(m.userId)} onChange={() => toggleController(m.userId)} />
                <span>{m.name}</span>
              </label>
            ))}
          </div>
          <div style={S.section}>
            <div style={S.label} title="Bei „einsehbaren“ Loop-Wänden: Innen = Wände begrenzen normal; Außen = man sieht hinein. Wechselt automatisch beim Durchqueren.">Loop-Position</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[{ v: null, l: 'Auto' }, { v: true, l: 'Innen' }, { v: false, l: 'Außen' }].map((o) => (
                <button key={o.l} onClick={() => updateToken(tokenId, { inside: o.v })}
                  style={{ ...S.size, ...((token.inside ?? null) === o.v ? S.sizeActive : null) }}>{o.l}</button>
              ))}
            </div>
            <button style={S.remove} onClick={() => { removeToken(tokenId); onClose(); }}>Token entfernen</button>
          </div>
        </>
      )}
    </div>
  );
}

const S = {
  menu: { position: 'fixed', width: 260, background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 30px #000a', zIndex: 1000, padding: 10 },
  menuSelected: { border: '1px solid var(--color-accent)', boxShadow: '0 8px 30px #000a, 0 0 0 1px var(--color-accent), 0 0 14px -3px var(--color-accent)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontWeight: 700, marginBottom: 8 },
  tabs: { display: 'flex', gap: 4, marginBottom: 8 },
  tab: { flex: 1, padding: '4px 6px', fontSize: 11, fontWeight: 600, background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' },
  tabActive: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: '1px solid var(--color-accent)' },
  sheet: { width: '100%', marginBottom: 4, padding: '6px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  visRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', padding: '2px 0', cursor: 'pointer' },
  disp: { width: 26, height: 22, borderRadius: 'var(--radius-md)', border: '1px solid #0008', cursor: 'pointer' },
  section: { borderTop: '1px solid var(--color-border)', paddingTop: 8, marginTop: 8 },
  label: { fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', marginBottom: 6 },
  hpInput: { flex: 1, padding: '6px 8px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' },
  apply: { padding: '0 12px', background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700 },
  condGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 },
  cond: { aspectRatio: '1', display: 'grid', placeItems: 'center', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' },
  size: { flex: 1, padding: '5px 0', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
  sizeActive: { background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', border: '1px solid var(--color-accent)' },
  remove: { width: '100%', marginTop: 8, padding: '6px', background: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)' },
};
