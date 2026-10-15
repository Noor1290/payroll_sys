// The second data store (see dataStore.js): inside the Payroll Hub dashboard,
// the column setup is kept in the dashboard's database.
//
//   - The shared setup: the identity fields, which one is the ID field, and
//     the Global columns. Several companies are attached to it, and a change
//     reaches all of them, so only an admin of every attached company may
//     change it (the dashboard decides; this file shows it read-only first).
//   - Each company's own setup: its own columns and its custom company
//     details. Name, address and BRN are the dashboard's own and are shown,
//     not changed, here.
//
// Screens read and save at once, as with the browser store: the setup is
// held in memory, loaded once when the app opens. A change is shown
// immediately and sent to the dashboard a moment later: one save after the
// last change, never one per key, and never two at once. `setupStatus` says
// how that is going: Saved, Saving, or NOT saved (and why). What was not
// saved is never written to the browser's storage instead: it stays on
// screen until it is saved.
//
// The months of employee data are kept in the dashboard too (Phase 3,
// dashboardMonths.js), when the dashboard keeps them. A dashboard that does not
// yet keep months leaves them in this browser, under the same storage keys as
// before (Phase 2). Not kept in the dashboard: the column widths and the month
// being viewed, which are this browser's display preferences.
//
// A change of a column's key moves that column's values in every month it
// reaches. In the dashboard that is one step with the column setup carrying
// the new key, all or nothing (`key-change`, saved below).
//
// This browser's own copy of the setup (payroll_app_state_v1) is never
// written here: it stays as it was, the fallback used when the app is opened
// on its own.

import * as browserStore from './storage'
import { getCurrentPeriod } from './periods'
import { askHub, asJson, MONTH, normaliseBrn, sameJson, sendHub } from './hubWire'
import {
  connectMonths,
  dropKeyChanges,
  gateChanged,
  keyChangeSaved,
  monthOperations,
  monthsSupported,
  onGateOpen,
  pendingKeyMoves,
} from './dashboardMonths'

// This browser's display preferences per dashboard company, by BRN:
// { [BRN]: { columnWidths, viewYear, viewMonth } }. No payroll value.
export const PREFS_KEY = 'payroll_dashboard_prefs_v1'
// What was imported from this browser, and where to (see dashboardImport.js).
// Names, BRNs, dates and revision numbers only.
export const IMPORTED_KEY = 'payroll_dashboard_imported_v1'

const SAVE_AFTER_MS = 1000
const RETRY_AFTER_MS = 15_000

const fail = (code, error) => ({ ok: false, code, error })
const uncertain = (failure) => failure.code === 'unavailable' || failure.code === 'no-answer' || failure.code === 'stale'
const STALE = fail('stale', 'Someone else changed the column setup in the dashboard since it was opened here.')

// ---------- this browser's notes ----------

export const readImported = () => {
  const notes = browserStore.readNote(IMPORTED_KEY)
  return { ...notes, companies: notes.companies && typeof notes.companies === 'object' ? notes.companies : {} }
}
export const writeImported = (notes) => browserStore.writeNote(IMPORTED_KEY, notes)
export const readPrefs = () => browserStore.readNote(PREFS_KEY)
export const writePrefs = (prefs) => browserStore.writeNote(PREFS_KEY, prefs)

// Under which id a dashboard company's months are kept in this browser: the
// browser company it was imported from, so its months carry on; otherwise an
// id of its own, made from its BRN.
export function periodIdFor(brn) {
  const linked = Object.entries(readImported().companies).find(([, note]) => normaliseBrn(note?.brn) === normaliseBrn(brn))
  return linked ? linked[0] : `dashboard_${normaliseBrn(brn).replace(/[^A-Z0-9-]/g, '-')}`
}

// ---------- what crosses the bridge ----------

export const sharedBodyOf = (state) =>
  asJson({ identityFields: state.identityFields, idFieldKey: state.idFieldKey, globalColumns: state.globalColumns })

export const companyBodyOf = (company) => asJson({ columns: company.columns, customFields: company.details?.customFields ?? [] })

const isList = Array.isArray

// What the dashboard holds must be usable as it is: nothing is filled in or
// guessed. Returns what is wrong, or null.
function problemWith(sharedRow, companyRows) {
  const body = sharedRow?.body
  if (!body || !isList(body.identityFields) || !isList(body.globalColumns)) return 'the shared setup has no identity fields or no Global columns'
  if (body.idFieldKey !== null && body.idFieldKey !== undefined && typeof body.idFieldKey !== 'string') return 'the ID field is not readable'
  if (!companyRows.some((row) => row.selected)) return 'the company selected in the dashboard is not in it'
  for (const row of companyRows) {
    if (typeof row.brn !== 'string' || !row.body || !isList(row.body.columns)) return `the columns of ${row.name ?? 'a company'} are not readable`
    if (row.body.customFields !== undefined && !isList(row.body.customFields)) return `the details of ${row.name ?? 'a company'} are not readable`
  }
  return null
}

// ---------- what is held ----------

let company = null // the selected company: { brn, label, role }
let shared = null // { id, name, revision, saved, canChange, companies, adminOf }
const held = new Map() // app company id -> { brn, name, address, role, selected, revision, saved }
let current = null // the app's state, as last handed in
let timer = null
let retryTimer = null
let saving = false
let again = false
let problem = null

let status = { state: 'saved', problem: null }
const listeners = new Set()
const reloadListeners = new Set()

function publish() {
  status = { state: problem ? 'not-saved' : timer || saving ? 'saving' : 'saved', problem }
  for (const listener of [...listeners]) listener()
}

export const setupStatus = {
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  get: () => status,
}

// Which dashboard company an app company is (its BRN), and what is known of
// each company held: for the months (dashboardMonths.js).
export const brnOf = (appCompanyId) => held.get(appCompanyId)?.brn ?? null
export const heldCompanies = () => [...held.values()].map(({ brn, name, role, selected }) => ({ brn, name, role, selected }))
// The setup revisions a company's months are saved with, as last confirmed by the dashboard.
export function revisionsOf(brn) {
  const item = [...held.values()].find((h) => normaliseBrn(h.brn) === normaliseBrn(brn))
  return shared && item ? { shared: shared.revision, company: item.revision } : null
}
// The columns a company's figures are worked out with in the dashboard: the
// Global columns and its own, as held on screen. Null when it is not held.
export function dashboardColumnsOf(brn) {
  if (!current) return null
  const app = current.companies.find((c) => normaliseBrn(held.get(c.id)?.brn) === normaliseBrn(brn))
  return app ? [...current.globalColumns, ...(app.columns ?? [])] : null
}

// Whether a key belongs to the shared setup (an identity field or a Global
// column) as the dashboard last confirmed it: then a change of it reaches
// every company using the shared setup.
export function sharedHasKey(key) {
  const body = shared?.saved
  return Boolean(body) && [...(body.identityFields ?? []), ...(body.globalColumns ?? [])].some((item) => item?.key === key)
}

// Called, with what connectDashboard answered, after the setup on screen has
// been replaced by the dashboard's ("Use the dashboard's version", a company's
// setup just started): the app starts again from it.
export function onSetupReplaced(listener) {
  reloadListeners.add(listener)
  return () => reloadListeners.delete(listener)
}
const replaced = (result) => {
  for (const listener of [...reloadListeners]) listener(result)
}

export const dashboardCompany = () => company
// What the screens need to know about the shared setup: whether it can be changed here, and why not.
export const sharedAccess = () =>
  shared ? { canChange: shared.canChange, companies: shared.companies, adminOf: shared.adminOf, revision: shared.revision } : null
// The revisions of what is on screen, as last confirmed by the dashboard: what a
// month will record it was saved with (Phase 3).
export function setupRevisions() {
  const selected = [...held.values()].find((h) => h.selected)
  return shared && selected ? { shared: shared.revision, company: selected.revision } : null
}

function reset() {
  clearTimeout(timer)
  clearTimeout(retryTimer)
  timer = null
  retryTimer = null
  again = false
  problem = null
  company = null
  shared = null
  held.clear()
  current = null
}

function assemble(companyRows, sharedBody) {
  const prefs = readPrefs()
  const { year, month } = getCurrentPeriod()
  const companies = companyRows.map((row) => {
    const own = prefs[normaliseBrn(row.brn)] ?? {}
    return {
      id: periodIdFor(row.brn),
      name: row.name,
      columns: row.body.columns,
      columnWidths: own.columnWidths && typeof own.columnWidths === 'object' ? own.columnWidths : {},
      viewYear: Number.isInteger(own.viewYear) ? own.viewYear : year,
      viewMonth: Number.isInteger(own.viewMonth) ? own.viewMonth : month,
      details: { address: row.address ?? '', brn: row.brn, customFields: row.body.customFields ?? [] },
    }
  })
  const selected = companies[companyRows.findIndex((row) => row.selected)]
  return {
    identityFields: sharedBody.identityFields,
    idFieldKey: sharedBody.idFieldKey ?? null,
    globalColumns: sharedBody.globalColumns,
    companies,
    activeCompanyId: selected.id,
  }
}

// ---------- loading ----------

// Loads the setup of the company selected in the dashboard. Whatever was held
// before is dropped, so only call it at the start or when the user asks.
//   { ok: true, company, empty: false }   loaded; the store can be used
//   { ok: true, company, empty: true }    this company has no setup in the dashboard yet
//   { ok: false, code, error }            not loaded
export async function connectDashboard() {
  const answer = await askHub({ action: 'load' })
  if (!answer.ok) return answer
  reset()
  company = answer.meta
  if (answer.rows.length === 0) {
    publish()
    return { ok: true, company, empty: true }
  }
  const sharedRow = answer.rows.find((row) => row.kind === 'shared')
  const companyRows = answer.rows.filter((row) => row.kind === 'company')
  const wrong = problemWith(sharedRow, companyRows)
  if (wrong) {
    company = null
    return fail('invalid', `The column setup in the dashboard could not be read: ${wrong}. Nothing was changed.`)
  }

  shared = {
    id: sharedRow.shared_setup_id,
    name: sharedRow.name,
    revision: sharedRow.revision,
    saved: asJson(sharedRow.body),
    canChange: sharedRow.can_change === true,
    companies: sharedRow.companies,
    adminOf: sharedRow.admin_of,
  }
  current = assemble(companyRows, sharedRow.body)
  companyRows.forEach((row, i) => {
    held.set(current.companies[i].id, {
      brn: row.brn,
      name: row.name,
      address: row.address,
      role: row.role,
      selected: row.selected === true,
      revision: row.revision,
      saved: companyBodyOf(current.companies[i]),
    })
  })
  publish()
  await connectMonths()
  return { ok: true, company, empty: false }
}

// ---------- saving ----------

// What differs between the screen and what the dashboard last confirmed.
function pendingChanges() {
  if (!current || !shared) return null
  const sharedBody = sharedBodyOf(current)
  const sharedChanged = !sameJson(sharedBody, shared.saved)
  const companies = []
  for (const app of current.companies) {
    const item = held.get(app.id)
    if (!item) continue
    const body = companyBodyOf(app)
    if (!sameJson(body, item.saved)) companies.push({ item, body })
  }
  return sharedChanged || companies.length > 0 ? { sharedChanged, sharedBody, companies } : null
}

function schedule() {
  clearTimeout(timer)
  timer = null
  if (pendingChanges()) {
    timer = setTimeout(() => {
      timer = null
      void saveNow()
    }, SAVE_AFTER_MS)
  } else if (!saving && problem && problem.code !== 'stale') {
    // Changed back to what the dashboard holds: nothing is left unsaved.
    problem = null
  }
  publish()
}

function scheduleRetry() {
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    retryTimer = null
    if (problem && (problem.code === 'unavailable' || problem.code === 'no-answer')) void saveNow()
  }, RETRY_AFTER_MS)
}

async function saveNow() {
  clearTimeout(timer)
  timer = null
  if (saving) {
    again = true
    return
  }
  const changes = pendingChanges()
  if (!changes) {
    // A change of key and its undoing before either was saved: nothing to move.
    const moves = pendingKeyMoves()
    if (moves.length > 0) await keyChangeSaved([], moves)
    problem = null
    publish()
    return
  }
  saving = true
  publish()
  const outcome = await saveOnce(changes)
  saving = false
  problem = outcome.ok ? null : outcome
  const more = again || pendingChanges() !== null
  again = false
  if (outcome.ok && more) schedule()
  if (!outcome.ok && (outcome.code === 'unavailable' || outcome.code === 'no-answer')) scheduleRetry()
  publish()
}

const confirmShared = (body, revision) => {
  shared.saved = body
  shared.revision = revision
}
const confirmCompany = (item, body, revision) => {
  item.saved = body
  item.revision = revision
}

async function saveOnce(changes) {
  if (!company || !shared) return fail('unavailable', 'The dashboard is not connected.')
  const moves = pendingKeyMoves()
  if (moves.length > 0) return saveKeyChange(changes, moves)
  if (changes.sharedChanged) {
    if (!shared.canChange) {
      return fail('forbidden', 'Only someone who is an admin of every company using these Global columns can change them.')
    }
    const sent = await sendHub({
      action: 'save-shared',
      brn: company.brn,
      shared_setup_id: shared.id,
      name: shared.name,
      body: changes.sharedBody,
      expected_revision: shared.revision,
      companies: changes.companies.map(({ item, body }) => ({ company_brn: item.brn, body, expected_revision: item.revision })),
    })
    if (sent.ok) {
      confirmShared(changes.sharedBody, sent.result.revision)
      for (const saved of sent.result.companies ?? []) {
        const change = changes.companies.find(({ item }) => normaliseBrn(item.brn) === normaliseBrn(saved.brn))
        if (change) confirmCompany(change.item, change.body, saved.revision)
      }
      return { ok: true }
    }
    return uncertain(sent) ? settle(sent, changes) : sent
  }

  for (const change of changes.companies) {
    if (change.item.role !== 'admin') return fail('forbidden', `Only an admin of ${change.item.name} can change its columns.`)
    const sent = await sendHub({
      action: 'save-company',
      brn: company.brn,
      company_brn: change.item.brn,
      body: change.body,
      expected_revision: change.item.revision,
    })
    if (sent.ok) {
      confirmCompany(change.item, change.body, sent.result.revision)
      continue
    }
    const settled = uncertain(sent) ? await settle(sent, { sharedChanged: false, companies: [change] }) : sent
    if (!settled.ok) return settled
  }
  return { ok: true }
}

// A change of key: the setup that carries it, and the values moved in every
// month it reaches, in one step (the dashboard's `key-change`), all or nothing.
// Through the shared setup when a Global column or an identity field changed,
// or when more than one company's columns change with it.
async function saveKeyChange(changes, moves) {
  const viaShared = changes.sharedChanged || changes.companies.length !== 1 || moves.some((m) => m.company_brn === null)
  const row = { action: 'key-change', brn: company.brn, moves }
  if (viaShared) {
    if (!shared.canChange) {
      return fail('forbidden', 'Only someone who is an admin of every company using these Global columns can change them.')
    }
    row.shared = {
      shared_setup_id: shared.id,
      name: shared.name,
      body: changes.sharedBody,
      expected_revision: shared.revision,
      ...(changes.companies.length > 0
        ? { companies: changes.companies.map(({ item, body }) => ({ company_brn: item.brn, body, expected_revision: item.revision })) }
        : {}),
    }
  } else {
    const [{ item, body }] = changes.companies
    if (item.role !== 'admin') return fail('forbidden', `Only an admin of ${item.name} can change its columns.`)
    row.company = { company_brn: item.brn, body, expected_revision: item.revision }
  }

  const sent = await sendHub(row, { dataType: MONTH })
  if (sent.ok) {
    const setup = sent.result.setup ?? {}
    if (viaShared) {
      confirmShared(changes.sharedBody, setup.revision)
      for (const saved of setup.companies ?? []) {
        const change = changes.companies.find(({ item }) => normaliseBrn(item.brn) === normaliseBrn(saved.brn))
        if (change) confirmCompany(change.item, change.body, saved.revision)
      }
    } else {
      confirmCompany(changes.companies[0].item, changes.companies[0].body, setup.revision)
    }
    await keyChangeSaved(sent.result.months ?? [], moves)
    return { ok: true }
  }
  // Refused because the dashboard is locked: it goes again once it is unlocked (onGateOpen).
  if (sent.code === 'locked') gateChanged(false)
  if (!uncertain(sent)) return sent
  // It may have been stored: the setup says so. Then the months were moved too (one step).
  const settled = await settle(sent, viaShared ? changes : { sharedChanged: false, companies: changes.companies })
  if (settled.ok) await keyChangeSaved(null, moves)
  return settled
}

// No clear answer, or "someone saved since": it may be this very save that was
// stored. Look at what the dashboard holds before deciding.
async function settle(sent, changes) {
  const now = await askHub({ action: 'load', brn: company.brn })
  if (!now.ok) return sent
  const sharedRow = now.rows.find((row) => row.kind === 'shared')
  if (!sharedRow) return sent
  const rowOf = (item) => now.rows.find((row) => row.kind === 'company' && normaliseBrn(row.brn) === normaliseBrn(item.brn))

  const stored =
    (!changes.sharedChanged || (sharedRow.revision > shared.revision && sameJson(sharedRow.body, changes.sharedBody))) &&
    changes.companies.every(({ item, body }) => {
      const row = rowOf(item)
      return row && row.revision > item.revision && sameJson(row.body, body)
    })
  if (stored) {
    if (changes.sharedChanged) confirmShared(changes.sharedBody, sharedRow.revision)
    for (const { item, body } of changes.companies) confirmCompany(item, body, rowOf(item).revision)
    return { ok: true }
  }
  const untouched =
    (!changes.sharedChanged || sharedRow.revision === shared.revision) &&
    changes.companies.every(({ item }) => rowOf(item)?.revision === item.revision)
  // Nothing changed there: this save simply did not arrive.
  if (untouched && sent.code !== 'stale') return sent
  return STALE
}

// ---------- what the status bar offers ----------

// "Try saving again": what is not saved yet, now.
export async function retrySaving() {
  problem = null
  publish()
  await saveNow()
}

// After "someone else changed it": keep what is on this screen, and save it
// as the newest revision, over theirs.
export async function keepMine() {
  if (!company || !shared) return
  const now = await askHub({ action: 'load', brn: company.brn })
  if (!now.ok) {
    problem = now
    publish()
    return
  }
  const sharedRow = now.rows.find((row) => row.kind === 'shared')
  if (sharedRow?.shared_setup_id === shared.id) {
    shared.revision = sharedRow.revision
    shared.saved = asJson(sharedRow.body)
    shared.canChange = sharedRow.can_change === true
  }
  for (const item of held.values()) {
    const row = now.rows.find((r) => r.kind === 'company' && normaliseBrn(r.brn) === normaliseBrn(item.brn))
    if (row) {
      item.revision = row.revision
      item.saved = asJson(row.body)
    }
  }
  problem = null
  await saveNow()
}

// Drop what is on this screen and take what the dashboard holds now, for the
// company selected there now.
export async function takeTheirs() {
  // A change of key that was waiting goes with the rest of what is on this screen.
  dropKeyChanges()
  const result = await connectDashboard()
  if (!result.ok) {
    problem = result
    publish()
    return result
  }
  replaced(result)
  return result
}

// ---------- starting a company's setup in the dashboard ----------

// For a dashboard company with no setup yet: the shared setups it could use,
// named by the companies already using them.
export async function startOptions() {
  const answer = await askHub({ action: 'companies' })
  if (!answer.ok) return answer
  const bySetup = new Map()
  for (const row of answer.rows) {
    if (!row.shared_setup_id) continue
    bySetup.set(row.shared_setup_id, [...(bySetup.get(row.shared_setup_id) ?? []), row.name])
  }
  return { ok: true, options: [...bySetup].map(([sharedSetupId, companies]) => ({ sharedSetupId, companies })) }
}

const emptyCompanyBody = () => ({ columns: [], customFields: [] })

// Attaches the selected company to a shared setup, with no columns of its own
// yet; or, with no shared setup given, to a new one holding `newShared`.
export async function startSetup({ sharedSetupId = null, newShared = null }) {
  const meta = company
  if (!meta) return fail('unavailable', 'The dashboard is not connected.')
  let setupId = sharedSetupId
  if (!setupId) {
    setupId = crypto.randomUUID()
    const created = await sendHub({
      action: 'save-shared',
      brn: meta.brn,
      shared_setup_id: setupId,
      name: 'Shared column setup',
      body: newShared,
      expected_revision: 0,
    })
    if (!created.ok && !uncertain(created)) return created
  }
  const attached = await sendHub({ action: 'attach-company', brn: meta.brn, shared_setup_id: setupId, body: emptyCompanyBody() })
  // Whatever the answer, what counts is what the dashboard now holds.
  const result = await connectDashboard()
  if (!result.ok) return result
  if (result.empty) return attached.ok ? fail('unavailable', 'The dashboard did not keep it. Try again.') : attached
  replaced(result)
  return result
}

// ---------- the store the screens use ----------

function keepPrefs(state) {
  const before = readPrefs()
  const prefs = { ...before }
  for (const app of state.companies ?? []) {
    const item = held.get(app.id)
    if (!item) continue
    prefs[normaliseBrn(item.brn)] = { columnWidths: app.columnWidths ?? {}, viewYear: app.viewYear, viewMonth: app.viewMonth }
  }
  // A display preference: if the browser has no room for it, it is simply not remembered.
  if (JSON.stringify(prefs) !== JSON.stringify(before)) writePrefs(prefs)
}

// The months: in the dashboard when it keeps them (dashboardMonths.js), in this browser otherwise.
const months = (name) => (...args) => (monthsSupported() ? monthOperations : browserStore)[name](...args)

export const dashboardStore = {
  loadState: () => (current ? structuredClone(current) : null),
  saveState(state) {
    if (!shared) return false
    current = structuredClone(state)
    keepPrefs(current)
    schedule()
    // Held in memory and on its way: the bar says whether it reached the dashboard.
    return true
  },
  loadPeriod: months('loadPeriod'),
  savePeriod: months('savePeriod'),
  periodHasEmployees: months('periodHasEmployees'),
  deletePeriodsForCompany: months('deletePeriodsForCompany'),
  countPeriodsHoldingKey: months('countPeriodsHoldingKey'),
  renameValueKeyInPeriods: months('renameValueKeyInPeriods'),
}

// A save refused because the dashboard was locked goes again once it is open.
onGateOpen(() => {
  if (problem?.code === 'locked') void retrySaving()
})

// For tests: forget everything held, as a page reload does.
export function forgetDashboardSetup() {
  reset()
  publish()
}
