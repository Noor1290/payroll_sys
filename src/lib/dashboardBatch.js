// Several companies at once, inside the Payroll Hub dashboard (its
// docs/INTEGRATION.md, "payroll-batch"): what "Several companies…" asks for.
//
//   companies  the companies the user is an admin of, read from the dashboard's
//              database (no question asked: nothing per employee in it)
//   ask        ONE question in the dashboard, naming the months (one month, or from
//              `from` to `to`) and every company; agreeing allows the loads for 15
//              minutes, while the dashboard stays unlocked
//   load       one company: its saved months of the range, exactly as saved, and its
//              column setup
//
// Nothing here is written to this browser's storage.

import { askHub, MONTH, normaliseBrn, sendHub } from './hubWire'
import { dashboardCompany } from './dashboardSetup'
import { buildCompaniesWorkbook, companyForFile, fileNameFor, problemWithLoad } from './severalCompanies'
import { isChosen, monthsToSend } from './severalImport'

const fail = (code, error) => ({ ok: false, code, error })

export const BATCH = 'payroll-batch'
// The dashboard waits for its user to answer the question (and maybe to unlock first).
const ASK_WAIT_MS = 125_000
const LOAD_WAIT_MS = 30_000

const selectedBrn = () => dashboardCompany()?.brn

export function batchCompanies() {
  return askHub({ action: 'companies', brn: selectedBrn() }, { dataType: BATCH })
}

export function askForCompanies({ from, to }, brns) {
  return askHub({ action: 'ask', brn: selectedBrn(), from, to, companies: brns }, { dataType: BATCH, waitMs: ASK_WAIT_MS })
}

export function loadForExport({ from, to }, brn) {
  return askHub({ action: 'load', brn: selectedBrn(), from, to, company_brn: brn }, { dataType: BATCH, waitMs: LOAD_WAIT_MS })
}

// The export, start to end: the one question, then each company in turn, then
// the file. All or nothing: if one company cannot be read, no file is made.
//   range        { from, to }: "YYYY-MM", the same month for one month
//   chosen       [{ brn, name }], in the order shown
//   onProgress   ({ step: 'asking' }) | ({ step: 'reading', done, of, name }) | ({ step: 'writing' })
// { ok: true, buffer, fileName, companies, sheets } | { ok: false, code, error }
export async function exportCompanies(range, chosen, onProgress = () => {}) {
  const { from, to } = range
  onProgress({ step: 'asking' })
  const asked = await askForCompanies(
    range,
    chosen.map((c) => c.brn)
  )
  if (!asked.ok) return asked
  const granted = new Set(asked.rows.map((row) => normaliseBrn(row.brn)))
  if (chosen.some((c) => !granted.has(normaliseBrn(c.brn)))) {
    return fail('forbidden', `The dashboard allowed ${granted.size} of the ${chosen.length} companies chosen. Nothing was exported.`)
  }

  const companies = []
  for (const [i, company] of chosen.entries()) {
    onProgress({ step: 'reading', done: i, of: chosen.length, name: company.name })
    const answer = await loadForExport(range, company.brn)
    if (!answer.ok) return { ...answer, error: `${company.name} could not be read: ${answer.error} Nothing was exported.` }
    const row = answer.rows[0]
    const wrong = row && normaliseBrn(row.brn) !== normaliseBrn(company.brn) ? 'it is about another company' : problemWithLoad(row, from, to)
    if (wrong) return fail('invalid', `The dashboard's answer for ${company.name} could not be read: ${wrong}. Nothing was exported.`)
    companies.push(companyForFile(row, from, to))
  }

  onProgress({ step: 'writing' })
  const { buffer, sheets } = await buildCompaniesWorkbook({ from, to, exportedAt: new Date(), companies })
  return { ok: true, buffer, fileName: fileNameFor(from, to, companies.length), companies, sheets }
}

// ---------- the import ("payroll-import") ----------
//
//   check      for each BRN of the file: admin (its setup, its saved months of the range and the
//              approved ones), only a member, or not in the dashboard. No question asked: the
//              preview the user confirms is the confirmation
//   company    ONE company of the file, all of it or nothing (the dashboard's migration 0019)
//   summary    the counts at the end, for the dashboard's one toast

export const IMPORT = 'payroll-import'
const IMPORT_WAIT_MS = 30_000
const uncertain = (failure) => failure.code === 'unavailable' || failure.code === 'no-answer'

export function checkCompanies(file) {
  const brns = [...new Set(file.companies.map((c) => c.brn).filter(Boolean))]
  if (brns.length === 0) return Promise.resolve({ ok: true, rows: [] })
  return askHub({ action: 'check', brn: selectedBrn(), from: file.from, to: file.to, companies: brns }, { dataType: IMPORT, waitMs: IMPORT_WAIT_MS })
}

// A month replaced keeps, for each person still in it (matched by the ID field), the place they
// had in the dashboard's month, so its History shows the same people changed, not new ones.
async function keepPeople(company, months) {
  const replaced = months.filter((m) => m.replace)
  if (replaced.length === 0 || !company.idFieldKey) return { ok: true, months }
  const answer = await askHub(
    { action: 'load', brn: selectedBrn(), company_brn: company.brn, periods: replaced.map((m) => m.period) },
    { dataType: MONTH }
  )
  if (!answer.ok) return answer
  const idOf = (e) => String(e.values?.[company.idFieldKey] ?? '').trim()
  return {
    ok: true,
    months: months.map((month) => {
      const saved = answer.rows.find((row) => row.period === month.period)
      if (!month.replace || !saved) return month
      const placeOf = new Map(saved.employees.filter((e) => idOf(e)).map((e) => [idOf(e), e.id]))
      return { ...month, employees: month.employees.map((e) => (placeOf.has(idOf(e)) ? { ...e, id: placeOf.get(idOf(e)) } : e)) }
    }),
  }
}

// No clear answer: whether the company's months are now as sent decides.
async function confirmImport(company, months) {
  const answer = await askHub(
    { action: 'check', brn: selectedBrn(), from: months[0].period, to: months.at(-1).period, companies: [company.brn] },
    { dataType: IMPORT, waitMs: IMPORT_WAIT_MS }
  )
  const row = answer.ok ? answer.rows[0] : null
  if (!row || row.status !== 'admin') return false
  const now = new Map((row.months ?? []).map((m) => [m.period, m]))
  return months.every((m) => now.has(m.period) && now.get(m.period).revision > m.expected_revision)
}

// The import, start to end, as chosen in the preview: one company at a time, each all or
// nothing; one that fails does not stop the others. Then the summary for the dashboard's toast.
//   onProgress   ({ done, of, name })
// Returns one outcome per company of the file:
//   { company, outcome: 'created' | 'imported' | 'nothing' | 'not-chosen' | 'not-added' | 'problem' | 'failed',
//     added: [period], replaced: [period], skipped: [{ period, why: 'saved' | 'approved' }], reason }
export async function importCompanies(plan, choices, onProgress = () => {}) {
  const outcomes = []
  const madeShared = new Set()
  const todo = plan.companies.filter((c) => isChosen(c, choices))
  let done = 0
  for (const company of plan.companies) {
    const skipped = company.months
      .filter((m) => m.action === 'approved' || (m.action === 'saved' && choices.replace[`${company.key}|${m.period}`] !== true))
      .map((m) => ({ period: m.period, why: m.action }))
    const base = { company, added: [], replaced: [], skipped, reason: null }
    if (company.status === 'problem') {
      outcomes.push({ ...base, outcome: 'problem', skipped: [], reason: company.problems.join(' ') })
      continue
    }
    if (company.status === 'new' && choices.add[company.key] !== true) {
      outcomes.push({ ...base, outcome: 'not-added', skipped: [] })
      continue
    }
    if (!isChosen(company, choices)) {
      outcomes.push({ ...base, outcome: 'not-chosen', skipped: [] })
      continue
    }
    onProgress({ done, of: todo.length, name: company.name })
    done += 1
    const months = monthsToSend(company, choices)
    if (months.length === 0) {
      outcomes.push({ ...base, outcome: 'nothing' })
      continue
    }
    const kept = await keepPeople(company, months)
    if (!kept.ok) {
      outcomes.push({ ...base, outcome: 'failed', reason: kept.error || 'The months saved in the dashboard could not be read.' })
      continue
    }
    const row = { action: 'company', brn: selectedBrn(), company_brn: company.brn, months: kept.months }
    if (company.status === 'new') row.new_company = { name: company.name.trim().slice(0, 200), address: company.address }
    if (company.setup) {
      // A new shared setup made by an earlier company of the file is joined, not made again.
      row.setup = company.setup.create && madeShared.has(company.setup.shared_setup_id)
        ? { shared_setup_id: company.setup.shared_setup_id, create: false, company_body: company.setup.company_body }
        : company.setup
    }
    if (company.expected) row.expected = company.expected
    let sent = await sendHub(row, { dataType: IMPORT })
    if (!sent.ok && uncertain(sent) && (await confirmImport(company, kept.months))) sent = { ok: true, result: { created: company.status === 'new', confirmed: true } }
    if (!sent.ok) {
      outcomes.push({ ...base, outcome: 'failed', reason: sent.error || 'The dashboard did not save it.' })
      continue
    }
    if (row.setup?.create) madeShared.add(row.setup.shared_setup_id)
    outcomes.push({
      ...base,
      outcome: company.status === 'new' ? 'created' : 'imported',
      added: kept.months.filter((m) => !m.replace).map((m) => m.period),
      replaced: kept.months.filter((m) => m.replace).map((m) => m.period),
    })
  }
  const count = (what) => outcomes.reduce((n, o) => n + o[what].length, 0)
  const summary = {
    action: 'summary',
    brn: selectedBrn(),
    created: outcomes.filter((o) => o.outcome === 'created').length,
    added: count('added'),
    replaced: count('replaced'),
    skipped: count('skipped'),
    failed: outcomes.filter((o) => o.outcome === 'failed').length,
  }
  // Only a toast in the dashboard: the outcomes above are what the user is shown here.
  await sendHub(summary, { dataType: IMPORT })
  return outcomes
}
