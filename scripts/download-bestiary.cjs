#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/download-bestiary.cjs
//
// Lädt die 5etools-Bestiary-Daten herunter und merget sie zu einer
// einzigen monsters.json pro Edition. Dateien landen in
//   public/data/5e/monsters.json
//   public/data/5.5e/monsters.json
//
// Quelle: GitHub-Mirror der 5etools-Daten (raw.githubusercontent.com).
// Falls die URL sich ändert oder ein anderer Mirror benötigt wird,
// MIRROR_BASE unten anpassen.
//
// Usage:
//   node scripts/download-bestiary.cjs           # beide editions
//   node scripts/download-bestiary.cjs 5e        # nur 5e
//   node scripts/download-bestiary.cjs 5.5e      # nur 5.5e

const fs = require('fs')
const path = require('path')

const MIRROR_BASE = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/bestiary'

// Quellen — die wichtigsten offiziellen Bücher. Wer mehr will, ergänzt
// das Array. Quellen-Codes entsprechen 5etools-Source-Strings.
const SOURCES_5E = [
  'mm',     // Monster Manual (2014)
  'dmg',    // DMG-Monster
  'mpmm',   // Monsters of the Multiverse (= reprint vgm+mtf)
  'vgm',    // Volo's Guide
  'mtf',    // Mordenkainen's Tome of Foes
  'tce',    // Tasha's
  'xge',    // Xanathar's
  'scag',   // Sword Coast
  'ggr',    // Guildmasters' Guide
  'erlw',   // Eberron
  'egw',    // Explorer's Guide to Wildemount
  'ftd',    // Fizban's Treasury of Dragons
  'mot',    // Mythic Odysseys of Theros
  'scc',    // Strixhaven
  'kftgv',  // Keys from the Golden Vault
  'aag',    // Astral Adventurer's Guide
  'phb',    // PHB legacy
]
const SOURCES_55E = [
  'xmm',    // Monster Manual 2024
  'xphb',   // XPHB familiars / summons
  'xdmg',   // XDMG monsters
]

// Manche Editionen verwenden die Standard-Bücher der jeweils anderen
// Edition mit (z.B. 5.5e darf MM-Reprints lesen). Für eine saubere
// Trennung holen wir aber nur das edition-spezifische.
const EDITIONS = {
  '5e':   SOURCES_5E,
  '5.5e': SOURCES_55E,
}

async function downloadOne(src) {
  const url = `${MIRROR_BASE}/bestiary-${src}.json`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'NerdShelf-bestiary-downloader/1.0' } })
    if (!res.ok) {
      console.warn(`  [skip] ${src}: HTTP ${res.status}`)
      return null
    }
    return await res.json()
  } catch (e) {
    console.warn(`  [fail] ${src}:`, e.message)
    return null
  }
}

async function downloadEdition(editionKey, sources) {
  console.log(`\n=== ${editionKey} ===`)
  const allMonsters = []
  const sourcesSeen = {}
  for (const src of sources) {
    process.stdout.write(`  fetch ${src} … `)
    const data = await downloadOne(src)
    if (!data) continue
    const monsters = Array.isArray(data.monster) ? data.monster : []
    console.log(`${monsters.length} monsters`)
    allMonsters.push(...monsters)
    if (data._meta?.sources) {
      for (const s of data._meta.sources) sourcesSeen[s.json] = s
    }
  }
  // Dedup nach (name + source) — manche Bücher reprinten exakt gleiche
  // Monster (z.B. MPMM = VGM+MTF). Wir keepen den ERSTEN (= reihenfolge-
  // priorität: SOURCES_5E/55E array). Reprint-Schutz reduziert Filesize.
  const seen = new Set()
  const deduped = []
  for (const m of allMonsters) {
    const k = `${m.name?.toLowerCase()}::${m.source}`
    if (seen.has(k)) continue
    seen.add(k)
    deduped.push(m)
  }
  console.log(`  total: ${allMonsters.length} → ${deduped.length} after dedup`)

  const outDir = path.join('public', 'data', editionKey)
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, 'monsters.json')
  const payload = {
    _meta: {
      sources: Object.values(sourcesSeen),
      generatedBy: 'download-bestiary.cjs',
      generatedAt: new Date().toISOString(),
      sourceList: sources,
    },
    monster: deduped,
  }
  fs.writeFileSync(outFile, JSON.stringify(payload), 'utf-8')
  console.log(`  written: ${outFile} (${(fs.statSync(outFile).size / 1024 / 1024).toFixed(2)} MB)`)
}

async function main() {
  const arg = process.argv[2]
  const editions = arg ? [arg] : Object.keys(EDITIONS)
  for (const ed of editions) {
    const srcs = EDITIONS[ed]
    if (!srcs) { console.warn(`unknown edition: ${ed}`); continue }
    await downloadEdition(ed, srcs)
  }
  console.log('\ndone.')
}

main().catch(e => {
  console.error('FATAL:', e)
  process.exit(1)
})
