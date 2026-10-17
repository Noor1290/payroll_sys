import { useEffect, useState, useSyncExternalStore } from 'react'
import { CircleAlert, CircleCheck, Cloud, CloudUpload, LoaderCircle, LockKeyhole } from 'lucide-react'
import { keepMine, retrySaving, setupStatus, takeTheirs } from '../lib/dashboardSetup'
import { askToUnlock, keepMyMonth, retryMonths, takeTheirMonth } from '../lib/dashboardMonths'
import { formatPeriodLabel, parsePeriodKey } from '../lib/periods'

function reasonFor(problem) {
  switch (problem.code) {
    case 'stale':
      return 'Someone else changed the column setup in the dashboard since it was opened here.'
    case 'forbidden':
      return problem.error || 'You may not change this in the dashboard.'
    case 'wrong-company':
      return 'The dashboard is now showing another company.'
    case 'no-answer':
      return 'The dashboard did not answer.'
    case 'locked':
      return 'The dashboard is locked. It is saved once the dashboard is unlocked.'
    default:
      return problem.error || 'The dashboard could not save it.'
  }
}

function monthReasonFor(problem) {
  switch (problem.code) {
    case 'stale':
      return problem.error || 'Someone else saved it in the dashboard since it was opened here.'
    case 'no-answer':
      return 'The dashboard did not answer.'
    case 'locked':
      return 'The dashboard is locked. What you typed is kept on this screen and saved once the dashboard is unlocked.'
    case 'wrong-company':
      return 'The dashboard is now showing another company.'
    default:
      return problem.error || 'The dashboard could not save it.'
  }
}

const monthOf = (problem) => {
  if (!problem.period) return 'The month'
  const { year, month } = parsePeriodKey(problem.period)
  return formatPeriodLabel(year, month)
}

function UnlockButton() {
  const [asking, setAsking] = useState(false)
  return (
    <button
      className="btn btn-secondary btn-sm"
      disabled={asking}
      onClick={async () => {
        setAsking(true)
        await askToUnlock()
        setAsking(false)
      }}
    >
      <LockKeyhole aria-hidden="true" />
      Unlock the dashboard
    </button>
  )
}

// Inside the dashboard: whose column setup (and months) these are, whether the
// last change is saved there, and what to do when it is not. A change that was
// not saved is never left looking like one that was.
//   months  what the months say (dashboardMonths.js), or null
export default function DashboardBar({ company, access, onReload, onImport, months = null, onImportMonths = null }) {
  const setup = useSyncExternalStore(setupStatus.subscribe, setupStatus.get)
  const monthsKept = months?.supported === true
  const state =
    setup.state === 'not-saved' || (monthsKept && months.state === 'not-saved')
      ? 'not-saved'
      : setup.state === 'saving' || (monthsKept && months.state === 'saving')
        ? 'saving'
        : 'saved'

  // Closing or reloading with something not saved yet: the browser asks first. The dashboard is
  // told too, so it asks before it reloads this app on a change of company (rehearsal fix F1).
  useEffect(() => {
    window.PayrollHubBridge?.setUnsaved?.(state !== 'saved')
    if (state === 'saved') return
    const hold = (event) => event.preventDefault()
    window.addEventListener('beforeunload', hold)
    return () => window.removeEventListener('beforeunload', hold)
  }, [state])

  const problem = setup.problem
  const monthProblem = monthsKept ? months.problem : null
  return (
    <div className="mb-4 flex shrink-0 flex-col gap-2">
      <div role="status" className="card flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
        <Cloud className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-fg">
          {monthsKept ? (
            <>
              Column setup and months of <span className="font-semibold">{company.label}</span>, kept in the dashboard.
            </>
          ) : (
            <>
              Column setup of <span className="font-semibold">{company.label}</span>, kept in the dashboard. Months are still kept in this
              browser.
            </>
          )}
        </span>
        {onImport && (
          <button onClick={onImport} className="btn btn-secondary btn-sm">
            <CloudUpload aria-hidden="true" />
            Import to the dashboard
          </button>
        )}
        {onImportMonths && (
          <button onClick={onImportMonths} className="btn btn-secondary btn-sm">
            <CloudUpload aria-hidden="true" />
            Import months to the dashboard
          </button>
        )}
        {state === 'saved' && (
          <span className="flex items-center gap-1.5 text-muted">
            <CircleCheck className="h-4 w-4" aria-hidden="true" />
            Saved
          </span>
        )}
        {state === 'saving' && (
          <span className="flex items-center gap-1.5 text-muted">
            <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
            Saving…
          </span>
        )}
        {state === 'not-saved' && (
          <span className="flex items-center gap-1.5 font-semibold text-danger">
            <CircleAlert className="h-4 w-4" aria-hidden="true" />
            NOT saved
          </span>
        )}
      </div>

      {access && !access.canChange && (
        <p className="panel text-sm [--panel:var(--warn)]">
          <CircleAlert aria-hidden="true" />
          <span className="min-w-0 flex-1">
            The identity fields and Global columns are used by {access.companies} {access.companies === 1 ? 'company' : 'companies'}, and you are{' '}
            {access.adminOf === 0
              ? `not an admin of ${access.companies === 1 ? 'it' : 'any of them'}`
              : `an admin of ${access.adminOf} of them`}
            . You can see them here; only someone who is an admin of every company using them can change them.
          </span>
        </p>
      )}

      {company.role !== 'admin' && (
        <p className="panel text-sm [--panel:var(--warn)]">
          <CircleAlert aria-hidden="true" />
          <span className="min-w-0 flex-1">
            You can see the columns and details of {company.label}. Only an admin of {company.label} can change them
            {monthsKept ? ' or see its employees' : ''}.
          </span>
        </p>
      )}

      {problem && (
        <div role="alert" className="panel panel-danger flex-wrap items-center text-sm">
          <CircleAlert aria-hidden="true" />
          <span className="min-w-48 flex-1">
            The column setup was NOT saved in the dashboard. {reasonFor(problem)} What you see here is still on this screen, but it will be
            gone when this page is closed or reloaded.
          </span>
          <span className="flex flex-wrap gap-2">
            {problem.code === 'stale' ? (
              <>
                <button className="btn btn-secondary btn-sm" onClick={() => void keepMine()}>
                  Save mine over it
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => void takeTheirs()}>
                  Use the dashboard's version
                </button>
              </>
            ) : problem.code === 'wrong-company' ? (
              <button className="btn btn-secondary btn-sm" onClick={onReload}>
                Load the company selected in the dashboard
              </button>
            ) : problem.code === 'locked' ? (
              <UnlockButton />
            ) : problem.code === 'forbidden' ? null : (
              <button className="btn btn-secondary btn-sm" onClick={() => void retrySaving()}>
                Try saving again
              </button>
            )}
          </span>
        </div>
      )}

      {monthProblem && (
        <div role="alert" className="panel panel-danger flex-wrap items-center text-sm">
          <CircleAlert aria-hidden="true" />
          <span className="min-w-48 flex-1">
            {monthOf(monthProblem)} was NOT saved in the dashboard. {monthReasonFor(monthProblem)}
            {monthProblem.code === 'locked' ? '' : ' What you see here is still on this screen, but it will be gone when this page is closed or reloaded.'}
          </span>
          <span className="flex flex-wrap gap-2">
            {monthProblem.code === 'stale' ? (
              <>
                <button className="btn btn-secondary btn-sm" onClick={() => void keepMyMonth()}>
                  Save mine over it
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => void takeTheirMonth()}>
                  Use the dashboard's version
                </button>
              </>
            ) : monthProblem.code === 'locked' ? (
              <UnlockButton />
            ) : monthProblem.code === 'wrong-company' ? (
              <button className="btn btn-secondary btn-sm" onClick={onReload}>
                Load the company selected in the dashboard
              </button>
            ) : monthProblem.code === 'forbidden' ? null : (
              <button className="btn btn-secondary btn-sm" onClick={() => void retryMonths()}>
                Try saving again
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
