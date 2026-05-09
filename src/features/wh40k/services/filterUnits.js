// src/features/wh40k/services/filterUnits.js
//
// Pure helpers for unit search/filter/sort. Kept outside React so the same
// logic can be reused later by validation/army-suggestion features without
// pulling component code.

/**
 * @typedef {object} UnitFilters
 * @property {string}   query
 * @property {string[]} factionIds
 * @property {string[]} keywords
 * @property {string[]} roles
 * @property {number|null} pointsMin
 * @property {number|null} pointsMax
 * @property {boolean}  ownedOnly
 * @property {boolean}  favoritesOnly
 * @property {string}   sortKey       'name'|'points'|'role'|'faction'
 * @property {'asc'|'desc'} sortDir
 */

const ROLE_RANK = {
  character: 0,
  battleline: 1,
  infantry: 2,
  vehicle: 3,
  monster: 4,
};

export function emptyFilters() {
  return {
    query: '',
    factionIds: [],
    keywords: [],
    roles: [],
    pointsMin: null,
    pointsMax: null,
    ownedOnly: false,
    favoritesOnly: false,
    sortKey: 'name',
    sortDir: 'asc',
  };
}

export function isFiltering(f) {
  return !!(
    f.query ||
    f.factionIds.length ||
    f.keywords.length ||
    f.roles.length ||
    f.pointsMin != null ||
    f.pointsMax != null ||
    f.ownedOnly ||
    f.favoritesOnly
  );
}

/**
 * @param {Unit[]} units
 * @param {UnitFilters} f
 * @param {object} ctx
 * @param {(id:string)=>boolean} [ctx.isFavorite]
 * @param {(id:string)=>boolean} [ctx.isOwned]
 */
export function filterAndSortUnits(units, f, ctx = {}) {
  const q = (f.query || '').trim().toLowerCase();
  const factionSet = new Set(f.factionIds);
  const keywordSet = new Set(f.keywords);
  const roleSet = new Set(f.roles);

  let result = units.filter(u => {
    if (factionSet.size && !factionSet.has(u.factionId)) return false;
    if (roleSet.size && !roleSet.has(u.role)) return false;
    if (f.pointsMin != null && (u.points || 0) < f.pointsMin) return false;
    if (f.pointsMax != null && (u.points || 0) > f.pointsMax) return false;
    if (keywordSet.size) {
      const uk = new Set(u.keywords || []);
      for (const k of keywordSet) if (!uk.has(k)) return false;
    }
    if (f.favoritesOnly && ctx.isFavorite && !ctx.isFavorite(u.id)) return false;
    if (f.ownedOnly && ctx.isOwned && !ctx.isOwned(u.id)) return false;
    if (q) {
      const hay =
        u.name.toLowerCase() + ' ' +
        (u.keywords || []).join(' ').toLowerCase() + ' ' +
        (u.abilities || []).map(a => a.name + ' ' + a.text).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const dir = f.sortDir === 'desc' ? -1 : 1;
  const primaryCompare = (a, b) => {
    switch (f.sortKey) {
      case 'points':  return (a.points || 0) - (b.points || 0);
      case 'role':    return (ROLE_RANK[a.role] ?? 99) - (ROLE_RANK[b.role] ?? 99);
      case 'faction': return a.factionId.localeCompare(b.factionId);
      case 'name':
      default:        return a.name.localeCompare(b.name);
    }
  };
  const cmp = (a, b) => {
    const v = primaryCompare(a, b) || a.name.localeCompare(b.name);
    return v * dir;
  };
  // Sort a stable copy
  result = result.slice().sort(cmp);
  return result;
}
