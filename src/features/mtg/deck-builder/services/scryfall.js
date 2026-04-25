const BASE = 'https://api.scryfall.com';

/**
 * Build and execute a Scryfall card search.
 * Pass `nextPageUrl` to paginate instead of rebuilding the query.
 */
export async function searchCards({
  query, searchMode, colors, colorMode = 'any', cardType, sortOrder = 'name', sortDir = 'asc',
  showLands = false,
  rarity, cmcMin, cmcMax, subtype, format, setCode,
  nextPageUrl,
}) {
  let url;

  if (nextPageUrl) {
    url = nextPageUrl;
  } else {
    const parts = [];

    // ── Text query ──────────────────────────────────────
    const q = query?.trim();
    if (q) {
      if (searchMode === 'oracle') {
        parts.push(`o:${q.includes(' ') ? `"${q}"` : q}`);
      } else {
        parts.push(q);
      }
    }

    // ── Colors ──────────────────────────────────────────
    if (colors && colors.length > 0) {
      const colorStr = colors.join('');
      if (colorMode === 'exact') {
        // Exactly these colors, no more
        parts.push(`c=${colorStr}`);
      } else if (colorMode === 'all') {
        // Must include all listed colors (may have others)
        parts.push(`c:${colorStr}`);
      } else {
        // 'any': card has at least one of these colors (OR)
        if (colors.length === 1) {
          parts.push(`c:${colors[0]}`);
        } else {
          parts.push(`(${colors.map(c => `c:${c}`).join(' OR ')})`);
        }
      }
    }

    // ── Card type ─────────────────────────────────────────
    if (cardType) {
      parts.push(`t:${cardType.toLowerCase()}`);
    }

    // ── Subtype ───────────────────────────────────────────
    const st = subtype?.trim();
    if (st) {
      parts.push(`t:${st.toLowerCase()}`);
    }

    // ── Rarity ────────────────────────────────────────────
    if (rarity) {
      parts.push(`r:${rarity}`);
    }

    // ── CMC range ─────────────────────────────────────────
    const min = cmcMin !== '' && cmcMin != null ? Number(cmcMin) : null;
    const max = cmcMax !== '' && cmcMax != null ? Number(cmcMax) : null;
    if (min !== null) parts.push(`cmc>=${min}`);
    if (max !== null) parts.push(`cmc<=${max}`);

    // ── Format legality ────────────────────────────────────
    if (format) {
      parts.push(`f:${format}`);
    }

    // ── Set code ───────────────────────────────────────────
    const sc = setCode?.trim();
    if (sc) {
      parts.push(`s:${sc}`);
    }

    // ── Land handling ──────────────────────────────────────
    // showLands=true  → include only lands (or show lands alongside results)
    // showLands=false → always exclude lands from results
    if (showLands) {
      // If no other filters, search for all lands; otherwise AND with land type
      parts.push('t:land');
    } else if (parts.length > 0) {
      // Only exclude if there's actually something to search
      parts.push('-t:land');
    }

    if (parts.length === 0) return null;

    const ORDER_MAP = {
      name: 'name', color: 'color', cmc: 'cmc',
      type: 'type', rarity: 'rarity', set: 'set', released: 'released',
    };
    const order = ORDER_MAP[sortOrder] ?? 'name';
    const dir   = sortDir === 'desc' ? 'desc' : 'asc';

    const encoded = encodeURIComponent(parts.join(' '));
    url = `${BASE}/cards/search?q=${encoded}&order=${order}&dir=${dir}&unique=cards`;
  }

  const res = await fetch(url);

  if (!res.ok) {
    if (res.status === 404) return { data: [], has_more: false, total_cards: 0 };
    const json = await res.json().catch(() => ({}));
    throw new Error(json.details || `Scryfall error ${res.status}`);
  }

  return res.json();
}

export function getCardImage(card, size = 'normal') {
  return (
    card.image_uris?.[size] ||
    card.card_faces?.[0]?.image_uris?.[size] ||
    null
  );
}

export function getManaCost(card) {
  return card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? '';
}

export function parseManaCost(manaCost) {
  if (!manaCost) return [];
  return [...manaCost.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
}

export function getTypeGroup(card) {
  const t = card.type_line || '';
  if (t.includes('Creature'))     return 'Creatures';
  if (t.includes('Planeswalker')) return 'Planeswalkers';
  if (t.includes('Instant'))      return 'Instants';
  if (t.includes('Sorcery'))      return 'Sorceries';
  if (t.includes('Enchantment'))  return 'Enchantments';
  if (t.includes('Artifact'))     return 'Artifacts';
  if (t.includes('Land'))         return 'Lands';
  return 'Other';
}
