// featureBonusExtractor.js
//
// Liest die `entries` einer Class-/Subclass-/Optional-Feature und
// extrahiert STRUKTURIERTE mechanische Boni daraus. Anders als der
// Pill-Parser (`featureEffectParser`) der "+1d6 necrotic"-Pillen baut
// und nicht in derived stats fließt, produziert dieser Extractor flat-
// integer Werte die direkt von rulesEngine aufaddiert werden können.
//
// Output-Shape (alle Felder optional):
//   {
//     acBonus,                       // +N AC (Defense, Cloak of …)
//     acBonusRequiresArmor,          // true ⇒ nur wenn Rüstung getragen
//     rangedAttackBonus,             // +N Attack Roll mit Fernkampfwaffen (Archery)
//     meleeAttackBonus,              // +N Attack Roll mit Nahkampfwaffen
//     oneHandedMeleeDamageBonus,     // +N Damage mit einhändiger Nahkampfwaffe (Dueling)
//     thrownDamageBonus,             // +N Damage mit Thrown-Waffen (Thrown Weapon Fighting)
//     savingThrowBonus,              // +N auf alle Saves
//     abilityCheckBonus,             // +N auf alle Ability Checks
//     // Erweiterbar — neue Felder werden von rulesEngine ignoriert
//     // bis dort ein consumer existiert. Kein Hardcode pro
//     // Feature-Name — die Erkennung läuft rein über Regex auf den
//     // entries-Text.
//   }
//
// Die Patterns sind sortiert nach Spezifität (spezifischste zuerst),
// damit "+2 Damage with thrown weapons" nicht versehentlich als
// generisches "+2 Damage" greift.

function flattenEntries(entries) {
  const parts = []
  const walk = (n) => {
    if (typeof n === 'string') parts.push(n)
    else if (Array.isArray(n)) for (const x of n) walk(x)
    else if (n && typeof n === 'object') {
      if (Array.isArray(n.entries)) walk(n.entries)
      if (Array.isArray(n.items))   walk(n.items)
    }
  }
  walk(entries || [])
  return parts.join(' ')
}

function stripTags(s) {
  return String(s || '').replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
}

// Hilfs-Parser: zieht den signed-int-Wert aus einem Match-Group
// (kann "+2", "2", "-1" sein).
function toInt(s) {
  if (s == null) return 0
  const m = String(s).match(/^([+-]?)(\d+)/)
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10)
}

/**
 * Extrahiert mechanische Boni aus dem entries-Text eines Features.
 *
 * @param {object} feature  { entries, name? }
 * @returns {object} bonus record
 */
export function extractFeatureBonuses(feature) {
  if (!feature?.entries) return {}
  const raw = stripTags(flattenEntries(feature.entries))
  const text = raw.toLowerCase()
  const out = {}

  // ── AC ─────────────────────────────────────────────────────
  //   "+1 bonus to AC"  (Defense)
  //   "your AC increases by 1"
  //   "while you are wearing armor, you gain a +1 bonus to AC"
  {
    const m = text.match(/\+(\d+)\s+(?:bonus\s+to\s+)?ac\b/i)
      || text.match(/\bac\s+increases?\s+by\s+(\d+)/i)
    if (m) {
      out.acBonus = toInt(m[1])
      if (/wearing\s+armor|while\s+you\s+wear\s+armor/i.test(text)) {
        out.acBonusRequiresArmor = true
      }
    }
  }

  // ── Ranged Attack (Archery) ────────────────────────────────
  //   "You gain a +2 bonus to attack rolls you make with ranged weapons."
  // Beide Reihenfolgen abdecken: "+N … ranged" UND "ranged … +N".
  {
    const m = text.match(/\+(\d+)\s+(?:bonus\s+to\s+)?attack\s+rolls?\b[^.]*?\branged\s+(?:weapons?|attacks?)/i)
      || text.match(/\branged\s+(?:weapons?|attacks?)[^.]*?\+(\d+)\s+(?:bonus\s+to\s+)?attack\s+rolls?/i)
    if (m) out.rangedAttackBonus = toInt(m[1])
  }

  // ── Melee Attack ────────────────────────────────────────────
  //   "+1 bonus to attack rolls with melee weapons"  (rare; some homebrew)
  if (out.rangedAttackBonus == null) {
    const m = text.match(/\+(\d+)\s+(?:bonus\s+to\s+)?attack\s+rolls?\b[^.]*?\bmelee\s+(?:weapons?|attacks?)/i)
      || text.match(/\bmelee\s+(?:weapons?|attacks?)[^.]*?\+(\d+)\s+(?:bonus\s+to\s+)?attack\s+rolls?/i)
    if (m) out.meleeAttackBonus = toInt(m[1])
  }

  // ── Dueling: +N damage with one-handed melee, no other weapons ─
  //   Real text: "When you are wielding a melee weapon in one hand and
  //   no other weapons, you gain a +2 bonus to damage rolls with that
  //   weapon."
  // Wielding-Clause kommt VOR dem +N — Reverse-Pattern.
  {
    const m = text.match(/\b(?:wielding|holding)\s+(?:a\s+)?(?:melee\s+)?weapon\s+in\s+one\s+hand[^.]*?(?:no\s+other\s+weapons?|nothing\s+in\s+the\s+other)[^.]*?\+(\d+)\s+(?:bonus\s+(?:to\s+)?)?damage/i)
      || text.match(/\+(\d+)\s+(?:bonus\s+(?:to\s+)?)?damage[^.]*?\b(?:wielding|holding)\s+(?:a\s+)?(?:melee\s+)?weapon\s+in\s+one\s+hand[^.]*?(?:no\s+other\s+weapons?|nothing\s+in\s+the\s+other)/i)
    if (m) out.oneHandedMeleeDamageBonus = toInt(m[1])
  }

  // ── Thrown Weapon Fighting: +N damage with thrown weapons ──
  //   Real text: "…when you hit with a ranged attack using a thrown
  //   weapon, you gain a +2 bonus to the damage roll."
  {
    const m = text.match(/\bthrown\s+weapon(?:s)?[^.]*?\+(\d+)\s+(?:bonus\s+(?:to\s+)?)?(?:the\s+)?damage/i)
      || text.match(/\+(\d+)\s+(?:bonus\s+(?:to\s+)?)?damage[^.]*?\bthrown\s+(?:property\s+)?weapons?/i)
    if (m) out.thrownDamageBonus = toInt(m[1])
  }

  // ── Saving-Throw Bonus (Cloak of Protection-Schema, Aura-Style) ──
  //   "+N bonus to all saving throws"
  //   "you gain a +N bonus to saving throws"
  {
    const m = text.match(/\+(\d+)\s+(?:bonus\s+to\s+(?:all\s+)?)?saving\s+throws?/i)
    if (m) out.savingThrowBonus = toInt(m[1])
  }

  // ── Ability-Check Bonus ────────────────────────────────────
  {
    const m = text.match(/\+(\d+)\s+(?:bonus\s+to\s+(?:all\s+)?)?ability\s+checks?/i)
    if (m) out.abilityCheckBonus = toInt(m[1])
  }

  // ── Proficiency-Grants ─────────────────────────────────────
  // "you gain proficiency with martial weapons"
  // "training with medium armor"
  // "proficiency in heavy armor"
  // Erkennt sowohl 5e- als auch 5.5e-Phrasing. Multiple Categories
  // pro Feature möglich ("you gain proficiency with martial weapons
  // AND training with medium armor"). out.weaponProficiencies /
  // out.armorProficiencies sind Arrays mit Tokens 'simple' /
  // 'martial' / 'light' / 'medium' / 'heavy' / 'shield' / 'all-armor'.
  // rulesEngine.computeProficiencies merged sie ins
  // proficiencies.weapons / proficiencies.armor wenn das Feature
  // im character active ist.
  {
    const weaponMatches = [
      ...text.matchAll(/\b(?:gain\s+(?:training\s+with\s+|proficiency\s+(?:with|in)\s+)|training\s+with\s+|proficiency\s+(?:with|in)\s+)((?:simple|martial)(?:\s+weapons?)?)/gi),
    ]
    const armorMatches = [
      ...text.matchAll(/\b(?:gain\s+(?:training\s+with\s+|proficiency\s+(?:with|in)\s+)|training\s+with\s+|proficiency\s+(?:with|in)\s+)(light\s+armor|medium\s+armor|heavy\s+armor|all\s+armor|shields?)/gi),
    ]
    const wp = new Set()
    for (const m of weaponMatches) {
      const cat = m[1].toLowerCase()
      if (cat.startsWith('simple')) wp.add('simple')
      else if (cat.startsWith('martial')) wp.add('martial')
    }
    const ap = new Set()
    for (const m of armorMatches) {
      const cat = m[1].toLowerCase()
      if (cat.startsWith('light'))  ap.add('light')
      else if (cat.startsWith('medium')) ap.add('medium')
      else if (cat.startsWith('heavy'))  ap.add('heavy')
      else if (cat.startsWith('all'))    ap.add('light').add('medium').add('heavy')
      else if (cat.startsWith('shield')) ap.add('shield')
    }
    if (wp.size > 0) out.weaponProficiencies = [...wp]
    if (ap.size > 0) out.armorProficiencies = [...ap]
  }

  return out
}

// ── Pro Angriff WÄHLBARE Boni (Wurf-Composer-Schalter) ───────────────
// Konditionale Boni, deren Bedingung der SPIELER pro Angriff entscheidet
// statt dass sie automatisch aus dem Waffenzustand ableitbar wäre:
//   • "+N bonus to the damage roll" bei Thrown-Waffen NUR beim Wurf
//     (Thrown Weapon Fighting) → Schalter „Geworfen"
//   • "take a -5 penalty to the attack roll … +10 to the damage"
//     (Great Weapon Master / Sharpshooter 2014) → Power-Attack-Schalter
// Bedingungs-Keywords rund um den Treffer-Satz (thrown/heavy/two-handed/
// ranged/melee) landen als `when`-Flags; rulesEngine matcht sie gegen die
// Properties der konkreten Waffe. Kein Feature-Name-Hardcode — rein Text.
export function extractAttackChoices(feature) {
  if (!feature?.entries) return []
  const raw = stripTags(flattenEntries(feature.entries))
  const out = []
  const scanWhen = (ctx) => {
    const when = {}
    if (/\bthrown\b/i.test(ctx)) when.thrown = true
    if (/\bheavy\b/i.test(ctx)) when.heavy = true
    if (/\btwo-handed\b/i.test(ctx)) when.twoHanded = true
    if (/\branged\s+(?:weapon|attack)/i.test(ctx)) when.ranged = true
    else if (/\bmelee\s+(?:weapon|attack)/i.test(ctx)) when.melee = true
    return when
  }
  // Power-Attack: −N auf den Angriff gegen +M Schaden — die beiden Teile
  // stehen oft in ZWEI Sätzen ("…take a -5 penalty to the attack roll.
  // If the attack hits, you add +10 to the attack's damage.").
  const pa = /[-−](\d+)\s+penalty\s+to\s+(?:the\s+|your\s+)?attack\s+roll[\s\S]{0,140}?\+(\d+)\s+(?:bonus\s+)?to\s+(?:the\s+)?(?:attack'?s\s+)?damage/i.exec(raw)
  if (pa) out.push({ atkDelta: -toInt(pa[1]), dmgBonus: toInt(pa[2]), when: scanWhen(raw.slice(Math.max(0, pa.index - 200), pa.index + pa[0].length)) })
  // Wähl-Bonus nur auf Schaden mit Wurf-Bedingung (Thrown Weapon Fighting).
  const tw = /\bthrown\s+weapons?[^.]*?\+(\d+)\s+(?:bonus\s+(?:to\s+)?)?(?:the\s+)?damage/i.exec(raw)
    || /\+(\d+)\s+(?:bonus\s+(?:to\s+)?)?damage[^.]*?\bthrown\s+(?:property\s+)?weapons?/i.exec(raw)
  if (tw) out.push({ dmgBonus: toInt(tw[1]), when: { thrown: true }, note: 'Geworfen' })
  return out
}

/**
 * Aggregiert die Boni über ALLE aktiv-gewählten Features die der
 * Caller liefert (typisch: chosen optfeatures + chosen sub-features
 * + die Feature-Effekt-Notes). Aufaddiert wo numerisch.
 *
 * @param {Array<object>} features  Liste von Feature-Objekten mit `entries`
 * @returns {object} aggregierte Boni
 */
export function aggregateFeatureBonuses(features) {
  const total = {}
  const NUMERIC_KEYS = [
    'acBonus', 'rangedAttackBonus', 'meleeAttackBonus',
    'oneHandedMeleeDamageBonus', 'thrownDamageBonus',
    'savingThrowBonus', 'abilityCheckBonus',
  ]
  // Flags die OR-aggregiert werden (true sobald irgendein Feature
  // sie setzt).
  const FLAG_KEYS = ['acBonusRequiresArmor']

  for (const f of (features || [])) {
    if (!f) continue
    const b = extractFeatureBonuses(f)
    for (const k of NUMERIC_KEYS) {
      if (typeof b[k] === 'number') total[k] = (total[k] || 0) + b[k]
    }
    for (const k of FLAG_KEYS) {
      if (b[k]) total[k] = true
    }
    // String-Array-Felder (weapon-/armor-proficiency-tokens) als Set
    // sammeln und am Ende serialisieren — kein Duplikat von 'martial'
    // wenn zwei verschiedene Features dasselbe gewähren.
    if (Array.isArray(b.weaponProficiencies)) {
      total._weaponProfs = total._weaponProfs || new Set()
      for (const w of b.weaponProficiencies) total._weaponProfs.add(w)
    }
    if (Array.isArray(b.armorProficiencies)) {
      total._armorProfs = total._armorProfs || new Set()
      for (const a of b.armorProficiencies) total._armorProfs.add(a)
    }
  }
  if (total._weaponProfs) {
    total.weaponProficiencies = [...total._weaponProfs]
    delete total._weaponProfs
  }
  if (total._armorProfs) {
    total.armorProficiencies = [...total._armorProfs]
    delete total._armorProfs
  }
  return total
}
