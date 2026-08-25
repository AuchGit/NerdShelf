// homebrewValidate.js
//
// Prüft einen Homebrew-Eintrag GEGEN DIE ANFORDERUNGEN DER KONSUMENTEN:
// welche Felder brauchen loadSpellList / loadItemIndex / loadRaceList /
// loadBackgroundList / loadCreatureList / collectActiveClassFeatures
// wirklich, damit der Eintrag im Sheet bzw. VTT ankommt?
//
// Zweck ist NICHT 5etools-Schema-Validierung, sondern die Frage, die der
// Nutzer tatsächlich hat: „Warum taucht mein Spell nirgends auf?"
//
//   level 'error' → Eintrag ist unbrauchbar / wird nirgends erscheinen
//   level 'warn'  → funktioniert, aber vermutlich nicht wie gedacht
//
// Rückgabe: [{ level, msg }] — leer = alles gut.

const isNonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0
const hasEntries = (e) => Array.isArray(e?.entries) && e.entries.some(x => (
  typeof x === 'string' ? x.trim().length > 0 : !!x
))

// Ein Eintrag ohne Namen wird von JEDEM Loader gefiltert (`.filter(x => x?.name)`).
function checkCommon(entry, out) {
  if (!isNonEmptyStr(entry?.name)) {
    out.push({ level: 'error', msg: 'Kein Name — der Eintrag wird von allen Listen gefiltert.' })
  }
  if (!isNonEmptyStr(entry?.source)) {
    out.push({ level: 'warn', msg: 'Keine Source — der Eintrag ist im Picker schwer von offiziellen zu unterscheiden.' })
  }
}

const CHECKS = {
  spells(entry, out) {
    if (!Array.isArray(entry.classes) || entry.classes.length === 0) {
      out.push({
        level: 'warn',
        msg: 'Keiner Klassen-Liste zugewiesen — der Spell erscheint in keinem Klassen-Spell-Picker. '
          + 'Wähle mindestens eine Klasse, oder ordne ihn einem Charakter direkt über die Spell-Liste zu.',
      })
    }
    if (typeof entry.level !== 'number' || entry.level < 0 || entry.level > 9) {
      out.push({ level: 'error', msg: 'Level muss zwischen 0 (Cantrip) und 9 liegen.' })
    }
    if (!hasEntries(entry)) {
      out.push({ level: 'warn', msg: 'Keine Beschreibung — im Sheet bleibt der Detail-Text leer.' })
    }
    if (!Array.isArray(entry.time) || !entry.time.length) {
      out.push({ level: 'warn', msg: 'Keine Casting Time — der Spell landet in keinem Aktions-Bucket (Action / Bonus Action / Reaction).' })
    }
    // Schadenswürfel ohne Skalierung: Cantrips skalieren RAW mit dem
    // Charakterlevel, leveled Spells mit dem Slot.
    const flat = (entry.entries || []).map(e => (typeof e === 'string' ? e : '')).join(' ')
    const hasDice = /\d+d\d+/.test(flat)
    if (hasDice && entry.level === 0 && !entry.scalingLevelDice) {
      out.push({ level: 'warn', msg: 'Cantrip mit Würfelschaden, aber ohne Skalierung — er bleibt auf allen Stufen gleich stark.' })
    }
    if (hasDice && entry.level > 0 && !entry.entriesHigherLevel?.length) {
      out.push({ level: 'warn', msg: 'Kein Upcast-Text — beim Wirken auf höherem Grad ändern sich die Würfel nicht.' })
    }
  },
  spelllists(entry, out) {
    if (!Array.isArray(entry.spells) || entry.spells.length === 0) {
      out.push({ level: 'error', msg: 'Die Liste enthält keine Zauber — sie erweitert nichts.' })
    }
  },
  items(entry, out) {
    if (!isNonEmptyStr(entry.type)) {
      out.push({ level: 'warn', msg: 'Kein Item-Typ — das Item wird in Kategorie-Filtern nicht gefunden.' })
    }
    // Waffe ohne Schadenswürfel: computeAttacks erzeugt keine Attack-Row.
    if (entry.weaponCategory && !isNonEmptyStr(entry.dmg1)) {
      out.push({ level: 'warn', msg: 'Waffe ohne Schadenswürfel (dmg1) — es entsteht keine Angriffs-Zeile auf dem Sheet.' })
    }
  },
  races(entry, out) {
    const size = Array.isArray(entry.size) ? entry.size[0] : entry.size
    if (!isNonEmptyStr(size)) out.push({ level: 'warn', msg: 'Keine Größe gesetzt.' })
    if (!entry.speed || (typeof entry.speed === 'object' && !entry.speed.walk)) {
      out.push({ level: 'warn', msg: 'Keine Bewegungsrate — das Sheet zeigt 0 ft.' })
    }
  },
  backgrounds(entry, out) {
    const hasGrants = ['skillProficiencies', 'toolProficiencies', 'languageProficiencies']
      .some(k => Array.isArray(entry[k]) && entry[k].length > 0)
    if (!hasGrants) {
      out.push({ level: 'warn', msg: 'Keine Proficiencies — der Background gewährt mechanisch nichts.' })
    }
  },
  creatures(entry, out) {
    if (entry.cr == null) out.push({ level: 'warn', msg: 'Keine CR — Encounter-Bewertung und Sortierung fehlen.' })
    if (entry.hp == null) out.push({ level: 'warn', msg: 'Keine HP — der Token startet ohne Trefferpunkte.' })
  },
  features(entry, out) {
    if (!hasEntries(entry)) {
      out.push({
        level: 'error',
        msg: 'Kein Beschreibungstext — die Sheet-Parser lesen die Mechanik aus dem Text; ohne ihn passiert nichts.',
      })
    }
    const lvl = entry.level
    if (lvl != null && (typeof lvl !== 'number' || lvl < 1 || lvl > 20)) {
      out.push({ level: 'error', msg: 'Level muss zwischen 1 und 20 liegen.' })
    }
    if (!isNonEmptyStr(entry.className)) {
      out.push({
        level: 'warn',
        msg: 'Keiner Klasse zugewiesen — das Feature ist bei JEDEM Charakter aktiv (klassenfreies Homebrew).',
      })
    }
  },
}

export function validateHomebrew(kind, entry) {
  const out = []
  if (!entry || typeof entry !== 'object') {
    return [{ level: 'error', msg: 'Kein gültiger Eintrag.' }]
  }
  checkCommon(entry, out)
  CHECKS[kind]?.(entry, out)
  return out
}

/** Kurzform für Badges: {errors, warnings} Zähler. */
export function validationCounts(kind, entry) {
  const list = validateHomebrew(kind, entry)
  return {
    errors: list.filter(v => v.level === 'error').length,
    warnings: list.filter(v => v.level === 'warn').length,
    list,
  }
}
