// Shared click-to-roll helpers. A roll pill anywhere (NPC statblock, player
// actions, spells) dispatches a `vtt:roll` CustomEvent that the DiceTray picks
// up, opens and rolls. Modifier keys map to the usual D&D shortcuts:
//   • Attack / d20 rolls: Shift = Vorteil (advantage), Ctrl/⌘ = Nachteil.
//   • Damage rolls:       Shift = Krit (double the dice).
// The DiceTray computes the mathematically-correct result; the animation only
// visualises it. Dispatching is harmless where no tray is mounted.

export function dispatchRoll(formula, label, mode) {
  if (!formula) return;
  window.dispatchEvent(new CustomEvent('vtt:roll', { detail: { formula: String(formula), label: label || '', mode: mode || null } }));
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
