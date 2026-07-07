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

export function dispatchRoll(formula, label, mode) {
  if (!formula) return;
  const detail = { formula: String(formula), label: label || '', mode: mode || null, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  window.dispatchEvent(new CustomEvent('vtt:roll', { detail }));
  try { rollChannel()?.postMessage(detail); } catch { /* channel closed */ }
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

// A damage roll: "2d6 + 4" → "2d6+4". Shift = Krit (dice doubled by the tray).
export function rollDamage(ev, formula, label) {
  const f = String(formula ?? '').replace(/\s+/g, '');
  if (!/\d*d\d+/.test(f)) return;
  dispatchRoll(f, label, ev?.shiftKey ? 'crit' : null);
}

// A raw d20 save/check with a numeric modifier, honouring Vorteil/Nachteil.
export function rollSave(ev, bonus, label) { rollAttack(ev, bonus, label); }
