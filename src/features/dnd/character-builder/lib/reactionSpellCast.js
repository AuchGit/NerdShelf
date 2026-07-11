// „Zauber statt Gelegenheitsangriff"-Reaktionen (War Caster & Co.):
// erkennt Features/Feats, deren Text erlaubt, als REAKTION einen Zauber zu
// wirken, und extrahiert die Einschränkungen direkt aus dem Text — rein
// datengetrieben, keine Feature-Namenslisten. 2014 („use your reaction to
// cast a spell … casting time of 1 action … target only that creature")
// und 2024 („take a Reaction to cast a spell … casting time of one action")
// werden beide erkannt.

function flat(entries) {
  const parts = []
  const walk = (n) => {
    if (n == null) return
    if (typeof n === 'string') parts.push(n)
    else if (Array.isArray(n)) n.forEach(walk)
    else if (typeof n === 'object') { walk(n.entries); walk(n.entry); walk(n.items) }
  }
  walk(entries)
  return parts.join(' ').replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
}

/**
 * @param {Array|object} entries  5etools-Entries eines Features/Feats
 * @returns {null | { actionTimeOnly: boolean, singleTarget: boolean }}
 */
export function detectReactionSpellCast(entries) {
  const t = flat(entries)
  if (!t) return null
  if (!/\breaction\b[^.]{0,160}\bcast(?:ing)? a spell|\bcast a spell\b[^.]{0,160}\breaction\b/i.test(t)) return null
  return {
    // "The spell must have a casting time of 1 action / one action"
    actionTimeOnly: /casting time of (?:1|one) action/i.test(t),
    // "must target only that creature"
    singleTarget: /targets? only (?:that|one) creature/i.test(t),
  }
}
