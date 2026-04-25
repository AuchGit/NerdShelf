// Wandelt 5e.tools-Tags in lesbaren Text um

export function parseTags(text) {
  if (!text || typeof text !== 'string') return text

  return text
    // ── Formatierung ────────────────────────────────────────
    .replace(/\{@b ([^}]+)\}/g, '$1')
    .replace(/\{@bold ([^}]+)\}/g, '$1')
    .replace(/\{@i ([^}]+)\}/g, '$1')
    .replace(/\{@italic ([^}]+)\}/g, '$1')
    .replace(/\{@s ([^}]+)\}/g, '$1')
    .replace(/\{@u ([^}]+)\}/g, '$1')
    .replace(/\{@code ([^}]+)\}/g, '$1')
    .replace(/\{@sup ([^}]+)\}/g, '$1')
    .replace(/\{@sub ([^}]+)\}/g, '$1')

    // ── Würfel / Zahlen ──────────────────────────────────────
    .replace(/\{@damage ([^}]+)\}/g, '$1')
    .replace(/\{@dice ([^}]+)\}/g, '$1')
    .replace(/\{@hit ([^}]+)\}/g, '+$1')
    .replace(/\{@d20 ([^}]+)\}/g, '$1')
    .replace(/\{@dc ([^}]+)\}/g, 'DC $1')
    .replace(/\{@chance ([^|]+)\|?[^}]*\}/g, '$1%')
    .replace(/\{@recharge ([^}]+)\}/g, '(Recharge $1–6)')

    // ── Angriffs-Typen ───────────────────────────────────────
    .replace(/\{@atk ([^}]+)\}/g, (_, t) => {
      if (t.includes('mw') && t.includes('rw')) return 'Melee or Ranged Weapon Attack:'
      const map = { mw: 'Melee Weapon Attack:', rw: 'Ranged Weapon Attack:', ms: 'Melee Spell Attack:', rs: 'Ranged Spell Attack:' }
      return map[t] || `${t} Attack:`
    })
    .replace(/\{@h\}/g, 'Hit: ')

    // ── Named entities: 3-Teile (name|source|displayName) → displayName ──
    .replace(/\{@(?:spell|item|creature|feat|race|background|class|subclass|vehicle|object|reward|trap|hazard|skill|sense|action|condition|disease|status|optfeature|classFeature|subclassFeature) [^|}]+\|[^|}]*\|([^}]+)\}/g, '$1')
    // ── Named entities: 2-Teile (name|source) → name ──
    .replace(/\{@(?:spell|item|creature|feat|race|background|class|subclass|vehicle|object|reward|trap|hazard) ([^|}]+)\|[^}]*\}/g, '$1')
    // ── Named entities: nur Name ──
    .replace(/\{@(?:spell|item|creature|feat|race|background|class|subclass|vehicle|object|reward|trap|hazard|skill|sense|action|condition|disease|status|optfeature) ([^|}]+)\}/g, '$1')

    // ── Sonstige Referenz-Tags ───────────────────────────────
    .replace(/\{@filter ([^|]+)\|?[^}]*\}/g, '$1')
    .replace(/\{@link ([^|]+)\|[^}]*\}/g, '$1')
    .replace(/\{@book ([^|]+)\|?[^}]*\}/g, '$1')
    .replace(/\{@note ([^}]+)\}/g, '[$1]')
    .replace(/\{@quickref ([^|]+)\|?[^}]*\}/g, '$1')
    .replace(/\{@variantrule ([^|]+)\|?[^}]*\}/g, '$1')
    .replace(/\{@loader ([^|]+)\|?[^}]*\}/g, '$1')
    .replace(/\{@table ([^|]+)\|?[^}]*\}/g, '$1')
    .replace(/\{@deity ([^|]+)\|?[^}]*\}/g, '$1')
    .replace(/\{@language ([^|]+)\|?[^}]*\}/g, '$1')
    .replace(/\{@area ([^|]+)\|?[^}]*\}/g, '$1')
    .replace(/\{@classFeature ([^|]+)\|?[^}]*\}/g, '$1')
    .replace(/\{@subclassFeature ([^|]+)\|?[^}]*\}/g, '$1')

    // ── Skalierung: letzten Teil nehmen ─────────────────────
    .replace(/\{@scaledamage [^|]+\|[^|]+\|([^}]+)\}/g, '$1')
    .replace(/\{@scaledice [^|]+\|[^|]+\|([^}]+)\}/g, '$1')

    // ── Alles Übrige entfernen ───────────────────────────────
    .replace(/\{@[^}]+\}/g, '')

    // ── Bare source suffixes (z.B. "longsword|phb") entfernen ──
    // Entfernt |SOURCE Suffixe die nicht in {@...} Tags stehen
    .replace(/(\w[\w\s'-]*)\|(?:phb|PHB|xphb|XPHB|xge|XGE|tce|TCE|dmg|DMG|xdmg|XDMG|mm|MM|xmm|XMM|ftd|FTD|vgm|VGM|mtf|MTF|ggr|GGR|erlw|ERLW|egtw|EGTW|egw|EGW|scc|SCC|scag|SCAG|ai|AI)(?:\|[^|\s,.)]*)?/gi, '$1')
}

export function parseEntries(entries) {
  if (!entries) return []

  return entries.map(entry => {
    if (typeof entry === 'string') {
      return { type: 'text', content: parseTags(entry) }
    }
    if (typeof entry === 'object') {
      switch (entry.type) {
        case 'entries':
        case 'inset':
        case 'quote':
          return { type: 'section', name: entry.name || null, content: parseEntries(entry.entries || []) }
        case 'list':
          return {
            type: 'list',
            items: (entry.items || []).map(item =>
              typeof item === 'string' ? parseTags(item) : parseTags(item.entry || item.name || '')
            ),
          }
        case 'table':
          return { type: 'table', caption: entry.caption || null, headers: entry.colLabels || [], rows: entry.rows || [] }
        default:
          if (entry.entries) return { type: 'section', name: entry.name || null, content: parseEntries(entry.entries) }
          return { type: 'text', content: parseTags(entry.name || '') }
      }
    }
    return { type: 'text', content: '' }
  })
}