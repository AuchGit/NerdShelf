// src/features/wh40k/services/armyExport.js
//
// Plain-text army-list export. Mirrors the philosophy of MTG's deckExport:
// the user copies a clipboard-friendly representation that can be pasted
// into a forum, tournament app, or chat. Unit detail is intentionally
// minimal so the format reads naturally.

import { entryPoints } from './points';

export function armyToText({ army, unitsById, factionsById, detachments }) {
  const faction = factionsById[army.factionId]?.name || army.factionId || 'Keine Fraktion';
  const det = detachments.find(d => d.id === army.detachmentId)?.name || '';
  const lines = [];
  lines.push(`++ ${army.name || 'Unbenannte Armee'} (${faction}) ++`);
  if (det) lines.push(`Detachment: ${det}`);
  let total = 0;
  for (const e of Object.values(army.entries || {})) {
    const u = unitsById[e.unitId];
    if (!u) continue;
    const pts = entryPoints(e, unitsById);
    total += pts;
    if (e.squadId) {
      const tag = e.squadName ? `„${e.squadName}" — ` : '';
      lines.push(`${e.count}x ${tag}${u.name} (${e.modelCount} Mod.) — ${pts} Pkt`);
    } else {
      lines.push(`${e.count}x ${u.name} — ${pts} Pkt`);
    }
  }
  lines.push('');
  lines.push(`Gesamt: ${total} Pkt`);
  return lines.join('\n');
}

export async function copyArmyToClipboard(...args) {
  try {
    const text = armyToText(...args);
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
