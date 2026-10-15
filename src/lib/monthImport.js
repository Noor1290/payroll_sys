// "Import months to the dashboard": once, started by the user, after a backup
// file has been downloaded. The months of this browser's companies go to the
// dashboard companies they were linked to by the column setup's import
// (dashboardImport.js, Phase 2). A company that was not linked is listed and
// left alone: its column setup has to be imported first.
//
//   1. Plan (reads only, writes nothing): every month of every linked company
//      in this browser, whether the dashboard has that month already, and
//      whether its figures would be the same with the dashboard's columns. A
//      month whose figures would not be the same is not offered: importing it
//      would change the payroll.
//   2. Import, one month at a time, each all or nothing.
//   3. Check: each month is read back from the dashboard; the employees must be
//      exactly this browser's, and every calculated figure, worked out with the
//      dashboard's columns, the same as this browser's figures worked out with
//      this browser's columns. Only then is it noted as imported.
//
// This browser's own months are never changed: they stay, the copy used when
// the app is opened on its own ("This browser only. Not the dashboard's copy.").
// What is noted in this browser: which month went where, its revision and when.
// No employee, no figure.

import * as browserStore from './storage'
import { askHub, asJson, MONTH, normaliseBrn, sameJson, sendHub } from './hubWire'
import { formatPeriodLabel, parsePeriodKey } from './periods'
import { computeGridForEmployees } from './formulaEngine'
import { getColumnsByKey, getEffectiveColumns } from './model'
import { dashboardColumnsOf, dashboardCompany, heldCompanies, readImported, revisionsOf, setupStatus, writeImported } from './dashboardSetup'
import { gateState, listMonths, monthsSupported } from './dashboardMonths'

const fail = (code, error) => ({ ok: false, code, error })
const uncertain = (failure) => failure.code === 'unavailable' || failure.code === 'no-answer' || failure.code === 'stale'
const label = (period) => {
  const { year, month } = parsePeriodKey(period)
  return formatPeriodLabel(year, month)
}

// What is noted about the months imported from this browser:
// { [browser company id]: { [period]: { brn, revision, importedAt } } }
const monthNotes = () => {
  const notes = readImported().months
  return notes && typeof notes === 'object' ? notes : {}
}

function browserMonths(companyId) {
  return browserStore.listPeriods(companyId).map((period) => {
    const { year, month } = parsePeriodKey(period)
    return { period, employees: browserStore.loadPeriod(companyId, year, month).employees }
  })
}

// Whether this browser holds months of linked companies that are not in the dashboard yet.
export function hasMonthsToImport() {
  if (!monthsSupported()) return false
  const linked = readImported().companies
  const done = monthNotes()
  return Object.keys(linked).some((companyId) =>
    browserStore.listPeriods(companyId).some((period) => {
      if (done[companyId]?.[period]) return false
      const { year, month } = parsePeriodKey(period)
      return browserStore.periodHasEmployees(companyId, year, month)
    })
  )
}

// Every figure of every employee, with these columns. An error counts as itself.
function figures(employees, columns) {
  const grid = computeGridForEmployees(employees, columns, getColumnsByKey(columns))
  const out = {}
  for (const employee of employees) {
    for (const column of columns) {
      if (column.type !== 'formula') continue
      const cell = grid[employee.id]?.[column.key]
      out[`${employee.id}|${column.key}`] = { value: cell?.value, error: cell?.trace?.error ?? null, name: column.name }
    }
  }
  return out
}

const sameFigure = (a, b) => Boolean(a) && Boolean(b) && Object.is(a.value, b.value) && a.error === b.error

// The figures that differ between the browser's columns and the dashboard's,
// for the same employees: [{ employee, column }] (names only, never a figure).
function figureDifferences(employees, browserColumns, dashboardColumns) {
  const before = figures(employees, browserColumns)
  const after = figures(employees, dashboardColumns)
  const differences = []
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (sameFigure(before[key], after[key])) continue
    const [employeeId] = key.split('|')
    const index = employees.findIndex((e) => e.id === employeeId)
    differences.push({ employee: index + 1, column: (before[key] ?? after[key]).name })
  }
  return differences
}

// What the import would do. Reads only.
//   { ok: true, companies: [{ browserId, name, brn, dashboardName, reason, months }] }
//     reason   null when its months can be imported; otherwise why not
//     months   [{ period, label, employees, count, existing, differences, state }]
//              state: 'new' | 'conflict' | 'differs' | 'imported' | 'empty'
export async function planMonthImport() {
  if (!monthsSupported()) return fail('unavailable', 'This dashboard does not keep months yet.')
  if (!dashboardCompany()) return fail('unavailable', 'The dashboard is not connected.')
  if (gateState() === 'locked') return fail('locked', 'The dashboard is locked. Unlock it, then import.')
  if (setupStatus.get().state !== 'saved') {
    return fail('unavailable', 'The column setup has changes not saved in the dashboard yet. Wait until it says Saved, then import.')
  }
  const browser = browserStore.loadState()
  if (!browser || browser.companies.length === 0) return fail('not-found', 'This browser holds no companies.')

  const linked = readImported().companies
  const done = monthNotes()
  const held = heldCompanies()
  const companies = []
  for (const company of browser.companies) {
    const note = linked[company.id]
    const item = { browserId: company.id, name: company.name, brn: note?.brn ?? null, dashboardName: note?.company ?? null, reason: null, months: [] }
    companies.push(item)
    if (!note) {
      item.reason = 'Its column setup is not in the dashboard yet. Import it to the dashboard first ("Import to the dashboard").'
      continue
    }
    const there = held.find((c) => normaliseBrn(c.brn) === normaliseBrn(note.brn))
    if (!there) {
      item.reason = `${note.company ?? note.brn} does not use the same Global columns as the company selected in the dashboard. Select it there to import its months.`
      continue
    }
    if (there.role !== 'admin') {
      item.reason = `Only an admin of ${there.name} can import its months.`
      continue
    }
    const browserColumns = getEffectiveColumns(company, browser.globalColumns)
    const dashboardColumns = dashboardColumnsOf(note.brn)
    const list = await listMonths(note.brn)
    if (!list.ok) return list
    const existing = new Map(list.rows.map((row) => [row.period, row]))
    // What the dashboard holds of those months, to tell a month already there exactly as it is
    // here (an earlier import whose answer was lost) from one that differs.
    const theirs = await readMonths(note.brn, [...existing.keys()])
    if (!theirs.ok) return theirs
    for (const { period, employees } of browserMonths(company.id)) {
      const month = { period, label: label(period), employees, count: employees.length, existing: existing.get(period) ?? null, differences: [] }
      if (done[company.id]?.[period]) month.state = 'imported'
      else if (employees.length === 0) month.state = 'empty'
      else {
        month.differences = figureDifferences(employees, browserColumns, dashboardColumns)
        month.state = month.differences.length > 0 ? 'differs' : !month.existing ? 'new' : sameJson(theirs.months.get(period), employees) ? 'same' : 'conflict'
      }
      item.months.push(month)
    }
  }
  return { ok: true, companies }
}

// What the import does unless the user chooses otherwise: every new month; a
// month the dashboard already has is skipped until a choice is made.
//   { [browserId]: { [period]: 'import' | 'replace' | 'skip' } }
export function defaultMonthChoices(plan) {
  const choices = {}
  for (const company of plan.companies) {
    choices[company.browserId] = {}
    for (const month of company.months) {
      if (month.state === 'new') choices[company.browserId][month.period] = 'import'
      if (month.state === 'same') choices[company.browserId][month.period] = 'check'
      if (month.state === 'conflict') choices[company.browserId][month.period] = 'skip'
    }
  }
  return choices
}

export const chosenCount = (choices) =>
  Object.values(choices).reduce((n, months) => n + Object.values(months).filter((c) => c === 'import' || c === 'replace' || c === 'check').length, 0)

const selectedBrn = () => dashboardCompany()?.brn
const companyParam = (brn) => (normaliseBrn(brn) === normaliseBrn(selectedBrn()) ? {} : { company_brn: brn })

// The employees of these months as the dashboard holds them: { ok, months: Map(period -> employees) }.
async function readMonths(brn, periods) {
  const months = new Map()
  for (let i = 0; i < periods.length; i += 12) {
    const answer = await askHub({ action: 'load', brn: selectedBrn(), ...companyParam(brn), periods: periods.slice(i, i + 12) }, { dataType: MONTH })
    if (!answer.ok) return answer
    for (const row of answer.rows) months.set(row.period, row.employees)
  }
  return { ok: true, months }
}

// How long to wait before asking again when the dashboard did not answer, and how often.
export const READ_BACK = { attempts: 3, waitMs: 4000 }

// The month as the dashboard holds it now. A dashboard that did not answer is asked again a
// little later: a save it was slow to answer may well have been stored.
async function readBack(brn, period) {
  for (let attempt = 1; ; attempt++) {
    const answer = await askHub({ action: 'load', brn: selectedBrn(), ...companyParam(brn), periods: [period] }, { dataType: MONTH })
    if (answer.ok) return { ok: true, row: answer.rows.find((r) => r.period === period) ?? null }
    if (!uncertain(answer) || answer.code === 'stale' || attempt >= READ_BACK.attempts) return answer
    await new Promise((resolve) => setTimeout(resolve, READ_BACK.waitMs))
  }
}

// Imports what was chosen, one month at a time, and checks each.
//   [{ ok: true, name } | { ok: false, name, reason }]
export async function runMonthImport(plan, choices, onProgress = () => {}) {
  const browser = browserStore.loadState()
  const outcomes = []
  const say = (outcome) => {
    outcomes.push(outcome)
    onProgress(outcomes.length)
  }
  for (const company of plan.companies) {
    const browserCompany = browser?.companies.find((c) => c.id === company.browserId)
    for (const month of company.months) {
      const choice = choices[company.browserId]?.[month.period]
      if (choice !== 'import' && choice !== 'replace' && choice !== 'check') continue
      const name = `${company.dashboardName ?? company.name}, ${month.label}`
      const revisions = revisionsOf(company.brn)
      const dashboardColumns = dashboardColumnsOf(company.brn)
      if (!browserCompany || !revisions || !dashboardColumns) {
        say({ ok: false, name, reason: 'The dashboard is not connected to this company any more.' })
        continue
      }
      const employees = asJson(month.employees)
      // Already in the dashboard exactly as here: nothing is written, only checked.
      const sent = choice === 'check' ? { ok: true } : await sendHub(
        {
          action: 'save',
          brn: selectedBrn(),
          ...companyParam(company.brn),
          period: month.period,
          employees,
          expected_revision: choice === 'replace' ? month.existing.revision : 0,
          shared_revision: revisions.shared,
          company_revision: revisions.company,
          // What the dashboard had is kept in the month's history.
          ...(choice === 'replace' ? { keep_previous: true } : {}),
        },
        { dataType: MONTH }
      )
      if (!sent.ok && !uncertain(sent)) {
        say({ ok: false, name, reason: sent.error || 'The dashboard did not store it.' })
        continue
      }

      // The check: what the dashboard now holds, read back and compared.
      const back = await readBack(company.brn, month.period)
      if (!back.ok) {
        say({ ok: false, name, reason: back.error || 'It could not be read back from the dashboard.' })
        continue
      }
      if (!back.row) {
        say({ ok: false, name, reason: 'The dashboard did not store it.' })
        continue
      }
      if (!sameJson(back.row.employees, employees)) {
        say({ ok: false, name, reason: "What the dashboard holds is not the same as this browser's month. This browser's copy is still the one to use." })
        continue
      }
      const browserColumns = getEffectiveColumns(browserCompany, browser.globalColumns)
      const before = figures(employees, browserColumns)
      const after = figures(asJson(back.row.employees), dashboardColumns)
      const differ = Object.keys({ ...before, ...after }).filter((key) => !sameFigure(before[key], after[key]))
      if (differ.length > 0) {
        say({
          ok: false,
          name,
          reason: `${differ.length} calculated ${differ.length === 1 ? 'figure is' : 'figures are'} not the same in the dashboard. This browser's copy is still the one to use.`,
        })
        continue
      }
      say(note(company.browserId, month.period, company.brn, back.row.revision) ? { ok: true, name } : { ok: false, name, reason: "It is in the dashboard, but this browser's storage is full, so it could not be noted as imported here." })
    }
  }
  return outcomes
}

function note(browserId, period, brn, revision) {
  const notes = readImported()
  const months = monthNotes()
  notes.months = { ...months, [browserId]: { ...months[browserId], [period]: { brn, revision, importedAt: new Date().toISOString() } } }
  return writeImported(notes)
}
