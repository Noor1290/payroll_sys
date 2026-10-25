import { useRef, useState } from 'react'
import { CircleAlert, CircleCheck, FileUp, LoaderCircle, LockKeyhole, TriangleAlert, Upload } from 'lucide-react'
import { checkCompanies, importCompanies } from '../lib/dashboardBatch'
import { askToUnlock } from '../lib/dashboardMonths'
import { heldShared } from '../lib/dashboardSetup'
import { monthLabelOf, rangeLabelOf } from '../lib/severalCompanies'
import { defaultImportChoices, isChosen, monthsToSend, planImport, readCompaniesFile } from '../lib/severalImport'

// "Several companies…" > Import: a file made by Export, read back and matched to
// the dashboard's companies by BRN. Nothing is saved before the preview is
// confirmed; then one company at a time, each fully or not at all
// (dashboardBatch.js, the dashboard's migration 0019). The file is never changed.
//   step: 'file' | 'reading' | 'failed' | 'new' | 'preview' | 'importing' | 'done'
export default function SeveralCompaniesImport({ onWorking, onClose, onImported }) {
  const [step, setStep] = useState('file')
  const [fileName, setFileName] = useState(null)
  const [failure, setFailure] = useState(null) // { error, code }
  const [plan, setPlan] = useState(null)
  const [choices, setChoices] = useState(null)
  const [progress, setProgress] = useState(null)
  const [outcomes, setOutcomes] = useState(null)
  const [asking, setAsking] = useState(false)
  const readFile = useRef(null) // the file's bytes, to read again after unlocking
  const input = useRef(null)

  async function read(buffer) {
    setStep('reading')
    setFailure(null)
    const file = readCompaniesFile(buffer)
    if (!file.ok) {
      setFailure({ error: file.error })
      setStep('failed')
      return
    }
    const answer = await checkCompanies(file)
    if (!answer.ok) {
      setFailure({ error: answer.code === 'not-supported' ? 'This dashboard cannot import several companies yet.' : answer.error, code: answer.code })
      setStep('failed')
      return
    }
    const made = planImport(file, answer.rows, heldShared())
    setPlan(made)
    setChoices(defaultImportChoices(made))
    setStep(made.newCompanies.length > 0 ? 'new' : 'preview')
  }

  async function handleFile(event) {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen) return
    setFileName(chosen.name)
    readFile.current = await chosen.arrayBuffer()
    await read(readFile.current)
  }

  async function unlockAndRetry() {
    setAsking(true)
    const open = await askToUnlock()
    setAsking(false)
    if (open && readFile.current) await read(readFile.current)
  }

  async function handleImport() {
    setStep('importing')
    onWorking(true)
    const result = await importCompanies(plan, choices, setProgress)
    onWorking(false)
    setProgress(null)
    setOutcomes(result)
    setStep('done')
  }

  const set = (part, key, value) => setChoices((prev) => ({ ...prev, [part]: { ...prev[part], [key]: value } }))
  const toImport = plan && choices ? plan.companies.filter((c) => isChosen(c, choices) && monthsToSend(c, choices).length > 0) : []

  return (
    <div className="space-y-4 text-sm">
      {step === 'file' && (
        <>
          <p className="text-fg">
            Choose a file made by Export. Each sheet is matched to a company by its BRN, and nothing is saved before you confirm the preview. The
            file is not changed.
          </p>
          <input ref={input} type="file" accept=".xlsx" className="hidden" aria-label="The Excel file to import" onChange={(e) => void handleFile(e)} />
          <button onClick={() => input.current?.click()} className="btn btn-primary">
            <FileUp aria-hidden="true" />
            Choose the Excel file…
          </button>
        </>
      )}

      {step === 'reading' && (
        <p role="status" className="flex items-center gap-2 text-muted">
          <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          Reading {fileName} and asking the dashboard what it has…
        </p>
      )}

      {step === 'failed' && (
        <div className="space-y-4">
          <p role="alert" className="panel panel-danger">
            <CircleAlert aria-hidden="true" />
            <span>{failure?.error || 'The file could not be read.'}</span>
          </p>
          <div className="flex justify-end gap-2">
            {failure?.code === 'locked' && (
              <button onClick={() => void unlockAndRetry()} disabled={asking} className="btn btn-primary">
                <LockKeyhole aria-hidden="true" />
                Unlock the dashboard
              </button>
            )}
            <button onClick={() => setStep('file')} className="btn btn-secondary">
              Choose another file
            </button>
          </div>
        </div>
      )}

      {step === 'new' && plan && choices && (
        <NewCompanies plan={plan} choices={choices} set={set} onDone={() => setStep('preview')} />
      )}

      {step === 'preview' && plan && choices && (
        <>
          <p className="text-muted">
            {fileName}: {rangeLabelOf(plan.from, plan.to)}, {plan.companies.length} {plan.companies.length === 1 ? 'company' : 'companies'}.
          </p>
          <ul className="space-y-3">
            {plan.companies.map((company) => (
              <CompanyPreview key={company.key} company={company} choices={choices} set={set} />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
            <span className="mr-auto text-xs text-muted">Nothing has been saved yet.</span>
            <button onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button onClick={() => void handleImport()} disabled={toImport.length === 0} className="btn btn-primary">
              <Upload aria-hidden="true" />
              {toImport.length === 0 ? 'Import' : `Import ${toImport.length} ${toImport.length === 1 ? 'company' : 'companies'}`}
            </button>
          </div>
        </>
      )}

      {step === 'importing' && (
        <p role="status" className="flex items-center gap-2 text-muted">
          <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          {progress ? `Importing ${progress.name} (${progress.done + 1} of ${progress.of})…` : 'Importing…'}
        </p>
      )}

      {step === 'done' && outcomes && (
        <>
          <ul className="card divide-y divide-line">
            {outcomes.map((outcome) => (
              <Outcome key={outcome.company.key} outcome={outcome} />
            ))}
          </ul>
          <div className="flex justify-end border-t border-line pt-4">
            <button onClick={onImported} className="btn btn-primary">
              Close
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// The question before the preview: the companies of the file that are not in the dashboard.
function NewCompanies({ plan, choices, set, onDone }) {
  const ticked = plan.newCompanies.filter((c) => choices.add[c.key]).length
  const setAll = (value) => plan.newCompanies.forEach((c) => set('add', c.key, value))
  return (
    <section className="space-y-3">
      <p className="font-medium text-fg">These companies aren't in the dashboard yet. Do you want to add them?</p>
      <ul className="card divide-y divide-line">
        {plan.newCompanies.map((company) => (
          <li key={company.key}>
            <label className="flex items-center gap-3 px-4 py-2">
              <input type="checkbox" checked={choices.add[company.key] === true} onChange={(e) => set('add', company.key, e.target.checked)} />
              <span>
                <span className="font-medium text-fg">{company.name}</span>
                <span className="text-muted"> · BRN {company.brn}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-muted">A company you add is created in the dashboard with its name, BRN and details from the file, and its months imported.</p>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <button onClick={() => setAll(true)} className="btn btn-ghost mr-auto">
          Select all
        </button>
        <button
          onClick={() => {
            setAll(false)
            onDone()
          }}
          className="btn btn-secondary"
        >
          Don't add any
        </button>
        <button onClick={onDone} disabled={ticked === 0} className="btn btn-primary">
          Add the ticked companies
        </button>
      </div>
    </section>
  )
}

const people = (n) => `${n} ${n === 1 ? 'employee' : 'employees'}`

function statusLine(company, choices) {
  const setup = company.setupUse === 'yours' ? 'uses your shared setup' : company.setupUse === 'new' ? 'gets a new shared setup' : null
  if (company.status === 'problem') return null
  if (company.status === 'new') {
    return choices.add[company.key] ? `New company: it will be added to the dashboard, and ${setup}.` : "Not added: it isn't in the dashboard."
  }
  if (setup) return `It has no column setup in the dashboard yet: it ${setup}.`
  return company.dashboardName && company.dashboardName !== company.name ? `In the dashboard: ${company.dashboardName}.` : null
}

function CompanyPreview({ company, choices, set }) {
  const problem = company.status === 'problem'
  const notAdded = company.status === 'new' && !choices.add[company.key]
  const chosen = isChosen(company, choices)
  const line = statusLine(company, choices)
  return (
    <li className="card space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <label className="flex min-w-0 flex-1 items-start gap-3">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={chosen}
            disabled={problem || notAdded}
            onChange={(e) => set('companies', company.key, e.target.checked)}
            aria-label={`Import ${company.name}`}
          />
          <span className="min-w-0">
            <span className="font-semibold text-fg">{company.name}</span>
            <span className="text-muted"> · BRN {company.brn || 'none'}</span>
            {line && <span className="block text-muted">{line}</span>}
          </span>
        </label>
      </div>
      {problem && (
        <div className="panel panel-danger">
          <CircleAlert aria-hidden="true" />
          <span className="min-w-0 flex-1">
            Not imported. {company.problems.join(' ')}
          </span>
        </div>
      )}
      {company.warning && (
        <p className="flex items-start gap-1.5 text-warn">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{company.warning} Not ticked: tick it to import it all the same.</span>
        </p>
      )}
      {company.notes.map((note) => (
        <p key={note} className="text-muted">
          {note}
        </p>
      ))}
      {!problem && !notAdded && (
        <ul className="space-y-1.5 pl-7">
          {company.months.map((month) => (
            <MonthLine key={month.period} company={company} month={month} choices={choices} set={set} disabled={!chosen} />
          ))}
        </ul>
      )}
    </li>
  )
}

function MonthLine({ company, month, choices, set, disabled }) {
  const label = monthLabelOf(month.period)
  const key = `${company.key}|${month.period}`
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="min-w-32 font-medium text-fg">{label}</span>
      {month.action === 'add' && <span className="text-muted">Will be added ({people(month.people)}).</span>}
      {month.action === 'approved' && (
        <span className="text-muted">Already saved, and its run is approved in the dashboard: never replaced.</span>
      )}
      {month.action === 'saved' && (
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-muted">
            Already saved (revision {month.existing.revision}, {people(month.existing.employee_count)}):
          </span>
          <select
            className="field field-cell w-auto"
            aria-label={`What to do with ${label} of ${company.name}`}
            value={choices.replace[key] ? 'replace' : 'skip'}
            disabled={disabled}
            onChange={(e) => set('replace', key, e.target.value === 'replace')}
          >
            <option value="skip">Keep the dashboard's (skip)</option>
            <option value="replace">Replace it with the file's ({people(month.people)}), as a new revision</option>
          </select>
        </label>
      )}
    </li>
  )
}

const listMonths = (periods) => periods.map(monthLabelOf).join(', ')
const WHY = { saved: 'already saved', approved: 'approved, never replaced' }

function Outcome({ outcome }) {
  const { company } = outcome
  const done = outcome.outcome === 'created' || outcome.outcome === 'imported'
  const failed = outcome.outcome === 'failed'
  const parts = []
  if (outcome.outcome === 'created') parts.push('Created in the dashboard.')
  if (outcome.added.length > 0) parts.push(`Added: ${listMonths(outcome.added)}.`)
  if (outcome.replaced.length > 0) parts.push(`Replaced, as a new revision: ${listMonths(outcome.replaced)}.`)
  if (outcome.skipped.length > 0) parts.push(`Skipped: ${outcome.skipped.map((s) => `${monthLabelOf(s.period)} (${WHY[s.why]})`).join(', ')}.`)
  if (outcome.outcome === 'nothing') parts.unshift('Nothing imported.')
  if (outcome.outcome === 'not-chosen') parts.push('Skipped: not ticked.')
  if (outcome.outcome === 'not-added') parts.push('Not added.')
  if (outcome.outcome === 'problem') parts.push(`Not imported. ${outcome.reason}`)
  if (failed) parts.push(`NOT imported: ${outcome.reason} Nothing of it was saved.`)
  return (
    <li className={`flex items-start gap-2 px-4 py-2 ${failed ? 'text-danger' : ''}`}>
      {done ? (
        <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      ) : failed ? (
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <span className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0">
        <span className="font-medium text-fg">{company.name}</span>
        <span className="text-muted"> · BRN {company.brn || 'none'}: </span>
        {parts.join(' ')}
      </span>
    </li>
  )
}
