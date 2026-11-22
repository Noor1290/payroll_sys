// The companies this app is used for: "company-list" (the dashboard's
// docs/INTEGRATION.md, "Company lists", migration 0024). Read only: the
// dashboard keeps the lists and shows its own picker. Payroll System has one
// list, "payroll". Names and BRNs only, no employee and no figure.
// A convenience only: a company that is not on the list still opens; nobody's
// access changes.

import { askHub, normaliseBrn } from './hubWire'

export const COMPANY_LIST = 'company-list'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const BAD_ANSWER = { ok: false, code: 'unavailable', error: "The dashboard's answer could not be read." }

// One row of `companies`, checked; null when it is not what the dashboard sends.
function readRow(row) {
  if (!row || typeof row !== 'object') return null
  const { company_id, brn, name, admin, selected, lists, open, open_period } = row
  if (typeof company_id !== 'string' || !UUID.test(company_id)) return null
  if (typeof brn !== 'string' || brn.length > 50 || typeof name !== 'string' || name.length > 120) return null
  if (typeof admin !== 'boolean' || typeof selected !== 'boolean' || !Array.isArray(lists) || lists.length > 1) return null
  if (lists.some((list) => list !== 'payroll')) return null
  if (open !== undefined && open !== true) return null
  if (open_period !== undefined && (typeof open_period !== 'string' || !MONTH.test(open_period))) return null
  return { company_id, brn, name, admin, selected, listed: lists.length === 1, open: open === true, openPeriod: open_period ?? null }
}

// Every company of the user, whether it is on the Payroll list, the selected one marked.
//   { ok: true, companies, selected, open: { period } | null }
//   { ok: false, legacy: true }            a dashboard from before the lists: the app works as it did
//   { ok: false, legacy: false, code, error }
export async function loadCompanyList() {
  const answer = await askHub({ action: 'companies' }, { dataType: COMPANY_LIST })
  if (!answer.ok) return { ...answer, legacy: answer.code === 'not-supported' }
  if (answer.rows.length > 500) return { ...BAD_ANSWER, legacy: false }
  const companies = answer.rows.map(readRow)
  if (companies.some((row) => row === null)) return { ...BAD_ANSWER, legacy: false }
  const selected = companies.filter((row) => row.selected)
  // The dashboard names the selected company in meta; it must be the one marked in the rows.
  if (selected.length !== 1 || normaliseBrn(selected[0].brn) !== normaliseBrn(answer.meta.brn)) return { ...BAD_ANSWER, legacy: false }
  const one = selected[0]
  return { ok: true, companies, selected: one, open: one.open ? { period: one.openPeriod } : null }
}

// Shows the dashboard's company picker. When a change is saved there, this app is reloaded.
//   { ok: true } | { ok: false, code, error }
export async function openPicker(selectedBrn) {
  const answer = await askHub({ action: 'open-picker', brn: selectedBrn }, { dataType: COMPANY_LIST })
  return answer.ok ? { ok: true } : answer
}

// Opens a company: the dashboard selects it (this app is then reloaded and goes
// straight to it, in `period`), or says it is selected already (`switched: false`),
// and the app opens it itself.
//   { ok: true, switched } | { ok: false, code, error }
export async function openCompany(selectedBrn, companyId, period) {
  const answer = await askHub({ action: 'open-company', brn: selectedBrn, company_id: companyId, period }, { dataType: COMPANY_LIST })
  if (!answer.ok) return answer
  const [row] = answer.rows
  if (answer.rows.length !== 1 || typeof row?.switched !== 'boolean') return BAD_ANSWER
  return { ok: true, switched: row.switched }
}
