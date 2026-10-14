import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, CloudUpload, Download, LoaderCircle } from 'lucide-react'
import Modal from './Modal'
import { buildBackup, buildBackupFilename, downloadBackup } from '../lib/backup'
import { defaultChoices, linkableCompanies, planImport, readyToImport, runImport } from '../lib/dashboardImport'

// "Import to the dashboard": once, started by the user.
//   1. A backup file of everything in this browser first; nothing goes on
//      until it has been downloaded.
//   2. The preview: what would be imported where. Nothing is written yet.
//   3. The import, one item at a time, each read back and checked.
//   4. What happened to each. This browser's own copy is left as it was.
export default function ImportToDashboardModal({ onClose, onDone }) {
  const [step, setStep] = useState('backup') // backup | preview | importing | done
  const [backupName, setBackupName] = useState(null)
  const [plan, setPlan] = useState(null) // the plan, or { ok: false, error }
  const [choices, setChoices] = useState(null)
  const [outcomes, setOutcomes] = useState([])
  const [done, setDone] = useState(0)

  function handleBackUp() {
    const now = new Date()
    const name = buildBackupFilename(now)
    downloadBackup(buildBackup(now), name)
    setBackupName(name)
  }

  useEffect(() => {
    if (step !== 'preview' || plan) return
    let live = true
    planImport().then((result) => {
      if (!live) return
      setPlan(result)
      if (result.ok) setChoices(defaultChoices(result))
    })
    return () => {
      live = false
    }
  }, [step, plan])

  async function handleImport() {
    setStep('importing')
    const results = await runImport(plan, choices, setDone)
    setOutcomes(results)
    setStep('done')
  }

  const chooseCompany = (browserId, patch) =>
    setChoices((prev) => ({ ...prev, companies: { ...prev.companies, [browserId]: { ...prev.companies[browserId], ...patch } } }))

  const busy = step === 'importing'
  const close = busy ? () => {} : step === 'done' ? onDone : onClose
  const toImport = choices ? Object.values(choices.companies).filter((c) => c.action !== 'skip' && c.target).length : 0

  return (
    <Modal
      title="Import to the dashboard"
      description="Copies this browser's column setup and companies into the dashboard, once. This browser's own copy is not changed."
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
            Comparing this browser with the dashboard…
          </p>
        )}

        {step === 'preview' && plan && !plan.ok && (
          <div className="space-y-4">
            <p role="alert" className="panel panel-danger text-sm">
              <CircleAlert aria-hidden="true" />
              <span>{plan.error || 'The dashboard could not be asked.'}</span>
            </p>
            <div className="flex justify-end">
              <button onClick={onClose} className="btn btn-secondary">
                Close
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && plan?.ok && choices && (
          <Preview plan={plan} choices={choices} setChoices={setChoices} chooseCompany={chooseCompany}>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
              <span className="mr-auto text-xs text-muted">Nothing has been written to the dashboard yet.</span>
              <button onClick={onClose} className="btn btn-secondary">
                Cancel
              </button>
              <button onClick={handleImport} disabled={!readyToImport(plan, choices)} className="btn btn-primary">
                Import {toImport} {toImport === 1 ? 'company' : 'companies'}
              </button>
            </div>
          </Preview>
        )}

        {step === 'importing' && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
            Importing and checking each item… {done} done.
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
                    {outcome.ok ? 'imported and checked.' : `NOT imported. ${outcome.reason}`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted">
              This browser's own copy was left as it was. Opened on its own, the app still shows it, marked "This browser only. Not the
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

function Preview({ plan, choices, setChoices, chooseCompany, children }) {
  const { browser, shared } = plan
  return (
    <div className="space-y-5 text-sm">
      <section>
        <h3 className="mb-1 font-semibold text-fg">Identity fields and Global columns</h3>
        {!shared.existing ? (
          <p className="text-muted">
            A new shared column setup will be made from this browser's {browser.identityFields.length} identity{' '}
            {browser.identityFields.length === 1 ? 'field' : 'fields'} and {browser.globalColumns.length} Global{' '}
            {browser.globalColumns.length === 1 ? 'column' : 'columns'}. The companies below are attached to it.
          </p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="text-muted">
              {shared.existing.usedBy.join(', ')} already {shared.existing.usedBy.length === 1 ? 'uses' : 'use'} shared columns in the dashboard
              (revision {shared.existing.revision}).{' '}
              {shared.existing.differs ? "They are not the same as this browser's." : "They are the same as this browser's."} Choose one:
            </legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="shared-choice"
                checked={choices.shared === 'replace'}
                onChange={() => setChoices((prev) => ({ ...prev, shared: 'replace' }))}
              />
              Replace them with this browser's, as a new revision (every company using them gets the change)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="shared-choice"
                checked={choices.shared === 'keep'}
                onChange={() => setChoices((prev) => ({ ...prev, shared: 'keep' }))}
              />
              Keep the dashboard's
            </label>
            {choices.shared === 'keep' && shared.existing.differs && (
              <p className="panel text-xs [--panel:var(--warn)]">
                <CircleAlert aria-hidden="true" />
                <span>The months in this browser were worked out with this browser's columns. With the dashboard's, their figures can differ.</span>
              </p>
            )}
          </fieldset>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-fg">Companies</h3>
        <ul className="space-y-3">
          {plan.items.map((item) => (
            <CompanyChoice
              key={item.company.id}
              item={item}
              choice={choices.companies[item.company.id]}
              linkable={linkableCompanies(plan, choices, item.company.id)}
              onChange={(patch) => chooseCompany(item.company.id, patch)}
            />
          ))}
        </ul>
      </section>
      {children}
    </div>
  )
}

const REASONS = {
  'no-brn': 'It has no BRN, so it matches no dashboard company.',
  'no-match': 'Its BRN matches none of the dashboard companies you are an admin of.',
  'already-linked': 'Its BRN belongs to a dashboard company already linked from this browser.',
}

function CompanyChoice({ item, choice, linkable, onChange }) {
  const { company, match } = item
  const manualTarget = choice.manual ? linkable.find((d) => d.brn === choice.target) : null
  return (
    <li className="card space-y-2 px-4 py-3">
      <p>
        <span className="font-medium text-fg">{company.name}</span>
        <span className="text-muted"> · BRN {item.brn || 'none'}</span>
      </p>

      {match ? (
        <>
          <p className="text-muted">
            Matches <span className="font-medium text-fg">{match.name}</span> in the dashboard (BRN {match.brn}).
          </p>
          {item.differences.length > 0 && (
            <ul className="text-xs text-muted">
              {item.differences.map((d) => (
                <li key={d.field}>
                  {d.field} differs. This browser: “{d.browser || 'empty'}”. Dashboard: “{d.dashboard || 'empty'}”. The dashboard's is kept.
                </li>
              ))}
            </ul>
          )}
          <label className="flex flex-wrap items-center gap-2">
            <span className="text-muted">{item.hasSetup ? 'It already has columns in the dashboard:' : 'Import it?'}</span>
            <select
              className="field field-cell w-auto"
              aria-label={`What to do with ${company.name}`}
              value={choice.action}
              onChange={(e) => onChange({ action: e.target.value })}
            >
              {item.hasSetup ? (
                <>
                  <option value="skip">Skip it</option>
                  <option value="keep">Keep the dashboard's columns</option>
                  <option value="replace">Replace them with this browser's, as a new revision</option>
                </>
              ) : (
                <>
                  <option value="import">Import its columns and details</option>
                  <option value="skip">Skip it</option>
                </>
              )}
            </select>
          </label>
        </>
      ) : (
        <>
          <p className="text-muted">{REASONS[item.reason]} It stays in this browser unless you link it.</p>
          <label className="flex flex-wrap items-center gap-2">
            <span className="text-muted">Link this company to…</span>
            <select
              className="field field-cell w-auto"
              aria-label={`Link ${company.name} to`}
              value={choice.manual ? choice.target : ''}
              onChange={(e) =>
                onChange(
                  e.target.value
                    ? { target: e.target.value, action: 'import', manual: true, confirmed: false }
                    : { target: null, action: 'skip', manual: false, confirmed: false },
                )
              }
            >
              <option value="">Do not link it</option>
              {linkable.map((d) => (
                <option key={d.brn} value={d.brn}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          {linkable.length === 0 && !choice.manual && <p className="text-xs text-muted">No dashboard company of yours is free to link to.</p>}
          {manualTarget && (
            <div className="space-y-1 rounded-lg border border-line px-3 py-2">
              <p className="text-xs text-muted">
                BRN in this browser: <span className="num text-fg">{item.brn || 'none'}</span> · BRN in the dashboard:{' '}
                <span className="num text-fg">{manualTarget.brn}</span>. The dashboard company's name, address and BRN are not changed.
              </p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={choice.confirmed} onChange={(e) => onChange({ confirmed: e.target.checked })} />
                Link {company.name} to {manualTarget.name}
              </label>
            </div>
          )}
        </>
      )}
    </li>
  )
}
