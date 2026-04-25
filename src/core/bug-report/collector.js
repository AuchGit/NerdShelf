// src/core/bug-report/collector.js
// Global error/warning collector + bug report payload builder.
//
// The payload shape matches the existing `bug_reports` Supabase table
// (one row per report) with these columns:
//   user_id        uuid     — auth user id
//   user_email     text     — auth user email
//   description    text     — what the user typed
//   console_log    text     — last 30 console.error/warn entries (newline-joined)
//   error_log      text     — last 10 error-only entries (just messages)
//   app_state      jsonb    — route, tool, theme, screen, tool-specific context
//   app_version    text     — Tauri version when present, otherwise 'web'
//   priority       text     — 'low' | 'medium' | 'high'
//   status         text     — always 'open' on insert
//
// Tool-aware context is attached automatically based on the current route:
//   /dnd/...  → loads character summary from `characters` table
//   /mtg/...  → loads deck summary from `mtg_decks` table

import { supabase } from '../supabase/client'

let installed = false
const MAX = 50

export function setupErrorCollector() {
  if (installed) return
  installed = true
  if (typeof window === 'undefined') return
  if (window.__bugReportErrors) return        // legacy DnD collector already there
  window.__bugReportErrors = []

  const push = (entry) => {
    window.__bugReportErrors.push(entry)
    if (window.__bugReportErrors.length > MAX) window.__bugReportErrors.shift()
  }

  const origError = console.error
  console.error = (...args) => {
    push({
      type: 'error',
      time: Date.now(),
      message: args.map(stringify).join(' '),
    })
    origError.apply(console, args)
  }

  const origWarn = console.warn
  console.warn = (...args) => {
    push({
      type: 'warn',
      time: Date.now(),
      message: args.map(stringify).join(' '),
    })
    origWarn.apply(console, args)
  }

  window.addEventListener('error', (e) => {
    push({
      type: 'error',
      time: Date.now(),
      message: `${e.message}\n  at ${e.filename}:${e.lineno}:${e.colno}`,
    })
  })

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    const msg = r instanceof Error ? `${r.message}\n${r.stack}` : String(r)
    push({
      type: 'error',
      time: Date.now(),
      message: `Unhandled Promise: ${msg}`,
    })
  })
}

function stringify(a) {
  if (a instanceof Error) return `${a.message}\n${a.stack || ''}`
  if (typeof a === 'object') {
    try { return JSON.stringify(a) } catch { return String(a) }
  }
  return String(a)
}

export function getRecentLogs(n = 30) {
  return (window.__bugReportErrors || []).slice(-n)
}

export function detectActiveTool() {
  const p = window.location.pathname
  if (p.startsWith('/dnd')) return 'dnd'
  if (p.startsWith('/mtg')) return 'mtg'
  return 'toolbox'
}

/** Pull the active character ID from the DnD hash route. */
function extractDndCharacterId() {
  const hash = window.location.hash || ''
  const m = hash.match(/character\/([a-f0-9-]+)/i)
  return m ? m[1] : null
}

/** Pull the active deck ID from the MTG path route. */
function extractMtgDeckId() {
  const path = window.location.pathname || ''
  const m = path.match(/^\/mtg\/deck\/([a-f0-9-]+)/i)
  return m ? m[1] : null
}

/** Load DnD character summary from Supabase for diagnostic context. */
async function loadDndContext() {
  const id = extractDndCharacterId()
  if (!id) return null
  try {
    const { data } = await supabase
      .from('characters')
      .select('name, data')
      .eq('id', id)
      .single()
    if (!data) return null
    const d = data.data || {}
    return {
      characterId: id,
      name: data.name,
      edition: d?.meta?.edition,
      race: d?.species?.raceId?.split('__')[0],
      subrace: d?.species?.subraceId?.split('__')[0] || null,
      classes: (d?.classes || []).map(c => ({
        classId: c.classId, level: c.level, subclassId: c.subclassId || null,
      })),
      background: d?.background?.backgroundId?.split('__')[0] || null,
      totalLevel: (d?.classes || []).reduce((s, c) => s + (c.level || 0), 0),
    }
  } catch {
    return { characterId: id, _loadError: true }
  }
}

/** Load MTG deck summary from Supabase for diagnostic context. */
async function loadMtgContext() {
  const id = extractMtgDeckId()
  if (!id) return null
  try {
    const { data } = await supabase
      .from('mtg_decks')
      .select('name, format, data')
      .eq('id', id)
      .single()
    if (!data) return null
    const main = Object.values(data.data?.mainboard || {})
    const side = Object.values(data.data?.sideboard || {})
    return {
      deckId: id,
      name: data.name,
      format: data.format,
      mainCount: main.reduce((s, e) => s + (e.count || 0), 0),
      sideCount: side.reduce((s, e) => s + (e.count || 0), 0),
      uniqueCards: main.length + side.length,
    }
  } catch {
    return { deckId: id, _loadError: true }
  }
}

async function detectAppVersion() {
  if (!window.__TAURI_INTERNALS__) return 'web'
  try {
    const m = await import('@tauri-apps/api/app')
    return await m.getVersion()
  } catch {
    return 'web'
  }
}

/**
 * Build the full bug-report payload, including tool-specific context
 * loaded from Supabase (character / deck summary).
 *
 * @param {{ description: string, priority: string, user: any }} args
 * @returns Promise<object> matching the bug_reports table schema
 */
export async function buildReportPayload({ description, priority, user }) {
  const logs = getRecentLogs(30)
  const consoleLog = logs
    .map(e => `[${new Date(e.time).toISOString()}] [${e.type}] ${e.message}`)
    .join('\n')
  const errorLog = logs
    .filter(e => e.type === 'error')
    .slice(-10)
    .map(e => e.message)
    .join('\n')

  const tool = detectActiveTool()
  const [appVersion, dndContext, mtgContext] = await Promise.all([
    detectAppVersion(),
    tool === 'dnd' ? loadDndContext() : Promise.resolve(null),
    tool === 'mtg' ? loadMtgContext() : Promise.resolve(null),
  ])

  const appState = {
    tool,
    route: {
      pathname: window.location.pathname,
      hash:     window.location.hash,
      search:   window.location.search,
    },
    dnd: dndContext,
    mtg: mtgContext,
    theme:      document.documentElement.getAttribute('data-theme'),
    themeMode:  localStorage.getItem('nerdshelf-theme-mode') || 'system',
    screenSize: `${window.innerWidth}x${window.innerHeight}`,
    platform:   navigator.platform,
    userAgent:  navigator.userAgent,
    isTauri:    !!window.__TAURI_INTERNALS__,
    timestamp:  new Date().toISOString(),
  }

  return {
    user_id:     user?.id || null,
    user_email:  user?.email || 'nicht eingeloggt',
    description: (description || '').trim(),
    console_log: consoleLog || null,
    error_log:   errorLog || null,
    app_state:   appState,
    app_version: appVersion,
    priority:    priority || 'medium',
    status:      'open',
  }
}

/**
 * Insert the bug report into the bug_reports table.
 * @returns Promise<{ ok: boolean, error?: string }>
 */
export async function sendBugReport(payload) {
  const { error } = await supabase.from('bug_reports').insert(payload)
  if (error) {
    console.warn('[BugReport] insert failed:', error)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}