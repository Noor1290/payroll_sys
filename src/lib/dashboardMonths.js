// The months inside the Payroll Hub dashboard (Phase 3): each company's
// employees and the values typed for them, kept in the dashboard's database,
// one month at a time (its migration 0014, data type "payroll-month").
//
// They hold national IDs and salaries, so the dashboard answers only an admin
// of the company, and only while its password gate is open: a month is read
// when it is opened, and saved a moment after typing stops (one save after the
// last change, never one per key, never two at once for the same month),
// without a question each time. While the gate is locked, nothing is read or
// sent: the month's table is covered (App.jsx), what was typed stays in memory
// only, the bar says NOT saved, and it is saved once the gate opens again. The
// dashboard tells this app when the gate opens or locks; the app can also ask
// the dashboard to show its password prompt ("Unlock the dashboard").
//
// Nothing of a month is ever written to this browser's storage: not what is
// saved, not what is waiting to be saved. This browser's own months (the copy
// used when the app is opened on its own) are never read or written here,
// except by the one-time import (monthImport.js), which only reads them.
//
// Each save names the revision of the month it replaces; if someone else saved
// it since, the save is refused and the bar offers "Save mine over it" or "Use
// the dashboard's version". Each save also says which column setup revisions
// it was worked out with (dashboardSetup.js).
//
// A change of a column's key is saved with the column setup (dashboardSetup.js)
// in one step that moves the values in every month the key reaches, in the
// dashboard. Until that step is stored, no month is saved.

import { asJson, askHub, MONTH, normaliseBrn, sameJson, sendHub } from './hubWire'
import { formatPeriodLabel, parsePeriodKey, periodKey } from './periods'
import { renameValueKey } from './dataStore'
import { brnOf, dashboardCompany, heldCompanies, revisionsOf, sharedHasKey, setupStatus } from './dashboardSetup'

const SAVE_AFTER_MS = 1000
const RETRY_AFTER_MS = 15_000
const WAIT_FOR_SETUP_MS = 500
// The dashboard waits up to 100 seconds for its user to type the password.
const UNLOCK_WAIT_MS = 110_000
// How many months one "load" may ask for (the dashboard's MONTHS_PER_LOAD).
const LOAD_BATCH = 12

const fail = (code, error) => ({ ok: false, code, error })
const uncertain = (failure) => failure.code === 'unavailable' || failure.code === 'no-answer' || failure.code === 'stale'
const LOCKED = fail('locked', 'The dashboard is locked.')
const nameOf = (brn) => heldCompanies().find((c) => normaliseBrn(c.brn) === normaliseBrn(brn))?.name ?? brn
const monthLabel = (period) => {
  const { year, month } = parsePeriodKey(period)
  return formatPeriodLabel(year, month)
}

// ---------- what is held ----------

let supported = false // the dashboard keeps months
let gate = 'unknown' // 'open' | 'locked' | 'unknown'
// BRN -> Map(period -> { revision, employee_count, value_keys }): what exists, without employees.
const lists = new Map()
// `${BRN}|${period}` -> { brn, period, revision, saved, current, timer, saving, again, problem, keepPrevious }
//   revision 0: the month does not exist in the dashboard yet
//   saved:      the employees as the dashboard last confirmed them
//   current:    the employees on screen
const months = new Map()
// Key changes waiting to be saved with the column setup: [{ old_key, new_key, company_brn }]
let pendingMoves = []
// Loads in flight, by month, and the loads waiting to be sent together.
const loading = new Map()
let waitingLoads = null
let retryTimer = null

let status = { state: 'saved', problem: null, gate: 'unknown', supported: false }
const listeners = new Set()
const changeListeners = new Set()
const gateOpenListeners = new Set()

const keyOf = (brn, period) => `${normaliseBrn(brn)}|${period}`
const pending = (entry) => !sameJson(entry.current, entry.saved)
const selectedBrn = () => dashboardCompany()?.brn ?? null
const isSelected = (brn) => normaliseBrn(brn) === normaliseBrn(selectedBrn())
const companyParam = (brn) => (isSelected(brn) ? {} : { company_brn: brn })
const adminOf = (brn) => heldCompanies().some((c) => normaliseBrn(c.brn) === normaliseBrn(brn) && c.role === 'admin')

function publish() {
  let problem = null
  let busy = false
  for (const entry of months.values()) {
    if (entry.problem && !problem) problem = { ...entry.problem, brn: entry.brn, period: entry.period }
    if (entry.timer || entry.saving) busy = true
  }
  if (!problem && pendingMoves.length === 0 && gate === 'locked' && [...months.values()].some(pending)) {
    problem = { ...LOCKED }
  }
  const waiting = pendingMoves.length > 0 && [...months.values()].some(pending)
  status = {
    state: problem ? 'not-saved' : busy || waiting ? 'saving' : 'saved',
    problem,
    gate,
    supported,
  }
  for (const listener of [...listeners]) listener()
}

export const monthStatus = {
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  get: () => status,
}

// Called with { reason, brn?, period? } when what the screen shows may have to
// be read again: 'gate-open' (the dashboard was unlocked), 'replaced' (a month
// was replaced by the dashboard's version), 'reset' (everything was dropped).
export function onMonthsChanged(listener) {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}
const changed = (event) => {
  for (const listener of [...changeListeners]) listener(event)
}

// For the column setup (dashboardSetup.js): a save it could not make while locked.
export function onGateOpen(listener) {
  gateOpenListeners.add(listener)
  return () => gateOpenListeners.delete(listener)
}

export const monthsSupported = () => supported
export const gateState = () => gate

// ---------- connecting ----------

// Asks whether the dashboard keeps months, and whether its gate is open; then
// lists the months of every company of the user's here that they administer.
//   { ok: true, supported }
export async function connectMonths() {
  // What was typed and is not saved yet is kept; everything else is read again.
  for (const [key, entry] of months) {
    if (!pending(entry) && !entry.problem && !entry.saving) {
      clearTimeout(entry.timer)
      months.delete(key)
    }
  }
  lists.clear()
  const answer = await askHub({ action: 'gate', brn: selectedBrn() }, { dataType: MONTH })
  if (!answer.ok) {
    // A dashboard that does not keep months yet: this browser keeps them, as before (Phase 2).
    supported = false
    publish()
    return { ok: true, supported: false }
  }
  supported = true
  gate = answer.rows[0]?.unlocked === true ? 'open' : 'locked'
  publish()
  if (gate === 'open') await refreshLists()
  return { ok: true, supported: true }
}

async function refreshLists() {
  for (const company of heldCompanies()) {
    if (company.role !== 'admin') continue
    const answer = await askHub({ action: 'list', brn: selectedBrn(), ...companyParam(company.brn) }, { dataType: MONTH })
    if (answer.ok) {
      lists.set(normaliseBrn(company.brn), new Map(answer.rows.map((row) => [row.period, row])))
    } else if (answer.code === 'locked') {
      noteGate(false)
      return
    }
  }
}

// The dashboard said its gate opened or locked (pushed to the app, or found out
// from a refusal).
export function gateChanged(unlocked) {
  if (!supported) return
  noteGate(unlocked)
}

function noteGate(unlocked) {
  const was = gate
  gate = unlocked ? 'open' : 'locked'
  if (unlocked && was !== 'open') {
    for (const entry of months.values()) {
      if (entry.problem?.code === 'locked') entry.problem = null
      if (pending(entry)) schedule(entry)
    }
    for (const listener of [...gateOpenListeners]) listener()
    void refreshLists()
    changed({ reason: 'gate-open' })
  }
  publish()
}

// "Unlock the dashboard": the dashboard shows its password prompt. Resolves
// to whether it is open now.
export async function askToUnlock() {
  const answer = await askHub({ action: 'unlock', brn: selectedBrn() }, { dataType: MONTH, waitMs: UNLOCK_WAIT_MS })
  if (answer.ok && answer.rows[0]?.unlocked === true) {
    noteGate(true)
    return true
  }
  return false
}

// ---------- reading ----------

// One month of one company. From memory when it is held; otherwise a promise,
// read from the dashboard (several months asked for at once go in one load).
//   { employees }            the month (empty when it does not exist yet)
//   { employees: [], blocked: { code, error } }   it could not be read; nothing to show
export function loadPeriod(companyId, year, month) {
  const brn = brnOf(companyId)
  const period = periodKey(year, month)
  if (!brn) return { employees: [], blocked: fail('not-found', 'This company is not in the dashboard.') }
  if (!adminOf(brn)) {
    return { employees: [], blocked: fail('forbidden', `Only an admin of ${nameOf(brn)} can see its employees' figures.`) }
  }
  const held = months.get(keyOf(brn, period))
  if (held) return { employees: structuredClone(held.current) }
  if (gate === 'locked') return { employees: [], blocked: { ...LOCKED } }
  return fetchMonth(brn, period)
}

function fetchMonth(brn, period) {
  const key = keyOf(brn, period)
  if (loading.has(key)) return loading.get(key)
  const promise = new Promise((resolve) => {
    if (!waitingLoads) {
      waitingLoads = new Map()
      queueMicrotask(sendLoads)
    }
    const forCompany = waitingLoads.get(normaliseBrn(brn)) ?? { brn, periods: new Map() }
    forCompany.periods.set(period, resolve)
    waitingLoads.set(normaliseBrn(brn), forCompany)
  }).finally(() => loading.delete(key))
  loading.set(key, promise)
  return promise
}

async function sendLoads() {
  const batches = [...waitingLoads.values()]
  waitingLoads = null
  for (const { brn, periods } of batches) {
    const all = [...periods.keys()]
    for (let i = 0; i < all.length; i += LOAD_BATCH) {
      const asked = all.slice(i, i + LOAD_BATCH)
      const answer = await askHub({ action: 'load', brn: selectedBrn(), ...companyParam(brn), periods: asked }, { dataType: MONTH })
      if (!answer.ok && answer.code === 'locked') noteGate(false)
      for (const period of asked) {
        const resolve = periods.get(period)
        if (!answer.ok) {
          resolve({ employees: [], blocked: answer })
          continue
        }
        const key = keyOf(brn, period)
        // Something may have been held meanwhile (typed into, then loaded again): keep it.
        let entry = months.get(key)
        if (!entry) {
          const row = answer.rows.find((r) => r.period === period)
          const employees = Array.isArray(row?.employees) ? asJson(row.employees) : []
          entry = { brn, period, revision: row?.revision ?? 0, saved: employees, current: structuredClone(employees), problem: null }
          months.set(key, entry)
        }
        resolve({ employees: structuredClone(entry.current) })
      }
    }
  }
  publish()
}

// Whether a month has anyone in it, without reading it: what "Copy from Previous Month" needs.
export function periodHasEmployees(companyId, year, month) {
  const brn = brnOf(companyId)
  if (!brn) return false
  const period = periodKey(year, month)
  const held = months.get(keyOf(brn, period))
  if (held) return held.current.length > 0
  return (lists.get(normaliseBrn(brn))?.get(period)?.employee_count ?? 0) > 0
}

// How many months, across these companies, hold a value under `key`: what a
// change of that key would move. `unknown` when some company's months could not
// be listed (the dashboard was locked when the app opened).
export function countPeriodsHoldingKey(companyIds, key) {
  let periods = 0
  let unknown = false
  const companies = new Set()
  for (const companyId of companyIds) {
    const brn = brnOf(companyId)
    if (!brn) continue
    const list = lists.get(normaliseBrn(brn))
    if (!list) unknown = true
    const seen = new Set([...(list?.keys() ?? [])])
    for (const entry of months.values()) if (normaliseBrn(entry.brn) === normaliseBrn(brn)) seen.add(entry.period)
    for (const period of seen) {
      const held = months.get(keyOf(brn, period))
      const holds = held
        ? held.current.some((e) => e.values && key in e.values)
        : (list?.get(period)?.value_keys ?? []).includes(key)
      if (holds) {
        periods++
        companies.add(normaliseBrn(brn))
      }
    }
  }
  return { periods, companies: companies.size, ...(unknown ? { unknown: true } : {}) }
}

// Every value saved under `key` in the months of the given companies, oldest first: what is checked
// before a field becomes a Date. Reads only; needs the gate open and an admin of each company. A
// month open on screen is read as it is on screen (what was typed, saved or on its way).
//   { ok: true, months: [{ companyId, period, values: [one per employee, in table order] }] }
//   { ok: false, code, error }
export async function readSavedValues(companyIds, key) {
  if (gate === 'locked') return fail('locked', 'The dashboard is locked, so the saved months could not be read.')
  const found = []
  for (const companyId of companyIds) {
    const brn = brnOf(companyId)
    if (!brn) continue
    if (!adminOf(brn)) return fail('forbidden', `Only an admin of ${nameOf(brn)} can see its months, so they could not be read.`)
    const list = await askHub({ action: 'list', brn: selectedBrn(), ...companyParam(brn) }, { dataType: MONTH })
    if (!list.ok) {
      if (list.code === 'locked') noteGate(false)
      return list
    }
    lists.set(normaliseBrn(brn), new Map(list.rows.map((row) => [row.period, row])))
    const held = (period) => months.get(keyOf(brn, period))
    const holding = list.rows.filter((row) => (row.value_keys ?? []).includes(key)).map((row) => row.period)

    const loaded = new Map()
    const toLoad = holding.filter((period) => !held(period))
    for (let i = 0; i < toLoad.length; i += LOAD_BATCH) {
      const answer = await askHub({ action: 'load', brn: selectedBrn(), ...companyParam(brn), periods: toLoad.slice(i, i + LOAD_BATCH) }, { dataType: MONTH })
      if (!answer.ok) {
        if (answer.code === 'locked') noteGate(false)
        return answer
      }
      for (const row of answer.rows) loaded.set(row.period, row.employees ?? [])
    }

    const onScreen = [...months.values()].filter((entry) => normaliseBrn(entry.brn) === normaliseBrn(brn)).map((entry) => entry.period)
    for (const period of [...new Set([...holding, ...onScreen])].sort()) {
      const employees = held(period)?.current ?? loaded.get(period) ?? []
      if (!employees.some((e) => e.values && key in e.values)) continue
      found.push({ companyId, period, values: employees.map((e) => e.values?.[key]) })
    }
  }
  return { ok: true, months: found }
}

// ---------- saving ----------

// The month on screen changed: held in memory, and on its way to the dashboard.
export function savePeriod(companyId, year, month, data) {
  const brn = brnOf(companyId)
  const entry = brn && months.get(keyOf(brn, periodKey(year, month)))
  // Only a month that was read can be saved: anything else would be saved blind over the dashboard's.
  if (!entry) return false
  const employees = asJson(data.employees)
  if (sameJson(employees, entry.current)) return true
  entry.current = employees
  schedule(entry)
  return true
}

function schedule(entry) {
  clearTimeout(entry.timer)
  entry.timer = null
  if (pending(entry)) {
    entry.timer = setTimeout(() => {
      entry.timer = null
      void saveMonth(entry)
    }, SAVE_AFTER_MS)
  } else if (!entry.saving && entry.problem && entry.problem.code !== 'stale') {
    // Changed back to what the dashboard holds: nothing is left unsaved.
    entry.problem = null
  }
  publish()
}

function scheduleRetry() {
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    retryTimer = null
    for (const entry of months.values()) {
      if (entry.problem && (entry.problem.code === 'unavailable' || entry.problem.code === 'no-answer')) void saveMonth(entry)
    }
  }, RETRY_AFTER_MS)
}

async function saveMonth(entry) {
  clearTimeout(entry.timer)
  entry.timer = null
  if (entry.saving) {
    entry.again = true
    return
  }
  if (!pending(entry)) {
    entry.problem = null
    publish()
    return
  }
  // A change of key is on its way with the column setup: the months wait for it (keyChangeSaved).
  if (pendingMoves.length > 0) return publish()
  // The column setup is being saved: wait for it, so the month records the revisions it was worked out with.
  if (setupStatus.get().state === 'saving') {
    entry.timer = setTimeout(() => {
      entry.timer = null
      void saveMonth(entry)
    }, WAIT_FOR_SETUP_MS)
    return publish()
  }
  if (gate === 'locked') {
    entry.problem = { ...LOCKED }
    return publish()
  }
  const revisions = revisionsOf(entry.brn)
  if (!revisions) {
    entry.problem = fail('unavailable', 'The column setup of this company is not loaded.')
    return publish()
  }

  const employees = asJson(entry.current)
  entry.saving = true
  publish()
  const sent = await sendHub(
    {
      action: 'save',
      brn: selectedBrn(),
      ...companyParam(entry.brn),
      period: entry.period,
      employees,
      expected_revision: entry.revision,
      shared_revision: revisions.shared,
      company_revision: revisions.company,
      ...(entry.keepPrevious ? { keep_previous: true } : {}),
    },
    { dataType: MONTH }
  )
  let outcome
  if (sent.ok) {
    confirm(entry, employees, sent.result.revision)
    outcome = { ok: true }
  } else {
    outcome = uncertain(sent) ? await settle(entry, sent, employees) : sent
  }
  if (!outcome.ok && outcome.code === 'locked') noteGate(false)
  entry.saving = false
  entry.problem = outcome.ok ? null : outcome
  const more = entry.again || pending(entry)
  entry.again = false
  if (outcome.ok && more) schedule(entry)
  if (!outcome.ok && (outcome.code === 'unavailable' || outcome.code === 'no-answer')) scheduleRetry()
  publish()
}

function confirm(entry, employees, revision) {
  entry.saved = employees
  entry.revision = revision
  entry.keepPrevious = false
  const list = lists.get(normaliseBrn(entry.brn))
  if (list) {
    const keys = [...new Set(employees.flatMap((e) => Object.keys(e.values ?? {})))].sort()
    list.set(entry.period, { ...list.get(entry.period), period: entry.period, revision, employee_count: employees.length, value_keys: keys })
  }
}

const staleFor = (entry) =>
  fail('stale', `Someone else saved ${monthLabel(entry.period)} of ${nameOf(entry.brn)} in the dashboard since it was opened here.`)

// The month as the dashboard holds it now: { ok, row } (row null = it does not exist).
async function readNow(entry) {
  const answer = await askHub({ action: 'load', brn: selectedBrn(), ...companyParam(entry.brn), periods: [entry.period] }, { dataType: MONTH })
  if (!answer.ok) return answer
  return { ok: true, row: answer.rows.find((r) => r.period === entry.period) ?? null }
}

// No clear answer, or "someone saved since": it may be this very save that
// was stored. Look at what the dashboard holds before deciding.
async function settle(entry, sent, employees) {
  const now = await readNow(entry)
  if (!now.ok) return sent
  const revision = now.row?.revision ?? 0
  if (revision > entry.revision && sameJson(now.row.employees, employees)) {
    confirm(entry, employees, revision)
    return { ok: true }
  }
  // Nothing changed there: this save simply did not arrive.
  if (revision === entry.revision && sent.code !== 'stale') return sent
  return staleFor(entry)
}

// ---------- what the status bar offers ----------

// "Try saving again": every month not saved yet, now.
export async function retryMonths() {
  const waiting = [...months.values()].filter((entry) => entry.problem || pending(entry))
  for (const entry of waiting) entry.problem = null
  publish()
  await Promise.all(waiting.map((entry) => saveMonth(entry)))
}

const staleEntry = () => [...months.values()].find((entry) => entry.problem?.code === 'stale')

// After "someone else saved this month": keep what is on this screen, and save
// it as the newest revision, over theirs. Theirs is kept in the month's history.
export async function keepMyMonth() {
  const entry = staleEntry()
  if (!entry) return
  const now = await readNow(entry)
  if (!now.ok) {
    entry.problem = now
    return publish()
  }
  entry.revision = now.row?.revision ?? 0
  entry.saved = now.row ? asJson(now.row.employees) : []
  entry.keepPrevious = true
  entry.problem = null
  await saveMonth(entry)
}

// Drop what is on this screen for that month and take what the dashboard holds now.
export async function takeTheirMonth() {
  const entry = staleEntry()
  if (!entry) return
  const now = await readNow(entry)
  if (!now.ok) {
    entry.problem = now
    return publish()
  }
  clearTimeout(entry.timer)
  entry.timer = null
  entry.revision = now.row?.revision ?? 0
  entry.saved = now.row ? asJson(now.row.employees) : []
  entry.current = structuredClone(entry.saved)
  entry.problem = null
  publish()
  changed({ reason: 'replaced', brn: entry.brn, period: entry.period })
}

// ---------- history and restore ----------

// The revision of a month this screen holds, and whether it has changes that
// are not saved yet. Null when the month is not held (not opened here).
export function monthInUse(brn, period) {
  const entry = months.get(keyOf(brn, period))
  if (!entry) return null
  return { revision: entry.revision, unsaved: pending(entry) || entry.saving || Boolean(entry.timer) || Boolean(entry.problem) }
}

// Every save of a month, newest first, without its content:
//   { ok: true, revisions: [{ revision, shared_revision, company_revision, employee_count, kept, saved_at, saved_by_you }] }
export async function monthHistory(brn, period) {
  const answer = await askHub({ action: 'history', brn: selectedBrn(), ...companyParam(brn), period }, { dataType: MONTH })
  if (!answer.ok && answer.code === 'locked') noteGate(false)
  return answer.ok ? { ok: true, revisions: answer.rows } : answer
}

// One revision of a month with its employees, as it was saved. Only for a
// revision whose content the dashboard kept, or the one in use now.
//   { ok: true, month: { revision, shared_revision, company_revision, employee_count, employees, saved_at, saved_by_you } }
export async function loadMonthRevision(brn, period, revision) {
  const answer = await askHub({ action: 'revision', brn: selectedBrn(), ...companyParam(brn), period, revision }, { dataType: MONTH })
  if (!answer.ok && answer.code === 'locked') noteGate(false)
  if (!answer.ok) return answer
  const row = answer.rows[0]
  if (!row || row.revision !== revision || !Array.isArray(row.employees)) {
    return fail('unavailable', "The dashboard's answer could not be read.")
  }
  return { ok: true, month: { ...row, employees: asJson(row.employees) } }
}

// "Restore this version": an earlier revision's employees are saved as a NEW
// revision of the month, over the one in use now, which the dashboard keeps.
// Nothing earlier is rewritten or deleted. The month must be open here, with
// nothing typed that is not saved yet. It is saved with the column setup in use
// now, as every save of the month is.
//   { ok: true, revision }   saved as that revision; the screen reads it again
export async function restoreMonth(brn, period, revision, employees) {
  const entry = months.get(keyOf(brn, period))
  if (!entry) return fail('not-found', 'Open this month first, then restore.')
  if (pending(entry) || entry.saving || entry.timer || entry.problem || pendingMoves.length > 0) {
    return fail('busy', 'What you typed in this month is not saved yet. Wait until the bar says Saved, then restore.')
  }
  if (gate === 'locked') return { ...LOCKED }
  const revisions = revisionsOf(brn)
  if (!revisions) return fail('unavailable', 'The column setup of this company is not loaded.')

  const restored = asJson(employees)
  entry.saving = true
  publish()
  const sent = await sendHub(
    {
      action: 'save',
      brn: selectedBrn(),
      ...companyParam(brn),
      period,
      employees: restored,
      expected_revision: entry.revision,
      shared_revision: revisions.shared,
      company_revision: revisions.company,
      keep_previous: true,
      restored_from: revision,
    },
    { dataType: MONTH }
  )
  let outcome
  if (sent.ok) {
    confirm(entry, restored, sent.result.revision)
    outcome = { ok: true }
  } else {
    outcome = uncertain(sent) ? await settle(entry, sent, restored) : sent
  }
  entry.saving = false
  if (!outcome.ok) {
    if (outcome.code === 'locked') noteGate(false)
    publish()
    return outcome
  }
  entry.current = structuredClone(restored)
  publish()
  changed({ reason: 'replaced', brn, period })
  return { ok: true, revision: entry.revision }
}

// ---------- a change of key ----------

// A column's (or an identity field's) key changed: its values move in every
// month the key reaches. On screen at once; in the dashboard together with the
// column setup that carries the new key (dashboardSetup.js), all or nothing.
export function renameValueKeyInPeriods(companyIds, oldKey, newKey) {
  const reach = companyIds.map(brnOf).filter(Boolean).map(normaliseBrn)
  // A Global column or an identity field reaches every company using the shared setup.
  const companyBrn = sharedHasKey(oldKey) ? null : (brnOf(companyIds[0]) ?? null)
  pendingMoves.push({ old_key: oldKey, new_key: newKey, company_brn: companyBrn })
  for (const entry of months.values()) {
    if (reach.includes(normaliseBrn(entry.brn))) entry.current = entry.current.map((e) => renameValueKey(e, oldKey, newKey))
  }
  publish()
  return true
}

export const pendingKeyMoves = () => pendingMoves.map((move) => ({ ...move }))

// The change of key was stored, with these months moved ([{ brn, period, revision }]),
// or with what they are not known (`null`, after an uncertain answer).
export async function keyChangeSaved(moved, moves) {
  pendingMoves = pendingMoves.slice(moves.length)
  const reaches = (move, brn) => move.company_brn === null || normaliseBrn(move.company_brn) === normaliseBrn(brn)
  for (const entry of months.values()) {
    let saved = entry.saved
    for (const move of moves) if (reaches(move, entry.brn)) saved = saved.map((e) => renameValueKey(e, move.old_key, move.new_key))
    entry.saved = asJson(saved)
    if (moved) {
      const revisions = moved.filter((m) => normaliseBrn(m.brn) === normaliseBrn(entry.brn) && m.period === entry.period)
      // Moved once per key it held. Any other number: someone else saved it meanwhile, and
      // its next save finds out.
      if (revisions.length > 0 && Math.max(...revisions.map((m) => m.revision)) === entry.revision + revisions.length) {
        entry.revision += revisions.length
      }
    } else {
      const now = await readNow(entry)
      if (now.ok && now.row && sameJson(now.row.employees, entry.saved)) entry.revision = now.row.revision
    }
  }
  for (const [brn, list] of lists) {
    for (const [period, info] of list) {
      let keys = info.value_keys ?? []
      for (const move of moves) {
        if (reaches(move, brn) && keys.includes(move.old_key)) keys = [...new Set(keys.map((k) => (k === move.old_key ? move.new_key : k)))].sort()
      }
      list.set(period, { ...info, value_keys: keys })
    }
  }
  for (const entry of months.values()) if (pending(entry)) schedule(entry)
  publish()
}

// The column setup on screen was replaced by the dashboard's: a key change that
// was waiting is dropped, and so are the months it had changed on screen.
export function dropKeyChanges() {
  if (pendingMoves.length === 0) return
  resetMonths()
  publish()
  changed({ reason: 'reset' })
}

// ---------- the store's month operations ----------

export const monthOperations = {
  loadPeriod,
  savePeriod,
  periodHasEmployees,
  countPeriodsHoldingKey,
  renameValueKeyInPeriods,
  readSavedValues,
  // A company is never deleted from inside the dashboard here.
  deletePeriodsForCompany: () => {},
}

function resetMonths() {
  for (const entry of months.values()) clearTimeout(entry.timer)
  clearTimeout(retryTimer)
  retryTimer = null
  months.clear()
  lists.clear()
  loading.clear()
  waitingLoads = null
  pendingMoves = []
}

// For tests: forget everything held, as a page reload does.
export function forgetDashboardMonths() {
  resetMonths()
  supported = false
  gate = 'unknown'
  publish()
}

// For the import (monthImport.js): what the dashboard has now for a company's months.
export async function listMonths(brn) {
  const answer = await askHub({ action: 'list', brn: selectedBrn(), ...companyParam(brn) }, { dataType: MONTH })
  if (answer.ok) lists.set(normaliseBrn(brn), new Map(answer.rows.map((row) => [row.period, row])))
  else if (answer.code === 'locked') noteGate(false)
  return answer
}
