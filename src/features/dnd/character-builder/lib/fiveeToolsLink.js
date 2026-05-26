// src/features/dnd/character-builder/lib/fiveeToolsLink.js
//
// Builds a deep link into 5e.tools (5.5e) or 2014.5e.tools (5e legacy)
// for any catalog entry the player is viewing — background, race, class,
// feat, spell, item, optional feature. Used by the small "↗ 5e.tools"
// link buttons sprinkled across the wizard / sheet detail panels.
//
// URL shape:  https://<base>/<page>.html#<name-slug>_<source-slug>
//   base       — '2014.5e.tools' for 5e, '5e.tools' for 5.5e
//   page       — e.g. 'backgrounds', 'races', 'classes', 'spells'
//   name-slug  — name lowercased, spaces → '%20'
//   source-slug— source lowercased (e.g. 'phb', 'xphb', 'tce')
//
// Examples:
//   { kind: 'background', name: 'Sage', source: 'XPHB', edition: '5.5e' }
//     → https://5e.tools/backgrounds.html#sage_xphb
//   { kind: 'spell', name: 'Magic Missile', source: 'PHB', edition: '5e' }
//     → https://2014.5e.tools/spells.html#magic%20missile_phb

const BASE_5E   = '2014.5e.tools'
const BASE_55E  = '5e.tools'

const KIND_PAGES = {
  background:      'backgrounds',
  race:            'races',
  species:         'races',  // alias — the wizard calls it Species in 5.5e
  class:           'classes',
  feat:            'feats',
  spell:           'spells',
  item:            'items',
  optionalfeature: 'optionalfeatures',
  optfeat:         'optionalfeatures',
  condition:       'conditionsdiseases',
}

function nameSlug(name) {
  return String(name || '').toLowerCase().trim().replace(/\s+/g, '%20')
}

function sourceSlug(source) {
  return String(source || '').toLowerCase().trim()
}

/**
 * @param {object} args
 * @param {string} args.kind     — one of KIND_PAGES keys
 * @param {string} args.name     — entity display name
 * @param {string} args.source   — 5etools source key (PHB, XPHB, …)
 * @param {string} [args.edition] — '5e' (default) or '5.5e'
 * @returns {string|null} a URL, or null if the inputs are insufficient
 */
export function buildFiveEToolsUrl({ kind, name, source, edition = '5e' } = {}) {
  if (!kind || !name || !source) return null
  const page = KIND_PAGES[kind]
  if (!page) return null
  const base = edition === '5.5e' ? BASE_55E : BASE_5E
  const slug = nameSlug(name)
  const src  = sourceSlug(source)
  if (!slug || !src) return null
  return `https://${base}/${page}.html#${slug}_${src}`
}
