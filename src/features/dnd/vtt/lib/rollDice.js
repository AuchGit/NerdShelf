// Shared click-to-roll helpers. A roll pill anywhere (NPC statblock, player
// actions, spells) dispatches a `vtt:roll` CustomEvent that the DiceTray picks
// up, opens and rolls. Modifier keys map to the usual D&D shortcuts:
//   • Attack / d20 rolls: Shift = Vorteil (advantage), Ctrl/⌘ = Nachteil.
//   • Damage rolls:       Shift = Krit (double the dice).
// The DiceTray computes the mathematically-correct result; the animation only
// visualises it. Dispatching is harmless where no tray is mounted.

// Cross-window channel: the character sheet can live in its OWN window (Tauri
// popout / window.open), which has a SEPARATE DiceTray-less DOM. A same-origin
// BroadcastChannel carries the roll to whichever window hosts the tray. We also
// fire the local DOM event (fast path for the same window); a nonce dedupes so
// a roll is never played twice.
let _rollChannel = null;
function rollChannel() {
  if (_rollChannel === null && typeof BroadcastChannel !== 'undefined') {
    try { _rollChannel = new BroadcastChannel('nerdshelf:vtt-roll'); } catch { _rollChannel = false; }
  }
  return _rollChannel || null;
}

export function dispatchRoll(formula, label, mode, captureId) {
  if (!formula) return;
  const detail = { formula: String(formula), label: label || '', mode: mode || null, captureId: captureId || null, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  window.dispatchEvent(new CustomEvent('vtt:roll', { detail }));
  try { rollChannel()?.postMessage(detail); } catch { /* channel closed */ }
}

// Result round-trip: dispatch a roll and RESOLVE with the tray's total once the
// 3D animation finishes. Used for automatic initiative rolls (roll in the tray,
// capture the number). Works cross-window via the result BroadcastChannel.
let _resultChannel = null;
let _resultListening = false;
const _resultWaiters = new Map();
function resultChannel() {
  if (_resultChannel === null && typeof BroadcastChannel !== 'undefined') {
    try { _resultChannel = new BroadcastChannel('nerdshelf:vtt-roll-result'); } catch { _resultChannel = false; }
  }
  return _resultChannel || null;
}
function onResult(detail) {
  const w = detail?.captureId && _resultWaiters.get(detail.captureId);
  if (w) { _resultWaiters.delete(detail.captureId); w(detail); }
}
function ensureResultListener() {
  if (_resultListening) return;
  _resultListening = true;
  window.addEventListener('vtt:roll-result', (e) => onResult(e.detail));
  const ch = resultChannel();
  if (ch) ch.onmessage = (e) => onResult(e.data);
}
function capture(formula, label, mode, pick, fallback) {
  ensureResultListener();
  const captureId = `cap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return new Promise((resolve) => {
    _resultWaiters.set(captureId, (d) => resolve(pick(d)));
    setTimeout(() => { if (_resultWaiters.has(captureId)) { _resultWaiters.delete(captureId); resolve(fallback); } }, 20000);
    dispatchRoll(formula, label, mode, captureId);
  });
}
// Resolve with the roll's TOTAL after the animation (single value, e.g. one save).
export function rollForResult(formula, label, mode) {
  return capture(formula, label, mode, (d) => d?.total ?? null, null);
}
// Resolve with the array of INDIVIDUAL natural die results — for rolling many
// initiatives in ONE throw (e.g. "8d20") and mapping each die to a combatant.
export function rollForDice(formula, label) {
  return capture(formula, label, null, (d) => d?.dice || [], []);
}
// Called by the DiceTray when a captured roll's animation finishes.
export function emitRollResult(captureId, total, label, dice) {
  if (!captureId) return;
  const detail = { captureId, total, label: label || '', dice: dice || null };
  window.dispatchEvent(new CustomEvent('vtt:roll-result', { detail }));
  try { resultChannel()?.postMessage(detail); } catch { /* ignore */ }
}

// Advantage/disadvantage from the click's modifier keys (for d20 rolls).
export function rollModeFromEvent(ev) {
  if (ev?.shiftKey) return 'adv';
  if (ev?.ctrlKey || ev?.metaKey) return 'dis';
  return null;
}

// A d20 check/attack: "+7" / "7" / "-1" → "1d20+7". Shift/Ctrl = Vorteil/Nachteil.
export function rollAttack(ev, bonus, label) {
  const b = String(bonus ?? '').replace(/[^+\-0-9]/g, '');
  const sign = b === '' || b.startsWith('-') || b.startsWith('+') ? '' : '+';
  dispatchRoll(`1d20${sign}${b || '+0'}`, label, rollModeFromEvent(ev));
}

// A damage roll. Robust to labelled strings: "1d8 slashing", "2d6 + 4 fire",
// "1d8+3 (STR)" → extracts just the dice expression ("1d8", "2d6+4", "1d8+3").
// Shift = Krit (dice doubled by the tray).
export function rollDamage(ev, formula, label) {
  const m = String(formula ?? '').match(/\d*d\d+(?:\s*[+-]\s*\d+)*/i);
  if (!m) return;
  dispatchRoll(m[0].replace(/\s+/g, ''), label, ev?.shiftKey ? 'crit' : null);
}

// A raw d20 save/check with a numeric modifier, honouring Vorteil/Nachteil.
export function rollSave(ev, bonus, label) { rollAttack(ev, bonus, label); }
