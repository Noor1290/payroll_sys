// The column setup's history inside the Payroll Hub dashboard: every saved
// revision of the shared setup (identity fields and Global columns) and of a
// company's own columns, kept by the dashboard (its migration 0013). Reading
// one changes nothing; restoring one is dashboardSetup.js's
// restoreSetupRevision, a new revision.
//
// Before a setup is restored, the months saved with a LATER revision of it are
// worked out again with the restored setup, and any whose figures would not be
// the same are named (by month and column, never a figure). That needs the
// months, so the dashboard's password gate must be open for it.

import { askHub, MONTH, normaliseBrn } from './hubWire'
import { formatPeriodLabel, parsePeriodKey } from './periods'
import { figureDifferences } from './monthImport'
import { columnPartsOf, dashboardCompany, heldCompanies, setupInUse } from './dashboardSetup'
import { gateState, monthsSupported } from './dashboardMonths'

const fail = (code, error) => ({ ok: false, code, error })
const LOAD_BATCH = 12
const selected = () => dashboardCompany()
const companyParam = (brn) => (normaliseBrn(brn) === normaliseBrn(selected()?.brn) ? {} : { company_brn: brn })

// Every kept revision of a setup, newest first, and which one is in use now.
//   target  'shared' | 'company' (the company selected in the dashboard)
//   { ok: true, revisions: [{ revision, saved_at, saved_by_you }], current }
export async function setupHistory(target) {
  const answer = await askHub({ action: 'history', target, brn: selected()?.brn })
  if (!answer.ok) return answer
  return { ok: true, revisions: answer.rows, current: setupInUse(target)?.revision ?? null }
}

// One kept revision of a setup, with its body.
//   { ok: true, revision: { revision, body, saved_at, saved_by_you } }
export async function setupRevision(target, revision, brn = selected()?.brn) {
  const answer = await askHub({ action: 'revision', target, revision, brn: selected()?.brn, ...companyParam(brn) })
  if (!answer.ok) return answer
  const row = answer.rows[0]
  if (!row || row.revision !== revision || !row.body || typeof row.body !== 'object') {
    return fail('unavailable', "The dashboard's answer could not be read.")
  }
  return { ok: true, revision: row }
}

const monthLabel = (period) => {
  const { year, month } = parsePeriodKey(period)
  return formatPeriodLabel(year, month)
}

// Which months saved with a later revision of this setup would be worked out
// differently once `body` (revision `revision`) is restored.
//   { ok: true, checked: false }                    the months are not kept in the dashboard
//   { ok: true, checked: true, later, months: [{ brn, company, period, label, figures, columns }] }
//       later   how many months were saved with a later revision
//       months  those whose figures would not be the same; `columns` names the columns
//   { ok: false, code, error }                      they could not be checked (locked, ...)
export async function monthsChangedByRestore(target, revision, body) {
  if (!monthsSupported()) return { ok: true, checked: false }
  if (gateState() === 'locked') return fail('locked', 'The dashboard is locked, so the months could not be checked.')
  const companies = heldCompanies().filter((c) => target === 'shared' || c.selected)

  // The setup each month was saved with: one read per revision, whatever the number of months.
  const bodies = new Map()
  async function bodyAt(kind, brn, rev) {
    const key = `${kind}|${kind === 'shared' ? '' : normaliseBrn(brn)}|${rev}`
    if (!bodies.has(key)) bodies.set(key, await setupRevision(kind, rev, brn))
    return bodies.get(key)
  }

  let later = 0
  const months = []
  for (const company of companies) {
    if (company.role !== 'admin') {
      return fail('forbidden', `Only an admin of ${company.name} can see its months, so they could not be checked.`)
    }
    const list = await askHub({ action: 'list', brn: selected().brn, ...companyParam(company.brn) }, { dataType: MONTH })
    if (!list.ok) return list
    const affected = list.rows.filter((row) => (target === 'shared' ? row.shared_revision : row.company_revision) > revision)
    later += affected.length
    const now = columnPartsOf(company.brn)
    if (!now) return fail('unavailable', `The columns of ${company.name} are not loaded.`)

    for (let i = 0; i < affected.length; i += LOAD_BATCH) {
      const periods = affected.slice(i, i + LOAD_BATCH).map((row) => row.period)
      const loaded = await askHub({ action: 'load', brn: selected().brn, ...companyParam(company.brn), periods }, { dataType: MONTH })
      if (!loaded.ok) return loaded
      for (const month of loaded.rows) {
        const sharedThen = await bodyAt('shared', company.brn, month.shared_revision)
        if (!sharedThen.ok) return sharedThen
        const companyThen = await bodyAt('company', company.brn, month.company_revision)
        if (!companyThen.ok) return companyThen
        const before = [...(sharedThen.revision.body.globalColumns ?? []), ...(companyThen.revision.body.columns ?? [])]
        const after =
          target === 'shared'
            ? [...(body.globalColumns ?? []), ...now.columns]
            : [...now.globalColumns, ...(body.columns ?? [])]
        const differences = figureDifferences(month.employees ?? [], before, after)
        if (differences.length === 0) continue
        months.push({
          brn: company.brn,
          company: company.name,
          period: month.period,
          label: monthLabel(month.period),
          figures: differences.length,
          columns: [...new Set(differences.map((d) => d.column))],
        })
      }
    }
  }
  return { ok: true, checked: true, later, months }
}
