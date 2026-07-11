// Kompakte Karten-Kacheln (Passives + einfache Stats) aus den GM-Session-
// Prefs — GETEILT zwischen der Session-Übersicht (SessionPage) und der
// Party-Bottom-Bar im VTT (DMBottomBar), damit BEIDE exakt das anzeigen,
// was der DM in den Session-Prefs eingestellt hat. Einzige Quelle für die
// Kürzel + Wert-Berechnung; komplexe Blöcke (Saves-Grid, Slots, Currency …)
// bleiben Sache der jeweiligen Ansicht.
import { modStr } from './sheetUtils'

export const PASSIVE_CODE = {
  perception:    'PER',
  insight:       'INS',
  investigation: 'INV',
  stealth:       'STL',
}

export const STAT_CODE = {
  ac:          'AC',
  speed:       'SPD',
  initiative:  'INIT',
  hitDice:     'HD',
  spellSave:   'DC',
  spellAttack: 'ATK',
}

export const passiveLabel = (id) => PASSIVE_CODE[id] || id.slice(0, 3).toUpperCase()

// Passiver Wert = 10 + Skill-Bonus (id matcht computed.skills-Key).
export function passiveTotal(id, computed) {
  const skill = computed?.skills?.[id]
  if (!skill) return null
  return 10 + (skill.total ?? 0)
}

// EINE einfache Stat-Kachel (label/value/tooltip) oder null, wenn nicht
// anwendbar. Nur die kachel-tauglichen Stats; Saves/Currency/Slots etc.
// liefern null (dedizierte Blöcke in der Vollansicht).
export function simpleStatTile(id, computed, character, prefs) {
  const label = STAT_CODE[id] || id.slice(0, 3).toUpperCase()
  switch (id) {
    case 'ac': return { label, value: computed?.ac?.total ?? '—' }
    case 'speed': {
      const sp = computed?.speed
      const walk = typeof sp?.walk === 'number' ? sp.walk : (typeof sp === 'number' ? sp : null)
      if (walk == null) return { label, value: '—' }
      let tooltip
      if (prefs?.stats?.includes?.('movementModes') && sp && typeof sp === 'object') {
        const extra = []
        if (sp.fly) extra.push(`Fly ${sp.fly} ft.`)
        if (sp.swim) extra.push(`Swim ${sp.swim} ft.`)
        if (sp.climb) extra.push(`Climb ${sp.climb} ft.`)
        if (sp.burrow) extra.push(`Burrow ${sp.burrow} ft.`)
        if (extra.length) tooltip = `Walk ${walk} ft.\n${extra.join('\n')}`
      }
      return { label, value: walk, tooltip }
    }
    case 'initiative': return { label, value: modStr(computed?.initiative ?? 0) }
    case 'hitDice': {
      const total = (character?.classes || []).reduce((s, c) => s + (c.level || 0), 0)
      if (total <= 0) return null
      // hitDiceUsed ist pro Klasse gespeichert ({Fighter:1, Wizard:0}) —
      // aufsummieren. Legacy-Zahl-Form wird ebenfalls unterstützt; sonst
      // ergäbe `total - {objekt}` NaN (Multiclass-Bug „NaN/8").
      const hdu = character?.status?.hitDiceUsed
      const used = hdu && typeof hdu === 'object'
        ? Object.values(hdu).reduce((s, n) => s + (Number(n) || 0), 0)
        : (Number(hdu) || 0)
      return { label, value: `${total - used}/${total}` }
    }
    case 'spellSave': {
      const dcs = computed?.spellcasting ? Object.values(computed.spellcasting).map((x) => x.spellSaveDC).filter((v) => v != null) : []
      return dcs.length ? { label, value: dcs.join('/') } : null
    }
    case 'spellAttack': {
      const atks = computed?.spellcasting ? Object.values(computed.spellcasting).map((x) => x.spellAttackDisplay).filter(Boolean) : []
      return atks.length ? { label, value: atks.join('/') } : null
    }
    default: return null
  }
}

// Kompakte Kachel-Liste aus den Prefs: erst AC (falls an), dann die weiteren
// einfachen Stats in Prefs-Reihenfolge, dann die aktiven Passives. Reihenfolge
// von STAT_OPTIONS/PASSIVE_OPTIONS bleibt erhalten (Aufrufer gibt die ids so
// weiter, wie prefs sie führt).
export function cardTiles(computed, character, prefs) {
  const tiles = []
  for (const id of (prefs?.stats || [])) {
    const t = simpleStatTile(id, computed, character, prefs)
    if (t) tiles.push({ ...t, title: t.tooltip || t.label })
  }
  for (const id of (prefs?.passives || [])) {
    const v = passiveTotal(id, computed)
    if (v != null) tiles.push({ label: passiveLabel(id), value: v, title: `Passiv ${id}` })
  }
  return tiles
}
