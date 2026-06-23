// CharacterBinding — bridges VTT tokens to their real dnd_characters.
//
// A token can carry a `characterId` (bigint → dnd_characters.id). When it
// does, its HP and conditions are NOT its own truth: they are a projection of
// the live character. This module:
//   • loads the characters the viewer may read (GM: every member; player:
//     their own) and subscribes to dnd_characters realtime UPDATEs,
//   • projects each bound token's hp / hpMax / conditions from the character
//     into the VTT store as LOCAL ops (never broadcast / persisted — every
//     client derives the same projection from the shared character row, so
//     there's nothing to sync),
//   • routes edits back through dnd_patch_combat_state (the RPC that accepts
//     the character owner OR the campaign GM and whitelists keys), so the VTT,
//     the GM SessionPage and the character sheet all stay consistent off the
//     one dnd_characters realtime channel,
//   • (GM only, once per session) spawns a token per member bound to their
//     character when none exists yet — RLS makes token INSERT GM-only, so the
//     player can't create their own; they only ever UPDATE it.
//
// The store call layering mirrors SupabaseAdapter: projection uses applyLocal
// (local only); the one GM spawn uses apply (broadcast + persist).

import { apply, applyLocal, getState, subscribe } from '../state/store';
import { snapToGrid } from '../lib/geometry';
import { listMembers, patchCombatState } from '../../character-builder/lib/campaigns';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';

let instance = null;

/** Wire the binding for the current viewer. Returns the instance. */
export function connectCharacterBinding(opts) {
  instance = new CharacterBinding(opts);
  instance.connect().catch((e) => console.warn('[vtt] character binding', e?.message || e));
  return instance;
}

export function disconnectCharacterBinding() {
  instance?.disconnect();
  instance = null;
}

/**
 * Edit a bound token's combat state (HP / conditions / death saves) by its
 * character id. Optimistic locally, then the RPC; reverts on failure. No-op if
 * the binding isn't connected. Used by the token actions for bound tokens.
 */
export function patchCombat(characterId, patch) {
  return instance?.patchCombat(characterId, patch);
}

/** The loaded character row { id, name, data } for a bound token, if any. */
export function getBoundCharacter(characterId) {
  return instance?.chars?.[characterId] || null;
}

/**
 * Owner-only full-character edit (used by the in-VTT sheet tabs — inventory,
 * spells, features, …). Mutates a draft, updates the local mirror instantly,
 * and debounce-saves the whole `data` row (RLS lets the owner update their own
 * dnd_characters; realtime propagates to the GM session view).
 */
export function applyOwnCharacter(characterId, mutator) {
  return instance?.applyOwnCharacter(characterId, mutator);
}

/** DM: spawn one member's bound token by character id. */
export function spawnMemberToken(characterId) {
  return instance?.spawnMemberToken(characterId);
}

/** DM: spawn bound tokens for every member who doesn't have one yet. */
export function spawnAllMemberTokens() {
  return instance?.spawnMemberTokens();
}

class CharacterBinding {
  constructor({ supabase, campaignId, isGM, userId }) {
    this.sb = supabase;
    this.campaignId = campaignId;
    this.isGM = isGM;
    this.userId = userId;
    this.chars = {};          // characterId -> { id, name, data }
    this.members = [];        // membership rows (user_id, character_id, card, …)
    this.cardByChar = {};     // characterId -> denormalized card (name/portrait)
    this.channel = null;
    this.unsubStore = null;
    this._maxCache = new Map(); // characterId -> { ref: data, max }
  }

  async connect() {
    this.members = await listMembers(this.campaignId).catch(() => []);
    for (const m of this.members) {
      if (m.character_id != null) this.cardByChar[m.character_id] = m.card || {};
    }
    const mine = this.members.find((m) => m.user_id === this.userId);
    this.myCharacterId = mine?.character_id ?? null;

    // Which character rows may we read? GM sees every member (RLS allows it);
    // a player only their own.
    const ids = this.isGM
      ? this.members.map((m) => m.character_id).filter((x) => x != null)
      : (this.myCharacterId != null ? [this.myCharacterId] : []);

    if (ids.length) {
      const { data: rows, error } = await this.sb
        .from('dnd_characters').select('id, name, data').in('id', ids);
      if (error) console.warn('[vtt] load characters', error.message);
      for (const r of rows || []) this.chars[r.id] = r;
    }
    this.publishChars();

    // Live HP / conditions from players (or our own RPC writes). Merge the row
    // (a partial payload mustn't blank the character), then re-project.
    const idSet = new Set(ids.map(Number));
    this.channel = this.sb
      .channel(`vtt-chars:${this.campaignId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'dnd_characters' },
        (payload) => {
          const row = payload.new;
          if (!row || !idSet.has(Number(row.id))) return;
          const existing = this.chars[row.id] || {};
          this.chars[row.id] = {
            id: row.id,
            name: row.name ?? existing.name,
            data: row.data ?? existing.data,
          };
          this.project();
          this.publishChars();
        })
      .subscribe();

    // GM gets the campaign roster in the store (local-only) so the TokenPanel
    // can offer "add this player" / "add all". Players don't (RLS: only the GM
    // inserts tokens).
    if (this.isGM) {
      const roster = this.members
        .filter((m) => m.character_id != null)
        .map((m) => ({
          characterId: m.character_id,
          userId: m.user_id || null,
          name: this.cardByChar[m.character_id]?.name || this.chars[m.character_id]?.name || m.player_name || 'Spieler',
        }));
      applyLocal({ type: 'ui/set', ui: { campaignMembers: roster } });
    }

    // Re-project whenever the store changes — snapshot hydration, the GM adding
    // the map, etc. Projection is diff-guarded so it never loops.
    this.unsubStore = subscribe(() => this.project());
    this.project();
  }

  // Max HP for a character, cached by data reference (computeCharacter is heavy).
  maxHp(charId, data) {
    const cached = this._maxCache.get(charId);
    if (cached && cached.ref === data) return cached.max;
    let max;
    try { max = computeCharacter(data)?.hp?.max ?? null; }
    catch { max = data?.status?.maxHp ?? null; }
    this._maxCache.set(charId, { ref: data, max });
    return max;
  }

  // Owner full-character edit: mutate a draft, update the mirror immediately,
  // debounce-save the whole row.
  applyOwnCharacter(characterId, mutator) {
    const ch = this.chars[characterId];
    if (!ch?.data) return;
    const draft = typeof structuredClone === 'function' ? structuredClone(ch.data) : JSON.parse(JSON.stringify(ch.data));
    mutator(draft);
    this.chars[characterId] = { ...ch, data: draft };
    this.publishChars();
    this.project();
    this._saveTimers ||= {};
    clearTimeout(this._saveTimers[characterId]);
    this._saveTimers[characterId] = setTimeout(() => {
      const cur = this.chars[characterId];
      if (!cur?.data) return;
      this.sb.from('dnd_characters')
        .update({ data: cur.data, name: cur.data.info?.name || cur.name || '' })
        .eq('id', characterId)
        .then(({ error }) => error && console.warn('[vtt] character save', error.message));
    }, 600);
  }

  // Mirror loaded characters into the (local-only) store so React panels — the
  // in-VTT character sheet — can read live data reactively.
  publishChars() {
    applyLocal({ type: 'ui/set', ui: { characters: { ...this.chars }, myCharacterId: this.myCharacterId } });
  }

  // Push each bound token's live HP / conditions into the store (local only).
  project() {
    const tokens = getState().tokens;
    for (const id in tokens) {
      const t = tokens[id];
      if (t.characterId == null) continue;
      const ch = this.chars[t.characterId];
      if (!ch?.data) continue;
      const status = ch.data.status || {};
      const hpMax = this.maxHp(t.characterId, ch.data);
      const hp = status.currentHp ?? hpMax;
      const conditions = status.conditions || [];
      if (t.hp === hp && t.hpMax === hpMax && sameSet(t.conditions, conditions)) continue;
      applyLocal({ type: 'token/update', id, patch: { hp, hpMax, conditions } });
    }
  }

  // GM: one token per member bound to their character, for members who don't
  // have one yet. RLS makes this GM-only; players can't insert their own.
  spawnMemberTokens() {
    const bound = boundCharIds();
    for (const m of this.members) {
      if (m.character_id == null || bound.has(String(m.character_id))) continue;
      this.spawnOne(m);
    }
  }

  // GM: spawn one specific member's bound token (no-op if already present).
  spawnMemberToken(characterId) {
    if (boundCharIds().has(String(characterId))) return null;
    const m = this.members.find((x) => String(x.character_id) === String(characterId));
    return m ? this.spawnOne(m) : null;
  }

  // Build + add a single member's token at map center.
  spawnOne(m) {
    const s = getState();
    const map = s.maps[s.activeMapId];
    if (!map || !m || m.character_id == null) return null;
    const cid = m.character_id;
    const ch = this.chars[cid];
    const card = this.cardByChar[cid] || {};
    const hpMax = ch?.data ? this.maxHp(cid, ch.data) : null;
    const hp = ch?.data?.status?.currentHp ?? hpMax;
    const center = snapToGrid(map.width / 2, map.height / 2, map.grid, 1);
    const id = 'tok_' + Math.random().toString(36).slice(2, 10);
    apply({
      type: 'token/add',
      token: {
        id,
        mapId: map.id,
        level: map.levels?.[0]?.id || null,
        kind: 'player',
        ownerId: m.user_id || null,
        characterId: cid,
        name: card.name || ch?.name || m.player_name || 'Spieler',
        imageUrl: card.portrait || ch?.data?.appearance?.portrait || null,
        color: '#42a5f5',
        x: center.x, y: center.y,
        sizeCells: 1,
        hp, hpMax, conditions: ch?.data?.status?.conditions || [],
      },
    });
    return id;
  }

  // Optimistic combat-state write (mirrors SessionPage.patchChar): apply to the
  // local character + re-project for instant feedback, RPC, revert on error.
  async patchCombat(characterId, patch) {
    if (characterId == null) return;
    const before = this.chars[characterId];
    if (before?.data) {
      this.chars[characterId] = {
        ...before,
        data: { ...before.data, status: { ...(before.data.status || {}), ...patch } },
      };
      this.project();
      this.publishChars();
    }
    try {
      await patchCombatState(characterId, patch);
    } catch (e) {
      if (before) { this.chars[characterId] = before; this.project(); this.publishChars(); }
      console.warn('[vtt] combat patch failed', e?.message || e);
    }
  }

  disconnect() {
    this.unsubStore?.();
    if (this.channel) this.sb.removeChannel(this.channel);
    for (const t of Object.values(this._saveTimers || {})) clearTimeout(t);
    this.unsubStore = null;
    this.channel = null;
  }
}

// Character ids that already have a token in the store (any map).
function boundCharIds() {
  return new Set(
    Object.values(getState().tokens).map((t) => t.characterId).filter((x) => x != null).map(String),
  );
}

// Order-insensitive set equality for the conditions arrays.
function sameSet(a = [], b = []) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  for (const x of b) if (!s.has(x)) return false;
  return true;
}
