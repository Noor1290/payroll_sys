// "Copy this month to…": the month on screen copied into other months the user
// picks (one month, or a range of up to 24), with the identity fields and the
// input columns they tick. Never into an approved month; a month that is saved
// already is skipped unless the user chose to replace it (and confirmed).
//
// Inside the dashboard every target month is saved at once, all or nothing,
// through the dashboard's "payroll-import" save (migration 0019): a saved month
// becomes a normal new revision (History and Restore undo it), and the
// database itself refuses an approved month and a column setup or month that
// changed since the check. On its own (this browser), there is no History, so
// only months never saved are added; saved ones are always skipped.
//
// The current month is only read.

import { AUTO, copyFromPrevious } from './autoCopy'
import { askHub, sendHub } from './hubWire'
import { dashboardCompany } from './dashboardSetup'
import { confirmImport, IMPORT, keepPeople } from './dashboardBatch'
import { formatPeriodLabel, parsePeriodKey, periodKey, shiftPeriod } from './periods'
import { dataStore } from './dataStore'
import { monthsSavedElsewhere } from './dashboardMonths'

export const MAX_TARGET_MONTHS = 24
const CHECK_WAIT_MS = 30_000

const indexOf = ({ year, month }) => year * 12 + (month - 1)

// The target months, oldest first: `from` alone for one month, `from` to `to`
// for a range (either order). The current month is never one of them.
//   { ok: true, periods: ['2026-12', ...] } | { ok: false, problem }
export function targetPeriods(current, { from, to = from }) {
  const valid = (key) => typeof key === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(key)
  if (!valid(from) || !valid(to)) return { ok: false, problem: 'Choose a month.' }
  const a = parsePeriodKey(from)
  const b = parsePeriodKey(to)
  const [first, last] = indexOf(a) <= indexOf(b) ? [a, b] : [b, a]
  const count = indexOf(last) - indexOf(first) + 1
  if (count > MAX_TARGET_MONTHS) return { ok: false, problem: `Choose at most ${MAX_TARGET_MONTHS} months.` }
  const periods = []
  for (let p = first; indexOf(p) <= indexOf(last); p = shiftPeriod(p.year, p.month, 1)) {
    if (!(p.year === current.year && p.month === current.month)) periods.push(periodKey(p.year, p.month))
  }
  if (periods.length === 0) return { ok: false, problem: 'Choose a month other than this one.' }
  return { ok: true, periods }
}

export const labelOf = (period) => {
  const p = parsePeriodKey(period)
  return formatPeriodLabel(p.year, p.month)
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
export const months = (n) => plural(n, 'month')
export const joinLabels = (periods) => {
  const labels = periods.map(labelOf)
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

// The line shown once it is done. `total` is how many target months there were.
export function doneMessage({ added, replaced, failed }, total) {
  const copied = added.length + replaced.length
  const notCopied = total - copied - failed.length
  let text = `Copied to ${months(copied)}`
  if (notCopied > 0) text += `; ${notCopied} skipped`
  text += '.'
  if (failed.length > 0) text += ` ${joinLabels(failed)} could not be saved in this browser.`
  return text
}

// One target month's employees: each a new record, the identity fields and the
// chosen input columns; the current month's employees are never changed.
export function employeesFor({ employees, identityFields, columnKeys, effectiveColumns }) {
  return copyFromPrevious({ previousEmployees: employees, identityFields, setting: { mode: AUTO, columns: columnKeys }, effectiveColumns }).employees
}

// What will happen to each target month, from what the dashboard (or this
// browser) holds: 'add' | 'saved' | 'approved'.
//   [{ period, action, employeeCount?, revision }]
export function planTargets(periods, { saved = [], approved = [] }) {
  const savedBy = new Map(saved.map((m) => [m.period, m]))
  const approvedSet = new Set(approved)
  return periods.map((period) => {
    if (approvedSet.has(period)) return { period, action: 'approved', employeeCount: savedBy.get(period)?.employee_count ?? null, revision: savedBy.get(period)?.revision ?? 0 }
    const there = savedBy.get(period)
    if (there) return { period, action: 'saved', employeeCount: there.employee_count ?? null, revision: there.revision }
    return { period, action: 'add', revision: 0 }
  })
}

// The months that will be written, as chosen: added ones, and saved ones the
// user set to Replace. Never an approved one.
export function monthsToWrite(plan, replace) {
  return plan.filter((t) => t.action === 'add' || (t.action === 'saved' && replace.has(t.period)))
}

// ---------- inside the dashboard ----------

// Asks the dashboard what it holds for the target months of the company shown.
//   { ok: true, plan, expected } | { ok: false, code, error }
export async function checkTargets(periods) {
  const company = dashboardCompany()
  if (!company?.brn) return { ok: false, code: 'not-found', error: 'This company is not in the dashboard.' }
  const answer = await askHub(
    { action: 'check', brn: company.brn, from: periods[0], to: periods.at(-1), companies: [company.brn] },
    { dataType: IMPORT, waitMs: CHECK_WAIT_MS }
  )
  if (!answer.ok) return answer
  const row = answer.rows[0]
  if (!row || row.status !== 'admin') return { ok: false, code: 'forbidden', error: 'Only an admin of this company can do this.' }
  if (!row.setup) return { ok: false, code: 'not-found', error: 'This company has no column setup in the dashboard yet.' }
  const wanted = new Set(periods)
  return {
    ok: true,
    plan: planTargets(periods, { saved: (row.months ?? []).filter((m) => wanted.has(m.period)), approved: row.approved ?? [] }),
    expected: { shared_revision: row.setup.shared_revision, company_revision: row.setup.company_revision },
  }
}

// Saves every chosen month at once, all or nothing.
//   { ok: true, added: [period], replaced: [period] } | { ok: false, code, error }
export async function saveTargetsInDashboard({ plan, replace, expected, makeEmployees, idFieldKey }) {
  const company = dashboardCompany()
  const chosen = monthsToWrite(plan, replace)
  if (chosen.length === 0) return { ok: true, added: [], replaced: [] }
  const months = chosen.map((t) => ({ period: t.period, employees: makeEmployees(), expected_revision: t.revision, replace: t.action === 'saved' }))
  const kept = await keepPeople({ brn: company.brn, idFieldKey }, months)
  if (!kept.ok) return kept
  const row = { action: 'company', brn: company.brn, company_brn: company.brn, months: kept.months, expected }
  let sent = await sendHub(row, { dataType: IMPORT })
  if (!sent.ok && (sent.code === 'unavailable' || sent.code === 'no-answer') && (await confirmImport({ brn: company.brn }, kept.months))) {
    sent = { ok: true, result: {} }
  }
  if (!sent.ok) return sent
  // What this app held of those months is read again from the dashboard.
  await monthsSavedElsewhere(company.brn, kept.months.map((m) => m.period))
  return {
    ok: true,
    added: kept.months.filter((m) => !m.replace).map((m) => m.period),
    replaced: kept.months.filter((m) => m.replace).map((m) => m.period),
  }
}

// ---------- on its own, in this browser ----------

// Saved months (even empty, or unreadable) are always skipped here: there is no History to undo a replacement.
export function planTargetsInBrowser(companyId, periods) {
  return periods.map((period) => {
    const { year, month } = parsePeriodKey(period)
    return dataStore.periodIsSaved(companyId, year, month) ? { period, action: 'saved', employeeCount: null, revision: 0 } : { period, action: 'add', revision: 0 }
  })
}

//   { ok: true, added: [period], failed: [period] }
export function saveTargetsInBrowser(companyId, plan, makeEmployees) {
  const added = []
  const failed = []
  for (const target of plan.filter((t) => t.action === 'add')) {
    const { year, month } = parsePeriodKey(target.period)
    // Checked again just before writing: never over a month saved meanwhile.
    if (dataStore.periodIsSaved(companyId, year, month)) continue
    if (dataStore.savePeriod(companyId, year, month, { employees: makeEmployees() })) added.push(target.period)
    else failed.push(target.period)
  }
  return { ok: true, added, failed }
}
