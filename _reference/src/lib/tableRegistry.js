/**
 * TABLE REGISTRY
 * Groups Supabase tables by NerdShelf tool so the Database page can show
 * them as a tidy navigation tree.
 *
 * Adding a new tool:
 *   1. Append a TOOL_GROUPS entry.
 *   2. List its table names in `tables`.
 *   3. Done — the sidebar / database tree picks it up automatically.
 *
 * Icons are plain unicode glyphs (NOT emoji), matching the main NerdShelf
 * app's sidebar style.
 */

/** @type {{ id: string, label: string, icon: string, color: string, tables: string[] }[]} */
export const TOOL_GROUPS = [
  {
    id:     'platform',
    label:  'Platform',
    icon:   '◉',
    color:  'text-brand-600 dark:text-brand-400',
    tables: [
      'profiles',
      'bug_reports',
    ],
  },
  {
    id:     'dnd',
    label:  'D&D',
    icon:   '⚔',
    color:  'text-violet-600 dark:text-violet-400',
    tables: [
      'dnd_characters',
      'dnd_campaigns',
      'dnd_campaign_members',
      'dnd_events',
      'dnd_imports',
    ],
  },
  {
    id:     'mtg',
    label:  'MTG',
    icon:   '✦',
    color:  'text-sky-600 dark:text-sky-400',
    tables: [
      'mtg_decks',
      'mtg_matches',
      'mtg_favorites',
      'mtg_inventory',
      'mtg_imports',
    ],
  },
  {
    id:     'wh40k',
    label:  'WH40k',
    icon:   'Ω',
    color:  'text-amber-600 dark:text-amber-400',
    tables: [
      'wh40k_armies',
      'wh40k_squads',
      'wh40k_favorites',
      'wh40k_inventory',
      'wh40k_imports',
    ],
  },
]

/**
 * Returns the tool group a table belongs to.
 * Unknown tables land in the "Sonstige" bucket.
 * @param {string} tableName
 */
export function getTableGroup(tableName) {
  return TOOL_GROUPS.find(g => g.tables.includes(tableName)) ?? {
    id:    'other',
    label: 'Sonstige',
    icon:  '◇',
    color: 'text-slate-500',
  }
}

/**
 * Groups a list of table names by TOOL_GROUPS.
 * Returns `[{ group, tables }]` in declared group order, with unknown tables
 * appended as a final "Sonstige" bucket.
 * @param {string[]} tableNames
 */
export function groupTables(tableNames) {
  const result = []

  for (const group of TOOL_GROUPS) {
    const matched = group.tables.filter(t => tableNames.includes(t))
    if (matched.length > 0) result.push({ group, tables: matched })
  }

  // Tables we don't know about — surface them so nothing is hidden.
  const known = new Set(TOOL_GROUPS.flatMap(g => g.tables))
  const others = tableNames.filter(t => !known.has(t))
  if (others.length > 0) {
    result.push({
      group: { id: 'other', label: 'Sonstige', icon: '◇', color: 'text-slate-500' },
      tables: others.sort(),
    })
  }

  return result
}
