// On-Hit-Rider: Zusatzschaden, den ein Charakter beim TREFFER aktivieren kann
// oder der passiv mitfeuert (Sneak Attack, Dreadful Strikes, Surprise Attack,
// aktives Hunter's Mark, Smite-artige …). Vollständig datengetrieben über die
// Feature-Texte + parseFeatureEffect-Pills — keine Namenslisten. Der
// Wurf-Composer bietet sie als Checkboxen an und würfelt sie als eigene
// Wurf-Teile (Schadens-Breakdown pro Typ) mit.
import { parseFeatureEffect } from './featureEffectParser'

// Treffer-gekoppelte Formulierungen (2014 + 2024 Phrasing).
const HIT_RE = /\bwhen(?:ever)? you hit\b|\bon a hit\b|\bhits? (?:a creature|it|the target|with an? )|\bonce per turn\b[^.]{0,120}\bdamage\b|\bimmediately after you hit\b/i

// 5etools-Entries → Klartext (Tags auf ihr Anzeige-Segment reduziert).
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

const DICE_RE = /\d*d\d+(?:\s*[+-]\s*\d+)?/

// Waffen-ANFORDERUNG aus den Sätzen, die „weapon" erwähnen (Sneak Attack:
// "must use a finesse or a ranged weapon", Improved Divine Smite: "with a
// melee weapon attack"): Eigenschafts-/Kategorie-Wörter direkt aus dem
// Text, kein Feature-Katalog. Leer = jede Waffe. Der Composer matcht die
// Tokens gegen Properties + Kategorie der konkreten Waffen-Row.
export function extractWeaponReq(text) {
  const req = new Set()
  for (const sentence of String(text || '').split(/(?<=\.)\s+/)) {
    if (!/\bweapons?\b/i.test(sentence)) continue
    for (const wm of sentence.matchAll(/\b(finesse|ranged|melee|thrown|light|heavy|reach|versatile|simple|martial)\b(?=[^.]*\bweapons?\b)/gi)) {
      req.add(wm[1].toLowerCase())
    }
  }
  return [...req]
}

/**
 * Alle Aktions-Rider eines Charakters: [{ id, name, formula, type, active? }].
 * `spellMap` (optional, Map name→spell) liefert zusätzlich den aktiven
 * Konzentrations-Zauber (Hunter's Mark & Co.), wenn er on-hit-Schaden hat.
 */
export function gatherActionRiders(character, profBonus = 0, spellMap = null) {
  const out = []
  const seen = new Set()
  const consider = (name, entries, classId) => {
    const key = String(name || '').toLowerCase()
    if (!key || seen.has(key)) return
    const text = flat(entries)
    if (!HIT_RE.test(text)) return
    const fx = parseFeatureEffect({ name, entries, classId }, character, profBonus, { classDataMap: character?.__classDataMap })
    const pill = (fx?.pills || []).find((p) => p.kind === 'damage' && DICE_RE.test(String(p.label)))
    if (!pill) return
    const m = String(pill.label).match(DICE_RE)
    if (!m) return
    seen.add(key)
    // "Once per turn"-Rider (Sneak Attack, Dreadful Strikes) bekommen einen
    // 1x/Zug-Hinweis im Composer — Erkennung rein über die Formulierung.
    const perTurn = /once (?:per|on each of your) turn/i.test(text)
    // Waffengebundene Rider: erwähnt der Feature-Text eine Waffe (Sneak
    // Attack "uses a Finesse or a Ranged weapon", Dreadful Strikes "hit a
    // creature with a weapon"), gilt der Rider nur für Waffen-Aktionen —
    // nicht für Zauber-Prompts (Cure Wounds zeigte sonst Sneak Attack an).
    // Rider ohne Waffen-Bezug (Hex: "with an attack") bleiben auch für
    // Angriffszauber verfügbar. Bewusst simpel statt Phrasen-Listen —
    // headless gegen PHB+XPHB verifiziert (Sneak/Dreadful/Divine Favor/
    // 2014-Hunter's-Mark → weaponOnly; Hex/2024-Hunter's-Mark → frei).
    const weaponOnly = /\bweapons?\b/i.test(text)
    const weaponReq = weaponOnly ? extractWeaponReq(text) : []
    out.push({ id: key, name, formula: m[0].replace(/\s+/g, ''), type: (pill.damageType || '').toLowerCase(), perTurn, weaponOnly, weaponReq })
  }
  for (const f of (character?.__activeFeatures || [])) consider(f.name, f.entries, f.classId)
  for (const t of (character?.species?.__traits || [])) consider(t.name, t.entries, null)

  // Aktive Konzentration mit Treffer-Schaden (z.B. Hunter's Mark 1d6).
  const concName = character?.status?.concentration?.spell
  if (concName && spellMap) {
    const sp = typeof spellMap.get === 'function'
      ? spellMap.get(String(concName).toLowerCase())
      : spellMap[String(concName).toLowerCase()]
    if (sp) {
      const text = flat(sp.entries)
      const dm = text.match(/extra (\d*d\d+)(?: (\w+))? damage/i)
      if (dm && HIT_RE.test(text) && !seen.has(String(concName).toLowerCase())) {
        const weaponOnly = /\bweapons?\b/i.test(text)
        const weaponReq = weaponOnly ? extractWeaponReq(text) : []
        out.push({ id: 'conc:' + concName.toLowerCase(), name: `${concName} (aktiv)`, formula: dm[1], type: (dm[2] || '').toLowerCase(), active: true, weaponOnly, weaponReq })
      }
    }
  }
  return out
}
