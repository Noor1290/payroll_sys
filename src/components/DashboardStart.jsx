import { useEffect, useState } from 'react'
import { CircleAlert, Cloud, CloudUpload, LoaderCircle, RotateCw } from 'lucide-react'
import { defaultIdentityFields } from '../lib/model'
import { dashboardCompany, startOptions, startSetup } from '../lib/dashboardSetup'

// Inside the dashboard, before the app can be used: while the column setup is
// loading, when it could not be loaded, or when the selected company has no
// setup in the dashboard yet.
//   mode         'starting' | 'failed' | 'empty'
//   problem      why it failed (mode 'failed')
//   canImport    this browser holds companies that are not imported yet
// Once a setup has been started here, the app is started again from it (see
// onSetupReplaced in lib/dashboardSetup.js).
export default function DashboardStart({ mode, problem, canImport, onRetry, onImport }) {
  const company = dashboardCompany()

  return (
    <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      {mode === 'starting' && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          Loading the column setup from the dashboard…
        </p>
      )}

      {mode === 'failed' && (
        <div role="alert" className="flex max-w-lg flex-col items-center gap-3">
          <span className="icon-tile icon-tile-danger" aria-hidden="true">
            <CircleAlert />
          </span>
          <p className="text-base font-semibold text-fg">The column setup could not be loaded from the dashboard</p>
          <p className="text-sm text-muted">{problem}</p>
          <button onClick={onRetry} className="btn btn-primary">
            <RotateCw aria-hidden="true" />
            Try again
          </button>
          <p className="text-xs text-muted">Opened on its own, outside the dashboard, the payroll app works from this browser's own copy.</p>
        </div>
      )}

      {mode === 'empty' && company && <EmptyStart company={company} canImport={canImport} onImport={onImport} />}
    </main>
  )
}

function EmptyStart({ company, canImport, onImport }) {
  const admin = company.role === 'admin'
  const [options, setOptions] = useState(null) // [{ sharedSetupId, companies }] | null while loading
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!admin) return
    let live = true
    startOptions().then((answer) => {
      if (!live) return
      if (answer.ok) setOptions(answer.options)
      else setError(answer.error)
    })
    return () => {
      live = false
    }
  }, [admin])

  async function start(choice) {
    setBusy(true)
    setError(null)
    const result = await startSetup(choice)
    if (!result.ok) {
      setBusy(false)
      setError(result.error || 'The dashboard could not save it.')
    }
  }

  function startNew() {
    const identityFields = defaultIdentityFields()
    void start({ newShared: { identityFields, idFieldKey: identityFields[0].key, globalColumns: [] } })
  }

  return (
    <div className="flex max-w-xl flex-col items-center gap-3">
      <span className="icon-tile icon-tile-neutral" aria-hidden="true">
        <Cloud />
      </span>
      <p className="text-base font-semibold text-fg">{company.label} has no column setup in the dashboard yet</p>
      {!admin && <p className="text-sm text-muted">Only an admin of {company.label} can set up its columns.</p>}

      {admin && (
        <>
          {canImport && (
            <>
              <p className="text-sm text-muted">This browser holds companies and columns that are not in the dashboard yet.</p>
              <button onClick={onImport} disabled={busy} className="btn btn-primary">
                <CloudUpload aria-hidden="true" />
                Import to the dashboard
              </button>
            </>
          )}
          {options === null && !error && <p className="text-sm text-muted">Looking for the shared columns your other companies use…</p>}
          {options?.map((option) => (
            <button key={option.sharedSetupId} onClick={() => void start({ sharedSetupId: option.sharedSetupId })} disabled={busy} className="btn btn-secondary">
              Use the shared columns of {option.companies.join(', ')}
            </button>
          ))}
          {options?.length === 0 && (
            <button onClick={startNew} disabled={busy} className="btn btn-secondary">
              Start with new, empty Global columns
            </button>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="panel panel-danger text-sm">
          <CircleAlert aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}
