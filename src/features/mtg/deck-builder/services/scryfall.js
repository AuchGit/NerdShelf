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

/**
 * Classifies a card's layout for rendering purposes.
 * - 'split' for split / fuse / aftermath (one image, two halves printed sideways)
 * - 'double_faced' for transform / modal_dfc / double_faced_token / reversible_card / meld
 * - 'normal' otherwise
 */
export function getCardLayout(card) {
  const l = card?.layout;
  if (!l) return 'normal';
  if (l === 'split' || l === 'fuse' || l === 'aftermath' || l === 'room') return 'split';
  if (
    l === 'transform' ||
    l === 'modal_dfc' ||
    l === 'double_faced_token' ||
    l === 'reversible_card' ||
    l === 'meld'
  ) {
    // Edge case: if card_faces don't have per-face images, treat as normal/split
    const faces = card.card_faces || [];
    const faceHasOwnImage = faces.some(f => f?.image_uris && Object.keys(f.image_uris).length > 0);
    if (!faceHasOwnImage) return 'normal';
    return 'double_faced';
  }
  return 'normal';
}

/**
 * Returns the renderable faces of a card.
 * - normal: 1 face with the top-level image
 * - split: 1 face (the shared image), oracle texts of all halves combined
 * - double_faced: 2 faces, each with its own image / oracle / mana cost / type
 * Always returns at least one face.
 */
export function getCardFaces(card) {
  const layout = getCardLayout(card);
  const faces = card.card_faces || [];

  if (layout === 'split') {
    const image_uri =
      card.image_uris?.normal ||
      card.image_uris?.large ||
      faces[0]?.image_uris?.normal ||
      faces[0]?.image_uris?.large ||
      null;
    const image_uri_large =
      card.image_uris?.large ||
      card.image_uris?.normal ||
      faces[0]?.image_uris?.large ||
      faces[0]?.image_uris?.normal ||
      null;
    const combinedOracle = faces.length > 0
      ? faces.map(f => `${f.name ? f.name + '\n' : ''}${f.oracle_text || ''}`).join('\n\n//\n\n')
      : (card.oracle_text || '');
    const combinedMana = faces.length > 0
      ? faces.map(f => f.mana_cost || '').filter(Boolean).join(' // ')
      : (card.mana_cost || '');
    return [{
      name: card.name,
      image_uri,
      image_uri_large,
      oracle_text: combinedOracle,
      mana_cost: combinedMana,
      type_line: card.type_line || faces[0]?.type_line || '',
      power: card.power ?? faces[0]?.power,
      toughness: card.toughness ?? faces[0]?.toughness,
      loyalty: card.loyalty ?? faces[0]?.loyalty,
    }];
  }

  if (layout === 'double_faced') {
    // Use first two faces only (meld has 3, ignore the third per spec)
    return faces.slice(0, 2).map(f => ({
      name: f.name,
      image_uri: f.image_uris?.normal || f.image_uris?.large || null,
      image_uri_large: f.image_uris?.large || f.image_uris?.normal || null,
      oracle_text: f.oracle_text || '',
      mana_cost: f.mana_cost || '',
      type_line: f.type_line || '',
      power: f.power,
      toughness: f.toughness,
      loyalty: f.loyalty,
    }));
  }

  // normal
  return [{
    name: card.name,
    image_uri: card.image_uris?.normal || card.image_uris?.large || null,
    image_uri_large: card.image_uris?.large || card.image_uris?.normal || null,
    oracle_text: card.oracle_text || '',
    mana_cost: card.mana_cost || '',
    type_line: card.type_line || '',
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
  }];
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
