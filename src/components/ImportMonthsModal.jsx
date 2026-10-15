import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, CloudUpload, Download, LoaderCircle, LockKeyhole } from 'lucide-react'
import Modal from './Modal'
import { buildBackup, buildBackupFilename, downloadBackup } from '../lib/backup'
import { askToUnlock } from '../lib/dashboardMonths'
import { chosenCount, defaultMonthChoices, planMonthImport, runMonthImport } from '../lib/monthImport'

// "Import months to the dashboard": once, started by the user.
//   1. A backup file of everything in this browser first; nothing goes on
//      until it has been downloaded.
//   2. The preview: every company and month, and what would happen to each.
//      Nothing is written yet.
//   3. The import, one month at a time, each read back and its figures checked.
//   4. What happened to each. This browser's own months are left as they were.
export default function ImportMonthsModal({ onClose, onDone }) {
  const [step, setStep] = useState('backup') // backup | preview | importing | done
  const [backupName, setBackupName] = useState(null)
  const [plan, setPlan] = useState(null) // the plan, or { ok: false, code, error }
  const [choices, setChoices] = useState(null)
  const [outcomes, setOutcomes] = useState([])
  const [done, setDone] = useState(0)
  const [asking, setAsking] = useState(false)

  function handleBackUp() {
    const now = new Date()
    const name = buildBackupFilename(now)
    downloadBackup(buildBackup(now), name)
    setBackupName(name)
  }

  useEffect(() => {
    if (step !== 'preview' || plan) return
    let live = true
    planMonthImport().then((result) => {
      if (!live) return
      setPlan(result)
      if (result.ok) setChoices(defaultMonthChoices(result))
    })
    return () => {
      live = false
    }
  }, [step, plan])

  async function unlockAndRetry() {
    setAsking(true)
    const open = await askToUnlock()
    setAsking(false)
    if (open) setPlan(null)
  }

  async function handleImport() {
    setStep('importing')
    const results = await runMonthImport(plan, choices, setDone)
    setOutcomes(results)
    setStep('done')
  }

  const choose = (browserId, period, value) =>
    setChoices((prev) => ({ ...prev, [browserId]: { ...prev[browserId], [period]: value } }))

  const busy = step === 'importing'
  const close = busy ? () => {} : step === 'done' ? onDone : onClose
  const count = choices ? chosenCount(choices) : 0

  return (
    <Modal
      title="Import months to the dashboard"
      description="Copies this browser's months of employee data into the dashboard, once. This browser's own copy is not changed."
      onClose={close}
      width="max-w-3xl"
      icon={<CloudUpload />}
    >
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        {step === 'backup' && (
          <div className="space-y-4 text-sm">
            <p className="text-fg">First, save a backup file of everything Payroll keeps in this browser. The import does not start without it.</p>
            <button onClick={handleBackUp} className="btn btn-secondary">
              <Download aria-hidden="true" />
              Download a backup file
            </button>
            {backupName && (
              <p role="status" className="flex items-center gap-2 text-muted">
                <CircleCheck className="h-4 w-4 text-accent" aria-hidden="true" />
                Downloaded {backupName}. Keep it where the payroll is kept.
              </p>
            )}
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <button onClick={onClose} className="btn btn-secondary">
                Cancel
              </button>
              <button onClick={() => setStep('preview')} disabled={!backupName} className="btn btn-primary">
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && !plan && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
            Comparing this browser's months with the dashboard…
          </p>
        )}

        {step === 'preview' && plan && !plan.ok && (
          <div className="space-y-4">
            <p role="alert" className="panel panel-danger text-sm">
              <CircleAlert aria-hidden="true" />
              <span>{plan.error || 'The dashboard could not be asked.'}</span>
            </p>
            <div className="flex justify-end gap-2">
              {plan.code === 'locked' && (
                <button onClick={() => void unlockAndRetry()} disabled={asking} className="btn btn-primary">
                  <LockKeyhole aria-hidden="true" />
                  Unlock the dashboard
                </button>
              )}
              <button onClick={onClose} className="btn btn-secondary">
                Close
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && plan?.ok && choices && (
          <div className="space-y-5 text-sm">
            {plan.companies.map((company) => (
              <section key={company.browserId} className="card space-y-2 px-4 py-3">
                <h3 className="font-semibold text-fg">
                  {company.name}
                  {company.dashboardName && company.dashboardName !== company.name && (
                    <span className="font-normal text-muted"> · in the dashboard: {company.dashboardName}</span>
                  )}
                </h3>
                {company.reason ? (
                  <p className="text-muted">{company.reason} Its months stay in this browser.</p>
                ) : company.months.length === 0 ? (
                  <p className="text-muted">This browser has no months of it.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {company.months.map((month) => (
                      <MonthRow
                        key={month.period}
                        company={company}
                        month={month}
                        choice={choices[company.browserId]?.[month.period]}
                        onChoose={(value) => choose(company.browserId, month.period, value)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ))}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
              <span className="mr-auto text-xs text-muted">Nothing has been written to the dashboard yet.</span>
              <button onClick={onClose} className="btn btn-secondary">
                Cancel
              </button>
              <button onClick={handleImport} disabled={count === 0} className="btn btn-primary">
                Import {count} {count === 1 ? 'month' : 'months'}
              </button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
            Importing and checking each month… {done} done.
          </p>
        )}

        {step === 'done' && (
          <div className="space-y-4 text-sm">
            <ul className="space-y-2">
              {outcomes.map((outcome, i) => (
                <li key={i} className={`panel ${outcome.ok ? 'panel-accent' : 'panel-danger'}`}>
                  {outcome.ok ? <CircleCheck aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-fg">{outcome.name}</span>:{' '}
                    {outcome.ok ? 'imported, and every figure checked.' : `NOT imported. ${outcome.reason}`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted">
              This browser's own months were left as they were. Opened on its own, the app still shows them, marked "This browser only. Not the
              dashboard's copy."
            </p>
            <div className="flex justify-end border-t border-line pt-4">
              <button onClick={onDone} className="btn btn-primary">
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function MonthRow({ company, month, choice, onChoose }) {
  const people = `${month.count} ${month.count === 1 ? 'employee' : 'employees'}`
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="min-w-36 font-medium text-fg">{month.label}</span>
      {month.state === 'new' && (
        <label className="flex items-center gap-2 text-muted">
          <input type="checkbox" checked={choice === 'import'} onChange={(e) => onChoose(e.target.checked ? 'import' : 'skip')} />
          Import ({people})
        </label>
      )}
      {month.state === 'conflict' && (
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-muted">
            {people}. The dashboard already has this month (revision {month.existing.revision}, {month.existing.employee_count}{' '}
            {month.existing.employee_count === 1 ? 'employee' : 'employees'}):
          </span>
          <select
            className="field field-cell w-auto"
            aria-label={`What to do with ${month.label} of ${company.name}`}
            value={choice ?? 'skip'}
            onChange={(e) => onChoose(e.target.value)}
          >
            <option value="skip">Keep the dashboard's</option>
            <option value="replace">Replace it with this browser's, as a new revision</option>
          </select>
        </label>
      )}
      {month.state === 'differs' && (
        <span className="text-muted">
          Not offered: with the dashboard's columns, {month.differences.length} calculated{' '}
          {month.differences.length === 1 ? 'figure' : 'figures'} would not be the same (first: employee {month.differences[0].employee},{' '}
          {month.differences[0].column}). Make the columns the same first.
        </span>
      )}
      {month.state === 'imported' && <span className="text-muted">Already imported from this browser.</span>}
      {month.state === 'empty' && <span className="text-muted">No employees: nothing to import.</span>}
    </li>
  )
}
