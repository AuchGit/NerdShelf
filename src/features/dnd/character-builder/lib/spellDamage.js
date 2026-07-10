// Würfelbarer Schaden eines Zaubers — geteilt zwischen Zauber-Sidebar,
// Actions-Explorer und Statblock. Datengetrieben aus den 5etools-Entries
// ({@damage}/{@dice}) bzw. scalingLevelDice; Upcast über {@scaledamage}.

// Erster würfelbarer CAST-Schaden ("8d6", "1d8+3"). On-Hit-Rider-Schaden
// ("deal an EXTRA {@damage 1d6} … whenever you hit" — Hunter's Mark, Hex,
// Divine Favor) zählt NICHT: beim Wirken wird nichts gewürfelt, der Schaden
// feuert später als Rider im Wurf-Composer (aktive Konzentration).
// Erkennung rein über das "extra"-Phrasing direkt vor dem Damage-Tag —
// Angriffszauber wie Fire Bolt ("the target takes 1d10 fire damage")
// bleiben unberührt.
export function spellDamageFormula(sp) {
  const raw = JSON.stringify(sp?.entries || [])
  const re = /\{@(?:damage|dice) ([^}|]+)/g
  let m
  while ((m = re.exec(raw))) {
    const f = m[1].replace(/\s+/g, '')
    if (!/\d*d\d+/.test(f)) continue
    const before = raw.slice(Math.max(0, m.index - 40), m.index)
      .replace(/[^a-zA-Z ]/g, ' ').replace(/\s+/g, ' ')
    if (/\bextra ?$/i.test(before)) continue // Rider, kein Cast-Schaden
    return f
  }
  const scale = sp?.scalingLevelDice
  const sc = Array.isArray(scale) ? scale[0] : scale
  const first = sc?.scaling && Object.values(sc.scaling)[0]
  if (typeof first === 'string' && /\d*d\d+/.test(first)) return first.replace(/\s+/g, '')
  return null
}

// „… + your spellcasting ability modifier“ direkt hinter dem Würfelwert
// (Cure Wounds, Healing Word, …): der Wurf-Prompt hängt dann den Zaubermod
// des Charakters an die Formel an. Rein textbasiert, keine Namenslisten.
export function spellDamageAddsMod(sp) {
  const raw = JSON.stringify(sp?.entries || []) + JSON.stringify(sp?.entriesHigherLevel || [])
  return /\{@(?:damage|dice) [^}]+\}[^.{]{0,40}(?:\+|plus) your spellcasting ability modifier/i.test(raw)
}

// Upcast-Schaden: {@scaledamage 8d6|3-9|1d6} auf den gewirkten Grad
// hochrechnen. Gleiche Würfelgröße → zusammengefasste Formel ("10d6"),
// sonst lesbare Summe. Ohne Skalierung → Basis-Formel.
export function scaledDamage(sp, castLevel) {
  const base = spellDamageFormula(sp)
  if (!base) return null
  const raw = JSON.stringify(sp?.entriesHigherLevel || []) + JSON.stringify(sp?.entries || [])
  // {@scaledamage} für Schaden, {@scaledice} für Heilung (Cure Wounds) und
  // andere skalierende Würfel — identisches Format base|from-to|step.
  const m = /\{@scale(?:damage|dice) ([^}|]+)\|(\d+)-\d+\|([^}|]+)\}/.exec(raw)
  if (!m || !castLevel) return base
  const extra = Math.max(0, castLevel - (+m[2]))
  if (!extra) return base
  const step = m[3].replace(/\s+/g, '')
  const sm = /^(\d*)d(\d+)$/.exec(step)
  const bm = /^(\d*)d(\d+)(.*)$/.exec(base)
  if (sm && bm && sm[2] === bm[2]) return `${(+bm[1] || 1) + extra * (+sm[1] || 1)}d${bm[2]}${bm[3] || ''}`
  return `${base}+${extra}x${step}`
}
