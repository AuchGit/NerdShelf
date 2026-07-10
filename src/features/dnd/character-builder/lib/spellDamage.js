// Würfelbarer Schaden eines Zaubers — geteilt zwischen Zauber-Sidebar,
// Actions-Explorer und Statblock. Datengetrieben aus den 5etools-Entries
// ({@damage}/{@dice}) bzw. scalingLevelDice; Upcast über {@scaledamage}.

// Erster würfelbarer Basis-Schaden ("8d6", "1d8+3").
export function spellDamageFormula(sp) {
  const raw = JSON.stringify(sp?.entries || [])
  const m = /\{@(?:damage|dice) ([^}|]+)/.exec(raw)
  if (m) { const f = m[1].replace(/\s+/g, ''); if (/\d*d\d+/.test(f)) return f }
  const scale = sp?.scalingLevelDice
  const sc = Array.isArray(scale) ? scale[0] : scale
  const first = sc?.scaling && Object.values(sc.scaling)[0]
  if (typeof first === 'string' && /\d*d\d+/.test(first)) return first.replace(/\s+/g, '')
  return null
}

// Upcast-Schaden: {@scaledamage 8d6|3-9|1d6} auf den gewirkten Grad
// hochrechnen. Gleiche Würfelgröße → zusammengefasste Formel ("10d6"),
// sonst lesbare Summe. Ohne Skalierung → Basis-Formel.
export function scaledDamage(sp, castLevel) {
  const base = spellDamageFormula(sp)
  if (!base) return null
  const raw = JSON.stringify(sp?.entriesHigherLevel || []) + JSON.stringify(sp?.entries || [])
  const m = /\{@scaledamage ([^}|]+)\|(\d+)-\d+\|([^}|]+)\}/.exec(raw)
  if (!m || !castLevel) return base
  const extra = Math.max(0, castLevel - (+m[2]))
  if (!extra) return base
  const step = m[3].replace(/\s+/g, '')
  const sm = /^(\d*)d(\d+)$/.exec(step)
  const bm = /^(\d*)d(\d+)(.*)$/.exec(base)
  if (sm && bm && sm[2] === bm[2]) return `${(+bm[1] || 1) + extra * (+sm[1] || 1)}d${bm[2]}${bm[3] || ''}`
  return `${base}+${extra}x${step}`
}
