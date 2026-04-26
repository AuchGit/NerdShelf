/**
 * Apply the same filter semantics as the Scryfall search, but client-side
 * over a card array (the user's favorites).
 */
export function filterFavorites(cards, params) {
  const {
    query, searchMode, colors = [], colorMode = 'any',
    cardType, showLands = false,
    rarity, cmcMin, cmcMax, subtype, format, setCode,
    sortOrder = 'name', sortDir = 'asc',
  } = params;

  const q = (query || '').trim().toLowerCase();
  const min = cmcMin !== '' && cmcMin != null ? Number(cmcMin) : null;
  const max = cmcMax !== '' && cmcMax != null ? Number(cmcMax) : null;
  const sub = (subtype || '').trim().toLowerCase();
  const sc  = (setCode || '').trim().toLowerCase();
  const ct  = (cardType || '').toLowerCase();

  const result = cards.filter(card => {
    // Text query
    if (q) {
      if (searchMode === 'oracle') {
        const oracle = (card.oracle_text || card.card_faces?.[0]?.oracle_text || '').toLowerCase();
        if (!oracle.includes(q)) return false;
      } else {
        if (!(card.name || '').toLowerCase().includes(q)) return false;
      }
    }

    // Land in/out
    const isLand = (card.type_line || '').includes('Land');
    if (showLands) {
      if (!isLand) return false;
    } else {
      // exclude lands ONLY when other filters are set (mirror Scryfall behavior).
      // Here we have to make a simpler rule: if any filter is set, exclude lands.
      const anyFilter = q || colors.length || ct || rarity || sub || min !== null || max !== null || format || sc;
      if (anyFilter && isLand) return false;
    }

    // Colors
    if (colors.length > 0) {
      const cardColors = card.colors || card.color_identity || [];
      if (colorMode === 'exact') {
        if (cardColors.length !== colors.length) return false;
        if (!colors.every(c => cardColors.includes(c))) return false;
      } else if (colorMode === 'all') {
        if (!colors.every(c => cardColors.includes(c))) return false;
      } else {
        // 'any'
        if (!colors.some(c => cardColors.includes(c))) return false;
      }
    }

    // Type
    if (ct && !(card.type_line || '').toLowerCase().includes(ct)) return false;

    // Subtype (Scryfall treats it as another t: term — substring match on type_line)
    if (sub && !(card.type_line || '').toLowerCase().includes(sub)) return false;

    // Rarity
    if (rarity && card.rarity !== rarity) return false;

    // CMC
    if (min !== null && (card.cmc ?? 0) < min) return false;
    if (max !== null && (card.cmc ?? 0) > max) return false;

    // Format legality
    if (format && card.legalities?.[format] !== 'legal') return false;

    // Set
    if (sc && (card.set || '').toLowerCase() !== sc) return false;

    return true;
  });

  // Sort
  const cmp = (a, b) => {
    let v;
    switch (sortOrder) {
      case 'cmc':      v = (a.cmc ?? 0) - (b.cmc ?? 0); break;
      case 'rarity': {
        const order = { common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 5 };
        v = (order[a.rarity] ?? 99) - (order[b.rarity] ?? 99); break;
      }
      case 'color': {
        const ai = (a.colors || []).join('') || 'Z';
        const bi = (b.colors || []).join('') || 'Z';
        v = ai.localeCompare(bi); break;
      }
      case 'type':     v = (a.type_line || '').localeCompare(b.type_line || ''); break;
      case 'set':      v = (a.set || '').localeCompare(b.set || ''); break;
      case 'released': v = (a.released_at || '').localeCompare(b.released_at || ''); break;
      case 'name':
      default:         v = (a.name || '').localeCompare(b.name || ''); break;
    }
    if (v === 0) v = (a.name || '').localeCompare(b.name || '');
    return sortDir === 'desc' ? -v : v;
  };

  return result.slice().sort(cmp);
}
