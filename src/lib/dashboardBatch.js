// Several companies at once, inside the Payroll Hub dashboard (its
// docs/INTEGRATION.md, "payroll-batch"): what "Several companies…" asks for.
//
//   companies  the companies the user is an admin of, read from the dashboard's
//              database (no question asked: nothing per employee in it)
//   ask        ONE question in the dashboard, naming the month and every company;
//              agreeing allows the loads for 15 minutes, while the dashboard stays unlocked
//   load       one company: its month, exactly as saved, and its column setup
//
// Nothing here is written to this browser's storage.

import { askHub, normaliseBrn } from './hubWire'
import { dashboardCompany } from './dashboardSetup'
import { buildCompaniesWorkbook, companyForFile, fileNameFor, problemWithLoad } from './severalCompanies'

const fail = (code, error) => ({ ok: false, code, error })

export const BATCH = 'payroll-batch'
// The dashboard waits for its user to answer the question (and maybe to unlock first).
const ASK_WAIT_MS = 125_000
const LOAD_WAIT_MS = 30_000

const selectedBrn = () => dashboardCompany()?.brn

export function batchCompanies() {
  return askHub({ action: 'companies', brn: selectedBrn() }, { dataType: BATCH })
}

export function askForCompanies(period, brns) {
  return askHub({ action: 'ask', brn: selectedBrn(), period, companies: brns }, { dataType: BATCH, waitMs: ASK_WAIT_MS })
}

export function loadForExport(period, brn) {
  return askHub({ action: 'load', brn: selectedBrn(), period, company_brn: brn }, { dataType: BATCH, waitMs: LOAD_WAIT_MS })
}

// The export, start to end: the one question, then each company in turn, then
// the file. All or nothing: if one company cannot be read, no file is made.
//   chosen       [{ brn, name }], in the order shown
//   onProgress   ({ step: 'asking' }) | ({ step: 'reading', done, of, name }) | ({ step: 'writing' })
// { ok: true, buffer, fileName, companies, sheets } | { ok: false, code, error }
export async function exportCompanies(period, chosen, onProgress = () => {}) {
  onProgress({ step: 'asking' })
  const asked = await askForCompanies(
    period,
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
    const answer = await loadForExport(period, company.brn)
    if (!answer.ok) return { ...answer, error: `${company.name} could not be read: ${answer.error} Nothing was exported.` }
    const row = answer.rows[0]
    const wrong = row && normaliseBrn(row.brn) !== normaliseBrn(company.brn) ? 'it is about another company' : problemWithLoad(row)
    if (wrong) return fail('invalid', `The dashboard's answer for ${company.name} could not be read: ${wrong}. Nothing was exported.`)
    companies.push(companyForFile(row, period))
  }

  onProgress({ step: 'writing' })
  const { buffer, sheets } = await buildCompaniesWorkbook({ period, exportedAt: new Date(), companies })
  return { ok: true, buffer, fileName: fileNameFor(period, companies.length), companies, sheets }
}
