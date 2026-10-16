// Full backup of everything the app keeps in this browser, as one JSON file:
// the setup (identity fields, Global columns), every company with its own
// columns and details, and every saved month of every company.
//
// It exists because the browser is the only place this data lives: clearing
// site data, a new computer or a new browser loses it. Unlike "Export Column
// Setup" (structure only) and the Excel exports (one month), this file holds
// everything, and restoring it puts everything back exactly.
//
// Nothing is recalculated or tidied on the way out or on the way in: the
// file holds what is stored, and a restore stores what the file holds.

import { BROWSER_PERIOD_KEY_PREFIX, BROWSER_STATE_KEY, readBrowserData, replaceBrowserData } from './storage'

// Saved setup in this browser that cannot be read (see storage.js): like the
// backup, about the browser's own copy, so the screens reach it from here.
export { setupIsUnreadable, startWithEmptySetup } from './storage'
import { formatPeriodLabel } from './periods'

export const BACKUP_APP_ID = 'payroll-sys-backup'
export const BACKUP_VERSION = 1

const PERIOD_KEY_PATTERN = /^payroll_period_(.+)_(\d{4})-(0[1-9]|1[0-2])$/

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// The stored text as the value it holds, or `undefined` when it is not JSON.
function parseStored(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// Builds the backup from what the browser holds right now.
//   state       the app state, as stored
//   periods     { storage key: { employees: [...] } }, one entry per saved month
//   unreadable  { storage key: the stored text } for anything that is not
//               JSON, so even damaged data is carried along instead of dropped
export function buildBackup(now = new Date()) {
  const stored = readBrowserData()
  const backup = {
    _meta: { app: BACKUP_APP_ID, version: BACKUP_VERSION, exportedAt: now.toISOString() },
    state: null,
    periods: {},
    unreadable: {},
  }

  for (const [key, text] of Object.entries(stored)) {
    const value = parseStored(text)
    // Only text that reads back to exactly itself is kept as a value; the
    // rest is kept as text, so a restore always stores what was stored.
    if (value === undefined || JSON.stringify(value) !== text) backup.unreadable[key] = text
    else if (key === BROWSER_STATE_KEY) backup.state = value
    else backup.periods[key] = value
  }
  return backup
}

export function buildBackupFilename(now = new Date()) {
  return `payroll-backup-${now.toISOString().slice(0, 10)}.json`
}

// Triggers a normal browser file download of the backup.
export function downloadBackup(backup, filename) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function checkState(state) {
  if (state === null) return null
  if (!isObject(state)) return 'its setup is not in the expected form'
  if (!Array.isArray(state.companies)) return 'it has no list of companies'
  if (state.companies.some((c) => !isObject(c) || typeof c.id !== 'string' || c.id === '' || typeof c.name !== 'string')) {
    return 'one of its companies has no name or no id'
  }
  for (const list of ['identityFields', 'globalColumns']) {
    if (state[list] !== undefined && !Array.isArray(state[list])) return 'its setup is not in the expected form'
  }
  return null
}

function checkPeriods(periods) {
  if (!isObject(periods)) return 'its months are not in the expected form'
  for (const [key, period] of Object.entries(periods)) {
    if (!PERIOD_KEY_PATTERN.test(key)) return 'one of its months is not named as a month'
    if (!isObject(period) || !Array.isArray(period.employees)) return 'one of its months has no list of employees'
    if (period.employees.some((e) => !isObject(e))) return 'one of its months has an employee that is not in the expected form'
  }
  return null
}

function checkUnreadable(unreadable) {
  if (!isObject(unreadable)) return 'it is not in the expected form'
  for (const [key, text] of Object.entries(unreadable)) {
    const isOwn = key === BROWSER_STATE_KEY || key.startsWith(BROWSER_PERIOD_KEY_PREFIX)
    if (!isOwn || typeof text !== 'string') return 'it is not in the expected form'
  }
  return null
}

// Reads and checks the text of a chosen file. Returns { valid: true, backup }
// or { valid: false, error }, the error worded for the person choosing the file.
export function parseBackupText(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { valid: false, error: 'This file is not a Payroll backup. Choose a file saved with "Back up".' }
  }

  const meta = parsed?._meta
  if (!isObject(parsed) || !isObject(meta) || meta.app !== BACKUP_APP_ID) {
    return { valid: false, error: 'This file is not a Payroll backup. Choose a file saved with "Back up".' }
  }
  if (meta.version !== BACKUP_VERSION) {
    return {
      valid: false,
      error: 'This backup was made by a different version of Payroll and cannot be restored here. Nothing was changed.',
    }
  }

  const backup = {
    _meta: meta,
    state: parsed.state ?? null,
    periods: parsed.periods ?? {},
    unreadable: parsed.unreadable ?? {},
  }
  const problem = checkState(backup.state) ?? checkPeriods(backup.periods) ?? checkUnreadable(backup.unreadable)
  if (problem) {
    return { valid: false, error: `This backup cannot be restored: ${problem}. Nothing was changed.` }
  }
  if (backup.state === null && Object.keys(backup.periods).length === 0 && Object.keys(backup.unreadable).length === 0) {
    return { valid: false, error: 'This backup is empty: it holds no companies and no months. Nothing was changed.' }
  }
  return { valid: true, backup }
}

export async function parseBackupFile(file) {
  let text
  try {
    text = await file.text()
  } catch {
    return { valid: false, error: 'Could not read that file.' }
  }
  return parseBackupText(text)
}

// What a backup holds, for showing before anything is replaced: each company
// with how many months and employee rows it has, and anything saved under a
// company that is no longer in the list.
export function summarizeBackup(backup) {
  const months = new Map() // company id -> { months, rows, first, last }
  for (const [key, period] of Object.entries(backup.periods)) {
    const [, companyId, year, month] = key.match(PERIOD_KEY_PATTERN)
    const entry = months.get(companyId) ?? { months: 0, rows: 0, first: null, last: null }
    const label = `${year}-${month}`
    entry.months += 1
    entry.rows += period.employees.length
    if (entry.first === null || label < entry.first) entry.first = label
    if (entry.last === null || label > entry.last) entry.last = label
    months.set(companyId, entry)
  }

  const describe = (entry) => {
    if (!entry) return { months: 0, rows: 0, range: null }
    const label = (key) => formatPeriodLabel(Number(key.slice(0, 4)), Number(key.slice(5)))
    const range = entry.first === entry.last ? label(entry.first) : `${label(entry.first)} to ${label(entry.last)}`
    return { months: entry.months, rows: entry.rows, range }
  }

  const companies = (backup.state?.companies ?? []).map((c) => ({ id: c.id, name: c.name, ...describe(months.get(c.id)) }))
  const known = new Set(companies.map((c) => c.id))
  const otherMonths = [...months].filter(([id]) => !known.has(id)).reduce((n, [, entry]) => n + entry.months, 0)

  return {
    exportedAt: typeof backup._meta?.exportedAt === 'string' ? backup._meta.exportedAt : null,
    companies,
    monthCount: Object.keys(backup.periods).length,
    globalColumnCount: backup.state?.globalColumns?.length ?? 0,
    // Months saved under a company that is not in the list any more.
    otherMonths,
    unreadableCount: Object.keys(backup.unreadable).length,
  }
}

// The same summary for what this browser holds right now.
export function summarizeBrowser() {
  return summarizeBackup(buildBackup())
}

// When a backup was saved, in this computer's own time: "13 October 2026 at 10:15".
// Null when the file does not say.
export function formatSavedAt(exportedAt) {
  const date = exportedAt ? new Date(exportedAt) : null
  if (!date || Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short' }).format(date)
}

// Replaces everything in this browser with the backup. All or nothing - see
// replaceBrowserData for what comes back.
export function restoreBackup(backup) {
  const entries = { ...backup.unreadable }
  if (backup.state !== null) entries[BROWSER_STATE_KEY] = JSON.stringify(backup.state)
  for (const [key, period] of Object.entries(backup.periods)) entries[key] = JSON.stringify(period)
  return replaceBrowserData(entries)
}
