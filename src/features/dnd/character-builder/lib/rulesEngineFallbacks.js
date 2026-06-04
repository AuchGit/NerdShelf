// rulesEngineFallbacks.js
//
// 5e-PHB-Klassen tragen ihre Resource-Progression NICHT als
// strukturierte `classTableGroups`-Daten — die Werte müssen aus den
// Hardcoded-Stufen-Tabellen kommen. Diese Helper waren bisher private
// Funktionen in rulesEngine.js; jetzt extrahiert damit auch
// resourceTemplates.js auf sie zugreifen kann.
//
// 5.5e-XPHB-Klassen sind in den classTableGroups voll abgedeckt → die
// Helper greifen dort nur als Last-Resort wenn das table-Lookup `null`
// liefert (alte Charaktere, Subclass-Edge-Cases).

export function getBarbarianRages(level) {
  if (level >= 20) return 999 // Unlimited
  if (level >= 17) return 6
  if (level >= 15) return 5
  if (level >= 12) return 4
  if (level >= 6) return 3
  if (level >= 3) return 3
  return 2
}

export function getBarbarianRageDamage(level) {
  if (level >= 16) return 4
  if (level >= 9) return 3
  return 2
}

export function getBardicInspirationDie(level) {
  if (level >= 15) return 'd12'
  if (level >= 10) return 'd10'
  if (level >= 5) return 'd8'
  return 'd6'
}

export function getMonkMartialArtsDie(level) {
  if (level >= 17) return 'd10'
  if (level >= 11) return 'd8'
  if (level >= 5) return 'd6'
  return 'd4'
}

export function getMonkUnarmoredMovement(level) {
  if (level >= 18) return 30
  if (level >= 14) return 25
  if (level >= 10) return 20
  if (level >= 6) return 15
  if (level >= 2) return 10
  return 0
}

export function getWarlockInvocations(level) {
  if (level >= 17) return 8
  if (level >= 15) return 7
  if (level >= 12) return 6
  if (level >= 9) return 5
  if (level >= 7) return 4
  if (level >= 5) return 3
  if (level >= 2) return 2
  return 0
}

export function getArtificerInfusions(level) {
  if (level >= 18) return 12
  if (level >= 14) return 10
  if (level >= 10) return 8
  if (level >= 6) return 6
  if (level >= 2) return 4
  return 0
}

export function getArtificerInfusedItems(level) {
  if (level >= 18) return 6
  if (level >= 14) return 5
  if (level >= 10) return 4
  if (level >= 6) return 3
  if (level >= 2) return 2
  return 0
}
