// Renders a real character-sheet tab (Spells / Inventory / Features /
// Personality) inside a VTT sidebar for the player's own character. Reuses the
// existing sheet components with all their functions; writes go through the
// owner full-character path (applyOwnCharacter), so edits persist + sync.
import { useMemo, useState } from 'react';
import { useVtt } from '../state/useVtt';
import { applyOwnCharacter } from '../sync/characterBinding';
import { computeCharacter } from '../../character-builder/lib/rulesEngine';
import SpellsTab from '../../character-builder/components/sheet/SpellsTab';
import InventoryTab from '../../character-builder/components/sheet/InventoryTab';
import FeaturesTab from '../../character-builder/components/sheet/FeaturesTab';
import PersonalityTab from '../../character-builder/components/sheet/PersonalityTab';

function setPath(obj, path, value) {
  const keys = path.split('.'); let o = obj;
  for (let i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = value;
}

export default function PlayerSheetCategory({ tab }) {
  const myId = useVtt((s) => s.ui.myCharacterId);
  const chars = useVtt((s) => s.ui.characters || {});
  const [expanded, setExpanded] = useState({});
  const character = myId != null ? chars[myId]?.data : null;
  const computed = useMemo(() => {
    if (!character) return null;
    try { return computeCharacter(character); } catch { return null; }
  }, [character]);

  if (!character) return <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--fs-sm)' }}>Kein Charakter geladen.</div>;

  const applyCharacter = (mutator) => applyOwnCharacter(myId, mutator);
  const updateCharacter = (path, value) => applyOwnCharacter(myId, (d) => setPath(d, path, value));
  const props = { character, computed, updateCharacter, applyCharacter };

  switch (tab) {
    case 'spells': return <SpellsTab {...props} />;
    case 'inventory': return <InventoryTab {...props} />;
    case 'features': return <FeaturesTab {...props} expanded={expanded} setExpanded={setExpanded} />;
    case 'personality': return <PersonalityTab character={character} updateCharacter={updateCharacter} />;
    default: return null;
  }
}
