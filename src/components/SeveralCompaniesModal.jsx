import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, Download, Files, LoaderCircle, LockKeyhole, TriangleAlert } from 'lucide-react'
import Modal from './Modal'
import { batchCompanies, exportCompanies } from '../lib/dashboardBatch'
import { askToUnlock } from '../lib/dashboardMonths'
import { downloadWorkbook } from '../lib/excelExport'
import { MAX_MONTHS, monthsBetween, rangeLabelOf } from '../lib/severalCompanies'

const isMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)

// "Several companies…", inside the dashboard: one month, or a range of months,
// of several companies in one Excel file (severalCompanies.js). The companies
// are the ones the user is an admin of, as the dashboard's database says; the
// dashboard asks once, naming the months and every company, before anything is
// read.
//   period   "YYYY-MM": the month offered first, as From and To (the one on screen)
export default function SeveralCompaniesModal({ period: firstPeriod, onClose }) {
  const [list, setList] = useState(null) // the dashboard's answer to `companies`
  const [from, setFrom] = useState(firstPeriod)
  const [to, setTo] = useState(firstPeriod)
  const [chosen, setChosen] = useState(() => new Set())
  const [progress, setProgress] = useState(null) // what exportCompanies is doing, while it runs
  const [result, setResult] = useState(null) // what exportCompanies answered
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    let live = true
    batchCompanies().then((answer) => {
      if (live) setList(answer)
    })
    return () => {
      live = false
    }
  }, [])

  const companies = list?.ok ? list.rows : []
  const count = chosen.size
  const working = progress !== null
  // What is wrong with the months chosen, or null.
  const rangeProblem =
    !isMonth(from) || !isMonth(to)
      ? 'Choose a month in "From" and in "To".'
      : to < from
        ? '"To" is before "From".'
        : monthsBetween(from, to).length > MAX_MONTHS
          ? `At most ${MAX_MONTHS} months at a time.`
          : null
  const single = from === to
  const monthLabel = rangeProblem ? null : rangeLabelOf(from, to)

  const toggle = (brn, on) =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (on) next.add(brn)
      else next.delete(brn)
      return next
    })

  async function handleExport() {
    setResult(null)
    const picked = companies.filter((c) => chosen.has(c.brn)).map(({ brn, name }) => ({ brn, name }))
    const answer = await exportCompanies({ from, to }, picked, setProgress)
    setProgress(null)
    setResult(answer)
    if (answer.ok) downloadWorkbook(answer.buffer, answer.fileName)
  }

  async function unlockAndRetry() {
    setAsking(true)
    const open = await askToUnlock()
    setAsking(false)
    if (open) void handleExport()
  }

  return (
    <Modal
      title="Several companies"
      description="One or more months of several companies in one Excel file, each company on its own sheet."
      onClose={working ? () => {} : onClose}
      width="max-w-2xl"
      icon={<Files />}
    >
      {!list && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          Asking the dashboard for your companies…
        </p>
      )}

      {list && !list.ok && (
        <div className="space-y-4">
          <p role="alert" className="panel panel-danger text-sm">
            <CircleAlert aria-hidden="true" />
            <span>
              {list.code === 'not-supported'
                ? 'This dashboard cannot export several companies yet.'
                : list.error || 'The dashboard could not be asked.'}
            </span>
          </p>
          <div className="flex justify-end">
            <button onClick={onClose} className="btn btn-secondary">
              Close
            </button>
          </div>
        </div>
      )}

      {list?.ok && !result?.ok && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2">
              <span className="font-medium text-fg">From</span>
              <input
                type="month"
                className="field w-auto"
                value={from}
                disabled={working}
                onChange={(e) => {
                  // Moving "From" past "To" moves "To" with it.
                  setFrom(e.target.value)
                  if (isMonth(e.target.value) && (!isMonth(to) || to < e.target.value)) setTo(e.target.value)
                }}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="font-medium text-fg">To</span>
              <input type="month" className="field w-auto" value={to} disabled={working} onChange={(e) => setTo(e.target.value)} />
            </label>
            {rangeProblem ? (
              <span role="alert" className="text-xs text-danger">
                {rangeProblem}
              </span>
            ) : (
              !single && <span className="text-xs text-muted">{monthsBetween(from, to).length} months</span>
            )}
          </div>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto font-semibold text-fg">Companies where you are an admin</h3>
              <span className="text-xs text-muted">
                {count} of {companies.length} chosen
              </span>
              <button onClick={() => setChosen(new Set(companies.map((c) => c.brn)))} disabled={working} className="btn btn-ghost btn-sm">
                Select all
              </button>
              <button onClick={() => setChosen(new Set())} disabled={working || count === 0} className="btn btn-ghost btn-sm">
                Clear
              </button>
            </div>
            {companies.length === 0 ? (
              <p className="text-muted">You are not an admin of any company in the dashboard.</p>
            ) : (
              <ul className="card max-h-72 divide-y divide-line overflow-y-auto">
                {companies.map((company) => (
                  <li key={company.brn}>
                    <label className="flex items-center gap-3 px-4 py-2">
                      <input
                        type="checkbox"
                        checked={chosen.has(company.brn)}
                        disabled={working}
                        onChange={(e) => toggle(company.brn, e.target.checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-fg">{company.name}</span>
                        <span className="text-muted"> · BRN {company.brn}</span>
                        {company.selected && <span className="text-muted"> · selected in the dashboard</span>}
                        {!company.has_setup && <span className="text-muted"> · no column setup in the dashboard yet</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-muted">
            {single
              ? 'The dashboard asks you once to allow it, naming the month and the companies. A company with no data for that month is listed in the file, without a sheet.'
              : 'The dashboard asks you once to allow it, naming the months and the companies. A company with no data in those months is listed in the file, without a sheet.'}
          </p>

          {result && !result.ok && (
            <div role="alert" className="panel panel-danger">
              <CircleAlert aria-hidden="true" />
              <span className="min-w-0 flex-1">{result.error || 'Nothing was exported.'}</span>
              {result.code === 'locked' && (
                <button onClick={() => void unlockAndRetry()} disabled={asking} className="btn btn-secondary btn-sm">
                  <LockKeyhole aria-hidden="true" />
                  Unlock the dashboard
                </button>
              )}
            </div>
          )}

          {working && (
            <p role="status" className="flex items-center gap-2 text-muted">
              <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
              {progress.step === 'asking'
                ? 'Waiting for your answer in the dashboard…'
                : progress.step === 'reading'
                  ? `Reading ${progress.name} (${progress.done + 1} of ${progress.of})…`
                  : 'Making the Excel file…'}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button onClick={onClose} disabled={working} className="btn btn-secondary">
              Cancel
            </button>
            <button onClick={() => void handleExport()} disabled={working || count === 0 || !monthLabel} className="btn btn-primary">
              <Download aria-hidden="true" />
              {count === 0 ? 'Export' : `Export ${count} ${count === 1 ? 'company' : 'companies'}`}
            </button>
          </div>
        </div>
      )}

      {result?.ok && <ExportDone result={result} monthLabel={monthLabel} months={monthsBetween(from, to)} onClose={onClose} />}
    </Modal>
  )
}

// What one company got in the file: its sheet and employees, or, for several
// months, its sheet and the months it has data for.
function companyLine(company, sheet, months) {
  if (company.status !== 'sheet') return months.length === 1 ? ' · No data for this month: no sheet' : ' · No data in these months: no sheet'
  if (months.length === 1) return ` · sheet "${sheet}", ${company.employeeCount} ${company.employeeCount === 1 ? 'employee' : 'employees'}`
  const have = new Set(company.months.map((m) => m.period))
  const missing = months.filter((m) => !have.has(m)).map((m) => rangeLabelOf(m, m))
  return ` · sheet "${sheet}", ${have.size} of ${months.length} months${missing.length > 0 ? ` (no data: ${missing.join(', ')})` : ''}`
}

function ExportDone({ result, monthLabel, months, onClose }) {
  const withSheets = result.companies.filter((c) => c.status === 'sheet').length
  return (
    <div className="space-y-4 text-sm">
      <p role="status" className="panel panel-accent items-center">
        <CircleCheck aria-hidden="true" />
        <span className="min-w-0 flex-1 wrap-break-word">
          Downloaded {result.fileName}: {monthLabel}, {withSheets} {withSheets === 1 ? 'company' : 'companies'} with a sheet.
        </span>
        <button onClick={() => downloadWorkbook(result.buffer, result.fileName)} className="btn btn-secondary btn-sm">
          <Download aria-hidden="true" />
          Download again
        </button>
      </p>
      <ul className="card divide-y divide-line">
        {result.companies.map((company, i) => (
          <li key={company.brn} className="space-y-1 px-4 py-2">
            <p>
              <span className="font-medium text-fg">{company.name}</span>
              <span className="text-muted">{companyLine(company, result.sheets[i], months)}</span>
            </p>
            {company.status === 'sheet' && company.errors.length > 0 && (
              <p className="flex items-start gap-1.5 text-warn">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {company.errors.length} {company.errors.length === 1 ? 'figure' : 'figures'} could not be worked out and{' '}
                {company.errors.length === 1 ? 'is' : 'are'} written as Error (first: {months.length > 1 && `${rangeLabelOf(company.errors[0].period, company.errors[0].period)}, `}
                {company.errors[0].employee}, {company.errors[0].column}).
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-muted">The file holds national IDs and salaries. Keep it where the payroll itself is kept.</p>
      <div className="flex justify-end border-t border-line pt-4">
        <button onClick={onClose} className="btn btn-primary">
          Close
        </button>
      </div>
    </div>
  )
}
